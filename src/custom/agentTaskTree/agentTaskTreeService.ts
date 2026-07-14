/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { CancellationTokenSource } from '../../vs/base/common/cancellation.js';
import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable, type IDisposable, toDisposable } from '../../vs/base/common/lifecycle.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';
import { AGENT_CONTEXT_FOLDER, WORKSPACE_MANIFEST } from '../goalWorkspace/ConsoleService.js';
import { discoverIxSubsystemRegions } from '../goalWorkspace/surfaceBlueprintIxDiscovery.js';
import type { IxSubsystemRegion } from '../goalWorkspace/surfaceIxMatch.js';
import { IIxIntegrationService } from '../ix/IxIntegrationService.js';
import { appendIxValidationRepairLeaves, buildAgentTaskTreeIxValidation } from './agentTaskTreeIxValidation.js';
import {
	buildSurfaceCoreBuildPlanScaffold,
	resolveSurfaceCoreBuildPlanSource,
	scaffoldToAgentTaskTreeRoots,
} from './surfaceCoreBuildPlanScaffold.js';
import type {
	AgentTaskExecutionResult,
	AgentTaskExecutor,
	AgentTaskNode,
	AgentTaskNodeStatus,
	AgentTaskRunResult,
	AgentTaskTree,
	AgentTaskTreeIxValidation,
	AgentTaskTreeIxValidationGap,
	AgentTaskTreeSurfaceMetadata,
} from './agentTaskTreeTypes.js';
import type { SurfaceBlueprint, SurfaceBlueprintTemplate } from '../goalWorkspace/surfaceBlueprintTypes.js';

export const AGENT_TASK_TREES_FOLDER = 'task-trees';
const MAX_IX_VALIDATION_ATTEMPTS = 3;

export const IAgentTaskTreeService = createDecorator<IAgentTaskTreeService>('agentTaskTreeService');

export interface IAgentTaskTreeService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeTaskTree: Event<AgentTaskTree | undefined>;
	generateTaskTree(prompt: string, metadata?: AgentTaskTreeSurfaceMetadata): Promise<AgentTaskTree>;
	generateSurfaceCoreBuildPlanTree(
		prompt: string,
		metadata: Required<Pick<AgentTaskTreeSurfaceMetadata, 'surfaceId' | 'surfaceName' | 'templateId'>>,
		source?: { readonly blueprint?: SurfaceBlueprint; readonly template?: SurfaceBlueprintTemplate },
	): Promise<AgentTaskTree>;
	loadTaskTree(treeId: string): Promise<AgentTaskTree | undefined>;
	loadLatestResumableTaskTree(): Promise<AgentTaskTree | undefined>;
	loadLatestTaskTreeForSurface(surfaceId: string): Promise<AgentTaskTree | undefined>;
	findNextPendingLeaf(tree: AgentTaskTree): AgentTaskNode | undefined;
	validateSurfaceTaskTreeShape(surfaceId: string, options: ValidateSurfaceTaskTreeShapeOptions): Promise<AgentTaskTreeIxValidation>;
	setExecutor(executor: AgentTaskExecutor): IDisposable;
	setIxIntegrationService(service: IIxIntegrationService): IDisposable;
	continueNextTask(treeId: string): Promise<AgentTaskRunResult>;
	runAllTasks(treeId: string): Promise<AgentTaskRunResult>;
	resumeTaskTree(treeId: string): Promise<void>;
	pauseTaskTree(treeId: string): Promise<void>;
	retryTask(treeId: string, nodeId: string): Promise<void>;
	skipTask(treeId: string, nodeId: string, notes?: string): Promise<void>;
	regenerateBranch(treeId: string, nodeId: string): Promise<void>;
}

export interface ValidateSurfaceTaskTreeShapeOptions {
	readonly ixIntegrationService?: IIxIntegrationService;
	readonly ixSubsystems?: readonly IxSubsystemRegion[];
	readonly command?: string;
}

export class AgentTaskTreeService extends Disposable implements IAgentTaskTreeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeTaskTree = this._register(new Emitter<AgentTaskTree | undefined>());
	readonly onDidChangeTaskTree = this._onDidChangeTaskTree.event;
	private executor: AgentTaskExecutor = new BlockingAgentTaskExecutor();
	private ixIntegrationService: IIxIntegrationService | undefined;
	private activeRun = false;
	private activeRunCts: CancellationTokenSource | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	setExecutorForTesting(executor: AgentTaskExecutor): void {
		this.executor = executor;
	}

	setExecutor(executor: AgentTaskExecutor): IDisposable {
		this.executor = executor;
		return toDisposable(() => {
			if (this.executor === executor) {
				this.executor = new BlockingAgentTaskExecutor();
			}
		});
	}

	setIxIntegrationService(service: IIxIntegrationService): IDisposable {
		this.ixIntegrationService = service;
		return toDisposable(() => {
			if (this.ixIntegrationService === service) {
				this.ixIntegrationService = undefined;
			}
		});
	}

	async generateTaskTree(prompt: string, metadata?: AgentTaskTreeSurfaceMetadata): Promise<AgentTaskTree> {
		if (metadata?.surfaceId && metadata.surfaceName && metadata.templateId) {
			return this.generateSurfaceCoreBuildPlanTree(prompt, {
				surfaceId: metadata.surfaceId,
				surfaceName: metadata.surfaceName,
				templateId: metadata.templateId,
			});
		}
		const workspaceFolder = this.requireWorkspaceFolder();
		const now = new Date().toISOString();
		const tree: AgentTaskTree = deriveParentStatuses({
			version: 1,
			id: createTreeId(prompt),
			prompt: prompt.trim(),
			createdAt: now,
			updatedAt: now,
			status: 'active',
			roots: createInitialTaskTree(prompt.trim()),
			cursor: {},
			surfaceId: metadata?.surfaceId,
			surfaceName: metadata?.surfaceName,
			templateId: metadata?.templateId,
		});
		await this.writeTaskTree(workspaceFolder, tree);
		this._onDidChangeTaskTree.fire(tree);
		return tree;
	}

	async generateSurfaceCoreBuildPlanTree(
		prompt: string,
		metadata: Required<Pick<AgentTaskTreeSurfaceMetadata, 'surfaceId' | 'surfaceName' | 'templateId'>>,
		source?: { readonly blueprint?: SurfaceBlueprint; readonly template?: SurfaceBlueprintTemplate },
	): Promise<AgentTaskTree> {
		const workspaceFolder = this.requireWorkspaceFolder();
		const planSource = resolveSurfaceCoreBuildPlanSource({
			surfaceId: metadata.surfaceId,
			surfaceName: metadata.surfaceName,
			templateId: metadata.templateId,
			blueprint: source?.blueprint,
			template: source?.template,
		});
		if (!planSource) {
			throw new Error(`No surface blueprint template found for ${metadata.templateId}.`);
		}
		const scaffold = buildSurfaceCoreBuildPlanScaffold(planSource, prompt.trim() || `Core implementation build plan for ${metadata.surfaceName}`);
		const now = new Date().toISOString();
		const tree: AgentTaskTree = deriveParentStatuses({
			version: 1,
			id: createTreeId(scaffold.prompt),
			prompt: scaffold.prompt,
			createdAt: now,
			updatedAt: now,
			status: 'active',
			roots: scaffoldToAgentTaskTreeRoots(scaffold),
			cursor: {},
			surfaceId: metadata.surfaceId,
			surfaceName: metadata.surfaceName,
			templateId: metadata.templateId,
		});
		await this.writeTaskTree(workspaceFolder, tree);
		this._onDidChangeTaskTree.fire(tree);
		return tree;
	}

	async loadTaskTree(treeId: string): Promise<AgentTaskTree | undefined> {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			return undefined;
		}
		const resource = taskTreeResource(workspaceFolder, treeId);
		return readTaskTree(this.fileService, resource);
	}

	async loadLatestResumableTaskTree(): Promise<AgentTaskTree | undefined> {
		return this.loadLatestMatchingTaskTree(tree => tree.status === 'active' || tree.status === 'paused');
	}

	async loadLatestTaskTreeForSurface(surfaceId: string): Promise<AgentTaskTree | undefined> {
		return this.loadLatestMatchingTaskTree(tree =>
			tree.surfaceId === surfaceId
			&& (tree.status === 'active' || tree.status === 'paused' || tree.status === 'complete'));
	}

	private async loadLatestMatchingTaskTree(predicate: (tree: AgentTaskTree) => boolean): Promise<AgentTaskTree | undefined> {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			return undefined;
		}
		const folder = taskTreesFolder(workspaceFolder);
		try {
			const stat = await this.fileService.resolve(folder);
			const files = (stat.children ?? [])
				.filter(child => !child.isDirectory && child.name.endsWith('.json'))
				.sort((a, b) => b.name.localeCompare(a.name));
			let latest: AgentTaskTree | undefined;
			for (const file of files) {
				const tree = await readTaskTree(this.fileService, joinPath(folder, file.name));
				if (!tree || !predicate(tree)) {
					continue;
				}
				if (!latest || tree.updatedAt > latest.updatedAt) {
					latest = tree;
				}
			}
			return latest;
		} catch {
			return undefined;
		}
	}

	findNextPendingLeaf(tree: AgentTaskTree): AgentTaskNode | undefined {
		return findNextPendingLeaf(tree);
	}

	async validateSurfaceTaskTreeShape(surfaceId: string, options: ValidateSurfaceTaskTreeShapeOptions): Promise<AgentTaskTreeIxValidation> {
		const workspaceFolder = this.requireWorkspaceFolder();
		const tree = await this.loadLatestTaskTreeForSurface(surfaceId);
		if (!tree) {
			throw new Error(`No task tree was found for surface ${surfaceId}.`);
		}
		const surfacePath = tree.surfaceId ? await readSurfacePathFromManifest(this.fileService, workspaceFolder, tree.surfaceId) : `apps/${surfaceId}`;
		let command = options.command ?? 'ix subsystems --list --detailed --sort importance --format json';
		let ixSubsystems = options.ixSubsystems;
		if (options.ixIntegrationService) {
			const mapped = await options.ixIntegrationService.mapPath(workspaceFolder, surfacePath);
			command = `${mapped.command}; ${command}`;
			ixSubsystems = await discoverIxSubsystemRegions(options.ixIntegrationService, workspaceFolder);
		}
		const validation = await buildAgentTaskTreeIxValidation({
			fileService: this.fileService,
			workspaceFolder,
			tree,
			surfaceId,
			ixSubsystems: ixSubsystems ?? [],
			command,
		});
		const attempt = (tree.ixValidationAttempts ?? 0) + 1;
		const validationApplied = validation.status === 'passed'
			? appendIxValidationRepairLeaves(tree, validation)
			: attempt >= MAX_IX_VALIDATION_ATTEMPTS
				? { ...tree, ixValidation: validation, status: 'failed' as const }
				: appendIxValidationRepairLeaves(tree, validation);
		const updated = deriveParentStatuses({
			...validationApplied,
			ixValidationAttempts: attempt,
			updatedAt: new Date().toISOString(),
		});
		if (validation.status !== 'passed' && attempt >= MAX_IX_VALIDATION_ATTEMPTS) {
			updated.status = 'failed';
		}
		await this.writeTaskTree(workspaceFolder, updated);
		this._onDidChangeTaskTree.fire(updated);
		return validation;
	}

	async continueNextTask(treeId: string): Promise<AgentTaskRunResult> {
		if (this.activeRun) {
			throw new Error('A task-tree run is already active.');
		}
		const workspaceFolder = this.requireWorkspaceFolder();
		const loaded = await this.loadTaskTree(treeId);
		if (!loaded) {
			throw new Error(`Task tree ${treeId} was not found.`);
		}
		this.activeRun = true;
		const runCts = new CancellationTokenSource();
		this.activeRunCts = runCts;
		try {
			let tree = loaded.status === 'paused' ? withTreeStatus(loaded, 'active') : loaded;
			if (tree.status !== 'active') {
				throw new Error(`Task tree ${tree.id} is ${tree.status}, not active.`);
			}
			const task = findNextPendingLeaf(tree);
			if (!task) {
				if (tree.surfaceId && tree.ixValidation?.status !== 'passed') {
					if ((tree.ixValidationAttempts ?? 0) >= MAX_IX_VALIDATION_ATTEMPTS) {
						tree.status = 'failed';
						await this.writeTaskTree(workspaceFolder, tree);
						this._onDidChangeTaskTree.fire(tree);
						return { tree, status: 'blocked' };
					}
					await this.validateSurfaceTaskTreeShape(tree.surfaceId, { ixIntegrationService: this.ixIntegrationService });
					tree = await this.loadTaskTree(tree.id) ?? tree;
					if (tree.ixValidation?.status !== 'passed') {
						return {
							tree,
							status: tree.status === 'failed' ? 'blocked' : 'completed',
						};
					}
				}
				tree = markTreeComplete(tree);
				await this.writeTaskTree(workspaceFolder, tree);
				this._onDidChangeTaskTree.fire(tree);
				return { tree, status: 'complete' };
			}

			tree = mutateNode(tree, task.id, node => ({
				...node,
				status: 'in_progress',
				implementation: {
					...node.implementation,
					startedAt: new Date().toISOString(),
					error: undefined,
				},
			}));
			tree.cursor = { ...tree.cursor, currentNodeId: task.id };
			await this.writeTaskTree(workspaceFolder, tree);
			this._onDidChangeTaskTree.fire(tree);

			const inProgressTask = findNode(tree, task.id) ?? task;
			try {
				const result = await this.executor.executeTask(tree, inProgressTask, runCts.token);
				if (runCts.token.isCancellationRequested) {
					throw new AgentTaskPausedError();
				}
				const missingPaths = await findMissingExpectedPaths(this.fileService, workspaceFolder, inProgressTask.expectedPaths ?? []);
				if (missingPaths.length) {
					throw new AgentTaskBlockedError(`Agent completed without creating expected path(s): ${missingPaths.join(', ')}`);
				}
				if ((inProgressTask.expectedPaths?.length || inProgressTask.acceptanceChecks?.length) && !result.commandsRun?.length) {
					throw new AgentTaskBlockedError('Agent completed without successful tool execution evidence.');
				}
				if (inProgressTask.acceptanceChecks?.length && !result.verification?.trim()) {
					throw new AgentTaskBlockedError('Agent completed without returning acceptance verification evidence.');
				}
				tree = markTaskComplete(tree, inProgressTask.id, result);
				tree = deriveParentStatuses(tree);
				await this.writeTaskTree(workspaceFolder, tree);
				this._onDidChangeTaskTree.fire(tree);
				return { tree, task: findNode(tree, inProgressTask.id), status: 'completed' };
			} catch (error) {
				if (error instanceof AgentTaskPausedError || runCts.token.isCancellationRequested) {
					const latest = await this.loadTaskTree(tree.id) ?? tree;
					tree = withTreeStatus(latest, 'paused');
					await this.writeTaskTree(workspaceFolder, tree);
					this._onDidChangeTaskTree.fire(tree);
					return { tree, task: findNode(tree, inProgressTask.id), status: 'paused' };
				}
				tree = markTaskError(tree, inProgressTask.id, error);
				tree = deriveParentStatuses(tree);
				await this.writeTaskTree(workspaceFolder, tree);
				this._onDidChangeTaskTree.fire(tree);
				return { tree, task: findNode(tree, inProgressTask.id), status: error instanceof AgentTaskBlockedError ? 'blocked' : 'failed' };
			}
		} finally {
			runCts.dispose();
			if (this.activeRunCts === runCts) {
				this.activeRunCts = undefined;
			}
			this.activeRun = false;
		}
	}

	async runAllTasks(treeId: string): Promise<AgentTaskRunResult> {
		let lastResult: AgentTaskRunResult | undefined;
		while (true) {
			lastResult = await this.continueNextTask(treeId);
			if (lastResult.status !== 'completed') {
				return lastResult;
			}
		}
	}

	async resumeTaskTree(treeId: string): Promise<void> {
		const tree = await this.requireTaskTree(treeId);
		await this.persistTree(withTreeStatus(tree, 'active'));
	}

	async pauseTaskTree(treeId: string): Promise<void> {
		this.activeRunCts?.cancel();
		const tree = await this.requireTaskTree(treeId);
		await this.persistTree(withTreeStatus(tree, 'paused'));
	}

	async retryTask(treeId: string, nodeId: string): Promise<void> {
		const tree = await this.requireTaskTree(treeId);
		await this.persistTree(mutateNode(tree, nodeId, node => ({
			...node,
			status: 'pending',
			implementation: {
				...node.implementation,
				error: undefined,
				completedAt: undefined,
			},
		})));
	}

	async skipTask(treeId: string, nodeId: string, notes?: string): Promise<void> {
		const tree = await this.requireTaskTree(treeId);
		await this.persistTree(mutateNode(tree, nodeId, node => ({
			...node,
			status: 'skipped',
			implementation: {
				...node.implementation,
				completedAt: new Date().toISOString(),
				notes: notes ?? node.implementation?.notes,
			},
		})));
	}

	async regenerateBranch(treeId: string, nodeId: string): Promise<void> {
		const tree = await this.requireTaskTree(treeId);
		await this.persistTree(mutateNode(tree, nodeId, node => ({
			...node,
			status: 'pending',
			implementation: {
				...node.implementation,
				notes: 'Branch marked pending for regeneration in a future Custom AI turn.',
				error: undefined,
			},
			children: resetNodes(node.children ?? []),
		})));
	}

	private async requireTaskTree(treeId: string): Promise<AgentTaskTree> {
		const tree = await this.loadTaskTree(treeId);
		if (!tree) {
			throw new Error(`Task tree ${treeId} was not found.`);
		}
		return tree;
	}

	private async persistTree(tree: AgentTaskTree): Promise<void> {
		const workspaceFolder = this.requireWorkspaceFolder();
		const normalized = deriveParentStatuses({ ...tree, updatedAt: new Date().toISOString() });
		await this.writeTaskTree(workspaceFolder, normalized);
		this._onDidChangeTaskTree.fire(normalized);
	}

	private async writeTaskTree(workspaceFolder: URI, tree: AgentTaskTree): Promise<void> {
		await writeTaskTree(this.fileService, workspaceFolder, deriveParentStatuses({ ...tree, updatedAt: new Date().toISOString() }));
	}

	private getWorkspaceFolder(): URI | undefined {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri;
	}

	private requireWorkspaceFolder(): URI {
		const workspaceFolder = this.getWorkspaceFolder();
		if (!workspaceFolder) {
			throw new Error('Open a workspace before using agent task trees.');
		}
		return workspaceFolder;
	}
}

export class AgentTaskBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AgentTaskBlockedError';
	}
}

export class AgentTaskPausedError extends Error {
	constructor() {
		super('Task execution was paused.');
		this.name = 'AgentTaskPausedError';
	}
}

class BlockingAgentTaskExecutor implements AgentTaskExecutor {
	async executeTask(): Promise<AgentTaskExecutionResult> {
		throw new AgentTaskBlockedError('Custom AI task execution is not available yet.');
	}
}

export async function findMissingExpectedPaths(
	fileService: IFileService,
	workspaceFolder: URI,
	expectedPaths: readonly string[],
): Promise<string[]> {
	const missing: string[] = [];
	for (const expectedPath of expectedPaths) {
		const resource = joinPath(workspaceFolder, ...expectedPath.split('/').filter(Boolean));
		if (await fileService.exists(resource)) {
			continue;
		}
		if (!/\.[a-z0-9]+$/i.test(expectedPath) && await fileService.exists(joinPath(resource, 'page.tsx'))) {
			continue;
		}
		missing.push(expectedPath);
	}
	return missing;
}

export function taskTreesFolder(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, AGENT_TASK_TREES_FOLDER);
}

export function taskTreeResource(workspaceFolder: URI, treeId: string): URI {
	return joinPath(taskTreesFolder(workspaceFolder), `${treeId}.json`);
}

export async function readTaskTree(fileService: IFileService, resource: URI): Promise<AgentTaskTree | undefined> {
	try {
		if (!(await fileService.exists(resource))) {
			return undefined;
		}
		return parseTaskTree(JSON.parse((await fileService.readFile(resource)).value.toString()));
	} catch {
		return undefined;
	}
}

export async function writeTaskTree(fileService: IFileService, workspaceFolder: URI, tree: AgentTaskTree): Promise<URI> {
	const folder = taskTreesFolder(workspaceFolder);
	const resource = taskTreeResource(workspaceFolder, tree.id);
	await fileService.createFolder(folder);
	await fileService.writeFile(resource, VSBuffer.fromString(`${JSON.stringify(tree, null, '\t')}\n`));
	return resource;
}

export function parseTaskTree(raw: unknown): AgentTaskTree | undefined {
	if (!isRecord(raw) || raw.version !== 1) {
		return undefined;
	}
	const id = optionalString(raw.id);
	const prompt = optionalString(raw.prompt);
	const createdAt = optionalString(raw.createdAt);
	const updatedAt = optionalString(raw.updatedAt);
	if (!id || !prompt || !createdAt || !updatedAt || !isTreeStatus(raw.status)) {
		return undefined;
	}
	const roots = parseNodes(raw.roots, undefined);
	if (!roots.length) {
		return undefined;
	}
	const cursor = isRecord(raw.cursor) ? {
		currentNodeId: optionalString(raw.cursor.currentNodeId),
		lastCompletedNodeId: optionalString(raw.cursor.lastCompletedNodeId),
	} : undefined;
	const surfaceId = optionalString(raw.surfaceId);
	const surfaceName = optionalString(raw.surfaceName);
	const templateId = optionalString(raw.templateId);
	const ixValidation = parseIxValidation(raw.ixValidation);
	const ixValidationAttempts = typeof raw.ixValidationAttempts === 'number' && Number.isInteger(raw.ixValidationAttempts)
		? Math.max(0, raw.ixValidationAttempts)
		: undefined;
	return deriveParentStatuses({
		version: 1,
		id,
		prompt,
		createdAt,
		updatedAt,
		status: raw.status,
		roots,
		cursor,
		surfaceId,
		surfaceName,
		templateId,
		ixValidation,
		ixValidationAttempts,
	});
}

export function findNextPendingLeaf(tree: AgentTaskTree): AgentTaskNode | undefined {
	const leaves = flattenNodes(tree.roots).filter(node => node.type === 'leaf' && (node.status === 'pending' || node.status === 'in_progress'));
	return leaves.sort((a, b) => a.order - b.order)[0];
}

export function findNode(tree: AgentTaskTree, nodeId: string): AgentTaskNode | undefined {
	return flattenNodes(tree.roots).find(node => node.id === nodeId);
}

export function findRetryableLeaf(tree: AgentTaskTree): AgentTaskNode | undefined {
	if (tree.cursor?.currentNodeId) {
		const current = findNode(tree, tree.cursor.currentNodeId);
		if (current?.type === 'leaf' && (current.status === 'failed' || current.status === 'blocked' || current.status === 'in_progress')) {
			return current;
		}
	}
	return flattenNodes(tree.roots)
		.filter(node => node.type === 'leaf' && (node.status === 'failed' || node.status === 'blocked' || node.status === 'in_progress'))
		.sort((a, b) => a.order - b.order)[0];
}

export function findRegenerableNodes(tree: AgentTaskTree): AgentTaskNode[] {
	return flattenNodes(tree.roots).filter(node => node.type !== 'leaf' && (node.children?.length ?? 0) > 0);
}

export function computeTaskTreeProgress(tree: AgentTaskTree): { completed: number; total: number; percent: number } {
	const leaves = flattenNodes(tree.roots).filter(node => node.type === 'leaf');
	const total = leaves.length;
	const completed = leaves.filter(node => node.status === 'complete' || node.status === 'skipped').length;
	const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
	return { completed, total, percent };
}

export function treeHasActiveWork(tree: AgentTaskTree): boolean {
	if (tree.status === 'active' || tree.status === 'paused' || tree.status === 'failed') {
		return true;
	}
	return flattenNodes(tree.roots).some(node =>
		node.type === 'leaf' && (node.status === 'blocked' || node.status === 'in_progress' || node.status === 'failed'));
}

export function deriveParentStatuses(tree: AgentTaskTree): AgentTaskTree {
	return {
		...tree,
		roots: deriveNodes(tree.roots),
	};
}

function deriveNodes(nodes: readonly AgentTaskNode[]): AgentTaskNode[] {
	return nodes.map(node => {
		const children = node.children?.length ? deriveNodes(node.children) : undefined;
		if (!children?.length) {
			return { ...node, children };
		}
		return { ...node, children, status: deriveStatusFromChildren(children) };
	});
}

function deriveStatusFromChildren(children: readonly AgentTaskNode[]): AgentTaskNodeStatus {
	if (children.some(child => child.status === 'failed')) {
		return 'failed';
	}
	if (children.some(child => child.status === 'blocked')) {
		return 'blocked';
	}
	if (children.some(child => child.status === 'in_progress')) {
		return 'in_progress';
	}
	if (children.every(child => child.status === 'complete' || child.status === 'skipped')) {
		return 'complete';
	}
	return 'pending';
}

function markTreeComplete(tree: AgentTaskTree): AgentTaskTree {
	return { ...deriveParentStatuses(tree), status: 'complete', cursor: { ...tree.cursor, currentNodeId: undefined } };
}

function withTreeStatus(tree: AgentTaskTree, status: AgentTaskTree['status']): AgentTaskTree {
	return { ...tree, status, updatedAt: new Date().toISOString() };
}

function markTaskComplete(tree: AgentTaskTree, nodeId: string, result: AgentTaskExecutionResult): AgentTaskTree {
	const updated = mutateNode(tree, nodeId, node => ({
		...node,
		status: 'complete',
		implementation: {
			...node.implementation,
			completedAt: new Date().toISOString(),
			changedFiles: [...(result.changedFiles ?? [])],
			commandsRun: [...(result.commandsRun ?? [])],
			verification: result.verification,
			notes: result.notes,
			error: undefined,
		},
	}));
	return {
		...updated,
		cursor: {
			...updated.cursor,
			currentNodeId: undefined,
			lastCompletedNodeId: nodeId,
		},
	};
}

function markTaskError(tree: AgentTaskTree, nodeId: string, error: unknown): AgentTaskTree {
	const blocked = error instanceof AgentTaskBlockedError;
	return mutateNode(tree, nodeId, node => ({
		...node,
		status: blocked ? 'blocked' : 'failed',
		implementation: {
			...node.implementation,
			completedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error),
		},
	}));
}

function mutateNode(tree: AgentTaskTree, nodeId: string, mutate: (node: AgentTaskNode) => AgentTaskNode): AgentTaskTree {
	return {
		...tree,
		updatedAt: new Date().toISOString(),
		roots: mutateNodes(tree.roots, nodeId, mutate),
	};
}

function mutateNodes(nodes: readonly AgentTaskNode[], nodeId: string, mutate: (node: AgentTaskNode) => AgentTaskNode): AgentTaskNode[] {
	return nodes.map(node => {
		if (node.id === nodeId) {
			return mutate(node);
		}
		if (node.children?.length) {
			return { ...node, children: mutateNodes(node.children, nodeId, mutate) };
		}
		return node;
	});
}

function resetNodes(nodes: readonly AgentTaskNode[]): AgentTaskNode[] {
	return nodes.map(node => ({
		...node,
		status: 'pending',
		implementation: undefined,
		children: node.children ? resetNodes(node.children) : undefined,
	}));
}

export function flattenNodes(nodes: readonly AgentTaskNode[]): AgentTaskNode[] {
	const result: AgentTaskNode[] = [];
	for (const node of nodes) {
		result.push(node);
		if (node.children?.length) {
			result.push(...flattenNodes(node.children));
		}
	}
	return result;
}

function parseNodes(raw: unknown, parentId: string | undefined): AgentTaskNode[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const nodes: AgentTaskNode[] = [];
	for (const item of raw) {
		if (!isRecord(item) || !isNodeType(item.type) || !isNodeStatus(item.status)) {
			continue;
		}
		const id = optionalString(item.id);
		const title = optionalString(item.title);
		const order = typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : undefined;
		if (!id || !title || order === undefined) {
			continue;
		}
		nodes.push({
			id,
			parentId: optionalString(item.parentId) ?? parentId,
			title,
			description: optionalString(item.description),
			type: item.type,
			status: item.status,
			order,
			children: parseNodes(item.children, id),
			implementation: parseImplementation(item.implementation),
			subsystemId: optionalString(item.subsystemId),
			expectedPaths: stringArray(item.expectedPaths),
			acceptanceChecks: stringArray(item.acceptanceChecks),
		});
	}
	return nodes.sort((a, b) => a.order - b.order);
}

function parseImplementation(raw: unknown): AgentTaskNode['implementation'] {
	if (!isRecord(raw)) {
		return undefined;
	}
	return {
		startedAt: optionalString(raw.startedAt),
		completedAt: optionalString(raw.completedAt),
		changedFiles: stringArray(raw.changedFiles),
		commandsRun: stringArray(raw.commandsRun),
		verification: optionalString(raw.verification),
		notes: optionalString(raw.notes),
		error: optionalString(raw.error),
	};
}

function parseIxValidation(raw: unknown): AgentTaskTree['ixValidation'] {
	if (!isRecord(raw) || !isIxValidationStatus(raw.status)) {
		return undefined;
	}
	const ranAt = optionalString(raw.ranAt);
	const surfacePath = optionalString(raw.surfacePath);
	const command = optionalString(raw.command);
	const subsystemCount = numberOr(raw.subsystemCount, -1);
	const matchedCount = numberOr(raw.matchedCount, -1);
	if (!ranAt || !surfacePath || !command || subsystemCount < 0 || matchedCount < 0) {
		return undefined;
	}
	return {
		status: raw.status,
		ranAt,
		surfacePath,
		command,
		subsystemCount,
		matchedCount,
		gaps: parseIxValidationGaps(raw.gaps),
	};
}

function parseIxValidationGaps(raw: unknown): AgentTaskTreeIxValidationGap[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const gaps: AgentTaskTreeIxValidationGap[] = [];
	for (const item of raw) {
		if (!isRecord(item) || !isIxValidationGapKind(item.kind)) {
			continue;
		}
		const id = optionalString(item.id);
		const expectedLabel = optionalString(item.expectedLabel);
		const message = optionalString(item.message);
		if (!id || !expectedLabel || !message) {
			continue;
		}
		gaps.push({
			id,
			kind: item.kind,
			expectedId: optionalString(item.expectedId),
			expectedLabel,
			expectedPaths: stringArray(item.expectedPaths) ?? [],
			matchedRegionId: optionalString(item.matchedRegionId),
			matchedRegionLabel: optionalString(item.matchedRegionLabel),
			message,
		});
	}
	return gaps;
}

function createInitialTaskTree(prompt: string): AgentTaskNode[] {
	const slug = slugify(prompt).slice(0, 40) || 'feature';
	let order = 1;
	const nextOrder = () => order++;

	return [
		rootNode(`${slug}-planning`, 'Feature Planning', nextOrder(), [
			leafNode(`${slug}-define-contract`, `${slug}-planning`, 'Define implementation contract', 'Identify files, interfaces, data flow, edge cases, and acceptance checks for this feature.', nextOrder()),
			leafNode(`${slug}-map-integration`, `${slug}-planning`, 'Map integration points', 'List workbench commands, services, storage locations, and UI surfaces this feature must touch.', nextOrder()),
			leafNode(`${slug}-define-tests`, `${slug}-planning`, 'Define verification strategy', 'Add or update tests that prove persistence, resume, and failure behavior.', nextOrder()),
		]),
		rootNode(`${slug}-core`, 'Core Implementation', nextOrder(), [
			leafNode(`${slug}-build-core`, `${slug}-core`, 'Build core implementation', prompt, nextOrder()),
			leafNode(`${slug}-wire-services`, `${slug}-core`, 'Wire services and lifecycle', 'Register singletons, contributions, and event hooks needed by the core workflow.', nextOrder()),
		]),
		rootNode(`${slug}-data-model`, 'Data Model and Persistence', nextOrder(), [
			leafNode(`${slug}-define-schema`, `${slug}-data-model`, 'Define schema and types', 'Add durable types and JSON schema for persisted state.', nextOrder()),
			leafNode(`${slug}-persist-state`, `${slug}-data-model`, 'Persist and reload state', 'Save state immediately after generation and before/after each task attempt.', nextOrder()),
		]),
		rootNode(`${slug}-agent-loop`, 'Agent Loop', nextOrder(), [
			leafNode(`${slug}-select-next-leaf`, `${slug}-agent-loop`, 'Select next pending leaf', 'Implement ordered leaf selection that skips completed siblings and resumes in-progress work.', nextOrder()),
			leafNode(`${slug}-task-lifecycle`, `${slug}-agent-loop`, 'Implement task lifecycle', 'Support pending, in_progress, complete, failed, blocked, and skipped transitions.', nextOrder()),
			leafNode(`${slug}-resume-loop`, `${slug}-agent-loop`, 'Support resume and pause', 'Reload saved trees and continue from the last unfinished task without regenerating.', nextOrder()),
		]),
		rootNode(`${slug}-ui`, 'UI Integration', nextOrder(), [
			leafNode(`${slug}-wire-commands`, `${slug}-ui`, 'Wire commands', 'Expose generate, resume, continue, pause, retry, skip, and show actions.', nextOrder()),
			leafNode(`${slug}-render-tree`, `${slug}-ui`, 'Render task tree status', 'Show roots, current task, completed tasks, blocked tasks, and changed files.', nextOrder()),
		]),
		rootNode(`${slug}-verification`, 'Testing and Verification', nextOrder(), [
			leafNode(`${slug}-unit-tests`, `${slug}-verification`, 'Add focused unit tests', 'Cover persistence, next-leaf selection, parent status derivation, and retry/skip behavior.', nextOrder()),
			leafNode(`${slug}-run-tests`, `${slug}-verification`, 'Run focused tests', 'Run the smallest relevant test set and capture verification output.', nextOrder()),
		]),
		rootNode(`${slug}-mvp`, 'MVP Build Path', nextOrder(), [
			leafNode(`${slug}-ship-mvp`, `${slug}-mvp`, 'Ship minimal slice', 'Deliver one-task-at-a-time execution with durable progress before advanced scheduling.', nextOrder()),
		]),
	];
}

function rootNode(id: string, title: string, order: number, children: AgentTaskNode[]): AgentTaskNode {
	return { id, title, type: 'root', status: 'pending', order, children };
}

function leafNode(id: string, parentId: string, title: string, description: string, order: number): AgentTaskNode {
	return { id, parentId, title, description, type: 'leaf', status: 'pending', order };
}

function createTreeId(prompt: string): string {
	const now = new Date();
	const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
	const slug = slugify(prompt).slice(0, 48) || 'task-tree';
	return `${stamp}-${slug}`;
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isTreeStatus(value: unknown): value is AgentTaskTree['status'] {
	return value === 'draft' || value === 'active' || value === 'paused' || value === 'complete' || value === 'failed';
}

function isNodeStatus(value: unknown): value is AgentTaskNodeStatus {
	return value === 'pending' || value === 'in_progress' || value === 'blocked' || value === 'complete' || value === 'failed' || value === 'skipped';
}

function isNodeType(value: unknown): value is AgentTaskNode['type'] {
	return value === 'root' || value === 'branch' || value === 'leaf';
}

function isIxValidationStatus(value: unknown): value is NonNullable<AgentTaskTree['ixValidation']>['status'] {
	return value === 'passed' || value === 'gaps' || value === 'unavailable';
}

function isIxValidationGapKind(value: unknown): value is AgentTaskTreeIxValidationGap['kind'] {
	return value === 'missing_region' || value === 'missing_path' || value === 'thin_region' || value === 'unexpected_region';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const result = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
	return result.length ? result : undefined;
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function readSurfacePathFromManifest(fileService: IFileService, workspaceFolder: URI, surfaceId: string): Promise<string> {
	try {
		const raw = JSON.parse((await fileService.readFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST))).value.toString());
		const surfaces = Array.isArray(raw?.surfaces) ? raw.surfaces : [];
		for (const surface of surfaces) {
			if (surface?.id === surfaceId && typeof surface.path === 'string' && surface.path.trim()) {
				return surface.path.trim();
			}
		}
	} catch {
		// Fall back to convention below.
	}
	return `apps/${surfaceId}`;
}

registerSingleton(IAgentTaskTreeService, AgentTaskTreeService, InstantiationType.Delayed);

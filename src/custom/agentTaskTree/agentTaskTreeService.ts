/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';
import { AGENT_CONTEXT_FOLDER } from '../goalWorkspace/ConsoleService.js';
import type {
	AgentTaskExecutionResult,
	AgentTaskExecutor,
	AgentTaskNode,
	AgentTaskNodeStatus,
	AgentTaskRunResult,
	AgentTaskTree,
} from './agentTaskTreeTypes.js';

export const AGENT_TASK_TREES_FOLDER = 'task-trees';

export const IAgentTaskTreeService = createDecorator<IAgentTaskTreeService>('agentTaskTreeService');

export interface IAgentTaskTreeService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeTaskTree: Event<AgentTaskTree | undefined>;
	generateTaskTree(prompt: string): Promise<AgentTaskTree>;
	loadTaskTree(treeId: string): Promise<AgentTaskTree | undefined>;
	loadLatestResumableTaskTree(): Promise<AgentTaskTree | undefined>;
	findNextPendingLeaf(tree: AgentTaskTree): AgentTaskNode | undefined;
	continueNextTask(treeId: string): Promise<AgentTaskRunResult>;
	resumeTaskTree(treeId: string): Promise<void>;
	pauseTaskTree(treeId: string): Promise<void>;
	retryTask(treeId: string, nodeId: string): Promise<void>;
	skipTask(treeId: string, nodeId: string, notes?: string): Promise<void>;
	regenerateBranch(treeId: string, nodeId: string): Promise<void>;
}

export class AgentTaskTreeService extends Disposable implements IAgentTaskTreeService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeTaskTree = this._register(new Emitter<AgentTaskTree | undefined>());
	readonly onDidChangeTaskTree = this._onDidChangeTaskTree.event;
	private executor: AgentTaskExecutor = new BlockingAgentTaskExecutor();
	private activeRun = false;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	setExecutorForTesting(executor: AgentTaskExecutor): void {
		this.executor = executor;
	}

	async generateTaskTree(prompt: string): Promise<AgentTaskTree> {
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
				if (!tree || (tree.status !== 'active' && tree.status !== 'paused')) {
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
		try {
			let tree = loaded.status === 'paused' ? withTreeStatus(loaded, 'active') : loaded;
			if (tree.status !== 'active') {
				throw new Error(`Task tree ${tree.id} is ${tree.status}, not active.`);
			}
			const task = findNextPendingLeaf(tree);
			if (!task) {
				tree = markTreeComplete(tree);
				await this.writeTaskTree(workspaceFolder, tree);
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

			const inProgressTask = findNode(tree, task.id) ?? task;
			try {
				const result = await this.executor.executeTask(tree, inProgressTask);
				tree = markTaskComplete(tree, inProgressTask.id, result);
				tree = deriveParentStatuses(tree);
				await this.writeTaskTree(workspaceFolder, tree);
				this._onDidChangeTaskTree.fire(tree);
				return { tree, task: findNode(tree, inProgressTask.id), status: 'completed' };
			} catch (error) {
				tree = markTaskError(tree, inProgressTask.id, error);
				tree = deriveParentStatuses(tree);
				await this.writeTaskTree(workspaceFolder, tree);
				this._onDidChangeTaskTree.fire(tree);
				return { tree, task: findNode(tree, inProgressTask.id), status: error instanceof AgentTaskBlockedError ? 'blocked' : 'failed' };
			}
		} finally {
			this.activeRun = false;
		}
	}

	async resumeTaskTree(treeId: string): Promise<void> {
		const tree = await this.requireTaskTree(treeId);
		await this.persistTree(withTreeStatus(tree, 'active'));
	}

	async pauseTaskTree(treeId: string): Promise<void> {
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

class BlockingAgentTaskExecutor implements AgentTaskExecutor {
	async executeTask(): Promise<AgentTaskExecutionResult> {
		throw new AgentTaskBlockedError('Autonomous Custom AI task execution is not connected yet. Resume from the task-tree UI and run the task through Custom AI.');
	}
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
	return deriveParentStatuses({ version: 1, id, prompt, createdAt, updatedAt, status: raw.status, roots, cursor });
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

function flattenNodes(nodes: readonly AgentTaskNode[]): AgentTaskNode[] {
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

registerSingleton(IAgentTaskTreeService, AgentTaskTreeService, InstantiationType.Delayed);

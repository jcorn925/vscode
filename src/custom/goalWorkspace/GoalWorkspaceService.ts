/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { FileChangeType, IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';

export const GOAL_WORKSPACE_MANIFEST = 'workspace.goal.json';
export const GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER = '.agent';
export const GOAL_WORKSPACE_IX_OVERLAY_FILE = 'ix-surface-map.json';

const GLOBAL_AGENT_CONTEXT_FILES = [
	{ id: 'workspace', relativePath: 'workspace.md' },
	{ id: 'domain', relativePath: 'domain.md' },
	{ id: 'events', relativePath: 'events.md' },
	{ id: 'decisions', relativePath: 'decisions.md' },
] as const;

export interface GoalWorkspaceGoal {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly northStarMetric?: string;
}

export interface GoalWorkspaceSurface {
	readonly id: string;
	readonly name: string;
	readonly type?: string;
	readonly path?: string;
	readonly devCommand?: string;
	readonly localUrl?: string;
	readonly purpose?: string;
	readonly capabilities: readonly string[];
	readonly events: readonly string[];
	readonly entities: readonly string[];
	readonly ixSubsystems: readonly string[];
	readonly ix?: GoalSurfaceIxMetadata;
}

export type GoalSurface = GoalWorkspaceSurface;

export interface GoalSurfaceIxMetadata {
	readonly subsystemIds: readonly string[];
	readonly subsystemLabels: readonly string[];
	readonly tags: readonly string[];
	readonly notes?: string;
}

export interface GoalWorkspaceShared {
	readonly domain?: string;
	readonly events?: string;
	readonly ui?: string;
	readonly auth?: string;
	readonly workflows?: string;
}

export type GoalWorkspaceContextFileKind = 'workspace' | 'domain' | 'events' | 'decisions' | 'surface';

export interface GoalWorkspaceContextFile {
	readonly id: string;
	readonly kind: GoalWorkspaceContextFileKind;
	readonly resource: URI;
	readonly relativePath: string;
	readonly summary: string;
}

export interface GoalSurfaceContextSummary {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly files: readonly GoalWorkspaceContextFile[];
	readonly summary: string;
}

export interface GoalWorkspaceContext {
	readonly root: URI | undefined;
	readonly globalFiles: readonly GoalWorkspaceContextFile[];
	readonly surfaceFiles: readonly GoalWorkspaceContextFile[];
	readonly surfaceSummaries: readonly GoalSurfaceContextSummary[];
}

export interface GoalWorkspaceIxDiscoveredSubsystem {
	readonly id: string;
	readonly label: string;
	readonly kind?: string;
	readonly path?: string;
	readonly fileCount?: number;
}

export interface GoalWorkspaceIxSurfaceOverlay {
	readonly surfaceId: string;
	readonly subsystemIds: readonly string[];
	readonly subsystemLabels: readonly string[];
	readonly matchReason?: string;
}

export interface GoalWorkspaceIxOverlay {
	readonly resource: URI;
	readonly generatedAt: string | undefined;
	readonly command: string | undefined;
	readonly discoveredSubsystems: readonly GoalWorkspaceIxDiscoveredSubsystem[];
	readonly surfaces: readonly GoalWorkspaceIxSurfaceOverlay[];
}

export interface GoalWorkspaceIxState {
	readonly root: URI | undefined;
	readonly overlayResource: URI | undefined;
	readonly overlay: GoalWorkspaceIxOverlay | undefined;
}

export interface GoalWorkspace {
	readonly workspaceFolder: URI;
	readonly manifestResource: URI;
	readonly goal: GoalWorkspaceGoal;
	readonly surfaces: readonly GoalWorkspaceSurface[];
	readonly shared: GoalWorkspaceShared;
}

export interface GoalWorkspaceDiagnostic {
	readonly path: string;
	readonly message: string;
}

export type GoalWorkspaceManifestStatus = 'no-workspace' | 'missing' | 'loaded' | 'invalid';

export interface GoalWorkspaceState {
	readonly status: GoalWorkspaceManifestStatus;
	readonly workspaceFolder: URI | undefined;
	readonly manifestResource: URI | undefined;
	readonly workspace: GoalWorkspace | undefined;
	readonly context: GoalWorkspaceContext;
	readonly ix: GoalWorkspaceIxState;
	readonly diagnostics: readonly GoalWorkspaceDiagnostic[];
}

export interface IGoalWorkspaceService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeGoalWorkspace: Event<void>;
	readonly onDidChangeState: Event<GoalWorkspaceState>;

	getState(): GoalWorkspaceState;
	getGoal(): GoalWorkspaceGoal | undefined;
	getGoalWorkspace(): GoalWorkspace | undefined;
	getSurfaces(): readonly GoalSurface[];
	getSurface(id: string): GoalSurface | undefined;
	getContext(): GoalWorkspaceContext;
	getSurfaceContext(surfaceId: string): GoalSurfaceContextSummary | undefined;
	getIx(): GoalWorkspaceIxState;
	getSurfaceIxOverlay(surfaceId: string): GoalWorkspaceIxSurfaceOverlay | undefined;
	getAffectedSurfacesForIxSubsystem(subsystem: string): readonly GoalSurface[];
	refresh(): Promise<GoalWorkspaceState>;
}

export const IGoalWorkspaceService = createDecorator<IGoalWorkspaceService>('goalWorkspaceService');

const EMPTY_SHARED: GoalWorkspaceShared = {};
const EMPTY_CONTEXT: GoalWorkspaceContext = {
	root: undefined,
	globalFiles: [],
	surfaceFiles: [],
	surfaceSummaries: []
};
const EMPTY_IX: GoalWorkspaceIxState = {
	root: undefined,
	overlayResource: undefined,
	overlay: undefined
};

export class GoalWorkspaceService extends Disposable implements IGoalWorkspaceService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeGoalWorkspace = this._register(new Emitter<void>());
	readonly onDidChangeGoalWorkspace = this._onDidChangeGoalWorkspace.event;

	private readonly _onDidChangeState = this._register(new Emitter<GoalWorkspaceState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private state: GoalWorkspaceState = createNoWorkspaceGoalWorkspaceState();

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.refresh()));
		this._register(this.fileService.onDidFilesChange(e => {
			const manifestResource = this.state.manifestResource;
			const agentContextRoot = this.state.workspaceFolder ? joinPath(this.state.workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER) : undefined;
			if (manifestResource && e.contains(manifestResource, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
				void this.refresh();
				return;
			}
			if (agentContextRoot && e.affects(agentContextRoot, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
				void this.refresh();
			}
		}));
		void this.refresh();
	}

	getState(): GoalWorkspaceState {
		return this.state;
	}

	getGoal(): GoalWorkspaceGoal | undefined {
		return this.state.workspace?.goal;
	}

	getGoalWorkspace(): GoalWorkspace | undefined {
		return this.state.workspace;
	}

	getSurfaces(): readonly GoalSurface[] {
		return this.state.workspace?.surfaces ?? [];
	}

	getSurface(id: string): GoalSurface | undefined {
		return this.getSurfaces().find(surface => surface.id === id);
	}

	getContext(): GoalWorkspaceContext {
		return this.state.context;
	}

	getSurfaceContext(surfaceId: string): GoalSurfaceContextSummary | undefined {
		return this.state.context.surfaceSummaries.find(summary => summary.surfaceId === surfaceId);
	}

	getIx(): GoalWorkspaceIxState {
		return this.state.ix;
	}

	getSurfaceIxOverlay(surfaceId: string): GoalWorkspaceIxSurfaceOverlay | undefined {
		return this.state.ix.overlay?.surfaces.find(surface => surface.surfaceId === surfaceId);
	}

	getAffectedSurfacesForIxSubsystem(subsystem: string): readonly GoalSurface[] {
		const normalized = normalizeIxMatchText(subsystem);
		if (!normalized) {
			return [];
		}
		return this.getSurfaces().filter(surface => {
			const declaredMatches = [
				...surface.ixSubsystems,
				...(surface.ix?.subsystemIds ?? []),
				...(surface.ix?.subsystemLabels ?? []),
				...(surface.ix?.tags ?? []),
			].some(value => normalizeIxMatchText(value) === normalized);
			if (declaredMatches) {
				return true;
			}

			const overlay = this.getSurfaceIxOverlay(surface.id);
			return [
				...(overlay?.subsystemIds ?? []),
				...(overlay?.subsystemLabels ?? []),
			].some(value => normalizeIxMatchText(value) === normalized);
		});
	}

	async refresh(): Promise<GoalWorkspaceState> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			return this.setState(createNoWorkspaceGoalWorkspaceState());
		}

		const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);
		const context = await this.readAgentContext(workspaceFolder, []);
		const ix = await this.readIxOverlay(workspaceFolder);
		if (!(await this.fileService.exists(manifestResource))) {
			return this.setState(createMissingGoalWorkspaceState(workspaceFolder, manifestResource, context, ix));
		}

		try {
			const content = (await this.fileService.readFile(manifestResource)).value.toString();
			const parsed = parseGoalWorkspaceManifestText(content, workspaceFolder, manifestResource);
			const parsedContext = await this.readAgentContext(workspaceFolder, parsed.workspace?.surfaces ?? []);
			const parsedIx = await this.readIxOverlay(workspaceFolder);
			return this.setState(withIxOverlay(withAgentContext(parsed, parsedContext), parsedIx));
		} catch (e: unknown) {
			return this.setState({
				status: 'invalid',
				workspaceFolder,
				manifestResource,
				workspace: undefined,
				context,
				ix,
				diagnostics: [{ path: '$', message: `Failed to read ${GOAL_WORKSPACE_MANIFEST}: ${String((e as Error)?.message ?? e)}` }]
			});
		}
	}

	private async readAgentContext(workspaceFolder: URI, surfaces: readonly GoalSurface[]): Promise<GoalWorkspaceContext> {
		return discoverGoalWorkspaceContext(this.fileService, workspaceFolder, surfaces);
	}

	private async readIxOverlay(workspaceFolder: URI): Promise<GoalWorkspaceIxState> {
		return discoverGoalWorkspaceIxOverlay(this.fileService, workspaceFolder);
	}

	private setState(state: GoalWorkspaceState): GoalWorkspaceState {
		this.state = state;
		this._onDidChangeGoalWorkspace.fire();
		this._onDidChangeState.fire(this.state);
		return this.state;
	}
}

export function createNoWorkspaceGoalWorkspaceState(): GoalWorkspaceState {
	return {
		status: 'no-workspace',
		workspaceFolder: undefined,
		manifestResource: undefined,
		workspace: undefined,
		context: EMPTY_CONTEXT,
		ix: EMPTY_IX,
		diagnostics: []
	};
}

export function createMissingGoalWorkspaceState(workspaceFolder: URI, manifestResource: URI, context: GoalWorkspaceContext = createEmptyAgentContext(workspaceFolder), ix: GoalWorkspaceIxState = createEmptyIxState(workspaceFolder)): GoalWorkspaceState {
	return {
		status: 'missing',
		workspaceFolder,
		manifestResource,
		workspace: undefined,
		context,
		ix,
		diagnostics: []
	};
}

export function parseGoalWorkspaceManifestText(text: string, workspaceFolder: URI, manifestResource: URI): GoalWorkspaceState {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e: unknown) {
		return {
			status: 'invalid',
			workspaceFolder,
			manifestResource,
			workspace: undefined,
			context: createEmptyAgentContext(workspaceFolder),
			ix: createEmptyIxState(workspaceFolder),
			diagnostics: [{ path: '$', message: `Invalid JSON: ${String((e as Error)?.message ?? e)}` }]
		};
	}

	return parseGoalWorkspaceManifest(raw, workspaceFolder, manifestResource);
}

export function parseGoalWorkspaceManifest(raw: unknown, workspaceFolder: URI, manifestResource: URI): GoalWorkspaceState {
	const diagnostics: GoalWorkspaceDiagnostic[] = [];
	if (!isRecord(raw)) {
		return invalidState(workspaceFolder, manifestResource, [{ path: '$', message: 'Manifest must be an object.' }]);
	}

	const goalRaw = raw.goal;
	if (!isRecord(goalRaw)) {
		return invalidState(workspaceFolder, manifestResource, [{ path: '$.goal', message: 'Goal must be an object.' }]);
	}

	const goal: GoalWorkspaceGoal = {
		id: requiredString(goalRaw, 'id', '$.goal.id', diagnostics),
		name: requiredString(goalRaw, 'name', '$.goal.name', diagnostics),
		description: optionalString(goalRaw, 'description', '$.goal.description', diagnostics),
		northStarMetric: optionalString(goalRaw, 'northStarMetric', '$.goal.northStarMetric', diagnostics)
	};

	const surfacesRaw = raw.surfaces;
	const surfaces: GoalWorkspaceSurface[] = [];
	if (surfacesRaw === undefined) {
		diagnostics.push({ path: '$.surfaces', message: 'Surfaces must be an array.' });
	} else if (!Array.isArray(surfacesRaw)) {
		diagnostics.push({ path: '$.surfaces', message: 'Surfaces must be an array.' });
	} else {
		const seenSurfaceIds = new Set<string>();
		for (let i = 0; i < surfacesRaw.length; i++) {
			const surface = parseSurface(surfacesRaw[i], i, diagnostics);
			if (!surface) {
				continue;
			}
			if (seenSurfaceIds.has(surface.id)) {
				diagnostics.push({ path: `$.surfaces[${i}].id`, message: `Duplicate surface id "${surface.id}".` });
				continue;
			}
			seenSurfaceIds.add(surface.id);
			surfaces.push(surface);
		}
	}

	const shared = parseShared(raw.shared, diagnostics);
	if (diagnostics.length > 0) {
		return invalidState(workspaceFolder, manifestResource, diagnostics);
	}

	return {
		status: 'loaded',
		workspaceFolder,
		manifestResource,
		workspace: {
			workspaceFolder,
			manifestResource,
			goal,
			surfaces,
			shared
		},
		context: createEmptyAgentContext(workspaceFolder),
		ix: createEmptyIxState(workspaceFolder),
		diagnostics: []
	};
}

export async function discoverGoalWorkspaceContext(fileService: IFileService, workspaceFolder: URI, surfaces: readonly GoalSurface[]): Promise<GoalWorkspaceContext> {
	const root = joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER);
	const globalFiles: GoalWorkspaceContextFile[] = [];
	const surfaceFiles: GoalWorkspaceContextFile[] = [];

	for (const file of GLOBAL_AGENT_CONTEXT_FILES) {
		const contextFile = await readAgentContextFile(fileService, root, file.relativePath, file.id, file.id);
		if (contextFile) {
			globalFiles.push(contextFile);
		}
	}

	for (const surface of surfaces) {
		const relativePath = `apps/${surface.id}.md`;
		const contextFile = await readAgentContextFile(fileService, root, relativePath, surface.id, 'surface');
		if (contextFile) {
			surfaceFiles.push(contextFile);
		}
	}

	return {
		root,
		globalFiles,
		surfaceFiles,
		surfaceSummaries: surfaces.map(surface => createSurfaceContextSummary(surface, globalFiles, surfaceFiles.filter(file => file.id === surface.id)))
	};
}

function createEmptyAgentContext(workspaceFolder: URI | undefined): GoalWorkspaceContext {
	return {
		root: workspaceFolder ? joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER) : undefined,
		globalFiles: [],
		surfaceFiles: [],
		surfaceSummaries: []
	};
}

function withAgentContext(state: GoalWorkspaceState, context: GoalWorkspaceContext): GoalWorkspaceState {
	return { ...state, context };
}

export async function discoverGoalWorkspaceIxOverlay(fileService: IFileService, workspaceFolder: URI): Promise<GoalWorkspaceIxState> {
	const root = joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER);
	const overlayResource = joinPath(root, GOAL_WORKSPACE_IX_OVERLAY_FILE);
	if (!(await safeExists(fileService, overlayResource))) {
		return createEmptyIxState(workspaceFolder);
	}

	try {
		const raw = JSON.parse((await fileService.readFile(overlayResource)).value.toString());
		const overlay = parseGoalWorkspaceIxOverlay(raw, overlayResource);
		return {
			root,
			overlayResource,
			overlay
		};
	} catch {
		return createEmptyIxState(workspaceFolder);
	}
}

function createEmptyIxState(workspaceFolder: URI | undefined): GoalWorkspaceIxState {
	const root = workspaceFolder ? joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER) : undefined;
	return {
		root,
		overlayResource: root ? joinPath(root, GOAL_WORKSPACE_IX_OVERLAY_FILE) : undefined,
		overlay: undefined
	};
}

function withIxOverlay(state: GoalWorkspaceState, ix: GoalWorkspaceIxState): GoalWorkspaceState {
	return { ...state, ix };
}

function parseGoalWorkspaceIxOverlay(raw: unknown, resource: URI): GoalWorkspaceIxOverlay | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	return {
		resource,
		generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
		command: typeof raw.command === 'string' ? raw.command : undefined,
		discoveredSubsystems: parseIxDiscoveredSubsystems(raw.discoveredSubsystems),
		surfaces: parseIxSurfaceOverlays(raw.surfaces)
	};
}

function parseIxDiscoveredSubsystems(raw: unknown): readonly GoalWorkspaceIxDiscoveredSubsystem[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: GoalWorkspaceIxDiscoveredSubsystem[] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const id = optionalStringValue(item.id);
		const label = optionalStringValue(item.label);
		if (!id || !label) {
			continue;
		}
		const fileCount = typeof item.fileCount === 'number' && Number.isFinite(item.fileCount) ? item.fileCount : undefined;
		result.push({
			id,
			label,
			kind: optionalStringValue(item.kind),
			path: optionalStringValue(item.path),
			fileCount
		});
	}
	return result;
}

function parseIxSurfaceOverlays(raw: unknown): readonly GoalWorkspaceIxSurfaceOverlay[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: GoalWorkspaceIxSurfaceOverlay[] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const surfaceId = optionalStringValue(item.surfaceId);
		if (!surfaceId) {
			continue;
		}
		result.push({
			surfaceId,
			subsystemIds: stringArrayValue(item.subsystemIds),
			subsystemLabels: stringArrayValue(item.subsystemLabels),
			matchReason: optionalStringValue(item.matchReason)
		});
	}
	return result;
}

async function readAgentContextFile(fileService: IFileService, root: URI, relativePath: string, id: string, kind: GoalWorkspaceContextFileKind): Promise<GoalWorkspaceContextFile | undefined> {
	const resource = joinPath(root, ...relativePath.split('/'));
	if (!(await safeExists(fileService, resource))) {
		return undefined;
	}

	try {
		const content = (await fileService.readFile(resource)).value.toString();
		return {
			id,
			kind,
			resource,
			relativePath: `${GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER}/${relativePath}`,
			summary: summarizeAgentContextMarkdown(content)
		};
	} catch {
		return undefined;
	}
}

function createSurfaceContextSummary(surface: GoalSurface, globalFiles: readonly GoalWorkspaceContextFile[], surfaceFiles: readonly GoalWorkspaceContextFile[]): GoalSurfaceContextSummary {
	const parts = [...globalFiles, ...surfaceFiles]
		.map(file => `${file.relativePath}: ${file.summary}`)
		.filter(part => part.trim().length > 0);

	return {
		surfaceId: surface.id,
		surfaceName: surface.name,
		files: surfaceFiles,
		summary: parts.join('\n')
	};
}

function summarizeAgentContextMarkdown(content: string): string {
	const lines = content.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0);

	const heading = lines.find(line => line.startsWith('#'))?.replace(/^#+\s*/, '').trim();
	if (heading) {
		return heading;
	}

	const firstContentLine = lines.find(line => !line.startsWith('<!--'));
	if (!firstContentLine) {
		return '';
	}

	return firstContentLine.length > 160 ? `${firstContentLine.slice(0, 157)}...` : firstContentLine;
}

function parseSurface(raw: unknown, index: number, diagnostics: GoalWorkspaceDiagnostic[]): GoalWorkspaceSurface | undefined {
	const basePath = `$.surfaces[${index}]`;
	if (!isRecord(raw)) {
		diagnostics.push({ path: basePath, message: 'Surface must be an object.' });
		return undefined;
	}

	const id = requiredString(raw, 'id', `${basePath}.id`, diagnostics);
	const name = requiredString(raw, 'name', `${basePath}.name`, diagnostics);
	if (!id || !name) {
		return undefined;
	}
	const ix = parseSurfaceIxMetadata(raw.ix, `${basePath}.ix`, diagnostics);
	const legacyIxSubsystems = optionalStringArray(raw, 'ixSubsystems', `${basePath}.ixSubsystems`, diagnostics);

	return {
		id,
		name,
		type: optionalString(raw, 'type', `${basePath}.type`, diagnostics),
		path: optionalString(raw, 'path', `${basePath}.path`, diagnostics),
		devCommand: optionalString(raw, 'devCommand', `${basePath}.devCommand`, diagnostics),
		localUrl: optionalString(raw, 'localUrl', `${basePath}.localUrl`, diagnostics),
		purpose: optionalString(raw, 'purpose', `${basePath}.purpose`, diagnostics),
		capabilities: optionalStringArray(raw, 'capabilities', `${basePath}.capabilities`, diagnostics),
		events: optionalStringArray(raw, 'events', `${basePath}.events`, diagnostics),
		entities: optionalStringArray(raw, 'entities', `${basePath}.entities`, diagnostics),
		ixSubsystems: uniqueStrings([...legacyIxSubsystems, ...(ix?.subsystemLabels ?? [])]),
		ix
	};
}

function parseSurfaceIxMetadata(raw: unknown, path: string, diagnostics: GoalWorkspaceDiagnostic[]): GoalSurfaceIxMetadata | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!isRecord(raw)) {
		diagnostics.push({ path, message: 'Ix metadata must be an object.' });
		return undefined;
	}

	const subsystemLabels = uniqueStrings([
		...optionalStringArray(raw, 'subsystems', `${path}.subsystems`, diagnostics),
		...optionalStringArray(raw, 'subsystemLabels', `${path}.subsystemLabels`, diagnostics),
	]);
	const subsystemIds = optionalStringArray(raw, 'subsystemIds', `${path}.subsystemIds`, diagnostics);
	const tags = optionalStringArray(raw, 'tags', `${path}.tags`, diagnostics);
	const notes = optionalString(raw, 'notes', `${path}.notes`, diagnostics);
	return {
		subsystemIds,
		subsystemLabels,
		tags,
		notes
	};
}

function parseShared(raw: unknown, diagnostics: GoalWorkspaceDiagnostic[]): GoalWorkspaceShared {
	if (raw === undefined) {
		return EMPTY_SHARED;
	}
	if (!isRecord(raw)) {
		diagnostics.push({ path: '$.shared', message: 'Shared must be an object.' });
		return EMPTY_SHARED;
	}
	return {
		domain: optionalString(raw, 'domain', '$.shared.domain', diagnostics),
		events: optionalString(raw, 'events', '$.shared.events', diagnostics),
		ui: optionalString(raw, 'ui', '$.shared.ui', diagnostics),
		auth: optionalString(raw, 'auth', '$.shared.auth', diagnostics),
		workflows: optionalString(raw, 'workflows', '$.shared.workflows', diagnostics)
	};
}

function invalidState(workspaceFolder: URI, manifestResource: URI, diagnostics: readonly GoalWorkspaceDiagnostic[]): GoalWorkspaceState {
	return {
		status: 'invalid',
		workspaceFolder,
		manifestResource,
		workspace: undefined,
		context: createEmptyAgentContext(workspaceFolder),
		ix: createEmptyIxState(workspaceFolder),
		diagnostics
	};
}

function requiredString(raw: Record<string, unknown>, key: string, path: string, diagnostics: GoalWorkspaceDiagnostic[]): string {
	const value = raw[key];
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}
	diagnostics.push({ path, message: 'Expected a non-empty string.' });
	return '';
}

function optionalString(raw: Record<string, unknown>, key: string, path: string, diagnostics: GoalWorkspaceDiagnostic[]): string | undefined {
	const value = raw[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	diagnostics.push({ path, message: 'Expected a string.' });
	return undefined;
}

function optionalStringArray(raw: Record<string, unknown>, key: string, path: string, diagnostics: GoalWorkspaceDiagnostic[]): readonly string[] {
	const value = raw[key];
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		diagnostics.push({ path, message: 'Expected an array of strings.' });
		return [];
	}

	const result: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		if (typeof item === 'string' && item.trim().length > 0) {
			result.push(item.trim());
		} else {
			diagnostics.push({ path: `${path}[${i}]`, message: 'Expected a non-empty string.' });
		}
	}
	return result;
}

function optionalStringValue(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function stringArrayValue(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return uniqueStrings(value.map(optionalStringValue).filter((item): item is string => Boolean(item)));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		const key = trimmed.toLowerCase();
		if (!trimmed || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

function normalizeIxMatchText(value: string): string {
	return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeExists(fileService: IFileService, resource: URI): Promise<boolean> {
	try {
		return await fileService.exists(resource);
	} catch {
		return false;
	}
}

registerSingleton(IGoalWorkspaceService, GoalWorkspaceService, InstantiationType.Delayed);

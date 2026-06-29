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
}

export type GoalSurface = GoalWorkspaceSurface;

export interface GoalWorkspaceShared {
	readonly domain?: string;
	readonly events?: string;
	readonly ui?: string;
	readonly auth?: string;
	readonly workflows?: string;
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
	refresh(): Promise<GoalWorkspaceState>;
}

export const IGoalWorkspaceService = createDecorator<IGoalWorkspaceService>('goalWorkspaceService');

const EMPTY_SHARED: GoalWorkspaceShared = {};

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
			if (manifestResource && e.contains(manifestResource, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
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

	async refresh(): Promise<GoalWorkspaceState> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			return this.setState(createNoWorkspaceGoalWorkspaceState());
		}

		const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);
		if (!(await this.fileService.exists(manifestResource))) {
			return this.setState(createMissingGoalWorkspaceState(workspaceFolder, manifestResource));
		}

		try {
			const content = (await this.fileService.readFile(manifestResource)).value.toString();
			const parsed = parseGoalWorkspaceManifestText(content, workspaceFolder, manifestResource);
			return this.setState(parsed);
		} catch (e: unknown) {
			return this.setState({
				status: 'invalid',
				workspaceFolder,
				manifestResource,
				workspace: undefined,
				diagnostics: [{ path: '$', message: `Failed to read ${GOAL_WORKSPACE_MANIFEST}: ${String((e as Error)?.message ?? e)}` }]
			});
		}
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
		diagnostics: []
	};
}

export function createMissingGoalWorkspaceState(workspaceFolder: URI, manifestResource: URI): GoalWorkspaceState {
	return {
		status: 'missing',
		workspaceFolder,
		manifestResource,
		workspace: undefined,
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
		diagnostics: []
	};
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
		ixSubsystems: optionalStringArray(raw, 'ixSubsystems', `${basePath}.ixSubsystems`, diagnostics)
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

registerSingleton(IGoalWorkspaceService, GoalWorkspaceService, InstantiationType.Delayed);

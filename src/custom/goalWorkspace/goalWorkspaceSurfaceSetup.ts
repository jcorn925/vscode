/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import type { WorkspaceBrand, WorkspaceShared } from './ConsoleService.js';
import { AGENT_CONTEXT_FOLDER, WORKSPACE_MANIFEST } from './ConsoleService.js';
import {
	surfaceGraphProposalDraftResource,
	surfaceGraphProposalResource,
	surfacePlanResource,
} from './surfacePlanPaths.js';

export const GOAL_WORKSPACE_BUILDER_DRAFT_FILE = 'builder-draft.json';
export const GOAL_WORKSPACE_BRAND_SUBFOLDER = 'brand';

export type SurfaceSetupStep = 'goal' | 'brand' | 'surfaces';

export const SURFACE_SETUP_STEPS: readonly SurfaceSetupStep[] = ['goal', 'brand', 'surfaces'];

export interface SurfaceSetupDraft {
	readonly version: 1;
	currentStep: SurfaceSetupStep;
	savedAt?: string;
}

export interface GoalWorkspaceBuilderInput {
	readonly name: string;
	readonly description: string;
	readonly brand: WorkspaceBrandInput;
}

export interface ImportedGoalWorkspaceSurfaceInput {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly relativePath: string;
	readonly devCommand?: string;
	readonly localUrl?: string;
	readonly purpose?: string;
}

export interface WorkspaceBrandInput {
	readonly primaryColor?: string;
	readonly secondaryColor?: string;
	readonly accentColor?: string;
	readonly logoPath?: string;
	readonly logoMarkPath?: string;
}

export function brandFolderResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_BRAND_SUBFOLDER);
}

export function builderDraftResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_BUILDER_DRAFT_FILE);
}

export function hasBrandConfigured(brand: WorkspaceBrand | WorkspaceBrandInput | undefined): boolean {
	if (!brand) {
		return false;
	}
	return Boolean(
		brand.primaryColor?.trim()
		|| brand.secondaryColor?.trim()
		|| brand.accentColor?.trim()
		|| brand.logoPath?.trim()
		|| brand.logoMarkPath?.trim()
	);
}

export function inferSurfaceSetupStep(
	hasGoal: boolean,
	hasBrand: boolean,
	surfaceCount: number,
): SurfaceSetupStep {
	if (!hasGoal) {
		return 'goal';
	}
	if (!hasBrand) {
		return 'brand';
	}
	return 'surfaces';
}

function normalizeSurfaceSetupStep(step: string | undefined): SurfaceSetupStep | undefined {
	if (step === 'goal' || step === 'brand' || step === 'surfaces') {
		return step;
	}
	if (step === 'context') {
		return 'brand';
	}
	if (step === 'generate') {
		return 'surfaces';
	}
	return undefined;
}

export function parseSurfaceSetupDraft(raw: string): SurfaceSetupDraft | undefined {
	try {
		const parsed = JSON.parse(raw) as Partial<SurfaceSetupDraft & { agentNotes?: string }>;
		if (parsed.version !== 1) {
			return undefined;
		}
		const step = normalizeSurfaceSetupStep(parsed.currentStep);
		if (!step) {
			return undefined;
		}
		return {
			version: 1,
			currentStep: step,
			savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : undefined,
		};
	} catch {
		return undefined;
	}
}

export async function loadSurfaceSetupDraft(fileService: IFileService, workspaceFolder: URI | undefined): Promise<SurfaceSetupDraft | undefined> {
	if (!workspaceFolder) {
		return undefined;
	}
	const resource = builderDraftResource(workspaceFolder);
	try {
		const content = await fileService.readFile(resource);
		return parseSurfaceSetupDraft(content.value.toString());
	} catch {
		return undefined;
	}
}

export async function saveSurfaceSetupDraft(
	fileService: IFileService,
	workspaceFolder: URI | undefined,
	draft: Omit<SurfaceSetupDraft, 'version' | 'savedAt'> & { savedAt?: string },
): Promise<SurfaceSetupDraft | undefined> {
	if (!workspaceFolder) {
		return undefined;
	}
	const resource = builderDraftResource(workspaceFolder);
	const payload: SurfaceSetupDraft = {
		version: 1,
		currentStep: draft.currentStep,
		savedAt: draft.savedAt ?? new Date().toISOString(),
	};
	await fileService.createFolder(joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER));
	await fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(payload, null, 2)));
	return payload;
}

function slugifyGoalId(name: string): string {
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return slug || 'business';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeWorkspaceRelativePath(path: string): string | undefined {
	const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
	if (!normalized || /^[a-zA-Z]:\//.test(normalized) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
		return undefined;
	}
	if (normalized.startsWith('/')) {
		return undefined;
	}
	const segments = normalized.split('/').filter(segment => segment.length > 0);
	if (segments.some(segment => segment === '.' || segment === '..')) {
		return undefined;
	}
	return segments.join('/');
}

function cleanBrandInput(brand: WorkspaceBrandInput): Record<string, string> {
	const payload: Record<string, string> = {};
	if (brand.primaryColor?.trim()) {
		payload.primaryColor = brand.primaryColor.trim();
	}
	if (brand.secondaryColor?.trim()) {
		payload.secondaryColor = brand.secondaryColor.trim();
	}
	if (brand.accentColor?.trim()) {
		payload.accentColor = brand.accentColor.trim();
	}
	if (brand.logoPath?.trim()) {
		payload.logoPath = brand.logoPath.trim();
	}
	if (brand.logoMarkPath?.trim()) {
		payload.logoMarkPath = brand.logoMarkPath.trim();
	}
	return payload;
}

const DEFAULT_SHARED_PATHS: WorkspaceShared = {
	domain: 'packages/domain',
	events: 'packages/events',
	ui: 'packages/ui',
	auth: 'packages/auth',
	workflows: 'workflows',
};

export async function saveGoalWorkspaceBuilderFields(
	fileService: IFileService,
	workspaceFolder: URI,
	input: GoalWorkspaceBuilderInput,
	existingGoalId?: string,
): Promise<void> {
	const manifestResource = joinPath(workspaceFolder, WORKSPACE_MANIFEST);
	let raw: Record<string, unknown> = {};
	try {
		const content = await fileService.readFile(manifestResource);
		raw = JSON.parse(content.value.toString()) as Record<string, unknown>;
		if (!isRecord(raw)) {
			raw = {};
		}
	} catch {
		raw = {};
	}

	const goalRaw = isRecord(raw.goal) ? raw.goal : {};
	const goalId = existingGoalId?.trim() || (typeof goalRaw.id === 'string' ? goalRaw.id : slugifyGoalId(input.name));
	const goal: Record<string, unknown> = {
		...goalRaw,
		id: goalId,
		name: input.name.trim(),
	};
	const description = input.description.trim();
	if (description) {
		goal.description = description;
	} else {
		delete goal.description;
	}

	const brand = cleanBrandInput(input.brand);
	raw.goal = goal;
	if (Object.keys(brand).length > 0) {
		raw.brand = brand;
	} else {
		delete raw.brand;
	}
	if (!Array.isArray(raw.surfaces)) {
		raw.surfaces = [];
	}
	if (!isRecord(raw.shared)) {
		raw.shared = { ...DEFAULT_SHARED_PATHS };
	}

	await fileService.writeFile(manifestResource, VSBuffer.fromString(JSON.stringify(raw, null, '\t')));
}

export async function upsertImportedGoalWorkspaceSurface(
	fileService: IFileService,
	workspaceFolder: URI,
	input: ImportedGoalWorkspaceSurfaceInput,
): Promise<boolean> {
	const surfaceId = input.surfaceId.trim();
	const surfaceName = input.surfaceName.trim();
	const relativePath = normalizeWorkspaceRelativePath(input.relativePath);
	if (!surfaceId || !surfaceName || !relativePath) {
		return false;
	}

	const manifestResource = joinPath(workspaceFolder, WORKSPACE_MANIFEST);
	let raw: Record<string, unknown> = {};
	try {
		const content = await fileService.readFile(manifestResource);
		raw = JSON.parse(content.value.toString()) as Record<string, unknown>;
		if (!isRecord(raw)) {
			raw = {};
		}
	} catch {
		raw = {};
	}

	if (!Array.isArray(raw.surfaces)) {
		raw.surfaces = [];
	}

	const rawSurfaces: unknown[] = Array.isArray(raw.surfaces) ? raw.surfaces : [];
	const surfaces: Record<string, unknown>[] = rawSurfaces.filter(isRecord);
	const existingIndex = surfaces.findIndex(surface => surface.id === surfaceId);
	const existing = existingIndex >= 0 ? surfaces[existingIndex]! : {};
	const surface: Record<string, unknown> = {
		...existing,
		id: surfaceId,
		name: surfaceName,
		type: typeof existing.type === 'string' && existing.type.trim() ? existing.type.trim() : 'web-app',
		path: relativePath,
		purpose: input.purpose?.trim() || (typeof existing.purpose === 'string' && existing.purpose.trim()
			? existing.purpose.trim()
			: `Imported app surface for ${surfaceName}.`),
		capabilities: Array.isArray(existing.capabilities) ? existing.capabilities : [],
		events: Array.isArray(existing.events) ? existing.events : [],
		entities: Array.isArray(existing.entities) ? existing.entities : [],
		ixSubsystems: Array.isArray(existing.ixSubsystems) ? existing.ixSubsystems : [],
	};
	if (input.devCommand?.trim()) {
		surface.devCommand = input.devCommand.trim();
	} else if (typeof existing.devCommand === 'string' && existing.devCommand.trim()) {
		surface.devCommand = existing.devCommand.trim();
	}
	if (input.localUrl?.trim()) {
		surface.localUrl = input.localUrl.trim();
	} else if (typeof existing.localUrl === 'string' && existing.localUrl.trim()) {
		surface.localUrl = existing.localUrl.trim();
	}

	if (existingIndex >= 0) {
		surfaces[existingIndex] = surface;
	} else {
		surfaces.push(surface);
	}
	raw.surfaces = surfaces;
	await fileService.writeFile(manifestResource, VSBuffer.fromString(JSON.stringify(raw, null, '\t')));
	return true;
}

export async function deleteGoalWorkspaceSurface(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
): Promise<boolean> {
	const id = surfaceId.trim();
	if (!id) {
		return false;
	}

	const manifestResource = joinPath(workspaceFolder, WORKSPACE_MANIFEST);
	let raw: Record<string, unknown> = {};
	try {
		const content = await fileService.readFile(manifestResource);
		raw = JSON.parse(content.value.toString()) as Record<string, unknown>;
		if (!isRecord(raw)) {
			return false;
		}
	} catch {
		return false;
	}

	if (!Array.isArray(raw.surfaces)) {
		return false;
	}

	const existing = raw.surfaces.find(surface => isRecord(surface) && surface.id === id);
	const nextSurfaces = raw.surfaces.filter(surface => {
		if (!isRecord(surface)) {
			return true;
		}
		return surface.id !== id;
	});
	if (nextSurfaces.length === raw.surfaces.length) {
		return false;
	}

	raw.surfaces = nextSurfaces;
	await fileService.writeFile(manifestResource, VSBuffer.fromString(JSON.stringify(raw, null, '\t')));

	// Drop planning/verification artifacts so delete does not leave orphan plans.
	const artifactResources: URI[] = [
		surfacePlanResource(workspaceFolder, id),
		joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, 'surfaces', `${id}.blueprint.json`),
		joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, 'surfaces', `${id}.memory.md`),
		surfaceGraphProposalResource(workspaceFolder, id),
		surfaceGraphProposalDraftResource(workspaceFolder, id),
	];
	for (const resource of artifactResources) {
		try {
			await fileService.del(resource);
		} catch {
			// Missing artifacts are fine — surface may never have reached plan/proposal.
		}
	}

	const appPath = isRecord(existing) && typeof existing.path === 'string'
		? existing.path.trim().replace(/^\/+|\/+$/g, '')
		: `apps/${id}`;
	if (appPath && !appPath.includes('..') && !appPath.startsWith('/')) {
		try {
			await fileService.del(joinPath(workspaceFolder, ...appPath.split('/')), { recursive: true });
		} catch {
			// App folder may not exist yet (plan-only surfaces).
		}
	}

	return true;
}

export function nextSurfaceSetupStep(step: SurfaceSetupStep): SurfaceSetupStep {
	const index = SURFACE_SETUP_STEPS.indexOf(step);
	return SURFACE_SETUP_STEPS[Math.min(index + 1, SURFACE_SETUP_STEPS.length - 1)];
}

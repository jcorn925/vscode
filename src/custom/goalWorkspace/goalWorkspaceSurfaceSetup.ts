/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import type { GoalWorkspaceBrand, GoalWorkspaceShared } from './GoalWorkspaceService.js';
import { GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_MANIFEST } from './GoalWorkspaceService.js';

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
	readonly brand: GoalWorkspaceBrandInput;
}

export interface GoalWorkspaceBrandInput {
	readonly primaryColor?: string;
	readonly secondaryColor?: string;
	readonly accentColor?: string;
	readonly logoPath?: string;
	readonly logoMarkPath?: string;
}

export function brandFolderResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_BRAND_SUBFOLDER);
}

export function builderDraftResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_BUILDER_DRAFT_FILE);
}

export function hasBrandConfigured(brand: GoalWorkspaceBrand | GoalWorkspaceBrandInput | undefined): boolean {
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
	await fileService.createFolder(joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER));
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

function cleanBrandInput(brand: GoalWorkspaceBrandInput): Record<string, string> {
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

const DEFAULT_SHARED_PATHS: GoalWorkspaceShared = {
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
	const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);
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

export function nextSurfaceSetupStep(step: SurfaceSetupStep): SurfaceSetupStep {
	const index = SURFACE_SETUP_STEPS.indexOf(step);
	return SURFACE_SETUP_STEPS[Math.min(index + 1, SURFACE_SETUP_STEPS.length - 1)];
}

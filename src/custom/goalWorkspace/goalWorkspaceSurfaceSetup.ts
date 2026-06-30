/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { Codicon } from '../../vs/base/common/codicons.js';
import { ThemeIcon } from '../../vs/base/common/themables.js';
import type { GoalWorkspace, GoalWorkspaceShared } from './GoalWorkspaceService.js';
import { GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER } from './GoalWorkspaceService.js';

export const GOAL_WORKSPACE_BUILDER_DRAFT_FILE = 'builder-draft.json';
export const GOAL_WORKSPACE_CONTEXT_SUBFOLDER = 'context';

export type SurfaceSetupStep = 'goal' | 'context' | 'surfaces' | 'generate';

export type SurfaceSetupContextStatus = 'complete' | 'progress' | 'not-started';

export interface SurfaceSetupContextTopic {
	readonly id: string;
	readonly titleKey: string;
	readonly promptKey: string;
	readonly icon: ThemeIcon;
	readonly fileName: string;
}

export const SURFACE_SETUP_CONTEXT_TOPICS: readonly SurfaceSetupContextTopic[] = [
	{ id: 'customer-pain', titleKey: 'customer', promptKey: 'customer', icon: Codicon.person, fileName: 'customer-pain.md' },
	{ id: 'offers-pricing', titleKey: 'offers', promptKey: 'offers', icon: Codicon.tag, fileName: 'offers-pricing.md' },
	{ id: 'booking-flow', titleKey: 'booking', promptKey: 'booking', icon: Codicon.calendar, fileName: 'booking-flow.md' },
	{ id: 'payments', titleKey: 'payments', promptKey: 'payments', icon: Codicon.creditCard, fileName: 'payments.md' },
	{ id: 'acquisition', titleKey: 'acquisition', promptKey: 'acquisition', icon: Codicon.megaphone, fileName: 'acquisition.md' },
	{ id: 'analytics', titleKey: 'analytics', promptKey: 'analytics', icon: Codicon.graphLine, fileName: 'analytics.md' },
] as const;

export const SURFACE_SETUP_STEPS: readonly SurfaceSetupStep[] = ['goal', 'context', 'surfaces', 'generate'];

export interface SurfaceSetupDraft {
	readonly version: 1;
	currentStep: SurfaceSetupStep;
	agentNotes: string;
	savedAt?: string;
}

export function contextTopicResource(workspaceFolder: URI, topic: SurfaceSetupContextTopic): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_CONTEXT_SUBFOLDER, topic.fileName);
}

export function builderDraftResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_BUILDER_DRAFT_FILE);
}

export function resolveContextTopicStatus(content: string | undefined): SurfaceSetupContextStatus {
	const trimmed = content?.trim() ?? '';
	if (trimmed.length >= 80) {
		return 'complete';
	}
	if (trimmed.length > 0) {
		return 'progress';
	}
	return 'not-started';
}

export function inferSurfaceSetupStep(
	hasGoal: boolean,
	contextStatuses: readonly SurfaceSetupContextStatus[],
	surfaceCount: number,
): SurfaceSetupStep {
	if (!hasGoal) {
		return 'goal';
	}
	if (contextStatuses.some(status => status !== 'complete')) {
		return 'context';
	}
	if (surfaceCount === 0) {
		return 'surfaces';
	}
	return 'generate';
}

export function parseSurfaceSetupDraft(raw: string): SurfaceSetupDraft | undefined {
	try {
		const parsed = JSON.parse(raw) as Partial<SurfaceSetupDraft>;
		if (parsed.version !== 1) {
			return undefined;
		}
		const step = parsed.currentStep;
		if (step !== 'goal' && step !== 'context' && step !== 'surfaces' && step !== 'generate') {
			return undefined;
		}
		return {
			version: 1,
			currentStep: step,
			agentNotes: typeof parsed.agentNotes === 'string' ? parsed.agentNotes : '',
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
		agentNotes: draft.agentNotes,
		savedAt: draft.savedAt ?? new Date().toISOString(),
	};
	await fileService.createFolder(joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER));
	await fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(payload, null, 2)));
	return payload;
}

export async function loadContextTopicContents(
	fileService: IFileService,
	workspaceFolder: URI | undefined,
): Promise<Map<string, string>> {
	const contents = new Map<string, string>();
	if (!workspaceFolder) {
		return contents;
	}
	await Promise.all(SURFACE_SETUP_CONTEXT_TOPICS.map(async topic => {
		try {
			const file = await fileService.readFile(contextTopicResource(workspaceFolder, topic));
			contents.set(topic.id, file.value.toString());
		} catch {
			contents.set(topic.id, '');
		}
	}));
	return contents;
}

export interface SurfaceSetupAgentPlanGroup {
	readonly title: string;
	readonly ready: boolean;
	readonly items: readonly { readonly icon: string; readonly name: string; readonly description: string }[];
}

export function buildSurfaceSetupAgentPlan(
	workspace: GoalWorkspace | undefined,
	contextStatuses: readonly SurfaceSetupContextStatus[],
): readonly SurfaceSetupAgentPlanGroup[] {
	const shared = workspace?.shared ?? {};
	const surfaces = workspace?.surfaces ?? [];
	const contextReady = contextStatuses.every(status => status === 'complete');
	const groups: SurfaceSetupAgentPlanGroup[] = [
		{
			title: 'Workspace definition',
			ready: Boolean(workspace?.goal?.name),
			items: [{
				icon: '[]',
				name: 'workspace.goal.json',
				description: workspace?.goal?.northStarMetric
					? `Goal, metric (${workspace.goal.northStarMetric}), and context summary`
					: 'Goal, metric, and context summary',
			}],
		},
		{
			title: 'Applications (apps/)',
			ready: surfaces.length > 0,
			items: surfaces.length > 0
				? surfaces.map(surface => ({
					icon: '<>',
					name: surface.path ?? `apps/${surface.id}`,
					description: surface.purpose ?? surface.name,
				}))
				: [{
					icon: '<>',
					name: 'apps/*',
					description: 'Surfaces you choose or generate from starter suggestions',
				}],
		},
		{
			title: 'Shared domain',
			ready: hasSharedPaths(shared),
			items: buildSharedPlanItems(shared),
		},
		{
			title: 'Ix metadata',
			ready: surfaces.some(surface => Boolean(surface.ixSubsystems.length || surface.ix)),
			items: [{
				icon: '//',
				name: '.agent/ix-surface-map.json',
				description: 'Code-level understanding and surface map',
			}],
		},
	];
	void contextReady;
	return groups;
}

function hasSharedPaths(shared: GoalWorkspaceShared): boolean {
	return Boolean(shared.domain || shared.events || shared.ui || shared.auth || shared.workflows);
}

function buildSharedPlanItems(shared: GoalWorkspaceShared): { icon: string; name: string; description: string }[] {
	const items: { icon: string; name: string; description: string }[] = [];
	if (shared.domain) {
		items.push({ icon: '{}', name: shared.domain, description: 'Core entities and types' });
	}
	if (shared.events) {
		items.push({ icon: '{}', name: shared.events, description: 'Domain events' });
	}
	if (shared.workflows) {
		items.push({ icon: '{}', name: shared.workflows, description: 'Processes and automations' });
	}
	if (shared.ui) {
		items.push({ icon: '{}', name: shared.ui, description: 'Shared UI primitives' });
	}
	if (shared.auth) {
		items.push({ icon: '{}', name: shared.auth, description: 'Authentication and identity' });
	}
	if (items.length === 0) {
		items.push(
			{ icon: '{}', name: 'domain/', description: 'Core entities and types' },
			{ icon: '{}', name: 'events/', description: 'Domain events' },
			{ icon: '{}', name: 'workflows/', description: 'Processes and automations' },
		);
	}
	return items;
}

export function surfacePlanReadyLabel(ready: boolean): string {
	return ready ? 'Ready' : 'Pending';
}

export function nextSurfaceSetupStep(step: SurfaceSetupStep): SurfaceSetupStep {
	const index = SURFACE_SETUP_STEPS.indexOf(step);
	return SURFACE_SETUP_STEPS[Math.min(index + 1, SURFACE_SETUP_STEPS.length - 1)];
}

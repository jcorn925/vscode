/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';
import { graphProposalResource } from '../agentTaskTree/agentTaskTreeGraphProposal.js';
import { taskTreesFolder } from '../agentTaskTree/agentTaskTreeService.js';
import {
	completedStepIdsFromWorkflow,
	parseSurfacePlanWorkflowDocument,
	surfacePlanWorkflowResource,
	type SurfacePlanWorkflowDocument,
} from './surfacePlanWorkflow.js';
import {
	failedPhaseStepIdFromProgress,
	parseSurfacePhaseProgress,
	phaseInFlightStepIdFromProgress,
	surfacePhaseProgressResource,
	type SurfacePhaseProgressDocument,
} from './surfacePhaseProgress.js';
import {
	loadAndProbeSurfaceBlockers,
	openBlockerStepRefs,
} from './surfaceBlockers.js';
import {
	isSurfacePlanLocked,
	isSurfacePreviewWired,
	resolveSurfacePlanWorkflowStatus,
	type SurfacePlanWorkflowAction,
	type SurfacePlanWorkflowPhaseRef,
} from './surfacePlanWorkflowStatus.js';
import {
	resolveSurfacePlanResource,
	surfaceGraphProposalDraftResource,
} from './surfacePlanPaths.js';
import {
	parseSurfaceReferenceCandidates,
	surfaceReferenceCandidatesResource,
} from './surfaceReferenceCandidates.js';

export interface SurfacePendingPlanProbe {
	readonly nextAction?: SurfacePlanWorkflowAction;
	/**
	 * Human-facing attention label for pending Next CTA or an in-flight phase.
	 * Prefer this for Surface / Steps chip dots — covers both pending and in-progress.
	 */
	readonly attentionLabel?: string;
	/** Max associated step activity time (ms since epoch), or 0 when none. */
	readonly activityMs: number;
}

/**
 * Max timestamp among workflow.updatedAt, step completedAt, and phase-progress.updatedAt.
 * Invalid / missing timestamps are ignored; returns 0 when nothing usable exists.
 */
export function surfaceAssociatedStepActivityMs(
	workflow?: SurfacePlanWorkflowDocument,
	progress?: SurfacePhaseProgressDocument,
): number {
	let max = 0;
	const consider = (value: string | undefined): void => {
		if (!value) {
			return;
		}
		const ms = Date.parse(value);
		if (Number.isFinite(ms) && ms > max) {
			max = ms;
		}
	};
	consider(workflow?.updatedAt);
	for (const step of workflow?.steps ?? []) {
		consider(step.completedAt);
	}
	consider(progress?.updatedAt);
	return max;
}

/**
 * True when the Plan Steps rail would show a human Next CTA for this surface
 * (Start planning / Confirm repos / Lock & build / next phase / Enable Preview / blockers).
 *
 * Reuses the same signals as `resolveSurfacePlanWorkflowStatus` — the open Plan
 * panel already computes this; surface cards need a lightweight file-backed probe.
 */
export async function resolveSurfacePendingPlanAction(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	options?: {
		readonly surfacePath?: string;
		readonly surfaceConfirmed?: boolean;
		readonly localUrl?: string;
		readonly devCommand?: string;
		readonly previewEnabled?: boolean;
	},
): Promise<SurfacePendingPlanProbe> {
	const id = surfaceId.trim();
	if (!id) {
		return { activityMs: 0 };
	}

	const [planMarkdown, candidates, hasDraftProposal, proposal, workflowRaw, progressRaw, blockers] = await Promise.all([
		readPlanMarkdown(fileService, workspaceFolder, id, options?.surfacePath),
		readCandidates(fileService, workspaceFolder, id),
		fileService.exists(surfaceGraphProposalDraftResource(workspaceFolder, id)).catch(() => false),
		readProposalPhases(fileService, workspaceFolder, id),
		readOptionalText(fileService, surfacePlanWorkflowResource(workspaceFolder, id)),
		readOptionalText(fileService, surfacePhaseProgressResource(workspaceFolder, id)),
		loadAndProbeSurfaceBlockers(fileService, workspaceFolder, id, options?.surfacePath, { persist: false }),
	]);

	const workflow = workflowRaw
		? parseSurfacePlanWorkflowDocument(workflowRaw, id)
		: undefined;
	const progress = progressRaw
		? parseSurfacePhaseProgress(progressRaw, id)
		: undefined;
	const phaseInFlightStepId = phaseInFlightStepIdFromProgress(progress);
	const status = resolveSurfacePlanWorkflowStatus({
		surfaceConfirmed: options?.surfaceConfirmed ?? true,
		hasPlanContent: Boolean(planMarkdown?.trim()),
		hasCandidates: Boolean(candidates?.repos.length),
		candidatesStatus: candidates?.status,
		hasDraftProposal,
		hasFinalProposal: Boolean(proposal),
		planLocked: isSurfacePlanLocked(planMarkdown),
		proposalPhases: proposal?.phases ?? [],
		completedStepIds: completedStepIdsFromWorkflow(workflow),
		phaseInFlightStepId,
		failedPhaseStepId: failedPhaseStepIdFromProgress(progress),
		previewEnabled: options?.previewEnabled ?? isSurfacePreviewWired({
			localUrl: options?.localUrl,
			devCommand: options?.devCommand,
		}),
		openBlockers: openBlockerStepRefs(blockers),
	});
	const inProgressLabel = phaseInFlightStepId
		? (progress?.stepLabel?.trim() || phaseInFlightStepId)
		: undefined;
	return {
		nextAction: status.nextAction,
		attentionLabel: status.nextAction?.label ?? inProgressLabel,
		activityMs: surfaceAssociatedStepActivityMs(workflow, progress),
	};
}

async function readPlanMarkdown(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	surfacePath?: string,
): Promise<string | undefined> {
	const resource = await resolveSurfacePlanResource(fileService, workspaceFolder, surfaceId, surfacePath);
	if (!resource) {
		return undefined;
	}
	return readOptionalText(fileService, resource);
}

async function readCandidates(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
) {
	const raw = await readOptionalText(fileService, surfaceReferenceCandidatesResource(workspaceFolder, surfaceId));
	if (!raw) {
		return undefined;
	}
	return parseSurfaceReferenceCandidates(raw, surfaceId);
}

async function readProposalPhases(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
): Promise<{ phases: SurfacePlanWorkflowPhaseRef[] } | undefined> {
	const resource = graphProposalResource(taskTreesFolder(workspaceFolder), surfaceId);
	const raw = await readOptionalText(fileService, resource);
	if (!raw) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as { phases?: unknown };
		const phases: SurfacePlanWorkflowPhaseRef[] = [];
		if (Array.isArray(parsed.phases)) {
			for (const phase of parsed.phases) {
				if (!phase || typeof phase !== 'object') {
					continue;
				}
				const record = phase as Record<string, unknown>;
				const id = typeof record.id === 'string' ? record.id.trim() : '';
				const title = typeof record.title === 'string' ? record.title.trim() : '';
				if (id && title) {
					phases.push({ id, title });
				}
			}
		}
		return { phases };
	} catch {
		return undefined;
	}
}

async function readOptionalText(fileService: IFileService, resource: URI): Promise<string | undefined> {
	try {
		const content = await fileService.readFile(resource);
		return content.value.toString();
	} catch {
		return undefined;
	}
}

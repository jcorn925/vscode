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
} from './surfacePlanWorkflow.js';
import {
	failedPhaseStepIdFromProgress,
	parseSurfacePhaseProgress,
	phaseInFlightStepIdFromProgress,
	surfacePhaseProgressResource,
} from './surfacePhaseProgress.js';
import {
	isSurfacePlanLocked,
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

/**
 * True when the Plan Steps rail would show a human Next CTA for this surface
 * (Start planning / Confirm repos / Lock & build / next phase).
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
	},
): Promise<SurfacePlanWorkflowAction | undefined> {
	const id = surfaceId.trim();
	if (!id) {
		return undefined;
	}

	const [planMarkdown, candidates, hasDraftProposal, proposal, workflowRaw, progressRaw] = await Promise.all([
		readPlanMarkdown(fileService, workspaceFolder, id, options?.surfacePath),
		readCandidates(fileService, workspaceFolder, id),
		fileService.exists(surfaceGraphProposalDraftResource(workspaceFolder, id)).catch(() => false),
		readProposalPhases(fileService, workspaceFolder, id),
		readOptionalText(fileService, surfacePlanWorkflowResource(workspaceFolder, id)),
		readOptionalText(fileService, surfacePhaseProgressResource(workspaceFolder, id)),
	]);

	const workflow = workflowRaw
		? parseSurfacePlanWorkflowDocument(workflowRaw, id)
		: undefined;
	const progress = progressRaw
		? parseSurfacePhaseProgress(progressRaw, id)
		: undefined;
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
		phaseInFlightStepId: phaseInFlightStepIdFromProgress(progress),
		failedPhaseStepId: failedPhaseStepIdFromProgress(progress),
	});
	return status.nextAction;
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WorkspacePlanWorkflowStageId =
	| 'idle'
	| 'kickoff'
	| 'drafting_plan'
	| 'proposing_surfaces'
	| 'ready'
	| 'confirmed';

export type WorkspacePlanWorkflowStepStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface WorkspacePlanWorkflowSignals {
	/** Prompt is being sent to Claude (button "Starting…"). */
	readonly kickoffInFlight?: boolean;
	/** Kickoff succeeded; waiting on workspace artifacts. */
	readonly sessionActive: boolean;
	readonly hasWorkspacePlan: boolean;
	readonly hasSuggestedSurfaces: boolean;
	readonly suggestedStatus?: 'draft' | 'confirmed' | string;
}

export interface WorkspacePlanWorkflowStepState {
	readonly id: string;
	readonly label: string;
	readonly status: WorkspacePlanWorkflowStepStatus;
}

export interface WorkspacePlanWorkflowStatus {
	readonly stageId: WorkspacePlanWorkflowStageId;
	readonly steps: readonly WorkspacePlanWorkflowStepState[];
	readonly statusLabel: string;
}

const STAGES: readonly { readonly id: Exclude<WorkspacePlanWorkflowStageId, 'idle'>; readonly label: string }[] = [
	{ id: 'kickoff', label: 'Kick off workspace planning' },
	{ id: 'drafting_plan', label: 'Claude drafting workspace plan' },
	{ id: 'proposing_surfaces', label: 'Claude proposing surfaces' },
	{ id: 'ready', label: 'Review suggested surfaces' },
];

export function inferWorkspacePlanWorkflowStage(signals: WorkspacePlanWorkflowSignals): WorkspacePlanWorkflowStageId {
	if (signals.suggestedStatus === 'confirmed' && signals.hasSuggestedSurfaces) {
		return 'confirmed';
	}
	if (signals.hasSuggestedSurfaces) {
		return 'ready';
	}
	if (signals.kickoffInFlight && !signals.sessionActive) {
		return 'kickoff';
	}
	if (signals.sessionActive) {
		return signals.hasWorkspacePlan ? 'proposing_surfaces' : 'drafting_plan';
	}
	return 'idle';
}

export function resolveWorkspacePlanWorkflowStatus(signals: WorkspacePlanWorkflowSignals): WorkspacePlanWorkflowStatus {
	const stageId = inferWorkspacePlanWorkflowStage(signals);
	if (stageId === 'idle') {
		return {
			stageId,
			steps: STAGES.map(stage => ({ ...stage, status: 'pending' as const })),
			statusLabel: '',
		};
	}

	const currentIndex = stageId === 'confirmed'
		? STAGES.length
		: STAGES.findIndex(stage => stage.id === (stageId === 'ready' ? 'ready' : stageId));
	const activeIndex = currentIndex < 0 ? 0 : Math.min(currentIndex, STAGES.length - 1);

	const steps: WorkspacePlanWorkflowStepState[] = STAGES.map((stage, index) => {
		if (stageId === 'confirmed' || index < activeIndex) {
			return { ...stage, status: 'completed' };
		}
		if (index === activeIndex) {
			return { ...stage, status: stageId === 'ready' ? 'completed' : 'current' };
		}
		return { ...stage, status: 'pending' };
	});

	// When suggestions are ready (not confirmed), mark the review step as current.
	if (stageId === 'ready') {
		const review = steps[steps.length - 1];
		if (review) {
			steps[steps.length - 1] = { ...review, status: 'current' };
		}
	}

	const statusLabel = (() => {
		switch (stageId) {
			case 'kickoff':
				return 'Starting Claude…';
			case 'drafting_plan':
				return 'Claude is drafting .agent/workspace.plan.md…';
			case 'proposing_surfaces':
				return 'Claude is proposing surfaces…';
			case 'ready':
				return 'Workspace plan ready — review suggested surfaces below.';
			case 'confirmed':
				return 'Selected surfaces created from the workspace plan.';
			default:
				return '';
		}
	})();

	return { stageId, steps, statusLabel };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ConsoleWorkflowStageId =
	| 'idle'
	| 'planning'
	| 'review_surfaces'
	| 'create_surfaces'
	| 'building'
	| 'running';

export type ConsoleWorkflowStepStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface ConsoleWorkflowSignals {
	readonly kickoffInFlight?: boolean;
	readonly sessionActive?: boolean;
	readonly hasWorkspacePlan: boolean;
	readonly hasSuggestedSurfaces: boolean;
	readonly suggestedStatus?: 'draft' | 'confirmed' | string;
	readonly surfaceCount: number;
	/** At least one surface has a locked plan or active build phase. */
	readonly anySurfaceBuilding?: boolean;
	/** At least one surface plan is locked (post-review). */
	readonly anySurfacePlanLocked?: boolean;
	/** At least one surface finished its plan/build workflow (100% Complete). */
	readonly anySurfaceComplete?: boolean;
	/** At least one surface app/dev server is running. */
	readonly anySurfaceRunning?: boolean;
}

export interface ConsoleWorkflowStepState {
	readonly id: string;
	readonly label: string;
	readonly status: ConsoleWorkflowStepStatus;
}

export type ConsoleWorkflowActionId = 'start_apps';

export interface ConsoleWorkflowAction {
	readonly id: ConsoleWorkflowActionId;
	readonly label: string;
	/** Step id this action advances (the upcoming Apps running chip). */
	readonly stepId: string;
}

export interface ConsoleWorkflowStatus {
	readonly stageId: ConsoleWorkflowStageId;
	readonly steps: readonly ConsoleWorkflowStepState[];
	readonly nextAction: ConsoleWorkflowAction | undefined;
}

const STAGES: readonly { readonly id: Exclude<ConsoleWorkflowStageId, 'idle'>; readonly label: string }[] = [
	{ id: 'planning', label: 'Kick off workspace planning' },
	{ id: 'review_surfaces', label: 'Draft plan + propose surfaces' },
	{ id: 'create_surfaces', label: 'Review / create suggested surfaces' },
	{ id: 'building', label: 'Surface plans locked / building' },
	{ id: 'running', label: 'Apps running' },
];

export function inferConsoleWorkflowStage(signals: ConsoleWorkflowSignals): ConsoleWorkflowStageId {
	if (signals.anySurfaceRunning) {
		return 'running';
	}
	if (signals.anySurfaceBuilding || signals.anySurfacePlanLocked || signals.anySurfaceComplete) {
		return 'building';
	}
	if (signals.surfaceCount > 0 || signals.suggestedStatus === 'confirmed' || signals.hasSuggestedSurfaces) {
		return 'create_surfaces';
	}
	if (signals.hasWorkspacePlan) {
		return 'review_surfaces';
	}
	if (signals.kickoffInFlight || signals.sessionActive) {
		return 'planning';
	}
	return 'idle';
}

export function resolveConsoleWorkflowStatus(signals: ConsoleWorkflowSignals): ConsoleWorkflowStatus {
	const stageId = inferConsoleWorkflowStage(signals);

	if (stageId === 'idle') {
		return {
			stageId,
			steps: STAGES.map(stage => ({ ...stage, status: 'pending' as const })),
			nextAction: undefined,
		};
	}

	const activeIndex = Math.max(0, STAGES.findIndex(stage => stage.id === stageId));
	const steps: ConsoleWorkflowStepState[] = STAGES.map((stage, index) => {
		if (index < activeIndex) {
			return { ...stage, status: 'completed' };
		}
		if (index === activeIndex) {
			return { ...stage, status: 'current' };
		}
		return { ...stage, status: 'pending' };
	});

	return {
		stageId,
		steps,
		nextAction: resolveConsoleWorkflowNextAction(stageId, signals, steps),
	};
}

/**
 * When Apps running is still upcoming and surfaces exist, offer Start Apps on that chip
 * (same role as Surface Steps next-action on Enable Preview).
 */
export function resolveConsoleWorkflowNextAction(
	stageId: ConsoleWorkflowStageId,
	signals: ConsoleWorkflowSignals,
	steps: readonly ConsoleWorkflowStepState[],
): ConsoleWorkflowAction | undefined {
	if (stageId === 'idle' || stageId === 'running') {
		return undefined;
	}
	if (signals.surfaceCount <= 0) {
		return undefined;
	}
	// Only once build has started — too early during planning / surface creation.
	if (stageId !== 'building') {
		return undefined;
	}
	const running = steps.find(step => step.id === 'running');
	if (!running || running.status !== 'pending') {
		return undefined;
	}
	return {
		id: 'start_apps',
		label: 'Start Apps',
		stepId: 'running',
	};
}

export type ConsoleHomeSection = 'workspacePlan' | 'surfaces' | 'claudeMd' | 'howItWorks' | 'branding' | 'settings';

export function isConsoleHomeSection(value: string | undefined): value is ConsoleHomeSection {
	return value === 'workspacePlan'
		|| value === 'surfaces'
		|| value === 'claudeMd'
		|| value === 'howItWorks'
		|| value === 'branding'
		|| value === 'settings';
}

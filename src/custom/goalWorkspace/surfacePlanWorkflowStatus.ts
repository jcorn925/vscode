/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SurfaceReferenceCandidatesStatus } from './surfaceReferenceCandidates.js';

export type SurfacePlanWorkflowStageId =
	| 'confirm_surface'
	| 'intent'
	| 'research_survey'
	| 'awaiting_repo_selection'
	| 'research_map'
	| 'plan_ready'
	| 'plan_locked'
	| 'building'
	| 'complete';

export type SurfacePlanWorkflowActionId =
	| 'start_planning'
	| 'confirm_repos'
	| 'lock_plan'
	| 'run_next_phase';

export type SurfacePlanWorkflowStepStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface SurfacePlanWorkflowPhaseRef {
	readonly id: string;
	readonly title: string;
}

export interface SurfacePlanWorkflowSignals {
	/**
	 * The surface exists in workspace.goal.json. `false` shows the confirm step as
	 * current; `undefined` (legacy callers) treats confirmation as already done.
	 */
	readonly surfaceConfirmed?: boolean;
	readonly hasPlanContent: boolean;
	readonly candidatesStatus?: SurfaceReferenceCandidatesStatus;
	readonly hasCandidates: boolean;
	readonly hasDraftProposal: boolean;
	readonly hasFinalProposal: boolean;
	readonly planLocked?: boolean;
	readonly proposalPhases?: readonly SurfacePlanWorkflowPhaseRef[];
	readonly completedStepIds?: ReadonlySet<string> | readonly string[];
	/** Phase Claude is executing — suppress Next until phase-progress.json completes. */
	readonly phaseInFlightStepId?: string;
	/** Phase Claude marked failed — Next becomes Retry for the same step. */
	readonly failedPhaseStepId?: string;
}

export interface SurfacePlanWorkflowStep {
	readonly id: string;
	readonly label: string;
	readonly kind: 'stage' | 'action' | 'phase';
}

export interface SurfacePlanWorkflowStepState extends SurfacePlanWorkflowStep {
	readonly status: SurfacePlanWorkflowStepStatus;
	readonly completedAt?: string;
}

export interface SurfacePlanWorkflowAction {
	readonly id: SurfacePlanWorkflowActionId;
	readonly label: string;
	/** Step id this action advances (for durable recording). */
	readonly stepId: string;
}

export interface SurfacePlanWorkflowStatus {
	readonly stageId: SurfacePlanWorkflowStageId;
	readonly previous: string | undefined;
	readonly current: string;
	readonly next: string | undefined;
	readonly nextAction: SurfacePlanWorkflowAction | undefined;
	readonly steps: readonly SurfacePlanWorkflowStepState[];
}

const PLANNING_STAGES: readonly SurfacePlanWorkflowStep[] = [
	{ id: 'confirm_surface', label: 'Confirm surface', kind: 'stage' },
	{ id: 'intent', label: 'Describe what to build', kind: 'stage' },
	{ id: 'research_survey', label: 'Claude surveying reference repos', kind: 'stage' },
	{ id: 'awaiting_repo_selection', label: 'Select research context repos', kind: 'stage' },
	{ id: 'research_map', label: 'Claude cloning, mapping, and drafting', kind: 'stage' },
	{ id: 'plan_ready', label: 'Review plan and proposal', kind: 'stage' },
	{ id: 'lock_plan', label: 'Lock plan and start build', kind: 'action' },
];

export function isSurfacePlanLocked(planMarkdown: string | undefined): boolean {
	if (!planMarkdown) {
		return false;
	}
	// Prefer an explicit checked lock under §0; fall back to any "- [x] Locked" line.
	const section = /##\s*§?\s*0\s*Plan lock([\s\S]*?)(?=\n##\s|$)/i.exec(planMarkdown);
	const body = section?.[1] ?? planMarkdown;
	return /(^|\n)\s*-\s*\[[xX]\]\s*Locked\b/m.test(body);
}

export function markSurfacePlanLocked(planMarkdown: string): string {
	if (isSurfacePlanLocked(planMarkdown)) {
		return planMarkdown;
	}
	if (/(^|\n)\s*-\s*\[[ ]\]\s*Locked\b/m.test(planMarkdown)) {
		return planMarkdown.replace(/(^|\n)(\s*-\s*)\[[ ]\](\s*Locked\b)/m, '$1$2[x]$3');
	}
	// No checkbox yet — append under §0 if present, otherwise prepend a lock section.
	if (/##\s*§?\s*0\s*Plan lock/i.test(planMarkdown)) {
		return planMarkdown.replace(
			/(##\s*§?\s*0\s*Plan lock[^\n]*\n)/i,
			'$1- [x] Locked\n',
		);
	}
	return `# Plan\n\n## §0 Plan lock\n- [x] Locked\n\n${planMarkdown}`.trimStart();
}

export function inferSurfacePlanWorkflowStage(signals: SurfacePlanWorkflowSignals): SurfacePlanWorkflowStageId {
	const completed = toCompletedSet(signals.completedStepIds);
	const phases = signals.proposalPhases ?? [];
	if (signals.surfaceConfirmed === false && !completed.has('confirm_surface')) {
		return 'confirm_surface';
	}
	if (signals.planLocked && phases.length) {
		const allPhasesDone = phases.every(phase => completed.has(phase.id));
		if (allPhasesDone && completed.has('lock_plan')) {
			return 'complete';
		}
		return 'building';
	}
	if (signals.planLocked) {
		return 'plan_locked';
	}
	if (signals.hasFinalProposal && signals.hasPlanContent) {
		return 'plan_ready';
	}
	if (signals.candidatesStatus === 'awaiting_selection') {
		return 'awaiting_repo_selection';
	}
	if (
		signals.candidatesStatus === 'confirmed'
		|| signals.candidatesStatus === 'done'
		|| signals.hasDraftProposal
	) {
		return 'research_map';
	}
	if (signals.hasPlanContent || signals.hasCandidates) {
		return 'research_survey';
	}
	return 'intent';
}

export function buildSurfacePlanWorkflowSteps(signals: SurfacePlanWorkflowSignals): readonly SurfacePlanWorkflowStepState[] {
	const stageId = inferSurfacePlanWorkflowStage(signals);
	const completed = toCompletedSet(signals.completedStepIds);
	const phases = signals.proposalPhases ?? [];
	const sequence: SurfacePlanWorkflowStep[] = [
		...PLANNING_STAGES,
		...phases.map(phase => ({
			id: phase.id,
			label: phase.title,
			kind: 'phase' as const,
		})),
	];

	const currentStepId = resolveCurrentStepId(stageId, phases, completed);
	return sequence.map(step => {
		let status: SurfacePlanWorkflowStepStatus = 'pending';
		if (completed.has(step.id) || isStepImpliedComplete(step.id, stageId, phases, completed)) {
			status = 'completed';
		} else if (step.id === currentStepId) {
			status = 'current';
		}
		return {
			...step,
			status,
			completedAt: status === 'completed' ? undefined : undefined,
		};
	});
}

export function resolveSurfacePlanWorkflowStatus(signals: SurfacePlanWorkflowSignals): SurfacePlanWorkflowStatus {
	const stageId = inferSurfacePlanWorkflowStage(signals);
	const steps = buildSurfacePlanWorkflowSteps(signals);
	const currentStep = steps.find(step => step.status === 'current') ?? steps[0];
	const currentIndex = currentStep ? steps.findIndex(step => step.id === currentStep.id) : 0;
	const previous = currentIndex > 0 ? steps[currentIndex - 1] : undefined;
	const next = currentIndex >= 0 && currentIndex < steps.length - 1 ? steps[currentIndex + 1] : undefined;
	const nextAction = resolveNextAction(stageId, signals, steps);

	let currentLabel = currentStep?.label ?? PLANNING_STAGES[0]!.label;
	let previousLabel = previous?.label;
	let nextLabel = nextAction?.label ?? next?.label;
	if (stageId === 'building' || stageId === 'plan_locked') {
		currentLabel = 'Execute build phases';
		previousLabel = previousLabel ?? 'Lock plan and start build';
		const pendingPhase = steps.find(step => step.kind === 'phase' && step.status !== 'completed');
		nextLabel = nextAction?.label ?? pendingPhase?.label;
	} else if (stageId === 'complete') {
		currentLabel = 'Build complete';
		nextLabel = undefined;
	}

	return {
		stageId,
		previous: previousLabel,
		current: currentLabel,
		next: nextLabel,
		nextAction,
		steps,
	};
}

function resolveNextAction(
	stageId: SurfacePlanWorkflowStageId,
	signals: SurfacePlanWorkflowSignals,
	steps: readonly SurfacePlanWorkflowStepState[],
): SurfacePlanWorkflowAction | undefined {
	switch (stageId) {
		case 'confirm_surface':
			// Confirmation happens via the Console cards / manifest upsert, not a panel action.
			return undefined;
		case 'intent':
			return {
				id: 'start_planning',
				label: 'Start planning',
				stepId: 'intent',
			};
		case 'awaiting_repo_selection':
			return {
				id: 'confirm_repos',
				label: 'Confirm repos',
				stepId: 'awaiting_repo_selection',
			};
		case 'plan_ready':
			return {
				id: 'lock_plan',
				label: 'Lock & build',
				stepId: 'lock_plan',
			};
		case 'plan_locked':
		case 'building': {
			const inFlight = signals.phaseInFlightStepId?.trim();
			if (inFlight) {
				// Claude is still on this phase — no ready Next until progress completes.
				return undefined;
			}
			const failedId = signals.failedPhaseStepId?.trim();
			if (failedId) {
				const failedStep = steps.find(step => step.id === failedId && step.kind === 'phase');
				if (failedStep) {
					return {
						id: 'run_next_phase',
						label: failedStep.label,
						stepId: failedStep.id,
					};
				}
			}
			const nextPhase = steps.find(step => step.kind === 'phase' && step.status !== 'completed');
			if (!nextPhase) {
				return undefined;
			}
			return {
				id: 'run_next_phase',
				label: nextPhase.label,
				stepId: nextPhase.id,
			};
		}
		default:
			return signals.hasPlanContent ? undefined : {
				id: 'start_planning',
				label: 'Start planning',
				stepId: 'intent',
			};
	}
}

function resolveCurrentStepId(
	stageId: SurfacePlanWorkflowStageId,
	phases: readonly SurfacePlanWorkflowPhaseRef[],
	completed: ReadonlySet<string>,
): string {
	if (stageId === 'building' || stageId === 'plan_locked') {
		if (!completed.has('lock_plan')) {
			return 'lock_plan';
		}
		const nextPhase = phases.find(phase => !completed.has(phase.id));
		return nextPhase?.id ?? phases[phases.length - 1]?.id ?? 'lock_plan';
	}
	if (stageId === 'complete') {
		return phases[phases.length - 1]?.id ?? 'lock_plan';
	}
	if (stageId === 'plan_ready') {
		return 'plan_ready';
	}
	return stageId;
}

function isStepImpliedComplete(
	stepId: string,
	stageId: SurfacePlanWorkflowStageId,
	phases: readonly SurfacePlanWorkflowPhaseRef[],
	completed: ReadonlySet<string>,
): boolean {
	const stageOrder = PLANNING_STAGES.map(step => step.id);
	const stageIndex = stageOrder.indexOf(stepId);
	const currentIndex = stageOrder.indexOf(stageId === 'building' || stageId === 'plan_locked' || stageId === 'complete'
		? 'lock_plan'
		: stageId);
	if (stageIndex >= 0 && currentIndex >= 0 && stageIndex < currentIndex) {
		return true;
	}
	if (stepId === 'lock_plan' && (stageId === 'building' || stageId === 'plan_locked' || stageId === 'complete' || completed.has('lock_plan'))) {
		return stageId !== 'plan_ready';
	}
	if (stageId === 'complete' && phases.some(phase => phase.id === stepId)) {
		return true;
	}
	return false;
}

function toCompletedSet(value: ReadonlySet<string> | readonly string[] | undefined): Set<string> {
	if (!value) {
		return new Set();
	}
	if (value instanceof Set) {
		return value;
	}
	return new Set(value);
}

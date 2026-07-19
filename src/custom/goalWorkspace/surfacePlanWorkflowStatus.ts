/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SurfaceBlockerStepRef } from './surfaceBlockers.js';
import { isBlockerStepId } from './surfaceBlockers.js';
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
	| 'continue_research'
	| 'lock_plan'
	| 'run_next_phase';

export type SurfacePlanWorkflowStepStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface SurfacePlanWorkflowPhaseRef {
	readonly id: string;
	readonly title: string;
}

/** Console-owned gate: confirm the proposed/live code graph before Preview. */
export const VERIFY_GRAPH_STEP_ID = 'verify_graph';

/** Console-owned gate: wire Preview via localUrl + devCommand on the surface. */
export const ENABLE_PREVIEW_STEP_ID = 'enable_preview';

export function isSurfacePreviewWired(input: { readonly localUrl?: string; readonly devCommand?: string } | undefined): boolean {
	return Boolean(input?.localUrl?.trim() && input?.devCommand?.trim());
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
	/**
	 * Surface has both `localUrl` and `devCommand` in workspace.goal.json so the
	 * Console Preview pane can launch. Completes `enable_preview` only after
	 * lock + generate phases + Code Graph are done (never ahead of CURRENT phases).
	 */
	readonly previewEnabled?: boolean;
	/**
	 * Open operational blockers (env keys, agent-declared gaps) shown after Enable Preview.
	 * Step ids should already be `blocker:<id>`.
	 */
	readonly openBlockers?: readonly SurfaceBlockerStepRef[];
}

export interface SurfacePlanWorkflowStep {
	readonly id: string;
	readonly label: string;
	readonly kind: 'stage' | 'action' | 'phase' | 'blocker';
}

export const VERIFY_GRAPH_STEP: SurfacePlanWorkflowStep = {
	id: VERIFY_GRAPH_STEP_ID,
	label: 'Code Graph',
	kind: 'action',
};

export const ENABLE_PREVIEW_STEP: SurfacePlanWorkflowStep = {
	id: ENABLE_PREVIEW_STEP_ID,
	label: 'Enable Preview',
	kind: 'action',
};

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
	const completed = effectiveCompletedStepIds(signals);
	const phases = signals.proposalPhases ?? [];
	const hasOpenBlockers = (signals.openBlockers ?? []).length > 0;
	if (signals.surfaceConfirmed === false && !completed.has('confirm_surface')) {
		return 'confirm_surface';
	}
	if (signals.planLocked && phases.length) {
		const allPhasesDone = phases.every(phase => completed.has(phase.id));
		if (
			allPhasesDone
			&& completed.has('lock_plan')
			&& completed.has(VERIFY_GRAPH_STEP_ID)
			&& completed.has(ENABLE_PREVIEW_STEP_ID)
			&& !hasOpenBlockers
		) {
			return 'complete';
		}
		return 'building';
	}
	if (signals.planLocked) {
		if (completed.has('lock_plan') && (
			!completed.has(VERIFY_GRAPH_STEP_ID)
			|| !completed.has(ENABLE_PREVIEW_STEP_ID)
			|| hasOpenBlockers
		)) {
			return 'building';
		}
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
	const completed = effectiveCompletedStepIds(signals);
	const phases = signals.proposalPhases ?? [];
	const openBlockers = signals.openBlockers ?? [];
	const sequence: SurfacePlanWorkflowStep[] = [
		...PLANNING_STAGES,
		...phases.map(phase => ({
			id: phase.id,
			label: phase.title,
			kind: 'phase' as const,
		})),
		VERIFY_GRAPH_STEP,
		ENABLE_PREVIEW_STEP,
		...openBlockers.map(blocker => ({
			id: blocker.id,
			label: blocker.label,
			kind: 'blocker' as const,
		})),
	];

	const currentStepId = resolveCurrentStepId(stageId, phases, completed, openBlockers);
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

/** Compact completion summary for Console surface cards. */
export interface SurfacePlanWorkflowProgress {
	readonly completed: number;
	readonly total: number;
	readonly percent: number;
	readonly label: string;
	readonly stageId: SurfacePlanWorkflowStageId;
	readonly inProgress: boolean;
	readonly complete: boolean;
}

export function summarizeSurfacePlanWorkflowProgress(
	status: SurfacePlanWorkflowStatus,
	options?: { readonly inProgressLabel?: string },
): SurfacePlanWorkflowProgress {
	const total = status.steps.length;
	const completed = status.steps.filter(step => step.status === 'completed').length;
	const complete = status.stageId === 'complete';
	const inProgress = Boolean(options?.inProgressLabel?.trim());
	const percent = complete
		? 100
		: total === 0
			? 0
			: Math.min(99, Math.round((completed / total) * 100));
	const label = complete
		? 'Complete'
		: (options?.inProgressLabel?.trim()
			|| status.nextAction?.label
			|| status.current
			|| 'Not started');
	return {
		completed,
		total,
		percent,
		label,
		stageId: status.stageId,
		inProgress,
		complete,
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
		case 'research_survey':
			return {
				id: 'continue_research',
				label: 'Continue survey',
				stepId: 'research_survey',
			};
		case 'research_map':
			return {
				id: 'continue_research',
				label: 'Continue research',
				stepId: 'research_map',
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
				const failedStep = steps.find(step =>
					step.id === failedId
					&& (
						step.kind === 'phase'
						|| step.kind === 'blocker'
						|| step.id === VERIFY_GRAPH_STEP_ID
						|| step.id === ENABLE_PREVIEW_STEP_ID
					)
				);
				if (failedStep) {
					return {
						id: 'run_next_phase',
						label: failedStep.label,
						stepId: failedStep.id,
					};
				}
			}
			const nextPhase = steps.find(step => step.kind === 'phase' && step.status !== 'completed');
			if (nextPhase) {
				return {
					id: 'run_next_phase',
					label: nextPhase.label,
					stepId: nextPhase.id,
				};
			}
			const verifyGraph = steps.find(step => step.id === VERIFY_GRAPH_STEP_ID && step.status !== 'completed');
			if (verifyGraph) {
				return {
					id: 'run_next_phase',
					label: verifyGraph.label,
					stepId: verifyGraph.id,
				};
			}
			const enablePreview = steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID && step.status !== 'completed');
			if (enablePreview) {
				return {
					id: 'run_next_phase',
					label: enablePreview.label,
					stepId: enablePreview.id,
				};
			}
			const nextBlocker = steps.find(step => step.kind === 'blocker' && step.status !== 'completed');
			if (!nextBlocker) {
				return undefined;
			}
			return {
				id: 'run_next_phase',
				label: nextBlocker.label,
				stepId: nextBlocker.id,
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
	openBlockers: readonly SurfaceBlockerStepRef[],
): string {
	if (stageId === 'building' || stageId === 'plan_locked') {
		if (!completed.has('lock_plan')) {
			return 'lock_plan';
		}
		const nextPhase = phases.find(phase => !completed.has(phase.id));
		if (nextPhase) {
			return nextPhase.id;
		}
		if (!completed.has(VERIFY_GRAPH_STEP_ID)) {
			return VERIFY_GRAPH_STEP_ID;
		}
		if (!completed.has(ENABLE_PREVIEW_STEP_ID)) {
			return ENABLE_PREVIEW_STEP_ID;
		}
		if (openBlockers.length) {
			return openBlockers[0]!.id;
		}
		return phases[phases.length - 1]?.id ?? ENABLE_PREVIEW_STEP_ID;
	}
	if (stageId === 'complete') {
		return ENABLE_PREVIEW_STEP_ID;
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
	if (isBlockerStepId(stepId)) {
		// Open blockers stay pending/current; resolved ones are omitted from the sequence.
		return false;
	}
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
	if (stageId === 'complete' && (
		phases.some(phase => phase.id === stepId)
		|| stepId === VERIFY_GRAPH_STEP_ID
		|| stepId === ENABLE_PREVIEW_STEP_ID
	)) {
		return true;
	}
	return false;
}

function effectiveCompletedStepIds(signals: SurfacePlanWorkflowSignals): Set<string> {
	const completed = toCompletedSet(signals.completedStepIds);
	// Legacy workflows completed Enable Preview before Code Graph existed — do not
	// yank those surfaces back to verify_graph.
	if (completed.has(ENABLE_PREVIEW_STEP_ID) && !completed.has(VERIFY_GRAPH_STEP_ID)) {
		completed.add(VERIFY_GRAPH_STEP_ID);
	}
	// Preview wiring is often set during early scaffold phases. Do not mark Enable
	// Preview DONE until lock + phases + Code Graph ahead of it are complete —
	// otherwise the Steps rail shows DONE after CURRENT/UPCOMING phases.
	if (signals.previewEnabled && canAutoCompleteEnablePreview(signals, completed)) {
		completed.add(ENABLE_PREVIEW_STEP_ID);
	}
	return completed;
}

/** Enable Preview sits after Code Graph; only auto-complete once Graph is done. */
function canAutoCompleteEnablePreview(
	signals: SurfacePlanWorkflowSignals,
	completed: ReadonlySet<string>,
): boolean {
	if (!(signals.planLocked || completed.has('lock_plan'))) {
		return false;
	}
	const phases = signals.proposalPhases ?? [];
	if (!phases.every(phase => completed.has(phase.id))) {
		return false;
	}
	// Code Graph is a visible Next gate — do not skip past it when preview is already wired.
	return completed.has(VERIFY_GRAPH_STEP_ID);
}

function toCompletedSet(value: ReadonlySet<string> | readonly string[] | undefined): Set<string> {
	if (!value) {
		return new Set();
	}
	if (value instanceof Set) {
		return new Set(value);
	}
	return new Set(value);
}

/**
 * Map a Plan Steps row item to the surface card-rail section that should open.
 * Returns the first candidate present in `availableSectionIds`, or undefined.
 */
export function resolveSurfaceSectionIdForStep(
	step: { readonly id: string; readonly kind: SurfacePlanWorkflowStep['kind'] },
	availableSectionIds: ReadonlySet<string> | readonly string[],
): string | undefined {
	const available = availableSectionIds instanceof Set
		? availableSectionIds
		: new Set(availableSectionIds);
	const pick = (...candidates: readonly string[]): string | undefined => {
		const hit = candidates.find(id => available.has(id));
		if (hit) {
			return hit;
		}
		// Cards not published yet — return preferred id so callers can pending-select.
		return available.size === 0 ? candidates[0] : undefined;
	};

	if (step.kind === 'phase') {
		return pick('proposed', 'graph', 'phases', 'plan');
	}
	if (step.kind === 'blocker' || isBlockerStepId(step.id)) {
		return pick('preview', 'plan');
	}
	if (step.id === VERIFY_GRAPH_STEP_ID) {
		return pick('graph', 'proposed', 'plan');
	}
	if (step.id === ENABLE_PREVIEW_STEP_ID) {
		return pick('preview', 'plan');
	}
	switch (step.id) {
		case 'research_survey':
		case 'awaiting_repo_selection':
		case 'research_map':
			return pick('context', 'proposed', 'plan');
		case 'confirm_surface':
		case 'intent':
		case 'plan_ready':
		case 'lock_plan':
			return pick('proposed', 'plan');
		default:
			return pick('plan');
	}
}

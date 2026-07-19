/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plan Steps hybrid routing: Custom AI orchestrates (narrate + DISPATCH marker);
 * Claude Code executes tool-heavy research / generate work via the existing PTY path.
 */

export type SurfacePlanOrchestrationActionId =
	| 'start_planning'
	| 'lock_plan'
	| 'run_next_phase';

export interface SurfacePlanClaudeDispatch {
	readonly actionId: SurfacePlanOrchestrationActionId;
	readonly targetId: string;
}

export interface SurfacePlanOrchestrationBrief {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly actionId: SurfacePlanOrchestrationActionId;
	readonly stepId: string;
	readonly stepLabel: string;
}

/** Machine-readable line Custom AI must emit to hand coding work to Claude. */
export const DISPATCH_CLAUDE_PREFIX = 'DISPATCH_CLAUDE:';

const DISPATCH_LINE_RE = /^[ \t]*DISPATCH_CLAUDE:\s*(start_planning|lock_plan|run_next_phase)\s*:\s*(\S+)\s*$/gim;

/** Guidance injected into Custom AI Plan-Steps orchestration turns. */
export const CUSTOM_AI_PLAN_STEPS_ORCHESTRATION_GUIDANCE = [
	'You are the Plan Steps orchestrator for this goal-workspace surface.',
	'Own intent framing, lock acknowledgment, phase selection, status narration, and verify decisions.',
	'Do not explore the repo with tools, edit application source, run shell commands, or claim phase completion.',
	'Do not edit `.workflow.json` or `.phase-progress.json` — the Console owns Steps advancement.',
	'Claude Code owns tool-heavy research, mapping, generate phases, and Enable Preview file edits via phase-progress.json.',
	'After a short status summary (2–5 sentences), emit exactly one dispatch line and stop.',
].join('\n');

export function isSurfacePlanOrchestrationActionId(value: string): value is SurfacePlanOrchestrationActionId {
	return value === 'start_planning' || value === 'lock_plan' || value === 'run_next_phase';
}

/**
 * True when this Plan Next / kickoff action should get a Custom AI orchestration turn
 * before Claude executes.
 */
export function shouldOrchestratePlanAction(actionId: string): actionId is SurfacePlanOrchestrationActionId {
	return isSurfacePlanOrchestrationActionId(actionId);
}

/**
 * Parse the last valid `DISPATCH_CLAUDE:<action>:<target>` line from Custom AI output.
 * Returns undefined when missing or malformed (caller falls back to Claude notify).
 */
export function parseDispatchClaudeMarker(text: string | undefined): SurfacePlanClaudeDispatch | undefined {
	if (!text?.trim()) {
		return undefined;
	}
	let last: SurfacePlanClaudeDispatch | undefined;
	DISPATCH_LINE_RE.lastIndex = 0;
	for (const match of text.matchAll(DISPATCH_LINE_RE)) {
		const actionId = match[1];
		const targetId = match[2];
		if (!isSurfacePlanOrchestrationActionId(actionId) || !targetId) {
			continue;
		}
		last = { actionId, targetId };
	}
	return last;
}

/**
 * Whether a parsed dispatch (or fallback) should proceed to Claude for this action.
 * Orchestration never blocks Claude coding turns — missing markers use fallback.
 */
export function shouldExecuteClaudeAfterOrchestration(
	actionId: SurfacePlanOrchestrationActionId,
	dispatch: SurfacePlanClaudeDispatch | undefined,
): boolean {
	if (!dispatch) {
		// Fallback: always hand coding / kickoff work to Claude when Custom AI omits the marker.
		return true;
	}
	return dispatch.actionId === actionId;
}

export function buildSurfacePlanOrchestrationPrompt(brief: SurfacePlanOrchestrationBrief): string {
	const progressPath = `.agent/surfaces/${brief.surfaceId}.phase-progress.json`;
	const planPath = `.agent/surfaces/${brief.surfaceId}.plan.md`;
	const proposalPath = `.agent/task-trees/${brief.surfaceId}.graph-proposal.json`;
	const expectedDispatch = `${DISPATCH_CLAUDE_PREFIX} ${brief.actionId}:${brief.stepId}`;

	const actionHint = brief.actionId === 'start_planning'
		? 'Summarize the intent and that Claude will survey reference repos and draft the plan/proposal. Do not start research yourself.'
		: brief.actionId === 'lock_plan'
			? 'Acknowledge the plan lock. Tell the user Claude will wait for Console Next before generate phases. Do not implement phases.'
			: brief.stepId === 'verify_graph'
				? 'Confirm Code Graph should be dispatched to Claude to remap_and_wait + compare_proposal against the surface graph proposal before Enable Preview.'
				: brief.stepId === 'enable_preview'
					? 'Confirm Enable Preview should be dispatched to Claude to set localUrl + devCommand on the surface.'
					: `Confirm phase "${brief.stepLabel}" (${brief.stepId}) should be dispatched to Claude for implementation + Ix verify.`;

	return [
		CUSTOM_AI_PLAN_STEPS_ORCHESTRATION_GUIDANCE,
		'',
		'Plan Steps orchestration brief:',
		`- Surface: ${brief.surfaceName} (${brief.surfaceId})`,
		`- Action: ${brief.actionId}`,
		`- Step: ${brief.stepLabel} (${brief.stepId})`,
		`- Plan: ${planPath}`,
		`- Proposal: ${proposalPath}`,
		`- Phase progress: ${progressPath}`,
		'',
		actionHint,
		'',
		`End your reply with exactly this line (no backticks):`,
		expectedDispatch,
	].join('\n');
}

export function buildClaudeDispatchNotification(
	stepLabel: string,
	usedFallback: boolean,
): string {
	return usedFallback
		? `Custom AI orchestration skipped or incomplete; sent step to Claude: ${stepLabel}`
		: `Custom AI dispatched step to Claude: ${stepLabel}`;
}

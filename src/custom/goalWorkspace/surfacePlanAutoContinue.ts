/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SurfacePlanWorkflowStageId } from './surfacePlanWorkflowStatus.js';

/** How long a Claude-owned stage may sit unchanged before Console auto-nudges Claude. */
export const SURFACE_AUTO_CONTINUE_STALL_MS = 45_000;

/** Minimum gap between auto-nudges for the same surface. */
export const SURFACE_AUTO_CONTINUE_COOLDOWN_MS = 90_000;

export interface SurfaceAutoContinueFingerprintInput {
	readonly stageId: SurfacePlanWorkflowStageId;
	readonly candidatesStatus?: string;
	readonly hasDraftProposal: boolean;
	readonly hasFinalProposal: boolean;
	readonly phaseInFlightStepId?: string;
	readonly phaseStatus?: string;
}

export interface SurfaceAutoContinueDecisionInput {
	readonly fingerprint: string;
	readonly previousFingerprint?: string;
	readonly firstSeenMs?: number;
	readonly lastNudgeMs?: number;
	readonly nowMs: number;
	readonly stallMs?: number;
	readonly cooldownMs?: number;
	readonly stageEligible: boolean;
}

export interface SurfaceAutoContinueDecision {
	readonly shouldContinue: boolean;
	readonly firstSeenMs: number;
	readonly fingerprint: string;
}

export function isClaudeOwnedAutoContinueStage(
	stageId: SurfacePlanWorkflowStageId,
	phaseInFlightStepId?: string,
): boolean {
	if (phaseInFlightStepId?.trim()) {
		return true;
	}
	return stageId === 'research_survey' || stageId === 'research_map';
}

export function buildSurfaceAutoContinueFingerprint(input: SurfaceAutoContinueFingerprintInput): string {
	return [
		input.stageId,
		input.candidatesStatus ?? '',
		input.hasDraftProposal ? '1' : '0',
		input.hasFinalProposal ? '1' : '0',
		input.phaseInFlightStepId?.trim() || '',
		input.phaseStatus ?? '',
	].join('|');
}

/**
 * True when a Claude-owned stage fingerprint has been unchanged longer than the stall
 * window and the per-surface cooldown has elapsed.
 */
export function decideSurfaceAutoContinue(input: SurfaceAutoContinueDecisionInput): SurfaceAutoContinueDecision {
	const stallMs = input.stallMs ?? SURFACE_AUTO_CONTINUE_STALL_MS;
	const cooldownMs = input.cooldownMs ?? SURFACE_AUTO_CONTINUE_COOLDOWN_MS;
	if (!input.stageEligible) {
		return {
			shouldContinue: false,
			firstSeenMs: input.nowMs,
			fingerprint: input.fingerprint,
		};
	}
	const fingerprintChanged = input.previousFingerprint !== input.fingerprint;
	const firstSeenMs = fingerprintChanged || input.firstSeenMs === undefined
		? input.nowMs
		: input.firstSeenMs;
	const stalled = input.nowMs - firstSeenMs >= stallMs;
	const cooledDown = input.lastNudgeMs === undefined || input.nowMs - input.lastNudgeMs >= cooldownMs;
	return {
		shouldContinue: stalled && cooledDown,
		firstSeenMs,
		fingerprint: input.fingerprint,
	};
}

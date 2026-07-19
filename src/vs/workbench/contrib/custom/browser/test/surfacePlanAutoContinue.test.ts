/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildSurfaceAutoContinueFingerprint,
	decideSurfaceAutoContinue,
	isClaudeOwnedAutoContinueStage,
	SURFACE_AUTO_CONTINUE_COOLDOWN_MS,
	SURFACE_AUTO_CONTINUE_STALL_MS,
} from '../../../../../../custom/goalWorkspace/surfacePlanAutoContinue.js';

suite('surfacePlanAutoContinue', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('marks research stages and in-flight phases as Claude-owned', () => {
		assert.strictEqual(isClaudeOwnedAutoContinueStage('research_map'), true);
		assert.strictEqual(isClaudeOwnedAutoContinueStage('research_survey'), true);
		assert.strictEqual(isClaudeOwnedAutoContinueStage('plan_ready'), false);
		assert.strictEqual(isClaudeOwnedAutoContinueStage('building', 'phase-1'), true);
	});

	test('fingerprint changes when draft proposal appears', () => {
		const before = buildSurfaceAutoContinueFingerprint({
			stageId: 'research_map',
			candidatesStatus: 'done',
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		const after = buildSurfaceAutoContinueFingerprint({
			stageId: 'research_map',
			candidatesStatus: 'done',
			hasDraftProposal: true,
			hasFinalProposal: false,
		});
		assert.notStrictEqual(before, after);
	});

	test('auto-continues only after stall + cooldown', () => {
		const fingerprint = 'research_map|done|0|0||';
		const t0 = 1_000_000;
		const first = decideSurfaceAutoContinue({
			fingerprint,
			nowMs: t0,
			stageEligible: true,
		});
		assert.strictEqual(first.shouldContinue, false);

		const stalled = decideSurfaceAutoContinue({
			fingerprint,
			previousFingerprint: fingerprint,
			firstSeenMs: first.firstSeenMs,
			nowMs: t0 + SURFACE_AUTO_CONTINUE_STALL_MS,
			stageEligible: true,
		});
		assert.strictEqual(stalled.shouldContinue, true);

		const cooling = decideSurfaceAutoContinue({
			fingerprint,
			previousFingerprint: fingerprint,
			firstSeenMs: first.firstSeenMs,
			lastNudgeMs: t0 + SURFACE_AUTO_CONTINUE_STALL_MS,
			nowMs: t0 + SURFACE_AUTO_CONTINUE_STALL_MS + 1_000,
			stageEligible: true,
		});
		assert.strictEqual(cooling.shouldContinue, false);

		const readyAgain = decideSurfaceAutoContinue({
			fingerprint,
			previousFingerprint: fingerprint,
			firstSeenMs: first.firstSeenMs,
			lastNudgeMs: t0 + SURFACE_AUTO_CONTINUE_STALL_MS,
			nowMs: t0 + SURFACE_AUTO_CONTINUE_STALL_MS + SURFACE_AUTO_CONTINUE_COOLDOWN_MS,
			stageEligible: true,
		});
		assert.strictEqual(readyAgain.shouldContinue, true);
	});

	test('resets first-seen when fingerprint changes', () => {
		const t0 = 2_000_000;
		const decision = decideSurfaceAutoContinue({
			fingerprint: 'research_map|done|1|0||',
			previousFingerprint: 'research_map|done|0|0||',
			firstSeenMs: t0 - SURFACE_AUTO_CONTINUE_STALL_MS,
			nowMs: t0,
			stageEligible: true,
		});
		assert.strictEqual(decision.shouldContinue, false);
		assert.strictEqual(decision.firstSeenMs, t0);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	createIdlePhaseProgress,
	createRunningPhaseProgress,
	failedPhaseStepIdFromProgress,
	parseSurfacePhaseProgress,
	phaseInFlightStepIdFromProgress,
	serializeSurfacePhaseProgress,
	surfacePhaseProgressResource,
} from '../../../../../../custom/goalWorkspace/surfacePhaseProgress.js';

suite('surfacePhaseProgress', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('resource path', () => {
		assert.ok(
			surfacePhaseProgressResource(URI.file('/tmp/ws'), 'cadre-support-bot').path
				.endsWith('/.agent/surfaces/cadre-support-bot.phase-progress.json'),
		);
	});

	test('round-trip serialize/parse running progress', () => {
		const running = createRunningPhaseProgress({
			surfaceId: 'cadre-support-bot',
			stepId: 'phase-knowledge',
			stepLabel: 'Knowledge base + escalation',
			message: 'Writing knowledge files',
		});
		assert.strictEqual(phaseInFlightStepIdFromProgress(running), 'phase-knowledge');
		assert.strictEqual(failedPhaseStepIdFromProgress(running), undefined);

		const again = parseSurfacePhaseProgress(serializeSurfacePhaseProgress(running))!;
		assert.deepStrictEqual({
			surfaceId: again.surfaceId,
			stepId: again.stepId,
			stepLabel: again.stepLabel,
			status: again.status,
			message: again.message,
		}, {
			surfaceId: 'cadre-support-bot',
			stepId: 'phase-knowledge',
			stepLabel: 'Knowledge base + escalation',
			status: 'running',
			message: 'Writing knowledge files',
		});
	});

	test('idle clears in-flight; failed exposes retry id', () => {
		const failed = parseSurfacePhaseProgress(JSON.stringify({
			surfaceId: 'cadre-support-bot',
			stepId: 'phase-1',
			stepLabel: 'Scaffold',
			status: 'failed',
			updatedAt: '2026-07-19T00:00:00.000Z',
			error: 'compare_proposal failed',
		}))!;
		assert.strictEqual(phaseInFlightStepIdFromProgress(failed), undefined);
		assert.strictEqual(failedPhaseStepIdFromProgress(failed), 'phase-1');
		assert.strictEqual(failed.error, 'compare_proposal failed');

		const idle = createIdlePhaseProgress('cadre-support-bot', failed);
		assert.strictEqual(idle.status, 'idle');
		assert.strictEqual(phaseInFlightStepIdFromProgress(idle), undefined);
		assert.strictEqual(failedPhaseStepIdFromProgress(idle), undefined);
	});

	test('rejects invalid documents', () => {
		assert.strictEqual(parseSurfacePhaseProgress('{'), undefined);
		assert.strictEqual(parseSurfacePhaseProgress(JSON.stringify({ status: 'running' })), undefined);
		assert.strictEqual(parseSurfacePhaseProgress(JSON.stringify({
			surfaceId: 'x',
			stepId: 'y',
			status: 'nope',
		})), undefined);
	});
});

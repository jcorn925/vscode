/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	formatPhaseProgressBadge,
	resolveCurrentPhaseIndex,
	resolvePhaseRowStatus,
	resolveWorkstreamExecutionPresentation,
} from '../workstreamExecutionPresentation.js';

suite('workstreamExecutionPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parallel off uses cluster badge and sequential summary', () => {
		const presentation = resolveWorkstreamExecutionPresentation({
			parallelEnabled: false,
			workstreamsInflight: false,
			parallelStreamCount: 9,
			canParallelize: true,
			hideRunWorkstreamsButton: true,
		});
		assert.strictEqual(presentation.badgeKind, 'cluster');
		assert.strictEqual(presentation.badgeLabel, 'cluster');
		assert.ok(presentation.summaryLine.includes('one Claude'));
		assert.strictEqual(presentation.openByDefault, false);
	});

	test('parallel on ready uses parallel-ready badge', () => {
		const presentation = resolveWorkstreamExecutionPresentation({
			parallelEnabled: true,
			workstreamsInflight: false,
			parallelStreamCount: 9,
			canParallelize: true,
			hideRunWorkstreamsButton: true,
		});
		assert.strictEqual(presentation.badgeKind, 'parallel-ready');
		assert.ok(presentation.summaryLine.includes('fan out'));
		assert.strictEqual(presentation.openByDefault, true);
	});

	test('inflight fan-out uses parallel badge', () => {
		const presentation = resolveWorkstreamExecutionPresentation({
			parallelEnabled: true,
			workstreamsInflight: true,
			parallelStreamCount: 3,
			canParallelize: true,
			hideRunWorkstreamsButton: true,
		});
		assert.strictEqual(presentation.badgeKind, 'parallel');
		assert.ok(presentation.summaryLine.includes('Running 3'));
		assert.strictEqual(presentation.openByDefault, true);
	});

	test('inflight ignored when parallel setting off', () => {
		const presentation = resolveWorkstreamExecutionPresentation({
			parallelEnabled: false,
			workstreamsInflight: true,
			parallelStreamCount: 3,
			canParallelize: true,
			hideRunWorkstreamsButton: true,
		});
		assert.strictEqual(presentation.badgeKind, 'cluster');
		assert.ok(!presentation.summaryLine.startsWith('Running'));
	});

	test('resolveCurrentPhaseIndex matches step id; skips non-phase steps', () => {
		const phases = [{ id: 'phase-a' }, { id: 'phase-b' }, { id: 'phase-c' }];
		assert.strictEqual(resolveCurrentPhaseIndex(phases, 'phase-b'), 2);
		assert.strictEqual(resolveCurrentPhaseIndex(phases, 'phase-generate'), 1);
		assert.strictEqual(resolveCurrentPhaseIndex(phases, 'ws-16'), 1);
		assert.strictEqual(resolveCurrentPhaseIndex(phases, 'verify_graph'), undefined);
		assert.strictEqual(resolveCurrentPhaseIndex(phases, undefined), undefined);
		assert.strictEqual(resolveCurrentPhaseIndex([], 'phase-a'), undefined);
	});

	test('resolvePhaseRowStatus prefers workflow statuses and overlays current index', () => {
		const statuses = [
			{ id: 'phase-a', status: 'completed' as const },
			{ id: 'phase-b', status: 'current' as const },
			{ id: 'phase-c', status: 'pending' as const },
		];
		assert.strictEqual(resolvePhaseRowStatus('phase-a', 0, statuses, 2), 'completed');
		assert.strictEqual(resolvePhaseRowStatus('phase-b', 1, statuses, 2), 'current');
		assert.strictEqual(resolvePhaseRowStatus('phase-c', 2, statuses, 2), 'pending');
		assert.strictEqual(resolvePhaseRowStatus('phase-b', 1, statuses, 2), 'current');
		assert.strictEqual(resolvePhaseRowStatus('missing', 1, statuses, 2), 'current');
		assert.strictEqual(resolvePhaseRowStatus('phase-x', 0, undefined, 1), 'current');
		assert.strictEqual(resolvePhaseRowStatus('phase-x', 1, undefined, 1), undefined);
		assert.strictEqual(resolvePhaseRowStatus('phase-b', 1, [
			{ id: 'phase-b', status: 'failed' },
		], 2), 'failed');
	});

	test('formatPhaseProgressBadge is completed/total', () => {
		assert.strictEqual(formatPhaseProgressBadge(0, []), undefined);
		assert.strictEqual(formatPhaseProgressBadge(4, undefined), '0/4');
		assert.strictEqual(formatPhaseProgressBadge(4, [
			{ id: 'a', status: 'completed' },
			{ id: 'b', status: 'completed' },
			{ id: 'c', status: 'current' },
			{ id: 'd', status: 'pending' },
		]), '2/4');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { surfaceAssociatedStepActivityMs } from '../../../../../../custom/goalWorkspace/surfacePlanPendingAction.js';
import type { SurfacePlanWorkflowDocument } from '../../../../../../custom/goalWorkspace/surfacePlanWorkflow.js';
import type { SurfacePhaseProgressDocument } from '../../../../../../custom/goalWorkspace/surfacePhaseProgress.js';

suite('surfaceAssociatedStepActivityMs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns 0 for empty inputs', () => {
		assert.strictEqual(surfaceAssociatedStepActivityMs(), 0);
		assert.strictEqual(surfaceAssociatedStepActivityMs(undefined, undefined), 0);
	});

	test('uses workflow.updatedAt when present', () => {
		const workflow: SurfacePlanWorkflowDocument = {
			surfaceId: 'a',
			updatedAt: '2026-07-19T12:00:00.000Z',
			steps: [],
		};
		assert.strictEqual(
			surfaceAssociatedStepActivityMs(workflow),
			Date.parse('2026-07-19T12:00:00.000Z'),
		);
	});

	test('uses progress.updatedAt when present', () => {
		const progress: SurfacePhaseProgressDocument = {
			surfaceId: 'a',
			stepId: 'phase-1',
			stepLabel: 'Phase 1',
			status: 'running',
			updatedAt: '2026-07-19T13:00:00.000Z',
		};
		assert.strictEqual(
			surfaceAssociatedStepActivityMs(undefined, progress),
			Date.parse('2026-07-19T13:00:00.000Z'),
		);
	});

	test('takes max of workflow updatedAt, step completedAt, and progress updatedAt', () => {
		const workflow: SurfacePlanWorkflowDocument = {
			surfaceId: 'a',
			updatedAt: '2026-07-19T10:00:00.000Z',
			steps: [
				{
					id: 's1',
					label: 'Step 1',
					kind: 'stage',
					status: 'completed',
					completedAt: '2026-07-19T14:00:00.000Z',
				},
				{
					id: 's2',
					label: 'Step 2',
					kind: 'stage',
					status: 'current',
				},
			],
		};
		const progress: SurfacePhaseProgressDocument = {
			surfaceId: 'a',
			stepId: 's2',
			stepLabel: 'Step 2',
			status: 'running',
			updatedAt: '2026-07-19T13:30:00.000Z',
		};
		assert.strictEqual(
			surfaceAssociatedStepActivityMs(workflow, progress),
			Date.parse('2026-07-19T14:00:00.000Z'),
		);
	});

	test('ignores invalid dates', () => {
		const workflow: SurfacePlanWorkflowDocument = {
			surfaceId: 'a',
			updatedAt: 'not-a-date',
			steps: [
				{
					id: 's1',
					label: 'Step 1',
					kind: 'stage',
					status: 'completed',
					completedAt: 'also-bad',
				},
			],
		};
		const progress: SurfacePhaseProgressDocument = {
			surfaceId: 'a',
			stepId: 's1',
			stepLabel: 'Step 1',
			status: 'completed',
			updatedAt: '2026-07-19T15:00:00.000Z',
		};
		assert.strictEqual(
			surfaceAssociatedStepActivityMs(workflow, progress),
			Date.parse('2026-07-19T15:00:00.000Z'),
		);
	});
});

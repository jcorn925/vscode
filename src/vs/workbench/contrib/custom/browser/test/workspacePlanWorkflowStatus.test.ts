/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	inferWorkspacePlanWorkflowStage,
	resolveWorkspacePlanWorkflowStatus,
} from '../../../../../../custom/goalWorkspace/workspacePlanWorkflowStatus.js';

suite('workspacePlanWorkflowStatus', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('idle when no session and no artifacts', () => {
		assert.strictEqual(inferWorkspacePlanWorkflowStage({
			sessionActive: false,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
		}), 'idle');
	});

	test('kickoff while prompt is submitting', () => {
		assert.strictEqual(inferWorkspacePlanWorkflowStage({
			kickoffInFlight: true,
			sessionActive: false,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
		}), 'kickoff');
	});

	test('drafting while session active before plan exists', () => {
		const status = resolveWorkspacePlanWorkflowStatus({
			sessionActive: true,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
		});
		assert.strictEqual(status.stageId, 'drafting_plan');
		assert.strictEqual(status.steps.find(step => step.id === 'drafting_plan')?.status, 'current');
		assert.ok(status.statusLabel.includes('workspace.plan.md'));
	});

	test('proposing surfaces after plan exists', () => {
		assert.strictEqual(inferWorkspacePlanWorkflowStage({
			sessionActive: true,
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: false,
		}), 'proposing_surfaces');
	});

	test('ready when suggestions arrive', () => {
		const status = resolveWorkspacePlanWorkflowStatus({
			sessionActive: true,
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'draft',
		});
		assert.strictEqual(status.stageId, 'ready');
		assert.strictEqual(status.steps.find(step => step.id === 'ready')?.status, 'current');
	});

	test('confirmed when surfaces are created', () => {
		const status = resolveWorkspacePlanWorkflowStatus({
			sessionActive: false,
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'confirmed',
		});
		assert.strictEqual(status.stageId, 'confirmed');
		assert.ok(status.steps.every(step => step.status === 'completed'));
		assert.ok(status.statusLabel.includes('Selected surfaces created'));
	});

	test('draft suggestions stay on review until Console confirms', () => {
		assert.strictEqual(inferWorkspacePlanWorkflowStage({
			sessionActive: false,
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'draft',
		}), 'ready');
	});
});

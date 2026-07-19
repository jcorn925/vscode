/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	inferConsoleWorkflowStage,
	isConsoleHomeSection,
	resolveConsoleWorkflowStatus,
} from '../../../../../../custom/goalWorkspace/consoleWorkflowStatus.js';

suite('consoleWorkflowStatus', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('idle with no signals', () => {
		assert.strictEqual(inferConsoleWorkflowStage({
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
			surfaceCount: 0,
		}), 'idle');
	});

	test('planning while kickoff or session active', () => {
		const status = resolveConsoleWorkflowStatus({
			sessionActive: true,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
			surfaceCount: 0,
		});
		assert.strictEqual(status.stageId, 'planning');
		assert.strictEqual(status.steps.find(step => step.id === 'planning')?.status, 'current');
	});

	test('review_surfaces after plan exists without suggestions', () => {
		assert.strictEqual(inferConsoleWorkflowStage({
			sessionActive: true,
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: false,
			surfaceCount: 0,
		}), 'review_surfaces');
	});

	test('create_surfaces when suggestions are ready', () => {
		const status = resolveConsoleWorkflowStatus({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'draft',
			surfaceCount: 0,
		});
		assert.strictEqual(status.stageId, 'create_surfaces');
		assert.strictEqual(status.steps.find(step => step.id === 'create_surfaces')?.status, 'current');
	});

	test('building when a surface plan is locked', () => {
		assert.strictEqual(inferConsoleWorkflowStage({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'confirmed',
			surfaceCount: 1,
			anySurfacePlanLocked: true,
		}), 'building');
	});

	test('running when a surface app is up', () => {
		const status = resolveConsoleWorkflowStatus({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			surfaceCount: 2,
			anySurfaceRunning: true,
		});
		assert.strictEqual(status.stageId, 'running');
		assert.ok(status.steps.filter(step => step.status === 'completed').length >= 4);
	});

	test('isConsoleHomeSection', () => {
		assert.ok(isConsoleHomeSection('workspacePlan'));
		assert.ok(isConsoleHomeSection('surfaces'));
		assert.ok(!isConsoleHomeSection('console'));
		assert.ok(!isConsoleHomeSection('code'));
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	inferConsoleWorkflowStage,
	isConsoleHomeSection,
	resolveConsoleWorkflowNextAction,
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

	test('docker stage when dockerReady is explicitly false', () => {
		const status = resolveConsoleWorkflowStatus({
			dockerReady: false,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
			surfaceCount: 0,
		});
		assert.strictEqual(status.stageId, 'docker');
		assert.strictEqual(status.steps.find(step => step.id === 'docker')?.status, 'current');
		assert.strictEqual(status.steps.find(step => step.id === 'planning')?.status, 'pending');
	});

	test('idle marks docker completed when ready', () => {
		const status = resolveConsoleWorkflowStatus({
			dockerReady: true,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
			surfaceCount: 0,
		});
		assert.strictEqual(status.stageId, 'idle');
		assert.strictEqual(status.steps.find(step => step.id === 'docker')?.status, 'completed');
	});

	test('planning while kickoff or session active', () => {
		const status = resolveConsoleWorkflowStatus({
			sessionActive: true,
			hasWorkspacePlan: false,
			hasSuggestedSurfaces: false,
			surfaceCount: 0,
		});
		assert.strictEqual(status.stageId, 'planning');
		assert.strictEqual(status.steps.find(step => step.id === 'docker')?.status, 'completed');
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

	test('building when surfaces are complete even without pending lock labels', () => {
		const status = resolveConsoleWorkflowStatus({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'confirmed',
			surfaceCount: 3,
			anySurfaceComplete: true,
		});
		assert.strictEqual(status.stageId, 'building');
		assert.strictEqual(status.steps.find(step => step.id === 'create_surfaces')?.status, 'completed');
		assert.strictEqual(status.steps.find(step => step.id === 'building')?.status, 'current');
		assert.strictEqual(status.steps.find(step => step.id === 'running')?.status, 'pending');
		assert.deepStrictEqual(status.nextAction, {
			id: 'start_apps',
			label: 'Start Apps',
			stepId: 'running',
		});
	});

	test('Start Apps only while Apps running is upcoming during building', () => {
		const building = resolveConsoleWorkflowStatus({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			surfaceCount: 2,
			anySurfacePlanLocked: true,
		});
		assert.deepStrictEqual(
			resolveConsoleWorkflowNextAction(building.stageId, {
				hasWorkspacePlan: true,
				hasSuggestedSurfaces: true,
				surfaceCount: 2,
				anySurfacePlanLocked: true,
			}, building.steps),
			{ id: 'start_apps', label: 'Start Apps', stepId: 'running' },
		);
		assert.strictEqual(resolveConsoleWorkflowStatus({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			surfaceCount: 2,
			anySurfaceRunning: true,
		}).nextAction, undefined);
		assert.strictEqual(resolveConsoleWorkflowStatus({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'draft',
			surfaceCount: 0,
			anySurfacePlanLocked: true,
		}).nextAction, undefined);
	});

	test('stays on create_surfaces when surfaces exist but none are locked or complete', () => {
		assert.strictEqual(inferConsoleWorkflowStage({
			hasWorkspacePlan: true,
			hasSuggestedSurfaces: true,
			suggestedStatus: 'confirmed',
			surfaceCount: 3,
		}), 'create_surfaces');
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
		assert.ok(isConsoleHomeSection('description'));
		assert.ok(isConsoleHomeSection('docker'));
		assert.ok(isConsoleHomeSection('claudeMd'));
		assert.ok(isConsoleHomeSection('howItWorks'));
		assert.ok(isConsoleHomeSection('branding'));
		assert.ok(isConsoleHomeSection('settings'));
		assert.ok(!isConsoleHomeSection('console'));
		assert.ok(!isConsoleHomeSection('code'));
	});
});

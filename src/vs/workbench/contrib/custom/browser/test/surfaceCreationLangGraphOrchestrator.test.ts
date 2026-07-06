/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SurfaceCreationLangGraphOrchestrator } from '../../../../../../custom/goalWorkspace/surfaceCreationLangGraphOrchestrator.js';
import type { SurfaceBlueprint, SurfaceBlueprintVerificationResult } from '../../../../../../custom/goalWorkspace/surfaceBlueprintTypes.js';

suite('surfaceCreationLangGraphOrchestrator', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('runs createSurface successfully without repair', async () => {
		const workspaceFolder = URI.file('/workspace');
		const blueprint = createBlueprint('marketing');
		const verifyCalls: string[] = [];
		let repairCalls = 0;
		const traceEvents: string[] = [];
		const orchestrator = new SurfaceCreationLangGraphOrchestrator({
			fileService: {} as never,
			workspaceFolder,
			traceEvent: (type) => traceEvents.push(type),
			services: {
				createBlueprintFromTemplateId: async () => ({ blueprint, resource: URI.file('/workspace/.agent/surfaces/marketing.blueprint.json') }),
				scaffoldSurfaceFromBlueprint: async () => ({
					surfaceId: 'marketing',
					appPath: 'apps/marketing',
					localUrl: 'http://localhost:3001',
					createdFiles: [
						'workspace.goal.json',
						'apps/marketing/app/page.tsx',
						'packages/domain/index.ts',
						'packages/events/index.ts',
						'workflows/marketing.workflow.md',
					],
				}),
				verifySurfaceBlueprint: async () => {
					verifyCalls.push('verify');
					return passedVerification('marketing');
				},
				repairSurface: async () => {
					repairCalls++;
					return {
						surfaceId: 'marketing',
						appPath: 'apps/marketing',
						localUrl: 'http://localhost:3001',
						createdFiles: [],
					};
				},
			},
		});

		const result = await orchestrator.createSurface('marketing', 'capture leads and route to booking');

		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.templateId, 'marketing');
		assert.strictEqual(result.repairAttempts, 0);
		assert.strictEqual(verifyCalls.length, 1);
		assert.strictEqual(repairCalls, 0);
		assert.ok(traceEvents.includes('surface_creation_langgraph.started'));
		assert.ok(traceEvents.includes('surface_creation_langgraph.completed'));
	});

	test('repairs once after failed verification', async () => {
		const workspaceFolder = URI.file('/workspace');
		const blueprint = createBlueprint('booking');
		let verifyCallCount = 0;
		let repairCallCount = 0;
		const orchestrator = new SurfaceCreationLangGraphOrchestrator({
			fileService: {} as never,
			workspaceFolder,
			services: {
				createBlueprintFromTemplateId: async () => ({ blueprint, resource: URI.file('/workspace/.agent/surfaces/booking.blueprint.json') }),
				scaffoldSurfaceFromBlueprint: async () => ({
					surfaceId: 'booking',
					appPath: 'apps/booking',
					localUrl: 'http://localhost:3002',
					createdFiles: ['workspace.goal.json', 'apps/booking/app/page.tsx'],
				}),
				verifySurfaceBlueprint: async () => {
					verifyCallCount++;
					if (verifyCallCount === 1) {
						return failedVerification('booking');
					}
					return passedVerification('booking');
				},
				repairSurface: async () => {
					repairCallCount++;
					return {
						surfaceId: 'booking',
						appPath: 'apps/booking',
						localUrl: 'http://localhost:3002',
						createdFiles: ['apps/booking/app/page.tsx'],
					};
				},
			},
		});

		const result = await orchestrator.createSurface('booking', 'collect intake then checkout');

		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.repairAttempts, 1);
		assert.strictEqual(verifyCallCount, 2);
		assert.strictEqual(repairCallCount, 1);
	});
});

function createBlueprint(surfaceId: string): SurfaceBlueprint {
	return {
		version: 1,
		surfaceId,
		surfaceName: `${surfaceId} surface`,
		templateId: surfaceId,
		status: 'draft',
		subsystems: [
			{
				id: 'home',
				label: 'Home',
				kind: 'route',
				paths: [`apps/${surfaceId}/app/page.tsx`],
			},
		],
		manifest: {
			capabilities: ['capture'],
			events: ['surface.created'],
			entities: ['Lead'],
			ixSubsystems: ['Home'],
		},
		acceptance: {
			requiredRoutes: ['/'],
			requiredWorkflows: ['capture'],
			requiredUiSignals: ['Start'],
			requiredBusinessTerms: ['lead'],
			minimumFiles: 1,
			minimumTotalLines: 1,
			minimumInteractiveControls: 0,
		},
		createdAt: new Date().toISOString(),
	};
}

function passedVerification(surfaceId: string): SurfaceBlueprintVerificationResult {
	return {
		passed: true,
		surfaceId,
		satisfiedCount: 1,
		totalCount: 1,
		gaps: [],
		ixChecked: false,
	};
}

function failedVerification(surfaceId: string): SurfaceBlueprintVerificationResult {
	return {
		passed: false,
		surfaceId,
		satisfiedCount: 0,
		totalCount: 1,
		gaps: [{
			subsystemId: 'home',
			kind: 'missing_path',
			message: 'missing',
		}],
		ixChecked: false,
	};
}

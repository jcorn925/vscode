/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CustomAiPlanCrossAppWorkflowTool } from '../../../../../../custom/ai/browser/customAiPlanCrossAppWorkflowTool.js';
import {
	ADD_TRAINING_PACKAGE_WORKFLOW_ID,
	buildCrossAppWorkflowPlan,
	createMissingGoalWorkspaceState,
	getGoalWorkspaceCrossAppWorkflow,
	GOAL_WORKSPACE_MANIFEST,
	IGoalWorkspaceService,
	parseGoalWorkspaceManifestText,
} from '../../../../../../custom/goalWorkspace/GoalWorkspaceService.js';

suite('CustomAiPlanCrossAppWorkflowTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');
	const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);

	function createLoadedState() {
		return parseGoalWorkspaceManifestText(JSON.stringify({
			goal: {
				id: 'personal-training-business',
				name: 'Online Personal Training Business',
				description: 'Acquire clients and run coaching operations.',
				northStarMetric: 'active_paid_clients'
			},
			surfaces: [
				{
					id: 'marketing',
					name: 'Marketing Site',
					capabilities: ['display-offers', 'lead-capture'],
					events: ['lead.created'],
					entities: ['Lead', 'Offer'],
					ixSubsystems: ['Marketing UI']
				},
				{
					id: 'booking',
					name: 'Booking',
					path: 'apps/booking',
					capabilities: ['package-selection', 'schedule-session'],
					events: ['booking.started', 'booking.completed'],
					entities: ['Lead', 'Booking', 'TrainingPackage'],
					ixSubsystems: ['Booking UI']
				},
				{
					id: 'analytics',
					name: 'Analytics Dashboard',
					capabilities: ['package-analytics', 'conversion', 'revenue'],
					events: ['analytics.report.viewed'],
					entities: ['Metric', 'Campaign', 'Subscription']
				}
			],
			shared: {
				domain: 'packages/domain',
				events: 'packages/events',
				workflows: 'workflows'
			}
		}), workspaceFolder, manifestResource);
	}

	function createService(state: ReturnType<typeof createLoadedState>): IGoalWorkspaceService {
		return {
			_serviceBrand: undefined,
			onDidChangeGoalWorkspace: () => ({ dispose: () => { } }),
			onDidChangeState: () => ({ dispose: () => { } }),
			getState: () => state,
			getGoal: () => state.workspace?.goal,
			getGoalWorkspace: () => state.workspace,
			getSurfaces: () => state.workspace?.surfaces ?? [],
			getSurface: (id: string) => state.workspace?.surfaces.find(surface => surface.id === id),
			getContext: () => state.context,
			getSurfaceContext: () => undefined,
			getIx: () => state.ix,
			getSurfaceIxOverlay: () => undefined,
			getAffectedSurfacesForIxSubsystem: () => [],
			getCrossAppWorkflow: (id: string) => getGoalWorkspaceCrossAppWorkflow(id),
			buildCrossAppWorkflowPlan: (id: string, packageDraft = {}) => {
				const workflow = getGoalWorkspaceCrossAppWorkflow(id);
				if (!workflow || state.status !== 'loaded') {
					return undefined;
				}
				return buildCrossAppWorkflowPlan(state, workflow, packageDraft);
			},
			refresh: async () => state,
		};
	}

	test('returns cross-app plan markdown for a loaded goal workspace', async () => {
		const state = createLoadedState();
		const tool = new CustomAiPlanCrossAppWorkflowTool(createService(state));
		const result = await tool.invoke({
			callId: 'test',
			toolId: 'customAi_planCrossAppWorkflow',
			parameters: { workflowId: ADD_TRAINING_PACKAGE_WORKFLOW_ID },
			context: { sessionResource: URI.parse('test://session') },
		}, async () => 0, { report: () => { } }, CancellationToken.None);

		assert.ok(!result.toolResultError);
		const text = result.content.map(part => part.kind === 'text' ? part.value : '').join('');
		assert.match(text, /## Affected Surfaces/);
		assert.match(text, /Add Training Package/);
	});

	test('returns actionable error when goal workspace manifest is missing', async () => {
		const state = createMissingGoalWorkspaceState(workspaceFolder, manifestResource);
		const tool = new CustomAiPlanCrossAppWorkflowTool(createService(state));
		const result = await tool.invoke({
			callId: 'test',
			toolId: 'customAi_planCrossAppWorkflow',
			parameters: { workflowId: ADD_TRAINING_PACKAGE_WORKFLOW_ID },
			context: { sessionResource: URI.parse('test://session') },
		}, async () => 0, { report: () => { } }, CancellationToken.None);

		assert.strictEqual(result.toolResultError, true);
		const text = result.content.map(part => part.kind === 'text' ? part.value : '').join('');
		assert.match(text, /workspace\.goal\.json/);
	});

	test('returns error for unknown workflow id', async () => {
		const state = createLoadedState();
		const tool = new CustomAiPlanCrossAppWorkflowTool(createService(state));
		const result = await tool.invoke({
			callId: 'test',
			toolId: 'customAi_planCrossAppWorkflow',
			parameters: { workflowId: 'unknown-workflow' },
			context: { sessionResource: URI.parse('test://session') },
		}, async () => 0, { report: () => { } }, CancellationToken.None);

		assert.strictEqual(result.toolResultError, true);
		const text = result.content.map(part => part.kind === 'text' ? part.value : '').join('');
		assert.match(text, /Unknown workflow id/);
	});
});

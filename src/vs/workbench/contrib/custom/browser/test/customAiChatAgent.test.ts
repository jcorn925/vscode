/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildCustomAiGoalWorkspaceContextBlock, CUSTOM_AI_PRODUCT_SYSTEM_PROMPT } from '../../../../../../custom/ai/browser/customAiChatAgent.js';
import {
	createMissingGoalWorkspaceState,
	GOAL_WORKSPACE_MANIFEST,
	parseGoalWorkspaceManifestText,
} from '../../../../../../custom/goalWorkspace/GoalWorkspaceService.js';

suite('CustomAiChatAgent', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');
	const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);

	test('product system prompt describes goal-workspace agent behavior', () => {
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /goal-workspace IDE/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /related app surfaces/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /workspace\.goal\.json/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /Ix\/code metadata/);
	});

	test('renders loaded goal workspace context for Custom AI messages', () => {
		const state = parseGoalWorkspaceManifestText(JSON.stringify({
			goal: {
				id: 'personal-training-business',
				name: 'Online Personal Training Business',
				description: 'Acquire clients and run coaching operations.',
				northStarMetric: 'active_paid_clients'
			},
			surfaces: [
				{
					id: 'booking',
					name: 'Booking',
					type: 'web-app',
					path: 'apps/booking',
					localUrl: 'http://localhost:3001',
					devCommand: 'npm run dev --workspace apps/booking',
					purpose: 'Let leads book intro calls and training sessions',
					capabilities: ['booking', 'package-selection'],
					events: ['booking.started', 'booking.completed'],
					entities: ['Lead', 'Booking'],
					ixSubsystems: ['Booking UI']
				}
			],
			shared: {
				domain: 'packages/domain',
				events: 'packages/events',
				workflows: 'workflows'
			}
		}), workspaceFolder, manifestResource);

		const block = buildCustomAiGoalWorkspaceContextBlock(state);
		assert.ok(block);
		assert.match(block, /Goal: Online Personal Training Business/);
		assert.match(block, /North-star metric: active_paid_clients/);
		assert.match(block, /Booking \(booking\)/);
		assert.match(block, /capabilities=booking,package-selection/);
		assert.match(block, /Shared paths: domain=packages\/domain, events=packages\/events, workflows=workflows/);
		assert.match(block, /workspace\.goal\.json, app files, shared workflows\/domain\/events, durable memory, and Ix metadata/);
	});

	test('renders missing and invalid manifest guidance', () => {
		const missing = buildCustomAiGoalWorkspaceContextBlock(createMissingGoalWorkspaceState(workspaceFolder, manifestResource));
		assert.ok(missing);
		assert.match(missing, /workspace\.goal\.json is missing/);
		assert.match(missing, /create workspace\.goal\.json before scaffolding surfaces/);

		const invalidState = parseGoalWorkspaceManifestText('{ nope', workspaceFolder, manifestResource);
		const invalid = buildCustomAiGoalWorkspaceContextBlock(invalidState);
		assert.ok(invalid);
		assert.match(invalid, /present but invalid/);
		assert.match(invalid, /Invalid JSON/);
	});
});


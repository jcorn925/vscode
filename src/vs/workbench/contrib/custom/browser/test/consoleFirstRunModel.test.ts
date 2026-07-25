/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { consoleExampleBriefs, consoleWorkflowStepDisplayLabel, shouldShowConsoleFirstRun } from '../consoleFirstRunModel.js';
import type { ConsoleWorkflowSignals } from '../../../../../../custom/goalWorkspace/consoleWorkflowStatus.js';

function signals(overrides: Partial<ConsoleWorkflowSignals> = {}): ConsoleWorkflowSignals {
	return { hasWorkspacePlan: false, hasSuggestedSurfaces: false, surfaceCount: 0, ...overrides };
}

suite('consoleFirstRunModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hero leads only while the workspace has produced nothing', () => {
		assert.deepStrictEqual(
			{
				empty: shouldShowConsoleFirstRun(signals()),
				dockerBlocked: shouldShowConsoleFirstRun(signals({ dockerReady: false })),
				kickoff: shouldShowConsoleFirstRun(signals({ kickoffInFlight: true })),
				session: shouldShowConsoleFirstRun(signals({ sessionActive: true })),
				plan: shouldShowConsoleFirstRun(signals({ hasWorkspacePlan: true })),
				suggested: shouldShowConsoleFirstRun(signals({ hasSuggestedSurfaces: true })),
				surfaces: shouldShowConsoleFirstRun(signals({ surfaceCount: 2 })),
			},
			{
				empty: true,
				dockerBlocked: true,
				kickoff: false,
				session: false,
				plan: false,
				suggested: false,
				surfaces: false,
			},
		);
	});

	test('journey steps display as user outcomes, unknown ids keep their model label', () => {
		assert.deepStrictEqual(
			['planning', 'review_surfaces', 'create_surfaces', 'building', 'running', 'docker']
				.map(id => consoleWorkflowStepDisplayLabel(id, 'fallback')),
			['Describe your business', 'Review the plan', 'Approve surfaces', 'Surfaces building', 'Apps running', 'fallback'],
		);
	});

	test('example briefs are complete enough to submit as-is', () => {
		assert.deepStrictEqual(
			consoleExampleBriefs().map(example => ({
				id: example.id,
				hasCopy: example.title.length > 0 && example.goal.length > 0 && example.brief.length > 40,
				surfaceCount: example.surfaces.length,
			})),
			[
				{ id: 'booking-studio', hasCopy: true, surfaceCount: 3 },
				{ id: 'support-desk', hasCopy: true, surfaceCount: 3 },
				{ id: 'online-store', hasCopy: true, surfaceCount: 3 },
				{ id: 'analytics-agency', hasCopy: true, surfaceCount: 3 },
			],
		);
	});
});

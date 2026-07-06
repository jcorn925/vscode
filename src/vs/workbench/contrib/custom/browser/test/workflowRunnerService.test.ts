/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { runWorkflowSpec } from '../../../../../../custom/goalWorkspace/workflowRunnerService.js';
import type { WorkflowSpec } from '../../../../../../custom/goalWorkspace/workflowCatalogTypes.js';

suite('workflowRunnerService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('runs booking workflow steps and verifies success', async () => {
		const calls: string[] = [];
		const workflow: WorkflowSpec = {
			id: 'booking-intake',
			label: 'Booking intake flow',
			scope: 'surface',
			surfaceId: 'booking',
			source: 'template:booking',
			steps: [
				{ id: 'ensure-server', type: 'ensureServer' },
				{ id: 'open-packages', type: 'navigate', route: '/packages' },
				{ id: 'pick-package', type: 'click', target: { text: 'Select Strength Reset' } },
				{ id: 'assert-packages', type: 'assertText', target: { text: 'Package cards' } },
			],
			events: ['booking.started', 'booking.completed'],
			ixBindings: [],
		};

		const result = await runWorkflowSpec({
			workflow,
			handlers: {
				ensureServer: async () => { calls.push('ensureServer'); },
				navigate: async route => { calls.push(`navigate:${route}`); },
				click: async step => { calls.push(`click:${step.id}`); },
				assertText: async step => { calls.push(`assert:${step.id}`); },
				verifySurface: async () => ({ passed: true, report: 'ok' }),
			},
		});

		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.steps.length, 4);
		assert.deepStrictEqual(calls, [
			'ensureServer',
			'navigate:/packages',
			'click:pick-package',
			'assert:assert-packages',
		]);
	});

	test('fails early when ix bindings do not match discovered regions', async () => {
		const workflow: WorkflowSpec = {
			id: 'booking-intake',
			label: 'Booking intake flow',
			scope: 'surface',
			surfaceId: 'booking',
			source: 'template:booking',
			steps: [{ id: 'ensure-server', type: 'ensureServer' }],
			events: [],
			ixBindings: [{ stepId: 'ensure-server', subsystemLabel: 'Missing Subsystem' }],
		};
		const result = await runWorkflowSpec({
			workflow,
			ixSubsystems: [{
				regionId: 'ix-booking',
				name: 'Booking UI',
				entryPath: 'apps/booking/app/packages/page.tsx',
			}],
			handlers: {
				ensureServer: async () => { throw new Error('should not run'); },
				navigate: async () => { throw new Error('not expected'); },
				click: async () => { throw new Error('not expected'); },
				assertText: async () => { throw new Error('not expected'); },
				verifySurface: async () => ({ passed: true, report: 'ok' }),
			},
		});
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.ixChecked, true);
		assert.match(result.steps[0]?.detail ?? '', /Ix subsystem missing/);
	});
});

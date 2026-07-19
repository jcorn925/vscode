/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { WorkspaceSurface } from '../../../../../../custom/goalWorkspace/ConsoleService.js';
import { scopeIxRegionsToSurface } from '../../../../../../custom/goalWorkspace/surfaceIxScope.js';
import type { IIxIntegrationService } from '../../../../../../custom/ix/IxIntegrationService.js';
import { SurfaceIxSubsystemsPanel } from '../surfaceIxSubsystemsPanel.js';

suite('surfaceIxSubsystemsPanel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('scopeIxRegionsToSurface keeps path-scoped and declared regions', () => {
		const regions = [
			{
				regionId: 'calendar',
				name: 'Editorial Calendar UI',
				entryPath: 'apps/content-scheduler/app/calendar/page.tsx',
				memberFiles: ['apps/content-scheduler/app/calendar/page.tsx'],
			},
			{
				regionId: 'shared-declared',
				name: 'Content Domain',
				entryPath: 'packages/content/domain.ts',
			},
			{
				regionId: 'unrelated',
				name: 'Billing System',
				entryPath: 'apps/subscriptions/app/billing/page.tsx',
			},
		];
		const surface = createSurface();

		const scoped = scopeIxRegionsToSurface(regions, surface, 'apps/content-scheduler');

		assert.deepStrictEqual(scoped.map(region => region.regionId), ['calendar', 'shared-declared']);
	});

	test('scopeIxRegionsToSurface fuzzy-matches pathless regions by surface id', () => {
		const regions = [
			{ regionId: 'uuid-main', name: 'Cadre Support Bot' },
			{ regionId: 'uuid-ui', name: 'Ui / Cadre-support-bot' },
			{ regionId: 'uuid-ai', name: 'Ai / Cadre-support-bot' },
			{ regionId: 'uuid-stale', name: 'Cadre Bot' },
			{ regionId: 'uuid-other', name: 'Inbound Admin' },
		];
		const surface: WorkspaceSurface = {
			id: 'cadre-support-bot',
			name: 'Cadre AI Support Chatbot',
			path: 'apps/cadre-support-bot',
			capabilities: [],
			events: [],
			entities: [],
			ixSubsystems: [],
		};

		const scoped = scopeIxRegionsToSurface(regions, surface, 'apps/cadre-support-bot');

		assert.deepStrictEqual(scoped.map(region => region.regionId).sort(), [
			'uuid-ai',
			'uuid-main',
			'uuid-ui',
		]);
	});

	test('renders discovered subsystem roots and member files', async () => {
		const root = document.createElement('div');
		const ix = createIxService();
		const panel = new SurfaceIxSubsystemsPanel(root, ix);
		try {
			await panel.load({
				surface: createSurface(),
				workspaceFolder: URI.file('/workspace'),
			});

			assert.ok(root.textContent?.includes('Editorial Calendar UI'));
			assert.ok(root.textContent?.includes('apps/content-scheduler/app/calendar/page.tsx'));
			assert.ok(root.textContent?.includes('1 subsystems'));
			assert.strictEqual(root.querySelectorAll('.custom-mode-surface-ix-subsystems-node-root').length, 1);
		} finally {
			panel.dispose();
		}
	});

	test('empty state mentions overlay when Ix returned regions but none matched', async () => {
		const root = document.createElement('div');
		const ix = {
			mapPath: async () => ({ ok: true, raw: '', command: 'ix map apps/other' }),
			ensureIxMappedIfEmpty: async () => ({ statsPreview: 'nodes (2 total)', ranMap: false, statsOk: true }),
			runJsonQuery: async () => ({
				ok: true,
				raw: '',
				value: {
					subsystems: [
						{ id: 'billing', label: 'Billing System', path: 'apps/subscriptions' },
						{ id: 'admin', label: 'Admin Console', path: 'apps/admin' },
					],
				},
			}),
		} as unknown as IIxIntegrationService;
		const panel = new SurfaceIxSubsystemsPanel(root, ix);
		try {
			await panel.load({
				surface: {
					id: 'cadre-support-bot',
					name: 'Cadre Support',
					path: 'apps/cadre-support-bot',
					capabilities: [],
					events: [],
					entities: [],
					ixSubsystems: [],
				},
				workspaceFolder: URI.file('/workspace'),
			});

			assert.match(root.textContent ?? '', /Ix found 2 subsystem/);
			assert.match(root.textContent ?? '', /ix-surface-map\.json/);
		} finally {
			panel.dispose();
		}
	});
});

function createSurface(): WorkspaceSurface {
	return {
		id: 'content-scheduler',
		name: 'Content Scheduler',
		path: 'apps/content-scheduler',
		capabilities: ['schedule-content'],
		events: [],
		entities: ['Post'],
		ixSubsystems: ['Content Domain'],
		ix: {
			subsystemIds: ['shared-declared'],
			subsystemLabels: ['Content Domain'],
			tags: [],
		},
	};
}

function createIxService(): IIxIntegrationService {
	return {
		mapPath: async () => ({ ok: true, raw: '', command: 'ix map apps/content-scheduler' }),
		ensureIxMappedIfEmpty: async () => ({ statsPreview: 'nodes (4 total)', ranMap: false, statsOk: true }),
		runJsonQuery: async () => ({
			ok: true,
			raw: '',
			value: {
				subsystems: [{
					id: 'calendar',
					label: 'Editorial Calendar UI',
					path: 'apps/content-scheduler/app/calendar/page.tsx',
					files: [{ path: 'apps/content-scheduler/app/calendar/page.tsx' }],
					file_count: 1,
				}],
			},
		}),
	} as unknown as IIxIntegrationService;
}

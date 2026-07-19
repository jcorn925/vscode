/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseIxSubsystemRegions } from '../../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import { scopeIxRegionsToSurface } from '../../../../../../custom/goalWorkspace/surfaceIxScope.js';
import { toIxSubsystemRegions } from '../../../../../../custom/goalWorkspace/surfaceIxMatch.js';

suite('surfaceBlueprintIxDiscovery', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parseIxSubsystemRegions accepts discoveredSubsystems wrapper with path/label/id', () => {
		const parsed = parseIxSubsystemRegions({
			discoveredSubsystems: [
				{
					id: '8897c2d5-6592-36f6-aea3-dbd48fc8ea23',
					label: 'Cadre Support Bot',
					kind: 'subsystem',
					path: 'apps/cadre-support-bot',
					fileCount: 6,
				},
				{
					id: '9e919031-de8e-3e64-955f-7c96c29adc46',
					label: 'Ui / Cadre-support-bot',
					path: 'apps/cadre-support-bot/components',
					fileCount: 5,
				},
			],
		});
		assert.strictEqual(parsed.length, 2);
		assert.strictEqual(parsed[0]!.regionId, '8897c2d5-6592-36f6-aea3-dbd48fc8ea23');
		assert.strictEqual(parsed[0]!.name, 'Cadre Support Bot');
		assert.strictEqual(parsed[0]!.entryPath, 'apps/cadre-support-bot');
		assert.strictEqual(parsed[0]!.fileCount, 6);
	});

	test('scopeIxRegionsToSurface path-matches apps/<surface> without declared metadata', () => {
		const regions = toIxSubsystemRegions(parseIxSubsystemRegions({
			discoveredSubsystems: [
				{ id: 'a', label: 'Cadre Support Bot', path: 'apps/cadre-support-bot', fileCount: 6 },
				{ id: 'b', label: 'Other', path: 'apps/other-app', fileCount: 2 },
			],
		}));
		const scoped = scopeIxRegionsToSurface(regions, {
			id: 'cadre-support-bot',
			name: 'Cadre AI Support Chatbot',
			path: 'apps/cadre-support-bot',
			capabilities: [],
			entities: [],
			ixSubsystems: [],
		});
		assert.deepStrictEqual(scoped.map(r => r.regionId), ['a']);
	});

	test('scopeIxRegionsToSurface matches declared label and uuid', () => {
		const regions = toIxSubsystemRegions(parseIxSubsystemRegions({
			subsystems: [
				{ id: 'uuid-1', label: 'Cadre Support Bot', path: 'packages/shared' },
			],
		}));
		const scoped = scopeIxRegionsToSurface(regions, {
			id: 'cadre-support-bot',
			name: 'Cadre',
			path: 'apps/cadre-support-bot',
			capabilities: [],
			entities: [],
			ixSubsystems: ['Cadre Support Bot', 'uuid-1'],
		});
		assert.strictEqual(scoped.length, 1);
		assert.strictEqual(scoped[0]!.name, 'Cadre Support Bot');
	});
});

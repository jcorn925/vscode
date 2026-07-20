/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseIxSubsystemRegions } from '../../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import {
	enrichSurfaceWithIxOverlay,
	isIxSourceFilePath,
	mergeIxSubsystemRegions,
	regionsFromIxOverlayDiscovered,
	scopeIxRegionsToSurface,
	shouldExpandIxRegionMembers,
	shouldSkipIxWalkDir,
} from '../../../../../../custom/goalWorkspace/surfaceIxScope.js';
import { toIxSubsystemRegions } from '../../../../../../custom/goalWorkspace/surfaceIxMatch.js';
import type { IxOverlay } from '../../../../../../custom/goalWorkspace/ConsoleService.js';

suite('surfaceBlueprintIxDiscovery', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shouldExpandIxRegionMembers when overlay only has a directory path', () => {
		assert.strictEqual(shouldExpandIxRegionMembers({
			entryPath: 'apps/cadre-support-bot',
			memberFiles: undefined,
		}), true);
		assert.strictEqual(shouldExpandIxRegionMembers({
			entryPath: 'apps/cadre-support-bot/components/chat.tsx',
			memberFiles: undefined,
		}), false);
		assert.strictEqual(shouldExpandIxRegionMembers({
			entryPath: 'apps/cadre-support-bot',
			memberFiles: ['apps/cadre-support-bot/components/chat.tsx'],
		}), false);
		assert.ok(isIxSourceFilePath('apps/cadre-support-bot/components/chat.tsx'));
		assert.ok(!isIxSourceFilePath('apps/cadre-support-bot/.env.local'));
		assert.ok(shouldSkipIxWalkDir('node_modules'));
		assert.ok(shouldSkipIxWalkDir('.next'));
		assert.ok(!shouldSkipIxWalkDir('components'));
	});

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

	test('overlay discoveredSubsystems fill Graph when live Ix regions are empty', () => {
		const overlay: IxOverlay = {
			resource: URI.file('/tmp/ws/.agent/ix-surface-map.json'),
			generatedAt: '2026-07-19T00:00:00.000Z',
			command: 'ix map --all-items .',
			discoveredSubsystems: [
				{
					id: '8897c2d5-6592-36f6-aea3-dbd48fc8ea23',
					label: 'Cadre Support Bot',
					path: 'apps/cadre-support-bot',
					fileCount: 6,
				},
				{
					id: '9e919031-de8e-3e64-955f-7c96c29adc46',
					label: 'Ui / Cadre-support-bot',
					path: 'apps/cadre-support-bot/components',
					fileCount: 5,
				},
				{
					id: 'other-app',
					label: 'Other App',
					path: 'apps/other-app',
					fileCount: 3,
				},
			],
			surfaces: [
				{
					surfaceId: 'cadre-support-bot',
					subsystemIds: ['8897c2d5-6592-36f6-aea3-dbd48fc8ea23'],
					subsystemLabels: ['Cadre Support Bot', 'Ui / Cadre-support-bot'],
					matchReason: 'path',
				},
			],
		};

		const liveRegions: ReturnType<typeof toIxSubsystemRegions> = [];
		const overlayRegions = regionsFromIxOverlayDiscovered(overlay.discoveredSubsystems);
		const merged = mergeIxSubsystemRegions(liveRegions, overlayRegions);
		assert.strictEqual(merged.length, 3);

		const surface = enrichSurfaceWithIxOverlay({
			id: 'cadre-support-bot',
			name: 'Cadre AI Support Chatbot',
			path: 'apps/cadre-support-bot',
			capabilities: [],
			entities: [],
			ixSubsystems: [],
		}, overlay);
		assert.ok(surface.ixSubsystems.includes('Cadre Support Bot'));
		assert.ok(surface.ix?.subsystemIds.includes('8897c2d5-6592-36f6-aea3-dbd48fc8ea23'));

		const scoped = scopeIxRegionsToSurface(merged, surface, 'apps/cadre-support-bot');
		assert.deepStrictEqual(scoped.map(r => r.regionId).sort(), [
			'8897c2d5-6592-36f6-aea3-dbd48fc8ea23',
			'9e919031-de8e-3e64-955f-7c96c29adc46',
		].sort());
	});

	test('mergeIxSubsystemRegions prefers live regions over overlay on id collision', () => {
		const live = toIxSubsystemRegions([{
			regionId: 'same-id',
			name: 'Live Name',
			entryPath: 'apps/cadre-support-bot',
			fileCount: 10,
		}]);
		const overlay = regionsFromIxOverlayDiscovered([{
			id: 'same-id',
			label: 'Overlay Name',
			path: 'apps/cadre-support-bot',
			fileCount: 2,
		}]);
		const merged = mergeIxSubsystemRegions(live, overlay);
		assert.strictEqual(merged.length, 1);
		assert.strictEqual(merged[0]!.name, 'Live Name');
		assert.strictEqual(merged[0]!.fileCount, 10);
	});
});

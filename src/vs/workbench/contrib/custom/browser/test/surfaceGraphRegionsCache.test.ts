/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import {
	parseSurfaceGraphRegionsCache,
	surfaceGraphRegionsCacheResource,
} from '../surfaceGraphRegionsCache.js';

suite('surfaceGraphRegionsCache', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('surfaceGraphRegionsCacheResource path', () => {
		const uri = surfaceGraphRegionsCacheResource(URI.file('/tmp/ws'), 'cadre-support-bot');
		assert.ok(uri.path.endsWith('/.agent/surfaces/cadre-support-bot.graph-regions.json'));
	});

	test('parseSurfaceGraphRegionsCache accepts regions', () => {
		const doc = parseSurfaceGraphRegionsCache(JSON.stringify({
			version: 1,
			surfaceId: 'cadre-support-bot',
			updatedAt: '2026-07-19T00:00:00.000Z',
			regions: [
				{
					name: 'Chat',
					entryPath: 'apps/support/app/page.tsx',
					memberFiles: ['apps/support/app/page.tsx', 'apps/support/lib/bot.ts'],
					fileCount: 2,
				},
			],
		}));
		assert.ok(doc);
		assert.strictEqual(doc!.surfaceId, 'cadre-support-bot');
		assert.strictEqual(doc!.regions.length, 1);
		assert.strictEqual(doc!.regions[0].name, 'Chat');
		assert.deepStrictEqual(doc!.regions[0].memberFiles, [
			'apps/support/app/page.tsx',
			'apps/support/lib/bot.ts',
		]);
	});

	test('parseSurfaceGraphRegionsCache rejects bad version', () => {
		assert.strictEqual(parseSurfaceGraphRegionsCache(JSON.stringify({
			version: 2,
			surfaceId: 'x',
			regions: [],
		})), undefined);
	});
});

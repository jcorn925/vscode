/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	deleteSurfaceUiSnapshot,
	isSurfaceUiSnapshotSidecarFresh,
	normalizeSurfaceUiSnapshotUrl,
	parseSurfaceUiSnapshotSidecar,
	preferredSurfaceUiSnapshotSource,
	resolveSurfaceUiSnapshotForCard,
	sanitizeSurfaceUiSnapshotId,
	shouldCaptureSurfaceUiSnapshot,
	surfaceUiSnapshotImageResource,
	surfaceUiSnapshotUrlsMatch,
	writeSurfaceUiSnapshot,
} from '../../../../../../custom/goalWorkspace/surfaceUiSnapshot.js';
import type { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';

suite('surfaceUiSnapshot', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('prefers productionUrl over localUrl', () => {
		assert.deepStrictEqual(preferredSurfaceUiSnapshotSource({
			productionUrl: 'https://bot.example',
			localUrl: 'http://localhost:3100',
		}), { url: 'https://bot.example', kind: 'deployed' });
		assert.deepStrictEqual(preferredSurfaceUiSnapshotSource({
			localUrl: 'http://localhost:3100',
		}), { url: 'http://localhost:3100', kind: 'local' });
		assert.strictEqual(preferredSurfaceUiSnapshotSource({}), undefined);
	});

	test('normalizes cache-bust query for URL identity', () => {
		const a = 'https://bot.example/app?_vscodeUiReload=1';
		const b = 'https://bot.example/app';
		assert.strictEqual(normalizeSurfaceUiSnapshotUrl(a), b);
		assert.strictEqual(surfaceUiSnapshotUrlsMatch(a, b), true);
	});

	test('freshness requires matching sourceUrl and recent capturedAt', () => {
		const now = Date.parse('2026-07-26T18:00:00.000Z');
		const sidecar = {
			sourceUrl: 'https://bot.example',
			capturedAt: '2026-07-26T12:00:00.000Z',
			kind: 'deployed' as const,
		};
		assert.strictEqual(isSurfaceUiSnapshotSidecarFresh(sidecar, 'https://bot.example', now), true);
		assert.strictEqual(isSurfaceUiSnapshotSidecarFresh(sidecar, 'https://other.example', now), false);
		assert.strictEqual(shouldCaptureSurfaceUiSnapshot(sidecar, 'https://bot.example', now), false);
		assert.strictEqual(shouldCaptureSurfaceUiSnapshot(sidecar, 'https://other.example', now), true);
		assert.strictEqual(shouldCaptureSurfaceUiSnapshot(undefined, 'https://bot.example', now), true);
		assert.strictEqual(
			isSurfaceUiSnapshotSidecarFresh(sidecar, 'https://bot.example', now, 60 * 60 * 1000),
			false,
		);
	});

	test('parse rejects incomplete sidecar JSON', () => {
		assert.strictEqual(parseSurfaceUiSnapshotSidecar('{"sourceUrl":"https://x"}'), undefined);
		assert.ok(parseSurfaceUiSnapshotSidecar(JSON.stringify({
			sourceUrl: 'https://bot.example',
			capturedAt: '2026-07-26T12:00:00.000Z',
			kind: 'local',
		})));
	});

	test('write/read/delete snapshot cache under .agent/surfaces/<id>/', async () => {
		const folder = URI.file('/tmp/surface-ui-snapshot-test');
		const files = new Map<string, VSBuffer>();
		const fileService = {
			async createFolder() { /* no-op */ },
			async exists(resource: URI) {
				return files.has(resource.toString());
			},
			async readFile(resource: URI): Promise<IFileContent> {
				const value = files.get(resource.toString());
				if (!value) {
					throw new Error('missing');
				}
				return { resource, value } as IFileContent;
			},
			async writeFile(resource: URI, value: VSBuffer) {
				files.set(resource.toString(), value);
				return { resource } as never;
			},
			async del(resource: URI) {
				files.delete(resource.toString());
			},
		} as unknown as IFileService;

		const surfaceId = 'cadre support/bot';
		assert.strictEqual(sanitizeSurfaceUiSnapshotId(surfaceId), 'cadre-support-bot');

		await writeSurfaceUiSnapshot(fileService, folder, surfaceId, {
			imageBytes: VSBuffer.fromString('fake-jpeg'),
			sourceUrl: 'https://bot.example/?_vscodeUiReload=9',
			kind: 'deployed',
			capturedAt: '2026-07-26T12:00:00.000Z',
		});

		const image = surfaceUiSnapshotImageResource(folder, surfaceId);
		assert.ok(files.has(image.toString()));

		const resolved = await resolveSurfaceUiSnapshotForCard(
			fileService,
			folder,
			surfaceId,
			'https://bot.example/',
		);
		assert.ok(resolved);
		assert.strictEqual(resolved!.sidecar.kind, 'deployed');
		assert.strictEqual(resolved!.sidecar.sourceUrl, 'https://bot.example/');

		const stale = await resolveSurfaceUiSnapshotForCard(
			fileService,
			folder,
			surfaceId,
			'https://other.example',
		);
		assert.strictEqual(stale, undefined);

		await deleteSurfaceUiSnapshot(fileService, folder, surfaceId);
		assert.strictEqual(files.size, 0);
	});
});

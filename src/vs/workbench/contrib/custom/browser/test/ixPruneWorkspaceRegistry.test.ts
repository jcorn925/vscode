/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildIxPruneWorkspaceRegistryArgs,
	formatIxPruneWorkspaceRegistryDetail,
	parseIxPruneWorkspaceRegistrySummary,
} from '../../../../../../custom/ix/ixPruneWorkspaceRegistry.js';

suite('ixPruneWorkspaceRegistry', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('buildIxPruneWorkspaceRegistryArgs omits flags by default', () => {
		assert.deepStrictEqual(buildIxPruneWorkspaceRegistryArgs(), []);
		assert.deepStrictEqual(
			buildIxPruneWorkspaceRegistryArgs({ apply: true, alsoMtimes: true, configPath: '/tmp/config.yaml' }),
			['--config', '/tmp/config.yaml', '--apply', '--also-mtimes'],
		);
	});

	test('parseIxPruneWorkspaceRegistrySummary reads counts and reasons', () => {
		const summary = parseIxPruneWorkspaceRegistrySummary([
			'config: /Users/me/.ix/config.yaml',
			'before: 883',
			'keep:   93',
			'remove: 790',
			'  - root_path is a file, not a directory: 755',
			'  - temp path: 25',
			'  - path does not exist: 6',
			'  - dogfood/throwaway path: 4',
			'',
			'orphan ingest_mtimes_*.json: 4',
			'',
			'Dry-run only. Re-run with --apply to backup and write.',
		].join('\n'));
		assert.ok(summary);
		assert.strictEqual(summary!.before, 883);
		assert.strictEqual(summary!.keep, 93);
		assert.strictEqual(summary!.remove, 790);
		assert.strictEqual(summary!.orphanMtimes, 4);
		assert.deepStrictEqual(summary!.byReason, [
			{ reason: 'root_path is a file, not a directory', count: 755 },
			{ reason: 'temp path', count: 25 },
			{ reason: 'path does not exist', count: 6 },
			{ reason: 'dogfood/throwaway path', count: 4 },
		]);
		assert.ok(formatIxPruneWorkspaceRegistryDetail(summary!).includes('Remove: 790'));
	});

	test('parseIxPruneWorkspaceRegistrySummary returns undefined when counts missing', () => {
		assert.strictEqual(parseIxPruneWorkspaceRegistrySummary('nope'), undefined);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	commonPathPrefix,
	partitionProposalWorkstreams,
} from '../proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument } from '../proposalGraphDiff/proposalGraphDiffTypes.js';

suite('partitionProposalWorkstreams', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('commonPathPrefix finds shared directory', () => {
		assert.strictEqual(
			commonPathPrefix(['file:apps/bot/a.tsx', 'file:apps/bot/b.tsx']),
			'apps/bot',
		);
		assert.strictEqual(commonPathPrefix(['file:a.py']), 'a.py');
	});

	test('splits disconnected clusters into parallel workstreams', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: [
				'file:apps/bot/app/page.tsx',
				'file:apps/bot/components/Chat.tsx',
				'file:apps/bot/package.json',
				'file:apps/bot/next.config.mjs',
			],
			add_edges: [
				{ from: 'file:apps/bot/app/page.tsx', to: 'file:apps/bot/components/Chat.tsx', type: 'imports' } as never,
				{ from: 'file:apps/bot/package.json', to: 'file:apps/bot/next.config.mjs', type: 'configures' } as never,
			],
		};
		const part = partitionProposalWorkstreams(proposal);
		assert.strictEqual(part.workstreams.length, 2);
		assert.strictEqual(part.serializeGroups.length, 0);
		assert.strictEqual(part.canParallelize, true);
		assert.ok(part.workstreams.every(w => w.parallelSafe));
		assert.deepStrictEqual(
			part.workstreams.map(w => w.nodes.length).sort(),
			[2, 2],
		);
	});

	test('ignores REGISTERS/DESCRIBES so docs do not collapse clusters', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: [
				'file:apps/bot/app/page.tsx',
				'file:apps/bot/package.json',
				'file:workspace.goal.json',
			],
			add_edges: [
				{ from: 'file:workspace.goal.json', to: 'file:apps/bot/app/page.tsx', type: 'registers' } as never,
				{ from: 'file:workspace.goal.json', to: 'file:apps/bot/package.json', type: 'registers' } as never,
			],
		};
		const part = partitionProposalWorkstreams(proposal);
		assert.strictEqual(part.workstreams.length, 3);
		assert.strictEqual(part.serializeGroups.length, 0);
		assert.strictEqual(part.softEdgeCount, 2);
		assert.strictEqual(part.structuralEdgeCount, 0);
	});

	test('shared node_prefixes land in serializeGroups, not workstreams', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: [
				'file:apps/a/page.tsx',
				'file:packages/domain/types.ts',
				'file:apps/b/page.tsx',
				'file:packages/domain/events.ts',
			],
			add_edges: [
				{ src: 'file:apps/a/page.tsx', dst: 'file:packages/domain/types.ts', predicate: 'IMPORTS' },
				{ src: 'file:apps/b/page.tsx', dst: 'file:packages/domain/events.ts', predicate: 'IMPORTS' },
			],
			node_prefixes: ['packages/domain'],
		};
		const part = partitionProposalWorkstreams(proposal);
		assert.strictEqual(part.workstreams.length, 0);
		assert.strictEqual(part.serializeGroups.length, 2);
		assert.ok(part.serializeGroups.every(w => !w.parallelSafe));
		assert.ok(part.serializeGroups.every(w => w.sharedPrefixes.includes('packages/domain')));
		assert.strictEqual(part.canParallelize, false);
	});

	test('nodes with no edges become singleton parallel workstreams', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: ['file:a.py', 'file:b.py', 'file:c.py'],
			add_edges: [],
		};
		const part = partitionProposalWorkstreams(proposal);
		assert.strictEqual(part.workstreams.length, 3);
		assert.strictEqual(part.serializeGroups.length, 0);
		assert.strictEqual(part.canParallelize, true);
	});
});

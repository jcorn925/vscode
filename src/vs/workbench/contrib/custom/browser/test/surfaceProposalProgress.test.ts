/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { partitionProposalWorkstreams } from '../proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument, ProposalCompareSnapshot } from '../proposalGraphDiff/proposalGraphDiffTypes.js';
import {
	computeSurfaceProposalProgress,
	formatSurfaceProgressValue,
} from '../surfaceProposalProgress.js';

suite('surfaceProposalProgress', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const proposal: GraphProposalDocument = {
		add_nodes: ['file:a/one.ts', 'file:a/two.ts', 'file:b/three.ts'],
		add_edges: [
			{ src: 'file:a/one.ts', predicate: 'IMPORTS', dst: 'file:a/two.ts', confidence: 'structural' },
			{ src: 'file:a/one.ts', predicate: 'CALLS', dst: 'file:b/three.ts', confidence: 'speculative' },
		],
		node_prefixes: ['file:a/', 'file:b/'],
	};

	test('formatSurfaceProgressValue shows totals until compare exists', () => {
		assert.strictEqual(formatSurfaceProgressValue(2, 5, false), '5');
		assert.strictEqual(formatSurfaceProgressValue(2, 5, true), '2/5');
	});

	test('without snapshot cards stay totals-only', () => {
		const partition = partitionProposalWorkstreams(proposal);
		const progress = computeSurfaceProposalProgress(proposal, partition, undefined);
		assert.strictEqual(progress.hasCompare, false);
		assert.strictEqual(progress.filesTotal, 3);
		assert.strictEqual(progress.filesMatched, 0);
		assert.strictEqual(formatSurfaceProgressValue(progress.filesMatched, progress.filesTotal, progress.hasCompare), '3');
		assert.strictEqual(formatSurfaceProgressValue(progress.relationshipsMatched, progress.relationshipsTotal, progress.hasCompare), '2');
		assert.strictEqual(formatSurfaceProgressValue(progress.workstreamsComplete, progress.workstreamsTotal, progress.hasCompare), String(partition.workstreams.length));
	});

	test('with snapshot reports matched/total for files and relationships', () => {
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			comparison: {
				nodes: {
					recall: 2 / 3,
					matched_in_clone: ['file:a/one.ts', 'file:a/two.ts'],
					missing_in_clone: ['file:b/three.ts'],
				},
				edges: {
					structural: {
						recall: 1,
						matched_in_clone: ['file:a/one.ts --IMPORTS--> file:a/two.ts'],
						missing_in_clone: [],
					},
					speculative: {
						missing_in_clone: [],
					},
				},
			},
		};
		const partition = partitionProposalWorkstreams(proposal);
		const progress = computeSurfaceProposalProgress(proposal, partition, snapshot);
		assert.strictEqual(progress.hasCompare, true);
		assert.strictEqual(progress.filesMatched, 2);
		assert.strictEqual(progress.filesTotal, 3);
		assert.strictEqual(progress.relationshipsMatched, 2);
		assert.strictEqual(progress.relationshipsTotal, 2);
		assert.strictEqual(formatSurfaceProgressValue(progress.filesMatched, progress.filesTotal, true), '2/3');
		assert.strictEqual(formatSurfaceProgressValue(progress.relationshipsMatched, progress.relationshipsTotal, true), '2/2');
	});

	test('derives per-workstream matched/total and complete stream count', () => {
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			comparison: {
				nodes: {
					matched_in_clone: ['file:a/one.ts', 'file:a/two.ts'],
					missing_in_clone: ['file:b/three.ts'],
				},
				edges: {
					structural: {
						matched_in_clone: ['file:a/one.ts --IMPORTS--> file:a/two.ts'],
						missing_in_clone: [],
					},
				},
			},
		};
		const partition = partitionProposalWorkstreams(proposal);
		const progress = computeSurfaceProposalProgress(proposal, partition, snapshot);
		assert.ok(progress.byWorkstream.length >= 1);
		const aStream = progress.byWorkstream.find(stream => stream.id.includes('a') || stream.totalNodes === 2)
			?? progress.byWorkstream.find(stream => stream.matchedNodes === 2);
		assert.ok(aStream, 'expected a workstream covering the matched a/* files');
		assert.strictEqual(aStream.matchedNodes, aStream.totalNodes);
		assert.ok(progress.workstreamsComplete >= 1);
		assert.strictEqual(progress.workstreamsTotal, partition.workstreams.length);
		assert.strictEqual(
			formatSurfaceProgressValue(progress.workstreamsComplete, progress.workstreamsTotal, true),
			`${progress.workstreamsComplete}/${progress.workstreamsTotal}`,
		);
	});

	test('counts structural edge missing toward relationship progress', () => {
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			comparison: {
				nodes: {
					matched_in_clone: ['file:a/one.ts', 'file:a/two.ts', 'file:b/three.ts'],
					missing_in_clone: [],
				},
				edges: {
					structural: {
						matched_in_clone: [],
						missing_in_clone: ['file:a/one.ts --IMPORTS--> file:a/two.ts'],
					},
					speculative: {
						missing_in_clone: ['file:a/one.ts --CALLS--> file:b/three.ts'],
					},
				},
			},
		};
		const progress = computeSurfaceProposalProgress(proposal, undefined, snapshot);
		assert.strictEqual(progress.relationshipsMatched, 0);
		assert.strictEqual(progress.relationshipsTotal, 2);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildProposalDiffGraph,
	displayLabelForCanonicalId,
	kindForCanonicalId,
} from '../proposalGraphDiff/buildProposalDiffGraph.js';
import type { GraphProposalDocument, ProposalCompareSnapshot } from '../proposalGraphDiff/proposalGraphDiffTypes.js';

suite('buildProposalDiffGraph', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('display labels strip kind prefixes', () => {
		assert.strictEqual(displayLabelForCanonicalId('file:database/pool.py'), 'database/pool.py');
		assert.strictEqual(
			displayLabelForCanonicalId('function:database/pool.py::_encode_vector'),
			'_encode_vector (database/pool.py)',
		);
		assert.strictEqual(kindForCanonicalId('class:a.py::Foo'), 'symbol');
		assert.strictEqual(kindForCanonicalId('file:a.py'), 'file');
	});

	test('colors matched and missing nodes from snapshot lists', () => {
		const proposal: GraphProposalDocument = {
			version: 1,
			tree_id: 'northstar',
			add_nodes: ['file:api/main.py', 'file:database/pool.py', 'file:agent/prompts.py'],
			add_edges: [],
		};
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			proposal: { tree_id: 'northstar', path: '/tmp/p.json' },
			clone: { workspace_id: 'abc123' },
			comparison: {
				nodes: {
					recall: 0.666667,
					matched_in_clone: ['file:api/main.py', 'file:database/pool.py'],
					missing_in_clone: ['file:agent/prompts.py'],
				},
				edges: { structural: { recall: 1.0, matched_in_clone: [], missing_in_clone: [] } },
				removals: { nodes_still_present: [], edges_still_present: [] },
			},
		};

		const graph = buildProposalDiffGraph(proposal, snapshot);

		assert.strictEqual(graph.summary.matchedNodes, 2);
		assert.strictEqual(graph.summary.missingNodes, 1);
		assert.strictEqual(graph.summary.nodeRecall, 0.666667);
		assert.strictEqual(graph.summary.passed, false);
		assert.strictEqual(statusOf(graph, 'file:api/main.py'), 'matched');
		assert.strictEqual(statusOf(graph, 'file:agent/prompts.py'), 'missing');
	});

	test('derives matched when matched_in_clone omitted', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: ['file:a.py', 'file:b.py'],
		};
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			comparison: {
				nodes: {
					recall: 0.5,
					missing_in_clone: ['file:b.py'],
				},
			},
		};

		const graph = buildProposalDiffGraph(proposal, snapshot);
		assert.strictEqual(statusOf(graph, 'file:a.py'), 'matched');
		assert.strictEqual(statusOf(graph, 'file:b.py'), 'missing');
	});

	test('marks removal_still_present nodes', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: ['file:keep.py'],
			remove_nodes: ['file:legacy.py'],
		};
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			comparison: {
				nodes: {
					recall: 1.0,
					matched_in_clone: ['file:keep.py'],
					missing_in_clone: [],
				},
				removals: { nodes_still_present: ['file:legacy.py'] },
			},
		};

		const graph = buildProposalDiffGraph(proposal, snapshot);
		assert.strictEqual(statusOf(graph, 'file:legacy.py'), 'removal_still_present');
		assert.strictEqual(graph.summary.removalNodes, 1);
	});

	test('structural edges are matched or missing; speculative missing is advisory', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: ['file:a.py', 'file:b.py', 'file:c.py'],
			add_edges: [
				{ src: 'file:a.py', predicate: 'IMPORTS', dst: 'file:b.py', confidence: 'structural' },
				{ src: 'file:a.py', predicate: 'CALLS', dst: 'file:c.py', confidence: 'speculative' },
			],
		};
		const snapshot: ProposalCompareSnapshot = {
			passed: false,
			comparison: {
				nodes: {
					recall: 1.0,
					matched_in_clone: ['file:a.py', 'file:b.py', 'file:c.py'],
					missing_in_clone: [],
				},
				edges: {
					structural: {
						recall: 0.0,
						matched_in_clone: [],
						missing_in_clone: ['file:a.py --IMPORTS--> file:b.py'],
					},
					speculative: {
						recall: 0.0,
						missing_in_clone: ['file:a.py --CALLS--> file:c.py'],
					},
				},
			},
		};

		const graph = buildProposalDiffGraph(proposal, snapshot);
		const structural = graph.edges.find(e => e.predicate === 'IMPORTS');
		const speculative = graph.edges.find(e => e.predicate === 'CALLS');
		assert.ok(structural);
		assert.strictEqual(structural.status, 'missing');
		assert.strictEqual(structural.confidence, 'structural');
		assert.ok(speculative);
		assert.strictEqual(speculative.status, 'speculative_missing');
		assert.strictEqual(speculative.confidence, 'speculative');
	});
});

function statusOf(graph: ReturnType<typeof buildProposalDiffGraph>, canonicalId: string): string | undefined {
	return graph.nodes.find(n => n.canonicalId === canonicalId)?.status;
}

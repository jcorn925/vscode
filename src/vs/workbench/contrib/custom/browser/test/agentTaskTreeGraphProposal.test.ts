/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildGraphProposalFromPlan,
	isCanonicalGraphNodeId,
	mergeGraphProposalEnrichment,
	normalizeProposalPath,
	parseGraphProposal,
	parseGraphProposalEnrichment,
	serializeGraphProposal,
	type AgentTaskTreeGraphProposal,
} from '../../../../../../custom/agentTaskTree/agentTaskTreeGraphProposal.js';
import type { AgentTaskTree } from '../../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';

suite('agentTaskTreeGraphProposal', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('canonical node ID validation accepts path and symbol kinds only', () => {
		assert.ok(isCanonicalGraphNodeId('file:backend/api.py'));
		assert.ok(isCanonicalGraphNodeId('module:backend'));
		assert.ok(isCanonicalGraphNodeId('function:backend/api.py::create_task'));
		assert.ok(isCanonicalGraphNodeId('class:apps/marketing/components/TaskCard.tsx::TaskCard'));

		assert.ok(!isCanonicalGraphNodeId('backend/api.py'), 'missing kind prefix');
		assert.ok(!isCanonicalGraphNodeId('widget:backend/api.py'), 'unknown kind');
		assert.ok(!isCanonicalGraphNodeId('function:backend/api.py'), 'symbol kind without name');
		assert.ok(!isCanonicalGraphNodeId('file:backend/api.py::name'), 'path kind with symbol separator');
		assert.ok(!isCanonicalGraphNodeId('file:/backend/api.py'), 'absolute path');
	});

	test('builder classifies file paths as nodes and directories as prefixes', () => {
		const proposal = buildGraphProposalFromPlan({
			tree: surfaceTree(),
			subsystems: [
				{ id: 'home-route', label: 'Home Route', kind: 'route', paths: ['apps/marketing/app/page.tsx'], minFiles: 1 },
				{ id: 'shared', label: 'Shared Domain', kind: 'shared', paths: ['packages/domain'], minFiles: 1 },
			],
			planRef: '.agent/task-trees/marketing-tree.json',
			createdAt: '2026-07-15T00:00:00.000Z',
		});

		assert.deepStrictEqual(proposal.addNodes, [
			'file:apps/marketing/app/offers/page.tsx',
			'file:apps/marketing/app/page.tsx',
			'file:workspace.goal.json',
		]);
		assert.deepStrictEqual(proposal.nodePrefixes, ['apps/marketing/components', 'packages/domain']);
		assert.deepStrictEqual(proposal.addEdges, [], 'no edges are guessed');
		assert.strictEqual(proposal.treeId, 'marketing-tree');
		assert.strictEqual(proposal.surfaceId, 'marketing');
		assert.strictEqual(proposal.root, '');
	});

	test('path normalization preserves case, unlike ix validation matching', () => {
		assert.strictEqual(normalizeProposalPath('apps/Foo/components/TaskCard.tsx'), 'apps/Foo/components/TaskCard.tsx');
		assert.strictEqual(normalizeProposalPath('./apps//foo\\bar/'), 'apps/foo/bar');
	});

	test('serialization round-trips through the snake_case parser', () => {
		const proposal = buildGraphProposalFromPlan({
			tree: surfaceTree(),
			planRef: '.agent/task-trees/marketing-tree.json',
			createdAt: '2026-07-15T00:00:00.000Z',
		});

		const serialized = serializeGraphProposal(proposal);
		const document = JSON.parse(serialized);
		assert.strictEqual(document.tree_id, 'marketing-tree');
		assert.strictEqual(document.surface_id, 'marketing');
		assert.strictEqual(document.plan_ref, '.agent/task-trees/marketing-tree.json');
		assert.ok(Array.isArray(document.add_nodes));

		const parsed = parseGraphProposal(document);
		assert.deepStrictEqual(parsed, proposal);
	});

	test('parser rejects malformed documents and drops invalid entries', () => {
		assert.strictEqual(parseGraphProposal({ version: 2 }), undefined);
		assert.strictEqual(parseGraphProposal({ version: 1, tree_id: 't' }), undefined);

		const parsed = parseGraphProposal({
			version: 1,
			tree_id: 'tree-1',
			plan_ref: 'plan.json',
			created_at: '2026-07-15T00:00:00.000Z',
			root: '',
			add_nodes: ['file:ok.py', 'not-canonical', 'widget:bad/kind.py'],
			add_edges: [
				{ src: 'file:ok.py', predicate: 'IMPORTS', dst: 'file:other.py', confidence: 'structural' },
				{ src: 'file:ok.py', predicate: 'USES', dst: 'file:other.py' },
			],
		});

		assert.ok(parsed);
		assert.deepStrictEqual(parsed.addNodes, ['file:ok.py']);
		assert.deepStrictEqual(parsed.addEdges, [
			{ src: 'file:ok.py', predicate: 'IMPORTS', dst: 'file:other.py', confidence: 'structural' },
		]);
	});

	test('enrichment defaults edges to speculative and merges without duplicates', () => {
		const base: AgentTaskTreeGraphProposal = buildGraphProposalFromPlan({
			tree: surfaceTree(),
			planRef: '.agent/task-trees/marketing-tree.json',
			createdAt: '2026-07-15T00:00:00.000Z',
		});

		const enrichment = parseGraphProposalEnrichment({
			add_nodes: ['file:apps/marketing/app/page.tsx', 'function:apps/marketing/app/page.tsx::Page'],
			add_edges: [
				{ src: 'function:apps/marketing/app/page.tsx::Page', predicate: 'CALLS', dst: 'function:packages/domain/index.ts::listOffers' },
			],
		});
		assert.ok(enrichment);
		assert.strictEqual(enrichment.addEdges[0].confidence, 'speculative');

		const merged = mergeGraphProposalEnrichment(base, enrichment);
		assert.strictEqual(merged.addNodes.filter(node => node === 'file:apps/marketing/app/page.tsx').length, 1);
		assert.ok(merged.addNodes.includes('function:apps/marketing/app/page.tsx::Page'));
		assert.strictEqual(merged.addEdges.length, 1);
	});

	test('merging the same edge as structural upgrades a speculative duplicate', () => {
		const base: AgentTaskTreeGraphProposal = {
			version: 1,
			treeId: 'tree-1',
			planRef: 'plan.json',
			createdAt: '2026-07-15T00:00:00.000Z',
			root: '',
			addNodes: [],
			addEdges: [{ src: 'file:a.py', predicate: 'IMPORTS', dst: 'file:b.py', confidence: 'speculative' }],
			removeNodes: [],
			removeEdges: [],
			nodePrefixes: [],
		};

		const merged = mergeGraphProposalEnrichment(base, {
			addNodes: [],
			addEdges: [{ src: 'file:a.py', predicate: 'IMPORTS', dst: 'file:b.py', confidence: 'structural' }],
			removeNodes: [],
			removeEdges: [],
			nodePrefixes: [],
		});

		assert.strictEqual(merged.addEdges.length, 1);
		assert.strictEqual(merged.addEdges[0].confidence, 'structural');
	});

	test('empty or invalid enrichment payloads are rejected', () => {
		assert.strictEqual(parseGraphProposalEnrichment(undefined), undefined);
		assert.strictEqual(parseGraphProposalEnrichment('nope'), undefined);
		assert.strictEqual(parseGraphProposalEnrichment({}), undefined);
		assert.strictEqual(parseGraphProposalEnrichment({ add_nodes: ['not canonical'] }), undefined);
	});
});

function surfaceTree(): AgentTaskTree {
	return {
		version: 1,
		id: 'marketing-tree',
		prompt: 'Build marketing surface',
		createdAt: '2026-07-15T00:00:00.000Z',
		updatedAt: '2026-07-15T00:00:00.000Z',
		status: 'active',
		surfaceId: 'marketing',
		surfaceName: 'Marketing Site',
		templateId: 'marketing',
		roots: [{
			id: 'root-1',
			title: 'Root',
			type: 'root',
			status: 'pending',
			order: 1,
			children: [
				{
					id: 'leaf-1',
					parentId: 'root-1',
					title: 'Build offers route',
					type: 'leaf',
					status: 'pending',
					order: 1,
					expectedPaths: ['apps/marketing/app/offers/page.tsx', 'apps/marketing/components'],
				},
				{
					id: 'leaf-2',
					parentId: 'root-1',
					title: 'Register surface',
					type: 'leaf',
					status: 'pending',
					order: 2,
					expectedPaths: ['workspace.goal.json'],
				},
			],
		}],
		cursor: {},
	};
}

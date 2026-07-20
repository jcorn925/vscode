/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	orderSurfaceProposalTreeCards,
	orderSurfaceProposalTreeSectionIds,
	staticSurfaceProposalTreeCards,
	surfaceGraphRegionsCardValue,
	surfaceProposedGraphCardValue,
	surfaceProposalTreeCardsFromDocument,
	SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
	SURFACE_PROPOSAL_TREE_SECTION_ORDER,
	type SurfaceProposalTreeCardItem,
} from '../surfaceProposalTreeCards.js';

suite('orderSurfaceProposalTreeCards', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('staticSurfaceProposalTreeCards paints core sections in canonical order', () => {
		const cards = staticSurfaceProposalTreeCards({
			localUrl: 'http://localhost:3000',
			purposeValue: 'Acquire clients.',
		});
		assert.deepStrictEqual(cards.map(c => c.id), ['proposed', 'graph', 'preview', 'deployed', 'description', 'plan', 'rules']);
		assert.strictEqual(cards.find(c => c.id === 'preview')?.value, 'URL');
		assert.strictEqual(cards.find(c => c.id === 'deployed')?.value, SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(cards.find(c => c.id === 'graph')?.value, SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(cards.find(c => c.id === 'description')?.value, 'Acquire clients.');
		assert.strictEqual(
			staticSurfaceProposalTreeCards({ productionUrl: 'https://cadre.vercel.app' }).find(c => c.id === 'deployed')?.value,
			'Vercel',
		);
		assert.strictEqual(
			staticSurfaceProposalTreeCards().find(c => c.id === 'description')?.value,
			SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		);
	});

	test('surfaceGraphRegionsCardValue counts member files', () => {
		assert.strictEqual(surfaceGraphRegionsCardValue([]), SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(surfaceGraphRegionsCardValue([
			{ name: 'A', memberFiles: ['a.ts', 'b.ts'], entryPath: 'a.ts' },
		]), '2·0');
	});

	test('surfaceProposedGraphCardValue formats node·edge totals', () => {
		assert.strictEqual(surfaceProposedGraphCardValue({}), SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(surfaceProposedGraphCardValue({ nodeCount: 12, edgeCount: 4 }), '12·4');
	});

	test('surfaceProposalTreeCardsFromDocument upgrades placeholders from plan/proposal fields', () => {
		const cards = surfaceProposalTreeCardsFromDocument({
			localUrl: 'http://localhost:4173',
			purposeValue: 'Internal dashboard for inbound ops',
			planMarkdown: '# Plan\n\nLocked.',
			proposedNodeCount: 39,
			proposedEdgeCount: 11,
			graphRegions: [{ name: 'UI', memberFiles: ['apps/a/page.tsx', 'apps/a/api.ts'] }],
			phasesCardValue: '3/3',
			contextCardValue: '2/5',
		});
		assert.strictEqual(cards.find(c => c.id === 'proposed')?.value, '39·11');
		assert.strictEqual(cards.find(c => c.id === 'graph')?.value, '2·0');
		assert.strictEqual(cards.find(c => c.id === 'preview')?.value, 'URL');
		assert.strictEqual(cards.find(c => c.id === 'plan')?.value, 'plan.md');
		assert.strictEqual(cards.find(c => c.id === 'rules')?.value, 'CLAUDE.md');
		assert.strictEqual(cards.find(c => c.id === 'phases')?.value, '3/3');
		assert.strictEqual(cards.find(c => c.id === 'context')?.value, '2/5');
	});

	test('sorts to canonical Canvas / Workspace order regardless of push order', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'context', key: 'Repo Context', value: '2/5' },
			{ id: 'description', key: 'Description', value: 'Purpose' },
			{ id: 'preview', key: 'Preview', value: 'URL' },
			{ id: 'graph', key: 'Real Graph', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'proposed', key: 'Proposed Graph', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'phases', key: 'Build phases', value: '4' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards).map(c => c.id),
			['phases', 'proposed', 'graph', 'preview', 'description', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			[...SURFACE_PROPOSAL_TREE_SECTION_ORDER].filter(id => id !== 'removals'),
			['phases', 'proposed', 'graph', 'preview', 'published', 'description', 'context', 'plan', 'rules'],
		);
	});

	test('pins the current-step section card to the front after canonical sort', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'proposed', key: 'Proposed Graph', value: '39·11' },
			{ id: 'graph', key: 'Real Graph', value: '14·0' },
			{ id: 'preview', key: 'Preview', value: 'URL' },
			{ id: 'description', key: 'Description', value: 'Purpose' },
			{ id: 'context', key: 'Repo Context', value: '2/5' },
			{ id: 'phases', key: 'Build phases', value: '4' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'phases').map(c => c.id),
			['phases', 'proposed', 'graph', 'preview', 'description', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'graph').map(c => c.id),
			['graph', 'phases', 'proposed', 'preview', 'description', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'missing').map(c => c.id),
			['phases', 'proposed', 'graph', 'preview', 'description', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'preview').map(c => c.id),
			['preview', 'phases', 'proposed', 'graph', 'description', 'context', 'plan', 'rules'],
		);
	});

	test('orderSurfaceProposalTreeSectionIds matches card ordering', () => {
		assert.deepStrictEqual(
			orderSurfaceProposalTreeSectionIds(['rules', 'phases', 'proposed', 'preview']),
			['phases', 'proposed', 'preview', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeSectionIds(['rules', 'phases', 'proposed'], 'proposed'),
			['proposed', 'phases', 'rules'],
		);
	});

	test('returns a shallow copy', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
		];
		const ordered = orderSurfaceProposalTreeCards(cards);
		assert.notStrictEqual(ordered, cards);
		assert.deepStrictEqual(ordered, cards);
	});
});

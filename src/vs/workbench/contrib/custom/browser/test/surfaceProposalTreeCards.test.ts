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
	surfaceRailCardsLookLikePlaceholders,
	resolveSurfaceUrlRailCardValue,
	surfaceUrlCardValue,
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
		assert.deepStrictEqual(cards.map(c => c.id), ['proposed', 'graph', 'preview', 'deployed', 'description', 'schema', 'plan', 'rules']);
		assert.strictEqual(cards.find(c => c.id === 'preview')?.value, 'localhost:3000');
		assert.strictEqual(cards.find(c => c.id === 'deployed')?.value, SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(cards.find(c => c.id === 'graph')?.value, SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(cards.find(c => c.id === 'description')?.value, 'Acquire clients.');
		assert.strictEqual(cards.find(c => c.id === 'schema')?.value, SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(
			staticSurfaceProposalTreeCards({ productionUrl: 'https://cadre.vercel.app' }).find(c => c.id === 'deployed')?.value,
			'cadre.vercel.app',
		);
		assert.strictEqual(
			staticSurfaceProposalTreeCards().find(c => c.id === 'description')?.value,
			SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		);
	});

	test('resolveSurfaceUrlRailCardValue upgrades placeholder when href exists', () => {
		assert.strictEqual(
			resolveSurfaceUrlRailCardValue({
				value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
				href: 'https://cadre.vercel.app',
			}),
			'cadre.vercel.app',
		);
		assert.strictEqual(
			resolveSurfaceUrlRailCardValue({ value: 'localhost:3000', href: 'http://localhost:3000' }),
			'localhost:3000',
		);
		assert.strictEqual(
			resolveSurfaceUrlRailCardValue({ value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE }),
			SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		);
	});

	test('staticSurfaceProposalTreeCards paints schema badge from surface schema', () => {
		const cards = staticSurfaceProposalTreeCards({
			schema: {
				dbKind: 'sql',
				engine: 'postgres',
				entities: [
					{ name: 'users', kind: 'table', fields: [] },
					{ name: 'sessions', kind: 'table', fields: [] },
				],
			},
		});
		assert.strictEqual(cards.find(c => c.id === 'schema')?.value, 'postgres · 2 tables');
		assert.strictEqual(
			staticSurfaceProposalTreeCards({ schema: { dbKind: 'none', entities: [] } }).find(c => c.id === 'schema')?.value,
			'No database',
		);
	});

	test('surfaceUrlCardValue strips protocol and truncates', () => {
		assert.strictEqual(surfaceUrlCardValue(undefined), SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(surfaceUrlCardValue('https://cadre-bot.vercel.app/'), 'cadre-bot.vercel.app');
		assert.strictEqual(
			surfaceUrlCardValue('https://very-long-subdomain.example.com/path', 20),
			'very-long-subdomain…',
		);
	});

	test('surfaceRailCardsLookLikePlaceholders detects static vs hydrated Rules badge', () => {
		assert.strictEqual(surfaceRailCardsLookLikePlaceholders([]), true);
		assert.strictEqual(
			surfaceRailCardsLookLikePlaceholders(staticSurfaceProposalTreeCards({ localUrl: 'http://localhost:3000' })),
			true,
		);
		assert.strictEqual(
			surfaceRailCardsLookLikePlaceholders(
				surfaceProposalTreeCardsFromDocument({
					localUrl: 'http://localhost:3000',
					planMarkdown: '# Plan',
					proposedNodeCount: 2,
					proposedEdgeCount: 1,
				}),
			),
			false,
		);
		assert.strictEqual(
			surfaceRailCardsLookLikePlaceholders([
				{ id: 'surfaceSection:rules', value: 'CLAUDE.md' },
			]),
			false,
		);
	});

	test('surfaceGraphRegionsCardValue counts member files', () => {
		assert.strictEqual(surfaceGraphRegionsCardValue([]), SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(surfaceGraphRegionsCardValue([
			{ name: 'A', memberFiles: ['a.ts', 'b.ts'], entryPath: 'a.ts' },
		]), '2·0');
	});

	test('surfaceGraphRegionsCardValue falls back to fileCount when memberFiles missing', () => {
		assert.strictEqual(surfaceGraphRegionsCardValue([
			{ name: 'Cadre Eval Harness', fileCount: 4 },
		]), '4·0');
		assert.strictEqual(surfaceGraphRegionsCardValue([
			{ name: 'A', fileCount: 4 },
			{ name: 'B', memberFiles: ['a.ts', 'b.ts'] },
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
		assert.strictEqual(cards.find(c => c.id === 'preview')?.value, 'localhost:4173');
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
			['phases', 'proposed', 'graph', 'preview', 'deployed', 'description', 'schema', 'context', 'plan', 'rules'],
		);
	});

	test('pins the current-step section card to the front after canonical sort', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'proposed', key: 'Proposed Graph', value: '39·11' },
			{ id: 'graph', key: 'Real Graph', value: '14·0' },
			{ id: 'preview', key: 'Preview', value: 'URL' },
			{ id: 'description', key: 'Description', value: 'Purpose' },
			{ id: 'schema', key: 'Schema', value: 'SQL' },
			{ id: 'context', key: 'Repo Context', value: '2/5' },
			{ id: 'phases', key: 'Build phases', value: '4' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'phases').map(c => c.id),
			['phases', 'proposed', 'graph', 'preview', 'description', 'schema', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'graph').map(c => c.id),
			['graph', 'phases', 'proposed', 'preview', 'description', 'schema', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'missing').map(c => c.id),
			['phases', 'proposed', 'graph', 'preview', 'description', 'schema', 'context', 'plan', 'rules'],
		);
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards, 'preview').map(c => c.id),
			['preview', 'phases', 'proposed', 'graph', 'description', 'schema', 'context', 'plan', 'rules'],
		);
		const withDeployed: SurfaceProposalTreeCardItem[] = [
			...cards,
			{ id: 'deployed', key: 'Deployed', value: 'app.vercel.app' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(withDeployed, 'deployed').map(c => c.id),
			['deployed', 'phases', 'proposed', 'graph', 'preview', 'description', 'schema', 'context', 'plan', 'rules'],
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

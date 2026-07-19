/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	orderSurfaceProposalTreeCards,
	staticSurfaceProposalTreeCards,
	surfaceGraphRegionsCardValue,
	SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
	type SurfaceProposalTreeCardItem,
} from '../surfaceProposalTreeCards.js';

suite('orderSurfaceProposalTreeCards', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('staticSurfaceProposalTreeCards paints core sections immediately', () => {
		const cards = staticSurfaceProposalTreeCards({ localUrl: 'http://localhost:3000' });
		assert.deepStrictEqual(cards.map(c => c.id), ['proposed', 'graph', 'preview', 'plan', 'rules']);
		assert.strictEqual(cards.find(c => c.id === 'preview')?.value, 'URL');
		assert.strictEqual(cards.find(c => c.id === 'graph')?.value, SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
	});

	test('surfaceGraphRegionsCardValue counts member files', () => {
		assert.strictEqual(surfaceGraphRegionsCardValue([]), SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE);
		assert.strictEqual(surfaceGraphRegionsCardValue([
			{ name: 'A', memberFiles: ['a.ts', 'b.ts'], entryPath: 'a.ts' },
		]), '2·0');
	});

	test('preserves declaration order without pinning Rules/Plan or reshuffling incomplete cards', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'proposed', key: 'Proposed Graph', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'graph', key: 'Real Graph', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'preview', key: 'Preview', value: 'URL' },
			{ id: 'context', key: 'Repo Context', value: '2/5' },
			{ id: 'workstreams', key: 'Workstreams', value: '28' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards).map(c => c.id),
			['proposed', 'graph', 'preview', 'context', 'workstreams', 'plan', 'rules'],
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

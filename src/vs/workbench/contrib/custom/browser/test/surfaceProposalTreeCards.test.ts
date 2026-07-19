/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	orderSurfaceProposalTreeCards,
	SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
	type SurfaceProposalTreeCardItem,
} from '../surfaceProposalTreeView.js';

suite('orderSurfaceProposalTreeCards', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('preserves declaration order without pinning Rules/Plan or reshuffling incomplete cards', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'graph', key: 'Graph', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'preview', key: 'Preview', value: 'URL' },
			{ id: 'context', key: 'Context', value: '2/5' },
			{ id: 'workstreams', key: 'Workstreams', value: '28' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards).map(c => c.id),
			['graph', 'preview', 'context', 'workstreams', 'plan', 'rules'],
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

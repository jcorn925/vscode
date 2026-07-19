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

	test('moves incomplete Graph/Preview cards after ready sections', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'graph', key: 'Graph', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'preview', key: 'Preview', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'context', key: 'Context', value: '2/5' },
			{ id: 'workstreams', key: 'Workstreams', value: '28' },
			{ id: 'architecture', key: 'Architecture', value: 'tree' },
			{ id: 'phases', key: 'Phases', value: '4' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards).map(c => c.id),
			['rules', 'plan', 'context', 'workstreams', 'architecture', 'phases', 'graph', 'preview'],
		);
	});

	test('keeps relative order when Graph/Preview are ready', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
			{ id: 'plan', key: 'Plan', value: 'plan.md' },
			{ id: 'graph', key: 'Graph', value: '3' },
			{ id: 'preview', key: 'Preview', value: 'URL' },
			{ id: 'workstreams', key: 'Workstreams', value: '2' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards).map(c => c.id),
			['rules', 'plan', 'graph', 'preview', 'workstreams'],
		);
	});

	test('trails incomplete Plan after ready cards', () => {
		const cards: SurfaceProposalTreeCardItem[] = [
			{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
			{ id: 'plan', key: 'Plan', value: SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE },
			{ id: 'context', key: 'Context', value: '1/2' },
		];
		assert.deepStrictEqual(
			orderSurfaceProposalTreeCards(cards).map(c => c.id),
			['rules', 'context', 'plan'],
		);
	});
});

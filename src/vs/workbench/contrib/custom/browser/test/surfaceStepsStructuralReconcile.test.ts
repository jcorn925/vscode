/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { GraphProposalDocument, ProposalCompareSnapshot } from '../proposalGraphDiff/proposalGraphDiffTypes.js';
import {
	isFullStructuralProposalPass,
	phaseIdsToCompleteFromStructuralPass,
} from '../surfaceStepsStructuralReconcile.js';
import { ENABLE_PREVIEW_STEP_ID } from '../../../../../../custom/goalWorkspace/surfacePlanWorkflowStatus.js';

suite('surfaceStepsStructuralReconcile', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const proposal: GraphProposalDocument = {
		add_nodes: ['file:a/one.ts', 'file:a/two.ts'],
		add_edges: [
			{ src: 'file:a/one.ts', predicate: 'IMPORTS', dst: 'file:a/two.ts', confidence: 'structural' },
			{ src: 'file:a/one.ts', predicate: 'CALLS', dst: 'file:a/two.ts', confidence: 'speculative' },
		],
		phases: [
			{ id: 'phase-1', title: 'Scaffold', items: [] },
			{ id: 'phase-2', title: 'Chat core', items: [] },
		],
	};

	const fullPassSnapshot: ProposalCompareSnapshot = {
		passed: true,
		comparison: {
			nodes: {
				recall: 1,
				matched_in_clone: ['file:a/one.ts', 'file:a/two.ts'],
				missing_in_clone: [],
			},
			edges: {
				structural: {
					recall: 1,
					matched_in_clone: ['file:a/one.ts --IMPORTS--> file:a/two.ts'],
					missing_in_clone: [],
				},
			},
		},
	};

	test('isFullStructuralProposalPass requires passed + full node recall', () => {
		assert.strictEqual(isFullStructuralProposalPass(proposal, undefined), false);
		assert.strictEqual(isFullStructuralProposalPass(proposal, { ...fullPassSnapshot, passed: false }), false);
		assert.strictEqual(isFullStructuralProposalPass({ add_nodes: [] }, fullPassSnapshot), false);
		assert.strictEqual(isFullStructuralProposalPass(proposal, {
			passed: true,
			comparison: {
				nodes: {
					matched_in_clone: ['file:a/one.ts'],
					missing_in_clone: ['file:a/two.ts'],
				},
				edges: { structural: { missing_in_clone: [] } },
			},
		}), false);
		assert.strictEqual(isFullStructuralProposalPass(proposal, fullPassSnapshot), true);
	});

	test('isFullStructuralProposalPass fails when a structural edge is missing', () => {
		assert.strictEqual(isFullStructuralProposalPass(proposal, {
			passed: true,
			comparison: {
				nodes: {
					matched_in_clone: ['file:a/one.ts', 'file:a/two.ts'],
					missing_in_clone: [],
				},
				edges: {
					structural: {
						missing_in_clone: ['file:a/one.ts --IMPORTS--> file:a/two.ts'],
					},
				},
			},
		}), false);
	});

	test('phaseIdsToCompleteFromStructuralPass returns incomplete phases only on full pass', () => {
		assert.deepStrictEqual(phaseIdsToCompleteFromStructuralPass({
			proposal,
			snapshot: fullPassSnapshot,
			proposalPhases: [
				{ id: 'phase-1' },
				{ id: 'phase-2' },
			],
			completedStepIds: ['lock_plan', 'phase-1'],
		}), ['phase-2']);

		assert.deepStrictEqual(phaseIdsToCompleteFromStructuralPass({
			proposal,
			snapshot: { passed: false },
			proposalPhases: [{ id: 'phase-1' }, { id: 'phase-2' }],
			completedStepIds: ['lock_plan'],
		}), []);

		assert.deepStrictEqual(phaseIdsToCompleteFromStructuralPass({
			proposal: undefined,
			snapshot: fullPassSnapshot,
			proposalPhases: [{ id: 'phase-1' }],
			completedStepIds: [],
		}), []);
	});

	test('phaseIdsToCompleteFromStructuralPass skips already-completed phases', () => {
		const ids = phaseIdsToCompleteFromStructuralPass({
			proposal,
			snapshot: fullPassSnapshot,
			proposalPhases: [
				{ id: 'phase-1' },
				{ id: 'phase-2' },
			],
			completedStepIds: new Set(['phase-1', 'phase-2']),
		});
		assert.deepStrictEqual(ids, []);
		assert.ok(!ids.includes(ENABLE_PREVIEW_STEP_ID));
	});

	test('phaseIdsToCompleteFromStructuralPass only returns generate phase ids from the input list', () => {
		const ids = phaseIdsToCompleteFromStructuralPass({
			proposal,
			snapshot: fullPassSnapshot,
			proposalPhases: [
				{ id: 'phase-1' },
				{ id: 'phase-2' },
			],
			completedStepIds: [],
		});
		assert.deepStrictEqual(ids, ['phase-1', 'phase-2']);
		assert.ok(!ids.includes(ENABLE_PREVIEW_STEP_ID));
	});
});


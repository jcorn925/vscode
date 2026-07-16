/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	surfaceGraphProposalDraftResource,
	surfaceGraphProposalResource,
	surfacePlanCandidateResources,
	surfacePlanResource,
} from '../../../../../../custom/goalWorkspace/surfacePlanPaths.js';

suite('surfacePlanPaths', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('prefers .agent/surfaces/<id>.plan.md then app path then root plan.md', () => {
		const root = URI.file('/tmp/ws');
		const candidates = surfacePlanCandidateResources(root, 'cadre', 'apps/cadre');
		assert.strictEqual(candidates[0]!.path, surfacePlanResource(root, 'cadre').path);
		assert.ok(candidates.some(uri => uri.path.endsWith('/apps/cadre/plan.md')));
		assert.ok(candidates.some(uri => uri.path.endsWith('/plan.md') && !uri.path.includes('/apps/')));
	});

	test('proposal paths use task-trees/<id>.graph-proposal(.draft).json', () => {
		const root = URI.file('/tmp/ws');
		assert.ok(surfaceGraphProposalResource(root, 'cadre-bot').path.endsWith('/.agent/task-trees/cadre-bot.graph-proposal.json'));
		assert.ok(surfaceGraphProposalDraftResource(root, 'cadre-bot').path.endsWith('/.agent/task-trees/cadre-bot.graph-proposal.draft.json'));
	});
});

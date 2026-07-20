/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { resolveWorkspacePlanSubmitPhase } from '../../../../../../custom/goalWorkspace/workspacePlanSubmitState.js';

suite('workspacePlanSubmitState', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('complete plan unlocks Kickoff analysis instead of a disabled ready state', () => {
		assert.strictEqual(resolveWorkspacePlanSubmitPhase({ hasPlanArtifacts: true }), 'analyze');
		assert.strictEqual(resolveWorkspacePlanSubmitPhase({
			hasPlanArtifacts: true,
			analysisInFlight: true,
		}), 'analyzing');
	});

	test('planning and kickoff take precedence over analyze', () => {
		assert.strictEqual(resolveWorkspacePlanSubmitPhase({
			hasPlanArtifacts: true,
			kickoffInFlight: true,
		}), 'starting');
		assert.strictEqual(resolveWorkspacePlanSubmitPhase({
			hasPlanArtifacts: true,
			sessionActive: true,
		}), 'planning');
		assert.strictEqual(resolveWorkspacePlanSubmitPhase({}), 'start');
	});
});

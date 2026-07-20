/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { shouldFanoutClaudeWorkstreams } from '../claudeWorkstreamFanoutGate.js';

suite('claudeWorkstreamFanoutGate', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('requires Settings parallel on and canFanout', () => {
		assert.strictEqual(shouldFanoutClaudeWorkstreams(false, true), false);
		assert.strictEqual(shouldFanoutClaudeWorkstreams(true, false), false);
		assert.strictEqual(shouldFanoutClaudeWorkstreams(false, false), false);
		assert.strictEqual(shouldFanoutClaudeWorkstreams(true, true), true);
	});
});

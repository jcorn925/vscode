/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	ANTHROPIC_API_KEY_ENV,
	ANTHROPIC_API_KEY_SECRET,
	ANTHROPIC_API_KEYS_URL,
} from '../../../../../../custom/goalWorkspace/anthropicApiKey.js';

suite('anthropicApiKey', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('secret and env names are stable', () => {
		assert.strictEqual(ANTHROPIC_API_KEY_SECRET, 'goalWorkspace.anthropicApiKey');
		assert.strictEqual(ANTHROPIC_API_KEY_ENV, 'ANTHROPIC_API_KEY');
		assert.ok(ANTHROPIC_API_KEYS_URL.includes('anthropic.com'));
	});
});

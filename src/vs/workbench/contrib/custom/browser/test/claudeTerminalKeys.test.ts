/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	claudeTerminalTitleFor,
	isClaudeTerminalTitle,
	LEGACY_CLAUDE_TERMINAL_TITLE,
	parseClaudeTerminalKey,
	WORKSPACE_CLAUDE_KEY,
} from '../claudeTerminalKeys.js';

suite('claudeTerminalKeys', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('claudeTerminalTitleFor / parseClaudeTerminalKey round-trip', () => {
		assert.strictEqual(claudeTerminalTitleFor('cadre-ai-support'), 'Claude — cadre-ai-support');
		assert.strictEqual(parseClaudeTerminalKey(claudeTerminalTitleFor('cadre-ai-support')), 'cadre-ai-support');
		assert.strictEqual(parseClaudeTerminalKey(claudeTerminalTitleFor(WORKSPACE_CLAUDE_KEY)), WORKSPACE_CLAUDE_KEY);
	});

	test('legacy title does not parse as a surface key', () => {
		assert.strictEqual(parseClaudeTerminalKey(LEGACY_CLAUDE_TERMINAL_TITLE), undefined);
		assert.strictEqual(isClaudeTerminalTitle(LEGACY_CLAUDE_TERMINAL_TITLE), true);
		assert.strictEqual(isClaudeTerminalTitle('Claude — cadre-admin-console'), true);
		assert.strictEqual(isClaudeTerminalTitle('npm run dev'), false);
		assert.strictEqual(parseClaudeTerminalKey(undefined), undefined);
		assert.strictEqual(parseClaudeTerminalKey('Claude — '), undefined);
	});
});

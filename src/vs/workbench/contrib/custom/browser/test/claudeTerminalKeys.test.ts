/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	ACTIONS_CLAUDE_KEY,
	CLAUDE_SERIALIZE_WORKSTREAM_ID,
	claudeTerminalTitleFor,
	claudeWorkstreamKey,
	isClaudeKeyForSurface,
	isClaudeTerminalTitle,
	isReservedClaudeKey,
	LEGACY_CLAUDE_TERMINAL_TITLE,
	parseClaudeTerminalKey,
	parseClaudeWorkstreamKey,
	surfaceIdFromClaudeKey,
	workstreamClaudeKeysForSurface,
	WORKSPACE_CLAUDE_KEY,
} from '../claudeTerminalKeys.js';

suite('claudeTerminalKeys', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('claudeTerminalTitleFor / parseClaudeTerminalKey round-trip', () => {
		assert.strictEqual(claudeTerminalTitleFor('cadre-ai-support'), 'Claude — cadre-ai-support');
		assert.strictEqual(parseClaudeTerminalKey(claudeTerminalTitleFor('cadre-ai-support')), 'cadre-ai-support');
		assert.strictEqual(parseClaudeTerminalKey(claudeTerminalTitleFor(WORKSPACE_CLAUDE_KEY)), WORKSPACE_CLAUDE_KEY);
		assert.strictEqual(claudeTerminalTitleFor(ACTIONS_CLAUDE_KEY), 'Claude — Actions');
		assert.strictEqual(parseClaudeTerminalKey(claudeTerminalTitleFor(ACTIONS_CLAUDE_KEY)), ACTIONS_CLAUDE_KEY);
		assert.strictEqual(parseClaudeTerminalKey('Claude — __actions__'), ACTIONS_CLAUDE_KEY);
	});

	test('legacy title does not parse as a surface key', () => {
		assert.strictEqual(parseClaudeTerminalKey(LEGACY_CLAUDE_TERMINAL_TITLE), undefined);
		assert.strictEqual(isClaudeTerminalTitle(LEGACY_CLAUDE_TERMINAL_TITLE), true);
		assert.strictEqual(isClaudeTerminalTitle('Claude — cadre-admin-console'), true);
		assert.strictEqual(isClaudeTerminalTitle('npm run dev'), false);
		assert.strictEqual(parseClaudeTerminalKey(undefined), undefined);
		assert.strictEqual(parseClaudeTerminalKey('Claude — '), undefined);
	});

	test('workstream keys round-trip through titles', () => {
		const key = claudeWorkstreamKey('cadre-support-bot', 'ws-1');
		assert.strictEqual(key, 'cadre-support-bot::ws-1');
		assert.strictEqual(claudeTerminalTitleFor(key), 'Claude — cadre-support-bot · ws-1');
		assert.strictEqual(parseClaudeTerminalKey(claudeTerminalTitleFor(key)), key);
		assert.deepStrictEqual(parseClaudeWorkstreamKey(key), {
			surfaceId: 'cadre-support-bot',
			workstreamId: 'ws-1',
		});
		assert.strictEqual(
			claudeWorkstreamKey('cadre-support-bot', CLAUDE_SERIALIZE_WORKSTREAM_ID),
			'cadre-support-bot::serialize',
		);
	});

	test('surfaceIdFromClaudeKey / isClaudeKeyForSurface', () => {
		assert.strictEqual(surfaceIdFromClaudeKey('cadre-support-bot'), 'cadre-support-bot');
		assert.strictEqual(surfaceIdFromClaudeKey('cadre-support-bot::ws-2'), 'cadre-support-bot');
		assert.strictEqual(surfaceIdFromClaudeKey(WORKSPACE_CLAUDE_KEY), undefined);
		assert.strictEqual(surfaceIdFromClaudeKey(ACTIONS_CLAUDE_KEY), undefined);
		assert.ok(isReservedClaudeKey(WORKSPACE_CLAUDE_KEY));
		assert.ok(isReservedClaudeKey(ACTIONS_CLAUDE_KEY));
		assert.ok(!isReservedClaudeKey('cadre-support-bot'));
		assert.ok(isClaudeKeyForSurface('cadre-support-bot', 'cadre-support-bot'));
		assert.ok(isClaudeKeyForSurface('cadre-support-bot::ws-1', 'cadre-support-bot'));
		assert.ok(!isClaudeKeyForSurface('other::ws-1', 'cadre-support-bot'));
	});

	test('workstreamClaudeKeysForSurface keeps only ws/serialize keys for the surface', () => {
		assert.deepStrictEqual(
			workstreamClaudeKeysForSurface('cadre-admin-console', [
				'cadre-admin-console',
				'cadre-admin-console::ws-42',
				'cadre-admin-console::serialize',
				'cadre-eval-harness::ws-8',
				WORKSPACE_CLAUDE_KEY,
				'cadre-admin-console::ws-42',
			]),
			['cadre-admin-console::ws-42', 'cadre-admin-console::serialize'],
		);
		assert.deepStrictEqual(workstreamClaudeKeysForSurface('', ['a::ws-1']), []);
	});
});

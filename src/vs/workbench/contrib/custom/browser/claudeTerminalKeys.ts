/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Reserved key for Console workspace-plan Claude Code sessions. */
export const WORKSPACE_CLAUDE_KEY = '__workspace__';

/** Legacy single-session title used before per-surface Claude terminals. */
export const LEGACY_CLAUDE_TERMINAL_TITLE = 'Claude — New Surface';

const CLAUDE_TERMINAL_TITLE_PREFIX = 'Claude — ';

export function claudeTerminalTitleFor(key: string): string {
	return `${CLAUDE_TERMINAL_TITLE_PREFIX}${key}`;
}

/**
 * Parse a Claude terminal title/name into its session key.
 * Returns undefined for the legacy global title (migration only) and non-Claude titles.
 */
export function parseClaudeTerminalKey(titleOrName: string | undefined): string | undefined {
	if (!titleOrName || !titleOrName.startsWith(CLAUDE_TERMINAL_TITLE_PREFIX)) {
		return undefined;
	}
	if (titleOrName === LEGACY_CLAUDE_TERMINAL_TITLE) {
		return undefined;
	}
	const key = titleOrName.slice(CLAUDE_TERMINAL_TITLE_PREFIX.length).trim();
	return key.length > 0 ? key : undefined;
}

export function isClaudeTerminalTitle(titleOrName: string | undefined): boolean {
	return titleOrName === LEGACY_CLAUDE_TERMINAL_TITLE || parseClaudeTerminalKey(titleOrName) !== undefined;
}

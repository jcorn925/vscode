/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Reserved key for Console workspace-plan Claude Code sessions. */
export const WORKSPACE_CLAUDE_KEY = '__workspace__';

/** Reserved key for Actions-panel Claude Code sessions (workflow / common action errors). */
export const ACTIONS_CLAUDE_KEY = '__actions__';

/** Suffix for the serialize-groups Claude when fan-out runs coupled clusters first. */
export const CLAUDE_SERIALIZE_WORKSTREAM_ID = 'serialize';

/** Legacy single-session title used before per-surface Claude terminals. */
export const LEGACY_CLAUDE_TERMINAL_TITLE = 'Claude — New Surface';

const CLAUDE_TERMINAL_TITLE_PREFIX = 'Claude — ';
const WORKSTREAM_KEY_SEP = '::';

export function claudeTerminalTitleFor(key: string): string {
	if (key === ACTIONS_CLAUDE_KEY) {
		return `${CLAUDE_TERMINAL_TITLE_PREFIX}Actions`;
	}
	const parsed = parseClaudeWorkstreamKey(key);
	if (parsed) {
		return `${CLAUDE_TERMINAL_TITLE_PREFIX}${parsed.surfaceId} · ${parsed.workstreamId}`;
	}
	return `${CLAUDE_TERMINAL_TITLE_PREFIX}${key}`;
}

/**
 * Parse a Claude terminal title/name into its session key.
 * Returns undefined for the legacy global title (migration only) and non-Claude titles.
 * Workstream titles (`Claude — surface · ws-1`) round-trip to `surface::ws-1`.
 */
export function parseClaudeTerminalKey(titleOrName: string | undefined): string | undefined {
	if (!titleOrName || !titleOrName.startsWith(CLAUDE_TERMINAL_TITLE_PREFIX)) {
		return undefined;
	}
	if (titleOrName === LEGACY_CLAUDE_TERMINAL_TITLE) {
		return undefined;
	}
	const rest = titleOrName.slice(CLAUDE_TERMINAL_TITLE_PREFIX.length).trim();
	if (!rest.length) {
		return undefined;
	}
	if (rest === 'Actions' || rest === ACTIONS_CLAUDE_KEY) {
		return ACTIONS_CLAUDE_KEY;
	}
	const dotSep = ' · ';
	const sepAt = rest.indexOf(dotSep);
	if (sepAt > 0) {
		const surfaceId = rest.slice(0, sepAt).trim();
		const workstreamId = rest.slice(sepAt + dotSep.length).trim();
		if (surfaceId && workstreamId) {
			return claudeWorkstreamKey(surfaceId, workstreamId);
		}
	}
	return rest;
}

export function isClaudeTerminalTitle(titleOrName: string | undefined): boolean {
	return titleOrName === LEGACY_CLAUDE_TERMINAL_TITLE || parseClaudeTerminalKey(titleOrName) !== undefined;
}

/** Session key for one parallel (or serialize) workstream Claude under a surface. */
export function claudeWorkstreamKey(surfaceId: string, workstreamId: string): string {
	return `${surfaceId.trim()}${WORKSTREAM_KEY_SEP}${workstreamId.trim()}`;
}

export function parseClaudeWorkstreamKey(key: string | undefined): { surfaceId: string; workstreamId: string } | undefined {
	if (!key || key === WORKSPACE_CLAUDE_KEY || key === ACTIONS_CLAUDE_KEY) {
		return undefined;
	}
	const sepAt = key.indexOf(WORKSTREAM_KEY_SEP);
	if (sepAt <= 0) {
		return undefined;
	}
	const surfaceId = key.slice(0, sepAt).trim();
	const workstreamId = key.slice(sepAt + WORKSTREAM_KEY_SEP.length).trim();
	if (!surfaceId || !workstreamId || workstreamId.includes(WORKSTREAM_KEY_SEP)) {
		return undefined;
	}
	return { surfaceId, workstreamId };
}

/** Surface id for a Claude key (surface, surface::ws-N, or undefined for workspace/actions). */
export function surfaceIdFromClaudeKey(key: string | undefined): string | undefined {
	if (!key || key === WORKSPACE_CLAUDE_KEY || key === ACTIONS_CLAUDE_KEY) {
		return undefined;
	}
	return parseClaudeWorkstreamKey(key)?.surfaceId ?? key;
}

/** True for reserved non-surface Claude keys (workspace plan, Actions panel). */
export function isReservedClaudeKey(key: string | undefined): boolean {
	return key === WORKSPACE_CLAUDE_KEY || key === ACTIONS_CLAUDE_KEY;
}

/** True when `key` is a workstream (or serialize) Claude for `surfaceId`. */
export function isClaudeKeyForSurface(key: string, surfaceId: string): boolean {
	if (key === surfaceId) {
		return true;
	}
	const parsed = parseClaudeWorkstreamKey(key);
	return parsed?.surfaceId === surfaceId;
}

/**
 * Stable tab order for live Claude sessions: Workspace → Actions → surfaces
 * (plain surface before its workstreams) → everything else.
 */
export function compareClaudeTerminalTabKeys(a: string, b: string): number {
	const rank = (key: string): number => {
		if (key === WORKSPACE_CLAUDE_KEY) {
			return 0;
		}
		if (key === ACTIONS_CLAUDE_KEY) {
			return 1;
		}
		return 2;
	};
	const ra = rank(a);
	const rb = rank(b);
	if (ra !== rb) {
		return ra - rb;
	}
	const sa = surfaceIdFromClaudeKey(a) ?? a;
	const sb = surfaceIdFromClaudeKey(b) ?? b;
	const bySurface = sa.localeCompare(sb);
	if (bySurface !== 0) {
		return bySurface;
	}
	const wa = parseClaudeWorkstreamKey(a);
	const wb = parseClaudeWorkstreamKey(b);
	if (!wa && wb) {
		return -1;
	}
	if (wa && !wb) {
		return 1;
	}
	return a.localeCompare(b);
}

/** Live (non-disposed) Claude session keys, sorted for the header tab strip. */
export function listLiveClaudeTerminalKeys(
	entries: Iterable<readonly [string, { readonly isDisposed?: boolean } | undefined]>,
): string[] {
	const out: string[] = [];
	for (const [key, terminal] of entries) {
		if (!key || terminal?.isDisposed) {
			continue;
		}
		out.push(key);
	}
	return out.sort(compareClaudeTerminalTabKeys);
}

/**
 * Workstream / serialize Claude keys for `surfaceId` among `keys`.
 * Ignores the plain surface key and reserved workspace/actions keys.
 */
export function workstreamClaudeKeysForSurface(surfaceId: string, keys: readonly string[]): string[] {
	const target = surfaceId.trim();
	if (!target) {
		return [];
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const key of keys) {
		const parsed = parseClaudeWorkstreamKey(key);
		if (!parsed || parsed.surfaceId !== target || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(key);
	}
	return out;
}

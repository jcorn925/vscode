/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProcessNoteGraph, ProcessNoteId, ProcessNotesFile } from './processNotesTypes.js';

/** Registered built-in topic ids (must match persisted `ProcessNote.id` when shipped). */
export const PROCESS_NOTE_TOPIC_IDS: readonly ProcessNoteId[] = ['webview-selection'];

/** Recipe ids stored on `ProcessNote.meta.recipeId`. */
export const RECIPE_WEBVIEW_SELECTION = 'webview-selection';
export const RECIPE_CUSTOM_PROMPT = 'custom-prompt';

/**
 * Built-in ids first, then other workspace notes by newest `generatedAt` first.
 */
export function mergeProcessNoteTopicIds(file: ProcessNotesFile | undefined): ProcessNoteId[] {
	const ids: ProcessNoteId[] = [];
	const seen = new Set<string>();
	for (const id of PROCESS_NOTE_TOPIC_IDS) {
		if (!seen.has(id)) {
			seen.add(id);
			ids.push(id);
		}
	}
	const extras = (file?.notes ?? [])
		.filter(n => !seen.has(n.id))
		.sort((a, b) => (b.meta.generatedAt ?? 0) - (a.meta.generatedAt ?? 0));
	for (const n of extras) {
		seen.add(n.id);
		ids.push(n.id as ProcessNoteId);
	}
	return ids;
}

export function resolveProcessTopicLabel(
	id: ProcessNoteId,
	file: ProcessNotesFile | undefined,
	localizeBuiltin: (id: ProcessNoteId) => string,
): string {
	const note = file?.notes.find(n => n.id === id);
	if (note?.title) {
		return note.title;
	}
	return localizeBuiltin(id);
}

/** Deterministic id for a custom prompt so the same question updates the same note. */
export function stableCustomNoteId(prompt: string): ProcessNoteId {
	const normalized = prompt.trim().replace(/\s+/g, ' ');
	let h = 2166136261;
	for (let i = 0; i < normalized.length; i++) {
		h ^= normalized.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `custom-${(h >>> 0).toString(16)}` as ProcessNoteId;
}

export function buildProcessTopicsOverviewGraph(topicLabels: readonly { readonly id: ProcessNoteId; readonly label: string }[]): ProcessNoteGraph {
	const nodes = topicLabels.map(t => ({
		id: t.id,
		label: t.label,
		kind: 'topic' as const,
	}));
	return { nodes, edges: [] };
}

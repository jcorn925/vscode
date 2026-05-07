/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

export interface ProcessNoteProvenanceInput {
	/** Main narrative from the model (JSON `markdown` field), without provenance. */
	readonly bodyMarkdown: string;
	/** Ix invocations, in run order (e.g. `ix read package.json --format json`). */
	readonly ixCommandLabels: readonly string[];
	readonly ixCommandPhases?: readonly { readonly phase: string; readonly labels: readonly string[] }[];
	readonly selectionReason?: string;
	readonly selectionPrompt?: string;
	readonly selectionModelId?: string;
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly modelId?: string;
}

/**
 * Deduplicated ix step labels from an evidence `raw` array, preserving order.
 */
export function ixCommandLabelsFromEvidenceRaw(raw: readonly { readonly label: string }[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const r of raw) {
		if (r.label && !seen.has(r.label)) {
			seen.add(r.label);
			out.push(r.label);
		}
	}
	return out;
}

function asMarkdownBlockQuote(text: string): string {
	if (!text.trim().length) {
		return `> _${localize('customMode.processNotes.provenance.empty', '(empty)')}_`;
	}
	return text
		.split('\n')
		.map(line => `> ${line}`)
		.join('\n');
}

/**
 * Appends a stable, human-readable provenance block for visibility (Ix + AI).
 * Saved in `ProcessNote.markdown` and shown in the Process notes panel.
 */
export function formatSavedProcessNoteMarkdown(input: ProcessNoteProvenanceInput): string {
	const hProv = localize('customMode.processNotes.provenance.heading', 'Provenance');
	const hIx = localize('customMode.processNotes.provenance.ixHeading', 'Ix commands invoked');
	const hAi = localize('customMode.processNotes.provenance.aiHeading', 'AI synthesis');
	const hSelection = localize('customMode.processNotes.provenance.selectionHeading', 'Candidate selection');
	const modelLabel = localize('customMode.processNotes.provenance.model', 'Model');
	const systemLabel = localize('customMode.processNotes.provenance.systemPrompt', 'System prompt');
	const userLabel = localize('customMode.processNotes.provenance.userPrompt', 'User message (full prompt to the model)');
	const noneIx = localize('customMode.processNotes.provenance.noIx', '_(no Ix JSON steps recorded)_');
	const noModel = localize('customMode.processNotes.provenance.noModel', '_(not invoked — no model id)_');

	const ixLines =
		input.ixCommandLabels.length > 0
			? input.ixCommandLabels.map(l => `- \`${l.replace(/`/g, "'")}\``).join('\n')
			: noneIx;

	const phaseLines = input.ixCommandPhases?.length
		? input.ixCommandPhases.map(p => {
			const labels = p.labels.length
				? p.labels.map(l => `  - \`${l.replace(/`/g, "'")}\``).join('\n')
				: `  - ${noneIx}`;
			return `- **${p.phase}**\n${labels}`;
		}).join('\n')
		: ixLines;

	const modelLine = input.modelId
		? `${modelLabel}: \`${input.modelId.replace(/`/g, "'")}\``
		: `${modelLabel}: ${noModel}`;
	const selectionModelLine = input.selectionModelId
		? `${modelLabel}: \`${input.selectionModelId.replace(/`/g, "'")}\``
		: `${modelLabel}: ${noModel}`;
	const selectionReason = input.selectionReason?.trim();

	const parts = [
		input.bodyMarkdown.trim(),
		'',
		'---',
		'',
		`## ${hProv}`,
		'',
		`### ${hIx}`,
		'',
		phaseLines,
		'',
		`### ${hSelection}`,
		'',
		selectionReason ? asMarkdownBlockQuote(selectionReason) : `> _${localize('customMode.processNotes.provenance.noSelectionReason', 'No selection reason recorded.')}_`,
		'',
		selectionModelLine,
	];
	if (input.selectionPrompt?.trim()) {
		parts.push(
			'',
			`**${localize('customMode.processNotes.provenance.selectionPrompt', 'Selection prompt')}**`,
			'',
			asMarkdownBlockQuote(input.selectionPrompt),
		);
	}
	parts.push(
		'',
		`### ${hAi}`,
		'',
		modelLine,
		'',
		`**${systemLabel}**`,
		'',
		asMarkdownBlockQuote(input.systemPrompt),
		'',
		`**${userLabel}**`,
		'',
		asMarkdownBlockQuote(input.userPrompt),
		'',
	);
	return parts.join('\n');
}

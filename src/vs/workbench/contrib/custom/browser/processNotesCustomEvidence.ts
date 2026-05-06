/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import type { ProcessGraphCitation, ProcessGraphEdge, ProcessGraphNode, ProcessNoteGraph } from './processNotesTypes.js';

export interface CustomPromptEvidencePack {
	readonly userPrompt: string;
	readonly anchors: readonly ProcessGraphNode[];
	readonly graph: ProcessNoteGraph;
	readonly citations: readonly ProcessGraphCitation[];
	readonly raw: readonly { readonly label: string; readonly json: unknown }[];
}

function ixCitation(command: string, ref: string): ProcessGraphCitation {
	return { source: 'ix', command, ref };
}

async function pushJsonQuery(
	label: string,
	ix: IIxIntegrationService,
	args: readonly string[],
	cwd: URI,
	timeoutMs: number,
	raw: Array<{ label: string; json: unknown }>,
	citations: ProcessGraphCitation[],
	ref: string,
): Promise<void> {
	const res = await ix.runJsonQuery(args, cwd, timeoutMs);
	if (res.ok) {
		raw.push({ label, json: res.value });
		citations.push(ixCitation(label, ref));
	} else {
		raw.push({ label, json: { error: res.error, exitCode: res.exitCode, raw: res.raw } });
	}
}

/**
 * Workspace-scoped evidence: inventory/map-oriented ix JSON plus optional file reads.
 * Uses ix pipeline snapshot when available (read-only) for richer context.
 */
export async function buildCustomPromptEvidencePack(
	ix: IIxIntegrationService,
	cwd: URI,
	userPrompt: string,
): Promise<CustomPromptEvidencePack> {
	const raw: Array<{ label: string; json: unknown }> = [];
	const citations: ProcessGraphCitation[] = [];

	const queryLabel = userPrompt.trim().slice(0, 160) || localize('customMode.processNotes.custom.emptyPrompt', '(empty prompt)');

	const nodes: ProcessGraphNode[] = [
		{
			id: 'workspace',
			label: localize('customMode.processNotes.custom.node.workspace', 'Workspace'),
			kind: 'phase',
			lane: 'Host',
			file: cwd,
			startLine: 1,
			endLine: 1,
		},
		{
			id: 'userQuery',
			label: localize('customMode.processNotes.custom.node.query', 'Question: {0}', queryLabel),
			kind: 'event',
			lane: 'Bridge',
		},
	];

	const edges: ProcessGraphEdge[] = [
		{
			from: 'workspace',
			to: 'userQuery',
			type: 'other',
			evidence: localize('customMode.processNotes.custom.edge.scope', 'Process question scoped to open workspace'),
		},
	];

	// Map-aligned inventory (Stage 4): class-level inventory when supported.
	await pushJsonQuery(
		'ix inventory --kind class --format json',
		ix,
		['inventory', '--kind', 'class', '--format', 'json'],
		cwd,
		90_000,
		raw,
		citations,
		'inventory:class',
	);

	// Fallback broader inventory.
	await pushJsonQuery(
		'ix inventory --format json',
		ix,
		['inventory', '--format', 'json'],
		cwd,
		90_000,
		raw,
		citations,
		'inventory',
	);

	const pkgPath = 'package.json';
	await pushJsonQuery(
		`ix read ${pkgPath} --format json`,
		ix,
		['read', pkgPath, '--format', 'json'],
		cwd,
		30_000,
		raw,
		citations,
		pkgPath,
	);

	const readmePath = 'README.md';
	await pushJsonQuery(
		`ix read ${readmePath} --format json`,
		ix,
		['read', readmePath, '--format', 'json'],
		cwd,
		30_000,
		raw,
		citations,
		readmePath,
	);

	// Optional trace when prompt mentions two path-like segments (heuristic).
	const traceMatch = userPrompt.match(/([\w./-]+\.(?:ts|tsx|js|jsx))\s+(?:and|to|→)\s+([\w./-]+\.(?:ts|tsx|js|jsx))/i);
	if (traceMatch) {
		const a = traceMatch[1];
		const b = traceMatch[2];
		await pushJsonQuery(
			`ix trace ${a} ${b} --format json`,
			ix,
			['trace', a, b, '--format', 'json'],
			cwd,
			60_000,
			raw,
			citations,
			`${a}->${b}`,
		);
	}

	// Read-only snapshot of ix pipeline / map steps for this session (Stage 4).
	const state = ix.getState();
	const pipelineSlice = state.pipelineSteps
		.filter(s => s.kind === 'workspace' || /map/i.test(s.label) || /map/i.test(s.id))
		.slice(0, 12)
		.map(s => ({
			id: s.id,
			label: s.label,
			status: s.status,
			command: s.command,
			outputTail: s.outputTail.slice(0, 8000),
		}));
	if (pipelineSlice.length) {
		raw.push({
			label: 'ix.pipeline.snapshot(map-related)',
			json: pipelineSlice,
		});
		citations.push(ixCitation('ix.pipeline.snapshot', 'workspace-map-steps'));
	}

	if (state.lastOutput && state.lastOutput.length < 12000) {
		raw.push({
			label: 'ix.state.lastOutput',
			json: state.lastOutput,
		});
	}

	return {
		userPrompt,
		anchors: nodes,
		graph: { nodes, edges },
		citations,
		raw,
	};
}

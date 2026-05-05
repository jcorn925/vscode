/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import type { ProcessGraphCitation, ProcessGraphEdge, ProcessGraphNode, ProcessNoteGraph } from './processNotesTypes.js';

export interface WebviewSelectionEvidencePack {
	readonly anchors: readonly ProcessGraphNode[];
	readonly graph: ProcessNoteGraph;
	readonly citations: readonly ProcessGraphCitation[];
	readonly raw: readonly { readonly label: string; readonly json: unknown }[];
}

function ixCitation(command: string, ref: string): ProcessGraphCitation {
	return { source: 'ix', command, ref };
}

/**
 * Best-effort: uses ix JSON output when supported. The exact JSON schema can vary by ix version;
 * we intentionally keep parsing minimal and fall back to raw payload capture.
 */
export async function buildWebviewSelectionEvidencePack(
	ix: IIxIntegrationService,
	cwd: URI,
): Promise<WebviewSelectionEvidencePack> {
	const raw: Array<{ label: string; json: unknown }> = [];
	const citations: ProcessGraphCitation[] = [];

	// Anchor files/symbols for this topic.
	// Note: symbol-level locate/search may not be available depending on ix ingest settings;
	// file-level read is reliable and still yields line ranges for click-to-open.
	const overlayPath = 'src/vs/workbench/contrib/custom/browser/uiClickOverlayScript.ts';
	const hostPath = 'src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts';

	const nodes: ProcessGraphNode[] = [
		{
			id: 'overlay',
			label: 'Overlay script (uiClickOverlayScript.ts)',
			kind: 'file',
			lane: 'Preview',
			file: URI.joinPath(cwd, overlayPath),
			startLine: 1,
			endLine: 420,
		},
		{
			id: 'host',
			label: 'Host (modeShell.contribution.ts)',
			kind: 'file',
			lane: 'Host',
			file: URI.joinPath(cwd, hostPath),
			startLine: 1,
			endLine: 260,
		},
		{
			id: 'selection',
			label: 'Message: vscode-ui-selection',
			kind: 'event',
			lane: 'Bridge',
			citations: [ixCitation('uiClickOverlayScript.ts', 'vscode-ui-selection')],
		},
	];

	for (const p of [overlayPath, hostPath]) {
		const cmd = `ix read ${p} --format json`;
		const res = await ix.runJsonQuery(['read', p, '--format', 'json'], cwd, 30_000);
		if (res.ok) {
			raw.push({ label: cmd, json: res.value });
			citations.push(ixCitation(cmd, p));
		} else {
			raw.push({ label: cmd, json: { error: res.error, exitCode: res.exitCode, raw: res.raw } });
		}
	}

	// Attempt to connect the overlay and host handler with a trace.
	const traceCmd = `ix trace ${overlayPath} ${hostPath} --format json`;
	const traceRes = await ix.runJsonQuery(['trace', overlayPath, hostPath, '--format', 'json'], cwd, 45_000);
	if (traceRes.ok) {
		raw.push({ label: traceCmd, json: traceRes.value });
		citations.push(ixCitation(traceCmd, `${overlayPath}->${hostPath}`));
	} else {
		raw.push({ label: traceCmd, json: { error: traceRes.error, exitCode: traceRes.exitCode, raw: traceRes.raw } });
	}

	const edges: ProcessGraphEdge[] = [
		{ from: 'overlay', to: 'selection', type: 'postsMessage', evidence: localize('customMode.processNotes.webviewSelection.edge.overlayToMsg', 'Overlay posts selection message') },
		{ from: 'selection', to: 'host', type: 'postsMessage', evidence: localize('customMode.processNotes.webviewSelection.edge.msgToHost', 'Host receives message via postMessage') },
	];

	return {
		anchors: nodes,
		graph: { nodes, edges },
		citations,
		raw,
	};
}


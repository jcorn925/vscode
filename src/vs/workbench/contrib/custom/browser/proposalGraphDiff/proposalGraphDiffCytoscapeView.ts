/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../webview/common/webview.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../../webview/browser/webview.js';
import type { ProposalDiffGraph, ProposalDiffStatus } from './proposalGraphDiffTypes.js';

export type ProposalGraphDiffReadyMessage = { type: 'proposalGraphDiff.ready' };
export type ProposalGraphDiffWebviewMessage = ProposalGraphDiffReadyMessage;

const STATUS_COLORS: Record<ProposalDiffStatus, string> = {
	matched: '#22c55e',
	missing: '#ef4444',
	removal_still_present: '#f97316',
	speculative_missing: '#94a3b8',
};

export class ProposalGraphDiffCytoscapeView extends Disposable {
	private readonly webview: IWebviewElement;
	private lastGraph: ProposalDiffGraph | undefined;

	constructor(
		webviewService: IWebviewService,
		localResourceRoots: readonly URI[],
		onMessage: (message: ProposalGraphDiffWebviewMessage) => void,
	) {
		super();
		this.webview = this._register(webviewService.createWebviewElement({
			title: localize('custom.ix.proposalGraphDiff.title', 'Proposal Graph Diff'),
			options: {
				purpose: WebviewContentPurpose.WebviewView,
				enableFindWidget: false,
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots,
			},
			extension: undefined,
		}));
		this._register(this.webview.onMessage(e => onMessage(e.message as ProposalGraphDiffWebviewMessage)));
	}

	attach(anchor: HTMLElement, _clippingContainer: HTMLElement): void {
		// This panel is a stable DOM subtree, so mounting directly is both safe and
		// more reliable than an overlay whose CSS anchor may be measured while hidden.
		this.webview.mountTo(anchor, mainWindow);
	}

	/** Reflow Cytoscape after the host panel goes from display:none → visible. */
	relayout(): void {
		if (this.lastGraph) {
			this.setGraph(this.lastGraph);
		}
	}

	setGraph(graph: ProposalDiffGraph): void {
		this.lastGraph = graph;
		this.webview.postMessage({ type: 'proposalGraphDiff.setGraph', graph });
	}

	setTheme(theme: 'dark' | 'light'): void {
		this.webview.postMessage({ type: 'proposalGraphDiff.setTheme', theme });
		if (this.lastGraph) {
			this.setGraph(this.lastGraph);
		}
	}

	setHtml(cytoscapeUri: URI, layoutBaseUri: URI, coseBaseUri: URI, fcoseUri: URI): void {
		const nonce = String(Math.random()).slice(2);
		const cspSource = webviewGenericCspSource;
		const cyUri = asWebviewUri(cytoscapeUri).toString();
		const layoutUri = asWebviewUri(layoutBaseUri).toString();
		const coseUri = asWebviewUri(coseBaseUri).toString();
		const fcose = asWebviewUri(fcoseUri).toString();
		const colorsJson = JSON.stringify(STATUS_COLORS);

		this.webview.setHtml(`<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<style>
		html, body { padding: 0; margin: 0; height: 100%; width: 100%; overflow: hidden; }
		#cy { position: absolute; inset: 0; top: 36px; }
		#header {
			position: absolute; left: 0; right: 0; top: 0; height: 36px;
			display: flex; align-items: center; gap: 12px; padding: 0 12px;
			font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;
			background: rgba(0,0,0,0.35); color: #e5e7eb; z-index: 2;
		}
		#header .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
		#hint {
			position: absolute; left: 10px; bottom: 10px; padding: 6px 8px; border-radius: 6px;
			font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;
			background: rgba(0,0,0,0.28); color: #fff; pointer-events: none;
		}
	</style>
</head>
<body>
	<div id="header">Loading…</div>
	<div id="cy"></div>
	<div id="hint">matched · missing · removal still present · speculative (dashed) — drag to pan · wheel to zoom</div>
	<script nonce="${nonce}" src="${cyUri}"></script>
	<script nonce="${nonce}" src="${layoutUri}"></script>
	<script nonce="${nonce}" src="${coseUri}"></script>
	<script nonce="${nonce}" src="${fcose}"></script>
	<script nonce="${nonce}">
		(function() {
			const vscode = acquireVsCodeApi();
			const STATUS_COLORS = ${colorsJson};
			let cy;
			let currentTheme = 'dark';

			try {
				const ext = (globalThis).cytoscapeFcose;
				if (ext && typeof (globalThis).cytoscape?.use === 'function') {
					(globalThis).cytoscape.use(ext);
				}
			} catch { /* ignore */ }

			function ensureCy() {
				if (cy) { return; }
				cy = cytoscape({
					container: document.getElementById('cy'),
					wheelSensitivity: 0.16,
					style: [
						{
							selector: 'node',
							style: {
								'label': 'data(label)',
								'text-wrap': 'wrap',
								'text-max-width': 180,
								'font-size': 11,
								'text-valign': 'center',
								'text-halign': 'center',
								'color': currentTheme === 'dark' ? '#e5e7eb' : '#111827',
								'background-color': 'data(color)',
								'border-width': 1,
								'border-color': currentTheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)',
								'width': 'label',
								'height': 'label',
								'padding': 10,
							}
						},
						{
							selector: 'edge',
							style: {
								'curve-style': 'bezier',
								'target-arrow-shape': 'triangle',
								'target-arrow-color': 'data(color)',
								'line-color': 'data(color)',
								'width': 1.5,
								'label': 'data(label)',
								'font-size': 10,
								'line-style': 'data(lineStyle)',
								'text-background-color': currentTheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)',
								'text-background-opacity': 1,
								'text-background-padding': 2,
								'color': currentTheme === 'dark' ? '#e5e7eb' : '#111827',
								'text-rotation': 'autorotate',
							}
						},
						{
							selector: 'node:selected',
							style: {
								'border-width': 2,
								'border-color': currentTheme === 'dark' ? '#fff' : '#000',
							}
						}
					],
				});
				vscode.postMessage({ type: 'proposalGraphDiff.ready' });
			}

			function setHeader(summary) {
				const el = document.getElementById('header');
				if (!el || !summary) { return; }
				const pass = summary.passed ? 'PASS' : 'FAIL';
				el.innerHTML =
					'<strong>' + pass + '</strong>' +
					'<span>node recall ' + Number(summary.nodeRecall || 0).toFixed(3) + '</span>' +
					'<span><span class="swatch" style="background:#22c55e"></span>matched ' + (summary.matchedNodes || 0) + '</span>' +
					'<span><span class="swatch" style="background:#ef4444"></span>missing ' + (summary.missingNodes || 0) + '</span>' +
					'<span><span class="swatch" style="background:#f97316"></span>removals ' + (summary.removalNodes || 0) + '</span>' +
					(summary.treeId ? '<span>tree ' + summary.treeId + '</span>' : '');
			}

			function setGraph(graph) {
				ensureCy();
				// Container often starts at 0×0 (panel was display:none). Must resize before layout.
				cy.resize();
				setHeader(graph && graph.summary);
				const nodes = (graph?.nodes ?? []).map(n => ({
					data: {
						id: n.id,
						label: n.label,
						color: STATUS_COLORS[n.status] || '#94a3b8',
						status: n.status,
					}
				}));
				const edges = (graph?.edges ?? []).map(e => ({
					data: {
						id: e.id,
						source: e.from,
						target: e.to,
						label: e.label || e.predicate || '',
						color: STATUS_COLORS[e.status] || '#94a3b8',
						lineStyle: e.confidence === 'speculative' || e.status === 'speculative_missing' ? 'dashed' : 'solid',
					}
				}));
				cy.elements().remove();
				cy.add(nodes);
				cy.add(edges);
				try {
					cy.layout({ name: 'fcose', animate: false, fit: true, padding: 40, quality: 'default', randomize: true }).run();
				} catch (_e1) {
					try {
						cy.layout({ name: 'cose', animate: false, fit: true, padding: 40 }).run();
					} catch (_e2) {
						cy.layout({ name: 'grid', animate: false, fit: true, padding: 40 }).run();
					}
				}
				cy.fit(undefined, 40);
			}

			window.addEventListener('message', (event) => {
				const msg = event.data;
				if (!msg || typeof msg !== 'object') { return; }
				if (msg.type === 'proposalGraphDiff.setGraph') {
					setGraph(msg.graph);
				} else if (msg.type === 'proposalGraphDiff.setTheme') {
					currentTheme = msg.theme === 'light' ? 'light' : 'dark';
					if (cy) {
						cy.destroy();
						cy = undefined;
					}
				}
			});

			// When the overlay iframe itself is resized (panel shown), reflow Cytoscape.
			const ro = new ResizeObserver(() => {
				if (!cy) { return; }
				const el = document.getElementById('cy');
				if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) { return; }
				cy.resize();
				cy.fit(undefined, 40);
			});
			ro.observe(document.documentElement);

			ensureCy();
		})();
	</script>
</body>
</html>`);
	}
}

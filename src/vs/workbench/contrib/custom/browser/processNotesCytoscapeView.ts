/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { asWebviewUri, webviewGenericCspSource } from '../../webview/common/webview.js';
import type { ProcessNoteGraph } from './processNotesTypes.js';

export type ProcessNotesGraphNodeClickMessage = {
	type: 'processNotes.nodeClick';
	nodeId: string;
};

export type ProcessNotesGraphReadyMessage = {
	type: 'processNotes.ready';
};

export type ProcessNotesGraphWebviewMessage = ProcessNotesGraphNodeClickMessage | ProcessNotesGraphReadyMessage;

export class ProcessNotesCytoscapeView extends Disposable {
	private readonly webview: IOverlayWebview;

	constructor(
		private readonly webviewService: IWebviewService,
		private readonly localResourceRoots: readonly URI[],
		private readonly onMessage: (message: ProcessNotesGraphWebviewMessage) => void,
	) {
		super();

		this.webview = this._register(this.webviewService.createWebviewOverlay({
			title: localize('customMode.processNotes.graphTitle', 'Process Notes Graph'),
			options: {
				purpose: WebviewContentPurpose.WebviewView,
				enableFindWidget: false,
			},
			contentOptions: {
				allowScripts: true,
				localResourceRoots: this.localResourceRoots,
			},
			extension: undefined,
		}));

		this._register(this.webview.onMessage(e => this.onMessage(e.message as ProcessNotesGraphWebviewMessage)));
	}

	attach(anchor: HTMLElement, clippingContainer: HTMLElement): void {
		this.webview.claim(this, mainWindow, undefined);
		this.webview.setAnchorElement(anchor, clippingContainer);
		this._register(toDisposable(() => this.webview.release(this)));
	}

	asWebviewUri(resource: URI): URI {
		// Internal webviews use a fixed resource base host. This helper matches the workbench implementation.
		return asWebviewUri(resource);
	}

	setGraph(graph: ProcessNoteGraph): void {
		this.webview.postMessage({ type: 'processNotes.setGraph', graph });
	}

	setTheme(theme: 'dark' | 'light'): void {
		this.webview.postMessage({ type: 'processNotes.setTheme', theme });
	}

	setHtml(cytoscapeUri: URI, layoutBaseUri: URI, coseBaseUri: URI, fcoseUri: URI): void {
		const nonce = String(Math.random()).slice(2);
		const cspSource = webviewGenericCspSource;
		this.webview.setHtml(`<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<style>
		html, body { padding: 0; margin: 0; height: 100%; width: 100%; overflow: hidden; }
		#cy { position: absolute; inset: 0; }
		#hint {
			position: absolute;
			left: 10px; bottom: 10px;
			padding: 6px 8px;
			border-radius: 6px;
			font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;
			background: rgba(0,0,0,0.28);
			color: #fff;
			pointer-events: none;
		}
	</style>
</head>
<body>
	<div id="cy"></div>
	<div id="hint">drag to pan • wheel to zoom • topics: click to expand • detail: click node to open source</div>
	<script nonce="${nonce}" src="${cytoscapeUri.toString()}"></script>
	<script nonce="${nonce}" src="${layoutBaseUri.toString()}"></script>
	<script nonce="${nonce}" src="${coseBaseUri.toString()}"></script>
	<script nonce="${nonce}" src="${fcoseUri.toString()}"></script>
	<script nonce="${nonce}">
		(function() {
			const vscode = acquireVsCodeApi();
			let cy;
			let currentTheme = 'dark';

			// cytoscape-fcose (UMD) exports "cytoscapeFcose" but may not auto-register the layout.
			// It also expects "coseBase" to be loaded as a global.
			try {
				const ext = (globalThis).cytoscapeFcose;
				if (ext && typeof (globalThis).cytoscape?.use === 'function') {
					(globalThis).cytoscape.use(ext);
				}
			} catch {
				// ignore; layout will fail later and surface via console
			}

			function laneColor(lane) {
				switch (lane) {
					case 'Build': return '#d97706';
					case 'Preview': return '#0ea5e9';
					case 'Bridge': return '#8b5cf6';
					case 'Host': return '#22c55e';
					case 'Chat': return '#ef4444';
					default: return currentTheme === 'dark' ? '#94a3b8' : '#64748b';
				}
			}

			function topicOverviewColor() {
				return currentTheme === 'dark' ? '#475569' : '#64748b';
			}

			function ensureCy() {
				if (cy) { return; }
				// fcose registers itself as a cytoscape extension
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
								'font-size': 12,
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
								'target-arrow-color': currentTheme === 'dark' ? '#a3a3a3' : '#6b7280',
								'line-color': currentTheme === 'dark' ? '#a3a3a3' : '#6b7280',
								'width': 1.5,
								'label': 'data(label)',
								'font-size': 10,
								'text-background-color': currentTheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)',
								'text-background-opacity': 1,
								'text-background-padding': 2,
								'color': currentTheme === 'dark' ? '#e5e7eb' : '#111827',
								'text-rotation': 'autorotate',
							}
						},
						{
							selector: 'node[kind = "topic"]',
							style: {
								'padding': 18,
								'font-size': 13,
								'font-weight': '600',
								'text-max-width': 220,
								'border-width': 2,
								'border-color': currentTheme === 'dark' ? 'rgba(148,163,184,0.55)' : 'rgba(71,85,105,0.45)',
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

				cy.on('tap', 'node', (evt) => {
					const node = evt.target;
					const nodeId = node && node.id ? node.id() : '';
					if (nodeId) {
						vscode.postMessage({ type: 'processNotes.nodeClick', nodeId });
					}
				});

				vscode.postMessage({ type: 'processNotes.ready' });
			}

			function setGraph(graph) {
				ensureCy();
				const nodes = (graph?.nodes ?? []).map(n => {
					const kind = typeof n.kind === 'string' ? n.kind : '';
					const color = kind === 'topic' ? topicOverviewColor() : laneColor(n.lane);
					return {
						data: { id: n.id, label: n.label, color, kind },
					};
				});
				const edges = (graph?.edges ?? []).map((e, i) => ({
					data: {
						id: 'e' + String(i),
						source: e.from,
						target: e.to,
						label: e.type || ''
					}
				}));
				cy.elements().remove();
				cy.add(nodes);
				cy.add(edges);
				cy.layout({ name: 'fcose', animate: false, fit: true, padding: 40 }).run();
			}

			window.addEventListener('message', (event) => {
				const msg = event.data;
				if (!msg || typeof msg !== 'object') { return; }
				if (msg.type === 'processNotes.setGraph') {
					setGraph(msg.graph);
				} else if (msg.type === 'processNotes.setTheme') {
					currentTheme = msg.theme === 'light' ? 'light' : 'dark';
					// Re-apply styles by reconstructing graph (cheap for small graphs)
					if (cy) {
						const g = cy.json();
						cy.destroy();
						cy = undefined;
						ensureCy();
						// Graph will be resent by host on theme change; ignore here.
					}
				}
			});

			ensureCy();
		})();\n\t</script>
</body>
</html>`);
	}
}


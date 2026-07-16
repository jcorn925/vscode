/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { webviewGenericCspSource } from '../../webview/common/webview.js';
import type { GraphProposalDocument, ProposalDiffGraph } from './proposalGraphDiff/proposalGraphDiffTypes.js';
import type { ProposalWorkstreamPartition } from './proposalGraphDiff/partitionProposalWorkstreams.js';

export class SurfaceProposalTreeView extends Disposable {
	private readonly webview: IWebviewElement;
	private lastDocument: {
		proposal: GraphProposalDocument;
		graph: ProposalDiffGraph;
		partition?: ProposalWorkstreamPartition;
	} | undefined;

	constructor(webviewService: IWebviewService, onReady: () => void) {
		super();
		this.webview = this._register(webviewService.createWebviewElement({
			title: localize('surfaceProposalTree.title', 'Proposal tree'),
			options: {
				purpose: WebviewContentPurpose.WebviewView,
				enableFindWidget: true,
			},
			contentOptions: { allowScripts: true },
			extension: undefined,
		}));
		this._register(this.webview.onMessage(event => {
			if (event.message?.type === 'surfaceProposalTree.ready') {
				onReady();
			}
		}));
		this.setHtml();
	}

	attach(parent: HTMLElement): void {
		this.webview.mountTo(parent, mainWindow);
	}

	setDocument(
		proposal: GraphProposalDocument,
		graph: ProposalDiffGraph,
		partition?: ProposalWorkstreamPartition,
	): void {
		this.lastDocument = { proposal, graph, partition };
		void this.webview.postMessage({ type: 'surfaceProposalTree.setDocument', proposal, graph, partition });
	}

	republish(): void {
		if (this.lastDocument) {
			this.setDocument(this.lastDocument.proposal, this.lastDocument.graph, this.lastDocument.partition);
		}
	}

	private setHtml(): void {
		const nonce = String(Math.random()).slice(2);
		this.webview.setHtml(`<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewGenericCspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>
		:root { color-scheme: light dark; }
		* { box-sizing: border-box; }
		html, body { margin: 0; min-height: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
		body { padding: 18px 20px 28px; font: 13px/1.5 var(--vscode-font-family); }
		#content { max-width: 1180px; margin: 0 auto; }
		.meta {
			display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
			gap: 8px; margin-bottom: 18px;
		}
		.meta-item {
			min-width: 0; padding: 9px 11px; border: 1px solid var(--vscode-panel-border);
			border-radius: 6px; background: var(--vscode-sideBar-background);
		}
		.meta-key {
			display: block; margin-bottom: 2px; color: var(--vscode-descriptionForeground);
			font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
		}
		.meta-value { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
		.section {
			margin-top: 12px; border: 1px solid var(--vscode-panel-border);
			border-radius: 7px; overflow: hidden; background: var(--vscode-editor-background);
		}
		.section > summary {
			display: flex; align-items: center; gap: 8px; padding: 10px 12px;
			cursor: pointer; user-select: none; font-weight: 600;
			background: var(--vscode-sideBar-background); border-bottom: 1px solid transparent;
		}
		.section[open] > summary { border-bottom-color: var(--vscode-panel-border); }
		.count {
			padding: 1px 7px; border-radius: 10px; color: var(--vscode-badge-foreground);
			background: var(--vscode-badge-background); font-size: 11px; font-weight: 600;
		}
		.tree { padding: 10px 12px 14px; overflow: auto; font-family: var(--vscode-editor-font-family); }
		.tree ul { margin: 0; padding-left: 19px; list-style: none; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
		.tree > ul { padding-left: 0; border-left: 0; }
		.tree li { position: relative; margin: 2px 0; }
		.tree li::before {
			content: ''; position: absolute; left: -19px; top: 12px; width: 13px;
			border-top: 1px solid var(--vscode-tree-indentGuidesStroke);
		}
		.tree > ul > li::before { display: none; }
		.folder-row, .file-row { display: flex; align-items: center; min-height: 24px; gap: 7px; }
		.folder-row { color: var(--vscode-foreground); font-weight: 600; }
		.folder-row::before { content: '▾'; width: 12px; color: var(--vscode-descriptionForeground); font-size: 10px; }
		.file-row::before { content: '◇'; width: 12px; color: var(--vscode-descriptionForeground); font-size: 11px; }
		.file-path { color: var(--vscode-descriptionForeground); }
		.file-name { color: var(--vscode-symbolIcon-fileForeground, var(--vscode-foreground)); font-weight: 600; }
		.edges { display: grid; }
		.edge {
			display: grid; grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
			align-items: center; gap: 12px; min-height: 36px; padding: 7px 12px;
			border-bottom: 1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family);
		}
		.edge:last-child { border-bottom: 0; }
		.edge:hover { background: var(--vscode-list-hoverBackground); }
		.endpoint { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.relation {
			padding: 2px 8px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
			border-radius: 10px; color: var(--vscode-textLink-foreground); background: var(--vscode-textCodeBlock-background);
			font: 700 10px/1.5 var(--vscode-font-family); letter-spacing: .03em; text-transform: uppercase;
		}
		.prefixes { display: flex; flex-wrap: wrap; gap: 7px; padding: 12px; }
		.prefix {
			padding: 3px 8px; border-radius: 4px; color: var(--vscode-textPreformat-foreground);
			background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family);
		}
		.workstreams { display: grid; gap: 10px; padding: 12px; }
		.workstream {
			border: 1px solid var(--vscode-panel-border); border-radius: 6px;
			background: var(--vscode-sideBar-background); padding: 10px 12px;
		}
		.workstream-header {
			display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;
		}
		.workstream-id {
			font: 700 10px/1.4 var(--vscode-font-family); letter-spacing: .04em;
			text-transform: uppercase; color: var(--vscode-descriptionForeground);
		}
		.workstream-label { font-weight: 700; font-family: var(--vscode-editor-font-family); }
		.badge {
			padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 700;
			letter-spacing: .03em; text-transform: uppercase;
		}
		.badge-parallel {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
			background: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-charts-green)) 18%, transparent);
		}
		.badge-coupled {
			color: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange));
			background: color-mix(in srgb, var(--vscode-editorWarning-foreground, var(--vscode-charts-orange)) 18%, transparent);
		}
		.workstream-meta {
			color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 6px;
		}
		.workstream-nodes {
			margin: 0; padding-left: 18px; font-family: var(--vscode-editor-font-family); font-size: 12px;
		}
		.workstream-nodes li { margin: 2px 0; }
		.workstream-note {
			margin: 6px 0 0; color: var(--vscode-descriptionForeground); font-size: 11px;
		}
		.parallel-banner {
			margin: 0 12px 10px; padding: 8px 10px; border-radius: 6px;
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-textCodeBlock-background);
			color: var(--vscode-descriptionForeground); font-size: 12px;
		}
		.architecture, .phase-body { padding: 12px 14px; }
		.architecture-summary {
			margin: 0 0 12px; color: var(--vscode-foreground); white-space: pre-wrap;
		}
		.architecture-tree {
			margin: 0; padding: 12px; overflow: auto;
			border-radius: 6px; border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-textCodeBlock-background);
			color: var(--vscode-editor-foreground);
			font: 12px/1.45 var(--vscode-editor-font-family);
			white-space: pre;
		}
		.phase {
			padding: 12px 14px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.phase:last-child { border-bottom: 0; }
		.phase-title {
			margin: 0 0 8px; font-size: 13px; font-weight: 700;
		}
		.phase-items {
			margin: 0; padding-left: 18px;
		}
		.phase-items li {
			margin: 4px 0;
		}
		.empty { padding: 30px; color: var(--vscode-descriptionForeground); text-align: center; }
		@media (max-width: 700px) {
			body { padding: 12px; }
			.edge { grid-template-columns: 1fr; gap: 4px; }
			.relation { justify-self: start; }
		}
	</style>
</head>
<body>
	<main id="content"><div class="empty">Loading proposal…</div></main>
	<script nonce="${nonce}">
		(() => {
			const vscode = acquireVsCodeApi();
			const content = document.getElementById('content');
			const text = value => value == null ? '—' : String(value);
			const clean = value => text(value).replace(/^file:/, '');

			function el(tag, className, value) {
				const node = document.createElement(tag);
				if (className) node.className = className;
				if (value != null) node.textContent = text(value);
				return node;
			}

			function metaItem(key, value) {
				const item = el('div', 'meta-item');
				item.append(el('span', 'meta-key', key), el('span', 'meta-value', value));
				item.title = text(value);
				return item;
			}

			function makeFolderTree(paths) {
				const root = { folders: new Map(), files: [] };
				for (const raw of paths) {
					const parts = clean(raw).split('/').filter(Boolean);
					let cursor = root;
					for (let i = 0; i < parts.length - 1; i++) {
						if (!cursor.folders.has(parts[i])) cursor.folders.set(parts[i], { folders: new Map(), files: [] });
						cursor = cursor.folders.get(parts[i]);
					}
					if (parts.length) cursor.files.push(parts[parts.length - 1]);
				}
				return root;
			}

			function renderFolder(node, name) {
				const li = el('li');
				if (name) li.append(el('div', 'folder-row', name));
				const list = el('ul');
				for (const [folderName, folder] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
					list.append(renderFolder(folder, folderName));
				}
				for (const file of [...node.files].sort()) {
					const fileLi = el('li');
					fileLi.append(el('div', 'file-row file-name', file));
					list.append(fileLi);
				}
				li.append(list);
				return li;
			}

			function section(title, count, open = true) {
				const details = el('details', 'section');
				details.open = open;
				const summary = el('summary');
				summary.append(el('span', '', title), el('span', 'count', count));
				details.append(summary);
				return details;
			}

			function render(proposal, graph, partition) {
				content.replaceChildren();
				const meta = el('div', 'meta');
				meta.append(
					metaItem('Tree', proposal.tree_id),
					metaItem('Surface', proposal.surface_id),
					metaItem('Root', proposal.root),
					metaItem('Plan', proposal.plan_ref),
					metaItem('Version', proposal.version),
					metaItem('Created', proposal.created_at),
					metaItem('Workstreams', partition?.workstreams?.length ?? '—'),
					metaItem('Parallelizable', partition?.canParallelize ? 'yes' : 'no')
				);
				content.append(meta);

				if (partition?.workstreams?.length) {
					const wsSection = section('Parallel workstreams', partition.workstreams.length, true);
					const banner = el('div', 'parallel-banner');
					const safeCount = partition.workstreams.filter(w => w.parallelSafe).length;
					banner.textContent = partition.canParallelize
						? (safeCount + ' disconnected streams can run as parallel agents (structural edges only; REGISTERS/DESCRIBES ignored).')
						: partition.workstreams.length === 1
							? 'Single connected cluster — run as one agent stream.'
							: 'Multiple streams share node_prefixes — serialize shared packages or assign one owner first.';
					wsSection.append(banner);
					const list = el('div', 'workstreams');
					for (const stream of partition.workstreams) {
						const card = el('div', 'workstream');
						const header = el('div', 'workstream-header');
						header.append(
							el('span', 'workstream-id', stream.id),
							el('span', 'workstream-label', stream.label),
							el('span', 'badge ' + (stream.parallelSafe ? 'badge-parallel' : 'badge-coupled'),
								stream.parallelSafe ? 'parallel-safe' : 'coupled')
						);
						card.append(header);
						card.append(el('div', 'workstream-meta',
							stream.nodes.length + ' files · ' + stream.edges.length + ' structural edges'));
						const nodeList = el('ul', 'workstream-nodes');
						for (const node of stream.nodes) {
							nodeList.append(el('li', '', clean(node)));
						}
						card.append(nodeList);
						if (stream.sharedPrefixes?.length) {
							card.append(el('p', 'workstream-note',
								'Shared prefixes: ' + stream.sharedPrefixes.join(', ')));
						}
						list.append(card);
					}
					wsSection.append(list);
					content.append(wsSection);
				}

				const architecture = proposal.architecture;
				if (architecture && (architecture.summary || architecture.tree)) {
					const archSection = section('Architecture', architecture.tree ? 'tree' : 'notes');
					const archBody = el('div', 'architecture');
					if (architecture.summary) {
						archBody.append(el('p', 'architecture-summary', architecture.summary));
					}
					if (architecture.tree) {
						const pre = el('pre', 'architecture-tree', architecture.tree);
						archBody.append(pre);
					}
					archSection.append(archBody);
					content.append(archSection);
				}

				const phases = proposal.phases || [];
				if (phases.length) {
					const phasesSection = section('Phased checklist', phases.length);
					for (const phase of phases) {
						const phaseEl = el('div', 'phase');
						phaseEl.append(el('h3', 'phase-title', phase.title || phase.id || 'Phase'));
						const items = el('ul', 'phase-items');
						for (const item of phase.items || []) {
							items.append(el('li', '', item));
						}
						phaseEl.append(items);
						phasesSection.append(phaseEl);
					}
					content.append(phasesSection);
				}

				const nodes = proposal.add_nodes || [];
				const filesSection = section('Files to add', nodes.length);
				const tree = el('div', 'tree');
				const rootList = el('ul');
				const folderRoot = makeFolderTree(nodes);
				for (const [name, folder] of [...folderRoot.folders].sort(([a], [b]) => a.localeCompare(b))) {
					rootList.append(renderFolder(folder, name));
				}
				for (const file of [...folderRoot.files].sort()) {
					const li = el('li');
					li.append(el('div', 'file-row file-name', file));
					rootList.append(li);
				}
				tree.append(rootList);
				filesSection.append(tree);
				content.append(filesSection);

				const edges = proposal.add_edges || [];
				const edgesSection = section('Relationships', edges.length);
				const edgeList = el('div', 'edges');
				for (const edge of edges) {
					const row = el('div', 'edge');
					const from = clean(edge.src || edge.from);
					const to = clean(edge.dst || edge.to);
					const relation = edge.predicate || edge.type || 'links';
					const fromEl = el('span', 'endpoint', from);
					const toEl = el('span', 'endpoint', to);
					fromEl.title = from;
					toEl.title = to;
					row.append(fromEl, el('span', 'relation', relation), toEl);
					edgeList.append(row);
				}
				edgesSection.append(edgeList);
				content.append(edgesSection);

				const prefixes = proposal.node_prefixes || [];
				if (prefixes.length) {
					const prefixSection = section('Node prefixes', prefixes.length, false);
					const prefixList = el('div', 'prefixes');
					for (const prefix of prefixes) prefixList.append(el('span', 'prefix', prefix));
					prefixSection.append(prefixList);
					content.append(prefixSection);
				}

				const removals = (proposal.remove_nodes?.length || 0) + (proposal.remove_edges?.length || 0);
				if (removals) {
					const removalSection = section('Removals', removals, false);
					const removalBody = el('div', 'prefixes');
					for (const node of proposal.remove_nodes || []) removalBody.append(el('span', 'prefix', clean(node)));
					for (const edge of proposal.remove_edges || []) removalBody.append(el('span', 'prefix', JSON.stringify(edge)));
					removalSection.append(removalBody);
					content.append(removalSection);
				}
			}

			window.addEventListener('message', event => {
				const message = event.data;
				if (message?.type === 'surfaceProposalTree.setDocument') {
					render(message.proposal, message.graph, message.partition);
				}
			});
			vscode.postMessage({ type: 'surfaceProposalTree.ready' });
		})();
	</script>
</body>
</html>`);
	}
}

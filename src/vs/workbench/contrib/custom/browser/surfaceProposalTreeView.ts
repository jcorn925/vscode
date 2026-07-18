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

export interface SurfaceProposalTreeDocumentOptions {
	readonly proposal?: GraphProposalDocument;
	readonly graph?: ProposalDiffGraph;
	readonly partition?: ProposalWorkstreamPartition;
	readonly planMarkdown?: string;
	readonly storageKey?: string;
	readonly proposalMissingMessage?: string;
}

export class SurfaceProposalTreeView extends Disposable {
	private readonly webview: IWebviewElement;
	private lastDocument: SurfaceProposalTreeDocumentOptions | undefined;

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

	setDocument(options: SurfaceProposalTreeDocumentOptions): void {
		this.lastDocument = options;
		void this.webview.postMessage({ type: 'surfaceProposalTree.setDocument', ...options });
	}

	republish(): void {
		if (this.lastDocument) {
			this.setDocument(this.lastDocument);
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
			display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
			gap: 8px; margin-bottom: 4px;
		}
		.meta-item {
			display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
			padding: 10px 12px; border: 1px solid var(--vscode-panel-border);
			border-radius: 7px; background: var(--vscode-sideBar-background);
			cursor: pointer; text-align: left; color: inherit; font: inherit; width: 100%;
			opacity: 1; transition: opacity .12s ease, border-color .12s ease, background .12s ease;
		}
		.meta-item:hover { border-color: var(--vscode-focusBorder); }
		.meta-item[aria-pressed="false"] {
			opacity: .45; background: transparent;
		}
		.meta-key {
			font: 700 10px/1.3 var(--vscode-font-family); letter-spacing: .04em;
			text-transform: uppercase; color: var(--vscode-descriptionForeground);
		}
		.meta-value {
			font-weight: 600; color: var(--vscode-foreground);
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
		}
		.section {
			margin-top: 12px; border: 1px solid var(--vscode-panel-border);
			border-radius: 7px; overflow: hidden; background: var(--vscode-editor-background);
		}
		.section.hidden { display: none; }
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
		.plan-body {
			padding: 12px 14px; white-space: pre-wrap;
			font: 13px/1.55 var(--vscode-font-family); color: var(--vscode-foreground);
		}
		.plan-body h1, .plan-body h2, .plan-body h3 {
			margin: 1em 0 .4em; font-weight: 700; line-height: 1.3;
		}
		.plan-body h1 { font-size: 1.35em; }
		.plan-body h2 { font-size: 1.2em; }
		.plan-body h3 { font-size: 1.05em; }
		.plan-body h1:first-child, .plan-body h2:first-child, .plan-body h3:first-child { margin-top: 0; }
		.plan-body p { margin: 0 0 .75em; }
		.plan-body ul, .plan-body ol { margin: 0 0 .75em; padding-left: 1.4em; }
		.plan-body li { margin: .25em 0; }
		.plan-body code {
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px;
		}
		.plan-body pre {
			margin: 0 0 .75em; padding: 10px 12px; overflow: auto;
			border-radius: 6px; border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-textCodeBlock-background);
			font: 12px/1.45 var(--vscode-editor-font-family); white-space: pre-wrap;
		}
		.plan-body pre code { background: transparent; padding: 0; }
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
			white-space: pre-wrap;
			tab-size: 2;
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
			let visibilityKey = 'surfaceProposalTree.visibility';
			let sectionVisibility = {};

			/** architecture.tree is often a string[] of lines; String(array) joins with commas and flattens the tree. */
			function normalizeArchitectureTree(tree) {
				let raw;
				if (Array.isArray(tree)) {
					raw = tree.map(line => String(line ?? '')).join('\\n');
				} else {
					raw = String(tree ?? '');
				}
				raw = raw.replace(/\\\\n/g, '\\n');
				// Rescue comma-joined ascii rows: ", |--" / ", |" (from Array.toString or LLM one-liners)
				if (!/\\n/.test(raw) || (raw.match(/\\n/g) || []).length < 2) {
					raw = raw.replace(/,\\s*(?=\\|)/g, '\\n');
				}
				// Rescue root files joined with " / " when still flat
				if (!/\\n/.test(raw) && /\\s\\/\\s/.test(raw)) {
					raw = raw.replace(/\\s\\/\\s+/g, '\\n');
				}
				return raw.replace(/\\n{3,}/g, '\\n\\n').trimEnd();
			}

			function el(tag, className, value) {
				const node = document.createElement(tag);
				if (className) node.className = className;
				if (value != null) node.textContent = text(value);
				return node;
			}

			function escapeHtml(value) {
				return text(value)
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;');
			}

			function inlineMarkdown(value) {
				let html = escapeHtml(value);
				html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
				html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
				html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
				return html;
			}

			function renderPlanMarkdown(markdown) {
				const body = el('div', 'plan-body');
				const lines = String(markdown || '').replace(/\\r\\n/g, '\\n').split('\\n');
				let i = 0;
				let list = null;
				let listTag = null;
				const flushList = () => {
					if (list) {
						body.append(list);
						list = null;
						listTag = null;
					}
				};
				while (i < lines.length) {
					const line = lines[i];
					if (/^\`\`\`/.test(line)) {
						flushList();
						const fence = [];
						i++;
						while (i < lines.length && !/^\`\`\`/.test(lines[i])) {
							fence.push(lines[i]);
							i++;
						}
						const pre = el('pre');
						const code = el('code');
						code.textContent = fence.join('\\n');
						pre.append(code);
						body.append(pre);
						i++;
						continue;
					}
					const heading = /^(#{1,3})\\s+(.*)$/.exec(line);
					if (heading) {
						flushList();
						body.append(el('h' + heading[1].length, '', heading[2]));
						i++;
						continue;
					}
					const ul = /^[-*]\\s+(.*)$/.exec(line);
					if (ul) {
						if (listTag !== 'ul') {
							flushList();
							list = el('ul');
							listTag = 'ul';
						}
						const li = el('li');
						li.innerHTML = inlineMarkdown(ul[1]);
						list.append(li);
						i++;
						continue;
					}
					const ol = /^\\d+\\.\\s+(.*)$/.exec(line);
					if (ol) {
						if (listTag !== 'ol') {
							flushList();
							list = el('ol');
							listTag = 'ol';
						}
						const li = el('li');
						li.innerHTML = inlineMarkdown(ol[1]);
						list.append(li);
						i++;
						continue;
					}
					if (!line.trim()) {
						flushList();
						i++;
						continue;
					}
					flushList();
					const p = el('p');
					p.innerHTML = inlineMarkdown(line);
					body.append(p);
					i++;
				}
				flushList();
				return body;
			}

			function loadVisibility(ids) {
				let stored = {};
				try {
					stored = JSON.parse(sessionStorage.getItem(visibilityKey) || '{}') || {};
				} catch {
					stored = {};
				}
				const next = {};
				for (const id of ids) {
					next[id] = stored[id] !== false;
				}
				sectionVisibility = next;
				return next;
			}

			function saveVisibility() {
				try {
					sessionStorage.setItem(visibilityKey, JSON.stringify(sectionVisibility));
				} catch {
					// ignore quota / private mode
				}
			}

			function applyVisibility() {
				for (const [id, visible] of Object.entries(sectionVisibility)) {
					const section = content.querySelector('[data-section="' + id + '"]');
					if (section) {
						section.classList.toggle('hidden', !visible);
					}
					const card = content.querySelector('.meta-item[data-section="' + id + '"]');
					if (card) {
						card.setAttribute('aria-pressed', visible ? 'true' : 'false');
					}
				}
			}

			function toggleCard(id) {
				sectionVisibility[id] = !sectionVisibility[id];
				saveVisibility();
				applyVisibility();
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

			function section(id, title, count, open = true) {
				const details = el('details', 'section');
				details.dataset.section = id;
				details.open = open;
				const summary = el('summary');
				summary.append(el('span', '', title), el('span', 'count', count));
				details.append(summary);
				return details;
			}

			function metaCard(id, label, value) {
				const item = el('button', 'meta-item');
				item.type = 'button';
				item.dataset.section = id;
				item.setAttribute('aria-pressed', 'true');
				item.append(el('span', 'meta-key', label), el('span', 'meta-value', value));
				item.title = text(value);
				item.addEventListener('click', () => toggleCard(id));
				return item;
			}

			function render(options) {
				const proposal = options.proposal;
				const partition = options.partition;
				const planMarkdown = options.planMarkdown;
				const proposalMissingMessage = options.proposalMissingMessage;
				visibilityKey = options.storageKey || 'surfaceProposalTree.visibility';
				content.replaceChildren();

				const cards = [];
				const sections = [];

				if (planMarkdown && planMarkdown.trim()) {
					cards.push(metaCard('plan', 'Plan', 'plan.md'));
					const planSection = section('plan', 'Plan', 'md', true);
					planSection.append(renderPlanMarkdown(planMarkdown));
					sections.push(planSection);
				}

				if (proposal) {
					if (partition?.workstreams?.length) {
						cards.push(metaCard('workstreams', 'Workstreams', partition.workstreams.length));
						const wsSection = section('workstreams', 'Parallel workstreams', partition.workstreams.length, true);
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
						sections.push(wsSection);
					}

					const architecture = proposal.architecture;
					if (architecture && (architecture.summary || architecture.tree)) {
						cards.push(metaCard('architecture', 'Architecture', architecture.tree ? 'tree' : 'notes'));
						const archSection = section('architecture', 'Architecture', architecture.tree ? 'tree' : 'notes');
						const archBody = el('div', 'architecture');
						if (architecture.summary) {
							archBody.append(el('p', 'architecture-summary', architecture.summary));
						}
						if (architecture.tree) {
							const pre = el('pre', 'architecture-tree');
							pre.textContent = normalizeArchitectureTree(architecture.tree);
							archBody.append(pre);
						}
						archSection.append(archBody);
						sections.push(archSection);
					}

					const phases = proposal.phases || [];
					if (phases.length) {
						cards.push(metaCard('phases', 'Phases', phases.length));
						const phasesSection = section('phases', 'Phased checklist', phases.length);
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
						sections.push(phasesSection);
					}

					const nodes = proposal.add_nodes || [];
					if (nodes.length) {
						cards.push(metaCard('files', 'Files', nodes.length));
						const filesSection = section('files', 'Files to add', nodes.length);
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
						sections.push(filesSection);
					}

					const edges = proposal.add_edges || [];
					if (edges.length) {
						cards.push(metaCard('relationships', 'Relationships', edges.length));
						const edgesSection = section('relationships', 'Relationships', edges.length);
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
						sections.push(edgesSection);
					}

					const prefixes = proposal.node_prefixes || [];
					if (prefixes.length) {
						cards.push(metaCard('prefixes', 'Prefixes', prefixes.length));
						const prefixSection = section('prefixes', 'Node prefixes', prefixes.length, false);
						const prefixList = el('div', 'prefixes');
						for (const prefix of prefixes) prefixList.append(el('span', 'prefix', prefix));
						prefixSection.append(prefixList);
						sections.push(prefixSection);
					}

					const removals = (proposal.remove_nodes?.length || 0) + (proposal.remove_edges?.length || 0);
					if (removals) {
						cards.push(metaCard('removals', 'Removals', removals));
						const removalSection = section('removals', 'Removals', removals, false);
						const removalBody = el('div', 'prefixes');
						for (const node of proposal.remove_nodes || []) removalBody.append(el('span', 'prefix', clean(node)));
						for (const edge of proposal.remove_edges || []) removalBody.append(el('span', 'prefix', JSON.stringify(edge)));
						removalSection.append(removalBody);
						sections.push(removalSection);
					}
				} else if (proposalMissingMessage) {
					sections.push(el('div', 'empty', proposalMissingMessage));
				}

				if (!cards.length && !sections.length) {
					content.append(el('div', 'empty', 'No plan or proposal content yet.'));
					return;
				}

				if (cards.length) {
					const meta = el('div', 'meta');
					for (const card of cards) meta.append(card);
					content.append(meta);
					loadVisibility(cards.map(c => c.dataset.section));
				}

				for (const sectionEl of sections) {
					content.append(sectionEl);
				}
				applyVisibility();
			}

			window.addEventListener('message', event => {
				const message = event.data;
				if (message?.type === 'surfaceProposalTree.setDocument') {
					render(message);
				}
			});
			vscode.postMessage({ type: 'surfaceProposalTree.ready' });
		})();
	</script>
</body>
</html>`);
	}
}

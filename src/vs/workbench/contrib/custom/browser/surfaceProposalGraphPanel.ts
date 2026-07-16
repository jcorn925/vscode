/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { graphProposalResource } from '../../../../../custom/agentTaskTree/agentTaskTreeGraphProposal.js';
import { taskTreesFolder } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { buildProposalPreviewGraph } from './proposalGraphDiff/buildProposalDiffGraph.js';
import { ProposalGraphDiffCytoscapeView } from './proposalGraphDiff/proposalGraphDiffCytoscapeView.js';
import type { GraphProposalDocument, ProposalDiffGraph } from './proposalGraphDiff/proposalGraphDiffTypes.js';

export interface SurfaceProposalGraphPanelLoadOptions {
	readonly surfaceId: string;
	readonly surfaceName?: string;
	readonly treeId?: string;
	readonly workspaceFolder: URI | undefined;
}

export class SurfaceProposalGraphPanel extends Disposable {
	private readonly titleEl: HTMLElement;
	private readonly pathEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly bodyEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private readonly graphAnchor: HTMLElement;
	private readonly view: ProposalGraphDiffCytoscapeView;
	private readonly watcher = this._register(new MutableDisposable());
	private lastOptions: SurfaceProposalGraphPanelLoadOptions | undefined;
	private lastGraph: ProposalDiffGraph | undefined;
	private loadGeneration = 0;
	private htmlReady = false;

	constructor(
		private readonly root: HTMLElement,
		private readonly fileService: IFileService,
		webviewService: IWebviewService,
		environmentService: INativeEnvironmentService,
		themeService: IThemeService,
	) {
		super();

		this.titleEl = $('div.custom-mode-surface-proposal-graph-title');
		this.pathEl = $('div.custom-mode-surface-proposal-graph-path');
		this.statusEl = $('div.custom-mode-surface-proposal-graph-status');
		this.refreshButton = $('button.custom-mode-surface-proposal-graph-refresh', {
			type: 'button',
		}, localize('surfaceProposalGraph.refresh', 'Refresh')) as HTMLButtonElement;
		const headerTop = $('div.custom-mode-surface-proposal-graph-header-top', undefined, this.titleEl, this.refreshButton);
		const header = $('div.custom-mode-surface-proposal-graph-header', undefined, headerTop, this.pathEl, this.statusEl);
		this.bodyEl = $('div.custom-mode-surface-proposal-graph-body');
		this.emptyEl = $('div.custom-mode-surface-proposal-graph-empty');
		this.graphAnchor = $('div.custom-mode-surface-proposal-graph-anchor');
		this.bodyEl.appendChild(this.emptyEl);
		this.bodyEl.appendChild(this.graphAnchor);
		this.root.appendChild($('div.custom-mode-surface-proposal-graph', undefined, header, this.bodyEl));

		const appRoot = environmentService.appRoot
			? URI.file(environmentService.appRoot)
			: undefined;
		const cytoscapeRoot = appRoot ? joinPath(appRoot, 'node_modules', 'cytoscape', 'dist') : undefined;
		const layoutBaseRoot = appRoot ? joinPath(appRoot, 'node_modules', 'layout-base') : undefined;
		const coseBaseRoot = appRoot ? joinPath(appRoot, 'node_modules', 'cose-base') : undefined;
		const fcoseRoot = appRoot ? joinPath(appRoot, 'node_modules', 'cytoscape-fcose') : undefined;
		const roots = [cytoscapeRoot, layoutBaseRoot, coseBaseRoot, fcoseRoot].filter((uri): uri is URI => Boolean(uri));

		this.view = this._register(new ProposalGraphDiffCytoscapeView(webviewService, roots, () => {
			// Webview scripts finish after first setGraph may have been dropped — re-push.
			if (this.lastGraph) {
				this.view.setGraph(this.lastGraph);
			}
		}));
		this.view.attach(this.graphAnchor, this.bodyEl);
		if (cytoscapeRoot && layoutBaseRoot && coseBaseRoot && fcoseRoot) {
			this.view.setHtml(
				joinPath(cytoscapeRoot, 'cytoscape.min.js'),
				joinPath(layoutBaseRoot, 'layout-base.js'),
				joinPath(coseBaseRoot, 'cose-base.js'),
				joinPath(fcoseRoot, 'cytoscape-fcose.js'),
			);
			this.htmlReady = true;
			this.view.setTheme(isDark(themeService.getColorTheme().type) ? 'dark' : 'light');
		}
		this._register(themeService.onDidColorThemeChange(() => {
			this.view.setTheme(isDark(themeService.getColorTheme().type) ? 'dark' : 'light');
		}));

		// Overlay webview often attaches while the panel is display:none (0×0). Re-push
		// the graph once the body first gets a real size so Cytoscape can layout.
		let hadSize = false;
		const resizeObserver = new ResizeObserver(() => {
			const hasSize = this.bodyEl.clientWidth > 0 && this.bodyEl.clientHeight > 0;
			if (hasSize && !hadSize && this.lastGraph) {
				this.view.setGraph(this.lastGraph);
			}
			hadSize = hasSize;
		});
		resizeObserver.observe(this.bodyEl);
		this._register(toDisposable(() => resizeObserver.disconnect()));

		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (this.lastOptions) {
				void this.load({ ...this.lastOptions });
			}
		}));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.showEmpty(localize('surfaceProposalGraph.selectSurface', 'Select a surface to view its proposal graph.'));
	}

	async load(options: SurfaceProposalGraphPanelLoadOptions): Promise<void> {
		this.lastOptions = options;
		const generation = ++this.loadGeneration;
		const { surfaceId, surfaceName, treeId, workspaceFolder } = options;
		this.titleEl.textContent = localize('surfaceProposalGraph.title', '{0} proposal graph', surfaceName?.trim() || surfaceId);
		this.pathEl.textContent = '';
		this.statusEl.textContent = localize('surfaceProposalGraph.loading', 'Loading…');

		if (!workspaceFolder) {
			this.showEmpty(localize('surfaceProposalGraph.noWorkspace', 'Open a workspace folder to load the proposal graph.'));
			return;
		}
		if (!this.htmlReady) {
			this.showEmpty(localize('surfaceProposalGraph.noAssets', 'Cytoscape assets unavailable (no app root).'));
			return;
		}

		const resource = await this.resolveProposalResource(workspaceFolder, surfaceId, treeId);
		if (generation !== this.loadGeneration) {
			return;
		}
		this.watchProposal(workspaceFolder, surfaceId, treeId);

		if (!resource) {
			const expected = graphProposalResource(taskTreesFolder(workspaceFolder), surfaceId);
			this.pathEl.textContent = expected.path;
			this.showEmpty(localize(
				'surfaceProposalGraph.missing',
				'No proposal graph yet for {0}. Start New Surface (Claude) or add {1}.',
				surfaceId,
				`.agent/task-trees/${surfaceId}.graph-proposal.json`,
			));
			return;
		}

		try {
			const content = await this.fileService.readFile(resource);
			if (generation !== this.loadGeneration) {
				return;
			}
			const proposal = JSON.parse(content.value.toString()) as GraphProposalDocument;
			const graph = buildProposalPreviewGraph(proposal);
			this.pathEl.textContent = resource.path;
			this.statusEl.textContent = localize(
				'surfaceProposalGraph.loaded',
				'Proposal loaded · {0} nodes · {1} edges',
				String(graph.nodes.length),
				String(graph.edges.length),
			);
			this.emptyEl.classList.add('hidden');
			this.emptyEl.textContent = '';
			this.graphAnchor.classList.remove('hidden');
			this.publishGraph(graph);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.pathEl.textContent = resource.path;
			this.showEmpty(localize('surfaceProposalGraph.readFailed', 'Could not read the proposal graph for {0}.', surfaceId));
		}
	}

	private publishGraph(graph: ProposalDiffGraph): void {
		this.lastGraph = graph;
		this.view.setGraph(graph);
		// Second push after layout so the overlay has non-zero bounds.
		requestAnimationFrame(() => {
			if (this.lastGraph === graph) {
				this.view.setGraph(graph);
			}
		});
	}

	private async resolveProposalResource(workspaceFolder: URI, surfaceId: string, treeId?: string): Promise<URI | undefined> {
		const folder = taskTreesFolder(workspaceFolder);
		const candidates = [
			...(treeId && treeId !== surfaceId ? [graphProposalResource(folder, treeId)] : []),
			graphProposalResource(folder, surfaceId),
		];
		for (const candidate of candidates) {
			if (await this.fileService.exists(candidate)) {
				return candidate;
			}
		}
		return undefined;
	}

	private watchProposal(workspaceFolder: URI, surfaceId: string, treeId?: string): void {
		const folder = taskTreesFolder(workspaceFolder);
		const watchTargets = [
			...(treeId && treeId !== surfaceId ? [graphProposalResource(folder, treeId)] : []),
			graphProposalResource(folder, surfaceId),
		];
		const store = new DisposableStore();
		for (const target of watchTargets) {
			store.add(this.fileService.watch(dirname(target)));
		}
		store.add(this.fileService.onDidFilesChange(e => {
			if (watchTargets.some(target => e.contains(target)) && this.lastOptions) {
				void this.load({ ...this.lastOptions });
			}
		}));
		this.watcher.value = store;
	}

	private showEmpty(message: string): void {
		this.statusEl.textContent = '';
		this.emptyEl.textContent = message;
		this.emptyEl.classList.remove('hidden');
		this.graphAnchor.classList.add('hidden');
		this.publishGraph({
			nodes: [],
			edges: [],
			summary: {
				passed: true,
				nodeRecall: 0,
				structuralEdgeRecall: 0,
				matchedNodes: 0,
				missingNodes: 0,
				removalNodes: 0,
			},
		});
	}
}

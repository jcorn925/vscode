/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { graphProposalResource } from '../../../../../custom/agentTaskTree/agentTaskTreeGraphProposal.js';
import { taskTreesFolder } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { buildProposalPreviewGraph } from './proposalGraphDiff/buildProposalDiffGraph.js';
import { partitionProposalWorkstreams } from './proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument } from './proposalGraphDiff/proposalGraphDiffTypes.js';
import { SurfaceProposalTreeView } from './surfaceProposalTreeView.js';

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
	private readonly treeAnchor: HTMLElement;
	private readonly treeView: SurfaceProposalTreeView;
	private readonly watcher = this._register(new MutableDisposable());
	private lastOptions: SurfaceProposalGraphPanelLoadOptions | undefined;
	private loadGeneration = 0;

	constructor(
		private readonly root: HTMLElement,
		private readonly fileService: IFileService,
		webviewService: IWebviewService,
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
		this.treeAnchor = $('div.custom-mode-surface-proposal-graph-anchor');
		this.bodyEl.appendChild(this.emptyEl);
		this.bodyEl.appendChild(this.treeAnchor);
		this.root.appendChild($('div.custom-mode-surface-proposal-graph', undefined, header, this.bodyEl));

		this.treeView = this._register(new SurfaceProposalTreeView(webviewService, () => this.treeView.republish()));
		this.treeView.attach(this.treeAnchor);
		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (this.lastOptions) {
				void this.load({ ...this.lastOptions });
			}
		}));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.showEmpty(localize('surfaceProposalGraph.selectSurface', 'Select a surface to view its proposed code graph.'));
	}

	async load(options: SurfaceProposalGraphPanelLoadOptions): Promise<void> {
		this.lastOptions = options;
		const generation = ++this.loadGeneration;
		const { surfaceId, surfaceName, treeId, workspaceFolder } = options;
		this.titleEl.textContent = localize('surfaceProposalGraph.title', '{0} proposed code graph', surfaceName?.trim() || surfaceId);
		this.setPathDisplay(undefined);
		this.statusEl.textContent = localize('surfaceProposalGraph.loading', 'Loading…');

		if (!workspaceFolder) {
			this.showEmpty(localize('surfaceProposalGraph.noWorkspace', 'Open a workspace folder to load the proposed code graph.'));
			return;
		}

		const resource = await this.resolveProposalResource(workspaceFolder, surfaceId, treeId);
		if (generation !== this.loadGeneration) {
			return;
		}
		this.watchProposal(workspaceFolder, surfaceId, treeId);

		if (!resource) {
			const expected = graphProposalResource(taskTreesFolder(workspaceFolder), surfaceId);
			this.setPathDisplay(expected);
			this.showEmpty(localize(
				'surfaceProposalGraph.missing',
				'No proposed code graph yet for {0}. Start New Surface (Claude) or add {1}.',
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
			const partition = partitionProposalWorkstreams(proposal);
			this.setPathDisplay(resource);
			const serializeHint = partition.serializeGroups.length
				? localize(
					'surfaceProposalGraph.serializeHint',
					' · {0} serialize',
					String(partition.serializeGroups.length),
				)
				: '';
			this.statusEl.textContent = localize(
				'surfaceProposalGraph.loadedWithWorkstreams',
				'Proposal loaded · {0} nodes · {1} edges · {2} workstreams{3}',
				String(graph.nodes.length),
				String(graph.edges.length),
				String(partition.workstreams.length),
				serializeHint,
			);
			this.emptyEl.classList.add('hidden');
			this.emptyEl.textContent = '';
			this.treeAnchor.classList.remove('hidden');
			this.treeView.setDocument({ proposal, graph, partition });
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.setPathDisplay(resource);
			this.showEmpty(localize('surfaceProposalGraph.readFailed', 'Could not read the proposed code graph for {0}.', surfaceId));
		}
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
		this.treeAnchor.classList.add('hidden');
	}

	private setPathDisplay(resource: URI | undefined): void {
		this.pathEl.textContent = resource?.path ?? '';
		this.pathEl.title = resource?.path ?? '';
	}
}

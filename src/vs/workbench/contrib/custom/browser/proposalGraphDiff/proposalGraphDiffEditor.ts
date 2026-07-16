/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { dirname } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { isDark } from '../../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { INativeEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IWebviewService } from '../../../webview/browser/webview.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { buildProposalDiffGraph } from './buildProposalDiffGraph.js';
import { ProposalGraphDiffCytoscapeView } from './proposalGraphDiffCytoscapeView.js';
import { ProposalGraphDiffInput } from './proposalGraphDiffInput.js';
import type { GraphProposalDocument, ProposalCompareSnapshot, ProposalDiffGraph } from './proposalGraphDiffTypes.js';

export class ProposalGraphDiffEditor extends EditorPane {
	static readonly ID = 'workbench.editor.proposalGraphDiff';

	private container: HTMLElement | undefined;
	private readonly editorDisposables = this._register(new DisposableStore());
	private view: ProposalGraphDiffCytoscapeView | undefined;
	private watchedSnapshot: URI | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		super(ProposalGraphDiffEditor.ID, group, telemetryService, themeService, storageService);
		this._register(themeService.onDidColorThemeChange(() => {
			this.view?.setTheme(isDark(themeService.getColorTheme().type) ? 'dark' : 'light');
		}));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = parent;
		parent.style.position = 'relative';
		parent.style.height = '100%';
		parent.style.width = '100%';
		clearNode(parent);
		appendPlaceholder(parent, localize('proposalGraphDiff.loading', 'Loading proposal graph diff…'));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof ProposalGraphDiffInput) || !this.container || token.isCancellationRequested) {
			return;
		}
		await this.render(input);
	}

	override clearInput(): void {
		this.editorDisposables.clear();
		this.view = undefined;
		this.watchedSnapshot = undefined;
		if (this.container) {
			clearNode(this.container);
			appendPlaceholder(this.container, localize('proposalGraphDiff.empty', 'No proposal graph loaded.'));
		}
		super.clearInput();
	}

	override layout(_dimension: { width: number; height: number }): void {
		// Overlay webview tracks the anchor element size.
	}

	private async render(input: ProposalGraphDiffInput): Promise<void> {
		if (!this.container) {
			return;
		}
		this.editorDisposables.clear();
		clearNode(this.container);

		const appRoot = this.environmentService.appRoot ? URI.file(this.environmentService.appRoot) : undefined;
		if (!appRoot) {
			appendPlaceholder(this.container, localize('proposalGraphDiff.noAppRoot', 'Cytoscape assets unavailable (no app root).'));
			return;
		}

		const cytoscapeRoot = URI.joinPath(appRoot, 'node_modules', 'cytoscape', 'dist');
		const layoutBaseRoot = URI.joinPath(appRoot, 'node_modules', 'layout-base');
		const coseBaseRoot = URI.joinPath(appRoot, 'node_modules', 'cose-base');
		const fcoseRoot = URI.joinPath(appRoot, 'node_modules', 'cytoscape-fcose');

		const anchor = appendFill(this.container);
		const view = this.editorDisposables.add(new ProposalGraphDiffCytoscapeView(
			this.webviewService,
			[cytoscapeRoot, layoutBaseRoot, coseBaseRoot, fcoseRoot],
			() => { /* ready */ },
		));
		this.view = view;
		view.attach(anchor, this.container);
		view.setHtml(
			URI.joinPath(cytoscapeRoot, 'cytoscape.min.js'),
			URI.joinPath(layoutBaseRoot, 'layout-base.js'),
			URI.joinPath(coseBaseRoot, 'cose-base.js'),
			URI.joinPath(fcoseRoot, 'cytoscape-fcose.js'),
		);
		view.setTheme(isDark(this.themeService.getColorTheme().type) ? 'dark' : 'light');

		const load = async () => {
			const loaded = await this.loadGraph(input.proposalUri, input.snapshotUri);
			if (loaded) {
				view.setGraph(loaded);
			}
		};
		await load();

		if (input.snapshotUri) {
			this.watchedSnapshot = input.snapshotUri;
			// Watch the parent directory — file watches are less reliable across platforms.
			this.editorDisposables.add(this.fileService.watch(dirname(input.snapshotUri)));
			this.editorDisposables.add(this.fileService.onDidFilesChange(e => {
				if (this.watchedSnapshot && e.contains(this.watchedSnapshot)) {
					void load();
				}
			}));
		}
	}

	private async loadGraph(proposalUri: URI | undefined, snapshotUri: URI | undefined): Promise<ProposalDiffGraph | undefined> {
		if (!proposalUri || !snapshotUri) {
			this.logService.warn('[ProposalGraphDiff] Missing proposal or snapshot URI');
			return undefined;
		}
		try {
			const [proposalRaw, snapshotRaw] = await Promise.all([
				this.fileService.readFile(proposalUri),
				this.fileService.readFile(snapshotUri),
			]);
			const proposal = JSON.parse(proposalRaw.value.toString()) as GraphProposalDocument;
			const snapshot = JSON.parse(snapshotRaw.value.toString()) as ProposalCompareSnapshot;
			return buildProposalDiffGraph(proposal, snapshot);
		} catch (err) {
			this.logService.error('[ProposalGraphDiff] Failed to load proposal diff', err);
			return undefined;
		}
	}
}

function appendPlaceholder(parent: HTMLElement, text: string): HTMLElement {
	const el = $('div');
	el.textContent = text;
	el.style.padding = '16px';
	el.style.font = '13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif';
	el.style.color = 'var(--vscode-foreground)';
	parent.appendChild(el);
	return el;
}

function appendFill(parent: HTMLElement): HTMLElement {
	const el = $('div');
	el.style.position = 'absolute';
	el.style.inset = '0';
	parent.appendChild(el);
	return el;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import type { SurfaceReferenceCandidates } from '../../../../../custom/goalWorkspace/surfaceReferenceCandidates.js';
import { IWebviewElement, IWebviewService, WebviewContentPurpose } from '../../webview/browser/webview.js';
import { webviewGenericCspSource } from '../../webview/common/webview.js';
import type { GraphProposalDocument, ProposalDiffGraph } from './proposalGraphDiff/proposalGraphDiffTypes.js';
import type { ProposalWorkstreamPartition } from './proposalGraphDiff/partitionProposalWorkstreams.js';
import type { SurfaceProposalProgress } from './surfaceProposalProgress.js';
import {
	orderSurfaceProposalTreeCards,
	SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
	SURFACE_PROPOSAL_TREE_SECTION_ORDER,
	surfaceProposalTreeCardsFromDocument,
	type SurfaceProposalTreeCardItem,
	type SurfaceProposalTreeGraphRegion,
} from './surfaceProposalTreeCards.js';
import {
	formatPhaseProgressBadge,
	resolveCurrentPhaseIndex,
	resolvePhaseRowStatus,
	resolveWorkstreamExecutionPresentation,
	type WorkstreamExecutionPresentation,
} from './workstreamExecutionPresentation.js';

export type {
	SurfaceProposalTreeCardItem,
	SurfaceProposalTreeGraphRegion,
} from './surfaceProposalTreeCards.js';
export {
	orderSurfaceProposalTreeCards,
	orderSurfaceProposalTreeSectionIds,
	staticSurfaceProposalTreeCards,
	surfaceDescriptionCardValue,
	surfaceGraphRegionsCardValue,
	surfaceProposalTreeCardsFromDocument,
	SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
	SURFACE_PROPOSAL_TREE_SECTION_ORDER,
} from './surfaceProposalTreeCards.js';

export interface SurfaceProposalTreePreviewInfo {
	readonly localUrl?: string;
	/** Public Vercel / production URL for the Deployed card. */
	readonly productionUrl?: string;
	readonly message: string;
	readonly deployedMessage?: string;
}

export interface SurfaceProposalTreeDocumentOptions {
	readonly proposal?: GraphProposalDocument;
	readonly graph?: ProposalDiffGraph;
	readonly partition?: ProposalWorkstreamPartition;
	/** Compare-derived completion for Files / Relationships / Workstreams cards. */
	readonly progress?: SurfaceProposalProgress;
	readonly planMarkdown?: string;
	readonly claudeMdMarkdown?: string;
	readonly claudeMdMessage?: string;
	readonly graphRegions?: readonly SurfaceProposalTreeGraphRegion[];
	readonly graphMessage?: string;
	readonly previewInfo?: SurfaceProposalTreePreviewInfo;
	/** Surface purpose from workspace.goal.json — Description card / section body. */
	readonly surfacePurpose?: string;
	readonly referenceCandidates?: SurfaceReferenceCandidates;
	readonly storageKey?: string;
	readonly proposalMissingMessage?: string;
	/**
	 * When true, hide the Workstreams run button — Steps Next already owns generate
	 * for the current phase.
	 */
	readonly hideRunWorkstreamsButton?: boolean;
	/**
	 * Settings: when true, Run may spawn one Claude per parallel-safe workstream.
	 * When false (default), Run uses one Claude for the whole surface.
	 */
	readonly parallelClaudeWorkstreamsEnabled?: boolean;
	/** Current Steps row id — used to highlight the matching build phase. */
	readonly currentStepId?: string;
	/** True while phase-progress lists inflight workstream Claude keys. */
	readonly workstreamsInflight?: boolean;
	/** Per-phase Steps statuses (plus failed overlay from phase-progress). */
	readonly phaseStatuses?: readonly {
		readonly id: string;
		readonly status: 'pending' | 'current' | 'completed' | 'skipped' | 'failed';
	}[];
	/** In-flight or failed note from phase-progress.json. */
	readonly phaseProgressNote?: string;
}

export interface SurfaceProposalTreeToggleRepoRequest {
	readonly owner: string;
	readonly repo: string;
	readonly selected: boolean;
}

export class SurfaceProposalTreeView extends Disposable {
	private readonly webview: IWebviewElement;
	private lastDocument: SurfaceProposalTreeDocumentOptions | undefined;
	/** False until the webview script posts ready — postMessage before that is dropped. */
	private webviewReady = false;
	private pendingSelectSectionId: string | undefined;

	private readonly _onDidToggleRepo = this._register(new Emitter<SurfaceProposalTreeToggleRepoRequest>());
	readonly onDidToggleRepo: Event<SurfaceProposalTreeToggleRepoRequest> = this._onDidToggleRepo.event;

	private readonly _onDidConfirmRepos = this._register(new Emitter<void>());
	readonly onDidConfirmRepos: Event<void> = this._onDidConfirmRepos.event;

	private readonly _onDidChangeCards = this._register(new Emitter<readonly SurfaceProposalTreeCardItem[]>());
	readonly onDidChangeCards: Event<readonly SurfaceProposalTreeCardItem[]> = this._onDidChangeCards.event;

	private readonly _onDidRequestSection = this._register(new Emitter<string>());
	readonly onDidRequestSection: Event<string> = this._onDidRequestSection.event;

	private readonly _onDidRequestRunWorkstreams = this._register(new Emitter<void>());
	readonly onDidRequestRunWorkstreams: Event<void> = this._onDidRequestRunWorkstreams.event;

	private readonly _onDidRequestRegenerateRealGraph = this._register(new Emitter<void>());
	readonly onDidRequestRegenerateRealGraph: Event<void> = this._onDidRequestRegenerateRealGraph.event;

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
			const message = event.message;
			if (message?.type === 'surfaceProposalTree.ready') {
				this.webviewReady = true;
				onReady();
				const pendingSection = this.pendingSelectSectionId;
				this.pendingSelectSectionId = undefined;
				if (pendingSection) {
					this.selectSection(pendingSection);
				}
				return;
			}
			if (message?.type === 'surfaceProposalTree.toggleRepo'
				&& typeof message.owner === 'string'
				&& typeof message.repo === 'string'
				&& typeof message.selected === 'boolean') {
				this._onDidToggleRepo.fire({
					owner: message.owner,
					repo: message.repo,
					selected: message.selected,
				});
				return;
			}
			if (message?.type === 'surfaceProposalTree.confirmRepos') {
				this._onDidConfirmRepos.fire();
				return;
			}
			if (message?.type === 'surfaceProposalTree.cards' && Array.isArray(message.cards)) {
				const cards: SurfaceProposalTreeCardItem[] = [];
				for (const card of message.cards) {
					if (typeof card?.id === 'string' && typeof card.key === 'string') {
						cards.push({
							id: card.id,
							key: card.key,
							value: String(card.value ?? SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE),
						});
					}
				}
				this._onDidChangeCards.fire(orderSurfaceProposalTreeCards(cards));
				return;
			}
			if (message?.type === 'surfaceProposalTree.requestSection' && typeof message.id === 'string') {
				this._onDidRequestSection.fire(message.id);
				return;
			}
			if (message?.type === 'surfaceProposalTree.runWorkstreams') {
				this._onDidRequestRunWorkstreams.fire();
				return;
			}
			if (message?.type === 'surfaceProposalTree.regenerateRealGraph') {
				this._onDidRequestRegenerateRealGraph.fire();
			}
		}));
		this.setHtml();
	}

	attach(parent: HTMLElement): void {
		this.webview.mountTo(parent, mainWindow);
	}

	setDocument(options: SurfaceProposalTreeDocumentOptions): void {
		this.lastDocument = options;
		const parallelStreamCount = options.partition?.workstreams?.length ?? 0;
		const serializeCount = options.partition?.serializeGroups?.length ?? 0;
		const workstreamExecution: WorkstreamExecutionPresentation | undefined =
			(parallelStreamCount || serializeCount)
				? resolveWorkstreamExecutionPresentation({
					parallelEnabled: !!options.parallelClaudeWorkstreamsEnabled,
					workstreamsInflight: !!options.workstreamsInflight,
					parallelStreamCount,
					canParallelize: !!options.partition?.canParallelize,
					hideRunWorkstreamsButton: !!options.hideRunWorkstreamsButton,
				})
				: undefined;
		const phases = options.proposal?.phases ?? [];
		const currentPhaseIndex = resolveCurrentPhaseIndex(phases, options.currentStepId);
		const phaseRowStatuses = phases.map((phase, index) =>
			resolvePhaseRowStatus(phase.id, index, options.phaseStatuses, currentPhaseIndex));
		const phasesProgressBadge = formatPhaseProgressBadge(phases.length, options.phaseStatuses);
		// Publish rail badges on the host immediately — do not wait for the (possibly hidden)
		// webview to echo `surfaceProposalTree.cards` after render.
		const selectedRepos = options.referenceCandidates?.repos.filter(repo => repo.selected).length ?? 0;
		const totalRepos = options.referenceCandidates?.repos.length ?? 0;
		this._onDidChangeCards.fire(surfaceProposalTreeCardsFromDocument({
			localUrl: options.previewInfo?.localUrl,
			productionUrl: options.previewInfo?.productionUrl,
			purposeValue: options.surfacePurpose,
			planMarkdown: options.planMarkdown,
			claudeMdMarkdown: options.claudeMdMarkdown,
			proposedNodeCount: options.proposal?.add_nodes?.length,
			proposedEdgeCount: options.proposal?.add_edges?.length,
			graphRegions: options.graphRegions,
			phasesCardValue: phases.length
				? (phasesProgressBadge || String(phases.length))
				: undefined,
			contextCardValue: totalRepos > 0 ? `${selectedRepos}/${totalRepos}` : undefined,
		}));
		// Rail cards update on the host even when the webview is not ready yet. Defer the
		// document payload until ready — otherwise the pane stays on "Loading proposal…".
		if (!this.webviewReady) {
			return;
		}
		void this.webview.postMessage({
			type: 'surfaceProposalTree.setDocument',
			...options,
			workstreamExecution,
			currentPhaseIndex,
			phaseRowStatuses,
			phasesProgressBadge,
		});
	}

	republish(): void {
		if (this.lastDocument) {
			this.setDocument(this.lastDocument);
		}
	}

	/** Scroll the given section into view — driven by the host-owned card rail. */
	selectSection(id: string): void {
		if (!this.webviewReady) {
			this.pendingSelectSectionId = id;
			return;
		}
		void this.webview.postMessage({ type: 'surfaceProposalTree.selectSection', id });
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
		html, body { margin: 0; height: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
		body { padding: 0; font: 13px/1.5 var(--vscode-font-family); overflow: hidden; }
		/* Section cards live in the host-owned shared card rail (cardRailLayout.ts); this webview is content only. */
		#content {
			display: flex;
			flex-direction: column;
			height: 100%;
			max-width: none;
			margin: 0;
		}
		.graph-panel { padding: 12px 14px; display: grid; gap: 10px; }
		.graph-view-tabs {
			display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px 0;
		}
		.graph-view-tab {
			appearance: none; border: 1px solid var(--vscode-panel-border);
			border-radius: 6px; padding: 5px 10px;
			background: var(--vscode-sideBar-background); color: var(--vscode-foreground);
			font: 600 11px/1.3 var(--vscode-font-family); cursor: pointer;
		}
		.graph-view-tab:hover { border-color: var(--vscode-focusBorder); }
		.graph-view-tab.active {
			background: var(--vscode-button-background);
			border-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}
		.graph-view-pane.hidden { display: none; }
		.graph-view-pane .tree,
		.graph-view-pane .edges { padding: 0 14px 14px; }
		.graph-canvas {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			background: var(--vscode-sideBar-background);
			overflow: auto;
			max-height: min(72vh, 640px);
			/* Limit style/layout invalidation while hovering. */
			contain: layout paint;
			/* Keep one-finger scroll; pinch handled in JS. */
			touch-action: pan-x pan-y;
			overscroll-behavior: contain;
		}
		.graph-canvas svg {
			display: block;
			/* Size is driven by zoom helper (inline width/height). */
			max-height: none;
			transform-origin: 0 0;
		}
		.graph-canvas-hint {
			margin: 0 0 6px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}
		.graph-edge {
			stroke: color-mix(in srgb, var(--vscode-focusBorder) 40%, var(--vscode-panel-border));
			stroke-width: 1.1;
			fill: none;
			opacity: 0.55;
			pointer-events: none;
		}
		.graph-col-label {
			fill: var(--vscode-descriptionForeground);
			font: 700 10px/1.2 var(--vscode-font-family);
			letter-spacing: 0.04em;
			text-transform: uppercase;
			pointer-events: none;
		}
		.graph-node.linked { cursor: pointer; }
		.graph-node-shell {
			fill: var(--vscode-editorWidget-background);
			stroke: var(--vscode-widget-border, var(--vscode-panel-border));
			stroke-width: 1;
		}
		.graph-node-shell.linked {
			stroke: color-mix(in srgb, var(--vscode-focusBorder) 70%, var(--vscode-widget-border));
			stroke-width: 1.15;
		}
		.graph-node-shell.isolate { opacity: 0.72; }
		.graph-node-title {
			fill: var(--vscode-foreground);
			font: 600 11px/1.2 var(--vscode-editor-font-family, var(--vscode-font-family));
			pointer-events: none;
		}
		/*
		 * Ego-focus: CSS dims everything; JS only marks the tiny hot set (no per-node dim toggles,
		 * no SVG reordering, no transitions — those were the lag).
		 */
		.graph-canvas svg.graph-rel-focus .graph-node { opacity: 0.12; }
		.graph-canvas svg.graph-rel-focus .graph-edge { opacity: 0.05; }
		.graph-canvas svg.graph-rel-focus .graph-col-label { opacity: 0.16; }
		.graph-canvas svg.graph-rel-focus .graph-node.is-hot { opacity: 1; }
		.graph-canvas svg.graph-rel-focus .graph-edge.is-hot {
			opacity: 1;
			stroke: var(--vscode-focusBorder);
			stroke-width: 2.25;
		}
		.graph-canvas svg.graph-rel-focus .graph-col-label.is-hot { opacity: 1; }
		.graph-canvas svg.graph-rel-focus .graph-node.is-hot.neighbor .graph-node-shell {
			stroke: var(--vscode-focusBorder);
			stroke-width: 1.5;
		}
		.graph-canvas svg.graph-rel-focus .graph-node.is-hot.focus .graph-node-shell {
			fill: color-mix(in srgb, var(--vscode-focusBorder) 22%, var(--vscode-editorWidget-background));
			stroke: var(--vscode-focusBorder);
			stroke-width: 2;
		}
		.graph-ego-card {
			display: none;
			border: 1px solid var(--vscode-focusBorder);
			border-radius: 8px;
			background: var(--vscode-editorWidget-background);
			padding: 10px 12px;
			gap: 6px;
		}
		.graph-canvas.graph-ego-active .graph-ego-card { display: grid; }
		.graph-ego-title {
			font-weight: 700;
			font-size: 12px;
			color: var(--vscode-foreground);
			word-break: break-all;
		}
		.graph-ego-meta {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}
		.graph-ego-list {
			display: grid;
			gap: 4px;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.graph-ego-list li {
			display: grid;
			grid-template-columns: auto minmax(48px, max-content) minmax(0, 1fr);
			gap: 8px;
			align-items: baseline;
			font: 11px/1.35 var(--vscode-editor-font-family, var(--vscode-font-family));
			color: var(--vscode-foreground);
		}
		.graph-ego-list .dir {
			color: var(--vscode-descriptionForeground);
			font: 700 9px/1.2 var(--vscode-font-family);
			letter-spacing: 0.04em;
			text-transform: uppercase;
		}
		.graph-ego-list .pred {
			color: var(--vscode-focusBorder);
			font: 700 10px/1.2 var(--vscode-font-family);
			letter-spacing: 0.03em;
			text-transform: uppercase;
		}
		.graph-ego-list .other {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.graph-legend {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
		}
		.graph-regions { display: grid; gap: 8px; }
		.graph-region {
			border: 1px solid var(--vscode-panel-border); border-radius: 6px;
			background: var(--vscode-editor-background); padding: 8px 10px;
		}
		.graph-region-title { font-weight: 700; font-size: 12px; }
		.graph-region-meta { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; }
		.graph-region-files {
			margin: 6px 0 0; padding-left: 18px;
			font: 11px/1.4 var(--vscode-editor-font-family);
		}
		.preview-body { padding: 12px 14px; }
		.preview-url {
			margin: 0 0 8px; font-family: var(--vscode-editor-font-family);
			color: var(--vscode-textLink-foreground); word-break: break-all;
		}
		.preview-message { margin: 0; color: var(--vscode-descriptionForeground); }
		.description-body {
			padding: 12px 14px; white-space: pre-wrap;
			font: 13px/1.55 var(--vscode-font-family); color: var(--vscode-foreground);
		}
		.description-body .description-label {
			margin: 0 0 6px; font-size: 11px; font-weight: 600;
			color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.04em;
		}
		.description-body .description-text { margin: 0; }
		.sections {
			min-width: 0;
			min-height: 0;
			flex: 1 1 auto;
			overflow: auto;
			padding-right: 4px;
		}
		.section {
			margin-top: 12px; border: 1px solid var(--vscode-panel-border);
			border-radius: 7px; overflow: hidden; background: var(--vscode-editor-background);
			scroll-margin-top: 16px;
		}
		.section.flash {
			box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
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
		.refs-body {
			display: flex; flex-direction: column; gap: 10px; padding: 12px 14px;
		}
		.refs-hint {
			margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4;
		}
		.refs-chips { display: flex; flex-direction: column; gap: 8px; }
		.refs-chip {
			display: flex; flex-direction: column; align-items: stretch; gap: 6px;
			padding: 10px 12px; border-radius: 8px;
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
			color: var(--vscode-foreground); font: inherit; cursor: default;
			text-align: left; width: 100%;
		}
		.refs-chip.interactive { cursor: pointer; }
		.refs-chip.interactive:hover { border-color: var(--vscode-focusBorder); }
		.refs-chip.selected {
			border-color: var(--vscode-focusBorder);
			background: color-mix(in srgb, var(--vscode-focusBorder) 16%, transparent);
		}
		.refs-chip:disabled { opacity: .95; cursor: default; }
		.refs-chip-top {
			display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
		}
		.refs-chip-name { font-weight: 600; font-size: 12px; }
		.refs-chip-badge {
			font: 700 9px/1.3 var(--vscode-font-family); letter-spacing: .04em;
			text-transform: uppercase; color: var(--vscode-descriptionForeground);
		}
		.refs-chip-meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
		.refs-chip-reason {
			margin: 0; font-size: 12px; line-height: 1.45;
			color: var(--vscode-descriptionForeground);
		}
		.refs-chip-reason strong {
			color: var(--vscode-foreground); font-weight: 600;
		}
		.refs-actions { display: flex; justify-content: flex-end; }
		.refs-confirm {
			appearance: none; border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 6px; padding: 7px 12px;
			background: var(--vscode-button-background); color: var(--vscode-button-foreground);
			font: 600 12px/1.3 var(--vscode-font-family); cursor: pointer;
		}
		.refs-confirm:disabled { opacity: .5; cursor: default; }
		.refs-confirm:not(:disabled):hover { background: var(--vscode-button-hoverBackground); }
		.tree { padding: 10px 12px 14px; overflow: auto; font-family: var(--vscode-editor-font-family); }
		.tree ul { margin: 0; padding-left: 19px; list-style: none; border-left: 1px solid var(--vscode-tree-indentGuidesStroke); }
		.tree > ul { padding-left: 0; border-left: 0; }
		.tree li { position: relative; margin: 2px 0; }
		.tree li::before {
			content: ''; position: absolute; left: -19px; top: 12px; width: 13px;
			border-top: 1px solid var(--vscode-tree-indentGuidesStroke);
		}
		.tree > ul > li::before { display: none; }
		.folder-row, .file-row { display: flex; align-items: baseline; min-height: 24px; gap: 7px; }
		.folder-row { color: var(--vscode-foreground); font-weight: 600; align-items: center; }
		.folder-row::before { content: '▾'; width: 12px; color: var(--vscode-descriptionForeground); font-size: 10px; flex: 0 0 auto; }
		.file-row::before { content: '◇'; width: 12px; color: var(--vscode-descriptionForeground); font-size: 11px; flex: 0 0 auto; }
		.file-path { color: var(--vscode-descriptionForeground); }
		.file-name { color: var(--vscode-symbolIcon-fileForeground, var(--vscode-foreground)); font-weight: 600; flex: 0 1 auto; }
		.file-comment {
			color: var(--vscode-descriptionForeground);
			font: 400 11px/1.35 var(--vscode-font-family);
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.file-comment::before { content: '# '; opacity: 0.7; }
		.files-arch-summary {
			margin: 0;
			padding: 10px 12px 0;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			white-space: pre-wrap;
		}
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
			display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;
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
		.badge-parallel-ready {
			color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
			background: color-mix(in srgb, var(--vscode-charts-blue, var(--vscode-textLink-foreground)) 16%, transparent);
		}
		.badge-cluster {
			color: var(--vscode-descriptionForeground);
			background: color-mix(in srgb, var(--vscode-descriptionForeground) 14%, transparent);
		}
		.badge-coupled {
			color: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange));
			background: color-mix(in srgb, var(--vscode-editorWarning-foreground, var(--vscode-charts-orange)) 18%, transparent);
		}
		.workstream-meta {
			color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 4px;
		}
		.workstream-files {
			margin-top: 4px;
		}
		.workstream-files > summary {
			cursor: pointer; user-select: none;
			color: var(--vscode-descriptionForeground); font-size: 11px;
		}
		.workstream-nodes {
			margin: 6px 0 0; padding-left: 18px; font-family: var(--vscode-editor-font-family); font-size: 12px;
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
			display: grid; gap: 8px;
		}
		.parallel-banner-note {
			margin: 0; font-size: 11px; opacity: 0.85;
		}
		.parallel-banner-actions { display: flex; justify-content: flex-end; }
		.parallel-run-btn {
			appearance: none; border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 6px; padding: 6px 12px;
			background: var(--vscode-button-background); color: var(--vscode-button-foreground);
			font: 600 12px/1.3 var(--vscode-font-family); cursor: pointer;
		}
		.parallel-run-btn:disabled {
			opacity: 0.5; cursor: default;
		}
		.parallel-run-btn:not(:disabled):hover {
			background: var(--vscode-button-hoverBackground);
		}
		.graph-section-toolbar {
			display: flex; justify-content: flex-end; align-items: center;
			gap: 8px; padding: 8px 12px 0;
		}
		.graph-help-btn {
			appearance: none; width: 24px; height: 24px; padding: 0;
			border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
			border-radius: 999px;
			background: var(--vscode-button-secondaryBackground, transparent);
			color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
			font: 700 12px/1 var(--vscode-font-family); cursor: pointer;
		}
		.graph-help-btn:hover, .graph-help-btn[aria-expanded="true"] {
			background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
		}
		.graph-help-panel {
			margin: 8px 12px 0; padding: 10px 12px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			background: var(--vscode-sideBar-background);
			font: 12px/1.45 var(--vscode-font-family);
			color: var(--vscode-foreground);
		}
		.graph-help-panel.hidden { display: none; }
		.graph-help-panel p { margin: 0 0 8px; }
		.graph-help-panel p:last-child { margin-bottom: 0; }
		.graph-help-panel strong { font-weight: 600; }
		.graph-regenerate-btn {
			appearance: none; border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 6px; padding: 5px 10px;
			background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
			color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
			font: 600 11px/1.3 var(--vscode-font-family); cursor: pointer;
		}
		.graph-regenerate-btn:hover {
			background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
		}
		.serialize-block {
			margin: 0 12px 12px; border: 1px solid var(--vscode-panel-border);
			border-radius: 6px; background: var(--vscode-sideBar-background);
		}
		.serialize-block > summary {
			cursor: pointer; user-select: none; padding: 10px 12px;
			font-weight: 600; font-size: 12px;
		}
		.serialize-block[open] > summary {
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.serialize-block .workstreams { padding-top: 10px; }
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
		.phase-current {
			background: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 8%, transparent);
		}
		.phase-done {
			opacity: 0.78;
		}
		.phase-failed {
			background: color-mix(in srgb, var(--vscode-testing-iconFailed, var(--vscode-errorForeground)) 8%, transparent);
		}
		.phase-header {
			display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;
		}
		.phase-title {
			margin: 0; font-size: 13px; font-weight: 700;
		}
		.phase-subtitle {
			margin: 0 0 8px; color: var(--vscode-descriptionForeground); font-size: 11px;
		}
		.phase-note {
			margin: 0 0 8px; color: var(--vscode-descriptionForeground); font-size: 11px;
			white-space: pre-wrap;
		}
		.phase-note.phase-note-error {
			color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
		}
		.phase-items {
			margin: 0; padding-left: 18px;
		}
		.phase-done .phase-items {
			text-decoration: line-through;
			text-decoration-color: color-mix(in srgb, var(--vscode-descriptionForeground) 55%, transparent);
		}
		.badge-phase-done {
			color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
			background: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-charts-green)) 18%, transparent);
		}
		.badge-phase-current {
			color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
			background: color-mix(in srgb, var(--vscode-charts-blue, var(--vscode-textLink-foreground)) 16%, transparent);
		}
		.badge-phase-pending {
			color: var(--vscode-descriptionForeground);
			background: color-mix(in srgb, var(--vscode-descriptionForeground) 14%, transparent);
		}
		.badge-phase-failed {
			color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground));
			background: color-mix(in srgb, var(--vscode-testing-iconFailed, var(--vscode-errorForeground)) 18%, transparent);
		}
		.badge-phase-skipped {
			color: var(--vscode-descriptionForeground);
			background: color-mix(in srgb, var(--vscode-descriptionForeground) 14%, transparent);
		}
		.execution-block {
			margin: 0; border-top: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
		}
		.execution-block > summary {
			cursor: pointer; user-select: none; padding: 10px 14px;
			font-weight: 600; font-size: 12px;
		}
		.execution-block[open] > summary {
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.phase-items li {
			margin: 4px 0;
		}
		.empty { padding: 30px; color: var(--vscode-descriptionForeground); text-align: center; }
		@media (max-width: 700px) {
			body { padding: 8px; }
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

			/**
			 * Pull path # comment annotations out of an architecture tree so the Files
			 * tab can show them inline (Architecture card is gone).
			 */
			function parseArchitectureFileComments(tree) {
				const byPath = new Map();
				const byBase = new Map();
				if (!tree) {
					return { byPath, byBase };
				}
				const raw = normalizeArchitectureTree(tree);
				for (const line of raw.split('\\n')) {
					const hash = line.indexOf('#');
					if (hash < 0) {
						continue;
					}
					const comment = line.slice(hash + 1).trim();
					if (!comment) {
						continue;
					}
					const left = line.slice(0, hash)
						.replace(/[│├└─┌┐┘┤┬┴┼|+\\\\]/g, ' ')
						.replace(/\\s+/g, ' ')
						.trim();
					const pathMatch = left.match(/(?:[\\w.@+-]+\\/)*[\\w.@+-]+\\.[A-Za-z0-9]+$/);
					if (!pathMatch) {
						continue;
					}
					const path = pathMatch[0].replace(/\\\\/g, '/');
					const pathKey = path.toLowerCase();
					byPath.set(pathKey, comment);
					const base = path.split('/').pop();
					if (base && !byBase.has(base.toLowerCase())) {
						byBase.set(base.toLowerCase(), comment);
					}
				}
				return { byPath, byBase };
			}

			function lookupArchitectureComment(filePath, comments) {
				if (!comments) {
					return '';
				}
				const normalized = normalizeGraphPath(filePath).toLowerCase();
				if (!normalized) {
					return '';
				}
				if (comments.byPath.has(normalized)) {
					return comments.byPath.get(normalized);
				}
				// Match on path suffix (architecture often omits apps/<surface>/).
				for (const [path, comment] of comments.byPath) {
					if (normalized.endsWith('/' + path) || normalized.endsWith(path)) {
						return comment;
					}
					if (path.endsWith('/' + normalized) || path.endsWith(normalized)) {
						return comment;
					}
				}
				const base = normalized.split('/').pop();
				return (base && comments.byBase.get(base)) || '';
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

			let selectedSectionId = null;
			/** sectionId → 'graph' | 'files' | 'relationships' */
			const graphTabBySection = Object.create(null);

			function setGraphTab(sectionId, tabId) {
				const sectionEl = content.querySelector('details.section[data-section="' + sectionId + '"]');
				if (!sectionEl) {
					return;
				}
				graphTabBySection[sectionId] = tabId;
				for (const tab of sectionEl.querySelectorAll('.graph-view-tab')) {
					tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
				}
				for (const pane of sectionEl.querySelectorAll('.graph-view-pane')) {
					pane.classList.toggle('hidden', pane.getAttribute('data-tab') !== tabId);
				}
			}

			function focusSection(id, options) {
				const flash = !options || options.flash !== false;
				// Legacy Files / Relationships / Architecture cards redirect into Proposed Graph tabs.
				// Workstreams nest under Build phases — open phases and expand the execution anchor.
				let sectionId = id;
				let tabId = options && options.tab;
				let openExecution = false;
				if (id === 'workstreams') {
					sectionId = 'phases';
					openExecution = true;
				} else if (id === 'files' || id === 'relationships' || id === 'architecture') {
					sectionId = 'proposed';
					tabId = id === 'relationships' ? 'relationships' : 'files';
				} else if (id === 'proposed' && !tabId) {
					tabId = 'graph';
				} else if (id === 'graph' && !tabId) {
					tabId = graphTabBySection.graph || 'graph';
				}
				selectedSectionId = sectionId;
				const sectionEl = content.querySelector('details.section[data-section="' + sectionId + '"]');
				if (!sectionEl) {
					return;
				}
				// Card selection owns expand state — collapse every other section.
				for (const other of content.querySelectorAll('details.section')) {
					other.open = other === sectionEl;
				}
				if (openExecution) {
					const exec = sectionEl.querySelector('details.execution-block[data-section="workstreams"]');
					if (exec) {
						exec.open = true;
					}
				}
				if (tabId && sectionEl.querySelector('.graph-view-tabs')) {
					setGraphTab(sectionId, tabId);
				}
				if (flash) {
					sectionEl.classList.remove('flash');
					// Retrigger flash animation if already present.
					void sectionEl.offsetWidth;
					sectionEl.classList.add('flash');
					window.setTimeout(() => sectionEl.classList.remove('flash'), 900);
				}
				// Instant snap — smooth scroll felt laggy and lost races to republish resets.
				sectionEl.scrollIntoView({ behavior: 'auto', block: 'start' });
			}

			function makeFolderTree(paths) {
				const root = { folders: new Map(), files: [] };
				for (const raw of paths) {
					const fullPath = clean(raw);
					const parts = fullPath.split('/').filter(Boolean);
					let cursor = root;
					for (let i = 0; i < parts.length - 1; i++) {
						if (!cursor.folders.has(parts[i])) cursor.folders.set(parts[i], { folders: new Map(), files: [] });
						cursor = cursor.folders.get(parts[i]);
					}
					if (parts.length) {
						cursor.files.push({ name: parts[parts.length - 1], path: fullPath });
					}
				}
				return root;
			}

			function renderFileRow(file, comments) {
				const row = el('div', 'file-row');
				row.append(el('span', 'file-name', file.name || file));
				const comment = lookupArchitectureComment(file.path || file.name || file, comments);
				if (comment) {
					const note = el('span', 'file-comment', comment);
					note.title = comment;
					row.append(note);
				}
				return row;
			}

			function renderFolder(node, name, comments) {
				const li = el('li');
				if (name) li.append(el('div', 'folder-row', name));
				const list = el('ul');
				for (const [folderName, folder] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
					list.append(renderFolder(folder, folderName, comments));
				}
				for (const file of [...node.files].sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
					const fileLi = el('li');
					fileLi.append(renderFileRow(file, comments));
					list.append(fileLi);
				}
				li.append(list);
				return li;
			}

			function section(id, title, count, open = false) {
				const details = el('details', 'section');
				details.dataset.section = id;
				details.open = open;
				const summary = el('summary');
				summary.append(el('span', '', title), el('span', 'count', count));
				details.append(summary);
				return details;
			}

			/** Section cards render in the host card rail — this only records the data to post up. */
			function metaCard(id, label, value) {
				return { id, key: label, value: text(value) };
			}

			function normalizeGraphPath(path) {
				return String(path || '').trim().replace(/\\\\/g, '/').replace(/^\\.\\//, '').replace(/\\/+$/g, '');
			}

			function truncateLabel(value, max) {
				const s = String(value || '').trim();
				if (s.length <= max) return s;
				return s.slice(0, Math.max(1, max - 1)) + '…';
			}

			function proposalNodeId(canonicalId) {
				return String(canonicalId || '').replace(/[^A-Za-z0-9:_./+-]+/g, '_');
			}

			function proposalFilePath(canonicalId) {
				const raw = String(canonicalId || '');
				const kindSep = raw.indexOf(':');
				const rest = kindSep > 0 ? raw.slice(kindSep + 1) : raw;
				const symbolSep = rest.indexOf('::');
				return normalizeGraphPath(symbolSep > 0 ? rest.slice(0, symbolSep) : rest);
			}

			function proposalFileLabel(canonicalId) {
				const path = proposalFilePath(canonicalId);
				const base = path.split('/').pop() || String(canonicalId || '');
				return truncateLabel(base, 28);
			}

			function proposalEdgeEnds(edge) {
				const src = String(edge.src || edge.from || '').trim();
				const dst = String(edge.dst || edge.to || '').trim();
				const predicate = String(edge.predicate || edge.type || edge.label || '').trim().toUpperCase();
				if (!src || !dst) {
					return undefined;
				}
				return { src, dst, predicate: predicate || 'REL' };
			}

			/** Proposed Code Graph — Files + Relationships from the draft/final proposal. */
			function buildProposedDrawableGraph(proposal, diffGraph) {
				const fileIds = Array.isArray(proposal?.add_nodes) ? proposal.add_nodes.filter(Boolean) : [];
				const relEdges = Array.isArray(proposal?.add_edges)
					? proposal.add_edges.map(proposalEdgeEnds).filter(Boolean)
					: [];

				if (fileIds.length || relEdges.length) {
					const nodesById = new Map();
					const ensureFileNode = (canonicalId) => {
						const id = proposalNodeId(canonicalId);
						if (!nodesById.has(id)) {
							const path = proposalFilePath(canonicalId);
							nodesById.set(id, {
								id,
								label: proposalFileLabel(canonicalId),
								meta: truncateLabel(path.split('/').slice(0, -1).join('/') || path, 34),
								path,
								root: false,
							});
						}
						return id;
					};
					for (const fileId of fileIds) {
						ensureFileNode(fileId);
					}
					const edges = [];
					for (let index = 0; index < relEdges.length; index++) {
						const edge = relEdges[index];
						const from = ensureFileNode(edge.src);
						const to = ensureFileNode(edge.dst);
						edges.push({
							id: 'rel:' + index + ':' + from + ':' + to,
							from,
							to,
							label: truncateLabel(edge.predicate, 14),
						});
					}
					const nodes = [...nodesById.values()];
					if (nodes[0]) {
						nodes[0].root = true;
					}
					return {
						nodes,
						edges,
						cardValue: nodes.length + '·' + edges.length,
						legend: nodes.length + ' files · ' + edges.length + ' relationships · grouped by folder',
					};
				}

				if (diffGraph && Array.isArray(diffGraph.nodes) && diffGraph.nodes.length) {
					const nodes = diffGraph.nodes.map((node, index) => ({
						id: String(node.id || index),
						label: truncateLabel(node.label || node.id || ('n' + index), 28),
						meta: truncateLabel(node.status || node.kind || '', 24),
						path: proposalFilePath(node.canonicalId || node.label || node.id || ''),
						root: index === 0,
					}));
					const nodeIds = new Set(nodes.map(n => n.id));
					const edges = (diffGraph.edges || [])
						.filter(edge => nodeIds.has(String(edge.from)) && nodeIds.has(String(edge.to)))
						.map((edge, index) => ({
							id: String(edge.id || ('e' + index)),
							from: String(edge.from),
							to: String(edge.to),
							label: truncateLabel(edge.label || edge.predicate || '', 14),
						}));
					return {
						nodes,
						edges,
						cardValue: nodes.length + '·' + edges.length,
						legend: nodes.length + ' files · ' + edges.length + ' relationships · grouped by folder',
					};
				}

				return { nodes: [], edges: [], cardValue: '—', legend: '' };
			}

			/**
			 * Real Graph — same shape as Proposed (files + relationships), not Ix subsystem blobs.
			 * Prefer on-disk Ix member files (actual code); fall back to compare-matched proposal nodes.
			 * Match ratios stay on Repo Context / Workstreams cards — not this graph.
			 */
			function buildCodeDrawableGraph(regions, proposal, diffGraph) {
				const fromFiles = (fileIds, relEdges, legendSuffix) => {
					const nodesById = new Map();
					const ensureFileNode = (canonicalId) => {
						const id = proposalNodeId(canonicalId);
						if (!nodesById.has(id)) {
							const path = proposalFilePath(canonicalId);
							nodesById.set(id, {
								id,
								label: proposalFileLabel(canonicalId),
								meta: truncateLabel(path.split('/').slice(0, -1).join('/') || path, 34),
								path,
								root: false,
							});
						}
						return id;
					};
					for (const fileId of fileIds) {
						ensureFileNode(fileId);
					}
					const edges = [];
					for (let index = 0; index < relEdges.length; index++) {
						const edge = relEdges[index];
						const fromId = proposalNodeId(edge.src);
						const toId = proposalNodeId(edge.dst);
						if (!nodesById.has(fromId) || !nodesById.has(toId)) {
							continue;
						}
						edges.push({
							id: 'real:' + index + ':' + fromId + ':' + toId,
							from: fromId,
							to: toId,
							label: truncateLabel(edge.predicate, 14),
						});
					}
					const nodes = [...nodesById.values()];
					if (nodes[0]) {
						nodes[0].root = true;
					}
					if (!nodes.length) {
						return undefined;
					}
					return {
						nodes,
						edges,
						cardValue: nodes.length + '·' + edges.length,
						legend: nodes.length + ' files · ' + edges.length + ' relationships · ' + legendSuffix,
					};
				};

				// 1) On-disk / Ix members — the real app surface, not only proposal matches.
				const memberFiles = [];
				for (const region of regions || []) {
					for (const file of region.memberFiles || []) {
						if (file) {
							memberFiles.push(file);
						}
					}
					if (region.entryPath && /\.[a-z0-9]+$/i.test(region.entryPath)) {
						memberFiles.push(region.entryPath);
					}
				}
				if (memberFiles.length) {
					const relEdges = Array.isArray(proposal?.add_edges)
						? proposal.add_edges.map(proposalEdgeEnds).filter(Boolean)
						: [];
					const built = fromFiles(memberFiles, relEdges, 'grouped by folder · from Ix members');
					if (built) {
						return built;
					}
				}

				// 2) Fallback: compare-matched proposal nodes when Ix members are unavailable.
				if (diffGraph && Array.isArray(diffGraph.nodes)) {
					const matchedNodes = diffGraph.nodes.filter(n => !n.status || n.status === 'matched');
					if (matchedNodes.length) {
						const matchedIds = new Set(matchedNodes.map(n => String(n.id)));
						const fileIds = matchedNodes.map(n => n.canonicalId || n.label || n.id);
						const relEdges = (diffGraph.edges || [])
							.filter(e => (!e.status || e.status === 'matched')
								&& matchedIds.has(String(e.from))
								&& matchedIds.has(String(e.to)))
							.map(e => ({
								src: e.from,
								dst: e.to,
								predicate: e.label || e.predicate || 'IMPORTS',
							}));
						const idToCanonical = new Map(
							matchedNodes.map(n => [String(n.id), n.canonicalId || n.label || n.id]),
						);
						const canonicalEdges = relEdges.map(e => ({
							src: idToCanonical.get(String(e.src)) || e.src,
							dst: idToCanonical.get(String(e.dst)) || e.dst,
							predicate: e.predicate,
						}));
						const built = fromFiles(fileIds, canonicalEdges, 'grouped by folder · matched in clone');
						if (built) {
							return built;
						}
					}
				}

				return { nodes: [], edges: [], cardValue: '—', legend: '' };
			}

			function buildFilesPane(fileIds, archOptions) {
				const wrap = el('div', 'files-pane');
				const summary = archOptions && archOptions.summary ? String(archOptions.summary).trim() : '';
				const comments = parseArchitectureFileComments(archOptions && archOptions.tree);
				if (summary) {
					wrap.append(el('p', 'files-arch-summary', summary));
				}
				const tree = el('div', 'tree');
				const rootList = el('ul');
				const folderRoot = makeFolderTree(fileIds);
				for (const [name, folder] of [...folderRoot.folders].sort(([a], [b]) => a.localeCompare(b))) {
					rootList.append(renderFolder(folder, name, comments));
				}
				for (const file of [...folderRoot.files].sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
					const li = el('li');
					li.append(renderFileRow(file, comments));
					rootList.append(li);
				}
				tree.append(rootList);
				wrap.append(tree);
				return wrap;
			}

			function buildRelationshipsPane(edgeDocs) {
				const edgeList = el('div', 'edges');
				for (const edge of edgeDocs) {
					const row = el('div', 'edge');
					const from = clean(edge.src || edge.from || edge.fromPath || '');
					const to = clean(edge.dst || edge.to || edge.toPath || '');
					const relation = edge.predicate || edge.type || edge.label || 'links';
					const fromEl = el('span', 'endpoint', from);
					const toEl = el('span', 'endpoint', to);
					fromEl.title = from;
					toEl.title = to;
					row.append(fromEl, el('span', 'relation', relation), toEl);
					edgeList.append(row);
				}
				return edgeList;
			}

			/**
			 * Graph section with selectable Graph | Files | Relationships tabs
			 * (Proposed Graph and Real Graph share this chrome).
			 * Files tab includes architecture # comments when provided.
			 */
			function appendGraphHelpPanel(kind) {
				const panel = el('div', 'graph-help-panel hidden');
				panel.setAttribute('role', 'region');
				panel.setAttribute('aria-label', 'How graphs are generated');
				const viewLine = kind === 'proposed'
					? 'Proposed Graph shows Claude-authored target files and structural IMPORTS from the proposal (add_nodes / add_edges).'
					: 'Real Graph shows the Ix map of on-disk members and relationships. Regenerate re-runs that map.';
				panel.append(el('p', '', viewLine));
				const cluster = el('p', '');
				cluster.append(
					el('strong', '', 'Clustering. '),
					document.createTextNode('Ix uses community detection (Louvain-style) to label regions on the code graph so humans and agents can reason about subsystems. Console workstreams partition the IMPORTS spine into structural connected components (soft links ignored). This canvas lays out by folder columns for readability.'),
				);
				const accuracy = el('p', '');
				accuracy.append(
					el('strong', '', 'Accuracy. '),
					document.createTextNode('Proposed vs Real comparison is recall-gated: every proposed structural node and edge must appear in the live graph. That catches missing wiring without failing on extra live detail. Fuller proposed edges keep the visualization honest and the verification target aligned with real imports.'),
				);
				panel.append(cluster, accuracy);
				return panel;
			}

			function appendGraphSection(sections, id, title, drawable, emptyMessage, listOptions) {
				const files = listOptions && listOptions.files ? listOptions.files : [];
				const relationships = listOptions && listOptions.relationships ? listOptions.relationships : [];
				const filesValue = (listOptions && listOptions.filesValue) || String(files.length || '—');
				const relationshipsValue = (listOptions && listOptions.relationshipsValue)
					|| String(relationships.length || '—');
				const architecture = listOptions && listOptions.architecture;
				const hasLists = files.length > 0 || relationships.length > 0;
				const graphSection = section(id, title, drawable.cardValue || '—', false);

				const toolbar = el('div', 'graph-section-toolbar');
				const helpBtn = el('button', 'graph-help-btn', '?');
				helpBtn.type = 'button';
				helpBtn.title = 'How graphs are generated';
				helpBtn.setAttribute('aria-label', 'How graphs are generated');
				helpBtn.setAttribute('aria-expanded', 'false');
				const helpPanel = appendGraphHelpPanel(id === 'proposed' ? 'proposed' : 'real');
				helpBtn.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					const open = helpPanel.classList.toggle('hidden') === false;
					helpBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
				});
				toolbar.append(helpBtn);
				if (id === 'graph') {
					const regen = el('button', 'graph-regenerate-btn', 'Regenerate');
					regen.type = 'button';
					regen.title = 'Re-run Ix map and rebuild Real Graph from on-disk files';
					regen.addEventListener('click', (event) => {
						event.preventDefault();
						event.stopPropagation();
						vscode.postMessage({ type: 'surfaceProposalTree.regenerateRealGraph' });
					});
					toolbar.append(regen);
				}
				graphSection.append(toolbar, helpPanel);

				if (hasLists) {
					const tabs = el('div', 'graph-view-tabs');
					const tabDefs = [
						{ id: 'graph', label: 'Graph', value: drawable.cardValue || '—' },
						{ id: 'files', label: 'Files', value: filesValue },
						{ id: 'relationships', label: 'Relationships', value: relationshipsValue },
					];
					const initialTab = graphTabBySection[id] || 'graph';
					for (const def of tabDefs) {
						const btn = el('button', 'graph-view-tab' + (def.id === initialTab ? ' active' : ''), def.label + ' · ' + def.value);
						btn.type = 'button';
						btn.setAttribute('data-tab', def.id);
						btn.addEventListener('click', () => {
							// Local tab switch only. Do not requestSection — the host would
							// call focusSection(id) without a tab and reset Proposed Graph to Graph.
							setGraphTab(id, def.id);
						});
						tabs.append(btn);
					}
					graphSection.append(tabs);

					const graphPane = el('div', 'graph-view-pane' + (initialTab === 'graph' ? '' : ' hidden'));
					graphPane.setAttribute('data-tab', 'graph');
					if (drawable.nodes.length) {
						const panel = el('div', 'graph-panel');
						panel.append(el('div', 'graph-canvas-hint', 'Pinch or Ctrl+scroll to zoom · scroll to pan'));
						panel.append(renderGraphSvg(drawable));
						panel.append(el('div', 'graph-legend', drawable.legend
							|| (drawable.nodes.length + ' nodes · ' + drawable.edges.length + ' links')));
						graphPane.append(panel);
					} else {
						graphPane.append(el('div', 'empty', emptyMessage));
					}
					graphSection.append(graphPane);

					const filesPane = el('div', 'graph-view-pane' + (initialTab === 'files' ? '' : ' hidden'));
					filesPane.setAttribute('data-tab', 'files');
					if (files.length) {
						filesPane.append(buildFilesPane(files, architecture));
					} else {
						filesPane.append(el('div', 'empty', 'No files in this graph yet.'));
					}
					graphSection.append(filesPane);

					const relPane = el('div', 'graph-view-pane' + (initialTab === 'relationships' ? '' : ' hidden'));
					relPane.setAttribute('data-tab', 'relationships');
					if (relationships.length) {
						relPane.append(buildRelationshipsPane(relationships));
					} else {
						relPane.append(el('div', 'empty', 'No relationships in this graph yet.'));
					}
					graphSection.append(relPane);
				} else if (drawable.nodes.length) {
					const panel = el('div', 'graph-panel');
					panel.append(el('div', 'graph-canvas-hint', 'Pinch or Ctrl+scroll to zoom · scroll to pan'));
					panel.append(renderGraphSvg(drawable));
					panel.append(el('div', 'graph-legend', drawable.legend
						|| (drawable.nodes.length + ' nodes · ' + drawable.edges.length + ' links')));
					graphSection.append(panel);
				} else {
					graphSection.append(el('div', 'empty', emptyMessage));
				}
				sections.push(graphSection);
			}

			function folderKeyForNode(node) {
				const path = normalizeGraphPath(node.path || '');
				const parts = path.split('/').filter(Boolean);
				if (parts.length <= 1) {
					return '(root)';
				}
				// Prefer a short, stable folder label (last 1–2 segments before the file).
				const folderParts = parts.slice(0, -1);
				if (folderParts.length >= 2) {
					return folderParts.slice(-2).join('/');
				}
				return folderParts[folderParts.length - 1] || '(root)';
			}

			/** Deterministic folder-column layout — no overlapping nodes. */
			function layoutGraphNodes(nodes, edges) {
				const linkedIds = new Set();
				for (const edge of edges || []) {
					linkedIds.add(edge.from);
					linkedIds.add(edge.to);
				}
				const enriched = nodes.map(node => ({
					...node,
					folder: folderKeyForNode(node),
					linked: linkedIds.has(node.id),
				}));

				// Columns: folders with relationships first (by edge count), then isolates alpha.
				const edgeCountByFolder = new Map();
				for (const node of enriched) {
					if (!node.linked) continue;
					edgeCountByFolder.set(node.folder, (edgeCountByFolder.get(node.folder) || 0) + 1);
				}
				const folders = [...new Set(enriched.map(n => n.folder))].sort((a, b) => {
					const ac = edgeCountByFolder.get(a) || 0;
					const bc = edgeCountByFolder.get(b) || 0;
					return bc - ac || a.localeCompare(b);
				});

				const colWidth = 168;
				const rowHeight = 34;
				const top = 36;
				const left = 24;
				const positions = {};
				const columnMeta = [];
				let maxRows = 1;

				folders.forEach((folder, colIndex) => {
					const members = enriched
						.filter(n => n.folder === folder)
						.sort((a, b) => Number(b.linked) - Number(a.linked) || a.label.localeCompare(b.label));
					maxRows = Math.max(maxRows, members.length);
					const x = left + colIndex * colWidth + colWidth / 2;
					columnMeta.push({ folder, x, count: members.length });
					members.forEach((node, rowIndex) => {
						positions[node.id] = {
							x,
							y: top + rowIndex * rowHeight + rowHeight / 2,
							linked: node.linked,
							folder: node.folder,
							boxW: colWidth - 20,
							boxH: 26,
						};
					});
				});

				const width = Math.max(480, left * 2 + folders.length * colWidth);
				const height = Math.max(280, top + maxRows * rowHeight + 28);
				return { width, height, positions, columnMeta, linkedIds };
			}

			/** Precompute 1-hop ego maps once per render — hover must stay O(hot set). */
			function buildEgoIndex(nodes, edges, positions) {
				const nodeById = new Map((nodes || []).map(n => [n.id, n]));
				const byNode = new Map();
				for (const node of nodes || []) {
					byNode.set(node.id, { neighbors: new Set([node.id]), incident: [], folders: new Set() });
				}
				for (const edge of edges || []) {
					if (!byNode.has(edge.from) || !byNode.has(edge.to)) {
						continue;
					}
					const fromEgo = byNode.get(edge.from);
					const toEgo = byNode.get(edge.to);
					fromEgo.neighbors.add(edge.to);
					toEgo.neighbors.add(edge.from);
					fromEgo.incident.push(edge);
					toEgo.incident.push(edge);
				}
				for (const [id, ego] of byNode) {
					for (const neighborId of ego.neighbors) {
						const folder = positions[neighborId] && positions[neighborId].folder;
						if (folder) {
							ego.folders.add(folder);
						}
					}
					const node = nodeById.get(id);
					ego.path = (node && (node.path || node.meta || node.label)) || id;
				}
				return { byNode, nodeById };
			}

			/**
			 * Pinch / ctrl+wheel zoom on the graph canvas. Scrollbars keep pan.
			 * Trackpad pinch arrives as wheel+ctrl on Chromium/Firefox/Safari.
			 */
			function enableGraphCanvasZoom(wrap, svg, baseWidth, baseHeight) {
				const minScale = 0.35;
				const maxScale = 4;
				let scale = 1;
				let pinchStartDist = 0;
				let pinchStartScale = 1;

				const applyScale = (nextScale, focalX, focalY) => {
					const prev = scale;
					scale = Math.min(maxScale, Math.max(minScale, nextScale));
					if (Math.abs(scale - prev) < 0.0001) {
						return;
					}
					const contentX = (focalX + wrap.scrollLeft) / prev;
					const contentY = (focalY + wrap.scrollTop) / prev;
					const w = baseWidth * scale;
					const h = baseHeight * scale;
					svg.style.width = w + 'px';
					svg.style.height = h + 'px';
					svg.setAttribute('width', String(w));
					svg.setAttribute('height', String(h));
					wrap.scrollLeft = Math.max(0, contentX * scale - focalX);
					wrap.scrollTop = Math.max(0, contentY * scale - focalY);
				};

				const fitInitial = () => {
					const avail = wrap.clientWidth || baseWidth;
					const fit = Math.min(1, (avail - 2) / baseWidth);
					scale = Math.max(minScale, fit);
					const w = baseWidth * scale;
					const h = baseHeight * scale;
					svg.style.width = w + 'px';
					svg.style.height = h + 'px';
					svg.style.maxHeight = 'none';
					svg.setAttribute('width', String(w));
					svg.setAttribute('height', String(h));
				};

				wrap.addEventListener('wheel', (event) => {
					// Pinch-zoom on trackpads; plain wheel still scrolls the canvas.
					if (!(event.ctrlKey || event.metaKey)) {
						return;
					}
					event.preventDefault();
					const rect = wrap.getBoundingClientRect();
					const focalX = event.clientX - rect.left;
					const focalY = event.clientY - rect.top;
					const factor = Math.exp(-event.deltaY * 0.01);
					applyScale(scale * factor, focalX, focalY);
				}, { passive: false });

				wrap.addEventListener('touchstart', (event) => {
					if (event.touches.length !== 2) {
						return;
					}
					pinchStartDist = Math.hypot(
						event.touches[0].clientX - event.touches[1].clientX,
						event.touches[0].clientY - event.touches[1].clientY,
					);
					pinchStartScale = scale;
				}, { passive: true });

				wrap.addEventListener('touchmove', (event) => {
					if (event.touches.length !== 2 || !pinchStartDist) {
						return;
					}
					event.preventDefault();
					const dist = Math.hypot(
						event.touches[0].clientX - event.touches[1].clientX,
						event.touches[0].clientY - event.touches[1].clientY,
					);
					const rect = wrap.getBoundingClientRect();
					const midX = ((event.touches[0].clientX + event.touches[1].clientX) / 2) - rect.left;
					const midY = ((event.touches[0].clientY + event.touches[1].clientY) / 2) - rect.top;
					applyScale(pinchStartScale * (dist / pinchStartDist), midX, midY);
				}, { passive: false });

				wrap.addEventListener('touchend', (event) => {
					if (event.touches.length < 2) {
						pinchStartDist = 0;
					}
				}, { passive: true });

				// Safari desktop pinch gestures.
				wrap.addEventListener('gesturestart', (event) => {
					event.preventDefault();
					pinchStartScale = scale;
				});
				wrap.addEventListener('gesturechange', (event) => {
					event.preventDefault();
					const rect = wrap.getBoundingClientRect();
					applyScale(pinchStartScale * (event.scale || 1), rect.width / 2, rect.height / 2);
				});

				fitInitial();
				// Re-fit once layout has a real clientWidth (first paint can be 0).
				requestAnimationFrame(fitInitial);
			}

			function renderGraphSvg(drawable) {
				const wrap = el('div', 'graph-canvas');
				if (!drawable.nodes.length) {
					wrap.append(el('div', 'empty', 'No graph nodes to draw.'));
					return wrap;
				}
				const layout = layoutGraphNodes(drawable.nodes, drawable.edges);
				const { width, height, positions, columnMeta, linkedIds } = layout;
				const egoIndex = buildEgoIndex(drawable.nodes, drawable.edges, positions);
				const markerId = 'graph-arrow-' + Math.random().toString(36).slice(2, 9);
				const svgNS = 'http://www.w3.org/2000/svg';
				const svg = document.createElementNS(svgNS, 'svg');
				svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
				svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
				svg.setAttribute('role', 'img');
				svg.setAttribute('aria-label', 'Code graph — files and relationships. Pinch or ctrl-scroll to zoom.');

				const defs = document.createElementNS(svgNS, 'defs');
				const marker = document.createElementNS(svgNS, 'marker');
				marker.setAttribute('id', markerId);
				marker.setAttribute('viewBox', '0 0 10 10');
				marker.setAttribute('refX', '8');
				marker.setAttribute('refY', '5');
				marker.setAttribute('markerWidth', '5');
				marker.setAttribute('markerHeight', '5');
				marker.setAttribute('orient', 'auto-start-reverse');
				const tip = document.createElementNS(svgNS, 'path');
				tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
				tip.setAttribute('fill', 'var(--vscode-focusBorder)');
				marker.appendChild(tip);
				defs.appendChild(marker);
				svg.appendChild(defs);

				const colLabelByFolder = new Map();
				for (const col of columnMeta) {
					const label = document.createElementNS(svgNS, 'text');
					label.setAttribute('class', 'graph-col-label');
					label.setAttribute('x', String(col.x));
					label.setAttribute('y', '18');
					label.setAttribute('text-anchor', 'middle');
					label.dataset.folder = col.folder;
					label.textContent = truncateLabel(col.folder, 22);
					svg.appendChild(label);
					colLabelByFolder.set(col.folder, label);
				}

				const edgeElsByEndpoint = new Map();
				const rememberEdge = (nodeId, edgeEl) => {
					if (!edgeElsByEndpoint.has(nodeId)) {
						edgeElsByEndpoint.set(nodeId, []);
					}
					edgeElsByEndpoint.get(nodeId).push(edgeEl);
				};
				// Edges behind nodes; no on-curve labels (they were clutter + extra paint).
				drawable.edges.forEach((edge, edgeIndex) => {
					const from = positions[edge.from];
					const to = positions[edge.to];
					if (!from || !to) return;
					const path = document.createElementNS(svgNS, 'path');
					path.setAttribute('class', 'graph-edge');
					const dx = to.x - from.x;
					const midX = from.x + dx * 0.5;
					const bend = (10 + (edgeIndex % 5) * 6) * ((edgeIndex % 2 === 0) ? 1 : -1);
					path.setAttribute(
						'd',
						'M ' + from.x + ' ' + from.y
						+ ' C ' + midX + ' ' + (from.y + bend)
						+ ', ' + midX + ' ' + (to.y - bend)
						+ ', ' + to.x + ' ' + to.y,
					);
					path.setAttribute('marker-end', 'url(#' + markerId + ')');
					svg.appendChild(path);
					const edgeEl = { path, from: edge.from, to: edge.to, label: edge.label || 'REL' };
					rememberEdge(edge.from, edgeEl);
					rememberEdge(edge.to, edgeEl);
				});

				const egoCard = el('div', 'graph-ego-card');
				const egoTitle = el('div', 'graph-ego-title');
				const egoMeta = el('div', 'graph-ego-meta');
				const egoList = el('ul', 'graph-ego-list');
				egoCard.append(egoTitle, egoMeta, egoList);

				const nodeElById = new Map();
				let focusId = null;
				let hotNodes = [];
				let hotEdges = [];
				let hotCols = [];

				const clearHot = () => {
					for (const nodeEl of hotNodes) {
						nodeEl.classList.remove('is-hot', 'focus', 'neighbor');
					}
					for (const edgeEl of hotEdges) {
						edgeEl.path.classList.remove('is-hot');
					}
					for (const colLabel of hotCols) {
						colLabel.classList.remove('is-hot');
					}
					hotNodes = [];
					hotEdges = [];
					hotCols = [];
				};

				const clearEgoFocus = () => {
					if (!focusId) {
						return;
					}
					focusId = null;
					wrap.classList.remove('graph-ego-active');
					svg.classList.remove('graph-rel-focus');
					clearHot();
					egoList.replaceChildren();
				};

				const applyEgoFocus = (nodeId) => {
					if (focusId === nodeId) {
						return;
					}
					const ego = egoIndex.byNode.get(nodeId);
					if (!ego) {
						return;
					}
					clearHot();
					focusId = nodeId;
					svg.classList.add('graph-rel-focus');
					wrap.classList.add('graph-ego-active');

					for (const id of ego.neighbors) {
						const nodeEl = nodeElById.get(id);
						if (!nodeEl) {
							continue;
						}
						nodeEl.classList.add('is-hot', id === nodeId ? 'focus' : 'neighbor');
						hotNodes.push(nodeEl);
					}
					const seenEdges = new Set();
					for (const edgeEl of edgeElsByEndpoint.get(nodeId) || []) {
						if (seenEdges.has(edgeEl)) {
							continue;
						}
						seenEdges.add(edgeEl);
						edgeEl.path.classList.add('is-hot');
						hotEdges.push(edgeEl);
					}
					for (const folder of ego.folders) {
						const colLabel = colLabelByFolder.get(folder);
						if (!colLabel) {
							continue;
						}
						colLabel.classList.add('is-hot');
						hotCols.push(colLabel);
					}

					egoTitle.textContent = ego.path;
					const count = ego.incident.length;
					egoMeta.textContent = count
						? (count + ' direct relationship' + (count === 1 ? '' : 's'))
						: 'No direct relationships';
					// One text write beats N createElement calls on the hot path.
					egoList.replaceChildren();
					const frag = document.createDocumentFragment();
					for (const edge of ego.incident) {
						const outbound = edge.from === nodeId;
						const otherId = outbound ? edge.to : edge.from;
						const other = egoIndex.nodeById.get(otherId);
						const otherLabel = other
							? (other.path || other.label || otherId)
							: otherId;
						const li = document.createElement('li');
						const dir = document.createElement('span');
						dir.className = 'dir';
						dir.textContent = outbound ? 'out' : 'in';
						const pred = document.createElement('span');
						pred.className = 'pred';
						pred.textContent = edge.label || 'REL';
						const otherEl = document.createElement('span');
						otherEl.className = 'other';
						otherEl.textContent = otherLabel;
						li.append(dir, pred, otherEl);
						li.title = otherLabel;
						frag.appendChild(li);
					}
					egoList.appendChild(frag);
				};

				for (const node of drawable.nodes) {
					const pos = positions[node.id];
					if (!pos) continue;
					const g = document.createElementNS(svgNS, 'g');
					const linked = linkedIds.has(node.id);
					g.setAttribute('class', 'graph-node' + (linked ? ' linked' : ' isolate'));
					g.dataset.nodeId = node.id;
					const title = truncateLabel(node.label || node.id, 20);

					const rect = document.createElementNS(svgNS, 'rect');
					rect.setAttribute('class', 'graph-node-shell' + (linked ? ' linked' : ' isolate'));
					rect.setAttribute('x', String(pos.x - pos.boxW / 2));
					rect.setAttribute('y', String(pos.y - pos.boxH / 2));
					rect.setAttribute('rx', '6');
					rect.setAttribute('ry', '6');
					rect.setAttribute('width', String(pos.boxW));
					rect.setAttribute('height', String(pos.boxH));
					g.appendChild(rect);

					const titleEl = document.createElementNS(svgNS, 'text');
					titleEl.setAttribute('class', 'graph-node-title');
					titleEl.setAttribute('x', String(pos.x));
					titleEl.setAttribute('y', String(pos.y + 4));
					titleEl.setAttribute('text-anchor', 'middle');
					titleEl.textContent = title;
					g.appendChild(titleEl);
					svg.appendChild(g);
					nodeElById.set(node.id, g);
				}

				// Hover only while the pointer is on a linked node — empty SVG / isolates clear focus.
				const syncEgoFromPointer = event => {
					const target = event.target;
					const nodeEl = target instanceof Element
						? target.closest('.graph-node.linked')
						: null;
					if (nodeEl && svg.contains(nodeEl) && nodeEl.dataset.nodeId) {
						applyEgoFocus(nodeEl.dataset.nodeId);
						return;
					}
					clearEgoFocus();
				};
				svg.addEventListener('pointermove', syncEgoFromPointer);
				svg.addEventListener('pointerover', syncEgoFromPointer);
				svg.addEventListener('pointerleave', clearEgoFocus);
				wrap.addEventListener('pointerleave', clearEgoFocus);

				wrap.append(svg, egoCard);
				enableGraphCanvasZoom(wrap, svg, width, height);
				return wrap;
			}

			function progressValue(matched, total, hasCompare) {
				return hasCompare ? (matched + '/' + total) : String(total);
			}

			function render(options) {
				const proposal = options.proposal;
				const partition = options.partition;
				const progress = options.progress;
				const hasCompare = !!(progress && progress.hasCompare);
				const workstreamProgressById = new Map(
					(progress && progress.byWorkstream ? progress.byWorkstream : []).map(item => [item.id, item])
				);
				const planMarkdown = options.planMarkdown;
				const claudeMdMarkdown = options.claudeMdMarkdown;
				const claudeMdMessage = options.claudeMdMessage;
				const graphRegions = options.graphRegions || [];
				const graphMessage = options.graphMessage;
				const diffGraph = options.graph;
				const proposedGraph = buildProposedDrawableGraph(proposal, diffGraph);
				// Preview graphs mark everything matched — only use diff when a real compare exists.
				const codeGraph = buildCodeDrawableGraph(
					graphRegions,
					proposal,
					hasCompare ? diffGraph : undefined,
				);
				const previewInfo = options.previewInfo;
				const surfacePurpose = (options.surfacePurpose || '').trim();
				const referenceCandidates = options.referenceCandidates;
				const proposalMissingMessage = options.proposalMissingMessage;
				const hideRunWorkstreamsButton = !!options.hideRunWorkstreamsButton;
				const parallelClaudeWorkstreamsEnabled = !!options.parallelClaudeWorkstreamsEnabled;
				// File watchers republish often — keep the user's place instead of snapping to top.
				const previousSections = content.querySelector('.sections');
				const previousScrollTop = previousSections ? previousSections.scrollTop : 0;
				content.replaceChildren();

				const cards = [];
				/** @type {Record<string, HTMLElement>} */
				const sectionById = Object.create(null);
				const SECTION_ORDER = ${JSON.stringify(Array.from(SURFACE_PROPOSAL_TREE_SECTION_ORDER))};

				// Creation-time proposal viz + live Code Graph — same card chrome / SVG style.
				// Files / Relationships live as tabs inside each graph (not separate rail cards).
				const proposedNodesEarly = proposal?.add_nodes || [];
				const proposedEdgesEarly = proposal?.add_edges || [];
				// Proposed Graph tabs list the full proposal — badge totals match Graph · N·M / footer.
				// Compare match ratios (matched/total) stay on Workstreams / Real Graph progress.
				const proposedFilesValueEarly = proposedNodesEarly.length ? String(proposedNodesEarly.length) : '—';
				const proposedRelsValueEarly = proposedEdgesEarly.length ? String(proposedEdgesEarly.length) : '—';

				// Build phases first when present (Canvas + Workspace share SECTION_ORDER).
				if (proposal) {
					const parallelStreams = partition?.workstreams ?? [];
					const serializeGroups = partition?.serializeGroups ?? [];
					const phases = proposal.phases || [];
					const workstreamExecution = options.workstreamExecution;
					const currentPhaseIndex = typeof options.currentPhaseIndex === 'number'
						? options.currentPhaseIndex
						: undefined;
					const hasExecution = !!(parallelStreams.length || serializeGroups.length);

					if (phases.length || hasExecution) {
						const phasesCardValue = phases.length
							? (options.phasesProgressBadge || String(phases.length))
							: (progress
								? progressValue(progress.workstreamsComplete, progress.workstreamsTotal, hasCompare)
								: String(parallelStreams.length || serializeGroups.length));
						cards.push(metaCard('phases', 'Build phases', phasesCardValue));
						const phasesSection = section('phases', 'Build phases', phasesCardValue);

						const renderStreamCard = (stream, opts) => {
							const card = el('div', 'workstream');
							const header = el('div', 'workstream-header');
							header.append(
								el('span', 'workstream-id', stream.id),
								el('span', 'workstream-label', stream.label),
								el('span', 'badge ' + (opts.badgeClass || 'badge-cluster'), opts.badgeLabel || 'cluster')
							);
							card.append(header);
							const streamProgress = workstreamProgressById.get(stream.id);
							const filesLabel = streamProgress && hasCompare
								? (streamProgress.matchedNodes + '/' + streamProgress.totalNodes + ' files')
								: (stream.nodes.length + ' files');
							card.append(el('div', 'workstream-meta',
								filesLabel + ' · ' + stream.edges.length + ' structural edges'));
							const files = el('details', 'workstream-files');
							files.append(el('summary', '', 'Show ' + stream.nodes.length + ' files'));
							const nodeList = el('ul', 'workstream-nodes');
							for (const node of stream.nodes) {
								nodeList.append(el('li', '', clean(node)));
							}
							files.append(nodeList);
							card.append(files);
							if (stream.sharedPrefixes?.length) {
								card.append(el('p', 'workstream-note',
									'Shared prefixes: ' + stream.sharedPrefixes.join(', ')));
							}
							return card;
						};

						const phaseRowStatuses = Array.isArray(options.phaseRowStatuses) ? options.phaseRowStatuses : [];
						const phaseProgressNote = typeof options.phaseProgressNote === 'string'
							? options.phaseProgressNote.trim()
							: '';
						const phaseBadgeMeta = {
							completed: { label: 'Done', className: 'badge-phase-done', rowClass: 'phase-done' },
							current: { label: 'Current', className: 'badge-phase-current', rowClass: 'phase-current' },
							pending: { label: 'Up next', className: 'badge-phase-pending', rowClass: 'phase-pending' },
							skipped: { label: 'Skipped', className: 'badge-phase-skipped', rowClass: 'phase-skipped' },
							failed: { label: 'Failed', className: 'badge-phase-failed', rowClass: 'phase-failed' },
						};
						for (let i = 0; i < phases.length; i++) {
							const phase = phases[i];
							const rowStatus = phaseRowStatuses[i];
							const meta = rowStatus ? phaseBadgeMeta[rowStatus] : undefined;
							const phaseEl = el('div', 'phase' + (meta ? ' ' + meta.rowClass : ''));
							const header = el('div', 'phase-header');
							header.append(el('h3', 'phase-title', phase.title || phase.id || 'Phase'));
							if (meta) {
								header.append(el('span', 'badge ' + meta.className, meta.label));
							}
							phaseEl.append(header);
							if (rowStatus === 'completed') {
								phaseEl.append(el('div', 'phase-subtitle', 'Completed'));
							} else if (rowStatus === 'current') {
								let subtitle = 'Phase ' + (i + 1) + ' of ' + phases.length;
								if (hasCompare && progress && progress.workstreamsTotal > 0) {
									subtitle += ' · ' + progress.workstreamsComplete + '/' + progress.workstreamsTotal + ' clusters';
								}
								phaseEl.append(el('div', 'phase-subtitle', subtitle));
								if (phaseProgressNote) {
									phaseEl.append(el('div', 'phase-note', phaseProgressNote));
								}
							} else if (rowStatus === 'failed') {
								phaseEl.append(el('div', 'phase-subtitle', 'Failed'));
								if (phaseProgressNote) {
									phaseEl.append(el('div', 'phase-note phase-note-error', phaseProgressNote));
								}
							} else if (rowStatus === 'skipped') {
								phaseEl.append(el('div', 'phase-subtitle', 'Skipped'));
							} else if (rowStatus === 'pending') {
								phaseEl.append(el('div', 'phase-subtitle', 'Up next'));
							}
							const items = el('ul', 'phase-items');
							for (const item of phase.items || []) {
								items.append(el('li', '', item));
							}
							phaseEl.append(items);
							phasesSection.append(phaseEl);
						}

						if (hasExecution && workstreamExecution) {
							const execBlock = el('details', 'execution-block');
							execBlock.dataset.section = 'workstreams';
							execBlock.open = !!workstreamExecution.openByDefault;
							const execSummaryLabel = parallelClaudeWorkstreamsEnabled
								? ('Execution · ' + (parallelStreams.length || 0) + ' stream'
									+ ((parallelStreams.length || 0) === 1 ? '' : 's'))
								: ('Execution · one Claude · ' + (parallelStreams.length || serializeGroups.length)
									+ ' cluster' + ((parallelStreams.length || serializeGroups.length) === 1 ? '' : 's'));
							execBlock.append(el('summary', '', execSummaryLabel));

							const banner = el('div', 'parallel-banner');
							banner.append(el('div', '', workstreamExecution.summaryLine));
							if (workstreamExecution.noteLine) {
								banner.append(el('div', 'parallel-banner-note', workstreamExecution.noteLine));
							}
							if (!hideRunWorkstreamsButton) {
								const actions = el('div', 'parallel-banner-actions');
								const runBtn = el('button', 'parallel-run-btn', parallelClaudeWorkstreamsEnabled
									? 'Run parallel workstreams'
									: 'Run workstreams');
								runBtn.type = 'button';
								runBtn.disabled = parallelClaudeWorkstreamsEnabled && !partition?.canParallelize;
								runBtn.title = parallelClaudeWorkstreamsEnabled
									? (partition?.canParallelize
										? 'Spawn one Claude Code session per parallel-safe workstream'
										: 'Need ≥2 parallel-safe workstreams (no shared node_prefixes)')
									: 'Run generate with one Claude for this surface';
								runBtn.addEventListener('click', () => {
									vscode.postMessage({ type: 'surfaceProposalTree.runWorkstreams' });
								});
								actions.append(runBtn);
								banner.append(actions);
							}
							execBlock.append(banner);

							if (parallelStreams.length) {
								const list = el('div', 'workstreams');
								for (const stream of parallelStreams) {
									list.append(renderStreamCard(stream, {
										badgeClass: workstreamExecution.badgeClass,
										badgeLabel: workstreamExecution.badgeLabel,
									}));
								}
								execBlock.append(list);
							}

							if (serializeGroups.length) {
								const serializeBlock = el('details', 'serialize-block');
								serializeBlock.append(el('summary', '',
									'Do first · ' + serializeGroups.length + ' coupled cluster'
									+ (serializeGroups.length === 1 ? '' : 's')));
								const serializeList = el('div', 'workstreams');
								for (const stream of serializeGroups) {
									serializeList.append(renderStreamCard(stream, {
										badgeClass: 'badge-coupled',
										badgeLabel: 'serialize',
									}));
								}
								serializeBlock.append(serializeList);
								execBlock.append(serializeBlock);
							}

							phasesSection.append(execBlock);
						}

						sectionById.phases = phasesSection;
					}

					const removals = (proposal.remove_nodes?.length || 0) + (proposal.remove_edges?.length || 0);
					if (removals) {
						cards.push(metaCard('removals', 'Removals', removals));
						const removalSection = section('removals', 'Removals', removals, false);
						const removalBody = el('div', 'prefixes');
						for (const node of proposal.remove_nodes || []) removalBody.append(el('span', 'prefix', clean(node)));
						for (const edge of proposal.remove_edges || []) removalBody.append(el('span', 'prefix', JSON.stringify(edge)));
						removalSection.append(removalBody);
						sectionById.removals = removalSection;
					}
				}

				cards.push(metaCard('proposed', 'Proposed Graph', proposedGraph.cardValue || '—'));
				cards.push(metaCard('graph', 'Real Graph', codeGraph.cardValue || '—'));
				cards.push(metaCard('preview', 'Preview', previewInfo?.localUrl
					? String(previewInfo.localUrl).replace(/^https?:\/\//i, '').replace(/\/$/, '') || '—'
					: '—'));
				cards.push(metaCard('deployed', 'Deployed', previewInfo?.productionUrl
					? String(previewInfo.productionUrl).replace(/^https?:\/\//i, '').replace(/\/$/, '') || '—'
					: '—'));

				const intentFromPlan = (() => {
					if (!planMarkdown || !planMarkdown.trim()) {
						return '';
					}
					const match = /##\s*Intent\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(planMarkdown);
					return (match && match[1] ? match[1] : '').trim();
				})();
				const descriptionBodyText = surfacePurpose || intentFromPlan;
				let descriptionBadge = '—';
				if (surfacePurpose) {
					const firstLine = surfacePurpose.split(/\r?\n/, 1)[0].trim();
					descriptionBadge = firstLine.length <= 28
						? firstLine
						: firstLine.slice(0, 27).trimEnd() + '…';
				} else if (intentFromPlan) {
					descriptionBadge = 'Intent';
				}
				cards.push(metaCard('description', 'Description', descriptionBadge));

				const graphSections = [];
				appendGraphSection(
					graphSections,
					'proposed',
					'Proposed Graph',
					proposedGraph,
					proposalMissingMessage
						|| 'No proposed code graph yet. Claude drafts files + relationships into the proposal during surface creation.',
					{
						files: proposedNodesEarly,
						relationships: proposedEdgesEarly,
						filesValue: proposedFilesValueEarly,
						relationshipsValue: proposedRelsValueEarly,
						architecture: proposal?.architecture,
					},
				);
				if (graphSections[0]) {
					sectionById.proposed = graphSections[0];
				}
				const realFileIds = (codeGraph.nodes || []).map(n => n.path || n.id).filter(Boolean);
				const realEdgeDocs = (codeGraph.edges || []).map(edge => ({
					from: (codeGraph.nodes || []).find(n => n.id === edge.from)?.path || edge.from,
					to: (codeGraph.nodes || []).find(n => n.id === edge.to)?.path || edge.to,
					label: edge.label || 'links',
				}));
				const realGraphSections = [];
				appendGraphSection(
					realGraphSections,
					'graph',
					'Real Graph',
					codeGraph,
					graphMessage
						|| 'No real graph yet. On-disk Ix member files + relationships will appear here — same layout as Proposed Graph.',
					{
						files: realFileIds,
						relationships: realEdgeDocs,
						filesValue: realFileIds.length ? String(realFileIds.length) : '—',
						relationshipsValue: realEdgeDocs.length ? String(realEdgeDocs.length) : '—',
					},
				);
				if (realGraphSections[0]) {
					sectionById.graph = realGraphSections[0];
				}

				const previewSection = section('preview', 'Live app preview', previewInfo?.localUrl ? 'url' : '—', false);
				const previewBody = el('div', 'preview-body');
				if (previewInfo?.localUrl) {
					previewBody.append(el('p', 'preview-url', previewInfo.localUrl));
				}
				previewBody.append(el('p', 'preview-message', previewInfo?.message || 'Preview not configured.'));
				previewSection.append(previewBody);
				sectionById.preview = previewSection;

				const deployedSection = section('deployed', 'Deployed (Vercel)', previewInfo?.productionUrl ? 'vercel' : '—', false);
				const deployedBody = el('div', 'preview-body');
				if (previewInfo?.productionUrl) {
					deployedBody.append(el('p', 'preview-url', previewInfo.productionUrl));
				}
				deployedBody.append(el(
					'p',
					'preview-message',
					previewInfo?.deployedMessage
						|| (previewInfo?.productionUrl
							? 'Production deploy — shown in the Console pane when this card is selected.'
							: 'Not deployed yet. Use Publish to Vercel (Actions), then set productionUrl on this surface.'),
				));
				deployedSection.append(deployedBody);
				sectionById.deployed = deployedSection;

				const descriptionSection = section('description', 'Description', descriptionBadge, false);
				if (descriptionBodyText) {
					const descriptionBody = el('div', 'description-body');
					descriptionBody.append(el(
						'p',
						'description-label',
						surfacePurpose ? 'Purpose' : 'Intent',
					));
					descriptionBody.append(el('p', 'description-text', descriptionBodyText));
					descriptionSection.append(descriptionBody);
				} else {
					descriptionSection.append(el(
						'div',
						'empty',
						'No surface purpose yet. Set purpose on this surface in workspace.goal.json, or add an Intent section to plan.md.',
					));
				}
				sectionById.description = descriptionSection;

				if (referenceCandidates?.repos?.length) {
					const selectedCount = referenceCandidates.repos.filter(r => r.selected).length;
					cards.push(metaCard('context', 'Repo Context', selectedCount + '/' + referenceCandidates.repos.length));
					const awaiting = referenceCandidates.status === 'awaiting_selection';
					const contextSection = section('context', 'Research context repos', referenceCandidates.repos.length);
					const body = el('div', 'refs-body');
					body.append(el('p', 'refs-hint', awaiting
						? 'Suggested repos are selected. Toggle any repo, then continue. Reasons cite plan.md Research.'
						: 'Claude will use the selected repos below — each reason ties back to plan.md Research.'));
					const chips = el('div', 'refs-chips');
					for (const repo of referenceCandidates.repos) {
						const label = (repo.owner || '') + '/' + (repo.repo || '');
						const reason = (repo.reason || repo.description || '').trim();
						const chip = el('button', 'refs-chip' + (repo.selected ? ' selected' : '') + (awaiting ? ' interactive' : ''));
						chip.type = 'button';
						chip.disabled = !awaiting;
						chip.setAttribute('aria-pressed', repo.selected ? 'true' : 'false');
						chip.title = reason || repo.url || label;
						const top = el('div', 'refs-chip-top');
						top.append(el('span', 'refs-chip-name', label));
						if (repo.suggested) {
							top.append(el('span', 'refs-chip-badge', 'Suggested'));
						}
						if (typeof repo.stars === 'number') {
							const stars = repo.stars >= 1000
								? ((repo.stars / 1000) >= 10 ? Math.round(repo.stars / 1000) : Math.round(repo.stars / 100) / 10) + 'k★'
								: Math.round(repo.stars) + '★';
							top.append(el('span', 'refs-chip-meta', stars));
						}
						chip.append(top);
						const reasonEl = el('p', 'refs-chip-reason');
						if (reason) {
							reasonEl.append(el('strong', '', 'Why: '), document.createTextNode(reason));
						} else {
							reasonEl.textContent = 'No plan.md Research rationale recorded for this repo yet.';
						}
						chip.append(reasonEl);
						if (awaiting) {
							chip.addEventListener('click', () => {
								vscode.postMessage({
									type: 'surfaceProposalTree.toggleRepo',
									owner: repo.owner,
									repo: repo.repo,
									selected: !repo.selected,
								});
							});
						}
						chips.append(chip);
					}
					body.append(chips);
					if (awaiting) {
						const actions = el('div', 'refs-actions');
						const confirm = el('button', 'refs-confirm', 'Use selected as context');
						confirm.type = 'button';
						confirm.disabled = selectedCount === 0;
						confirm.addEventListener('click', () => {
							vscode.postMessage({ type: 'surfaceProposalTree.confirmRepos' });
						});
						actions.append(confirm);
						body.append(actions);
					}
					contextSection.append(body);
					sectionById.context = contextSection;
				}

				if (planMarkdown && planMarkdown.trim()) {
					const planSection = section('plan', 'Plan', 'md');
					planSection.append(renderPlanMarkdown(planMarkdown));
					sectionById.plan = planSection;
					cards.push(metaCard('plan', 'Plan', 'plan.md'));
				} else {
					const planSection = section('plan', 'Plan', '—');
					planSection.append(el('div', 'empty', 'No plan.md yet.'));
					sectionById.plan = planSection;
					cards.push(metaCard('plan', 'Plan', '—'));
				}

				const rulesSection = section('rules', 'CLAUDE.md', claudeMdMarkdown ? 'md' : '—');
				if (claudeMdMarkdown && claudeMdMarkdown.trim()) {
					rulesSection.append(renderPlanMarkdown(claudeMdMarkdown));
				} else {
					rulesSection.append(el('div', 'empty', claudeMdMessage || 'CLAUDE.md not found.'));
				}
				sectionById.rules = rulesSection;
				cards.push(metaCard('rules', 'Rules', 'CLAUDE.md'));

				// Same order as Canvas rail: canonical SECTION_ORDER, preferred/selected pinned front.
				const preferredId = selectedSectionId && sectionById[selectedSectionId]
					? selectedSectionId
					: null;
				const orderedIds = preferredId
					? [preferredId].concat(SECTION_ORDER.filter(id => id !== preferredId))
					: SECTION_ORDER.slice();
				const orderedCards = orderedIds
					.map(id => cards.find(card => card.id === id))
					.filter(Boolean)
					.concat(cards.filter(card => orderedIds.indexOf(card.id) < 0 && SECTION_ORDER.indexOf(card.id) < 0));
				vscode.postMessage({ type: 'surfaceProposalTree.cards', cards: orderedCards });

				const sections = [];
				for (const id of orderedIds) {
					if (sectionById[id]) {
						sections.push(sectionById[id]);
					}
				}
				for (const id of Object.keys(sectionById)) {
					if (orderedIds.indexOf(id) < 0) {
						sections.push(sectionById[id]);
					}
				}

				if (!sections.length) {
					if (proposalMissingMessage) {
						content.append(el('div', 'empty', proposalMissingMessage));
					} else {
						content.append(el('div', 'empty', 'No plan or proposal content yet.'));
					}
					return;
				}

				const sectionsCol = el('div', 'sections');
				for (const sectionEl of sections) {
					sectionsCol.append(sectionEl);
				}
				content.append(sectionsCol);
				if (selectedSectionId) {
					const selected = sectionsCol.querySelector('details.section[data-section="' + selectedSectionId + '"]');
					if (selected) {
						for (const other of sectionsCol.querySelectorAll('details.section')) {
							other.open = other === selected;
						}
					}
					// Preserve mid-section reading position on republish; if scroll was still at 0
					// (fresh select racing a reload), snap the selected section into place instantly.
					if (previousScrollTop > 0) {
						sectionsCol.scrollTop = previousScrollTop;
					} else if (selected) {
						selected.scrollIntoView({ behavior: 'auto', block: 'start' });
					}
				} else {
					sectionsCol.scrollTop = previousScrollTop;
				}
			}

			window.addEventListener('message', event => {
				const message = event.data;
				if (message?.type === 'surfaceProposalTree.setDocument') {
					try {
						render(message);
					} catch (error) {
						content.replaceChildren();
						content.append(el('div', 'empty',
							'Failed to render proposal: ' + (error && error.message ? error.message : String(error))));
					}
					return;
				}
				if (message?.type === 'surfaceProposalTree.selectSection' && typeof message.id === 'string') {
					focusSection(message.id);
				}
			});
			vscode.postMessage({ type: 'surfaceProposalTree.ready' });
		})();
	</script>
</body>
</html>`);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { basename, joinPath, relativePath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { applyWheelToHorizontalScroll } from './horizontalWheelScroll.js';
import { graphProposalResource } from '../../../../../custom/agentTaskTree/agentTaskTreeGraphProposal.js';
import { taskTreesFolder } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import {
	graphCompareDir,
	resolveProposalCompareSnapshotResource,
	resolveSurfacePlanResource,
	surfaceGraphProposalDraftResource,
	surfacePlanResource,
} from '../../../../../custom/goalWorkspace/surfacePlanPaths.js';
import {
	parseSurfaceReferenceCandidates,
	resolveReferenceRepoReason,
	selectedReferenceRepos,
	serializeSurfaceReferenceCandidates,
	surfaceReferenceCandidatesResource,
	withCandidatesStatus,
	withRepoSelection,
	type SurfaceReferenceCandidates,
} from '../../../../../custom/goalWorkspace/surfaceReferenceCandidates.js';
import {
	completedStepIdsFromWorkflow,
	mergeWorkflowSteps,
	parseSurfacePlanWorkflowDocument,
	serializeSurfacePlanWorkflowDocument,
	surfacePlanWorkflowResource,
	type SurfacePlanWorkflowDocument,
} from '../../../../../custom/goalWorkspace/surfacePlanWorkflow.js';
import {
	createIdlePhaseProgress,
	createRunningPhaseProgress,
	failedPhaseStepIdFromProgress,
	parseSurfacePhaseProgress,
	phaseInFlightStepIdFromProgress,
	serializeSurfacePhaseProgress,
	surfacePhaseProgressResource,
	type SurfacePhaseProgressDocument,
} from '../../../../../custom/goalWorkspace/surfacePhaseProgress.js';
import {
	parseSurfaceWorkstreamRuns,
	surfaceWorkstreamRunsResource,
	workstreamRunsAllCompleted,
	workstreamRunsFailed,
	type SurfaceWorkstreamRunsDocument,
} from '../../../../../custom/goalWorkspace/surfaceWorkstreamRuns.js';
import {
	DEPLOYED_STEP,
	DEPLOYED_STEP_ID,
	ENABLE_PREVIEW_STEP,
	ENABLE_PREVIEW_STEP_ID,
	VERIFY_GRAPH_STEP,
	VERIFY_GRAPH_STEP_ID,
	isSurfaceDeployedWired,
	isSurfacePlanLocked,
	isSurfacePreviewWired,
	markSurfacePlanLocked,
	resolveSurfacePlanWorkflowStatus,
	type SurfacePlanWorkflowAction,
	type SurfacePlanWorkflowActionId,
	type SurfacePlanWorkflowPhaseRef,
	type SurfacePlanWorkflowSignals,
	type SurfacePlanWorkflowStepState,
} from '../../../../../custom/goalWorkspace/surfacePlanWorkflowStatus.js';
import {
	isBlockerStepId,
	loadAndProbeSurfaceBlockers,
	openBlockerStepRefs,
	resolveBlockerInDocument,
	serializeSurfaceBlockersDocument,
	surfaceBlockersResource,
	type SurfaceBlockersDocument,
} from '../../../../../custom/goalWorkspace/surfaceBlockers.js';
import { discoverIxSubsystemRegions } from '../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import { discoverIxOverlay, type WorkspaceSurface } from '../../../../../custom/goalWorkspace/ConsoleService.js';
import {
	enrichSurfaceWithIxOverlay,
	isIxSourceFilePath,
	mergeIxSubsystemRegions,
	regionsFromIxOverlayDiscovered,
	resolveSurfacePathForIx,
	scopeIxRegionsToSurface,
	shouldExpandIxRegionMembers,
	shouldSkipIxWalkDir,
} from '../../../../../custom/goalWorkspace/surfaceIxScope.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { buildProposalDiffGraph, buildProposalPreviewGraph } from './proposalGraphDiff/buildProposalDiffGraph.js';
import { partitionProposalWorkstreams } from './proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument, ProposalCompareSnapshot } from './proposalGraphDiff/proposalGraphDiffTypes.js';
import { computeSurfaceProposalProgress } from './surfaceProposalProgress.js';
import { phaseIdsToCompleteFromStructuralPass } from './surfaceStepsStructuralReconcile.js';
import {
	isSurfaceGraphRegionsCacheFresh,
	readSurfaceGraphRegionsCache,
	writeSurfaceGraphRegionsCache,
	type SurfaceGraphRegionsCacheDocument,
} from './surfaceGraphRegionsCache.js';
import { SurfaceProposalTreeView, type SurfaceProposalTreeCardItem, type SurfaceProposalTreeDocumentOptions, type SurfaceProposalTreeGraphRegion, type SurfaceProposalTreePreviewInfo } from './surfaceProposalTreeView.js';

export interface SurfacePlanPanelLoadOptions {
	readonly surfaceId: string;
	readonly surfaceName?: string;
	readonly surfacePath?: string;
	readonly treeId?: string;
	readonly localUrl?: string;
	readonly surface?: WorkspaceSurface;
	readonly workspaceFolder: URI | undefined;
	/** Workspace Settings: allow parallel Claude workstream fan-out. */
	readonly parallelClaudeWorkstreamsEnabled?: boolean;
}

/** Stable key so Mode Shell sync can call load() often without cancelling hydrate. */
export function surfacePlanPanelLoadSignature(options: SurfacePlanPanelLoadOptions): string {
	return [
		options.surfaceId.trim(),
		options.workspaceFolder?.toString() ?? '',
		options.treeId?.trim() ?? '',
		options.surfacePath?.trim() ?? '',
		options.localUrl?.trim() ?? '',
		options.parallelClaudeWorkstreamsEnabled === true ? '1' : '0',
	].join('\0');
}

export interface SurfacePlanBuildRequest {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly intent: string;
}

export interface SurfacePlanReferenceSelectionConfirmed {
	readonly surfaceId: string;
	readonly selectedRepos: ReadonlyArray<{
		readonly owner: string;
		readonly repo: string;
		readonly url: string;
	}>;
}

export interface SurfacePlanNextActionRequest {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly actionId: SurfacePlanWorkflowActionId;
	readonly stepId: string;
	readonly stepLabel: string;
}

export interface SurfacePlanOwningSurfaceRequest {
	readonly surfaceId: string;
	readonly surfaceName: string;
	/** When set, ModeShell should open the card associated with this Plan step. */
	readonly stepId?: string;
	readonly stepKind?: SurfacePlanWorkflowStepState['kind'];
}

export class SurfacePlanPanel extends Disposable {
	private readonly _onDidRequestBuild = this._register(new Emitter<SurfacePlanBuildRequest>());
	readonly onDidRequestBuild: Event<SurfacePlanBuildRequest> = this._onDidRequestBuild.event;

	private readonly _onDidConfirmReferenceSelection = this._register(new Emitter<SurfacePlanReferenceSelectionConfirmed>());
	readonly onDidConfirmReferenceSelection: Event<SurfacePlanReferenceSelectionConfirmed> = this._onDidConfirmReferenceSelection.event;

	private readonly _onDidRequestNextAction = this._register(new Emitter<SurfacePlanNextActionRequest>());
	readonly onDidRequestNextAction: Event<SurfacePlanNextActionRequest> = this._onDidRequestNextAction.event;

	private readonly _onDidSelectOwningSurface = this._register(new Emitter<SurfacePlanOwningSurfaceRequest>());
	readonly onDidSelectOwningSurface: Event<SurfacePlanOwningSurfaceRequest> = this._onDidSelectOwningSurface.event;

	/** Section cards for the shared card rail, re-fired whenever the proposal tree re-renders. */
	readonly onDidChangeCards: Event<readonly SurfaceProposalTreeCardItem[]>;

	/** In-panel tab clicked (e.g. Files inside Proposed Graph) — host should select that rail card. */
	readonly onDidRequestSection: Event<string>;

	private readonly _onDidRequestRunWorkstreams = this._register(new Emitter<{
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly stepId?: string;
		readonly stepLabel?: string;
	}>());
	readonly onDidRequestRunWorkstreams: Event<{
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly stepId?: string;
		readonly stepLabel?: string;
	}> = this._onDidRequestRunWorkstreams.event;

	private readonly _onDidRequestRegenerateRealGraph = this._register(new Emitter<{
		readonly surfaceId: string;
		readonly surfaceName: string;
	}>());
	readonly onDidRequestRegenerateRealGraph: Event<{
		readonly surfaceId: string;
		readonly surfaceName: string;
	}> = this._onDidRequestRegenerateRealGraph.event;

	private readonly _onDidRequestRegenerateDescription = this._register(new Emitter<{
		readonly surfaceId: string;
		readonly surfaceName: string;
	}>());
	readonly onDidRequestRegenerateDescription: Event<{
		readonly surfaceId: string;
		readonly surfaceName: string;
	}> = this._onDidRequestRegenerateDescription.event;

	private readonly _onDidRequestRegenerateSchema = this._register(new Emitter<{
		readonly surfaceId: string;
		readonly surfaceName: string;
	}>());
	readonly onDidRequestRegenerateSchema: Event<{
		readonly surfaceId: string;
		readonly surfaceName: string;
	}> = this._onDidRequestRegenerateSchema.event;

	/** Fired when all parallel/serialize Claude workstreams for a surface report completed. */
	private readonly _onDidWorkstreamsComplete = this._register(new Emitter<{
		readonly surfaceId: string;
		readonly keys: readonly string[];
	}>());
	readonly onDidWorkstreamsComplete: Event<{
		readonly surfaceId: string;
		readonly keys: readonly string[];
	}> = this._onDidWorkstreamsComplete.event;

	/** Fired when the Plan Steps "current" row changes — Mode Shell pins that section card to the top. */
	private readonly _onDidChangeCurrentStep = this._register(new Emitter<{
		readonly id: string;
		readonly kind: SurfacePlanWorkflowStepState['kind'];
	} | undefined>());
	readonly onDidChangeCurrentStep: Event<{
		readonly id: string;
		readonly kind: SurfacePlanWorkflowStepState['kind'];
	} | undefined> = this._onDidChangeCurrentStep.event;

	private readonly titleEl: HTMLElement;
	private readonly pathEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly statusTrackerEl: HTMLElement;
	private readonly statusScrollPrevButton: HTMLButtonElement;
	private readonly statusScrollNextButton: HTMLButtonElement;
	private readonly statusRailEl: HTMLElement;
	private readonly statusNextActionButton: HTMLButtonElement;
	private readonly composeEl: HTMLElement;
	private readonly treeAnchor: HTMLElement;
	private readonly treeView: SurfaceProposalTreeView;
	private readonly watcher = this._register(new MutableDisposable());
	private readonly composeListeners = this._register(new MutableDisposable());
	private readonly statusStepListeners = this._register(new DisposableStore());
	private lastOptions: SurfacePlanPanelLoadOptions | undefined;
	private lastTreeDocument: SurfaceProposalTreeDocumentOptions | undefined;
	private lastPlanMarkdown: string | undefined;
	private lastProposalPhases: readonly SurfacePlanWorkflowPhaseRef[] = [];
	/** Mirrors Workspace Settings — planning UI still shows streams when false. */
	private parallelClaudeWorkstreamsEnabled = false;
	/** In-memory Real Graph regions so reopen paints before Ix CLI returns. */
	private readonly graphRegionsBySurfaceId = new Map<string, {
		readonly regions: readonly SurfaceProposalTreeGraphRegion[];
		readonly message?: string;
		/** When these regions were produced — fresh entries skip the background Ix remap. */
		readonly updatedAt?: string;
	}>();
	private workflowDocument: SurfacePlanWorkflowDocument | undefined;
	private phaseProgressDocument: SurfacePhaseProgressDocument | undefined;
	private workstreamRunsDocument: SurfaceWorkstreamRunsDocument | undefined;
	private blockersDocument: SurfaceBlockersDocument | undefined;
	private loadGeneration = 0;
	/** Last generation that reached a terminal render (publish or message) — used to catch dropped loads. */
	private settledGeneration = 0;
	private loadRecoveryAttempts = 0;
	/** Re-runs load() when a superseded/failed load ended without any terminal render. */
	private readonly loadRecovery = this._register(new RunOnceScheduler(() => this.recoverDroppedLoad(), 250));
	/** If a load never settles (hung await / endless supersede), force recovery. */
	private readonly loadWatchdog = this._register(new RunOnceScheduler(() => this.recoverDroppedLoad(), 1500));
	/** Coalesce plan/proposal file-watch force reloads so Claude .agent writes don't thrash generations. */
	private readonly reloadFromWatch = this._register(new RunOnceScheduler(() => {
		if (!this.lastOptions) {
			return;
		}
		void this.load({ ...this.lastOptions }, { force: true }).catch(() => { /* finally handles recovery */ });
	}, 200));
	private candidates: SurfaceReferenceCandidates | undefined;
	private candidatesWriteInFlight = false;
	private workflowWriteInFlight = false;
	private phaseProgressWriteInFlight = false;
	private blockersWriteInFlight = false;
	private nextActionInFlight = false;
	private realGraphRegenerateInFlight = false;
	private lastEmittedCurrentStepId: string | undefined;
	/** Set when a Next click fires; cleared only when the next-action identity changes. */
	private pendingNextActionKey: string | undefined;
	private hasPlanContent = false;
	private hasDraftProposal = false;
	private hasFinalProposal = false;
	private planLocked = false;
	/** True after plan + proposal signals are resolved for the current load. */
	private signalsHydrated = false;
	/** Signature of the in-flight / last hydrated load — used to stop sync thrash. */
	private loadInFlightSignature: string | undefined;
	private lastHydratedSignature: string | undefined;
	private lastStatusStepSignature: string | undefined;
	private lastCenteredStepId: string | undefined;
	private statusScrollSyncScheduled = false;

	/** Status tracker DOM for Mode Shell's top Steps panel. */
	get statusTrackerElement(): HTMLElement {
		return this.statusTrackerEl;
	}

	/** Mount the Steps tracker into the shell top-panel host. */
	attachStatusTracker(host: HTMLElement): void {
		if (this.statusTrackerEl.parentElement !== host) {
			host.appendChild(this.statusTrackerEl);
		}
	}

	constructor(
		private readonly root: HTMLElement,
		private readonly fileService: IFileService,
		webviewService: IWebviewService,
		private readonly ixIntegrationService: IIxIntegrationService,
	) {
		super();

		this.titleEl = $('div.custom-mode-surface-plan-title');
		this.pathEl = $('div.custom-mode-surface-plan-path');
		this.statusEl = $('div.custom-mode-surface-plan-status');
		this.refreshButton = $('button.custom-mode-surface-plan-refresh', {
			type: 'button',
		}, localize('surfacePlan.refresh', 'Refresh')) as HTMLButtonElement;
		this.statusScrollPrevButton = $('button.custom-mode-surface-plan-status-scroll', {
			type: 'button',
			title: localize('surfacePlan.statusScrollPrev', 'Scroll to earlier steps'),
			'aria-label': localize('surfacePlan.statusScrollPrev', 'Scroll to earlier steps'),
		}, $('span.codicon' + ThemeIcon.asCSSSelector(Codicon.chevronLeft))) as HTMLButtonElement;
		this.statusScrollNextButton = $('button.custom-mode-surface-plan-status-scroll', {
			type: 'button',
			title: localize('surfacePlan.statusScrollNext', 'Scroll to later steps'),
			'aria-label': localize('surfacePlan.statusScrollNext', 'Scroll to later steps'),
		}, $('span.codicon' + ThemeIcon.asCSSSelector(Codicon.chevronRight))) as HTMLButtonElement;
		this.statusRailEl = $('div.custom-mode-surface-plan-status-rail', {
			role: 'list',
			'aria-label': localize('surfacePlan.statusRailLabel', 'Plan workflow steps'),
		});
		this.statusNextActionButton = $('button.custom-mode-surface-plan-status-next-action.hidden', {
			type: 'button',
		}) as HTMLButtonElement;
		this.statusTrackerEl = $('div.custom-mode-surface-plan-status-tracker', {
			role: 'region',
			'aria-label': localize('surfacePlan.statusTrackerLabel', 'Plan status tracker'),
		},
			this.statusScrollPrevButton,
			this.statusRailEl,
			this.statusScrollNextButton,
		);
		this.composeEl = $('div.custom-mode-surface-plan-compose-host.hidden');
		this.treeAnchor = $('div.custom-mode-surface-plan-tree-anchor');
		// Steps tracker mounts into the Mode Shell top panel (not the content canvas).
		this.root.appendChild($('div.custom-mode-surface-plan', undefined, this.composeEl, this.treeAnchor));

		this.treeView = this._register(new SurfaceProposalTreeView(webviewService, () => this.treeView.republish()));
		this.onDidChangeCards = this.treeView.onDidChangeCards;
		this.onDidRequestSection = this.treeView.onDidRequestSection;
		this.treeView.attach(this.treeAnchor);
		this._register(this.treeView.onDidToggleRepo(request => {
			void this.toggleRepoSelection(request.owner, request.repo, request.selected);
		}));
		this._register(this.treeView.onDidConfirmRepos(() => {
			void this.confirmReferenceSelection();
		}));
		this._register(this.treeView.onDidRequestRunWorkstreams(() => {
			const options = this.lastOptions;
			if (!options?.surfaceId) {
				return;
			}
			const inFlight = phaseInFlightStepIdFromProgress(this.phaseProgressDocument);
			this._onDidRequestRunWorkstreams.fire({
				surfaceId: options.surfaceId,
				surfaceName: options.surfaceName?.trim() || options.surfaceId,
				stepId: inFlight || this.phaseProgressDocument?.stepId,
				stepLabel: this.phaseProgressDocument?.stepLabel,
			});
		}));
		this._register(this.treeView.onDidRequestRegenerateRealGraph(() => {
			const options = this.lastOptions;
			if (!options?.surfaceId) {
				return;
			}
			// Mode Shell owns Actions Claude handoff (same path as the Actions panel button).
			this._onDidRequestRegenerateRealGraph.fire({
				surfaceId: options.surfaceId,
				surfaceName: options.surfaceName?.trim() || options.surfaceId,
			});
		}));
		this._register(this.treeView.onDidRequestRegenerateDescription(() => {
			const options = this.lastOptions;
			if (!options?.surfaceId) {
				return;
			}
			this._onDidRequestRegenerateDescription.fire({
				surfaceId: options.surfaceId,
				surfaceName: options.surfaceName?.trim() || options.surfaceId,
			});
		}));
		this._register(this.treeView.onDidRequestRegenerateSchema(() => {
			const options = this.lastOptions;
			if (!options?.surfaceId) {
				return;
			}
			this._onDidRequestRegenerateSchema.fire({
				surfaceId: options.surfaceId,
				surfaceName: options.surfaceName?.trim() || options.surfaceId,
			});
		}));

		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (this.lastOptions) {
				void this.load({ ...this.lastOptions }, { force: true });
			}
		}));
		this._register(addDisposableListener(this.statusNextActionButton, 'click', (event: MouseEvent) => {
			event.stopPropagation();
			void this.runStatusNextAction();
		}));
		this._register(addDisposableListener(this.statusScrollPrevButton, 'click', () => {
			this.scrollStatusRail(-1);
		}));
		this._register(addDisposableListener(this.statusScrollNextButton, 'click', () => {
			this.scrollStatusRail(1);
		}));
		this._register(addDisposableListener(this.statusRailEl, 'scroll', () => {
			this.scheduleStatusScrollSync();
		}));
		// Capture-phase on rail + tracker so trackpad wheel isn't stolen by parent scrollables.
		const onWheel = (event: WheelEvent) => this.handleStatusRailWheel(event);
		this._register(addDisposableListener(this.statusRailEl, 'wheel', onWheel, { capture: true, passive: false }));
		this._register(addDisposableListener(this.statusTrackerEl, 'wheel', onWheel, { capture: true, passive: false }));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.renderStatusTracker();
		this.showTreeMessage(localize('surfacePlan.selectSurface', 'Select a surface to view its plan.md.'));
	}

	/** Scroll a section of the proposal tree into view — driven by the shared card rail. */
	selectSection(id: string): void {
		this.treeView.selectSection(id);
	}

	/** Current Plan Steps row — used to pin the matching surface section card. */
	getCurrentWorkflowStep(): { id: string; kind: SurfacePlanWorkflowStepState['kind'] } | undefined {
		if (!this.signalsHydrated) {
			return undefined;
		}
		const status = resolveSurfacePlanWorkflowStatus(this.workflowSignals());
		const current = status.steps.find(step => step.status === 'current');
		return current ? { id: current.id, kind: current.kind } : undefined;
	}

	/** Workspace Settings toggle — updates Workstreams run CTA without full reload. */
	setParallelClaudeWorkstreamsEnabled(enabled: boolean): void {
		if (this.parallelClaudeWorkstreamsEnabled === enabled) {
			return;
		}
		this.parallelClaudeWorkstreamsEnabled = enabled;
		if (this.lastTreeDocument) {
			this.publishTreeDocument({
				...this.lastTreeDocument,
				parallelClaudeWorkstreamsEnabled: enabled,
			});
		}
	}

	/** Drop Steps ownership when the SURFACE card is collapsed / home is shown. */
	clear(): void {
		this.loadGeneration++;
		this.loadRecovery.cancel();
		this.loadWatchdog.cancel();
		this.reloadFromWatch.cancel();
		this.watcher.clear();
		this.lastOptions = undefined;
		this.lastTreeDocument = undefined;
		this.lastPlanMarkdown = undefined;
		this.lastProposalPhases = [];
		this.workflowDocument = undefined;
		this.phaseProgressDocument = undefined;
		this.blockersDocument = undefined;
		this.candidates = undefined;
		this.hasPlanContent = false;
		this.hasDraftProposal = false;
		this.hasFinalProposal = false;
		this.planLocked = false;
		this.signalsHydrated = false;
		this.loadInFlightSignature = undefined;
		this.lastHydratedSignature = undefined;
		this.lastStatusStepSignature = undefined;
		this.lastCenteredStepId = undefined;
		this.lastEmittedCurrentStepId = undefined;
		this.statusStepListeners.clear();
		clearNode(this.statusRailEl);
		this.statusRailEl.scrollLeft = 0;
		this.syncOwningSurfaceMeta();
		this.renderStatusNextAction(undefined);
		this._onDidChangeCurrentStep.fire(undefined);
		this.showTreeMessage(localize('surfacePlan.selectSurface', 'Select a surface to view its plan.md.'));
		// Cleared intentionally — the placeholder message is the terminal render for this generation.
		this.markLoadSettled(this.loadGeneration);
	}

	/**
	 * Load plan/proposal/workflow for a surface.
	 * Pass `force: true` for Refresh / file watchers — otherwise identical sync calls
	 * are coalesced so Steps/cards are not stuck mid-hydrate.
	 */
	async load(options: SurfacePlanPanelLoadOptions, loadOptions?: { readonly force?: boolean }): Promise<void> {
		const force = loadOptions?.force === true;
		const signature = surfacePlanPanelLoadSignature(options);
		if (!force) {
			if (this.loadInFlightSignature === signature) {
				return;
			}
			if (this.signalsHydrated && this.lastHydratedSignature === signature) {
				this.setParallelClaudeWorkstreamsEnabled(options.parallelClaudeWorkstreamsEnabled === true);
				// Re-emit cards — modeShell may have painted static "—" placeholders while this
				// load was coalesced as already-hydrated (same-surface reopen / Steps sync).
				if (this.lastTreeDocument) {
					this.publishTreeDocument(this.lastTreeDocument);
				}
				return;
			}
		}
		const surfaceChanged = this.lastOptions?.surfaceId !== options.surfaceId;
		this.lastOptions = options;
		this.parallelClaudeWorkstreamsEnabled = options.parallelClaudeWorkstreamsEnabled === true;
		if (surfaceChanged) {
			this.lastStatusStepSignature = undefined;
			this.lastCenteredStepId = undefined;
			this.lastEmittedCurrentStepId = undefined;
			this.statusRailEl.scrollLeft = 0;
			this.nextActionInFlight = false;
			this.pendingNextActionKey = undefined;
		}
		this.signalsHydrated = false;
		this.loadInFlightSignature = signature;
		const generation = ++this.loadGeneration;
		this.loadWatchdog.schedule();
		const { surfaceId, surfaceName, surfacePath, treeId, workspaceFolder } = options;
		this.titleEl.textContent = localize('surfacePlan.title', '{0} plan', surfaceName?.trim() || surfaceId);
		this.pathEl.textContent = '';
		this.statusEl.textContent = localize('surfacePlan.loading', 'Loading…');
		// Stamp ownership immediately so Steps aria/dataset stay bound to the open surface.
		this.syncOwningSurfaceMeta();

		try {
		if (!workspaceFolder) {
			this.candidates = undefined;
			this.hasPlanContent = false;
			this.hasDraftProposal = false;
			this.hasFinalProposal = false;
			this.planLocked = false;
			this.lastPlanMarkdown = undefined;
			this.lastProposalPhases = [];
			this.workflowDocument = undefined;
			this.phaseProgressDocument = undefined;
			this.blockersDocument = undefined;
			this.signalsHydrated = true;
			this.lastHydratedSignature = signature;
			this.loadInFlightSignature = undefined;
			this.renderStatusTracker();
			this.clearCompose();
			this.showTreeMessage(localize('surfacePlan.noWorkspace', 'Open a workspace folder to load plan.md.'));
			this.markLoadSettled(generation);
			return;
		}

		this.watchPlanAndProposal(workspaceFolder, surfaceId, surfacePath, treeId);
		// Paint cached Real Graph + section chrome immediately; Ix refresh runs in the background.
		await this.publishImmediateCachedDocument(options, generation);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.refreshReferenceCandidates(workspaceFolder, surfaceId, generation, false);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.refreshWorkflowDocument(workspaceFolder, surfaceId, generation);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.refreshPhaseProgress(workspaceFolder, surfaceId, generation);
		await this.refreshWorkstreamRuns(workspaceFolder, surfaceId, generation);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.refreshBlockersDocument(workspaceFolder, surfaceId, surfacePath, generation);
		if (generation !== this.loadGeneration) {
			return;
		}

		const planResource = await resolveSurfacePlanResource(this.fileService, workspaceFolder, surfaceId, surfacePath);
		if (generation !== this.loadGeneration) {
			return;
		}

		let planMarkdown: string | undefined;
		if (!planResource) {
			const expected = surfacePlanResource(workspaceFolder, surfaceId);
			this.pathEl.textContent = expected.path;
			this.statusEl.textContent = this.candidates?.status === 'awaiting_selection'
				? localize('surfacePlan.awaitingRepoSelection', 'Select reference repos')
				: localize('surfacePlan.awaitingPlan', 'No plan yet');
			this.hasPlanContent = false;
			this.planLocked = false;
			this.lastPlanMarkdown = undefined;
			this.renderBuildCompose(surfaceId, surfaceName?.trim() || surfaceId);
		} else {
			try {
				const content = await this.fileService.readFile(planResource);
				if (generation !== this.loadGeneration) {
					return;
				}
				const text = content.value.toString();
				this.pathEl.textContent = planResource.path;
				if (!text.trim()) {
					this.statusEl.textContent = this.candidates?.status === 'awaiting_selection'
						? localize('surfacePlan.awaitingRepoSelection', 'Select reference repos')
						: localize('surfacePlan.emptyPlan', 'Plan is empty');
					this.hasPlanContent = false;
					this.planLocked = false;
					this.lastPlanMarkdown = undefined;
					this.renderBuildCompose(surfaceId, surfaceName?.trim() || surfaceId);
				} else {
					this.statusEl.textContent = this.candidates?.status === 'awaiting_selection'
						? localize('surfacePlan.awaitingRepoSelection', 'Select reference repos')
						: localize('surfacePlan.ready', 'Plan loaded');
					this.clearCompose();
					this.hasPlanContent = true;
					planMarkdown = text;
					this.lastPlanMarkdown = text;
					this.planLocked = isSurfacePlanLocked(text);
				}
			} catch (error: unknown) {
				if (generation !== this.loadGeneration) {
					return;
				}
				this.hasPlanContent = false;
				this.markSignalsHydrated(signature, generation);
				this.renderStatusTracker();
				this.clearCompose();
				this.showTreeMessage(localize(
					'surfacePlan.readFailed',
					'Could not read plan: {0}',
					String((error as Error)?.message ?? error),
				));
				this.markLoadSettled(generation);
				return;
			}
		}

		const draftResource = surfaceGraphProposalDraftResource(workspaceFolder, surfaceId);
		this.hasDraftProposal = await this.fileService.exists(draftResource);
		if (generation !== this.loadGeneration) {
			return;
		}

		const proposalResource = await this.resolveProposalResource(workspaceFolder, surfaceId, treeId);
		if (generation !== this.loadGeneration) {
			return;
		}

		let proposal: GraphProposalDocument | undefined;
		let proposalMissingMessage: string | undefined;
		this.hasFinalProposal = false;
		this.lastProposalPhases = [];
		if (!proposalResource) {
			const expected = graphProposalResource(taskTreesFolder(workspaceFolder), surfaceId);
			proposalMissingMessage = localize(
				'surfacePlan.proposalMissing',
				'No proposed code graph yet for {0}. Start New Surface (Claude) or add {1}.',
				surfaceId,
				basename(expected),
			);
		} else {
			try {
				const content = await this.fileService.readFile(proposalResource);
				if (generation !== this.loadGeneration) {
					return;
				}
				proposal = JSON.parse(content.value.toString()) as GraphProposalDocument;
				this.hasFinalProposal = true;
				const phases: SurfacePlanWorkflowPhaseRef[] = [];
				for (const phase of proposal.phases ?? []) {
					const id = typeof phase.id === 'string' ? phase.id.trim() : '';
					const title = typeof phase.title === 'string' ? phase.title.trim() : '';
					if (id && title) {
						phases.push({ id, title });
					}
				}
				this.lastProposalPhases = phases;
			} catch {
				if (generation !== this.loadGeneration) {
					return;
				}
				proposalMissingMessage = localize(
					'surfacePlan.proposalReadFailed',
					'Could not read the proposed code graph for {0}.',
					surfaceId,
				);
			}
		}

		// Plan + proposal signals are ready — safe to render/persist Steps.
		this.markSignalsHydrated(signature, generation);
		if (generation !== this.loadGeneration) {
			return;
		}

		const snapshot = await this.loadProposalCompareSnapshot(workspaceFolder, {
			surfaceId,
			treeId,
			proposalResource,
		});
		if (generation !== this.loadGeneration) {
			return;
		}
		// Catch Steps up to durable progress: pending phase-progress handshake, then a
		// full structural compare pass can complete remaining generate phases.
		await this.applyPhaseProgressUpdate();
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.reconcileStructuralPhaseSteps(proposal, snapshot);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.syncWorkflowDocument(workspaceFolder, surfaceId);
		if (generation !== this.loadGeneration) {
			return;
		}
		this.renderStatusTracker();
		this.treeAnchor.classList.remove('hidden');
		const partition = proposal ? partitionProposalWorkstreams(proposal) : undefined;
		const graph = proposal
			? (snapshot ? buildProposalDiffGraph(proposal, snapshot) : buildProposalPreviewGraph(proposal))
			: undefined;
		const progress = proposal ? computeSurfaceProposalProgress(proposal, partition, snapshot) : undefined;
		const cachedGraph = this.graphRegionsBySurfaceId.get(surfaceId);
		const [claude, previewInfo] = await Promise.all([
			this.loadClaudeMd(workspaceFolder),
			Promise.resolve(this.buildPreviewInfo(options)),
		]);
		if (generation !== this.loadGeneration) {
			return;
		}
		this.publishTreeDocument({
			proposal,
			graph,
			partition,
			progress,
			planMarkdown,
			claudeMdMarkdown: claude.markdown,
			claudeMdMessage: claude.message,
			graphRegions: cachedGraph?.regions,
			graphMessage: cachedGraph?.regions?.length
				? cachedGraph.message
				: (cachedGraph?.message || localize('surfacePlan.graphRefreshing', 'Refreshing code graph…')),
			previewInfo,
			referenceCandidates: this.withResolvedRepoReasons(this.candidates, planMarkdown),
			storageKey: `surfaceProposalTree.visibility.${surfaceId}`,
			proposalMissingMessage: proposal || planMarkdown || this.candidates
				? proposalMissingMessage
				: (proposalMissingMessage || localize('surfacePlan.emptyContent', 'No plan or proposal content yet.')),
		});
		this.markLoadSettled(generation);
		void this.refreshGraphRegionsInBackground(workspaceFolder, options.surface, surfaceId, generation);
		} finally {
			if (generation === this.loadGeneration) {
				// If this generation aborted or threw before hydrate, do not leave coalescing stuck.
				if (!this.signalsHydrated) {
					this.loadInFlightSignature = undefined;
				}
				// Ended without a terminal render (threw, or a supersede chain dropped every
				// pass) — schedule a recovery load so the placeholder cards do not stay up.
				if (this.settledGeneration !== generation) {
					this.loadRecovery.schedule();
				}
			} else if (
				this.settledGeneration !== this.loadGeneration
				&& this.loadInFlightSignature === undefined
			) {
				// We were superseded, but nothing is in flight for the newer generation (it may
				// have coalesced). Recover so static "—" cards are not left up permanently.
				this.loadRecovery.schedule();
			}
		}
	}

	private markSignalsHydrated(signature: string, generation: number): void {
		if (generation !== this.loadGeneration) {
			return;
		}
		this.signalsHydrated = true;
		this.lastHydratedSignature = signature;
		this.loadInFlightSignature = undefined;
	}

	/** Record that this generation reached a terminal render (document publish or message). */
	private markLoadSettled(generation: number): void {
		if (generation !== this.loadGeneration) {
			return;
		}
		this.settledGeneration = generation;
		this.loadRecoveryAttempts = 0;
		this.loadRecovery.cancel();
		this.loadWatchdog.cancel();
	}

	/**
	 * The latest load ended without rendering anything — a supersede chain dropped every
	 * pass, or the load threw. Re-run one forced load; after repeated failures publish the
	 * last cached document (or an explicit message) instead of leaving placeholder cards up.
	 */
	private recoverDroppedLoad(): void {
		const options = this.lastOptions;
		if (!options || this.settledGeneration === this.loadGeneration) {
			return;
		}
		if (this.loadInFlightSignature !== undefined) {
			// Still mid-hydrate — keep polling; bare-return left placeholders stuck under watcher thrash.
			this.loadRecovery.schedule();
			return;
		}
		if (this.loadRecoveryAttempts >= 2) {
			const cached = this.lastTreeDocument;
			if (cached && cached.storageKey === `surfaceProposalTree.visibility.${options.surfaceId}`) {
				this.publishTreeDocument(cached);
			} else {
				this.showTreeMessage(localize('surfacePlan.loadDropped', 'Plan data could not be loaded. Use Refresh to try again.'));
			}
			this.statusEl.textContent = localize('surfacePlan.loadDroppedStatus', 'Load interrupted — Refresh to retry');
			this.settledGeneration = this.loadGeneration;
			this.loadWatchdog.cancel();
			return;
		}
		this.loadRecoveryAttempts++;
		void this.load({ ...options }, { force: true }).catch(() => {
			// load()'s finally already re-scheduled recovery for this failure.
		});
	}

	/**
	 * First paint from on-disk artifacts — plan.md, graph-proposal.json, Real Graph cache.
	 * Do not wait on Ix CLI, blockers probe, or compare snapshot.
	 */
	private async publishImmediateCachedDocument(
		options: SurfacePlanPanelLoadOptions,
		generation: number,
	): Promise<void> {
		const { surfaceId, surfacePath, treeId, workspaceFolder } = options;
		if (!workspaceFolder) {
			return;
		}
		const [cachedGraph, planMarkdown, proposal] = await Promise.all([
			(async () => {
				let cached = this.graphRegionsBySurfaceId.get(surfaceId);
				if (!cached) {
					const fromDisk = await readSurfaceGraphRegionsCache(this.fileService, workspaceFolder, surfaceId);
					if (fromDisk) {
						cached = { regions: fromDisk.regions, message: fromDisk.message, updatedAt: fromDisk.updatedAt };
						this.graphRegionsBySurfaceId.set(surfaceId, cached);
					}
				}
				return cached;
			})(),
			this.readPlanMarkdownForImmediatePaint(workspaceFolder, surfaceId, surfacePath),
			this.readProposalForImmediatePaint(workspaceFolder, surfaceId, treeId),
		]);
		if (generation !== this.loadGeneration) {
			return;
		}
		if (planMarkdown !== undefined) {
			this.lastPlanMarkdown = planMarkdown;
			this.hasPlanContent = Boolean(planMarkdown.trim());
			this.planLocked = isSurfacePlanLocked(planMarkdown);
		}
		if (proposal) {
			this.hasFinalProposal = true;
			const phases: SurfacePlanWorkflowPhaseRef[] = [];
			for (const phase of proposal.phases ?? []) {
				const id = typeof phase.id === 'string' ? phase.id.trim() : '';
				const title = typeof phase.title === 'string' ? phase.title.trim() : '';
				if (id && title) {
					phases.push({ id, title });
				}
			}
			this.lastProposalPhases = phases;
		}
		const partition = proposal ? partitionProposalWorkstreams(proposal) : undefined;
		const graph = proposal ? buildProposalPreviewGraph(proposal) : undefined;
		const progress = proposal ? computeSurfaceProposalProgress(proposal, partition, undefined) : undefined;
		this.treeAnchor.classList.remove('hidden');
		this.publishTreeDocument({
			proposal,
			graph,
			partition,
			progress,
			planMarkdown,
			graphRegions: cachedGraph?.regions,
			graphMessage: cachedGraph?.regions?.length
				? cachedGraph.message
				: (cachedGraph?.message || localize('surfacePlan.graphRefreshing', 'Refreshing code graph…')),
			previewInfo: this.buildPreviewInfo(options),
			referenceCandidates: this.withResolvedRepoReasons(this.candidates, planMarkdown ?? this.lastPlanMarkdown),
			storageKey: `surfaceProposalTree.visibility.${surfaceId}`,
			proposalMissingMessage: proposal || planMarkdown
				? undefined
				: localize('surfacePlan.loadingContent', 'Loading plan…'),
		});
		// First disk paint is enough to clear static "—" rail cards — settle so watcher
		// supersedes do not treat this generation as a dropped load.
		this.markLoadSettled(generation);
	}

	private async readPlanMarkdownForImmediatePaint(
		workspaceFolder: URI,
		surfaceId: string,
		surfacePath: string | undefined,
	): Promise<string | undefined> {
		try {
			const planResource = await resolveSurfacePlanResource(this.fileService, workspaceFolder, surfaceId, surfacePath);
			if (!planResource) {
				return undefined;
			}
			const content = await this.fileService.readFile(planResource);
			return content.value.toString();
		} catch {
			return undefined;
		}
	}

	private async readProposalForImmediatePaint(
		workspaceFolder: URI,
		surfaceId: string,
		treeId: string | undefined,
	): Promise<GraphProposalDocument | undefined> {
		try {
			const proposalResource = await this.resolveProposalResource(workspaceFolder, surfaceId, treeId);
			if (!proposalResource) {
				return undefined;
			}
			const content = await this.fileService.readFile(proposalResource);
			return JSON.parse(content.value.toString()) as GraphProposalDocument;
		} catch {
			return undefined;
		}
	}

	private async refreshGraphRegionsInBackground(
		workspaceFolder: URI,
		surface: WorkspaceSurface | undefined,
		surfaceId: string,
		generation: number,
		options?: { readonly force?: boolean },
	): Promise<void> {
		if (!options?.force) {
			// Non-empty regions inside the TTL are already painted — skip the expensive
			// `ix map` re-ingest. Empty/error results never count as fresh so retries still run.
			const cached = this.graphRegionsBySurfaceId.get(surfaceId);
			if (cached?.regions.length && isSurfaceGraphRegionsCacheFresh(cached.updatedAt, Date.now())) {
				return;
			}
		}
		const graphRegions = await this.loadGraphRegions(workspaceFolder, surface);
		if (generation !== this.loadGeneration) {
			return;
		}
		const updatedAt = new Date().toISOString();
		this.graphRegionsBySurfaceId.set(surfaceId, { ...graphRegions, updatedAt });
		const cacheDoc: SurfaceGraphRegionsCacheDocument = {
			version: 1,
			surfaceId,
			updatedAt,
			regions: graphRegions.regions,
			message: graphRegions.message,
		};
		try {
			await writeSurfaceGraphRegionsCache(this.fileService, workspaceFolder, cacheDoc);
		} catch {
			// best-effort persist
		}
		if (generation !== this.loadGeneration || !this.lastTreeDocument) {
			return;
		}
		this.publishTreeDocument({
			...this.lastTreeDocument,
			graphRegions: graphRegions.regions,
			graphMessage: graphRegions.message,
		});
	}

	/**
	 * Force-refresh Real Graph: clear cache, re-run Ix map for the surface path,
	 * walk on-disk members, and republish the Graph section.
	 */
	async regenerateRealGraph(): Promise<void> {
		const options = this.lastOptions;
		const workspaceFolder = options?.workspaceFolder;
		const surfaceId = options?.surfaceId;
		if (!options || !workspaceFolder || !surfaceId) {
			return;
		}
		if (this.realGraphRegenerateInFlight) {
			return;
		}
		this.realGraphRegenerateInFlight = true;
		const generation = this.loadGeneration;
		try {
			this.graphRegionsBySurfaceId.delete(surfaceId);
			if (this.lastTreeDocument) {
				this.publishTreeDocument({
					...this.lastTreeDocument,
					graphRegions: [],
					graphMessage: localize('surfacePlan.graphRegenerating', 'Regenerating Real Graph…'),
				});
			}
			this.treeView.selectSection('graph');
			await this.refreshGraphRegionsInBackground(workspaceFolder, options.surface, surfaceId, generation, { force: true });
		} finally {
			this.realGraphRegenerateInFlight = false;
		}
	}

	private async loadProposalCompareSnapshot(
		workspaceFolder: URI,
		options: {
			readonly surfaceId: string;
			readonly treeId?: string;
			readonly proposalResource?: URI;
		},
	): Promise<ProposalCompareSnapshot | undefined> {
		const resource = await resolveProposalCompareSnapshotResource(this.fileService, workspaceFolder, options);
		if (!resource) {
			return undefined;
		}
		try {
			const content = await this.fileService.readFile(resource);
			return JSON.parse(content.value.toString()) as ProposalCompareSnapshot;
		} catch {
			return undefined;
		}
	}

	private async loadClaudeMd(workspaceFolder: URI): Promise<{ markdown?: string; message?: string }> {
		const resource = joinPath(workspaceFolder, 'CLAUDE.md');
		try {
			await this.fileService.stat(resource);
			const content = await this.fileService.readFile(resource);
			const text = content.value.toString();
			if (!text.trim()) {
				return { message: localize('surfacePlan.claudeMdEmpty', 'CLAUDE.md is empty.') };
			}
			return { markdown: text };
		} catch {
			return { message: localize('surfacePlan.claudeMdMissing', 'CLAUDE.md not found in the workspace root.') };
		}
	}

	private async loadGraphRegions(
		workspaceFolder: URI,
		surface: WorkspaceSurface | undefined,
	): Promise<{ regions: SurfaceProposalTreeGraphRegion[]; message?: string }> {
		if (!surface) {
			return {
				regions: [],
				message: localize('surfacePlan.graphNoSurface', 'Select a surface to view the code graph.'),
			};
		}
		try {
			const surfacePath = resolveSurfacePathForIx(surface);
			try {
				await this.ixIntegrationService.mapPath(workspaceFolder, surfacePath);
			} catch {
				// best-effort
			}
			const liveRegions = await discoverIxSubsystemRegions(this.ixIntegrationService, workspaceFolder);
			// Overlay is written by Refresh Ix Surface Map / Claude — Graph used to ignore it.
			const ixOverlay = (await discoverIxOverlay(this.fileService, workspaceFolder)).overlay;
			const overlayRegions = regionsFromIxOverlayDiscovered(ixOverlay?.discoveredSubsystems);
			const regions = mergeIxSubsystemRegions(liveRegions, overlayRegions);
			if (!regions.length) {
				return {
					regions: [],
					message: localize(
						'surfacePlan.graphDiscoverEmpty',
						'Ix returned no subsystems for this workspace. Run `ix map --all-items .` (and ensure the Ix backend is up), then refresh.',
					),
				};
			}
			const surfaceForScope = enrichSurfaceWithIxOverlay(surface, ixOverlay);
			const scoped = scopeIxRegionsToSurface(regions, surfaceForScope, surfacePath);
			if (!scoped.length) {
				return {
					regions: [],
					message: localize(
						'surfacePlan.graphEmpty',
						'Ix found {0} subsystem(s) in the workspace, but none matched this surface. Declare subsystem ids/labels in `.agent/ix-surface-map.json` (or surface.ixSubsystems), then refresh.',
						String(regions.length),
					),
				};
			}
			const withMembers = await Promise.all(scoped.map(async region => {
				const base = {
					name: region.name,
					entryPath: region.entryPath,
					memberFiles: region.memberFiles,
					fileCount: region.fileCount,
				};
				if (!shouldExpandIxRegionMembers(region) || !region.entryPath) {
					return base;
				}
				const memberFiles = await this.listSourceFilesUnderSurfacePath(workspaceFolder, region.entryPath);
				if (!memberFiles.length) {
					return base;
				}
				return {
					...base,
					memberFiles,
					fileCount: memberFiles.length,
				};
			}));
			return { regions: withMembers };
		} catch (error: unknown) {
			return {
				regions: [],
				message: localize(
					'surfacePlan.graphFailed',
					'Ix discovery failed: {0}',
					String((error as Error)?.message ?? error),
				),
			};
		}
	}

	/** Walk a surface/subsystem directory for source files when Ix omits memberFiles. */
	private async listSourceFilesUnderSurfacePath(workspaceFolder: URI, surfaceRelativePath: string): Promise<string[]> {
		const root = joinPath(workspaceFolder, surfaceRelativePath);
		const out: string[] = [];
		const maxFiles = 400;
		const queue: URI[] = [root];
		while (queue.length && out.length < maxFiles) {
			const dir = queue.shift()!;
			let children: readonly { resource: URI; isDirectory?: boolean; name?: string }[] | undefined;
			try {
				const resolved = await this.fileService.resolve(dir);
				children = resolved.children;
			} catch {
				continue;
			}
			if (!children?.length) {
				continue;
			}
			for (const child of children) {
				if (out.length >= maxFiles) {
					break;
				}
				const name = child.name || basename(child.resource);
				if (child.isDirectory) {
					if (!shouldSkipIxWalkDir(name)) {
						queue.push(child.resource);
					}
					continue;
				}
				const rel = relativePath(workspaceFolder, child.resource);
				if (rel && isIxSourceFilePath(rel)) {
					out.push(rel.replace(/\\/g, '/'));
				}
			}
		}
		return out.sort((a, b) => a.localeCompare(b));
	}

	private buildPreviewInfo(options: SurfacePlanPanelLoadOptions): SurfaceProposalTreePreviewInfo {
		const localUrl = options.localUrl?.trim() || options.surface?.localUrl?.trim();
		const productionUrl = options.surface?.productionUrl?.trim();
		const databaseUrl = options.surface?.databaseUrl?.trim();
		const name = options.surfaceName?.trim() || options.surfaceId;
		const deployedMessage = productionUrl
			? localize(
				'surfacePlan.deployedHint',
				'Production deploy at {0}. Select the Deployed card to show it in Console.',
				productionUrl,
			)
			: localize(
				'surfacePlan.deployedMissingUrl',
				'{0} has no productionUrl yet. Publish to Vercel (Actions), then write productionUrl on this surface in workspace.goal.json.',
				name,
			);
		const databaseMessage = databaseUrl
			? localize(
				'surfacePlan.databaseHint',
				'Database console at {0}. Select the Database card to show it in Console.',
				databaseUrl,
			)
			: localize(
				'surfacePlan.databaseMissingUrl',
				'{0} has no databaseUrl yet. When the surface uses Supabase (or another browsable DB console), write databaseUrl on this surface in workspace.goal.json.',
				name,
			);
		if (!localUrl) {
			return {
				productionUrl,
				databaseUrl,
				deployedMessage,
				databaseMessage,
				message: localize(
					'surfacePlan.previewMissingUrl',
					'{0} has no preview URL. Add localUrl to this surface in workspace.goal.json to route the preview.',
					name,
				),
			};
		}
		return {
			localUrl,
			productionUrl,
			databaseUrl,
			deployedMessage,
			databaseMessage,
			message: localize(
				'surfacePlan.previewHint',
				'Open {0} in a browser, or add a Start command in workspace.goal.json to launch the live app from Console.',
				localUrl,
			),
		};
	}

	private watchPlanAndProposal(workspaceFolder: URI, surfaceId: string, surfacePath?: string, treeId?: string): void {
		const store = new DisposableStore();
		this.watcher.value = store;
		try {
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent')));
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent', 'surfaces')));
			store.add(this.fileService.watch(taskTreesFolder(workspaceFolder)));
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.ix-scaffold', 'graph-compare')));
			store.add(this.fileService.watch(workspaceFolder));
			const surfaceAppPath = surfacePath?.trim() || `apps/${surfaceId}`;
			const surfaceAppSegments = surfaceAppPath.split('/').filter(Boolean);
			if (surfaceAppSegments.length) {
				store.add(this.fileService.watch(joinPath(workspaceFolder, ...surfaceAppSegments)));
			}
			store.add(this.fileService.onDidFilesChange(e => {
				if (
					!this.lastOptions
					|| this.lastOptions.surfaceId !== surfaceId
					|| this.candidatesWriteInFlight
					|| this.workflowWriteInFlight
					|| this.phaseProgressWriteInFlight
					|| this.blockersWriteInFlight
				) {
					return;
				}
				const candidatesUri = surfaceReferenceCandidatesResource(workspaceFolder, surfaceId);
				if (e.affects(candidatesUri)) {
					void this.refreshReferenceCandidates(workspaceFolder, surfaceId, this.loadGeneration);
					return;
				}
				const progressUri = surfacePhaseProgressResource(workspaceFolder, surfaceId);
				if (e.affects(progressUri)) {
					void this.refreshPhaseProgress(workspaceFolder, surfaceId, this.loadGeneration).then(() => {
						void this.applyPhaseProgressUpdate();
					});
					return;
				}
				const workstreamRunsUri = surfaceWorkstreamRunsResource(workspaceFolder, surfaceId);
				if (e.affects(workstreamRunsUri)) {
					void this.refreshWorkstreamRuns(workspaceFolder, surfaceId, this.loadGeneration).then(() => {
						void this.applyWorkstreamRunsUpdate();
					});
					return;
				}
				const workflowUri = surfacePlanWorkflowResource(workspaceFolder, surfaceId);
				if (e.affects(workflowUri)) {
					void this.refreshWorkflowDocument(workspaceFolder, surfaceId, this.loadGeneration).then(() => {
						this.renderStatusTracker();
					});
					return;
				}
				const blockersUri = surfaceBlockersResource(workspaceFolder, surfaceId);
				const envExampleUri = joinPath(workspaceFolder, ...surfaceAppSegments, '.env.example');
				const envLocalUri = joinPath(workspaceFolder, ...surfaceAppSegments, '.env.local');
				const envUri = joinPath(workspaceFolder, ...surfaceAppSegments, '.env');
				if (
					e.affects(blockersUri)
					|| e.affects(envExampleUri)
					|| e.affects(envLocalUri)
					|| e.affects(envUri)
				) {
					void this.refreshBlockersDocument(workspaceFolder, surfaceId, surfacePath, this.loadGeneration).then(() => {
						this.renderStatusTracker();
						void this.persistResolvedWorkflow(
							resolveSurfacePlanWorkflowStatus(this.workflowSignals()).steps,
						);
					});
					return;
				}
				// Reload so load() can reconcile Steps from a newly written full pass
				// (named proposal_<surface>_vs_*.json or latest-proposal.json).
				const compareDir = graphCompareDir(workspaceFolder);
				if (e.affects(compareDir) || e.contains(compareDir)) {
					this.reloadFromWatch.schedule();
					return;
				}
				const planCandidates = [
					surfacePlanResource(workspaceFolder, surfaceId),
					joinPath(workspaceFolder, 'plan.md'),
					joinPath(workspaceFolder, 'CLAUDE.md'),
				];
				if (surfacePath) {
					planCandidates.push(joinPath(workspaceFolder, ...surfacePath.split('/').filter(Boolean), 'plan.md'));
				}
				const folder = taskTreesFolder(workspaceFolder);
				const proposalCandidates = [
					...(treeId && treeId !== surfaceId ? [graphProposalResource(folder, treeId)] : []),
					graphProposalResource(folder, surfaceId),
					surfaceGraphProposalDraftResource(workspaceFolder, surfaceId),
				];
				if (planCandidates.some(uri => e.affects(uri)) || proposalCandidates.some(uri => e.contains(uri) || e.affects(uri))) {
					this.reloadFromWatch.schedule();
				}
			}));
		} catch {
			// Watching is best-effort.
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

	private async refreshReferenceCandidates(
		workspaceFolder: URI,
		surfaceId: string,
		generation: number,
		republish = true,
	): Promise<void> {
		const resource = surfaceReferenceCandidatesResource(workspaceFolder, surfaceId);
		try {
			const content = await this.fileService.readFile(resource);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.candidates = parseSurfaceReferenceCandidates(content.value.toString(), surfaceId);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.candidates = undefined;
		}
		if (republish) {
			this.renderStatusTracker();
			this.republishTreeWithCandidates();
		}
	}

	private workflowSignals(): SurfacePlanWorkflowSignals {
		const surface = this.lastOptions?.surface;
		return {
			surfaceConfirmed: this.lastOptions ? Boolean(surface) : undefined,
			hasPlanContent: this.hasPlanContent,
			hasCandidates: Boolean(this.candidates?.repos.length),
			candidatesStatus: this.candidates?.status,
			hasDraftProposal: this.hasDraftProposal,
			hasFinalProposal: this.hasFinalProposal,
			planLocked: this.planLocked,
			proposalPhases: this.lastProposalPhases,
			completedStepIds: completedStepIdsFromWorkflow(this.workflowDocument),
			phaseInFlightStepId: phaseInFlightStepIdFromProgress(this.phaseProgressDocument),
			failedPhaseStepId: failedPhaseStepIdFromProgress(this.phaseProgressDocument),
			previewEnabled: isSurfacePreviewWired({
				localUrl: this.lastOptions?.localUrl ?? surface?.localUrl,
				devCommand: surface?.devCommand,
			}),
			deployedEnabled: isSurfaceDeployedWired({
				productionUrl: surface?.productionUrl,
			}),
			openBlockers: openBlockerStepRefs(this.blockersDocument),
		};
	}

	private renderStatusTracker(): void {
		// Avoid painting "Start planning" from empty mid-load signals (and never
		// persist that lie over a completed workflow.json).
		if (this.lastOptions && !this.signalsHydrated) {
			this.syncOwningSurfaceMeta();
			return;
		}
		const status = resolveSurfacePlanWorkflowStatus(this.workflowSignals());
		this.statusTrackerEl.dataset.stage = status.stageId;
		this.syncOwningSurfaceMeta();
		this.renderStatusSteps(status.steps);
		this.renderStatusNextAction(status.nextAction);
		this.renderPhaseInFlightHint();
		void this.persistResolvedWorkflow(status.steps);
	}

	/** Non-clickable status while Claude owns the current phase. */
	private renderPhaseInFlightHint(): void {
		const inFlight = phaseInFlightStepIdFromProgress(this.phaseProgressDocument);
		if (!inFlight || !this.statusNextActionButton.classList.contains('hidden')) {
			this.statusTrackerEl.classList.toggle('phase-in-flight', Boolean(inFlight));
			return;
		}
		this.statusTrackerEl.classList.add('phase-in-flight');
		const currentStepEl = Array.from(this.statusRailEl.children).find(child =>
			child instanceof HTMLElement && child.classList.contains('current')
		) as HTMLElement | undefined;
		if (!currentStepEl) {
			return;
		}
		let hint = currentStepEl.querySelector('.custom-mode-surface-plan-status-in-flight') as HTMLElement | null;
		if (!hint) {
			hint = $('div.custom-mode-surface-plan-status-in-flight', {
				'aria-live': 'polite',
			});
			const connector = currentStepEl.querySelector('.custom-mode-surface-plan-status-connector');
			if (connector) {
				currentStepEl.insertBefore(hint, connector);
			} else {
				currentStepEl.appendChild(hint);
			}
		}
		const message = this.phaseProgressDocument?.message?.trim()
			|| localize('surfacePlan.phaseInFlight', 'Claude working…');
		hint.textContent = message;
	}

	private owningSurfaceName(): string | undefined {
		const options = this.lastOptions;
		if (!options?.surfaceId) {
			return undefined;
		}
		return options.surfaceName?.trim() || options.surface?.name?.trim() || options.surfaceId;
	}

	private syncOwningSurfaceMeta(): void {
		const surfaceId = this.lastOptions?.surfaceId?.trim();
		const surfaceName = this.owningSurfaceName();
		if (!surfaceId || !surfaceName) {
			this.statusTrackerEl.removeAttribute('data-surface-id');
			this.statusTrackerEl.setAttribute(
				'aria-label',
				localize('surfacePlan.statusTrackerLabel', 'Plan status tracker'),
			);
			this.statusRailEl.setAttribute(
				'aria-label',
				localize('surfacePlan.statusRailLabel', 'Plan workflow steps'),
			);
			return;
		}
		this.statusTrackerEl.dataset.surfaceId = surfaceId;
		this.statusTrackerEl.setAttribute(
			'aria-label',
			localize('surfacePlan.statusTrackerOwnedLabel', '{0} — plan steps', surfaceName),
		);
		this.statusRailEl.setAttribute(
			'aria-label',
			localize('surfacePlan.statusRailOwnedLabel', 'Plan workflow steps for {0}', surfaceName),
		);
	}

	private emitSelectOwningSurface(step?: Pick<SurfacePlanWorkflowStepState, 'id' | 'kind'>): void {
		const surfaceId = this.lastOptions?.surfaceId?.trim();
		const surfaceName = this.owningSurfaceName();
		if (!surfaceId || !surfaceName) {
			return;
		}
		this._onDidSelectOwningSurface.fire({
			surfaceId,
			surfaceName,
			stepId: step?.id,
			stepKind: step?.kind,
		});
	}

	private renderStatusSteps(steps: readonly SurfacePlanWorkflowStepState[]): void {
		const surfaceId = this.lastOptions?.surfaceId?.trim() ?? '';
		const progressKey = `${this.phaseProgressDocument?.status ?? 'none'}:${this.phaseProgressDocument?.stepId ?? ''}`;
		const signature = `${surfaceId}|${progressKey}|${steps.map(step => `${step.id}:${step.status}:${step.label}`).join('|')}`;
		const currentStepId = steps.find(step => step.status === 'current')?.id;
		const signatureChanged = signature !== this.lastStatusStepSignature;
		const shouldCenterCurrent = Boolean(currentStepId) && currentStepId !== this.lastCenteredStepId;

		if (!signatureChanged) {
			this.scheduleStatusScrollSync();
			if (shouldCenterCurrent && currentStepId) {
				this.centerStatusStep(currentStepId, false);
			}
			return;
		}

		const previousScrollLeft = this.statusRailEl.scrollLeft;
		this.statusStepListeners.clear();
		clearNode(this.statusRailEl);
		this.lastStatusStepSignature = signature;
		if (currentStepId !== this.lastEmittedCurrentStepId) {
			this.lastEmittedCurrentStepId = currentStepId;
			const current = steps.find(step => step.id === currentStepId);
			this._onDidChangeCurrentStep.fire(current ? { id: current.id, kind: current.kind } : undefined);
		}
		const recordedById = new Map((this.workflowDocument?.steps ?? []).map(step => [step.id, step]));
		const surfaceName = this.owningSurfaceName();
		for (let index = 0; index < steps.length; index++) {
			const step = steps[index]!;
			const recorded = recordedById.get(step.id);
			const completedAt = step.completedAt ?? recorded?.completedAt;
			const statusLabel = this.statusStepAriaLabel(step.status);
			const stepTitle = surfaceName
				? (completedAt
					? localize('surfacePlan.statusStepOwnedCompletedAt', '{0} · {1} · completed {2}', surfaceName, step.label, completedAt)
					: localize('surfacePlan.statusStepOwned', '{0} · {1}', surfaceName, step.label))
				: (completedAt
					? localize('surfacePlan.statusStepCompletedAt', '{0} · completed {1}', step.label, completedAt)
					: step.label);
			const stepEl = $('div.custom-mode-surface-plan-status-step', {
				role: 'listitem',
				'data-step-id': step.id,
				'data-status': step.status,
				'aria-current': step.status === 'current' ? 'step' : undefined,
				title: stepTitle,
			},
				$('div.custom-mode-surface-plan-status-label', undefined, statusLabel),
				$('div.custom-mode-surface-plan-status-value', undefined, step.label),
			);
			stepEl.classList.toggle('completed', step.status === 'completed');
			stepEl.classList.toggle('current', step.status === 'current');
			stepEl.classList.toggle('pending', step.status === 'pending' || step.status === 'skipped');
			if (surfaceId) {
				stepEl.classList.add('linked-surface');
				stepEl.dataset.surfaceId = surfaceId;
				this.statusStepListeners.add(addDisposableListener(stepEl, 'pointerdown', (event: PointerEvent) => {
					if (event.button !== 0) {
						return;
					}
					const target = event.target;
					if (target instanceof Element && target.closest('.custom-mode-surface-plan-status-next-action')) {
						return;
					}
					event.preventDefault();
					this.emitSelectOwningSurface(step);
				}));
			}
			if (index < steps.length - 1) {
				stepEl.appendChild($('div.custom-mode-surface-plan-status-connector', { 'aria-hidden': 'true' }));
			}
			this.statusRailEl.appendChild(stepEl);
		}

		// Restore scroll immediately (no smooth) so rebuilds don't jump, then center only when current changes.
		this.statusRailEl.scrollLeft = previousScrollLeft;
		this.scheduleStatusScrollSync();
		if (shouldCenterCurrent && currentStepId) {
			queueMicrotask(() => this.centerStatusStep(currentStepId, false));
		} else {
			this.scheduleStatusScrollSync();
		}
	}

	private statusStepAriaLabel(status: SurfacePlanWorkflowStepState['status']): string {
		switch (status) {
			case 'completed':
				return localize('surfacePlan.statusCompleted', 'Done');
			case 'current':
				return localize('surfacePlan.statusCurrent', 'Current');
			case 'skipped':
				return localize('surfacePlan.statusSkipped', 'Skipped');
			default:
				return localize('surfacePlan.statusUpcoming', 'Upcoming');
		}
	}

	private scrollStatusRail(direction: -1 | 1): void {
		const amount = Math.max(180, Math.floor(this.statusRailEl.clientWidth * 0.8));
		this.statusRailEl.scrollBy({ left: direction * amount, behavior: 'auto' });
	}

	/** Map wheel/trackpad (incl. vertical) onto the steps rail; chevrons are a fallback. */
	private handleStatusRailWheel(event: WheelEvent): void {
		if (applyWheelToHorizontalScroll(this.statusRailEl, event)) {
			this.scheduleStatusScrollSync();
		}
	}

	private centerStatusStep(stepId: string, smooth: boolean): void {
		const stepEl = Array.from(this.statusRailEl.children).find(child =>
			child instanceof HTMLElement && child.dataset.stepId === stepId
		) as HTMLElement | undefined;
		if (!stepEl) {
			return;
		}
		const rail = this.statusRailEl;
		const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
		// Prefer keeping finished steps history visible: only nudge scroll enough to
		// bring the current chip into view (right edge), never center-away the Done trail.
		const padding = 12;
		const stepLeft = stepEl.offsetLeft;
		const stepRight = stepLeft + stepEl.offsetWidth;
		const viewLeft = rail.scrollLeft;
		const viewRight = viewLeft + rail.clientWidth;
		let left = viewLeft;
		if (stepRight + padding > viewRight) {
			left = stepRight + padding - rail.clientWidth;
		} else if (stepLeft - padding < viewLeft) {
			left = stepLeft - padding;
		}
		left = Math.max(0, Math.min(maxScroll, left));
		this.lastCenteredStepId = stepId;
		if (Math.abs(rail.scrollLeft - left) < 2) {
			this.scheduleStatusScrollSync();
			return;
		}
		rail.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
		this.scheduleStatusScrollSync();
	}

	private scheduleStatusScrollSync(): void {
		if (this.statusScrollSyncScheduled) {
			return;
		}
		this.statusScrollSyncScheduled = true;
		requestAnimationFrame(() => {
			this.statusScrollSyncScheduled = false;
			this.syncStatusScrollButtons();
		});
	}

	private syncStatusScrollButtons(): void {
		const el = this.statusRailEl;
		const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
		const atStart = el.scrollLeft <= 2;
		const atEnd = el.scrollLeft >= maxScroll - 2;
		this.statusScrollPrevButton.disabled = atStart || maxScroll <= 0;
		this.statusScrollNextButton.disabled = atEnd || maxScroll <= 0;
		this.statusTrackerEl.classList.toggle('can-scroll', maxScroll > 0);
		this.statusTrackerEl.classList.toggle('at-start', atStart || maxScroll <= 0);
		this.statusTrackerEl.classList.toggle('at-end', atEnd || maxScroll <= 0);
	}

	private renderStatusNextAction(action: SurfacePlanWorkflowAction | undefined): void {
		if (!action) {
			this.nextActionInFlight = false;
			this.pendingNextActionKey = undefined;
			this.statusNextActionButton.classList.add('hidden');
			this.statusNextActionButton.disabled = true;
			this.statusNextActionButton.textContent = '';
			this.statusNextActionButton.removeAttribute('data-action-id');
			this.statusNextActionButton.removeAttribute('data-step-id');
			// Park off-rail so a rail rebuild/clearNode cannot dispose the live button node.
			if (this.statusNextActionButton.parentElement !== this.statusTrackerEl) {
				this.statusTrackerEl.appendChild(this.statusNextActionButton);
			}
			for (const child of Array.from(this.statusRailEl.children)) {
				if (child instanceof HTMLElement) {
					child.classList.remove('has-next-action');
					child.querySelector('.custom-mode-surface-plan-status-in-flight')?.remove();
				}
			}
			return;
		}
		const actionKey = `${action.id}:${action.stepId}`;
		if (this.pendingNextActionKey && this.pendingNextActionKey !== actionKey) {
			// Stage advanced — allow the new next action.
			this.nextActionInFlight = false;
			this.pendingNextActionKey = undefined;
		}
		const isRetry = Boolean(failedPhaseStepIdFromProgress(this.phaseProgressDocument))
			&& action.id === 'run_next_phase';
		for (const child of Array.from(this.statusRailEl.children)) {
			if (child instanceof HTMLElement) {
				child.querySelector('.custom-mode-surface-plan-status-in-flight')?.remove();
			}
		}
		this.statusTrackerEl.classList.remove('phase-in-flight');
		this.statusNextActionButton.classList.remove('hidden');
		// Stay disabled after click until this next-action identity changes (prevents re-prompting Claude).
		this.statusNextActionButton.disabled = this.nextActionInFlight || this.pendingNextActionKey === actionKey;
		// Button chrome is Continue/Retry — step title already shows above in the CURRENT card.
		const buttonLabel = action.id === 'run_next_phase'
			? (isRetry
				? localize('surfacePlan.retryPhase', 'Retry')
				: localize('surfacePlan.continuePhase', 'Continue'))
			: action.label;
		this.statusNextActionButton.textContent = buttonLabel;
		this.statusNextActionButton.dataset.actionId = action.id;
		this.statusNextActionButton.dataset.stepId = action.stepId;
		this.statusNextActionButton.title = this.statusNextActionButton.disabled
			? localize('surfacePlan.statusNextActionInFlightTitle', 'Already sent to Claude — waiting for progress…')
			: isRetry
				? localize('surfacePlan.retryPhaseTitle', 'Retry failed phase: {0}', action.label)
				: localize(
					'surfacePlan.statusNextActionTitle',
					'Run next plan step: {0}',
					action.label,
				);
		const currentStepEl = Array.from(this.statusRailEl.children).find(child =>
			child instanceof HTMLElement && child.classList.contains('current')
		) as HTMLElement | undefined;
		for (const child of Array.from(this.statusRailEl.children)) {
			if (child instanceof HTMLElement) {
				child.classList.toggle('has-next-action', child === currentStepEl);
			}
		}
		if (currentStepEl && this.statusNextActionButton.parentElement !== currentStepEl) {
			// Keep the connector last so it still paints on the right edge of the chip.
			const connector = currentStepEl.querySelector('.custom-mode-surface-plan-status-connector');
			if (connector) {
				currentStepEl.insertBefore(this.statusNextActionButton, connector);
			} else {
				currentStepEl.appendChild(this.statusNextActionButton);
			}
		}
	}

	private async refreshWorkflowDocument(workspaceFolder: URI, surfaceId: string, generation: number): Promise<void> {
		try {
			const content = await this.fileService.readFile(surfacePlanWorkflowResource(workspaceFolder, surfaceId));
			if (generation !== this.loadGeneration) {
				return;
			}
			this.workflowDocument = parseSurfacePlanWorkflowDocument(content.value.toString(), surfaceId);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.workflowDocument = undefined;
		}
	}

	private async refreshPhaseProgress(workspaceFolder: URI, surfaceId: string, generation: number): Promise<void> {
		try {
			const content = await this.fileService.readFile(surfacePhaseProgressResource(workspaceFolder, surfaceId));
			if (generation !== this.loadGeneration) {
				return;
			}
			this.phaseProgressDocument = parseSurfacePhaseProgress(content.value.toString(), surfaceId);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.phaseProgressDocument = undefined;
		}
	}

	private async refreshBlockersDocument(
		workspaceFolder: URI,
		surfaceId: string,
		surfacePath: string | undefined,
		generation: number,
	): Promise<void> {
		this.blockersWriteInFlight = true;
		try {
			const doc = await loadAndProbeSurfaceBlockers(
				this.fileService,
				workspaceFolder,
				surfaceId,
				surfacePath ?? this.lastOptions?.surface?.path,
			);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.blockersDocument = doc;
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.blockersDocument = undefined;
		} finally {
			this.blockersWriteInFlight = false;
		}
	}

	private async writeBlockersDocument(doc: SurfaceBlockersDocument): Promise<void> {
		const options = this.lastOptions;
		if (!options?.workspaceFolder) {
			return;
		}
		this.blockersWriteInFlight = true;
		try {
			await this.fileService.createFolder(joinPath(options.workspaceFolder, '.agent', 'surfaces'));
			await this.fileService.writeFile(
				surfaceBlockersResource(options.workspaceFolder, options.surfaceId),
				VSBuffer.fromString(serializeSurfaceBlockersDocument(doc)),
			);
			this.blockersDocument = doc;
		} finally {
			this.blockersWriteInFlight = false;
		}
	}

	private async refreshWorkstreamRuns(workspaceFolder: URI, surfaceId: string, generation: number): Promise<void> {
		try {
			const content = await this.fileService.readFile(surfaceWorkstreamRunsResource(workspaceFolder, surfaceId));
			if (generation !== this.loadGeneration) {
				return;
			}
			this.workstreamRunsDocument = parseSurfaceWorkstreamRuns(content.value.toString(), surfaceId);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.workstreamRunsDocument = undefined;
		}
	}

	/**
	 * Parallel workstream Claudes report into workstream-runs.json.
	 * When all complete (or any failed with none running), write phase-progress accordingly.
	 */
	private async applyWorkstreamRunsUpdate(): Promise<void> {
		const options = this.lastOptions;
		const runs = this.workstreamRunsDocument;
		const progress = this.phaseProgressDocument;
		if (!options?.workspaceFolder || !runs || !progress || progress.status !== 'running') {
			return;
		}
		if (runs.stepId && progress.stepId && runs.stepId !== progress.stepId) {
			return;
		}
		if (workstreamRunsAllCompleted(runs)) {
			const completedKeys = runs.keys.map(entry => entry.key);
			await this.writePhaseProgress({
				...progress,
				status: 'completed',
				updatedAt: new Date().toISOString(),
				message: localize('surfacePlan.workstreamsComplete', 'All Claude workstreams completed'),
				inflightWorkstreamKeys: undefined,
			});
			this._onDidWorkstreamsComplete.fire({
				surfaceId: options.surfaceId,
				keys: completedKeys,
			});
			await this.applyPhaseProgressUpdate();
			return;
		}
		if (workstreamRunsFailed(runs)) {
			const failed = runs.keys.find(entry => entry.status === 'failed');
			await this.writePhaseProgress({
				...progress,
				status: 'failed',
				updatedAt: new Date().toISOString(),
				error: failed?.error || localize('surfacePlan.workstreamsFailed', 'A Claude workstream failed'),
				inflightWorkstreamKeys: undefined,
			});
			this.renderStatusTracker();
		}
	}

	/**
	 * Claude finished (or failed) a phase via phase-progress.json.
	 * Console owns marking workflow.json completed.
	 */
	private async applyPhaseProgressUpdate(): Promise<void> {
		const options = this.lastOptions;
		const progress = this.phaseProgressDocument;
		if (!options?.workspaceFolder || !progress) {
			this.renderStatusTracker();
			return;
		}
		// Multi-Claude fan-out: ignore premature phase-progress completed until workstream-runs agree.
		if (
			progress.status === 'completed'
			&& progress.inflightWorkstreamKeys?.length
			&& this.workstreamRunsDocument
			&& !workstreamRunsAllCompleted(this.workstreamRunsDocument)
		) {
			this.renderStatusTracker();
			return;
		}
		if (progress.status === 'completed' && progress.stepId) {
			if (isBlockerStepId(progress.stepId) && this.blockersDocument) {
				const resolved = resolveBlockerInDocument(this.blockersDocument, progress.stepId);
				await this.writeBlockersDocument(resolved);
				await this.refreshBlockersDocument(
					options.workspaceFolder,
					options.surfaceId,
					options.surfacePath ?? options.surface?.path,
					this.loadGeneration,
				);
			} else {
				const alreadyDone = completedStepIdsFromWorkflow(this.workflowDocument).includes(progress.stepId);
				if (!alreadyDone) {
					await this.markStepCompleted(progress.stepId);
				}
			}
			await this.writePhaseProgress(createIdlePhaseProgress(options.surfaceId, progress));
			this.renderStatusTracker();
			return;
		}
		this.renderStatusTracker();
	}

	private async writePhaseProgress(doc: SurfacePhaseProgressDocument): Promise<void> {
		const options = this.lastOptions;
		if (!options?.workspaceFolder) {
			return;
		}
		this.phaseProgressWriteInFlight = true;
		try {
			await this.fileService.createFolder(joinPath(options.workspaceFolder, '.agent', 'surfaces'));
			await this.fileService.writeFile(
				surfacePhaseProgressResource(options.workspaceFolder, doc.surfaceId || options.surfaceId),
				VSBuffer.fromString(serializeSurfacePhaseProgress(doc)),
			);
			this.phaseProgressDocument = doc;
		} finally {
			this.phaseProgressWriteInFlight = false;
		}
	}

	private async syncWorkflowDocument(workspaceFolder: URI, surfaceId: string): Promise<void> {
		const status = resolveSurfacePlanWorkflowStatus(this.workflowSignals());
		const merged = mergeWorkflowSteps(surfaceId, status.steps, this.workflowDocument);
		this.workflowDocument = merged;
		await this.writeWorkflowDocument(workspaceFolder, merged);
	}

	private async persistResolvedWorkflow(steps: readonly SurfacePlanWorkflowStepState[]): Promise<void> {
		const options = this.lastOptions;
		if (!options?.workspaceFolder || !options.surfaceId || this.workflowWriteInFlight || !this.signalsHydrated) {
			return;
		}
		const merged = mergeWorkflowSteps(options.surfaceId, steps, this.workflowDocument);
		const prior = this.workflowDocument;
		const unchanged = prior
			&& prior.currentStepId === merged.currentStepId
			&& prior.steps.length === merged.steps.length
			&& prior.steps.every((step, index) => {
				const next = merged.steps[index];
				return next
					&& step.id === next.id
					&& step.status === next.status
					&& step.label === next.label;
			});
		if (unchanged) {
			return;
		}
		this.workflowDocument = merged;
		await this.writeWorkflowDocument(options.workspaceFolder, merged);
	}

	private async writeWorkflowDocument(workspaceFolder: URI, doc: SurfacePlanWorkflowDocument): Promise<void> {
		this.workflowWriteInFlight = true;
		try {
			await this.fileService.createFolder(joinPath(workspaceFolder, '.agent', 'surfaces'));
			await this.fileService.writeFile(
				surfacePlanWorkflowResource(workspaceFolder, doc.surfaceId),
				VSBuffer.fromString(serializeSurfacePlanWorkflowDocument(doc)),
			);
		} finally {
			this.workflowWriteInFlight = false;
		}
	}

	/**
	 * Console owns durable Step file writes here. ModeShell then runs Custom AI
	 * orchestration and dispatches tool-heavy work to Claude (see surfacePlanOrchestration).
	 */
	private async runStatusNextAction(): Promise<void> {
		const actionId = this.statusNextActionButton.dataset.actionId as SurfacePlanWorkflowActionId | undefined;
		const stepId = this.statusNextActionButton.dataset.stepId;
		if (!actionId || !stepId || this.nextActionInFlight || !this.lastOptions) {
			return;
		}
		this.nextActionInFlight = true;
		this.pendingNextActionKey = `${actionId}:${stepId}`;
		this.statusNextActionButton.disabled = true;
		this.statusNextActionButton.title = localize(
			'surfacePlan.statusNextActionInFlightTitle',
			'Already sent to Claude — waiting for progress…',
		);
		try {
			// Always re-select the owning SURFACE card when advancing a step.
			this.emitSelectOwningSurface();
			switch (actionId) {
				case 'start_planning':
					await this.startPlanningFromStatus(stepId);
					break;
				case 'confirm_repos':
					await this.confirmReferenceSelection();
					break;
				case 'continue_research': {
					const stepLabel = this.statusNextActionButton.textContent?.trim()
						|| (stepId === 'research_survey'
							? localize('surfacePlan.continueSurvey', 'Continue survey')
							: localize('surfacePlan.continueResearch', 'Continue research'));
					this.emitNextAction(actionId, stepId, stepLabel);
					break;
				}
				case 'lock_plan':
					await this.lockPlanAndContinue(stepId);
					break;
				case 'run_next_phase': {
					// Start phase in-flight — Claude writes completed to phase-progress.json.
					const rawLabel = this.statusNextActionButton.textContent?.trim() ?? '';
					const openBlocker = openBlockerStepRefs(this.blockersDocument).find(blocker => blocker.id === stepId);
					const stepLabel = stepId === VERIFY_GRAPH_STEP_ID
						? VERIFY_GRAPH_STEP.label
						: stepId === ENABLE_PREVIEW_STEP_ID
							? ENABLE_PREVIEW_STEP.label
							: stepId === DEPLOYED_STEP_ID
								? DEPLOYED_STEP.label
								: (openBlocker?.label
									|| this.lastProposalPhases.find(phase => phase.id === stepId)?.title
									|| rawLabel.replace(/^Retry:\s*/i, '').trim()
									|| stepId);
					await this.writePhaseProgress(createRunningPhaseProgress({
						surfaceId: this.lastOptions.surfaceId,
						stepId,
						stepLabel,
					}));
					this.emitNextAction(actionId, stepId, stepLabel);
					break;
				}
			}
		} catch {
			// Only re-arm on hard failure — success stays disabled until the stage advances.
			this.nextActionInFlight = false;
			this.pendingNextActionKey = undefined;
		} finally {
			this.renderStatusTracker();
		}
	}

	/** Console owns the Start planning gate — kick Claude with plan intent (compose is optional). */
	private async startPlanningFromStatus(stepId: string): Promise<void> {
		const options = this.lastOptions;
		if (!options) {
			return;
		}
		const surfaceName = options.surfaceName?.trim() || options.surfaceId;
		const intent = this.intentFromPlanMarkdown(this.lastPlanMarkdown)
			|| options.surface?.purpose?.trim()
			|| `Build ${surfaceName}.`;
		await this.markStepCompleted(stepId);
		this._onDidRequestBuild.fire({
			surfaceId: options.surfaceId,
			surfaceName,
			intent,
		});
	}

	private intentFromPlanMarkdown(markdown: string | undefined): string | undefined {
		if (!markdown?.trim()) {
			return undefined;
		}
		const section = /##\s*Intent\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(markdown);
		const body = section?.[1]?.trim();
		return body || undefined;
	}

	private async lockPlanAndContinue(stepId: string): Promise<void> {
		const options = this.lastOptions;
		const workspaceFolder = options?.workspaceFolder;
		if (!options || !workspaceFolder) {
			return;
		}
		const planResource = await resolveSurfacePlanResource(
			this.fileService,
			workspaceFolder,
			options.surfaceId,
			options.surfacePath,
		) ?? surfacePlanResource(workspaceFolder, options.surfaceId);
		let markdown = this.lastPlanMarkdown;
		if (!markdown) {
			try {
				const content = await this.fileService.readFile(planResource);
				markdown = content.value.toString();
			} catch {
				markdown = [
					`# ${options.surfaceName?.trim() || options.surfaceId} — Plan`,
					'',
					'## §0 Plan lock',
					'- [ ] Locked',
					'',
				].join('\n');
			}
		}
		const lockedMarkdown = markSurfacePlanLocked(markdown);
		await this.fileService.writeFile(planResource, VSBuffer.fromString(lockedMarkdown));
		this.lastPlanMarkdown = lockedMarkdown;
		this.planLocked = true;
		this.hasPlanContent = true;
		await this.markStepCompleted(stepId);
		this.emitNextAction('lock_plan', stepId, localize('surfacePlan.lockPlanStep', 'Lock plan and start build'));
	}

	/**
	 * When the latest compare snapshot is a full structural pass against this
	 * surface's proposal, mark every still-incomplete generate phase complete.
	 * Does not touch Enable Preview or blockers.
	 */
	private async reconcileStructuralPhaseSteps(
		proposal: GraphProposalDocument | undefined,
		snapshot: ProposalCompareSnapshot | undefined,
	): Promise<void> {
		if (!this.planLocked || !proposal || this.lastProposalPhases.length === 0) {
			return;
		}
		const phaseIds = phaseIdsToCompleteFromStructuralPass({
			proposal,
			snapshot,
			proposalPhases: this.lastProposalPhases,
			completedStepIds: completedStepIdsFromWorkflow(this.workflowDocument),
		});
		if (phaseIds.length === 0) {
			return;
		}
		await this.markStepsCompleted(phaseIds);
	}

	private async markStepCompleted(stepId: string): Promise<void> {
		await this.markStepsCompleted([stepId]);
	}

	private async markStepsCompleted(stepIds: readonly string[]): Promise<void> {
		const options = this.lastOptions;
		if (!options?.workspaceFolder || stepIds.length === 0) {
			return;
		}
		const toComplete = new Set(stepIds.filter(id => id.trim()));
		if (toComplete.size === 0) {
			return;
		}
		const status = resolveSurfacePlanWorkflowStatus({
			...this.workflowSignals(),
			// Completing these steps — ignore in-flight for the merge snapshot.
			phaseInFlightStepId: undefined,
			failedPhaseStepId: undefined,
			completedStepIds: [...completedStepIdsFromWorkflow(this.workflowDocument), ...toComplete],
		});
		const merged = mergeWorkflowSteps(options.surfaceId, status.steps, this.workflowDocument);
		const now = new Date().toISOString();
		this.workflowDocument = {
			...merged,
			steps: merged.steps.map(step =>
				toComplete.has(step.id)
					? { ...step, status: 'completed', completedAt: step.completedAt ?? now }
					: step
			),
		};
		await this.writeWorkflowDocument(options.workspaceFolder, this.workflowDocument);
	}

	private emitNextAction(actionId: SurfacePlanWorkflowActionId, stepId: string, stepLabel: string): void {
		const options = this.lastOptions;
		if (!options) {
			return;
		}
		this._onDidRequestNextAction.fire({
			surfaceId: options.surfaceId,
			surfaceName: options.surfaceName?.trim() || options.surfaceId,
			actionId,
			stepId,
			stepLabel,
		});
	}

	private publishTreeDocument(options: SurfaceProposalTreeDocumentOptions): void {
		const status = resolveSurfacePlanWorkflowStatus(this.workflowSignals());
		const phaseInFlight = phaseInFlightStepIdFromProgress(this.phaseProgressDocument);
		// After lock, Steps Next owns generate-phase fan-out — hide the duplicate Workstreams CTA.
		const hideRunWorkstreamsButton = Boolean(
			this.planLocked
			&& (
				status.stageId === 'building'
				|| status.stageId === 'plan_locked'
				|| status.nextAction?.id === 'run_next_phase'
				|| phaseInFlight
			)
		);
		const currentStepId = status.steps.find(step => step.status === 'current')?.id
			?? phaseInFlight
			?? this.phaseProgressDocument?.stepId;
		const workstreamsInflight = Boolean(this.phaseProgressDocument?.inflightWorkstreamKeys?.length);
		const progressDoc = this.phaseProgressDocument;
		const phaseStatuses = status.steps
			.filter(step => step.kind === 'phase')
			.map(step => {
				if (progressDoc?.status === 'failed' && progressDoc.stepId === step.id) {
					return { id: step.id, status: 'failed' as const };
				}
				return { id: step.id, status: step.status };
			});
		const phaseProgressNote = progressDoc
			&& (progressDoc.status === 'running' || progressDoc.status === 'failed')
			? (progressDoc.error?.trim() || progressDoc.message?.trim() || undefined)
			: undefined;
		const surfacePurpose = (options.surfacePurpose ?? this.lastOptions?.surface?.purpose)?.trim() || undefined;
		const surfaceSchema = options.surfaceSchema ?? this.lastOptions?.surface?.schema;
		const merged: SurfaceProposalTreeDocumentOptions = {
			...options,
			surfacePurpose,
			surfaceSchema,
			hideRunWorkstreamsButton,
			parallelClaudeWorkstreamsEnabled: this.parallelClaudeWorkstreamsEnabled,
			currentStepId,
			workstreamsInflight,
			phaseStatuses,
			phaseProgressNote,
		};
		this.lastTreeDocument = merged;
		this.treeView.setDocument(merged);
	}

	private withResolvedRepoReasons(
		candidates: SurfaceReferenceCandidates | undefined,
		planMarkdown?: string,
	): SurfaceReferenceCandidates | undefined {
		if (!candidates) {
			return undefined;
		}
		return {
			...candidates,
			repos: candidates.repos.map(repo => ({
				...repo,
				reason: resolveReferenceRepoReason(repo, planMarkdown) ?? repo.reason,
			})),
		};
	}

	private republishTreeWithCandidates(): void {
		if (!this.lastTreeDocument) {
			return;
		}
		this.publishTreeDocument({
			...this.lastTreeDocument,
			referenceCandidates: this.withResolvedRepoReasons(
				this.candidates,
				this.lastTreeDocument.planMarkdown,
			),
		});
	}

	private async toggleRepoSelection(owner: string, repo: string, selected: boolean): Promise<void> {
		if (!this.candidates || this.candidates.status !== 'awaiting_selection' || !this.lastOptions?.workspaceFolder) {
			return;
		}
		const next = withRepoSelection(this.candidates, owner, repo, selected);
		await this.persistCandidates(next);
	}

	private async confirmReferenceSelection(): Promise<void> {
		if (!this.candidates || this.candidates.status !== 'awaiting_selection' || !this.lastOptions?.workspaceFolder) {
			return;
		}
		const selected = selectedReferenceRepos(this.candidates);
		if (!selected.length) {
			return;
		}
		const next = withCandidatesStatus(this.candidates, 'confirmed');
		await this.persistCandidates(next);
		this._onDidConfirmReferenceSelection.fire({
			surfaceId: next.surfaceId,
			selectedRepos: selected.map(item => ({
				owner: item.owner,
				repo: item.repo,
				url: item.url,
			})),
		});
	}

	private async persistCandidates(doc: SurfaceReferenceCandidates): Promise<void> {
		const workspaceFolder = this.lastOptions?.workspaceFolder;
		if (!workspaceFolder) {
			return;
		}
		this.candidates = doc;
		this.renderStatusTracker();
		this.republishTreeWithCandidates();
		const resource = surfaceReferenceCandidatesResource(workspaceFolder, doc.surfaceId);
		this.candidatesWriteInFlight = true;
		try {
			await this.fileService.writeFile(resource, VSBuffer.fromString(serializeSurfaceReferenceCandidates(doc)));
		} finally {
			this.candidatesWriteInFlight = false;
		}
	}

	private showTreeMessage(message: string): void {
		this.treeAnchor.classList.remove('hidden');
		this.publishTreeDocument({
			proposalMissingMessage: message,
			referenceCandidates: this.withResolvedRepoReasons(this.candidates, this.lastTreeDocument?.planMarkdown),
			storageKey: 'surfaceProposalTree.visibility',
		});
	}

	private clearCompose(): void {
		this.composeListeners.clear();
		this.composeEl.classList.add('hidden');
		this.composeEl.replaceChildren();
	}

	private renderBuildCompose(surfaceId: string, surfaceName: string): void {
		this.composeListeners.clear();
		this.composeEl.classList.remove('hidden');
		this.composeEl.replaceChildren();

		const store = new DisposableStore();
		this.composeListeners.value = store;

		const heading = $('div.custom-mode-surface-plan-compose-heading', undefined,
			localize('surfacePlan.composeHeading', 'What do you want to Build?'));
		const hint = $('div.custom-mode-surface-plan-compose-hint', undefined,
			localize(
				'surfacePlan.composeHint',
				'Describe the surface for {0}. Claude Code will draft the plan and graph proposal — no app code yet.',
				surfaceName,
			));
		const input = $('textarea.custom-mode-surface-plan-compose-input', {
			rows: '4',
			placeholder: localize(
				'surfacePlan.composePlaceholder',
				'e.g. Patient support chat for a clinic — appointments, billing FAQs, escalate to a nurse…',
			),
		}) as HTMLTextAreaElement;
		input.setAttribute('aria-label', localize('surfacePlan.composeHeading', 'What do you want to Build?'));

		const submit = $('button.custom-mode-surface-plan-compose-submit', {
			type: 'button',
		}, localize('surfacePlan.composeSubmit', 'Ask Claude')) as HTMLButtonElement;

		const submitIntent = () => {
			const intent = input.value.trim();
			if (!intent) {
				input.focus();
				return;
			}
			submit.disabled = true;
			this._onDidRequestBuild.fire({ surfaceId, surfaceName, intent });
			setTimeout(() => {
				if (!submit.isConnected) {
					return;
				}
				submit.disabled = false;
			}, 800);
		};

		store.add(addDisposableListener(submit, 'click', submitIntent));
		store.add(addDisposableListener(input, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				submitIntent();
			}
		}));

		const actions = $('div.custom-mode-surface-plan-compose-actions', undefined, submit);
		const form = $('div.custom-mode-surface-plan-compose', undefined, heading, hint, input, actions);
		this.composeEl.appendChild(form);
		queueMicrotask(() => input.focus());
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { graphProposalResource } from '../../../../../custom/agentTaskTree/agentTaskTreeGraphProposal.js';
import { taskTreesFolder } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import { resolveSurfacePlanResource, surfaceGraphProposalDraftResource, surfacePlanResource } from '../../../../../custom/goalWorkspace/surfacePlanPaths.js';
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
	isSurfacePlanLocked,
	markSurfacePlanLocked,
	resolveSurfacePlanWorkflowStatus,
	type SurfacePlanWorkflowAction,
	type SurfacePlanWorkflowActionId,
	type SurfacePlanWorkflowPhaseRef,
	type SurfacePlanWorkflowSignals,
	type SurfacePlanWorkflowStepState,
} from '../../../../../custom/goalWorkspace/surfacePlanWorkflowStatus.js';
import { discoverIxSubsystemRegions } from '../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import type { WorkspaceSurface } from '../../../../../custom/goalWorkspace/ConsoleService.js';
import { resolveSurfacePathForIx, scopeIxRegionsToSurface } from '../../../../../custom/goalWorkspace/surfaceIxScope.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { buildProposalDiffGraph, buildProposalPreviewGraph } from './proposalGraphDiff/buildProposalDiffGraph.js';
import { partitionProposalWorkstreams } from './proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument, ProposalCompareSnapshot } from './proposalGraphDiff/proposalGraphDiffTypes.js';
import { computeSurfaceProposalProgress } from './surfaceProposalProgress.js';
import { SurfaceProposalTreeView, type SurfaceProposalTreeCardItem, type SurfaceProposalTreeDocumentOptions, type SurfaceProposalTreeGraphRegion, type SurfaceProposalTreePreviewInfo } from './surfaceProposalTreeView.js';

/** Latest ix compare_proposal snapshot used for Files/Relationships/Workstreams card progress. */
function proposalCompareSnapshotResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, '.ix-scaffold', 'graph-compare', 'latest-proposal.json');
}

export interface SurfacePlanPanelLoadOptions {
	readonly surfaceId: string;
	readonly surfaceName?: string;
	readonly surfacePath?: string;
	readonly treeId?: string;
	readonly localUrl?: string;
	readonly surface?: WorkspaceSurface;
	readonly workspaceFolder: URI | undefined;
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
	private workflowDocument: SurfacePlanWorkflowDocument | undefined;
	private phaseProgressDocument: SurfacePhaseProgressDocument | undefined;
	private loadGeneration = 0;
	private candidates: SurfaceReferenceCandidates | undefined;
	private candidatesWriteInFlight = false;
	private workflowWriteInFlight = false;
	private phaseProgressWriteInFlight = false;
	private nextActionInFlight = false;
	private hasPlanContent = false;
	private hasDraftProposal = false;
	private hasFinalProposal = false;
	private planLocked = false;
	private lastStatusStepSignature: string | undefined;
	private lastCenteredStepId: string | undefined;
	private statusScrollSyncScheduled = false;

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
		this.root.appendChild($('div.custom-mode-surface-plan', undefined, this.statusTrackerEl, this.composeEl, this.treeAnchor));

		this.treeView = this._register(new SurfaceProposalTreeView(webviewService, () => this.treeView.republish()));
		this.onDidChangeCards = this.treeView.onDidChangeCards;
		this.treeView.attach(this.treeAnchor);
		this._register(this.treeView.onDidToggleRepo(request => {
			void this.toggleRepoSelection(request.owner, request.repo, request.selected);
		}));
		this._register(this.treeView.onDidConfirmRepos(() => {
			void this.confirmReferenceSelection();
		}));

		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (this.lastOptions) {
				void this.load({ ...this.lastOptions });
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
		this._register(addDisposableListener(this.statusRailEl, 'wheel', (event: WheelEvent) => {
			this.handleStatusRailWheel(event);
		}, { passive: false }));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.renderStatusTracker();
		this.showTreeMessage(localize('surfacePlan.selectSurface', 'Select a surface to view its plan.md.'));
	}

	/** Scroll a section of the proposal tree into view — driven by the shared card rail. */
	selectSection(id: string): void {
		this.treeView.selectSection(id);
	}

	/** Drop Steps ownership when the SURFACE card is collapsed / home is shown. */
	clear(): void {
		this.loadGeneration++;
		this.watcher.clear();
		this.lastOptions = undefined;
		this.lastTreeDocument = undefined;
		this.lastPlanMarkdown = undefined;
		this.lastProposalPhases = [];
		this.workflowDocument = undefined;
		this.phaseProgressDocument = undefined;
		this.candidates = undefined;
		this.hasPlanContent = false;
		this.hasDraftProposal = false;
		this.hasFinalProposal = false;
		this.planLocked = false;
		this.lastStatusStepSignature = undefined;
		this.lastCenteredStepId = undefined;
		this.statusStepListeners.clear();
		clearNode(this.statusRailEl);
		this.statusRailEl.scrollLeft = 0;
		this.syncOwningSurfaceMeta();
		this.renderStatusNextAction(undefined);
		this.showTreeMessage(localize('surfacePlan.selectSurface', 'Select a surface to view its plan.md.'));
	}

	async load(options: SurfacePlanPanelLoadOptions): Promise<void> {
		const surfaceChanged = this.lastOptions?.surfaceId !== options.surfaceId;
		this.lastOptions = options;
		if (surfaceChanged) {
			this.lastStatusStepSignature = undefined;
			this.lastCenteredStepId = undefined;
			this.statusRailEl.scrollLeft = 0;
		}
		const generation = ++this.loadGeneration;
		const { surfaceId, surfaceName, surfacePath, treeId, workspaceFolder } = options;
		this.titleEl.textContent = localize('surfacePlan.title', '{0} plan', surfaceName?.trim() || surfaceId);
		this.pathEl.textContent = '';
		this.statusEl.textContent = localize('surfacePlan.loading', 'Loading…');
		// Stamp ownership immediately so Steps aria/dataset stay bound to the open surface.
		this.syncOwningSurfaceMeta();

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
			this.renderStatusTracker();
			this.clearCompose();
			this.showTreeMessage(localize('surfacePlan.noWorkspace', 'Open a workspace folder to load plan.md.'));
			return;
		}

		this.watchPlanAndProposal(workspaceFolder, surfaceId, surfacePath, treeId);
		await this.refreshReferenceCandidates(workspaceFolder, surfaceId, generation, false);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.refreshWorkflowDocument(workspaceFolder, surfaceId, generation);
		if (generation !== this.loadGeneration) {
			return;
		}
		await this.refreshPhaseProgress(workspaceFolder, surfaceId, generation);
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
				this.renderStatusTracker();
				this.clearCompose();
				this.showTreeMessage(localize(
					'surfacePlan.readFailed',
					'Could not read plan: {0}',
					String((error as Error)?.message ?? error),
				));
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

		await this.syncWorkflowDocument(workspaceFolder, surfaceId);
		if (generation !== this.loadGeneration) {
			return;
		}
		this.renderStatusTracker();
		this.treeAnchor.classList.remove('hidden');
		const snapshot = await this.loadProposalCompareSnapshot(workspaceFolder);
		if (generation !== this.loadGeneration) {
			return;
		}
		const partition = proposal ? partitionProposalWorkstreams(proposal) : undefined;
		const graph = proposal
			? (snapshot ? buildProposalDiffGraph(proposal, snapshot) : buildProposalPreviewGraph(proposal))
			: undefined;
		const progress = proposal ? computeSurfaceProposalProgress(proposal, partition, snapshot) : undefined;
		const [claude, graphRegions, previewInfo] = await Promise.all([
			this.loadClaudeMd(workspaceFolder),
			this.loadGraphRegions(workspaceFolder, options.surface),
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
			graphRegions: graphRegions.regions,
			graphMessage: graphRegions.message,
			previewInfo,
			referenceCandidates: this.withResolvedRepoReasons(this.candidates, planMarkdown),
			storageKey: `surfaceProposalTree.visibility.${surfaceId}`,
			proposalMissingMessage: proposal || planMarkdown || this.candidates
				? proposalMissingMessage
				: (proposalMissingMessage || localize('surfacePlan.emptyContent', 'No plan or proposal content yet.')),
		});
	}

	private async loadProposalCompareSnapshot(workspaceFolder: URI): Promise<ProposalCompareSnapshot | undefined> {
		const resource = proposalCompareSnapshotResource(workspaceFolder);
		try {
			if (!(await this.fileService.exists(resource))) {
				return undefined;
			}
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
				message: localize('surfacePlan.graphNoSurface', 'Select a surface to view the generated code graph.'),
			};
		}
		try {
			const surfacePath = resolveSurfacePathForIx(surface);
			try {
				await this.ixIntegrationService.mapPath(workspaceFolder, surfacePath);
			} catch {
				// best-effort
			}
			const regions = await discoverIxSubsystemRegions(this.ixIntegrationService, workspaceFolder);
			const scoped = scopeIxRegionsToSurface(regions, surface, surfacePath);
			if (!scoped.length) {
				return {
					regions: [],
					message: localize(
						'surfacePlan.graphEmpty',
						'No Ix subsystems matched this surface yet. Map the surface path or refresh after scaffold.',
					),
				};
			}
			return {
				regions: scoped.map(region => ({
					name: region.name,
					entryPath: region.entryPath,
					memberFiles: region.memberFiles,
					fileCount: region.fileCount,
				})),
			};
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

	private buildPreviewInfo(options: SurfacePlanPanelLoadOptions): SurfaceProposalTreePreviewInfo {
		const localUrl = options.localUrl?.trim() || options.surface?.localUrl?.trim();
		const name = options.surfaceName?.trim() || options.surfaceId;
		if (!localUrl) {
			return {
				message: localize(
					'surfacePlan.previewMissingUrl',
					'{0} has no preview URL. Add localUrl to this surface in workspace.goal.json to route the preview.',
					name,
				),
			};
		}
		return {
			localUrl,
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
			store.add(this.fileService.onDidFilesChange(e => {
				if (
					!this.lastOptions
					|| this.lastOptions.surfaceId !== surfaceId
					|| this.candidatesWriteInFlight
					|| this.workflowWriteInFlight
					|| this.phaseProgressWriteInFlight
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
				const workflowUri = surfacePlanWorkflowResource(workspaceFolder, surfaceId);
				if (e.affects(workflowUri)) {
					void this.refreshWorkflowDocument(workspaceFolder, surfaceId, this.loadGeneration).then(() => {
						this.renderStatusTracker();
					});
					return;
				}
				const compareSnapshotUri = proposalCompareSnapshotResource(workspaceFolder);
				if (e.affects(compareSnapshotUri) || e.contains(compareSnapshotUri)) {
					void this.load(this.lastOptions);
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
					void this.load(this.lastOptions);
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
		return {
			surfaceConfirmed: this.lastOptions ? Boolean(this.lastOptions.surface) : undefined,
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
		};
	}

	private renderStatusTracker(): void {
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

	private emitSelectOwningSurface(): void {
		const surfaceId = this.lastOptions?.surfaceId?.trim();
		const surfaceName = this.owningSurfaceName();
		if (!surfaceId || !surfaceName) {
			return;
		}
		this._onDidSelectOwningSurface.fire({ surfaceId, surfaceName });
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
					this.emitSelectOwningSurface();
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

	/** Keep horizontal wheel/trackpad motion on the rail instead of bubbling to the page. */
	private handleStatusRailWheel(event: WheelEvent): void {
		const el = this.statusRailEl;
		const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
		if (maxScroll <= 0) {
			return;
		}
		const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
		if (!delta) {
			return;
		}
		const next = Math.max(0, Math.min(maxScroll, el.scrollLeft + delta));
		if (next === el.scrollLeft) {
			return;
		}
		event.preventDefault();
		el.scrollLeft = next;
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
		const target = stepEl.offsetLeft + (stepEl.offsetWidth / 2) - (rail.clientWidth / 2);
		const left = Math.max(0, Math.min(maxScroll, target));
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
		const isRetry = Boolean(failedPhaseStepIdFromProgress(this.phaseProgressDocument))
			&& action.id === 'run_next_phase';
		for (const child of Array.from(this.statusRailEl.children)) {
			if (child instanceof HTMLElement) {
				child.querySelector('.custom-mode-surface-plan-status-in-flight')?.remove();
			}
		}
		this.statusTrackerEl.classList.remove('phase-in-flight');
		this.statusNextActionButton.classList.remove('hidden');
		this.statusNextActionButton.disabled = this.nextActionInFlight;
		this.statusNextActionButton.textContent = isRetry
			? localize('surfacePlan.retryPhase', 'Retry: {0}', action.label)
			: action.label;
		this.statusNextActionButton.dataset.actionId = action.id;
		this.statusNextActionButton.dataset.stepId = action.stepId;
		this.statusNextActionButton.title = isRetry
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
		if (progress.status === 'completed' && progress.stepId) {
			const alreadyDone = completedStepIdsFromWorkflow(this.workflowDocument).includes(progress.stepId);
			if (!alreadyDone) {
				await this.markStepCompleted(progress.stepId);
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
		if (!options?.workspaceFolder || !options.surfaceId || this.workflowWriteInFlight) {
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

	private async runStatusNextAction(): Promise<void> {
		const actionId = this.statusNextActionButton.dataset.actionId as SurfacePlanWorkflowActionId | undefined;
		const stepId = this.statusNextActionButton.dataset.stepId;
		if (!actionId || !stepId || this.nextActionInFlight || !this.lastOptions) {
			return;
		}
		this.nextActionInFlight = true;
		this.statusNextActionButton.disabled = true;
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
				case 'lock_plan':
					await this.lockPlanAndContinue(stepId);
					break;
				case 'run_next_phase': {
					// Start phase in-flight — Claude writes completed to phase-progress.json.
					const rawLabel = this.statusNextActionButton.textContent?.trim() ?? '';
					const stepLabel = this.lastProposalPhases.find(phase => phase.id === stepId)?.title
						|| rawLabel.replace(/^Retry:\s*/i, '').trim()
						|| stepId;
					await this.writePhaseProgress(createRunningPhaseProgress({
						surfaceId: this.lastOptions.surfaceId,
						stepId,
						stepLabel,
					}));
					this.emitNextAction(actionId, stepId, stepLabel);
					break;
				}
			}
		} finally {
			this.nextActionInFlight = false;
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

	private async markStepCompleted(stepId: string): Promise<void> {
		const options = this.lastOptions;
		if (!options?.workspaceFolder) {
			return;
		}
		const status = resolveSurfacePlanWorkflowStatus({
			...this.workflowSignals(),
			// Completing this step — ignore in-flight for the merge snapshot.
			phaseInFlightStepId: undefined,
			failedPhaseStepId: undefined,
			completedStepIds: [...completedStepIdsFromWorkflow(this.workflowDocument), stepId],
		});
		const merged = mergeWorkflowSteps(options.surfaceId, status.steps, this.workflowDocument);
		const now = new Date().toISOString();
		this.workflowDocument = {
			...merged,
			steps: merged.steps.map(step =>
				step.id === stepId
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
		this.lastTreeDocument = options;
		this.treeView.setDocument(options);
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore, type IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { isMacintosh, isWeb, isWindows } from '../../../../base/common/platform.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { basename, isEqualOrParent, joinPath, resolvePath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IContextKeyService, type IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, type ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { DevServerState, DevServerSuggestedCommands, IDevServerService } from '../../../../../custom/devserver/DevServerService.js';
import { collectUniqueSurfacePorts, freeSurfacePorts, killProcessListeningOnPort, parsePortFromLocalUrl } from '../../../../../custom/devserver/surfaceDevPortUtils.js';
import { IDefaultProjectService } from '../../../../../custom/devserver/DefaultProjectService.js';
import { IModeService, Mode } from '../../../../../custom/mode/ModeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { createUiClickOverlayScript, UiClickOverlayMessage } from './uiClickOverlayScript.js';
import { IChatService, type IChatModelReference } from '../../chat/common/chatService/chatService.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ChatWidget } from '../../chat/browser/widget/chatWidget.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import type { IChatRequestFileEntry } from '../../chat/common/attachments/chatVariableEntries.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { editorBackground, editorForeground, inputBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { EDITOR_DRAG_AND_DROP_BACKGROUND } from '../../../common/theme.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ModeShellChatSessionManager } from './modeShellChatSessions.js';
import { IIxIntegrationService, type IxIntegrationState, type IxPipelineStepSnapshot, type IxPipelineStepStatus } from '../../../../../custom/ix/IxIntegrationService.js';
import { DOCKER_DESKTOP_URL, DockerAvailabilityStatus, IDockerAvailabilityService } from '../../../../../custom/docker/DockerAvailabilityService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { ProcessNotesCytoscapeView, type ProcessNotesGraphWebviewMessage } from './processNotesCytoscapeView.js';
import type { ProcessNoteGraph, ProcessNoteId, ProcessNotesFile } from './processNotesTypes.js';
import type { ProcessNoteSuggestion } from './processNotesTypes.js';
import { ProcessNotesStore } from './processNotesStore.js';
import {
	RECIPE_CUSTOM_PROMPT,
	mergeProcessNoteTopicIds,
	resolveProcessTopicLabel,
	stableCustomNoteId,
} from './processTopics.js';
import { buildCustomPromptEvidencePack, type ProcessNotesGenerationProgressEvent } from './processNotesCustomEvidence.js';
import { formatSavedProcessNoteMarkdown, ixCommandLabelsFromEvidenceRaw } from './processNotesProvenance.js';
import type { ProcessNotesSynthesisResult } from './processNotesSynthesis.js';
import { synthesizeCustomPromptNote } from './processNotesSynthesis.js';
// Suggested "system processes" are derived directly from ix subsystems output.
import { resolveIxEvidenceWorkspaceFolderUri } from './processNotesIxFolder.js';
import {
	formatIxDiscoveryFailureHint,
	formatIxSubsystemsDetailedDiscoveryCommand,
	LOW_CONFIDENCE_THRESHOLD,
	buildSubsystemDetailGraph,
	formatSubsystemPathEdge,
	parseSubsystemFingerprints,
	runSubsystemsDetailedDiscovery,
	type SubsystemFingerprint,
} from './processNotesSubsystemSnapshot.js';
import { IStartupGuideService } from '../../../../../custom/startup/StartupGuideService.js';
import { IAppLaunchGuideService } from '../../../../../custom/appLaunch/AppLaunchGuideService.js';
import { SetupGuidePanel } from './setupGuidePanel.js';
import { IConsoleService, type WorkspaceSurface } from '../../../../../custom/goalWorkspace/ConsoleService.js';
import {
	brandFolderResource,
	deleteGoalWorkspaceSurface,
	hasBrandConfigured,
	inferSurfaceSetupStep,
	loadSurfaceSetupDraft,
	saveGoalWorkspaceBuilderFields,
	saveSurfaceSetupDraft,
	type SurfaceSetupStep,
} from '../../../../../custom/goalWorkspace/goalWorkspaceSurfaceSetup.js';
import { SurfaceBuilderHandoffState, type SurfaceBuilderHandoffStateValue } from '../../../../../custom/goalWorkspace/surfaceBuilderHandoffState.js';
import { blueprintResource, readBlueprint } from '../../../../../custom/goalWorkspace/surfaceBlueprintService.js';
import { verifySurfaceBlueprint } from '../../../../../custom/goalWorkspace/surfaceBlueprintVerify.js';
import { SurfaceCreationLangGraphOrchestrator } from '../../../../../custom/goalWorkspace/surfaceCreationLangGraphOrchestrator.js';
import { getSurfaceHandoffGuidance, type SurfaceHandoffPhase } from '../../../../../custom/goalWorkspace/surfaceHandoffPrompt.js';
import { MAX_SURFACE_BLUEPRINT_REPAIR_ATTEMPTS, SurfaceBlueprintOrchestrator } from '../../../../../custom/goalWorkspace/surfaceBlueprintOrchestrator.js';
import { ISurfaceFeatureChecklistService } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistService.js';
import { IWorkflowCatalogService, upsertWorkflowSpec, workflowCatalogResource } from '../../../../../custom/goalWorkspace/workflowCatalogService.js';
import { IWorkflowRunnerService } from '../../../../../custom/goalWorkspace/workflowRunnerService.js';
import { discoverIxSubsystemRegions } from '../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import { ICustomAiChatTraceService } from '../../../../../custom/ai/browser/customAiChatTrace.js';
import { SurfaceFeatureChecklistPanel } from './surfaceFeatureChecklistPanel.js';
import type { WorkflowSpec, WorkflowStep } from '../../../../../custom/goalWorkspace/workflowCatalogTypes.js';

const STORAGE_PROCESS_CHAT_DISMISSED = 'modeShell.processChatDismissed';
const STORAGE_UI_CHAT_DISMISSED = 'modeShell.uiChatDismissed';
const STORAGE_CONTEXT_GATHERING_OPEN = 'modeShell.contextGatheringOpen';
const STORAGE_SELECTED_GOAL_SURFACE = 'modeShell.selectedGoalSurface';
const STORAGE_ACTIVE_UI_CHAT_SURFACE = 'modeShell.activeUiChatSurface';
const ADD_SURFACE_ID = '__add_surface__';

export async function runSurfaceWorkflowFromModeShell(surfaceId?: string): Promise<boolean> {
	const instance = ModeShellContribution.getActiveInstance();
	if (!instance) {
		return false;
	}
	await instance.playSelectedSurfaceWorkflow(surfaceId);
	return true;
}

function slugifySurfaceId(value: string): string {
	return value.trim().toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		|| 'custom-surface';
}

interface StarterSurface {
	readonly id: string;
	readonly name: string;
	readonly workflow: string;
	readonly summary: string;
	readonly highlights: readonly string[];
	readonly icon: ThemeIcon;
}

const STARTER_SURFACES: readonly StarterSurface[] = [
	{
		id: 'marketing',
		name: 'Marketing Site',
		workflow: 'public acquisition, offers, lead capture, and conversion tracking',
		summary: 'Convert visitors into leads with offers, social proof, and clear calls to action.',
		highlights: ['Hero and offer pages', 'Lead capture forms', 'SEO-ready landing routes'],
		icon: Codicon.megaphone,
	},
	{
		id: 'booking',
		name: 'Booking',
		workflow: 'package selection, scheduling, payments, and customer intake',
		summary: 'Let prospects pick packages, schedule sessions, and pay without leaving your funnel.',
		highlights: ['Package selection', 'Calendar scheduling', 'Checkout and intake forms'],
		icon: Codicon.calendar,
	},
	{
		id: 'client-portal',
		name: 'Client Portal',
		workflow: 'client communication, plans, progress, and account access',
		summary: 'Give clients a home for plans, progress, messages, and account management.',
		highlights: ['Session plans and notes', 'Progress tracking', 'Secure account access'],
		icon: Codicon.person,
	},
	{
		id: 'trainer-admin',
		name: 'Trainer Admin',
		workflow: 'coach operations, client management, sessions, and follow-ups',
		summary: 'Run day-to-day coaching operations—clients, sessions, follow-ups, and team workflows.',
		highlights: ['Client roster', 'Session management', 'Coach dashboards'],
		icon: Codicon.organization,
	},
	{
		id: 'analytics',
		name: 'Analytics',
		workflow: 'conversion funnels, retention, revenue, and north-star reporting',
		summary: 'Track conversion, retention, revenue, and the metrics that matter for growth.',
		highlights: ['Funnel dashboards', 'Revenue reporting', 'North-star KPI views'],
		icon: Codicon.graphLine,
	},
	{
		id: 'content-scheduler',
		name: 'Content Scheduler',
		workflow: 'social posts, campaigns, publishing cadence, and performance review',
		summary: 'Plan campaigns, schedule posts, and review what is working across channels.',
		highlights: ['Editorial calendar', 'Campaign planning', 'Post performance review'],
		icon: Codicon.note,
	},
	{
		id: 'ads-manager',
		name: 'Ads Manager',
		workflow: 'campaign setup, audience targeting, creative testing, and spend analysis',
		summary: 'Launch ad campaigns, test creatives, and monitor spend against conversions.',
		highlights: ['Campaign setup', 'Audience targeting', 'Spend and ROAS tracking'],
		icon: Codicon.rocket,
	},
	{
		id: 'subscriptions',
		name: 'Subscriptions',
		workflow: 'plans, billing status, cancellations, and lifecycle events',
		summary: 'Manage plans, billing status, renewals, and cancellation workflows in one place.',
		highlights: ['Plan management', 'Billing status', 'Lifecycle events'],
		icon: Codicon.creditCard,
	},
];

const ADD_SURFACE_STARTER: StarterSurface = {
	id: 'new-surface',
	name: 'New Surface',
	workflow: 'a custom customer-facing workflow you describe',
	summary: 'Start from scratch with a surface tailored to your business.',
	highlights: ['Name the app you need', 'Describe the workflow', 'Let the agent scaffold it'],
	icon: Codicon.add,
};

/**
 * Stringify the shape of an ix JSON response for diagnostic logging when discovery
 * yields zero cards. We only want enough to identify the wrapper key and the field
 * names on the first element, not the entire (potentially huge) payload.
 */
function describeIxDiscoveryShape(value: unknown): string {
	if (value === null || value === undefined) {
		return `[shape] value=${value}`;
	}
	if (Array.isArray(value)) {
		const first = value[0];
		const firstKeys = first && typeof first === 'object' ? Object.keys(first).slice(0, 12).join(', ') : typeof first;
		return `[shape] top=array len=${value.length} first.keys=[${firstKeys}]`;
	}
	if (typeof value !== 'object') {
		return `[shape] top=${typeof value}`;
	}
	const obj = value as Record<string, unknown>;
	const entries = Object.entries(obj).slice(0, 10).map(([k, v]) => {
		if (Array.isArray(v)) {
			const first = v[0];
			const firstKeys = first && typeof first === 'object' ? Object.keys(first).slice(0, 8).join(', ') : typeof first;
			return `${k}: array(len=${v.length}, first.keys=[${firstKeys}])`;
		}
		if (v === null) {
			return `${k}: null`;
		}
		if (typeof v === 'object') {
			return `${k}: object(keys=[${Object.keys(v as object).slice(0, 6).join(', ')}])`;
		}
		return `${k}: ${typeof v}`;
	});
	return `[shape] top=object entries={ ${entries.join(' | ')} }`;
}

class ModeShellContribution extends Disposable {

	static readonly ID = 'workbench.contrib.modeShell';
	private static activeInstance: ModeShellContribution | undefined;
	static getActiveInstance(): ModeShellContribution | undefined {
		return ModeShellContribution.activeInstance;
	}

	private static readonly MODES: readonly Mode[] = ['Code'];

	private readonly container: HTMLElement;
	private readonly topModeButtons = new Map<Mode, HTMLButtonElement>();
	private readonly modeTopBar: HTMLElement;
	private readonly uiProjectName: HTMLElement;
	private readonly modeSurface: HTMLElement;
	private readonly uiContainer: HTMLElement;
	private readonly processContainer: HTMLElement;
	private readonly processMainColumn: HTMLElement;
	private readonly processMainContent: HTMLElement;
	private readonly processChatColumn: HTMLElement;
	private readonly processChatReopenBtn: HTMLButtonElement;
	private readonly uiMainColumn: HTMLElement;
	private readonly uiFeatureChecklistColumn: HTMLElement;
	private readonly uiChatColumn: HTMLElement;
	private readonly uiChatTitleEl: HTMLElement;
	private readonly uiChatTabSwitcher: HTMLElement;
	private readonly uiChatTabButtons = new Map<string, HTMLButtonElement>();
	private activeUiChatSurfaceId: string | undefined;
	private readonly uiChatReopenBtn: HTMLButtonElement;
	private readonly styleSheet = createStyleSheet();
	private readonly uiBrowser: HTMLElement & { src: string };
	private readonly uiBrowserShell: HTMLElement;
	private readonly uiCallout: HTMLElement;
	private readonly uiLandingBackdrop: HTMLElement;
	private readonly processCallout: HTMLElement;
	private readonly processStartHints: HTMLElement;
	private readonly uiSetup: HTMLElement;
	private readonly processSetup: HTMLElement;
	private readonly uiSelectionPill: HTMLElement;
	private readonly uiSelectionCountEl: HTMLElement;
	private readonly uiSelectionClearBtn: HTMLButtonElement;
	private uiSelectionCount = 0;
	private readonly uiStartAppButton: HTMLButtonElement;
	private uiStartAllSurfacesButton!: HTMLButtonElement;
	private readonly uiStartSubtitle: HTMLElement;
	private readonly uiStartStatus: HTMLElement;
	private readonly uiRuntimeText: HTMLElement;
	private readonly uiSurfaceSwitcher: HTMLElement;
	private readonly uiSurfaceLaunchPanel: HTMLElement;
	private readonly uiSurfaceSetupDashboard: HTMLElement;
	private uiSurfaceSetupGoalNameInput!: HTMLInputElement;
	private uiSurfaceSetupGoalDescriptionInput!: HTMLTextAreaElement;
	private uiSurfaceSetupPrimaryColorInput!: HTMLInputElement;
	private uiSurfaceSetupSecondaryColorInput!: HTMLInputElement;
	private uiSurfaceSetupAccentColorInput!: HTMLInputElement;
	private uiSurfaceSetupLogoDropzone!: HTMLElement;
	private uiSurfaceSetupLogoMarkDropzone!: HTMLElement;
	private uiSurfaceSetupLogoPreview!: HTMLImageElement;
	private uiSurfaceSetupLogoMarkPreview!: HTMLImageElement;
	private uiSurfaceSetupInner!: HTMLElement;
	private uiSurfaceSetupMain!: HTMLElement;
	private uiSurfaceScaffoldView!: HTMLElement;
	private uiSurfaceScaffoldTitle!: HTMLElement;
	private uiSurfaceScaffoldTextarea!: HTMLTextAreaElement;
	private uiSurfaceScaffoldScaffoldButton!: HTMLButtonElement;
	private uiSurfaceScaffoldCancelButton!: HTMLButtonElement;
	private readonly uiSurfaceSetupSections = new Map<SurfaceSetupStep, HTMLElement>();
	private surfaceSetupBrandLogoPath: string | undefined;
	private surfaceSetupBrandLogoMarkPath: string | undefined;
	private surfaceSetupCurrentStep: SurfaceSetupStep = 'goal';
	private surfaceSetupDraftDirty = false;
	private surfaceSetupHydrating = false;
	private readonly surfaceSetupAutosaveScheduler = this._register(new RunOnceScheduler(() => void this.autosaveSurfaceSetupBuilder(), 600));
	private contextGatheringOpen = true;
	private readonly uiSurfaceEmptyState: HTMLElement;
	private readonly uiSurfaceEmptyTitle: HTMLElement;
	private readonly uiSurfaceEmptySubtitle: HTMLElement;
	private readonly uiSurfaceButtons = new Map<string, HTMLButtonElement>();
	private readonly starterSurfaceCardMeta = new Map<string, { card: HTMLElement; status: HTMLElement; preview: HTMLElement }>();
	private selectedSurfaceId: string | undefined;
	private lastSurfaceRoutingLogKey: string | undefined;
	private lastUiStartHints: DevServerSuggestedCommands | undefined;
	private autoStartAppAttempted = false;
	private surfacePortsFreedAtStartup = false;
	private startAllSurfacesInProgress = false;
	private readonly startedSurfaceServers = new Set<string>();
	private readonly startingSurfaceServers = new Set<string>();
	private starterSurfaceStatusRefreshId = 0;
	private readonly uiRuntimeLogs: string[] = [];
	private readonly uiClickOverlayScript = createUiClickOverlayScript();
	private readonly startHintActionDisposables = this._register(new DisposableStore());
	private readonly surfaceLaunchActionDisposables = this._register(new DisposableStore());
	private reachabilityUrl: string | undefined;
	private appReachable = false;
	private readonly uiDevServerProbeScheduler = this._register(new RunOnceScheduler(() => this.scheduleEmbeddedUiDevServerProbe(), 2500));
	private readonly chatSessionsCts = this._register(new CancellationTokenSource());
	private readonly chatSessionManager: ModeShellChatSessionManager;
	private readonly embeddedChatRefs = {
		UI: this._register(new MutableDisposable<IChatModelReference>()),
		Process: this._register(new MutableDisposable<IChatModelReference>()),
	};
	private readonly uiChatContainer: HTMLElement;
	private readonly processChatContainer: HTMLElement;
	private readonly uiChatWidget: ChatWidget;
	private readonly processChatWidget: ChatWidget;
	private readonly processIxWebHint: HTMLElement;
	private readonly processDockerBanner: HTMLElement;
	private readonly processDockerBannerText: HTMLElement;
	private readonly processNotesPanel: HTMLElement;
	private readonly processNotesGraphAnchor: HTMLElement;
	private readonly processNotesGraphView: ProcessNotesCytoscapeView;
	private readonly processNotesStore: ProcessNotesStore;
	private readonly processNotesTopicSelect: HTMLSelectElement;
	private readonly processNotesGenerateButton: HTMLButtonElement;
	private readonly processNotesBackButton: HTMLButtonElement;
	private readonly processNotesDeleteButton: HTMLButtonElement;
	private readonly processNotesExpandedChrome: HTMLElement;
	private readonly processNotesExpandedActions: HTMLElement;
	private readonly processNotesLogs: HTMLElement;
	private readonly processNotesDetail: HTMLElement;
	private readonly processNotesMarkdown: HTMLElement;
	private readonly processNotesCards: HTMLElement;
	private processNotesSuggestions: readonly ProcessNoteSuggestion[] = [];
	private processNotesSuggestionsLoadLog: string[] = [];
	private processNotesGenerateLog: string[] = [];
	private processNotesGraphLayer: 'overview' | 'detail' = 'overview';
	private processNotesMergedTopicIds: ProcessNoteId[] = mergeProcessNoteTopicIds(undefined);
	// Saved notes list is removed; keep latest file only if needed later.
	private readonly workspaceStepsHideButton: HTMLButtonElement;
	private workspaceStepsHidden = false;
	private readonly processIxPipeline: HTMLElement;
	private readonly processIxPipelineGlobalRow: HTMLElement;
	private readonly processIxPipelineWorkspaceRows: HTMLElement;
	private readonly ixPipelineOpenOutput = new Set<string>();
	private readonly ixPipelineOutputScrollTops = new Map<string, number>();
	private readonly ixPipelineStepNodes = new Map<string, {
		readonly wrap: HTMLElement;
		readonly statusEl: HTMLElement;
		readonly labelEl: HTMLElement;
		readonly durEl: HTMLElement;
		cmdEl: HTMLElement | undefined;
		errEl: HTMLElement | undefined;
		readonly details: HTMLDetailsElement;
		readonly pre: HTMLElement;
		currentStatus: IxPipelineStepStatus;
	}>();
	private lastIxPipelineState: IxIntegrationState | undefined;
	private readonly ixPipelineDurationTicker = this._register(new MutableDisposable<IDisposable>());
	private readonly startupGuidePanel: SetupGuidePanel;
	private readonly appLaunchGuidePanel: SetupGuidePanel;
	private tabGuideAutoRunAttempted = false;

	private _processChatDismissed = false;
	private _uiChatDismissed = false;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IModeService private readonly modeService: IModeService,
		@IDevServerService private readonly devServerService: IDevServerService,
		@IDefaultProjectService private readonly defaultProjectService: IDefaultProjectService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@INotificationService private readonly notificationService: INotificationService,
		@IChatService private readonly chatService: IChatService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@INativeEnvironmentService private readonly nativeEnvironmentService: INativeEnvironmentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IIxIntegrationService private readonly ixIntegrationService: IIxIntegrationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDockerAvailabilityService private readonly dockerAvailabilityService: IDockerAvailabilityService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IStartupGuideService private readonly startupGuideService: IStartupGuideService,
		@IAppLaunchGuideService private readonly appLaunchGuideService: IAppLaunchGuideService,
		@IConsoleService private readonly consoleService: IConsoleService,
		@ISurfaceFeatureChecklistService private readonly surfaceFeatureChecklistService: ISurfaceFeatureChecklistService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkflowCatalogService private readonly workflowCatalogService: IWorkflowCatalogService,
		@IWorkflowRunnerService private readonly workflowRunnerService: IWorkflowRunnerService,
		@ICustomAiChatTraceService private readonly customAiChatTraceService: ICustomAiChatTraceService,
	) {
		super();
		ModeShellContribution.activeInstance = this;
		this._register(toDisposable(() => {
			if (ModeShellContribution.activeInstance === this) {
				ModeShellContribution.activeInstance = undefined;
			}
		}));

		this._processChatDismissed = this.storageService.get(STORAGE_PROCESS_CHAT_DISMISSED, StorageScope.PROFILE) === '1';
		this._uiChatDismissed = this.storageService.get(STORAGE_UI_CHAT_DISMISSED, StorageScope.PROFILE) === '1';
		this.contextGatheringOpen = this.storageService.get(STORAGE_CONTEXT_GATHERING_OPEN, StorageScope.PROFILE) !== '0';
		this.activeUiChatSurfaceId = this.storageService.get(STORAGE_ACTIVE_UI_CHAT_SURFACE, StorageScope.WORKSPACE);

		this.chatSessionManager = new ModeShellChatSessionManager(this.chatService, this.chatWidgetService, this.storageService);
		this.processNotesStore = this._register(new ProcessNotesStore(this.fileService, this.workspaceContextService, this.configurationService));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('custom.ix.preferredWorkspaceFolder')) {
				void this.loadProcessNotesSuggestions();
			}
		}));

		this.container = this.layoutService.getContainer(mainWindow);
		this.container.classList.add('custom-mode-shell-enabled');
		if (isWeb) {
			this.container.classList.add('custom-mode-web');
		}
		this.styleSheet.textContent = `
			.monaco-workbench.custom-mode-shell-enabled {
				--custom-mode-shell-height: 34px;
				--custom-mode-shell-bottom-inset: 0px;
			}

			.monaco-workbench.custom-mode-shell-enabled.border.mac {
				/*
				 * macOS windows have rounded corners and the workbench root clips
				 * ('overflow: hidden'). Without a small bottom inset, bottom-aligned
				 * UI (like the chat composer) can be visually cut off.
				 */
				--custom-mode-shell-bottom-inset: 10px;
			}

			.monaco-workbench.custom-mode-shell-enabled.border.mac.macos-tahoe {
				--custom-mode-shell-bottom-inset: 16px;
			}

			/*
			 * The shell bar is position:absolute (out of flow). The grid defaults to
			 * position:relative; height:100%, so only setting top shifts it down but
			 * keeps full viewport height — the bottom (status bar, panel) clips off.
			 * Pin the grid between the shell strip and the bottom inset instead.
			 */
			.monaco-workbench.custom-mode-shell-enabled > .monaco-grid-view {
				position: absolute;
				left: 0;
				right: 0;
				top: var(--custom-mode-shell-height);
				bottom: var(--custom-mode-shell-bottom-inset);
				width: auto;
				height: auto;
				overflow: hidden;
			}

			/*
			 * Code mode: clip editor content (e.g. Welcome page) so absolutely positioned
			 * slides cannot paint over a side/bottom panel terminal.
			 *
			 * The startup welcome/editor overlays can be attached higher than .part.editor > .content
			 * during first paint, so clip both the editor part and its content wrapper.
			 */
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .part.editor,
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .part.editor > .content {
				overflow: hidden;
			}

			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .custom-mode-surface {
				display: none !important;
				visibility: hidden;
				pointer-events: none;
			}

			/* Electron <webview> layers can outlive a hidden mode surface; suppress in Code mode. */
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .custom-mode-ui-webview,
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .custom-mode-ui-frame {
				visibility: hidden;
				pointer-events: none;
			}

			/* Tab setup guides are HTML overlays; native <webview> would paint over them otherwise. */
			.monaco-workbench .custom-mode-ui-container.custom-mode-setup-guide-open .custom-mode-ui-webview,
			.monaco-workbench .custom-mode-ui-container.custom-mode-setup-guide-open .custom-mode-ui-frame {
				visibility: hidden !important;
				display: none !important;
				pointer-events: none !important;
			}

			.monaco-workbench.custom-mode-shell-enabled > .custom-mode-top-modes {
				position: absolute;
				top: 0;
				left: 0;
				right: 0;
				height: var(--custom-mode-shell-height);
				/* Stay below the quick input widget (z-index 2550) so the command palette / Go to File search input is not obscured by the mode tabs when opened on top of the editor. */
				z-index: 2500;
				display: flex;
				flex-direction: row;
				align-items: center;
				justify-content: flex-start;
				gap: 8px;
				padding: 0 12px;
				box-sizing: border-box;
				border-bottom: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
				-webkit-app-region: no-drag;
			}

			/* Native macOS traffic lights sit in the top-left corner and overlay our shell bar. */
			.monaco-workbench.custom-mode-shell-enabled.mac:not(.fullscreen) > .custom-mode-top-modes,
			.monaco-workbench.custom-mode-shell-enabled > .custom-mode-top-modes.mac-native:not(.custom-mode-top-modes-fullscreen) {
				padding-left: 96px;
			}

			.monaco-workbench.custom-mode-shell-enabled.mac.macos-tahoe:not(.fullscreen) > .custom-mode-top-modes,
			.monaco-workbench.custom-mode-shell-enabled > .custom-mode-top-modes.mac-native.macos-tahoe:not(.custom-mode-top-modes-fullscreen) {
				padding-left: 104px;
			}

			/*
			 * The quick input widget (Cmd+P, command palette, etc.) is positioned absolutely against
			 * the workbench root with an inline 'top' equal to the title bar offset. That offset does
			 * not know about our mode tab bar, so the input would land underneath the UI/Process/Code
			 * tabs. Nudge it down by the mode shell height with a transform so we don't fight the
			 * inline 'top' the quick input controller writes on every layout.
			 */
			.monaco-workbench.custom-mode-shell-enabled .quick-input-widget {
				transform: translateY(var(--custom-mode-shell-height));
			}

			.monaco-workbench .custom-mode-top-modes .custom-mode-top-tab {
				height: 26px;
				padding: 0 12px;
				border: 0;
				border-bottom: 2px solid transparent;
				border-radius: 4px 4px 0 0;
				background: transparent;
				color: var(--vscode-tab-inactiveForeground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				line-height: 1.2;
			}

			.monaco-workbench .custom-mode-top-modes .custom-mode-top-tab:hover {
				color: var(--vscode-tab-activeForeground);
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-top-modes .custom-mode-top-tab.active {
				color: var(--vscode-tab-activeForeground);
				border-bottom-color: var(--vscode-tab-activeBorder, var(--vscode-focusBorder));
				background-color: var(--vscode-tab-activeBackground, transparent);
			}

			.monaco-workbench .custom-mode-top-modes .custom-mode-top-spacer {
				flex: 1 1 auto;
				min-width: 8px;
			}

			.monaco-workbench .custom-mode-ui-project-name {
				flex: 0 0 auto;
				max-width: min(240px, 28vw);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				line-height: 1;
				padding: 2px 6px;
				margin: 0 0 0 12px;
				border: 0;
				border-radius: 4px;
				background: transparent;
				cursor: pointer;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench .custom-mode-ui-project-name:hover {
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-project-name.active {
				color: var(--vscode-textLink-foreground);
				background-color: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-project-name.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface {
				position: absolute;
				top: var(--custom-mode-shell-height);
				right: 0;
				bottom: var(--custom-mode-shell-bottom-inset);
				left: 0;
				z-index: 1500;
				display: none;
				background-color: var(--vscode-editorBackground);
			}

			.monaco-workbench.custom-mode-ui .custom-mode-surface,
			.monaco-workbench.custom-mode-process .custom-mode-surface {
				display: flex;
				flex-direction: column;
				align-items: stretch;
				justify-content: flex-start;
			}

			.monaco-workbench.custom-mode-ui > .monaco-grid-view,
			.monaco-workbench.custom-mode-process > .monaco-grid-view {
				display: none;
			}

			.monaco-workbench .custom-mode-placeholder {
				color: var(--vscode-descriptionForeground);
				font-size: 13px;
			}

			.monaco-workbench .custom-mode-ui-container,
			.monaco-workbench .custom-mode-process-container {
				display: none;
				flex: 1;
				min-width: 0;
				min-height: 0;
			}

			/*
			 * Visible containers still matched the rule above with flex: 1, so they grew to the full mode surface.
			 * Preview is capped (~42vh) and the chat strip is short — the leftover flex space read as a giant "AI chat" slab.
			 */
			.monaco-workbench .custom-mode-ui-container.visible {
				display: flex;
				flex-direction: row;
				flex: 1 1 auto !important;
				height: 100% !important;
				min-height: 0 !important;
				align-self: stretch;
				align-items: stretch;
				justify-content: flex-start;
				position: relative;
			}

			.monaco-workbench .custom-mode-ui-main {
				display: flex;
				flex-direction: column;
				flex: 1 1 0;
				min-width: 0;
				min-height: 0;
				overflow: auto;
				position: relative;
			}

			.monaco-workbench .custom-mode-ui-feature-checklist-column {
				display: flex;
				flex-direction: column;
				flex: 0 0 min(280px, 30vw);
				width: min(280px, 30vw);
				min-width: 220px;
				max-width: 320px;
				min-height: 0;
				border-right: 1px solid var(--vscode-panel-border);
				background: var(--vscode-sideBar-background);
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-feature-checklist-column.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				padding: 10px 10px 12px;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-header {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 8px;
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-title {
				font-size: 12px;
				font-weight: 650;
				color: var(--vscode-foreground);
				line-height: 1.3;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-subtitle {
				margin-top: 2px;
				font-size: 11px;
				line-height: 1.35;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-header-actions {
				display: flex;
				align-items: center;
				gap: 4px;
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-header-actions button {
				height: 22px;
				padding: 0 6px;
				border-radius: 4px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				font-size: 11px;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-header-actions button:hover {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-summary {
				flex-shrink: 0;
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-list {
				display: flex;
				flex-direction: column;
				gap: 10px;
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-ui-feature-checklist-column.custom-mode-surface-feature-checklist-collapsed .custom-mode-surface-feature-checklist-list,
			.monaco-workbench .custom-mode-ui-feature-checklist-column.custom-mode-surface-feature-checklist-collapsed .custom-mode-surface-feature-checklist-summary,
			.monaco-workbench .custom-mode-ui-feature-checklist-column.custom-mode-surface-feature-checklist-collapsed .custom-mode-surface-feature-checklist-subtitle {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-section-title {
				font-size: 10px;
				font-weight: 650;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 4px;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item {
				display: flex;
				align-items: flex-start;
				gap: 6px;
				padding: 5px 6px;
				border-radius: 4px;
				border: 1px solid transparent;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item:hover {
				background: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-glyph {
				flex: 0 0 auto;
				width: 14px;
				text-align: center;
				font-size: 11px;
				line-height: 1.35;
				font-weight: 700;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-text {
				min-width: 0;
				display: flex;
				flex-direction: column;
				gap: 1px;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-label {
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-foreground);
				line-height: 1.3;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-detail {
				font-size: 10px;
				line-height: 1.35;
				color: var(--vscode-descriptionForeground);
				word-break: break-word;
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-success .custom-mode-surface-feature-checklist-glyph {
				color: var(--vscode-testing-iconPassed, #73c991);
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-error .custom-mode-surface-feature-checklist-glyph {
				color: var(--vscode-errorForeground, #f48771);
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-warning .custom-mode-surface-feature-checklist-glyph {
				color: var(--vscode-editorWarning-foreground, #cca700);
			}

			.monaco-workbench .custom-mode-surface-feature-checklist-item-running .custom-mode-surface-feature-checklist-glyph {
				color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
			}

			.monaco-workbench .custom-mode-ui-landing-backdrop {
				display: none;
				position: absolute;
				inset: 0;
				z-index: 2100;
				background-color: rgba(0, 0, 0, 0.45);
			}

			.monaco-workbench.custom-mode-ui-landing-open .custom-mode-ui-landing-backdrop {
				display: block;
			}

			.monaco-workbench.custom-mode-ui-landing-open.custom-mode-shell-hasProject .custom-mode-callout {
				display: flex;
				z-index: 2200;
			}

			.monaco-workbench .custom-mode-ui-chat-column {
				display: flex;
				flex-direction: column;
				flex: 0 0 min(400px, 38vw);
				width: min(400px, 38vw);
				max-width: min(440px, 42vw);
				min-width: 280px;
				min-height: 0;
				border-left: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-editorBackground);
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-chat-dismissed .custom-mode-ui-chat-column {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-chat-header {
				display: flex;
				flex-direction: column;
				flex: 0 0 auto;
				gap: 0;
				border-bottom: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
				font-size: 12px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-chat-header-top {
				display: flex;
				flex-direction: row;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				padding: 6px 8px 4px 10px;
			}

			.monaco-workbench .custom-mode-ui-chat-tab-switcher {
				display: flex;
				flex-direction: row;
				align-items: center;
				flex: 0 0 auto;
				gap: 2px;
				padding: 0 6px 4px;
				overflow-x: auto;
				overflow-y: hidden;
			}

			.monaco-workbench .custom-mode-ui-chat-tab-button {
				flex: 0 0 auto;
				height: 24px;
				max-width: 140px;
				padding: 0 8px;
				border-radius: 4px;
				border: 0;
				border-bottom: 2px solid transparent;
				background: transparent;
				color: var(--vscode-tab-inactiveForeground);
				cursor: pointer;
				font-size: 11px;
				font-weight: 600;
				line-height: 1.2;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-chat-tab-button:hover {
				color: var(--vscode-tab-activeForeground);
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-chat-tab-button.active {
				border-bottom-color: var(--vscode-tab-activeBorder, var(--vscode-focusBorder));
				background: var(--vscode-tab-activeBackground, transparent);
				color: var(--vscode-tab-activeForeground);
			}

			.monaco-workbench .custom-mode-ui-chat-header button {
				background: transparent;
				border: none;
				color: var(--vscode-foreground);
				cursor: pointer;
				padding: 2px 6px;
				border-radius: 3px;
				font-size: 16px;
				line-height: 1;
			}

			.monaco-workbench .custom-mode-ui-chat-header button:hover {
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-chat-reopen {
				display: none;
				position: absolute;
				right: 0;
				top: 50%;
				transform: translateY(-50%);
				z-index: 25;
				align-items: center;
				justify-content: center;
				writing-mode: vertical-rl;
				text-orientation: mixed;
				padding: 12px 6px;
				border: 1px solid var(--vscode-panel-border);
				border-right: none;
				border-radius: 6px 0 0 6px;
				background-color: var(--vscode-sideBar-background);
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				box-shadow: -2px 0 8px rgba(0, 0, 0, 0.2);
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-chat-dismissed.visible .custom-mode-ui-chat-reopen {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-chat-column .custom-mode-embedded-chat.custom-mode-ui-side-chat.visible {
				display: flex !important;
				flex-direction: column !important;
				flex: 1 1 auto !important;
				flex-grow: 1 !important;
				min-height: 0 !important;
				height: auto !important;
				max-height: none !important;
				width: 100%;
				border-top: none;
				padding: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-chat-column .custom-mode-ui-side-chat.visible .interactive-session {
				flex: 1 1 auto !important;
				min-height: 0 !important;
				max-height: none !important;
				height: auto !important;
				max-width: none !important;
				width: 100% !important;
				margin: 0 !important;
			}

			.monaco-workbench .custom-mode-ui-chat-column .custom-mode-ui-side-chat.visible .interactive-list {
				flex: 1 1 auto !important;
				min-height: 0 !important;
				max-height: none !important;
				overflow: auto !important;
			}

			/* Lock side-panel chat input back to the standard "editor on top, toolbar below"
			 * stacking. Compact inputs use display:flex on .chat-input-container which can
			 * leak in via cached styles or hot-reload state and squeeze the editor onto the
			 * same row as the toolbar; force block + column flex to defend against that. */
			.monaco-workbench .custom-mode-ui-side-chat .interactive-input-part:not(.compact) .chat-input-container,
			.monaco-workbench .custom-mode-process-side-chat .interactive-input-part:not(.compact) .chat-input-container {
				display: flex !important;
				flex-direction: column !important;
				justify-content: flex-start !important;
				align-items: stretch !important;
			}
			.monaco-workbench .custom-mode-ui-side-chat .interactive-input-part:not(.compact) .chat-editor-container,
			.monaco-workbench .custom-mode-process-side-chat .interactive-input-part:not(.compact) .chat-editor-container {
				width: 100% !important;
				min-width: 0 !important;
				flex: 0 0 auto !important;
			}
			.monaco-workbench .custom-mode-ui-side-chat .interactive-input-part:not(.compact) .chat-input-toolbars,
			.monaco-workbench .custom-mode-process-side-chat .interactive-input-part:not(.compact) .chat-input-toolbars {
				width: 100% !important;
				flex: 0 0 auto !important;
			}

			.monaco-workbench .custom-mode-process-container.visible {
				display: flex;
				flex-direction: row;
				flex: 1 1 auto !important;
				height: 100% !important;
				min-height: 0 !important;
				align-self: stretch;
				align-items: stretch;
				justify-content: flex-start;
				position: relative;
			}

			.monaco-workbench .custom-mode-process-main {
				display: flex;
				flex-direction: column;
				flex: 1 1 0;
				min-width: 0;
				min-height: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-process-main-content {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-process-chat-column {
				display: flex;
				flex-direction: column;
				flex: 0 0 min(400px, 38vw);
				width: min(400px, 38vw);
				max-width: min(440px, 42vw);
				min-width: 280px;
				min-height: 0;
				border-left: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-editorBackground);
			}

			.monaco-workbench .custom-mode-process-container.custom-mode-process-chat-dismissed .custom-mode-process-chat-column {
				display: none !important;
			}

			.monaco-workbench .custom-mode-process-chat-header {
				display: flex;
				flex-direction: row;
				align-items: center;
				justify-content: space-between;
				flex: 0 0 auto;
				gap: 8px;
				padding: 6px 8px 6px 10px;
				border-bottom: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
				font-size: 12px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-process-chat-header button {
				background: transparent;
				border: none;
				color: var(--vscode-foreground);
				cursor: pointer;
				padding: 2px 6px;
				border-radius: 3px;
				font-size: 16px;
				line-height: 1;
			}

			.monaco-workbench .custom-mode-process-chat-header button:hover {
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-process-chat-reopen {
				display: none;
				position: absolute;
				right: 0;
				top: 50%;
				transform: translateY(-50%);
				z-index: 25;
				align-items: center;
				justify-content: center;
				writing-mode: vertical-rl;
				text-orientation: mixed;
				padding: 12px 6px;
				border: 1px solid var(--vscode-panel-border);
				border-right: none;
				border-radius: 6px 0 0 6px;
				background-color: var(--vscode-sideBar-background);
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				box-shadow: -2px 0 8px rgba(0, 0, 0, 0.2);
			}

			.monaco-workbench .custom-mode-process-container.custom-mode-process-chat-dismissed.visible .custom-mode-process-chat-reopen {
				display: flex;
			}

			.monaco-workbench .custom-mode-process-chat-column .custom-mode-embedded-chat.custom-mode-process-side-chat.visible {
				display: flex !important;
				flex-direction: column !important;
				flex: 1 1 auto !important;
				flex-grow: 1 !important;
				min-height: 0 !important;
				height: auto !important;
				max-height: none !important;
				width: 100%;
				border-top: none;
				padding: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-process-chat-column .custom-mode-process-side-chat.visible .interactive-session {
				flex: 1 1 auto !important;
				min-height: 0 !important;
				max-height: none !important;
				height: auto !important;
				max-width: none !important;
				width: 100% !important;
				margin: 0 !important;
			}

			.monaco-workbench .custom-mode-process-chat-column .custom-mode-process-side-chat.visible .interactive-list {
				flex: 1 1 auto !important;
				min-height: 0 !important;
				max-height: none !important;
				overflow: auto !important;
			}

			.monaco-workbench .custom-mode-ui-container,
			.monaco-workbench .custom-mode-process-container {
				position: relative;
			}

			.monaco-workbench .custom-mode-callout {
				position: absolute;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
				display: flex;
				flex-direction: column;
				align-items: stretch;
				gap: 12px;
				padding: 20px 20px 16px;
				border-radius: 10px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
				max-width: min(560px, calc(100% - 48px));
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-callout-title {
				font-size: 14px;
				font-weight: 600;
				color: var(--vscode-foreground);
				text-align: center;
			}

			.monaco-workbench .custom-mode-callout-subtitle {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				text-align: center;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-callout-steps {
				margin: 0;
				padding: 0 0 0 18px;
				display: flex;
				flex-direction: column;
				gap: 6px;
				font-size: 12px;
				line-height: 1.45;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-callout-step {
				padding-left: 2px;
			}

			.monaco-workbench .custom-mode-callout-surfaces-label {
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.monaco-workbench .custom-mode-callout-surfaces {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-callout-surface-chip {
				display: inline-flex;
				align-items: center;
				height: 22px;
				padding: 0 8px;
				border-radius: 999px;
				border: 1px solid var(--vscode-editorWidget-border);
				background-color: var(--vscode-editor-background);
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 20px;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-callout-button-row {
				display: flex;
				justify-content: center;
				padding-top: 2px;
			}

			.monaco-workbench .custom-mode-callout-button {
				height: 30px;
				padding: 0 12px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-callout-button:hover {
				background-color: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-browser-shell {
				display: contents;
			}

			.monaco-workbench .custom-mode-ui-surface-switcher {
				display: none;
				flex: 0 0 auto;
				align-items: center;
				gap: 6px;
				min-width: 0;
				max-width: min(68vw, 900px);
				height: 100%;
				padding: 0 2px;
				overflow-x: auto;
				overflow-y: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-switcher:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-tab {
				flex: 0 0 auto;
				display: inline-flex;
				align-items: center;
				gap: 2px;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-button {
				flex: 0 0 auto;
				height: 26px;
				max-width: 168px;
				padding: 0 10px;
				border-radius: 4px;
				border: 0;
				border-bottom: 2px solid transparent;
				background: transparent;
				color: var(--vscode-tab-inactiveForeground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
				line-height: 1.2;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-surface-button:hover {
				color: var(--vscode-tab-activeForeground);
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-button.active {
				border-bottom-color: var(--vscode-tab-activeBorder, var(--vscode-focusBorder));
				background: var(--vscode-tab-activeBackground, transparent);
				color: var(--vscode-tab-activeForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-close {
				flex: 0 0 auto;
				width: 18px;
				height: 18px;
				padding: 0;
				border: 0;
				border-radius: 4px;
				background: transparent;
				color: var(--vscode-tab-inactiveForeground);
				cursor: pointer;
				line-height: 1;
				font-size: 12px;
				font-weight: 700;
			}

			.monaco-workbench .custom-mode-ui-surface-close:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-tab-activeForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-tab.active .custom-mode-ui-surface-close {
				color: var(--vscode-tab-activeForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-launch-panel {
				display: none;
				flex: 0 0 auto;
				gap: 8px;
				align-items: center;
				padding: 8px 10px;
				border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
				background-color: var(--vscode-editorWidget-background);
				color: var(--vscode-foreground);
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-panel:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-copy {
				flex: 1 1 auto;
				min-width: 0;
				padding: 6px 8px;
				border-radius: 6px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				background-color: var(--vscode-textCodeBlock-background);
				color: var(--vscode-editor-foreground);
				font-family: var(--monaco-monospace-font, ui-monospace, monospace);
				font-size: 11px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-meta {
				flex: 0 1 auto;
				min-width: 0;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-run {
				flex: 0 0 auto;
				height: 26px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-run:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-setup.custom-mode-setup-hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-setup {
				display: none;
				flex: 1 1 auto;
				min-height: 0;
				padding: 24px 28px;
				background: var(--vscode-editorBackground);
				color: var(--vscode-foreground);
				overflow: auto;
			}

			.monaco-workbench .custom-mode-ui-surface-setup:not(.hidden) {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-inner {
				display: flex;
				flex-direction: column;
				width: 100%;
				max-width: 960px;
				flex: 1 1 auto;
				min-height: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-context-item.handoff-active {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-setup-main {
				min-width: 0;
				display: flex;
				flex-direction: column;
				gap: 16px;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-inner.custom-mode-ui-surface-scaffold-open {
				max-width: min(1180px, 100%);
			}

			.monaco-workbench .custom-mode-ui-surface-setup-inner.custom-mode-ui-surface-scaffold-open .custom-mode-ui-surface-setup-main {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-view {
				display: none;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				gap: 14px;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-inner.custom-mode-ui-surface-scaffold-open .custom-mode-ui-surface-scaffold-view {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-header {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-title {
				font-size: 15px;
				font-weight: 650;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-hint {
				font-size: 12px;
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-textarea {
				flex: 1 1 auto;
				min-height: 280px;
				width: 100%;
				padding: 12px 14px;
				border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
				border-radius: 8px;
				background: var(--vscode-input-background);
				color: var(--vscode-foreground);
				font-family: var(--monaco-monospace-font);
				font-size: 12px;
				line-height: 1.5;
				resize: vertical;
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-actions button {
				height: 32px;
				padding: 0 14px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-scaffold {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-scaffold:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-cancel {
				background: transparent;
				color: var(--vscode-foreground);
				border-color: var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-surface-scaffold-cancel:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card.generated:not(.has-preview) {
				opacity: 0.72;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-section {
				display: flex;
				flex-direction: column;
				gap: 12px;
				padding: 18px 0 8px;
				border-top: 1px solid var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-surface-setup-section:first-child {
				border-top: 0;
				padding-top: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-section-heading {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-section-heading .custom-mode-ui-surface-starters {
				flex: 0 1 auto;
				justify-content: flex-end;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-title {
				color: var(--vscode-foreground);
				font-size: 22px;
				font-weight: 650;
				line-height: 1.25;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-description,
			.monaco-workbench .custom-mode-ui-surface-setup-metric,
			.monaco-workbench .custom-mode-ui-surface-setup-note {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-summary {
				display: grid;
				grid-template-columns: minmax(0, 1fr) minmax(180px, 260px);
				gap: 1px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				background: var(--vscode-panel-border);
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-cell {
				min-width: 0;
				padding: 12px 14px;
				background: var(--vscode-sideBar-background);
			}

			.monaco-workbench .custom-mode-ui-surface-goal-label {
				margin-bottom: 4px;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-form {
				display: flex;
				flex-direction: column;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-field {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-input,
			.monaco-workbench .custom-mode-ui-surface-goal-textarea {
				width: 100%;
				box-sizing: border-box;
				padding: 8px 10px;
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-size: 13px;
				font-family: inherit;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-textarea {
				min-height: 84px;
				resize: vertical;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-logos {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-logo-slot {
				display: flex;
				flex-direction: column;
				gap: 6px;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-logo-label {
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-dropzone {
				display: flex;
				align-items: center;
				justify-content: center;
				min-height: 108px;
				padding: 12px;
				border: 1px dashed var(--vscode-panel-border);
				border-radius: 6px;
				background: var(--vscode-sideBar-background);
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-dropzone.dragover,
			.monaco-workbench .custom-mode-ui-surface-brand-dropzone:hover {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-brand-dropzone.has-image {
				padding: 10px;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-dropzone-hint {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				text-align: center;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-dropzone.has-image .custom-mode-ui-surface-brand-dropzone-hint {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-logo-preview {
				max-width: 100%;
				max-height: 72px;
				object-fit: contain;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-colors {
				display: flex;
				flex-wrap: wrap;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-color-field {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-color-label {
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
			}

			.monaco-workbench .custom-mode-ui-surface-brand-color-input {
				width: 48px;
				height: 32px;
				padding: 0;
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				background: transparent;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-surface-goal-value {
				overflow: hidden;
				color: var(--vscode-foreground);
				font-size: 15px;
				font-weight: 650;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-metric {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-metric:not(.hidden) {
				display: block;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-section-title {
				font-size: 12px;
				font-weight: 650;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-section[data-section="surfaces"] {
				gap: 16px;
				padding-top: 24px;
				padding-bottom: 16px;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-header {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-start-all-surfaces {
				align-self: flex-start;
				height: 28px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
				background: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				font-size: 11px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-start-all-surfaces:hover:not(:disabled) {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
			}

			.monaco-workbench .custom-mode-start-all-surfaces:disabled {
				opacity: 0.55;
				cursor: default;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-title {
				color: var(--vscode-foreground);
				font-size: 15px;
				font-weight: 650;
				line-height: 1.3;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-subtitle {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
				max-width: 56ch;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card {
				position: relative;
				display: block;
				min-height: 200px;
				padding: 0;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 8px;
				background: var(--vscode-editor-background);
				color: inherit;
				text-align: left;
				cursor: pointer;
				font-family: inherit;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card:hover {
				border-color: var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-preview-shell {
				position: absolute;
				inset: 0;
				background: var(--vscode-sideBar-background);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-preview {
				width: 100%;
				height: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-overlay {
				position: absolute;
				inset: 0;
				display: flex;
				flex-direction: column;
				justify-content: flex-start;
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-overlay-top {
				display: flex;
				align-items: center;
				gap: 8px;
				width: 100%;
				padding: 10px 12px;
				background: linear-gradient(
					180deg,
					color-mix(in srgb, var(--vscode-editor-background) 94%, transparent) 0%,
					color-mix(in srgb, var(--vscode-editor-background) 72%, transparent) 55%,
					transparent 100%
				);
				pointer-events: auto;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-header {
				display: flex;
				align-items: center;
				gap: 10px;
				width: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-icon.codicon {
				display: flex;
				align-items: center;
				justify-content: center;
				width: 24px;
				height: 24px;
				border-radius: 6px;
				background: color-mix(in srgb, var(--vscode-badge-background) 88%, transparent);
				color: var(--vscode-badge-foreground);
				font-size: 13px;
				flex: 0 0 auto;
				box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-title {
				flex: 1 1 auto;
				min-width: 0;
				color: var(--vscode-foreground);
				font-size: 14px;
				font-weight: 650;
				line-height: 1.25;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-summary,
			.monaco-workbench .custom-mode-ui-surface-starter-card-meta,
			.monaco-workbench .custom-mode-ui-surface-starter-card-highlights,
			.monaco-workbench .custom-mode-ui-surface-starter-card-preview-row {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-summary {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-meta {
				display: flex;
				flex-direction: column;
				gap: 4px;
				width: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-status {
				display: inline-flex;
				align-items: center;
				flex: 0 0 auto;
				padding: 2px 8px;
				border-radius: 999px;
				font-size: 11px;
				font-weight: 600;
				line-height: 1.4;
				border: 1px solid var(--vscode-panel-border);
				color: var(--vscode-descriptionForeground);
				background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent);
				max-width: fit-content;
				backdrop-filter: blur(4px);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-status.created {
				border-color: var(--vscode-textLink-foreground);
				color: var(--vscode-textLink-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-status.running {
				border-color: var(--vscode-testing-iconPassed);
				color: var(--vscode-testing-iconPassed);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-preview a {
				color: var(--vscode-textLink-foreground);
				text-decoration: underline;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-preview-frame {
				display: block;
				width: 100%;
				height: 100%;
				border: 0;
				border-radius: 0;
				background: var(--vscode-editor-background);
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-preview-row {
				display: flex;
				align-items: center;
				gap: 6px;
				flex-wrap: wrap;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-highlights {
				display: flex;
				flex-direction: column;
				gap: 4px;
				margin: 0;
				padding: 0;
				list-style: none;
				width: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-highlight {
				position: relative;
				padding-left: 14px;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 1.35;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-highlight::before {
				content: '';
				position: absolute;
				left: 0;
				top: 0.55em;
				width: 5px;
				height: 5px;
				border-radius: 50%;
				background: var(--vscode-textLink-foreground);
				transform: translateY(-50%);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new {
				align-items: center;
				justify-content: center;
				text-align: center;
				border-style: dashed;
				background: transparent;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-header {
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-icon.codicon {
				width: 40px;
				height: 40px;
				font-size: 22px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-summary,
			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-highlights {
				display: none;
			}

			@media (max-width: 760px) {
				.monaco-workbench .custom-mode-ui-surface-starter-grid {
					grid-template-columns: minmax(0, 1fr);
				}
			}

			.monaco-workbench .custom-mode-ui-surface-starters {
				display: flex;
				flex-direction: column;
				gap: 14px;
			}

			.monaco-workbench .custom-mode-ui-surface-context-list {
				display: flex;
				flex-direction: column;
				gap: 6px;
				margin: 0;
				padding: 0;
				list-style: none;
			}

			.monaco-workbench .custom-mode-ui-surface-context-item {
				display: grid;
				grid-template-columns: 28px minmax(0, 1fr) auto auto;
				align-items: center;
				gap: 12px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				background: var(--vscode-sideBar-background);
				padding: 10px 12px;
				color: var(--vscode-foreground);
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-context-icon {
				color: var(--vscode-symbolIcon-classForeground);
				font-size: 16px;
				text-align: center;
			}

			.monaco-workbench .custom-mode-ui-surface-context-icon.codicon {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 28px;
				height: 28px;
			}

			.monaco-workbench .custom-mode-ui-surface-context-title {
				font-weight: 650;
			}

			.monaco-workbench .custom-mode-ui-surface-context-prompt {
				margin-top: 2px;
				color: var(--vscode-descriptionForeground);
				line-height: 1.35;
			}

			.monaco-workbench .custom-mode-ui-surface-context-status {
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-surface-context-status.complete {
				color: var(--vscode-testing-iconPassed);
			}

			.monaco-workbench .custom-mode-ui-surface-context-status.progress {
				color: var(--vscode-charts-blue);
			}

			.monaco-workbench .custom-mode-ui-surface-context-action {
				border: 0;
				background: transparent;
				color: var(--vscode-textLink-foreground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-agent-notes {
				display: flex;
				flex-direction: column;
				gap: 8px;
				padding-top: 6px;
				border-top: 1px solid var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-surface-agent-textarea {
				min-height: 74px;
				resize: vertical;
				padding: 10px 12px;
				border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
				border-radius: 6px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-family: var(--monaco-monospace-font);
				font-size: 12px;
				line-height: 1.4;
			}

			@media (max-width: 960px) {
				.monaco-workbench .custom-mode-ui-surface-context-item {
					grid-template-columns: 28px minmax(0, 1fr);
				}

				.monaco-workbench .custom-mode-ui-surface-context-status,
				.monaco-workbench .custom-mode-ui-surface-context-action {
					grid-column: 2;
					justify-self: start;
				}
			}

			.monaco-workbench .custom-mode-ui-surface-empty {
				display: none;
				flex: 1 1 auto;
				min-height: 0;
				align-items: center;
				justify-content: center;
				padding: 24px;
				background: var(--vscode-editorBackground);
				color: var(--vscode-foreground);
				text-align: center;
			}

			.monaco-workbench .custom-mode-ui-surface-empty:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-inner {
				display: flex;
				flex-direction: column;
				gap: 8px;
				max-width: 440px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-title {
				font-size: 13px;
				font-weight: 600;
			}

				.monaco-workbench .custom-mode-ui-surface-empty-subtitle {
					font-size: 12px;
					line-height: 1.45;
					color: var(--vscode-descriptionForeground);
					white-space: pre-line;
				}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-missing-url .custom-mode-ui-frame,
			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-missing-url .custom-mode-ui-webview {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-frame,
			.monaco-workbench .custom-mode-ui-webview {
				flex: 1 1 auto;
				min-height: 0;
				width: 100%;
				border: 0;
				background: transparent;
				opacity: 0.35;
			}

			.monaco-workbench.custom-mode-shell-hasProject .custom-mode-callout {
				display: none;
			}

			.monaco-workbench.custom-mode-ui.custom-mode-shell-hasProject .custom-mode-ui-frame,
			.monaco-workbench.custom-mode-ui.custom-mode-shell-hasProject .custom-mode-ui-webview {
				opacity: 1;
			}

			/*
			 * Bound the live preview: Next (etc.) pages use a tall dark body; stretching the webview with flex:1
			 * showed a huge empty band above the host chat. The shell gets a max-height; the frame fills it and scrolls inside.
			 */
			.monaco-workbench.custom-mode-ui.custom-mode-shell-hasProject .custom-mode-ui-browser-shell {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				width: 100%;
				overflow: hidden;
			}

			.monaco-workbench.custom-mode-ui.custom-mode-shell-hasProject .custom-mode-ui-browser-shell .custom-mode-ui-frame,
			.monaco-workbench.custom-mode-ui.custom-mode-shell-hasProject .custom-mode-ui-browser-shell .custom-mode-ui-webview {
				flex: 1 1 auto;
				min-height: 0;
				width: 100%;
				height: 100%;
			}

			/* Bottom strip variant only (UI/Process side panels use .custom-mode-ui-side-chat / .custom-mode-process-side-chat). */
			.monaco-workbench .custom-mode-embedded-chat:not(.custom-mode-ui-side-chat):not(.custom-mode-process-side-chat) {
				display: none;
				flex: 0 0 auto;
				align-self: stretch;
				min-height: 0;
				min-width: 0;
				padding: 0;
				border-top: 1px solid var(--vscode-panel-border);
				background: var(--vscode-editorBackground);
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-embedded-chat.visible:not(.custom-mode-ui-side-chat):not(.custom-mode-process-side-chat) {
				display: flex !important;
				flex-direction: column !important;
				flex: 0 0 auto !important;
				flex-grow: 0 !important;
				height: 120px !important;
				max-height: 120px !important;
				min-height: 0 !important;
				overflow-x: hidden !important;
				overflow-y: hidden !important;
			}

			/*
			 * Fill width: global chat.css centers .interactive-session at max-width 950px.
			 * chat.css also sets height: 100% on .interactive-session — in a tall flex column that stretches the
			 * whole session to the UI surface height while layout() only sizes the list internally, leaving a huge
			 * empty band (same editor background) around the compact input strip.
			 */
			.monaco-workbench .custom-mode-embedded-chat:not(.custom-mode-ui-side-chat):not(.custom-mode-process-side-chat) .interactive-session {
				max-width: none !important;
				width: 100% !important;
				margin: 0 !important;
				padding: 0 !important;
				min-height: 0;
				flex: 0 0 auto !important;
				height: auto !important;
				max-height: 120px !important;
			}

			/*
			 * Empty transcript + compact: ChatWidget keeps .chat-welcome-view-container visible with flex:1 and a tall
			 * explicit height (body minus input) while welcome content is never rendered—large blank band above the input.
			 * Embedded strip chat should only show the transcript + input strip.
			 */
			.monaco-workbench .custom-mode-embedded-chat:not(.custom-mode-ui-side-chat):not(.custom-mode-process-side-chat) .chat-welcome-view-container {
				display: none !important;
				height: 0 !important;
				min-height: 0 !important;
				max-height: 0 !important;
				flex: 0 0 0 !important;
				overflow: hidden !important;
				margin: 0 !important;
				padding: 0 !important;
				border: none !important;
			}

			.monaco-workbench .custom-mode-embedded-chat:not(.custom-mode-ui-side-chat):not(.custom-mode-process-side-chat) .interactive-list {
				flex: 0 1 auto !important;
				flex-grow: 0 !important;
				min-height: 0;
				max-height: var(--custom-mode-chat-list-height, 60px) !important;
				overflow: auto !important;
			}

			.monaco-workbench .custom-mode-embedded-chat .interactive-item-container {
				padding-left: 8px;
				padding-right: 8px;
			}

			.monaco-workbench .custom-mode-embedded-chat:not(.custom-mode-ui-side-chat):not(.custom-mode-process-side-chat) .chat-input-container {
				background-color: transparent !important;
				border: none !important;
				padding: 0 !important;
			}

				/* Hide Start App / runtime panel unless the dev server is actively starting. */
				.monaco-workbench.custom-mode-app-reachable.custom-mode-shell-hasProject .custom-mode-ui-main > .custom-mode-setup {
					display: none !important;
				}

				.monaco-workbench .custom-mode-ui-start-bar {
					display: flex;
					flex-direction: column;
					align-items: stretch;
					gap: 10px;
					padding: 14px 16px 16px;
				}

			.monaco-workbench .custom-mode-start-app {
				align-self: flex-start;
				height: 34px;
				padding: 0 18px;
				border-radius: 8px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				font-size: 13px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-start-app:hover:not(:disabled) {
				background-color: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-start-app:disabled {
				opacity: 0.45;
				cursor: default;
			}

			.monaco-workbench .custom-mode-start-app-subtitle {
				font-family: var(--monaco-monospace-font);
				font-size: 11px;
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
				word-break: break-all;
			}

			.monaco-workbench .custom-mode-start-app-status,
			.monaco-workbench .custom-mode-start-app-runtime {
				margin: 0;
				padding: 8px 10px;
				border-radius: 6px;
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				font-family: var(--monaco-monospace-font);
				font-size: 11px;
				line-height: 1.4;
				white-space: pre-wrap;
				word-break: break-word;
				color: var(--vscode-editor-foreground);
				max-height: min(200px, 28vh);
				overflow: auto;
				user-select: text;
				-webkit-user-select: text;
				cursor: text;
			}

			.monaco-workbench .custom-mode-start-app-runtime {
				max-height: min(120px, 18vh);
				opacity: 0.92;
			}

			.monaco-workbench .custom-mode-start-app-runtime:empty {
				display: none;
			}

			.monaco-workbench .custom-mode-ix-webhint {
				display: none;
				padding: 8px 12px;
				margin: 0 12px 8px;
				border-radius: 6px;
				background-color: var(--vscode-inputValidation-infoBackground);
				color: var(--vscode-inputValidation-infoForeground);
				font-size: 12px;
				line-height: 1.4;
			}

			.monaco-workbench.custom-mode-web .custom-mode-ix-webhint {
				display: block;
			}

			.monaco-workbench .custom-mode-docker-banner {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
				margin: 0 12px 10px;
				padding: 10px 12px;
				border-radius: 8px;
				border: 1px solid var(--vscode-inputValidation-warningBorder);
				background-color: var(--vscode-inputValidation-warningBackground);
				color: var(--vscode-inputValidation-warningForeground);
				font-size: 12px;
				line-height: 1.4;
			}

			.monaco-workbench .custom-mode-docker-banner.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-docker-banner-text {
				flex: 1 1 auto;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ix-pipeline {
				flex: 0 0 auto;
				align-self: stretch;
				margin: 0 12px 10px;
				padding: 10px 12px;
				border-radius: 8px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
				background-color: var(--vscode-editorWidget-background);
				display: flex;
				flex-direction: column;
				gap: 10px;
			}

			.monaco-workbench.custom-mode-web .custom-mode-ix-pipeline {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ix-pipeline-global-row {
				display: flex;
				flex-direction: row;
				flex-wrap: wrap;
				gap: 10px;
				align-items: stretch;
			}

			.monaco-workbench .custom-mode-ix-pipeline-workspace-rows {
				display: flex;
				flex-direction: column;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ix-pipeline-workspace-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
				position: relative; /* anchor ix popovers */
			}

			/* When global + workspace steps are shown together, keep everything on one row. */
			.monaco-workbench .custom-mode-ix-pipeline-combined-row {
				display: flex;
				flex-direction: row;
				flex-wrap: wrap;
				gap: 10px;
				align-items: stretch;
			}

			.monaco-workbench .custom-mode-ix-pipeline-workspace-rows.workspace-steps-hidden .custom-mode-ix-pipeline-combined-row {
				display: none;
			}

			.monaco-workbench .custom-mode-ix-pipeline-controls {
				display: flex;
				align-items: center;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ix-pipeline-workspace-label {
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.monaco-workbench .custom-mode-ix-pipeline-step {
				flex: 1 1 180px;
				min-width: 160px;
				max-width: 320px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
				border-radius: 6px;
				padding: 8px 10px;
				background: var(--vscode-editor-background);
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ix-pipeline-step-head {
				display: flex;
				align-items: baseline;
				gap: 8px;
				flex-wrap: wrap;
			}

			.monaco-workbench .custom-mode-ix-pipeline-status {
				font-size: 12px;
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-ix-pipeline-label {
				font-size: 12px;
				font-weight: 600;
				color: var(--vscode-foreground);
				flex: 1 1 auto;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ix-pipeline-dur {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				font-variant-numeric: tabular-nums;
			}

			.monaco-workbench .custom-mode-ix-pipeline-cmd {
				font-family: var(--monaco-monospace-font);
				font-size: 10px;
				line-height: 1.35;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ix-pipeline-err {
				font-size: 11px;
				color: var(--vscode-errorForeground);
				white-space: pre-wrap;
				word-break: break-word;
			}

			.monaco-workbench .custom-mode-ix-pipeline-step details {
				margin: 0;
			}

			.monaco-workbench .custom-mode-ix-pipeline-step summary {
				cursor: pointer;
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-textLink-foreground);
				user-select: none;
			}

			.monaco-workbench .custom-mode-ix-pipeline-copy {
				height: 22px;
				padding: 0 8px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 11px;
				font-weight: 600;
				align-self: flex-start;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench .custom-mode-ix-pipeline-copy:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-ix-pipeline-pre {
				margin: 6px 0 0;
				padding: 8px;
				max-height: 160px;
				overflow: auto;
				font-family: var(--monaco-monospace-font);
				font-size: 10px;
				line-height: 1.4;
				white-space: pre-wrap;
				word-break: break-word;
				color: var(--vscode-descriptionForeground);
				background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.08));
				border-radius: 4px;
				user-select: text;
				-webkit-user-select: text;
			}

			.monaco-workbench .custom-mode-ix-pipeline-step.status-running {
				border-color: var(--vscode-progressBar-background);
			}

			.monaco-workbench .custom-mode-ix-pipeline-step.status-success {
				border-color: rgba(80, 160, 80, 0.45);
			}

			.monaco-workbench .custom-mode-ix-pipeline-step.status-error {
				border-color: var(--vscode-inputValidation-errorBorder, rgba(255, 80, 80, 0.55));
			}

			.monaco-workbench .custom-mode-ix-pipeline-step.status-skipped {
				opacity: 0.65;
			}

			.monaco-workbench .custom-mode-ix-pipeline-step.status-idle {
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-ix-debug {
				position: absolute;
				left: 12px;
				right: 12px;
				top: 12px;
				z-index: 2150;
				max-height: 38%;
				overflow: auto;
				padding: 10px 12px;
				border-radius: 8px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				color: var(--vscode-foreground);
				font-size: 12px;
				line-height: 1.35;
				white-space: pre-wrap;
			}

			.monaco-workbench.custom-mode-web .custom-mode-ix-debug {
				display: none;
			}

			.monaco-workbench .custom-mode-ix-debug-title {
				font-weight: 600;
				margin-bottom: 6px;
			}

			.monaco-workbench .custom-mode-ix-commands {
				flex: 0 1 auto;
				align-self: stretch;
				min-height: 0;
				margin: 0 12px 8px;
				padding: 8px 10px 10px;
				border-radius: 8px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
				background-color: var(--vscode-sideBar-background);
				max-height: min(240px, 32vh);
				overflow: auto;
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ix-commands-header {
				font-size: 12px;
				font-weight: 600;
				color: var(--vscode-foreground);
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-ix-commands-header a {
				color: var(--vscode-textLink-foreground);
				font-weight: 600;
				margin-left: 6px;
			}

			.monaco-workbench .custom-mode-ix-commands-header a:hover {
				color: var(--vscode-textLink-activeForeground);
			}

			.monaco-workbench .custom-mode-ix-commands-pre {
				margin: 0;
				padding: 0;
				font-family: var(--monaco-monospace-font);
				font-size: 11px;
				line-height: 1.45;
				white-space: pre-wrap;
				word-break: break-word;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench.custom-mode-web .custom-mode-ix-commands {
				display: none;
			}

			.monaco-workbench .custom-mode-process-ix-button {
				height: 26px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench .custom-mode-process-ix-button:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-process-ix-popover {
				position: absolute;
				top: calc(100% + 8px);
				right: 0;
				width: min(640px, calc(100vw - 48px));
				max-height: min(420px, 55vh);
				overflow: auto;
				padding: 10px 12px;
				border-radius: 8px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
				color: var(--vscode-foreground);
				font-size: 12px;
				line-height: 1.35;
				white-space: pre-wrap;
				display: none;
				user-select: text;
				-webkit-user-select: text;
			}

			.monaco-workbench .custom-mode-process-ix-popover.visible {
				display: block;
			}

			.monaco-workbench .custom-mode-ui-container,
			.monaco-workbench .custom-mode-process-container {
				position: relative;
			}

			.monaco-workbench .custom-mode-startup-guide-overlay {
				position: absolute;
				inset: 0;
				z-index: 2600;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 24px;
				background: rgba(0, 0, 0, 0.45);
			}

			.monaco-workbench .custom-mode-startup-guide-overlay.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-startup-guide-dialog {
				width: min(760px, calc(100vw - 48px));
				max-height: min(82vh, 900px);
				overflow: auto;
				padding: 18px 20px;
				border-radius: 10px;
				background: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
			}

			.monaco-workbench .custom-mode-startup-guide-title {
				font-size: 18px;
				font-weight: 700;
				margin-bottom: 4px;
			}

			.monaco-workbench .custom-mode-startup-guide-subtitle,
			.monaco-workbench .custom-mode-startup-guide-summary {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-startup-guide-summary {
				margin: 12px 0;
			}

			.monaco-workbench .custom-mode-startup-guide-steps {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-startup-guide-step {
				padding: 12px 14px;
				border-radius: 8px;
				border: 1px solid var(--vscode-widget-border);
				background: var(--vscode-editor-background);
			}

			.monaco-workbench .custom-mode-startup-guide-step-head {
				display: flex;
				gap: 10px;
				align-items: flex-start;
			}

			.monaco-workbench .custom-mode-startup-guide-step-glyph {
				width: 18px;
				flex: 0 0 18px;
				font-weight: 700;
				text-align: center;
			}

			.monaco-workbench .custom-mode-startup-guide-step-label {
				font-weight: 600;
				margin-bottom: 2px;
			}

			.monaco-workbench .custom-mode-startup-guide-step-description,
			.monaco-workbench .custom-mode-startup-guide-step-detail {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.4;
			}

			.monaco-workbench .custom-mode-startup-guide-step-detail {
				margin-top: 8px;
			}

			.monaco-workbench .custom-mode-startup-guide-step-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-top: 10px;
				align-items: center;
			}

			.monaco-workbench .custom-mode-startup-guide-step-manual {
				margin: 8px 0 0;
				padding: 8px 10px;
				border-radius: 6px;
				background: var(--vscode-textCodeBlock-background);
				font-family: var(--monaco-monospace-font);
				font-size: 11px;
				line-height: 1.45;
				white-space: pre-wrap;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-startup-guide-footer {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-top: 16px;
				justify-content: flex-end;
			}

			.monaco-workbench .custom-mode-startup-guide-step-success .custom-mode-startup-guide-step-glyph {
				color: var(--vscode-testing-iconPassed);
			}

			.monaco-workbench .custom-mode-startup-guide-step-error .custom-mode-startup-guide-step-glyph {
				color: var(--vscode-errorForeground);
			}

			.monaco-workbench .custom-mode-startup-guide-step-warning .custom-mode-startup-guide-step-glyph {
				color: var(--vscode-inputValidation-warningBorder);
			}

			.monaco-workbench .custom-mode-process-ix-popover-title {
				font-weight: 700;
				margin-bottom: 6px;
				display: flex;
				align-items: baseline;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-process-ix-popover-title a {
				color: var(--vscode-textLink-foreground);
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-process-ix-popover-title a:hover {
				color: var(--vscode-textLink-activeForeground);
			}

			/* Hide the old inline boxes (replaced by buttons + popovers). */
			.monaco-workbench .custom-mode-ix-commands,
			.monaco-workbench .custom-mode-ix-debug {
				display: none !important;
			}

			.monaco-workbench .custom-mode-process-notes {
				flex: 0 1 auto;
				align-self: stretch;
				min-height: 0;
				margin: 0 12px 8px;
				padding: 10px 10px 10px;
				border-radius: 8px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
				background-color: var(--vscode-editorWidget-background);
				display: flex;
				flex-direction: column;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-process-notes-topic {
				height: 26px;
				padding: 0 8px;
				border-radius: 6px;
				border: 1px solid var(--vscode-input-border, transparent);
				background-color: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-process-notes-generate {
				height: 26px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-process-notes-generate:hover:not(:disabled) {
				background-color: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-process-notes-generate:disabled {
				opacity: 0.45;
				cursor: default;
			}

			.monaco-workbench .custom-mode-process-notes-back {
				height: 26px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-process-notes-back:hover:not(:disabled) {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-process-notes-back.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-process-notes-regenerate {
				height: 26px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-process-notes-regenerate:hover:not(:disabled) {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-process-notes-regenerate:disabled {
				opacity: 0.45;
				cursor: default;
			}

			.monaco-workbench .custom-mode-process-notes-markdown {
				font-size: 12px;
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
				user-select: text;
				-webkit-user-select: text;
				white-space: pre-wrap;
				word-break: break-word;
				max-height: min(180px, 24vh);
				overflow: auto;
				padding: 6px 8px;
				border-radius: 6px;
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
			}

			.monaco-workbench .custom-mode-process-notes-detail {
				font-size: 11px;
				line-height: 1.4;
				color: var(--vscode-foreground);
				user-select: text;
				-webkit-user-select: text;
				max-height: min(280px, 32vh);
				overflow: auto;
				padding: 8px 10px;
				border-radius: 6px;
				background-color: var(--vscode-editor-background);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
			}

			.monaco-workbench .custom-mode-process-notes-detail.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-process-notes-detail-title {
				font-size: 12px;
				font-weight: 600;
				margin-bottom: 8px;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-process-notes-detail-section {
				margin-bottom: 10px;
			}

			.monaco-workbench .custom-mode-process-notes-detail-section:last-child {
				margin-bottom: 0;
			}

			.monaco-workbench .custom-mode-process-notes-detail-section-title {
				font-size: 10px;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 4px;
			}

			.monaco-workbench .custom-mode-process-notes-detail-list {
				margin: 0;
				padding: 0 0 0 14px;
				font-family: var(--monaco-monospace-font);
				font-size: 10px;
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
				word-break: break-all;
			}

			.monaco-workbench .custom-mode-process-notes-detail-empty {
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
				opacity: 0.75;
				font-style: italic;
			}

			.monaco-workbench .custom-mode-process-notes-logs {
				font-family: var(--monaco-monospace-font);
				font-size: 10px;
				line-height: 1.4;
				user-select: text;
				-webkit-user-select: text;
				white-space: pre-wrap;
				word-break: break-word;
				max-height: min(120px, 18vh);
				overflow: auto;
				padding: 6px 8px;
				border-radius: 6px;
				background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.08));
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-process-notes-discovery-logs {
				font-family: var(--monaco-monospace-font);
				font-size: 10px;
				line-height: 1.4;
				user-select: text;
				-webkit-user-select: text;
				white-space: pre-wrap;
				word-break: break-word;
				max-height: min(120px, 18vh);
				overflow: auto;
				padding: 6px 8px;
				border-radius: 6px;
				background: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-process-notes-expanded-chrome {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 8px;
				padding: 2px 0;
			}

			.monaco-workbench .custom-mode-process-notes-expanded-spacer {
				flex: 1 1 auto;
				min-width: 8px;
			}

			.monaco-workbench .custom-mode-process-notes-expanded-actions {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				gap: 8px;
				flex-shrink: 0;
				padding: 4px 0 2px;
			}

			.monaco-workbench .custom-mode-process-notes-expanded-actions.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-process-notes-cards {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
				gap: 8px;
				min-height: 120px;
			}

			.monaco-workbench .custom-mode-process-notes-cards.hidden,
			.monaco-workbench .custom-mode-process-notes-detail.hidden,
			.monaco-workbench .custom-mode-process-notes-markdown.hidden,
			.monaco-workbench .custom-mode-process-notes-graph.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-process-notes-card {
				text-align: left;
				border-radius: 8px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
				background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
				color: var(--vscode-foreground);
				padding: 10px;
				cursor: pointer;
				display: flex;
				flex-direction: column;
				gap: 6px;
				min-height: 104px;
			}

			.monaco-workbench .custom-mode-process-notes-card:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-process-notes-card-title-row {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-process-notes-card-title {
				font-size: 13px;
				font-weight: 700;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-process-notes-card-path,
			.monaco-workbench .custom-mode-process-notes-card-coupling,
			.monaco-workbench .custom-mode-process-notes-card-edge {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-process-notes-card-path {
				font-family: var(--monaco-monospace-font, ui-monospace, monospace);
			}

			.monaco-workbench .custom-mode-process-notes-card-meta,
			.monaco-workbench .custom-mode-process-notes-card-summary {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-process-notes-card-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 4px;
			}

			.monaco-workbench .custom-mode-process-notes-card-chip {
				border-radius: 999px;
				padding: 2px 6px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
				color: var(--vscode-descriptionForeground);
				font-size: 10px;
			}

			.monaco-workbench .custom-mode-process-notes-section-title {
				grid-column: 1 / -1;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.02em;
				color: var(--vscode-foreground);
				opacity: 0.92;
				padding: 2px 2px 0;
			}

			.monaco-workbench .custom-mode-process-notes-graph {
				position: relative;
				height: min(320px, 36vh);
				border-radius: 6px;
				overflow: hidden;
				background: var(--vscode-editorBackground);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
			}

			.monaco-workbench.custom-mode-web .custom-mode-process-notes {
				display: none;
			}

			.monaco-workbench .custom-mode-start-hints {
				display: block;
				padding: 10px 12px 12px;
				background-color: var(--vscode-sideBar-background);
				color: var(--vscode-foreground);
				font-size: 12px;
				line-height: 1.45;
			}
			
			.monaco-workbench .custom-mode-setup {
				display: none;
				position: absolute;
				top: 12px;
				left: 12px;
				right: 12px;
				max-width: min(680px, calc(100% - 24px));
				z-index: 2200;
				border-radius: 8px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-setup.custom-mode-setup-active:not(.custom-mode-setup-hidden) {
				display: block;
			}

			.monaco-workbench .custom-mode-ui-selection-pill {
				/* Inline chip in the top mode bar (inserted before the UI tab). */
				display: none;
				height: 22px;
				padding: 0 10px;
				border-radius: 999px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 22px;
				white-space: nowrap;
				user-select: none;
				-webkit-user-select: none;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench.custom-mode-shell-hasProject .custom-mode-ui-selection-pill {
				display: inline-flex;
				align-items: center;
				gap: 4px;
			}

			.monaco-workbench .custom-mode-ui-selection-pill.has-selection {
				color: var(--vscode-foreground);
				border-color: var(--vscode-focusBorder, var(--vscode-editorWidget-border));
			}

			.monaco-workbench .custom-mode-ui-selection-pill .custom-mode-ui-selection-count {
				font-weight: 700;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-selection-clear {
				display: none;
				height: 22px;
				padding: 0 10px;
				border-radius: 999px;
				border: 1px solid var(--vscode-editorWidget-border);
				background-color: transparent;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 600;
				line-height: 20px;
				cursor: pointer;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench.custom-mode-shell-hasProject .custom-mode-ui-selection-clear {
				display: inline-block;
			}

			.monaco-workbench .custom-mode-ui-selection-clear:not(:disabled):hover {
				color: var(--vscode-foreground);
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-selection-clear:disabled {
				opacity: 0.5;
				cursor: default;
			}

			.monaco-workbench .custom-mode-setup details {
				padding: 0;
				margin: 0;
			}

			.monaco-workbench .custom-mode-setup summary {
				list-style: none;
				cursor: pointer;
				padding: 8px 10px;
				font-size: 12px;
				font-weight: 700;
				color: var(--vscode-foreground);
				background-color: var(--vscode-editorWidget-background);
				-webkit-app-region: no-drag;
			}

			.monaco-workbench .custom-mode-setup summary::-webkit-details-marker {
				display: none;
			}

			.monaco-workbench .custom-mode-setup summary::before {
				content: '>';
				display: inline-block;
				margin-right: 8px;
				color: var(--vscode-descriptionForeground);
				transform: translateY(-0.5px);
			}

			.monaco-workbench .custom-mode-setup details[open] summary::before {
				content: 'v';
			}

			.monaco-workbench .custom-mode-start-hints-title {
				font-weight: 600;
				margin-bottom: 8px;
			}

			.monaco-workbench .custom-mode-start-hints-row {
				color: var(--vscode-descriptionForeground);
				margin-bottom: 4px;
			}

			.monaco-workbench .custom-mode-start-hints-row strong {
				color: var(--vscode-foreground);
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-start-hints-pre {
				margin: 6px 0 0;
				padding: 8px 10px;
				border-radius: 6px;
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				font-family: var(--monaco-monospace-font);
				font-size: 11px;
				white-space: pre-wrap;
				word-break: break-all;
				color: var(--vscode-editor-foreground);
			}

			.monaco-workbench .custom-mode-start-hints-cmdRow {
				display: flex;
				flex-direction: row;
				align-items: flex-start;
				gap: 8px;
				margin-top: 6px;
				flex-wrap: wrap;
			}

			.monaco-workbench .custom-mode-start-hints-cmdRow .custom-mode-start-hints-pre {
				margin: 0;
				flex: 1;
				min-width: 120px;
			}

			.monaco-workbench .custom-mode-start-hints-actionRow {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-start-hints-run {
				flex: 0 0 auto;
				height: 26px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-start-hints-run:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench ul.custom-mode-start-hints-list {
				list-style: none;
				padding-left: 0;
				margin: 8px 0 0;
			}

			.monaco-workbench .custom-mode-start-hints-list-item {
				display: flex;
				flex-direction: row;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
				margin-bottom: 6px;
			}

			.monaco-workbench .custom-mode-start-hints-list-text {
				flex: 1;
				min-width: 0;
				font-family: var(--monaco-monospace-font);
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

		`;

		this.modeTopBar = $('div.custom-mode-top-modes', { role: 'tablist' });
		if (isMacintosh && !isWeb) {
			this.modeTopBar.classList.add('mac-native');
			const syncMacTopBarLayout = () => {
				this.modeTopBar.classList.toggle('custom-mode-top-modes-fullscreen', this.container.classList.contains('fullscreen'));
				this.modeTopBar.classList.toggle('macos-tahoe', this.container.classList.contains('macos-tahoe'));
			};
			syncMacTopBarLayout();
			const observer = new MutationObserver(syncMacTopBarLayout);
			observer.observe(this.container, { attributes: true, attributeFilter: ['class'] });
			this._register(toDisposable(() => observer.disconnect()));
		}
		this.uiProjectName = $('button.custom-mode-ui-project-name.hidden', {
			type: 'button',
			title: localize('customMode.workspaceNameOpenBuilder', 'Open guided builder — double-click for goal workspace overview'),
			'aria-pressed': 'false',
		}) as HTMLButtonElement;
		this.modeTopBar.appendChild(this.uiProjectName);
		this._register(addDisposableListener(this.uiProjectName, 'click', () => {
			if (this.container.classList.contains('custom-mode-ui-landing-open')) {
				this.closeGoalWorkspaceLanding();
				return;
			}
			this.selectGoalSurface(ADD_SURFACE_ID);
		}));
		this._register(addDisposableListener(this.uiProjectName, 'dblclick', event => {
			event.preventDefault();
			this.openGoalWorkspaceLanding();
		}));
		for (const mode of ModeShellContribution.MODES) {
			const button = $('button.custom-mode-top-tab', {
				type: 'button',
				role: 'tab',
				'aria-label': mode,
				'aria-selected': false
			}, mode) as HTMLButtonElement;
			this.topModeButtons.set(mode, button);
			this.modeTopBar.appendChild(button);
			this._register(addDisposableListener(button, 'click', () => this.modeService.setMode(mode)));
		}
		this.container.insertBefore(this.modeTopBar, this.container.firstChild);

		this._register(toDisposable(() => this.modeTopBar.remove()));
		this.setupGridResizeRelayout();

		this.modeSurface = $('div.custom-mode-surface');

		this.uiContainer = $('div.custom-mode-ui-container');
		if (this._uiChatDismissed) {
			this.uiContainer.classList.add('custom-mode-ui-chat-dismissed');
		}
		this.uiMainColumn = $('div.custom-mode-ui-main');
		this.uiFeatureChecklistColumn = $('div.custom-mode-ui-feature-checklist-column');
		this._register(new SurfaceFeatureChecklistPanel(
			this.uiFeatureChecklistColumn,
			this.surfaceFeatureChecklistService,
			(surfaceId, stepId) => stepId
				? void this.playSelectedSurfaceWorkflowStep(surfaceId, stepId)
				: void this.playSelectedSurfaceWorkflow(surfaceId),
		));
		this.uiSetup = $('div.custom-mode-setup');
		this.uiSelectionCountEl = $('span.custom-mode-ui-selection-count', undefined, '0');
		this.uiSelectionPill = $('div.custom-mode-ui-selection-pill', undefined,
			this.uiSelectionCountEl,
			$('span.custom-mode-ui-selection-label', undefined, localize('customMode.selectedLabel', 'Selected')),
		);
		const dragToSelectLabel = localize('customMode.dragToSelect', 'Drag to Select');
		this.uiSelectionClearBtn = $('button.custom-mode-ui-selection-clear', {
			type: 'button',
			'aria-label': dragToSelectLabel,
			title: dragToSelectLabel,
		}, dragToSelectLabel) as HTMLButtonElement;
		this.uiSelectionClearBtn.disabled = true;
		this.uiStartAppButton = $('button.custom-mode-start-app', { type: 'button' }, localize('customMode.startApp', 'Start App')) as HTMLButtonElement;
		this.uiStartSubtitle = $('div.custom-mode-start-app-subtitle');
		this.uiStartStatus = $('pre.custom-mode-start-app-status');
		this.uiStartStatus.tabIndex = 0;
		this.uiStartStatus.setAttribute('aria-label', localize('customMode.startStatusLogAria', 'Start app status log'));
		this.uiRuntimeText = $('pre.custom-mode-start-app-runtime');
		this.uiRuntimeText.tabIndex = 0;
		this.uiRuntimeText.setAttribute('aria-label', localize('customMode.startRuntimeLogAria', 'Start app runtime log'));
		const uiStartBar = $('div.custom-mode-ui-start-bar', undefined,
			this.uiStartAppButton,
			this.uiStartSubtitle,
			this.uiStartStatus,
			this.uiRuntimeText
		);
		this.uiSetup.appendChild(uiStartBar);
		this.uiLandingBackdrop = $('div.custom-mode-ui-landing-backdrop');
		this._register(addDisposableListener(this.uiLandingBackdrop, 'click', () => this.closeGoalWorkspaceLanding()));
		this.uiCallout = this.createGoalWorkspaceLandingCallout(() => {
			this.closeGoalWorkspaceLanding();
			void this.defaultProjectService.openFallbackWorkspace();
		});
		// Avoid eagerly navigating to a conventional dev-server URL. When no server is
		// active this only produces a Chromium ERR_CONNECTION_REFUSED page and noisy
		// startup logs. The active URL listener below navigates the preview as soon as
		// a server is detected.
		const initialUrl = this.getTargetEmbeddedUiUrl();
		// Use iframe on web and Electron webview on desktop.
		// Many dev servers (e.g. Next) send headers that block framing (X-Frame-Options / CSP frame-ancestors),
		// which would make an iframe appear blank even though the server is running.
		// On desktop, omit an initial `src` when no URL is known yet. Eagerly loading `about:blank`
		// and then replacing `src` when the dev server URL arrives aborts the first navigation
		// (ERR_ABORTED -3) and can leave the preview stuck blank even though localhost is up.
		this.uiBrowser = isWeb
			? $('iframe.custom-mode-ui-frame', {
				src: initialUrl ?? 'about:blank',
				title: localize('customMode.uiFrameTitle', 'UI Mode'),
				allow: 'clipboard-read; clipboard-write'
			}) as unknown as HTMLElement & { src: string }
			: $('webview.custom-mode-ui-webview', {
				...(initialUrl ? { src: initialUrl } : {}),
				allowpopups: 'true'
			}) as unknown as HTMLElement & { src: string };

		this.uiBrowserShell = $('div.custom-mode-ui-browser-shell');
		this.uiSurfaceSwitcher = $('div.custom-mode-ui-surface-switcher.hidden', {
			role: 'tablist',
			'aria-label': localize('customMode.surfaceSwitcherLabel', 'Goal surfaces')
		});
		this._register(addDisposableListener(this.uiSurfaceSwitcher, 'click', event => this.onSurfaceSwitcherClick(event as MouseEvent)));
		this.uiSurfaceLaunchPanel = $('div.custom-mode-ui-surface-launch-panel.hidden');
		this.uiSurfaceSetupDashboard = this.createSurfaceSetupDashboard();
		this.uiSurfaceEmptyTitle = $('div.custom-mode-ui-surface-empty-title');
		this.uiSurfaceEmptySubtitle = $('div.custom-mode-ui-surface-empty-subtitle');
		this.uiSurfaceEmptyState = $('div.custom-mode-ui-surface-empty.hidden', undefined,
			$('div.custom-mode-ui-surface-empty-inner', undefined,
				this.uiSurfaceEmptyTitle,
				this.uiSurfaceEmptySubtitle
			)
		);
		this.uiBrowserShell.appendChild(this.uiSurfaceLaunchPanel);
		this.uiBrowserShell.appendChild(this.uiSurfaceSetupDashboard);
		this.uiBrowserShell.appendChild(this.uiSurfaceEmptyState);
		this.uiBrowserShell.appendChild(this.uiBrowser);

		this.uiMainColumn.appendChild(this.uiLandingBackdrop);
		this.uiMainColumn.appendChild(this.uiCallout);
		this.uiMainColumn.appendChild(this.uiSetup);
		this.uiMainColumn.appendChild(this.uiBrowserShell);
		this.uiContainer.appendChild(this.uiFeatureChecklistColumn);
		this.uiContainer.appendChild(this.uiMainColumn);

		this.uiChatContainer = $('div.custom-mode-embedded-chat.custom-mode-ui-side-chat');
		this.uiChatTitleEl = $('span', undefined, localize('customMode.uiChatTitle', 'AI chat'));
		this.uiChatTabSwitcher = $('div.custom-mode-ui-chat-tab-switcher', { role: 'tablist' });
		const uiChatCloseLabel = localize('customMode.uiChatClose', 'Close');
		const uiCloseBtn = $('button', { type: 'button', 'aria-label': uiChatCloseLabel, title: uiChatCloseLabel }, '\u2715') as HTMLButtonElement;
		const uiChatHeaderTop = $('div.custom-mode-ui-chat-header-top', undefined,
			this.uiChatTitleEl,
			uiCloseBtn
		);
		const uiChatHeader = $('div.custom-mode-ui-chat-header', undefined,
			uiChatHeaderTop,
			this.uiChatTabSwitcher
		);
		this.uiChatColumn = $('div.custom-mode-ui-chat-column', undefined, uiChatHeader, this.uiChatContainer);
		this.uiContainer.appendChild(this.uiChatColumn);

		this.uiChatReopenBtn = $('button.custom-mode-ui-chat-reopen', {
			type: 'button',
			title: localize('customMode.uiChatReopen', 'Open AI chat'),
			'aria-label': localize('customMode.uiChatReopen', 'Open AI chat'),
		}, localize('customMode.uiChatReopenShort', 'AI chat')) as HTMLButtonElement;
		this.uiContainer.appendChild(this.uiChatReopenBtn);

		this._register(addDisposableListener(uiCloseBtn, 'click', () => this.setUiChatDismissed(true)));
		this._register(addDisposableListener(this.uiChatReopenBtn, 'click', () => this.setUiChatDismissed(false)));

		SurfaceBlueprintOrchestrator.setRepairHandler(({ report, surfaceName, attempt }) => {
			const repairPrompt = localize(
				'customMode.surfaceBlueprintRepairPrompt',
				'The {0} surface blueprint verification failed (attempt {1}). Fix only the gaps below, then call verifySurfaceBlueprint again.\n\n{2}',
				surfaceName,
				attempt,
				report,
			);
			this.uiChatWidget.setInput(repairPrompt);
			this.uiChatWidget.focusInput();
		});
		SurfaceBlueprintOrchestrator.setRepairLimitHandler(({ surfaceName }) => {
			this.notificationService.warn(localize(
				'customMode.surfaceBlueprintRepairLimit',
				'Surface blueprint verification still has gaps for {0} after {1} repair attempts.',
				surfaceName,
				MAX_SURFACE_BLUEPRINT_REPAIR_ATTEMPTS,
			));
		});
		this._register(toDisposable(() => {
			SurfaceBlueprintOrchestrator.setRepairHandler(undefined);
			SurfaceBlueprintOrchestrator.setRepairLimitHandler(undefined);
		}));

		this.modeTopBar.appendChild(this.uiSurfaceSwitcher);
		const topBarSpacer = $('div.custom-mode-top-spacer');
		this.modeTopBar.appendChild(topBarSpacer);
		this.modeTopBar.appendChild(this.uiSelectionClearBtn);
		this.modeTopBar.appendChild(this.uiSelectionPill);
		this._register(toDisposable(() => {
			this.uiSurfaceSwitcher.remove();
			topBarSpacer.remove();
			this.uiSelectionPill.remove();
			this.uiSelectionClearBtn.remove();
		}));
		this._register(addDisposableListener(this.uiSelectionClearBtn, 'click', () => this.clearUiSelection()));

		this.processContainer = $('div.custom-mode-process-container');
		if (this._processChatDismissed) {
			this.processContainer.classList.add('custom-mode-process-chat-dismissed');
		}
		this.processMainColumn = $('div.custom-mode-process-main');
		this.processCallout = this.createDefaultProjectCallout(
			localize('customMode.processCalloutTitle', 'No project open'),
			localize('customMode.processCalloutSubtitle', 'Open the goal workspace example to inspect its code map and process context.'),
			() => this.defaultProjectService.openFallbackWorkspace(),
			localize('customMode.openGoalWorkspaceExample', 'Open Goal Workspace Example')
		);
		this.processStartHints = $('div.custom-mode-start-hints');
		this.processSetup = $('div.custom-mode-setup');
		this.processSetup.style.display = 'none';
		this.processIxWebHint = $('div.custom-mode-ix-webhint', undefined,
			localize('customMode.ixWebHint', 'Ix CLI automation (install, Docker, map, watch) runs only in the desktop application, not in the browser.'));
		this.processDockerBannerText = $('div.custom-mode-docker-banner-text');
		const processDockerBannerButton = $('button.custom-mode-callout-button', {
			type: 'button',
		}, localize('customMode.dockerDesktopDownload', 'Get Docker Desktop')) as HTMLButtonElement;
		this.processDockerBanner = $('div.custom-mode-docker-banner.hidden', undefined,
			this.processDockerBannerText,
			processDockerBannerButton,
		);
		this._register(addDisposableListener(processDockerBannerButton, 'click', () => {
			void this.openerService.open(URI.parse(DOCKER_DESKTOP_URL));
		}));

		this.processIxPipeline = $('div.custom-mode-ix-pipeline');
		this.processIxPipelineGlobalRow = $('div.custom-mode-ix-pipeline-global-row');
		this.processIxPipelineWorkspaceRows = $('div.custom-mode-ix-pipeline-workspace-rows');
		this.processIxPipeline.appendChild(this.processIxPipelineGlobalRow);
		this.processIxPipeline.appendChild(this.processIxPipelineWorkspaceRows);

		// Hide button: collapses the workspace steps cards (keeps the header visible so the user can re-show them).
		this.workspaceStepsHideButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('customMode.workspaceStepsHideBtn', 'Hide')) as HTMLButtonElement;

		// Process notes (generated via Ix + AI) with an interactive Cytoscape graph canvas.
		this.processNotesTopicSelect = $('select.custom-mode-process-notes-topic') as HTMLSelectElement;
		// Topic selection is driven by the card grid; keep the select offscreen as an internal state holder.
		this.processNotesTopicSelect.style.display = 'none';
		this.rebuildProcessNotesTopicSelectOptions(undefined);
		const backLabel = localize('customMode.processNotes.back', 'Back');
		const backDetailLabel = localize('customMode.processNotes.backDetail', 'Return to the system process list');
		this.processNotesBackButton = $('button.custom-mode-process-notes-back.hidden', {
			type: 'button',
			'aria-label': backDetailLabel,
			title: backDetailLabel,
		}, backLabel) as HTMLButtonElement;
		const generateLabel = localize('customMode.processNotes.generate', 'Generate');
		this.processNotesGenerateButton = $('button.custom-mode-process-notes-generate', {
			type: 'button',
			'aria-label': generateLabel,
			title: generateLabel,
		}, generateLabel) as HTMLButtonElement;
		const deleteLabel = localize('customMode.processNotes.delete', 'Delete');
		this.processNotesDeleteButton = $('button.custom-mode-process-notes-regenerate', {
			type: 'button',
			'aria-label': deleteLabel,
			title: deleteLabel,
		}, deleteLabel) as HTMLButtonElement;
		this.processNotesDeleteButton.disabled = true;
		this.processNotesCards = $('div.custom-mode-process-notes-cards');
		this.processNotesExpandedActions = $('div.custom-mode-process-notes-expanded-actions.hidden', undefined,
			this.processNotesGenerateButton,
			this.processNotesDeleteButton,
		);
		this.processNotesExpandedChrome = $('div.custom-mode-process-notes-expanded-chrome', undefined,
			this.processNotesBackButton,
			$('div.custom-mode-process-notes-expanded-spacer'),
		);
		this.processNotesLogs = $('pre.custom-mode-process-notes-logs');
		this.processNotesDetail = $('div.custom-mode-process-notes-detail.hidden');
		this.processNotesMarkdown = $('div.custom-mode-process-notes-markdown');
		this.processNotesGraphAnchor = $('div.custom-mode-process-notes-graph');
		this.processNotesPanel = $('div.custom-mode-process-notes', undefined,
			this.processNotesTopicSelect,
			this.processNotesExpandedChrome,
			this.processNotesCards,
			this.processNotesExpandedActions,
			this.processNotesDetail,
			this.processNotesLogs,
			this.processNotesMarkdown,
			this.processNotesGraphAnchor
		);

		const appRoot = this.nativeEnvironmentService.appRoot
			? URI.file(this.nativeEnvironmentService.appRoot)
			: URI.file(process.cwd());
		const cytoscapeRoot = URI.joinPath(appRoot, 'node_modules', 'cytoscape', 'dist');
		const layoutBaseRoot = URI.joinPath(appRoot, 'node_modules', 'layout-base');
		const coseBaseRoot = URI.joinPath(appRoot, 'node_modules', 'cose-base');
		const fcoseRoot = URI.joinPath(appRoot, 'node_modules', 'cytoscape-fcose');
		this.processNotesGraphView = this._register(new ProcessNotesCytoscapeView(
			this.webviewService,
			[cytoscapeRoot, layoutBaseRoot, coseBaseRoot, fcoseRoot],
			(msg: ProcessNotesGraphWebviewMessage) => this.onProcessNotesGraphMessage(msg),
		));

		// Attach the webview overlay to the placeholder element.
		this.processNotesGraphView.attach(this.processNotesGraphAnchor, this.processMainColumn);

		const cytoscapeUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(cytoscapeRoot, 'cytoscape.min.js'));
		const layoutBaseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(layoutBaseRoot, 'layout-base.js'));
		const coseBaseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(coseBaseRoot, 'cose-base.js'));
		const fcoseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(fcoseRoot, 'cytoscape-fcose.js'));
		this.processNotesGraphView.setHtml(cytoscapeUri, layoutBaseUri, coseBaseUri, fcoseUri);
		this.processNotesGraphView.setGraph({ nodes: [], edges: [] } satisfies ProcessNoteGraph);

		this.processMainContent = $('div.custom-mode-process-main-content');
		this.processMainContent.appendChild(this.processDockerBanner);
		this.processMainContent.appendChild(this.processCallout);
		this.processMainContent.appendChild(this.processSetup);
		this.processMainContent.appendChild(this.processIxWebHint);
		this.processMainContent.appendChild(this.processIxPipeline);
		this.processMainContent.appendChild(this.processNotesPanel);
		this.processMainColumn.appendChild(this.processMainContent);

		this.processContainer.appendChild(this.processMainColumn);

		this.processChatContainer = $('div.custom-mode-embedded-chat.custom-mode-process-side-chat');
		const processChatTitle = localize('customMode.processChatTitle', 'AI chat');
		const processChatCloseLabel = localize('customMode.processChatClose', 'Close');
		const processCloseBtn = $('button', { type: 'button', 'aria-label': processChatCloseLabel, title: processChatCloseLabel }, '\u2715') as HTMLButtonElement;
		const processChatHeader = $('div.custom-mode-process-chat-header', undefined,
			$('span', undefined, processChatTitle),
			processCloseBtn
		);
		this.processChatColumn = $('div.custom-mode-process-chat-column', undefined, processChatHeader, this.processChatContainer);
		this.processContainer.appendChild(this.processChatColumn);

		this.processChatReopenBtn = $('button.custom-mode-process-chat-reopen', {
			type: 'button',
			title: localize('customMode.processChatReopen', 'Open AI chat'),
			'aria-label': localize('customMode.processChatReopen', 'Open AI chat'),
		}, localize('customMode.processChatReopenShort', 'AI chat')) as HTMLButtonElement;
		this.processContainer.appendChild(this.processChatReopenBtn);

		this._register(addDisposableListener(processCloseBtn, 'click', () => this.setProcessChatDismissed(true)));
		this._register(addDisposableListener(this.processChatReopenBtn, 'click', () => this.setProcessChatDismissed(false)));
		this._register(addDisposableListener(this.processNotesGenerateButton, 'click', () => void this.generateProcessNoteFromPrompt()));
		this._register(addDisposableListener(this.processNotesDeleteButton, 'click', () => void this.deleteSelectedProcessNote()));
		// Dropdown removed from UI (selection happens via cards), but keep change handler for safety.
		this._register(addDisposableListener(this.processNotesTopicSelect, 'change', () => void this.loadSelectedProcessNote()));
		this._register(addDisposableListener(this.processNotesBackButton, 'click', () => this.showProcessNotesOverview()));
		this.updateProcessNotesLogText();
		this._register(addDisposableListener(this.workspaceStepsHideButton, 'click', () => {
			this.setWorkspaceStepsHidden(!this.workspaceStepsHidden);
		}));

		this.modeSurface.appendChild(this.uiContainer);
		this.modeSurface.appendChild(this.processContainer);
		this.container.appendChild(this.modeSurface);

		this.startupGuidePanel = this._register(new SetupGuidePanel(
			this.processContainer,
			this.startupGuideService,
			{
				title: localize('startupGuide.title', 'Startup setup'),
				subtitle: localize('startupGuide.subtitle', 'Complete these steps to use Process mode, Ix, and the default project.'),
			},
		));
		this.appLaunchGuidePanel = this._register(new SetupGuidePanel(
			this.uiContainer,
			this.appLaunchGuideService,
			{
				title: localize('appLaunchGuide.title', 'App Launch'),
				subtitle: localize('appLaunchGuide.subtitle', 'Complete these steps to run the open-folder app on localhost and load it in the preview.'),
			},
		));
		this._register(this.startupGuideService.onDidChangeState(() => this.syncTabGuides(this.modeService.getMode())));
		this._register(this.appLaunchGuideService.onDidChangeState(() => this.syncTabGuides(this.modeService.getMode())));

		// Create embedded chat widgets for UI/Process.
		this.uiChatWidget = this.createEmbeddedChatWidget(this.uiChatContainer, 'customModeShellUI');
		this.processChatWidget = this.createEmbeddedChatWidget(this.processChatContainer, 'customModeShellProcess', 'how does the scrape videos process work');

		this.updateMode(this.modeService.getMode());
		this.syncContextGatheringUi();
		this._register(this.modeService.onDidChange(mode => this.updateMode(mode)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this.surfacePortsFreedAtStartup = false;
			this.updateProjectState();
		}));
		this._register(this.consoleService.onDidChangeWorkspace(() => {
			this.syncGoalSurfaceSwitcher();
			void this.refreshSurfaceSetupDashboard();
		}));
		this._register(this.devServerService.onDidChangeActiveUrl(url => {
			if (!url) {
				return;
			}
			if (this.getSelectedSurface()) {
				return;
			}
			// IMPORTANT: Don't set both property + attribute on <webview>.
			// Doing so can cause a navigation to be canceled by a subsequent
			// navigation, which shows up as ERR_ABORTED (-3).
			if (!this.embeddedUiShowsUrl(url)) {
				this.setEmbeddedUiUrl(url);
			}
		}));
		this._register(this.devServerService.onDidChangeState(state => this.updateDevServerDebug(state)));
		this._register(this.ixIntegrationService.onDidChangeState(state => this.updateIxDebug(state)));
		if (!isWeb) {
			this._register(this.dockerAvailabilityService.onDidChangeStatus(() => this.updateProcessDockerBanner()));
			void this.dockerAvailabilityService.refresh().then(() => this.updateProcessDockerBanner());
		}

		this.updateProjectState();
		this.syncGoalSurfaceSwitcher();
		this.updateDevServerDebug(this.devServerService.getState());
		this.updateIxDebug(this.ixIntegrationService.getState());
		// Start the (UI-rendering) discovery only after Process notes UI exists.
		void this.loadProcessNotesSuggestions();
		void this.loadSelectedProcessNote().then(() => this.showProcessNotesOverview());
		this.updateReachabilityFromState(this.devServerService.getState());

		this._register(addDisposableListener(this.uiStartAppButton, 'click', () => this.onStartAppClicked()));
		this._register(addDisposableListener(mainWindow, 'message', (e: MessageEvent) => this.onEmbeddedUiMessage(e)));
		this._register(addDisposableListener(mainWindow, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this.container.classList.contains('custom-mode-ui-landing-open')) {
				this.closeGoalWorkspaceLanding();
			}
		}));

		// Best-effort injection into same-origin iframe content.
		// If cross-origin, the embedded app must include the script itself.
		if (isWeb) {
			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'load', () => this.tryInjectIntoIframe()));
		}

		// Forward webview console/errors into the debug panel (desktop only).
		if (!isWeb && this.isWebviewElement(this.uiBrowser)) {
			const webview = this.uiBrowser as unknown as {
				addEventListener: (type: string, listener: (e: unknown) => void) => void;
				executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
			};

			const log = (type: string, detail?: string) => this.pushUiRuntimeLog(`[webview:${type}]${detail ? ` ${detail}` : ''}`);
			const asRecord = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object') ? (v as Record<string, unknown>) : undefined;

			webview.addEventListener('did-start-loading', () => log('did-start-loading'));
			webview.addEventListener('did-stop-loading', () => log('did-stop-loading'));
			webview.addEventListener('did-finish-load', () => log('did-finish-load'));
			webview.addEventListener('dom-ready', async () => {
				log('dom-ready');
				try {
					await webview.executeJavaScript?.(this.uiClickOverlayScript);
					log('inject-click-overlay');
				} catch (e: unknown) {
					const err = e as { message?: string } | undefined;
					log('inject-failed', String(err?.message ?? e));
				}
			});
			webview.addEventListener('did-navigate', (e: unknown) => log('did-navigate', asRecord(e)?.url ? String(asRecord(e)?.url) : undefined));
			webview.addEventListener('did-navigate-in-page', (e: unknown) => log('did-navigate-in-page', asRecord(e)?.url ? String(asRecord(e)?.url) : undefined));

			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'console-message', (e: unknown) => {
				const evt = asRecord(e);
				const msg = evt?.message ?? '';
				const level = evt?.level ?? '';
				const line = typeof evt?.line === 'number' ? `:${evt.line}` : '';
				const source = evt?.sourceId ? ` (${String(evt.sourceId)}${line})` : '';
				// Parse click overlay marker emitted from inside <webview>.
				if (typeof msg === 'string' && (msg.startsWith('__VSCODE_UI_CLICK__') || msg.startsWith('__VSCODE_UI_ENV__') || msg.startsWith('__VSCODE_UI_SELECTION__'))) {
					try {
						const json = msg.startsWith('__VSCODE_UI_ENV__')
							? msg.slice('__VSCODE_UI_ENV__'.length)
							: msg.startsWith('__VSCODE_UI_SELECTION__')
								? msg.slice('__VSCODE_UI_SELECTION__'.length)
								: msg.slice('__VSCODE_UI_CLICK__'.length);
						const data = JSON.parse(json) as UiClickOverlayMessage;
						this.onEmbeddedUiMessage(new MessageEvent<UiClickOverlayMessage>('message', { data }));
						return;
					} catch {
						// fall through and log raw
					}
				}

				this.pushUiRuntimeLog(`[console${level ? `:${level}` : ''}] ${msg}${source}`);
			}));

			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'did-fail-load', (e: unknown) => {
				const evt = asRecord(e);
				const url = typeof evt?.validatedURL === 'string' ? evt.validatedURL : '';
				const desc = evt?.errorDescription ?? evt?.errorCode ?? 'load failed';
				// ERR_ABORTED (-3) is emitted when a navigation is intentionally interrupted
				// (e.g. subsequent src update). Don't treat it as a real error.
				if (evt?.errorCode === -3 || String(desc).includes('ERR_ABORTED')) {
					return;
				}
				this.pushUiRuntimeLog(`[load-failed] ${desc}${url ? ` (${url})` : ''}`);
			}));
		}

		if (!isWeb) {
			const tabGuideScheduler = this._register(new RunOnceScheduler(() => {
				void Promise.all([
					this.startupGuideService.refresh(),
					this.appLaunchGuideService.refresh(),
				]).then(() => this.syncTabGuides(this.modeService.getMode(), true));
			}, 1200));
			tabGuideScheduler.schedule();
		}
	}

	private syncTabGuides(mode: Mode, allowAutoRun = false): void {
		if (isWeb) {
			return;
		}

		const onProcess = mode === 'Process';
		const onUi = mode === 'UI';

		this.appLaunchGuidePanel.syncForTab(onUi);
		this.startupGuidePanel.syncForTab(onProcess);

		if (!allowAutoRun || this.tabGuideAutoRunAttempted) {
			return;
		}

		if (onProcess && this.startupGuidePanel.isVisible()
			&& Boolean(this.configurationService.getValue<boolean>('custom.startupGuide.autoRun') ?? true)) {
			this.tabGuideAutoRunAttempted = true;
			void this.startupGuideService.runAutomaticFixes();
			return;
		}

		if (onUi && this.appLaunchGuidePanel.isVisible()
			&& Boolean(this.configurationService.getValue<boolean>('custom.appLaunchGuide.autoRun') ?? true)) {
			this.tabGuideAutoRunAttempted = true;
			void this.appLaunchGuideService.runAutomaticFixes();
		}
	}

	private onEmbeddedUiMessage(e: MessageEvent): void {
		const data = e.data as UiClickOverlayMessage | undefined;
		if (!data) {
			return;
		}

		if (data.type === 'vscode-ui-env') {
			const fw = data.framework ? ` framework=${data.framework}` : '';
			const src = typeof data.vscodeSrcElements === 'number' ? ` vscodeSrcElements=${data.vscodeSrcElements}` : '';
			this.pushUiRuntimeLog(`[ui-env]${fw}${src} href=${data.href}`);
			return;
		}

		if (data.type === 'vscode-ui-click') {
			// For now, log into the debug panel (UI Runtime section).
			const target = data.target?.tag ? `${data.target.tag}${data.target.id ? `#${data.target.id}` : ''}` : 'unknown';
			const source = data.source ? ` source=${data.source}` : '';
			const vscodeSrc = data.vscodeSrc ? ` vscodeSrc=${data.vscodeSrc}` : '';
			this.pushUiRuntimeLog(`[ui-click] ${target}${source}${vscodeSrc} href=${data.href}`);

			if (data.modifiers?.shiftKey && data.vscodeSrc) {
				this.modeService.setMode('Code');
				void this.openEditorForVscodeSrc(data.vscodeSrc);
			}
			return;
		}

		if (data.type === 'vscode-ui-selection') {
			const items = Array.isArray(data.items) ? data.items : [];
			this.pushUiRuntimeLog(`[ui-selection] ${items.length} mapped item(s) href=${data.href}`);
			this.setUiSelectionCount(items.length);
			void this.injectUiMappedSelectionIntoChat(items);
			return;
		}
	}

	/** Removes file attachments injected from UI marquee mapping (`vscode-ui-map:` ids). */
	private removeUiMappedInjectedChatAttachments(): void {
		try {
			if (!this.embeddedChatRefs.UI.value) {
				return;
			}
			const attachmentModel = this.uiChatWidget.input.attachmentModel;
			const toDelete = attachmentModel.attachments
				.filter(a => a.id.startsWith('vscode-ui-map:'))
				.map(a => a.id);
			if (toDelete.length > 0) {
				attachmentModel.delete(...toDelete);
			}
		} catch {
			// Chat session may not be bound yet.
		}
	}

	private resolveVscodeSrcToWorkspaceResource(vscodeSrc: string, logPrefix: string): { resource: URI; line: number; column: number } | undefined {
		const trimmed = vscodeSrc.trim();
		const m = /^(.+):(\d+):(\d+)$/.exec(trimmed);
		if (!m) {
			this.pushUiRuntimeLog(`${logPrefix} bad vscodeSrc (expected path:line:col): ${trimmed}`);
			return undefined;
		}

		const filePath = m[1];
		const line = Number(m[2]);
		const column = Number(m[3]);
		if (!Number.isFinite(line) || !Number.isFinite(column) || line < 1 || column < 1) {
			this.pushUiRuntimeLog(`${logPrefix} bad line/column in vscodeSrc: ${trimmed}`);
			return undefined;
		}

		const folders = this.workspaceContextService.getWorkspace().folders;
		if (!folders.length) {
			this.pushUiRuntimeLog(`${logPrefix} no workspace folder`);
			return undefined;
		}

		const isAbsolutePosix = filePath.startsWith('/');
		const isAbsoluteWin = /^[a-zA-Z]:[\\/]/.test(filePath);
		let resource: URI | undefined;

		if (isAbsolutePosix || isAbsoluteWin) {
			const candidate = URI.file(filePath);
			resource = folders.find(f => isEqualOrParent(candidate, f.uri, true)) ? candidate : undefined;
		} else {
			for (const folder of folders) {
				const candidate = resolvePath(folder.uri, filePath);
				if (isEqualOrParent(candidate, folder.uri, true)) {
					resource = candidate;
					break;
				}
			}
		}

		if (!resource) {
			this.pushUiRuntimeLog(`${logPrefix} could not resolve ${filePath} within the workspace`);
			return undefined;
		}

		return { resource, line, column };
	}

	private async injectUiMappedSelectionIntoChat(items: ReadonlyArray<{ vscodeSrc: string; tag?: string; text?: string }>): Promise<void> {
		if (items.length === 0) {
			return;
		}
		try {
			await this.ensureEmbeddedChatModel('UI', this.getActiveUISurfaceChatKey());
		} catch {
			return;
		}
		if (!this.embeddedChatRefs.UI.value) {
			this.pushUiRuntimeLog('[ui-selection:chat] UI chat session not available');
			return;
		}
		this.removeUiMappedInjectedChatAttachments();
		const attachmentModel = this.uiChatWidget.input.attachmentModel;
		const seenUris = new Set<string>();
		let added = 0;
		for (const it of items) {
			const resolved = this.resolveVscodeSrcToWorkspaceResource(it.vscodeSrc, '[ui-selection:chat]');
			if (!resolved) {
				continue;
			}
			const uriKey = resolved.resource.toString();
			if (seenUris.has(uriKey)) {
				continue;
			}
			seenUris.add(uriKey);
			const range: IRange = {
				startLineNumber: resolved.line,
				startColumn: resolved.column,
				endLineNumber: resolved.line,
				endColumn: resolved.column,
			};
			try {
				// One attachment per workspace file (first mapped node in DOM order). Id matches resource so re-marquee does not duplicate chips.
				const id = `vscode-ui-map:${uriKey}`;
				const fileEntry: IChatRequestFileEntry = {
					kind: 'file',
					value: { uri: resolved.resource, range },
					id,
					name: `${basename(resolved.resource)} (${resolved.line}:${resolved.column})`,
				};
				attachmentModel.addContext(fileEntry);
				added++;
			} catch (e: unknown) {
				this.pushUiRuntimeLog(`[ui-selection:chat] addContext failed ${resolved.resource.fsPath}: ${String((e as Error)?.message ?? e)}`);
			}
		}
		if (added > 0) {
			this.uiChatWidget.focusInput();
			this.pushUiRuntimeLog(`[ui-selection:chat] attached ${added} file context(s) to UI chat`);
		}
	}

	private async openEditorForVscodeSrc(vscodeSrc: string): Promise<void> {
		const resolved = this.resolveVscodeSrcToWorkspaceResource(vscodeSrc, '[ui-click:open]');
		if (!resolved) {
			return;
		}

		const { resource, line, column } = resolved;
		try {
			await this.editorService.openEditor({
				resource,
				options: {
					pinned: false,
					revealIfOpened: true,
					selection: { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column }
				}
			});
			this.pushUiRuntimeLog(`[ui-click:open] ${resource.fsPath}:${line}:${column}`);
		} catch (e: unknown) {
			this.pushUiRuntimeLog(`[ui-click:open] failed: ${String((e as Error)?.message ?? e)}`);
		}
	}

	private tryInjectIntoIframe(): void {
		try {
			// Only works when same-origin; accessing contentDocument will throw otherwise.
			const iframe = this.uiBrowser as unknown as HTMLIFrameElement;
			const doc = iframe.contentDocument;
			if (!doc) {
				return;
			}

			// Avoid double-injecting.
			if (doc.documentElement?.dataset?.vscodeClickOverlayInjected === 'true') {
				return;
			}
			if (doc.documentElement?.dataset) {
				doc.documentElement.dataset.vscodeClickOverlayInjected = 'true';
			}

			const script = doc.createElement('script');
			script.type = 'text/javascript';
			script.textContent = this.uiClickOverlayScript;
			(doc.head || doc.documentElement).appendChild(script);
		} catch {
			// cross-origin or not ready; ignore
		}
	}

	private updateProcessDockerBanner(): void {
		if (isWeb) {
			this.processDockerBanner.classList.add('hidden');
			return;
		}
		const status = this.dockerAvailabilityService.getStatus();
		if (status === DockerAvailabilityStatus.Missing) {
			this.processDockerBannerText.textContent = localize(
				'customMode.dockerDesktopBannerMissing',
				'Docker Desktop is required for Ix and Docker MCP on the Process tab. Install Docker Desktop, start it, and keep it running.',
			);
			this.processDockerBanner.classList.remove('hidden');
			return;
		}
		if (status === DockerAvailabilityStatus.McpToolkitMissing) {
			this.processDockerBannerText.textContent = localize(
				'customMode.dockerDesktopBannerMcpToolkit',
				'Docker is installed, but MCP Toolkit is not enabled. Open Docker Desktop → Settings → Beta features → enable Docker MCP Toolkit, then reload this window.',
			);
			this.processDockerBanner.classList.remove('hidden');
			return;
		}
		this.processDockerBanner.classList.add('hidden');
	}

	private updateMode(mode: Mode): void {
		for (const [itemMode, button] of this.topModeButtons) {
			const isActive = itemMode === mode;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-selected', String(isActive));
		}

		this.container.classList.toggle('custom-mode-ui', mode === 'UI');
		this.container.classList.toggle('custom-mode-process', mode === 'Process');
		this.container.classList.toggle('custom-mode-code', mode === 'Code');

		if (mode !== 'Process') {
			this.ixPipelineDurationTicker.clear();
		} else {
			if (this.lastIxPipelineState) {
				this.refreshIxPipelineTicker(this.lastIxPipelineState);
			}
			if (!isWeb) {
				void this.dockerAvailabilityService.refresh().then(() => this.updateProcessDockerBanner());
			}
		}
		this.updateProcessDockerBanner();

		const isUi = mode === 'UI';
		this.uiContainer.classList.toggle('visible', isUi);
		this.processContainer.classList.toggle('visible', mode === 'Process');

		// Embedded chat in UI/Process; keep sidebar chat session switching for Code only.
		void this.updateEmbeddedChat(mode);
		if (mode === 'Code') {
			void this.chatSessionManager.openSessionForMode(mode, this.chatSessionsCts.token);
		}

		this.syncTabGuides(mode);

		if (isUi) {
			this.routeSelectedSurfacePreview();
			this.scheduleEmbeddedUiDevServerProbe();
		} else {
			this.uiDevServerProbeScheduler.cancel();
		}

		// UI/Process hide `.monaco-grid-view` (display:none). Re-layout when switching back to Code
		// so the integrated terminal picks up the real panel width instead of stale cols.
		this.scheduleWorkbenchRelayout();
	}

	private setupGridResizeRelayout(): void {
		const gridView = this.container.querySelector(':scope > .monaco-grid-view');
		if (!(gridView instanceof HTMLElement)) {
			queueMicrotask(() => this.scheduleWorkbenchRelayout());
			return;
		}

		let lastObservedWidth = 0;
		let lastObservedHeight = 0;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const width = Math.round(entry?.contentRect?.width ?? 0);
			const height = Math.round(entry?.contentRect?.height ?? 0);
			if (width <= 0 || height <= 0) {
				return;
			}
			if (width === lastObservedWidth && height === lastObservedHeight) {
				return;
			}
			lastObservedWidth = width;
			lastObservedHeight = height;
			this.scheduleWorkbenchRelayout();
		});
		observer.observe(gridView);
		this._register(toDisposable(() => observer.disconnect()));
		queueMicrotask(() => this.scheduleWorkbenchRelayout());
	}

	private scheduleWorkbenchRelayout(): void {
		queueMicrotask(() => {
			this.layoutService.layout();
			mainWindow.requestAnimationFrame(() => {
				this.layoutService.layout();
				if (this.modeService.getMode() === 'Code') {
					this.relayoutTerminalInstances();
				}
			});
		});
	}

	private relayoutTerminalInstances(): void {
		for (const instance of this.terminalService.instances) {
			const container = instance.domElement?.parentElement;
			if (!(container instanceof HTMLElement)) {
				continue;
			}
			const width = container.clientWidth;
			const height = container.clientHeight;
			if (width > 0 && height > 0) {
				instance.layout({ width, height });
			}
		}
	}

	private scheduleEmbeddedUiDevServerProbe(): void {
		if (isWeb || this.modeService.getMode() !== 'UI') {
			return;
		}
		if (this.getSelectedSurface()) {
			return;
		}
		const hints = this.lastUiStartHints;
		if (hints && !hints.primaryRunCommand) {
			return;
		}
		void this.probeEmbeddedUiDevServer().finally(() => {
			if (this.modeService.getMode() !== 'UI') {
				return;
			}
			const current = this.getEmbeddedUiUrl();
			const activeUrl = this.devServerService.getActiveUrl();
			const needsProbe = !activeUrl
				|| !this.appReachable
				|| !current
				|| current === 'about:blank'
				|| (activeUrl && !this.embeddedUiShowsUrl(activeUrl));
			if (needsProbe) {
				this.uiDevServerProbeScheduler.schedule();
			}
		});
	}

	private async probeEmbeddedUiDevServer(): Promise<void> {
		if (this.getSelectedSurface()) {
			return;
		}
		const hints = await this.devServerService.getSuggestedStartCommands();
		if (!hints?.primaryRunCommand) {
			return;
		}
		const url = await this.devServerService.syncActiveUrlFromProbe();
		if (!url || this.modeService.getMode() !== 'UI') {
			return;
		}
		if (!this.embeddedUiShowsUrl(url)) {
			this.setEmbeddedUiUrl(url);
		}
	}

	private createEmbeddedChatWidget(container: HTMLElement, viewId: string, defaultInput?: string): ChatWidget {
		const scopedContextKeyService = this._register(this.contextKeyService.createScoped(container)) as IScopedContextKeyService;
		const scopedInstantiationService = this._register(this.instantiationService.createChild(
			new ServiceCollection([
				IContextKeyService,
				scopedContextKeyService
			])
		));

		const widget = this._register(
			scopedInstantiationService.createInstance(
				ChatWidget,
				ChatAgentLocation.Chat,
				{ viewId },
				{
					autoScroll: mode => mode !== ChatModeKind.Ask,
					renderFollowups: true,
					inputEditorMinLines: 1,
					supportsFileReferences: true,
					enableImplicitContext: true,
					enableWorkingSet: 'explicit',
					clear: async () => { /* noop */ },
					dndContainer: container,
				},
				{
					listForeground: editorForeground,
					listBackground: editorBackground,
					overlayBackground: EDITOR_DRAG_AND_DROP_BACKGROUND,
					inputEditorBackground: inputBackground,
					resultEditorBackground: editorBackground
				}
			)
		);

		widget.render(container);
		if (defaultInput && widget.getInput().trim().length === 0) {
			widget.setInput(defaultInput);
		}

		const defaultStripHeightPx = 120;
		const layoutEmbeddedChat = () => {
			if (!container.classList.contains('visible')) {
				return;
			}
			const host = container.parentElement;
			const w = Math.max(0, container.clientWidth || host?.clientWidth || 0);
			// Strip height fallback, or UI/Process right-panel chat column height minus header.
			const measured = container.clientHeight;
			let h = measured;
			if (h <= 0) {
				if (container.classList.contains('custom-mode-process-side-chat') && host && host.clientHeight > 0) {
					const headerEl = host.querySelector('.custom-mode-process-chat-header');
					const headerH = headerEl instanceof HTMLElement ? headerEl.clientHeight : 40;
					h = Math.max(120, host.clientHeight - headerH);
				} else if (container.classList.contains('custom-mode-ui-side-chat') && host && host.clientHeight > 0) {
					const headerEl = host.querySelector('.custom-mode-ui-chat-header');
					const headerH = headerEl instanceof HTMLElement ? headerEl.clientHeight : 40;
					h = Math.max(120, host.clientHeight - headerH);
				} else {
					h = defaultStripHeightPx;
				}
			}
			if (w > 0 && h > 0) {
				widget.layout(h, w);
			}
		};

		const ro = new ResizeObserver(() => layoutEmbeddedChat());
		if (container.parentElement) {
			ro.observe(container.parentElement);
		}
		ro.observe(container);
		this._register(toDisposable(() => ro.disconnect()));
		queueMicrotask(() => layoutEmbeddedChat());

		return widget;
	}

	private setUiChatDismissed(dismissed: boolean): void {
		if (this._uiChatDismissed === dismissed) {
			return;
		}
		this._uiChatDismissed = dismissed;
		this.uiContainer.classList.toggle('custom-mode-ui-chat-dismissed', dismissed);
		this.storageService.store(STORAGE_UI_CHAT_DISMISSED, dismissed ? '1' : '0', StorageScope.PROFILE, StorageTarget.USER);
		if (dismissed) {
			this.endSurfaceSetupHandoff();
		}
		const inUi = this.modeService.getMode() === 'UI';
		const showUiChat = inUi && !dismissed;
		this.uiChatContainer.classList.toggle('visible', showUiChat);
		this.uiChatWidget.setVisible(showUiChat);
		this.syncHandoffChatPlacement();
		queueMicrotask(() => this.layoutService.layout());
	}

	private setProcessChatDismissed(dismissed: boolean): void {
		if (this._processChatDismissed === dismissed) {
			return;
		}
		this._processChatDismissed = dismissed;
		this.processContainer.classList.toggle('custom-mode-process-chat-dismissed', dismissed);
		this.storageService.store(STORAGE_PROCESS_CHAT_DISMISSED, dismissed ? '1' : '0', StorageScope.PROFILE, StorageTarget.USER);
		const inProcess = this.modeService.getMode() === 'Process';
		const showProcessChat = inProcess && !dismissed;
		this.processChatContainer.classList.toggle('visible', showProcessChat);
		this.processChatWidget.setVisible(showProcessChat);
		queueMicrotask(() => this.layoutService.layout());
	}

	private async updateEmbeddedChat(mode: Mode): Promise<void> {
		const showUi = mode === 'UI';
		const showProcess = mode === 'Process';
		const uiChatOpen = showUi && !this._uiChatDismissed;
		this.uiChatContainer.classList.toggle('visible', uiChatOpen);
		const processChatOpen = showProcess && !this._processChatDismissed;
		this.processChatContainer.classList.toggle('visible', processChatOpen);

		if (showUi) {
			this.syncActiveUiChatSurfaceId(this.consoleService.getSurfaces());
			this.renderUiChatTabs();
			await this.ensureEmbeddedChatModel('UI', this.getActiveUISurfaceChatKey());
		} else if (showProcess) {
			await this.ensureEmbeddedChatModel('Process');
		}

		this.uiChatWidget.setVisible(uiChatOpen);
		this.processChatWidget.setVisible(processChatOpen);
		this.syncHandoffChatPlacement();
		if (mode === 'Code') {
			this.endSurfaceSetupHandoff();
		}
	}

	private getActiveUISurfaceChatKey(): string {
		return this.activeUiChatSurfaceId ?? this.selectedSurfaceId ?? ADD_SURFACE_ID;
	}

	private getUiChatSurfaceLabel(surfaceId: string): string {
		return surfaceId === ADD_SURFACE_ID
			? localize('customMode.consoleTab', 'Console')
			: (this.consoleService.getSurface(surfaceId)?.name ?? surfaceId);
	}

	private syncActiveUiChatSurfaceId(surfaces: readonly WorkspaceSurface[]): void {
		const validIds = new Set<string>([ADD_SURFACE_ID, ...surfaces.map(surface => surface.id)]);
		if (this.activeUiChatSurfaceId && validIds.has(this.activeUiChatSurfaceId)) {
			return;
		}
		const fallback = this.selectedSurfaceId && validIds.has(this.selectedSurfaceId)
			? this.selectedSurfaceId
			: (surfaces[0]?.id ?? ADD_SURFACE_ID);
		this.activeUiChatSurfaceId = fallback;
		this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, fallback, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private renderUiChatTabs(): void {
		const surfaces = this.consoleService.getSurfaces();
		const activeId = this.getActiveUISurfaceChatKey();
		const entries: Array<{ id: string; label: string }> = [
			{ id: ADD_SURFACE_ID, label: this.getUiChatSurfaceLabel(ADD_SURFACE_ID) },
			...surfaces.map(surface => ({ id: surface.id, label: surface.name })),
		];

		const nextButtons = new Map<string, HTMLButtonElement>();
		const fragment = document.createDocumentFragment();
		for (const entry of entries) {
			let button = this.uiChatTabButtons.get(entry.id);
			if (!button) {
				const surfaceId = entry.id;
				button = $('button.custom-mode-ui-chat-tab-button', {
					type: 'button',
					role: 'tab',
				}) as HTMLButtonElement;
				this._register(addDisposableListener(button, 'click', () => this.selectUiChatSurface(surfaceId)));
			}
			const isActive = entry.id === activeId;
			button.textContent = entry.label;
			button.title = localize('customMode.uiChatTabTitle', 'Open {0} chat', entry.label);
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-selected', String(isActive));
			nextButtons.set(entry.id, button);
			fragment.appendChild(button);
		}

		this.uiChatTabButtons.clear();
		for (const [id, button] of nextButtons) {
			this.uiChatTabButtons.set(id, button);
		}
		this.uiChatTabSwitcher.replaceChildren(fragment);
	}

	private selectUiChatSurface(surfaceId: string): void {
		void this.selectUiChatSurfaceAsync(surfaceId);
	}

	private async selectUiChatSurfaceAsync(surfaceId: string): Promise<void> {
		this.activeUiChatSurfaceId = surfaceId;
		this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
		this.renderUiChatTabs();
		await this.ensureEmbeddedChatModel('UI', surfaceId);
	}

	private setActiveUiChatSurfaceFromSurfaceTab(surfaceId: string): void {
		this.activeUiChatSurfaceId = surfaceId;
		this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
		this.renderUiChatTabs();
		if (this.modeService.getMode() === 'UI') {
			void this.ensureEmbeddedChatModel('UI', surfaceId);
		}
	}

	async refreshEmbeddedChatForCurrentMode(): Promise<void> {
		await this.updateEmbeddedChat(this.modeService.getMode());
	}

	private async ensureEmbeddedChatModel(mode: 'UI' | 'Process', surfaceId?: string): Promise<void> {
		const token = this.chatSessionsCts.token;
		const resource = mode === 'UI'
			? this.chatSessionManager.getOrCreateUISurfaceSessionResource(surfaceId ?? this.getActiveUISurfaceChatKey())
			: this.chatSessionManager.getOrCreateSessionResource(mode);
		const ref = await this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, token, `ModeShellContribution#ensureEmbeddedChatModel(${mode})`);
		if (!ref) {
			return;
		}

		const holder = this.embeddedChatRefs[mode];
		holder.value?.dispose();
		holder.value = ref;

		const widget = mode === 'UI' ? this.uiChatWidget : this.processChatWidget;
		widget.setModel(ref.object);
	}

	private refreshUiChatTabsAndSession(): void {
		const surfaces = this.consoleService.getSurfaces();
		this.syncActiveUiChatSurfaceId(surfaces);
		this.renderUiChatTabs();
		if (this.modeService.getMode() === 'UI') {
			void this.ensureEmbeddedChatModel('UI', this.getActiveUISurfaceChatKey());
		}
	}

	private updateProjectState(): void {
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		this.container.classList.toggle('custom-mode-shell-hasProject', hasProject);
		this.updateUiProjectName();
		this.refreshStartCommandHints();
	}

	private createSurfaceSetupDashboard(): HTMLElement {
		const starterGrid = $('div.custom-mode-ui-surface-starter-grid');
		for (const starter of STARTER_SURFACES) {
			starterGrid.appendChild(this.createStarterSurfaceCard(starter));
		}
		starterGrid.appendChild(this.createNewSurfaceCard());
		this.uiStartAllSurfacesButton = $('button.custom-mode-start-all-surfaces', { type: 'button' }, localize('customMode.startAllSurfaces', 'Start all surfaces')) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiStartAllSurfacesButton, 'click', () => void this.onStartAllSurfacesClicked()));
		const starterButtons = $('div.custom-mode-ui-surface-starters', undefined,
			$('div.custom-mode-ui-surface-starters-header', undefined,
				$('div.custom-mode-ui-surface-starters-title', undefined, localize('customMode.surfaceSetupStartersTitle', 'Surfaces')),
				$('div.custom-mode-ui-surface-starters-subtitle', undefined, localize('customMode.surfaceSetupStartersSubtitle', 'Choose where to start. Each surface becomes a deployable app in your workspace.')),
				this.uiStartAllSurfacesButton,
			),
			starterGrid,
		);

		this.uiSurfaceSetupGoalNameInput = $('input.custom-mode-ui-surface-goal-input', {
			type: 'text',
			placeholder: localize('customMode.surfaceSetupGoalNamePlaceholder', 'e.g. Summit Coaching Co.'),
			'aria-label': localize('customMode.surfaceSetupGoalNameAria', 'Business name'),
		}) as HTMLInputElement;
		this.uiSurfaceSetupGoalDescriptionInput = $('textarea.custom-mode-ui-surface-goal-textarea', {
			placeholder: localize('customMode.surfaceSetupGoalDescriptionPlaceholder', 'Describe what this business does and who it serves.'),
			'aria-label': localize('customMode.surfaceSetupGoalDescriptionAria', 'Business description'),
			rows: '3',
		}) as HTMLTextAreaElement;
		for (const input of [this.uiSurfaceSetupGoalNameInput, this.uiSurfaceSetupGoalDescriptionInput]) {
			this._register(addDisposableListener(input, 'input', () => this.scheduleSurfaceSetupAutosave()));
		}

		this.uiSurfaceSetupPrimaryColorInput = this.createBrandColorInput('#2563eb');
		this.uiSurfaceSetupSecondaryColorInput = this.createBrandColorInput('#0f172a');
		this.uiSurfaceSetupAccentColorInput = this.createBrandColorInput('#f59e0b');
		const brandColors = $('div.custom-mode-ui-surface-brand-colors', undefined,
			this.createBrandColorField(localize('customMode.surfaceSetupBrandPrimary', 'Primary'), this.uiSurfaceSetupPrimaryColorInput),
			this.createBrandColorField(localize('customMode.surfaceSetupBrandSecondary', 'Secondary'), this.uiSurfaceSetupSecondaryColorInput),
			this.createBrandColorField(localize('customMode.surfaceSetupBrandAccent', 'Accent'), this.uiSurfaceSetupAccentColorInput),
		);

		const logoDropzone = this.createBrandLogoDropzone('logo');
		this.uiSurfaceSetupLogoDropzone = logoDropzone.dropzone;
		this.uiSurfaceSetupLogoPreview = logoDropzone.preview;
		const logoMarkDropzone = this.createBrandLogoDropzone('mark');
		this.uiSurfaceSetupLogoMarkDropzone = logoMarkDropzone.dropzone;
		this.uiSurfaceSetupLogoMarkPreview = logoMarkDropzone.preview;

		const goalSection = $('section.custom-mode-ui-surface-setup-section', { id: 'surface-setup-section-goal', 'data-section': 'goal' },
			$('div.custom-mode-ui-surface-goal-form', undefined,
				$('label.custom-mode-ui-surface-goal-field', undefined,
					$('span.custom-mode-ui-surface-goal-label', undefined, localize('customMode.surfaceSetupGoalNameLabel', 'Business name')),
					this.uiSurfaceSetupGoalNameInput
				),
				$('label.custom-mode-ui-surface-goal-field', undefined,
					$('span.custom-mode-ui-surface-goal-label', undefined, localize('customMode.surfaceSetupGoalDescriptionLabel', 'Description')),
					this.uiSurfaceSetupGoalDescriptionInput
				)
			)
		);
		const brandSection = $('section.custom-mode-ui-surface-setup-section', { id: 'surface-setup-section-brand', 'data-section': 'brand' },
			$('div.custom-mode-ui-surface-brand-logos', undefined,
				$('div.custom-mode-ui-surface-brand-logo-slot', undefined,
					$('div.custom-mode-ui-surface-brand-logo-label', undefined, localize('customMode.surfaceSetupBrandLogo', 'Logo')),
					this.uiSurfaceSetupLogoDropzone
				),
				$('div.custom-mode-ui-surface-brand-logo-slot', undefined,
					$('div.custom-mode-ui-surface-brand-logo-label', undefined, localize('customMode.surfaceSetupBrandLogoMark', 'Logo mark')),
					this.uiSurfaceSetupLogoMarkDropzone
				)
			),
			brandColors
		);
		const surfacesSection = $('section.custom-mode-ui-surface-setup-section', { id: 'surface-setup-section-surfaces', 'data-section': 'surfaces' },
			starterButtons
		);
		for (const [step, section] of [
			['goal', goalSection],
			['brand', brandSection],
			['surfaces', surfacesSection],
		] as const) {
			this.uiSurfaceSetupSections.set(step, section);
		}

		this.uiSurfaceSetupMain = $('div.custom-mode-ui-surface-setup-main', undefined,
			goalSection,
			brandSection,
			surfacesSection,
		);
		this.uiSurfaceScaffoldTitle = $('div.custom-mode-ui-surface-scaffold-title');
		this.uiSurfaceScaffoldTextarea = $('textarea.custom-mode-ui-surface-scaffold-textarea', {
			'aria-label': localize('customMode.surfaceScaffoldPromptAria', 'Surface scaffold prompt'),
			spellcheck: 'false',
		}) as HTMLTextAreaElement;
		this.uiSurfaceScaffoldScaffoldButton = $('button.custom-mode-ui-surface-scaffold-scaffold', {
			type: 'button',
		}, localize('customMode.surfaceScaffoldSubmit', 'Scaffold this surface')) as HTMLButtonElement;
		this.uiSurfaceScaffoldCancelButton = $('button.custom-mode-ui-surface-scaffold-cancel', {
			type: 'button',
		}, localize('customMode.surfaceScaffoldCancel', 'Cancel surface draft')) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiSurfaceScaffoldScaffoldButton, 'click', () => void this.submitSurfaceScaffoldDraft()));
		this._register(addDisposableListener(this.uiSurfaceScaffoldCancelButton, 'click', () => this.cancelSurfaceScaffoldDraft()));
		this._register(addDisposableListener(this.uiSurfaceScaffoldTextarea, 'input', () => {
			if (!this.uiSurfaceSetupInner.classList.contains('custom-mode-ui-surface-scaffold-open')) {
				return;
			}
			this.uiChatWidget.setInput(this.uiSurfaceScaffoldTextarea.value);
		}));
		this.uiSurfaceScaffoldView = $('div.custom-mode-ui-surface-scaffold-view', undefined,
			$('div.custom-mode-ui-surface-scaffold-header', undefined,
				this.uiSurfaceScaffoldTitle,
				$('div.custom-mode-ui-surface-scaffold-hint', undefined, localize('customMode.surfaceScaffoldHint', 'This is the exact prompt the agent uses to build the surface. Edit it before scaffolding if needed.')),
			),
			this.uiSurfaceScaffoldTextarea,
			$('div.custom-mode-ui-surface-scaffold-actions', undefined,
				this.uiSurfaceScaffoldScaffoldButton,
				this.uiSurfaceScaffoldCancelButton,
			),
		);
		this.uiSurfaceSetupInner = $('div.custom-mode-ui-surface-setup-inner', undefined,
			this.uiSurfaceSetupMain,
			this.uiSurfaceScaffoldView,
		);

		return $('div.custom-mode-ui-surface-setup.hidden', undefined,
			this.uiSurfaceSetupInner,
		);
	}

	private createBrandColorInput(defaultValue: string): HTMLInputElement {
		const input = $('input.custom-mode-ui-surface-brand-color-input', {
			type: 'color',
			value: defaultValue,
		}) as HTMLInputElement;
		this._register(addDisposableListener(input, 'input', () => this.scheduleSurfaceSetupAutosave()));
		return input;
	}

	private createBrandColorField(label: string, input: HTMLInputElement): HTMLElement {
		return $('label.custom-mode-ui-surface-brand-color-field', undefined,
			$('span.custom-mode-ui-surface-brand-color-label', undefined, label),
			input
		);
	}

	private createBrandLogoDropzone(kind: 'logo' | 'mark'): { dropzone: HTMLElement; preview: HTMLImageElement } {
		const preview = $('img.custom-mode-ui-surface-brand-logo-preview', { alt: '' }) as HTMLImageElement;
		preview.classList.add('hidden');
		const hint = kind === 'logo'
			? localize('customMode.surfaceSetupBrandLogoHint', 'Drop logo or click to upload')
			: localize('customMode.surfaceSetupBrandLogoMarkHint', 'Drop icon or click to upload');
		const dropzone = $('div.custom-mode-ui-surface-brand-dropzone', { tabindex: '0', role: 'button' },
			preview,
			$('div.custom-mode-ui-surface-brand-dropzone-hint', undefined, hint)
		);
		const fileInput = $('input', { type: 'file', accept: 'image/*', hidden: 'true' }) as HTMLInputElement;
		dropzone.appendChild(fileInput);

		const openPicker = () => fileInput.click();
		this._register(addDisposableListener(dropzone, 'click', event => {
			if (event.target === preview) {
				return;
			}
			openPicker();
		}));
		this._register(addDisposableListener(dropzone, 'keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				openPicker();
			}
		}));
		this._register(addDisposableListener(fileInput, 'change', () => {
			const file = fileInput.files?.[0];
			fileInput.value = '';
			if (file) {
				void this.importBrandLogo(kind, file);
			}
		}));
		this._register(addDisposableListener(dropzone, 'dragover', event => {
			event.preventDefault();
			dropzone.classList.add('dragover');
		}));
		this._register(addDisposableListener(dropzone, 'dragleave', () => dropzone.classList.remove('dragover')));
		this._register(addDisposableListener(dropzone, 'drop', event => {
			event.preventDefault();
			dropzone.classList.remove('dragover');
			const file = event.dataTransfer?.files?.[0];
			if (file) {
				void this.importBrandLogo(kind, file);
			}
		}));
		return { dropzone, preview };
	}

	private scheduleSurfaceSetupAutosave(): void {
		if (this.surfaceSetupHydrating) {
			return;
		}
		this.surfaceSetupDraftDirty = true;
		this.surfaceSetupAutosaveScheduler.schedule();
	}

	private async autosaveSurfaceSetupBuilder(): Promise<void> {
		if (!this.surfaceSetupDraftDirty) {
			return;
		}
		await this.persistSurfaceSetupBuilder();
	}

	private markSurfaceSetupDirty(): void {
		this.scheduleSurfaceSetupAutosave();
	}

	private getSurfaceSetupBuilderInput() {
		return {
			name: this.uiSurfaceSetupGoalNameInput.value,
			description: this.uiSurfaceSetupGoalDescriptionInput.value,
			brand: {
				primaryColor: this.uiSurfaceSetupPrimaryColorInput.value,
				secondaryColor: this.uiSurfaceSetupSecondaryColorInput.value,
				accentColor: this.uiSurfaceSetupAccentColorInput.value,
				logoPath: this.surfaceSetupBrandLogoPath,
				logoMarkPath: this.surfaceSetupBrandLogoMarkPath,
			},
		};
	}

	private async importBrandLogo(kind: 'logo' | 'mark', file: File): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceSetupDraftNoWorkspace', 'Open a workspace folder before saving a draft.'));
			return;
		}
		if (!file.type.startsWith('image/')) {
			this.notificationService.warn(localize('customMode.surfaceSetupBrandLogoInvalid', 'Upload an image file for the logo.'));
			return;
		}
		const extension = file.name.includes('.') ? file.name.split('.').pop() : 'png';
		const fileName = kind === 'logo' ? `logo.${extension}` : `logo-mark.${extension}`;
		const target = joinPath(brandFolderResource(workspaceFolder), fileName);
		try {
			await this.fileService.createFolder(brandFolderResource(workspaceFolder));
			const bytes = new Uint8Array(await file.arrayBuffer());
			await this.fileService.writeFile(target, VSBuffer.wrap(bytes));
			const relativePath = `.agent/brand/${fileName}`;
			const preview = kind === 'logo' ? this.uiSurfaceSetupLogoPreview : this.uiSurfaceSetupLogoMarkPreview;
			const dropzone = kind === 'logo' ? this.uiSurfaceSetupLogoDropzone : this.uiSurfaceSetupLogoMarkDropzone;
			if (kind === 'logo') {
				this.surfaceSetupBrandLogoPath = relativePath;
			} else {
				this.surfaceSetupBrandLogoMarkPath = relativePath;
			}
			await this.setBrandLogoPreview(preview, dropzone, target);
			this.markSurfaceSetupDirty();
		} catch (e: unknown) {
			this.notificationService.error(localize('customMode.surfaceSetupBrandLogoFailed', 'Failed to save logo: {0}', String((e as Error)?.message ?? e)));
		}
	}

	private revokeBrandLogoPreview(preview: HTMLImageElement): void {
		const objectUrl = preview.dataset.objectUrl;
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			delete preview.dataset.objectUrl;
		}
	}

	private async setBrandLogoPreview(preview: HTMLImageElement, dropzone: HTMLElement, resource: URI): Promise<void> {
		const content = await this.fileService.readFile(resource);
		const path = resource.path.toLowerCase();
		const mime = path.endsWith('.svg')
			? 'image/svg+xml'
			: path.endsWith('.jpg') || path.endsWith('.jpeg')
				? 'image/jpeg'
				: path.endsWith('.webp')
					? 'image/webp'
					: 'image/png';
		this.revokeBrandLogoPreview(preview);
		const blob = new Blob([content.value.buffer as BlobPart], { type: mime });
		const objectUrl = URL.createObjectURL(blob);
		preview.dataset.objectUrl = objectUrl;
		preview.src = objectUrl;
		preview.classList.remove('hidden');
		dropzone.classList.add('has-image');
	}

	private async hydrateBrandLogoPreview(relativePath: string | undefined, preview: HTMLImageElement, dropzone: HTMLElement, workspaceFolder: URI): Promise<void> {
		if (!relativePath?.trim()) {
			this.revokeBrandLogoPreview(preview);
			preview.removeAttribute('src');
			preview.classList.add('hidden');
			dropzone.classList.remove('has-image');
			return;
		}
		const resource = joinPath(workspaceFolder, ...relativePath.split('/').filter(Boolean));
		try {
			await this.fileService.stat(resource);
			await this.setBrandLogoPreview(preview, dropzone, resource);
		} catch {
			this.revokeBrandLogoPreview(preview);
			preview.removeAttribute('src');
			preview.classList.add('hidden');
			dropzone.classList.remove('has-image');
		}
	}

	private createNewSurfaceCard(): HTMLButtonElement {
		const button = $('button.custom-mode-ui-surface-starter-card.custom-mode-ui-surface-starter-card-new', {
			type: 'button',
			title: localize('customMode.surfaceStarterNewTitle', 'Create a custom surface'),
		},
			$('div.custom-mode-ui-surface-starter-card-header', undefined,
				$('div.custom-mode-ui-surface-starter-card-icon.codicon' + ThemeIcon.asCSSSelector(Codicon.add)),
				$('div.custom-mode-ui-surface-starter-card-title', undefined, localize('customMode.surfaceStarterNew', 'New Surface')),
			),
			$('div.custom-mode-ui-surface-starter-card-summary', undefined, localize('customMode.surfaceStarterNewSummary', 'Describe a custom app for your business.')),
		) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => void this.draftNewSurfacePrompt()));
		return button;
	}

	private async draftNewSurfacePrompt(): Promise<void> {
		const surfaceName = await this.quickInputService.input({
			prompt: localize('customMode.surfaceStarterNewPrompt', 'What should this surface be called?'),
			placeHolder: localize('customMode.surfaceStarterNewPlaceholder', 'e.g. Referral Program'),
		});
		if (!surfaceName?.trim()) {
			return;
		}
		const workflow = await this.quickInputService.input({
			prompt: localize('customMode.surfaceStarterNewWorkflowPrompt', 'What should {0} help customers do?', surfaceName.trim()),
			placeHolder: localize('customMode.surfaceStarterNewWorkflowPlaceholder', 'e.g. invite friends, track rewards, and redeem offers'),
		});
		await this.draftSurfacePrompt({
			templateId: 'custom',
			surfaceId: slugifySurfaceId(surfaceName.trim()),
			surfaceName: surfaceName.trim(),
			workflow: workflow?.trim() || ADD_SURFACE_STARTER.workflow,
		});
	}

	private createStarterSurfaceCard(starter: StarterSurface): HTMLElement {
		const preview = $('div.custom-mode-ui-surface-starter-card-preview');
		const previewShell = $('div.custom-mode-ui-surface-starter-card-preview-shell', undefined, preview);
		const status = $('span.custom-mode-ui-surface-starter-card-status', undefined, localize('customMode.surfaceStarterStatusNotCreated', 'Not created'));
		const overlay = $('div.custom-mode-ui-surface-starter-card-overlay', undefined,
			$('div.custom-mode-ui-surface-starter-card-overlay-top', undefined,
				$('div.custom-mode-ui-surface-starter-card-icon.codicon' + ThemeIcon.asCSSSelector(starter.icon)),
				$('div.custom-mode-ui-surface-starter-card-title', undefined, starter.name),
				status,
			),
		);
		const card = $('div.custom-mode-ui-surface-starter-card', {
			role: 'button',
			tabindex: '0',
			title: localize('customMode.surfaceStarterTitle', 'Draft a prompt for {0}', starter.name),
		},
			previewShell,
			overlay,
		);
		this._register(addDisposableListener(card, 'click', () => void this.beginSurfaceHandoff({
			templateId: starter.id,
			surfaceId: starter.id,
			surfaceName: starter.name,
			workflow: starter.workflow,
		})));
		this._register(addDisposableListener(card, 'keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			event.preventDefault();
			void this.beginSurfaceHandoff({
				templateId: starter.id,
				surfaceId: starter.id,
				surfaceName: starter.name,
				workflow: starter.workflow,
			});
		}));
		this.starterSurfaceCardMeta.set(starter.id, { card, status, preview });
		return card;
	}

	private async refreshStarterSurfaceCardStatuses(): Promise<void> {
		const refreshId = ++this.starterSurfaceStatusRefreshId;
		const surfacesById = new Map(this.consoleService.getSurfaces().map(surface => [surface.id, surface]));
		const statusRows = await Promise.all(STARTER_SURFACES.map(async starter => {
			const surface = surfacesById.get(starter.id);
			// Treat starter cards as created only when the surface is still registered.
			// This avoids stale "Created" badges after a surface is deleted from the manifest.
			const created = Boolean(surface) && await this.isSurfaceScaffolded(starter.id);
			let runningUrl: string | undefined;
			if (created && surface?.localUrl) {
				try {
					runningUrl = await this.devServerService.findRunningDevServerUrl(surface.localUrl);
				} catch {
					runningUrl = undefined;
				}
			}
			return { starterId: starter.id, surface, created, runningUrl };
		}));
		if (refreshId !== this.starterSurfaceStatusRefreshId) {
			return;
		}

		for (const row of statusRows) {
			const target = this.starterSurfaceCardMeta.get(row.starterId);
			if (!target) {
				continue;
			}
			target.card.classList.toggle('generated', row.created);
			target.card.classList.toggle('has-preview', Boolean(row.runningUrl));
			target.status.classList.remove('created', 'running');
			if (!row.created) {
				target.status.textContent = localize('customMode.surfaceStarterStatusNotCreated', 'Not created');
				target.preview.replaceChildren();
				continue;
			}

			if (row.runningUrl && row.surface) {
				target.status.textContent = localize('customMode.surfaceStarterStatusRunning', 'Running');
				target.status.classList.add('running');
				const previewFrame = isWeb
					? $('iframe.custom-mode-ui-surface-starter-card-preview-frame', {
						src: row.runningUrl,
						loading: 'lazy',
						title: localize('customMode.surfaceStarterPreviewFrameTitle', '{0} preview', row.surface.name),
					}) as HTMLElement
					: $('webview.custom-mode-ui-surface-starter-card-preview-frame', {
						src: row.runningUrl,
						allowpopups: 'true',
					}) as HTMLElement;
				if (isWeb) {
					(previewFrame as HTMLIFrameElement).setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-same-origin allow-popups');
					(previewFrame as HTMLIFrameElement).setAttribute('referrerpolicy', 'no-referrer');
				}
				target.preview.replaceChildren(previewFrame);
				continue;
			}

			target.status.textContent = localize('customMode.surfaceStarterStatusCreated', 'Created');
			target.status.classList.add('created');
			target.preview.replaceChildren();
		}
	}

	private getWorkspaceFolderUri(): URI | undefined {
		return this.workspaceContextService.getWorkspace().folders[0]?.uri;
	}

	private setSurfaceSetupBuilderOpen(open: boolean): void {
		this.uiContainer.classList.toggle('custom-mode-ui-surface-builder-open', open);
		if (!open) {
			this.endSurfaceSetupHandoff();
			return;
		}
		this.syncHandoffChatPlacement();
		void this.updateEmbeddedChat(this.modeService.getMode());
	}

	private setSurfaceSetupBuilderHandoff(handoff: boolean, state?: SurfaceBuilderHandoffStateValue): void {
		this.uiContainer.classList.toggle('custom-mode-ui-surface-builder-handoff', handoff);
		if (handoff) {
			SurfaceBuilderHandoffState.setActive(state);
			this.setUiChatDismissed(false);
		} else {
			SurfaceBuilderHandoffState.setActive(undefined);
		}
		this.syncHandoffChatPlacement();
		void this.surfaceFeatureChecklistService.refresh();
	}

	private endSurfaceSetupHandoff(): void {
		this.hideSurfaceScaffoldView();
		this.setSurfaceSetupBuilderHandoff(false);
	}

	private hideSurfaceScaffoldView(): void {
		this.uiSurfaceSetupInner.classList.remove('custom-mode-ui-surface-scaffold-open');
		this.uiSurfaceScaffoldTextarea.value = '';
	}

	private showSurfaceScaffoldView(surfaceName: string, promptText: string): void {
		this.uiSurfaceScaffoldTitle.textContent = localize('customMode.surfaceScaffoldTitle', 'Scaffold {0}', surfaceName);
		this.uiSurfaceScaffoldTextarea.value = promptText;
		this.uiSurfaceSetupInner.classList.add('custom-mode-ui-surface-scaffold-open');
		this.focusSurfaceSetupSection('surfaces', { scroll: false });
	}

	private cancelSurfaceScaffoldDraft(): void {
		this.endSurfaceSetupHandoff();
	}

	private async submitSurfaceScaffoldDraft(): Promise<void> {
		const inputText = this.uiSurfaceScaffoldTextarea.value.trim();
		if (!inputText) {
			return;
		}
		try {
			await this.ensureEmbeddedChatModel('UI', this.getActiveUISurfaceChatKey());
			this.uiChatWidget.setInput(inputText);
			await this.uiChatWidget.acceptInput(inputText);
			this.uiChatWidget.focusInput();
		} catch (e: unknown) {
			this.pushUiRuntimeLog(`[surface-setup:chat] failed to submit scaffold: ${String((e as Error)?.message ?? e)}`);
		}
	}

	private composeSurfaceHandoffInputText(options: {
		readonly surfaceName: string;
		readonly surfaceId: string;
		readonly workflow: string;
		readonly phase: SurfaceHandoffPhase;
	}): string {
		const businessName = this.uiSurfaceSetupGoalNameInput.value.trim();
		const businessDescription = this.uiSurfaceSetupGoalDescriptionInput.value.trim();
		const headline = options.phase === 'scaffold'
			? localize(
				'customMode.surfaceSetupScaffoldPrompt',
				'Create a {0} surface for this goal workspace focused on {1}.',
				options.surfaceName,
				options.workflow,
			)
			: localize(
				'customMode.surfaceSetupBlueprintPrompt',
				'Customize and finalize the surface blueprint for {0} focused on {1}. Edit `.agent/surfaces/{2}.blueprint.json` and workspace.goal.json surface metadata only — do not scaffold app files yet.',
				options.surfaceName,
				options.workflow,
				options.surfaceId,
			);
		const contextLines = [
			businessName ? localize('customMode.surfaceSetupPromptBusiness', 'Business: {0}', businessName) : undefined,
			businessDescription ? localize('customMode.surfaceSetupPromptDescription', 'Description: {0}', businessDescription) : undefined,
			hasBrandConfigured(this.getSurfaceSetupBuilderInput().brand)
				? localize('customMode.surfaceSetupPromptBrand', 'Use the brand colors and logos from workspace.goal.json.')
				: undefined,
		].filter((line): line is string => Boolean(line));
		return [headline, ...contextLines, getSurfaceHandoffGuidance(options.phase)].join('\n\n');
	}

	private async isSurfaceScaffolded(surfaceId: string): Promise<boolean> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return false;
		}
		const surface = this.consoleService.getSurface(surfaceId);
		const appPath = surface?.path ?? `apps/${surfaceId}`;
		try {
			await this.fileService.stat(joinPath(workspaceFolder, appPath, 'package.json'));
			return true;
		} catch {
			return false;
		}
	}

	private async beginSurfaceHandoff(options: {
		readonly templateId: string;
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly workflow: string;
	}): Promise<void> {
		if (await this.isSurfaceScaffolded(options.surfaceId)) {
			this.selectGoalSurface(options.surfaceId);
			return;
		}
		await this.draftSurfacePrompt(options);
	}

	private syncHandoffChatPlacement(): void {
		if (this.uiChatContainer.parentElement !== this.uiChatColumn) {
			this.uiChatColumn.appendChild(this.uiChatContainer);
		}
	}

	private async clearHandoffChatAttachments(): Promise<void> {
		try {
			if (!this.embeddedChatRefs.UI.value) {
				return;
			}
			this.uiChatWidget.input.attachmentModel.clear(false);
		} catch {
			// Chat session may not be bound yet.
		}
	}

	private focusSurfaceSetupSection(step: SurfaceSetupStep, options?: { scroll?: boolean }): void {
		this.surfaceSetupCurrentStep = step;
		if (options?.scroll === false) {
			return;
		}
		this.uiSurfaceSetupSections.get(step)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	private populateSurfaceSetupBuilderFields(): void {
		const goal = this.consoleService.getGoal();
		const brand = this.consoleService.getWorkspace()?.brand;
		this.uiSurfaceSetupGoalNameInput.value = goal?.name ?? '';
		this.uiSurfaceSetupGoalDescriptionInput.value = goal?.description ?? '';
		this.uiSurfaceSetupPrimaryColorInput.value = brand?.primaryColor ?? '#2563eb';
		this.uiSurfaceSetupSecondaryColorInput.value = brand?.secondaryColor ?? '#0f172a';
		this.uiSurfaceSetupAccentColorInput.value = brand?.accentColor ?? '#f59e0b';
		this.surfaceSetupBrandLogoPath = brand?.logoPath;
		this.surfaceSetupBrandLogoMarkPath = brand?.logoMarkPath;
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (workspaceFolder) {
			void this.hydrateBrandLogoPreview(this.surfaceSetupBrandLogoPath, this.uiSurfaceSetupLogoPreview, this.uiSurfaceSetupLogoDropzone, workspaceFolder);
			void this.hydrateBrandLogoPreview(this.surfaceSetupBrandLogoMarkPath, this.uiSurfaceSetupLogoMarkPreview, this.uiSurfaceSetupLogoMarkDropzone, workspaceFolder);
		}
	}

	private async refreshSurfaceSetupDashboard(): Promise<void> {
		if (this.uiSurfaceSetupDashboard.classList.contains('hidden')) {
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		const draft = await loadSurfaceSetupDraft(this.fileService, workspaceFolder);
		this.surfaceSetupHydrating = true;
		try {
			this.populateSurfaceSetupBuilderFields();
		} finally {
			this.surfaceSetupHydrating = false;
		}
		const goal = this.consoleService.getGoal();
		const brand = this.consoleService.getWorkspace()?.brand;
		const surfaces = this.consoleService.getSurfaces();
		const inferredStep = inferSurfaceSetupStep(Boolean(goal?.name?.trim()), hasBrandConfigured(brand), surfaces.length);
		const step = draft?.currentStep ?? inferredStep;
		this.surfaceSetupDraftDirty = false;
		this.focusSurfaceSetupSection(step, { scroll: false });
		await this.refreshStarterSurfaceCardStatuses();
	}

	private async persistSurfaceSetupBuilder(options?: { requireName?: boolean }): Promise<boolean> {
		const requireName = options?.requireName ?? false;
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			if (requireName) {
				this.notificationService.warn(localize('customMode.surfaceSetupDraftNoWorkspace', 'Open a workspace folder before saving a draft.'));
			}
			return false;
		}
		const builderInput = this.getSurfaceSetupBuilderInput();
		if (!builderInput.name.trim()) {
			if (requireName) {
				this.notificationService.warn(localize('customMode.surfaceSetupGoalNameRequired', 'Enter a business name before generating a surface.'));
				this.focusSurfaceSetupSection('goal');
			}
			return false;
		}
		try {
			await saveGoalWorkspaceBuilderFields(
				this.fileService,
				workspaceFolder,
				builderInput,
				this.consoleService.getGoal()?.id,
			);
			await this.consoleService.refresh();
			await saveSurfaceSetupDraft(this.fileService, workspaceFolder, {
				currentStep: this.surfaceSetupCurrentStep,
			});
			this.surfaceSetupDraftDirty = false;
			return true;
		} catch (e: unknown) {
			if (requireName) {
				this.notificationService.error(localize('customMode.surfaceSetupDraftSaveFailed', 'Failed to save: {0}', String((e as Error)?.message ?? e)));
			}
			return false;
		}
	}

	private async draftSurfacePrompt(options: {
		templateId: string;
		surfaceId: string;
		surfaceName: string;
		workflow: string;
	}): Promise<void> {
		this.surfaceSetupAutosaveScheduler.cancel();
		if (!(await this.persistSurfaceSetupBuilder({ requireName: true }))) {
			return;
		}
		const { templateId, surfaceId, surfaceName, workflow } = options;
		const phase: SurfaceHandoffPhase = 'scaffold';
		const inputText = this.composeSurfaceHandoffInputText({ surfaceName, surfaceId, workflow, phase });
		try {
			const workspaceFolder = this.getWorkspaceFolderUri();
			if (!workspaceFolder) {
				return;
			}
			const orchestrator = new SurfaceCreationLangGraphOrchestrator({
				fileService: this.fileService,
				workspaceFolder,
				maxRepairRetries: MAX_SURFACE_BLUEPRINT_REPAIR_ATTEMPTS,
				traceEvent: (type, payload) => this.customAiChatTraceService.traceEditEvent(type, payload),
			});
			const creationResult = await orchestrator.createSurface(surfaceId, workflow);
			const verification = creationResult.verification;
			await this.consoleService.refresh();
			void this.refreshStarterSurfaceCardStatuses();
			void this.surfaceFeatureChecklistService.refresh();
			this.setSurfaceSetupBuilderHandoff(true, {
				kind: 'surface',
				templateId: creationResult.templateId || templateId,
				surfaceId,
				surfaceName,
				title: surfaceName,
				phase,
				prompt: inputText,
				blueprintResource: creationResult.blueprintResource.fsPath,
				repairAttempts: 0,
			});
			this.pushUiRuntimeLog(`[surface-setup:scaffold] created ${creationResult.scaffoldResult.createdFiles.length} files for ${surfaceId}; verification=${verification.passed ? 'passed' : 'failed'}; repairs=${creationResult.repairAttempts}`);
			if (verification.passed) {
				this.notificationService.info(localize('customMode.surfaceScaffoldVerified', 'Scaffolded and verified {0}.', surfaceName));
			} else {
				this.notificationService.warn(localize('customMode.surfaceScaffoldNeedsRepair', 'Scaffolded {0}, but product verification found {1} gaps.', surfaceName, verification.gaps.length));
			}
			this.showSurfaceScaffoldView(surfaceName, inputText);
			this.ensureWorkspaceView();
			await this.selectUiChatSurfaceAsync(surfaceId);
			await this.clearHandoffChatAttachments();
			if (this.embeddedChatRefs.UI.value) {
				const manifest = joinPath(workspaceFolder, 'workspace.goal.json');
				for (const [uri, name, id] of [
					[manifest, 'workspace.goal.json', 'surface-handoff:workspace.goal.json'],
					[creationResult.blueprintResource, `${surfaceId}.blueprint.json`, `surface-handoff:${surfaceId}.blueprint.json`],
				] as const) {
					try {
						this.uiChatWidget.input.attachmentModel.addContext({
							kind: 'file',
							value: { uri },
							id,
							name,
						} satisfies IChatRequestFileEntry);
					} catch {
						// ignore attachment failures
					}
				}
			}
			this.uiChatWidget.setInput(inputText);
			this.uiChatWidget.focusInput();
		} catch (e: unknown) {
			this.pushUiRuntimeLog(`[surface-setup:chat] failed to draft prompt: ${String((e as Error)?.message ?? e)}`);
		}
	}

	private updateUiProjectName(): void {
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const label = localize('customMode.consoleTab', 'Console');
		this.uiProjectName.textContent = hasProject ? label : '';
		this.uiProjectName.setAttribute('aria-label', label);
		this.uiProjectName.classList.toggle('hidden', !hasProject);
		this.syncContextGatheringUi();
	}

	private ensureWorkspaceView(): void {
		if (this.modeService.getMode() === 'Code') {
			this.modeService.setMode('UI');
		}
	}

	private persistContextGatheringOpen(): void {
		this.storageService.store(STORAGE_CONTEXT_GATHERING_OPEN, this.contextGatheringOpen ? '1' : '0', StorageScope.PROFILE, StorageTarget.USER);
	}

	private syncContextGatheringUi(): void {
		this.container.classList.toggle('custom-mode-context-gathering-open', this.contextGatheringOpen);
		const builderOpen = this.selectedSurfaceId === ADD_SURFACE_ID;
		this.uiProjectName.classList.toggle('active', builderOpen);
		this.uiProjectName.setAttribute('aria-pressed', String(builderOpen));
		const landingOpen = this.container.classList.contains('custom-mode-ui-landing-open');
		if (landingOpen) {
			this.uiProjectName.title = localize('customMode.workspaceNameLandingOpen', 'Goal workspace overview — click to close, or press Escape');
			return;
		}
		this.uiProjectName.title = builderOpen
			? localize('customMode.workspaceNameBuilderOpen', 'Guided builder is open — click a surface tab to preview. Double-click for goal workspace overview.')
			: localize('customMode.workspaceNameOpenBuilder', 'Open guided builder — double-click for goal workspace overview');
	}

	private openGoalWorkspaceLanding(): void {
		this.ensureWorkspaceView();
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		if (!hasProject) {
			return;
		}
		this.container.classList.add('custom-mode-ui-landing-open');
		this.syncContextGatheringUi();
	}

	private closeGoalWorkspaceLanding(): void {
		if (!this.container.classList.contains('custom-mode-ui-landing-open')) {
			return;
		}
		this.container.classList.remove('custom-mode-ui-landing-open');
		this.syncContextGatheringUi();
	}

	private applySurfaceSelection(surfaceId: string, options?: { contextGathering?: boolean }): void {
		if (options?.contextGathering !== undefined) {
			this.contextGatheringOpen = options.contextGathering;
			this.persistContextGatheringOpen();
			this.syncContextGatheringUi();
		}
		this.ensureWorkspaceView();
		this.renderGoalSurfaceButtons(this.consoleService.getSurfaces());
		this.routeSelectedSurfacePreview();
		this.refreshStartCommandHints();
		this.setActiveUiChatSurfaceFromSurfaceTab(surfaceId);
	}

	private syncGoalSurfaceSwitcher(): void {
		const state = this.consoleService.getState();
		const surfaces = this.consoleService.getSurfaces();
		const goalWorkspaceLoaded = state.status === 'loaded';
		const hasManifestSurfaces = goalWorkspaceLoaded && surfaces.length > 0;
		this.uiSurfaceSwitcher.classList.toggle('hidden', !hasManifestSurfaces);

		if (!goalWorkspaceLoaded) {
			this.selectedSurfaceId = undefined;
			this.container.classList.remove('custom-mode-ui-surface-selected');
			this.uiSurfaceButtons.clear();
			this.uiSurfaceSwitcher.replaceChildren();
			this.setGoalWorkspaceManifestStateMessage(state.status, state.diagnostics);

			const activeUrl = this.devServerService.getActiveUrl();
			if (!this.uiBrowserShell.classList.contains('custom-mode-ui-surface-missing-url') && activeUrl && !this.embeddedUiShowsUrl(activeUrl)) {
				this.setEmbeddedUiUrl(activeUrl);
			}
			return;
		}

		if (!hasManifestSurfaces) {
			this.selectedSurfaceId = ADD_SURFACE_ID;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
			this.uiSurfaceButtons.clear();
			this.uiSurfaceSwitcher.replaceChildren();
			this.routeSelectedSurfacePreview();
			this.refreshStartCommandHints();
			this.refreshUiChatTabsAndSession();
			return;
		}

		const storedSurfaceId = this.storageService.get(STORAGE_SELECTED_GOAL_SURFACE, StorageScope.WORKSPACE);
		const selectedSurface = this.resolveSelectedSurface(surfaces, storedSurfaceId);
		this.selectedSurfaceId = storedSurfaceId === ADD_SURFACE_ID
			? ADD_SURFACE_ID
			: selectedSurface?.id ?? surfaces[0]?.id ?? ADD_SURFACE_ID;
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, this.selectedSurfaceId, StorageScope.WORKSPACE, StorageTarget.USER);

		this.renderGoalSurfaceButtons(surfaces);
		this.routeSelectedSurfacePreview();
		void this.freeWorkspaceSurfacePortsAtStartup(surfaces);
		this.refreshStartCommandHints();
		this.refreshUiChatTabsAndSession();
	}

	private async freeWorkspaceSurfacePortsAtStartup(surfaces: readonly WorkspaceSurface[]): Promise<void> {
		if (this.surfacePortsFreedAtStartup) {
			return;
		}
		this.surfacePortsFreedAtStartup = true;
		const ports = collectUniqueSurfacePorts(surfaces);
		if (!ports.length) {
			return;
		}
		await freeSurfacePorts(ports);
		this.pushUiRuntimeLog(`[surface-ports] freed ports before startup: ${ports.join(', ')}`);
	}

	private async freeSurfacePortForLaunch(preferredUrl: string | undefined, command: string): Promise<void> {
		const ports = new Set<number>();
		const urlPort = parsePortFromLocalUrl(preferredUrl);
		if (urlPort) {
			ports.add(urlPort);
		}
		const commandPort = this.parsePortFromCommand(command);
		if (commandPort) {
			ports.add(commandPort);
		}
		await Promise.all([...ports].map(port => killProcessListeningOnPort(port)));
	}

	private parsePortFromCommand(command: string): number | undefined {
		const portFlag = /\b--port(?:=|\s+)(\d{2,5})\b/i.exec(command) ?? /\s-p\s+(\d{2,5})\b/i.exec(command);
		if (!portFlag) {
			return undefined;
		}
		const port = Number(portFlag[1]);
		return Number.isFinite(port) ? port : undefined;
	}

	private resolveSelectedSurface(surfaces: readonly WorkspaceSurface[], storedSurfaceId: string | undefined): WorkspaceSurface | undefined {
		if (this.selectedSurfaceId === ADD_SURFACE_ID || storedSurfaceId === ADD_SURFACE_ID) {
			return undefined;
		}

		const current = this.selectedSurfaceId ? surfaces.find(surface => surface.id === this.selectedSurfaceId) : undefined;
		if (current) {
			return current;
		}

		const stored = storedSurfaceId ? surfaces.find(surface => surface.id === storedSurfaceId) : undefined;
		return stored;
	}

	private renderGoalSurfaceButtons(surfaces: readonly WorkspaceSurface[]): void {
		const nextButtons = new Map<string, HTMLButtonElement>();
		const fragment = document.createDocumentFragment();

		for (const surface of surfaces) {
			let button = this.uiSurfaceButtons.get(surface.id);
			if (!button) {
				button = $('button.custom-mode-ui-surface-button', {
					type: 'button',
					role: 'tab'
				}) as HTMLButtonElement;
				this._register(addDisposableListener(button, 'click', () => this.selectGoalSurface(surface.id)));
			}

			const isActive = surface.id === this.selectedSurfaceId;
			const description = this.formatGoalSurfaceDescription(surface);
			button.textContent = surface.name;
			button.title = description;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-selected', String(isActive));
			button.setAttribute('aria-label', description);

			const closeLabel = localize('customMode.surfaceCloseButtonAria', 'Delete {0} surface', surface.name);
			const closeButton = $('button.custom-mode-ui-surface-close', {
				type: 'button',
				title: closeLabel,
				'aria-label': closeLabel
			}, '\u00d7') as HTMLButtonElement;
			closeButton.dataset.surfaceId = surface.id;

			const tab = $('div.custom-mode-ui-surface-tab', undefined, button, closeButton);
			tab.classList.toggle('active', isActive);

			nextButtons.set(surface.id, button);
			fragment.appendChild(tab);
		}

		this.uiSurfaceButtons.clear();
		for (const [id, button] of nextButtons) {
			this.uiSurfaceButtons.set(id, button);
		}
		this.uiSurfaceSwitcher.replaceChildren(fragment);
	}

	private onSurfaceSwitcherClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		const closeButton = target.closest('.custom-mode-ui-surface-close') as HTMLElement | null;
		const surfaceId = closeButton?.dataset.surfaceId;
		if (!surfaceId) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		void this.deleteGoalSurface(surfaceId);
	}

	private selectGoalSurface(surfaceId: string): void {
		// Retry surface auto-start whenever the user explicitly switches tabs.
		this.autoStartAppAttempted = false;

		if (surfaceId === ADD_SURFACE_ID) {
			this.selectedSurfaceId = ADD_SURFACE_ID;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
			this.applySurfaceSelection(surfaceId, { contextGathering: true });
			return;
		}

		const surface = this.consoleService.getSurface(surfaceId);
		if (!surface) {
			return;
		}

		this.selectedSurfaceId = surface.id;
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, surface.id, StorageScope.WORKSPACE, StorageTarget.USER);
		this.applySurfaceSelection(surfaceId, { contextGathering: false });
		void this.ensureSurfaceServerStarted(surface);
	}

	private async deleteGoalSurface(surfaceId: string): Promise<void> {
		const surface = this.consoleService.getSurface(surfaceId);
		if (!surface) {
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.surfaceDeleteNoWorkspace', 'Open a workspace folder before deleting surfaces.')
			});
			return;
		}
		try {
			const deleted = await deleteGoalWorkspaceSurface(this.fileService, workspaceFolder, surfaceId);
			if (!deleted) {
				this.notificationService.notify({
					severity: Severity.Warning,
					message: localize('customMode.surfaceDeleteMissing', 'Could not find {0} in workspace.goal.json.', surface.name)
				});
				return;
			}
			this.chatSessionManager.removeUISurfaceSession(surfaceId);
			if (this.selectedSurfaceId === surfaceId) {
				const fallbackSurface = this.consoleService.getSurfaces().find(candidate => candidate.id !== surfaceId);
				this.selectedSurfaceId = fallbackSurface?.id ?? ADD_SURFACE_ID;
				this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, this.selectedSurfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
			}
			if (this.activeUiChatSurfaceId === surfaceId) {
				const fallbackSurface = this.consoleService.getSurfaces().find(candidate => candidate.id !== surfaceId);
				this.activeUiChatSurfaceId = fallbackSurface?.id ?? ADD_SURFACE_ID;
				this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, this.activeUiChatSurfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
			}
			await this.consoleService.refresh();
			this.syncGoalSurfaceSwitcher();
			void this.refreshStarterSurfaceCardStatuses();
			this.notificationService.notify({
				severity: Severity.Info,
				message: localize('customMode.surfaceDeleteSuccess', 'Deleted {0} surface.', surface.name)
			});
		} catch (error: unknown) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'customMode.surfaceDeleteError',
					'Could not delete {0}: {1}',
					surface.name,
					String((error as Error)?.message ?? error),
				)
			});
		}
	}

	private getSelectedSurface(): WorkspaceSurface | undefined {
		if (!this.selectedSurfaceId || this.selectedSurfaceId === ADD_SURFACE_ID) {
			return undefined;
		}
		return this.consoleService.getSurface(this.selectedSurfaceId);
	}

	private getTargetEmbeddedUiUrl(): string | undefined {
		const selectedSurface = this.getSelectedSurface();
		if (selectedSurface) {
			return selectedSurface.localUrl;
		}
		return this.devServerService.getActiveUrl();
	}

	private routeSelectedSurfacePreview(): void {
		if (this.modeService.getMode() === 'Code') {
			return;
		}
		this.updateSurfaceFeatureChecklistVisibility();
		this.renderSelectedSurfaceLaunchPanel();

		if (this.contextGatheringOpen) {
			this.container.classList.add('custom-mode-ui-surface-selected');
			if (this.selectedSurfaceId === ADD_SURFACE_ID) {
				this.setAddSurfaceState();
				this.clearEmbeddedUiUrl();
				this.pushUiRuntimeLog('[surface] selected add surface');
				return;
			}
			this.setGoalOverviewState();
			this.clearEmbeddedUiUrl();
			this.pushUiRuntimeLog('[surface] context gathering open');
			return;
		}

		if (this.selectedSurfaceId === ADD_SURFACE_ID) {
			this.contextGatheringOpen = true;
			this.persistContextGatheringOpen();
			this.syncContextGatheringUi();
			this.container.classList.add('custom-mode-ui-surface-selected');
			this.setAddSurfaceState();
			this.clearEmbeddedUiUrl();
			this.pushUiRuntimeLog('[surface] selected add surface');
			return;
		}

		const surface = this.getSelectedSurface();
		this.container.classList.toggle('custom-mode-ui-surface-selected', Boolean(surface));
		if (!surface) {
			this.setSurfaceEmptyState(undefined);
			return;
		}

		const url = surface.localUrl;
		if (!url) {
			this.setSurfaceMissingUrlState(surface);
			this.clearEmbeddedUiUrl();
			this.logSelectedSurfaceRoute(surface, undefined);
			return;
		}

		this.setSurfaceEmptyState(undefined);
		if (!this.embeddedUiShowsUrl(url)) {
			this.setEmbeddedUiUrl(url);
		}
		void this.checkUrlReachable(url);
		this.logSelectedSurfaceRoute(surface, url);
	}

	private updateSurfaceFeatureChecklistVisibility(): void {
		const showChecklist = Boolean(this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID);
		this.uiFeatureChecklistColumn.classList.toggle('hidden', !showChecklist);
	}

	private renderSelectedSurfaceLaunchPanel(): void {
		this.surfaceLaunchActionDisposables.clear();
		this.uiSurfaceLaunchPanel.replaceChildren();

		const surface = this.getSelectedSurface();
		if (!surface || this.contextGatheringOpen) {
			this.uiSurfaceLaunchPanel.classList.add('hidden');
			return;
		}

		const command = surface.devCommand?.trim();
		if (!command) {
			this.uiSurfaceLaunchPanel.classList.remove('hidden');
			this.uiSurfaceLaunchPanel.appendChild($('div.custom-mode-ui-surface-launch-meta', undefined,
				localize('customMode.surfaceLaunchMissingCommand', 'No start command for {0}. Add devCommand in workspace.goal.json.', surface.name)));
			return;
		}

		const workspaceFolder = this.getWorkspaceFolderUri();
		const displayedCommand = this.alignSurfaceCommandToPreferredPort(command, surface.localUrl);
		this.uiSurfaceLaunchPanel.classList.remove('hidden');
		this.uiSurfaceLaunchPanel.appendChild($('div.custom-mode-ui-surface-launch-meta', undefined,
			surface.localUrl
				? localize('customMode.surfaceLaunchMetaWithUrl', '{0} -> {1}', surface.name, surface.localUrl)
				: surface.name));
		this.uiSurfaceLaunchPanel.appendChild($('code.custom-mode-ui-surface-launch-copy', { title: displayedCommand }, displayedCommand));
		if (workspaceFolder) {
			const runButton = $('button.custom-mode-ui-surface-launch-run', { type: 'button' },
				localize('customMode.surfaceLaunchRunTerminal', 'Run in terminal')) as HTMLButtonElement;
			this.surfaceLaunchActionDisposables.add(addDisposableListener(runButton, 'click', () => {
				void this.runSurfaceCommandInTerminal(surface.id, workspaceFolder, surface.name, command, surface.localUrl, { force: true });
			}));
			this.uiSurfaceLaunchPanel.appendChild(runButton);
		}
	}

	async playSelectedSurfaceWorkflow(surfaceId?: string): Promise<void> {
		const surface = this.resolveSurfaceForWorkflow(surfaceId);
		if (!surface) {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.noSurface', 'No surface is available for workflow autoplay.'));
			return;
		}
		let workflow = this.workflowCatalogService.listWorkflows().find(item => item.scope === 'surface' && item.surfaceId === surface.id);
		if (!workflow) {
			workflow = await this.seedSurfaceWorkflowIfMissing(surface.id);
		}
		if (!workflow) {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.noWorkflow', 'No stored workflow found for {0}.', surface.name));
			return;
		}

		this.ensureWorkspaceView();
		if (this.selectedSurfaceId !== surface.id) {
			this.selectGoalSurface(surface.id);
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.noWorkspace', 'Open a workspace folder before autoplay.'));
			return;
		}
		await this.selectUiChatSurfaceAsync(surface.id);
		const ixSubsystems = await discoverIxSubsystemRegions(this.ixIntegrationService, workspaceFolder);
		const result = await this.workflowRunnerService.runWorkflow({
			workflow,
			ixSubsystems,
			handlers: {
				ensureServer: async () => {
					await this.onStartAppClicked();
				},
				navigate: async (route) => {
					const url = this.joinSurfaceRoute(surface.localUrl, route);
					if (url) {
						this.setEmbeddedUiUrl(url);
						await this.waitForEmbeddedUiSettled();
					}
				},
				click: async (step) => {
					await this.clickEmbeddedUiTarget(step);
				},
				assertText: async (step) => {
					await this.assertEmbeddedUiText(step);
				},
				verifySurface: async (targetSurfaceId) => {
					const verification = await verifySurfaceBlueprint({
						fileService: this.fileService,
						workspaceFolder,
						surfaceId: targetSurfaceId,
						ixSubsystems,
						persistStatus: true,
					});
					return {
						passed: verification.passed,
						report: verification.gaps.map(gap => `${gap.kind}: ${gap.message}`).join('\n'),
					};
				},
			},
		});

		if (result.ok) {
			this.notificationService.info(localize('customMode.surfaceWorkflow.success', 'Autoplay completed for {0}.', surface.name));
		} else {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.failed', 'Autoplay failed for {0}.', surface.name));
		}
		this.pushUiRuntimeLog(`[workflow-play] ${workflow.id}: ${result.ok ? 'passed' : 'failed'}`);
		void this.surfaceFeatureChecklistService.refresh();
	}

	private async playSelectedSurfaceWorkflowStep(surfaceId: string | undefined, stepId: string): Promise<void> {
		const surface = this.resolveSurfaceForWorkflow(surfaceId);
		if (!surface) {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.noSurface', 'No surface is available for workflow autoplay.'));
			return;
		}
		let workflow = this.workflowCatalogService.listWorkflows().find(item => item.scope === 'surface' && item.surfaceId === surface.id);
		if (!workflow) {
			workflow = await this.seedSurfaceWorkflowIfMissing(surface.id);
		}
		const step = workflow?.steps.find(candidate => candidate.id === stepId);
		if (!workflow || !step) {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.noStep', 'No stored workflow action found for {0}.', surface.name));
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return;
		}
		const ixSubsystems = await discoverIxSubsystemRegions(this.ixIntegrationService, workspaceFolder);
		const singleStepWorkflow: WorkflowSpec = {
			...workflow,
			id: `${workflow.id}:${step.id}`,
			label: `${workflow.label} • ${step.id}`,
			steps: [{ id: 'ensure-server', type: 'ensureServer' }, step],
			ixBindings: workflow.ixBindings.filter(binding => binding.stepId === step.id),
		};
		const result = await this.workflowRunnerService.runWorkflow({
			workflow: singleStepWorkflow,
			ixSubsystems,
			handlers: {
				ensureServer: async () => { await this.onStartAppClicked(); },
				navigate: async route => {
					const url = this.joinSurfaceRoute(surface.localUrl, route);
					if (url) {
						this.setEmbeddedUiUrl(url);
						await this.waitForEmbeddedUiSettled();
					}
				},
				click: async runStep => this.clickEmbeddedUiTarget(runStep),
				assertText: async runStep => this.assertEmbeddedUiText(runStep),
				verifySurface: async () => ({ passed: true, report: '' }),
			},
		});
		if (result.ok) {
			this.notificationService.info(localize('customMode.surfaceWorkflow.stepSuccess', 'Ran action "{0}" for {1}.', step.id, surface.name));
		} else {
			this.notificationService.warn(localize('customMode.surfaceWorkflow.stepFailed', 'Action "{0}" failed for {1}.', step.id, surface.name));
		}
	}

	private resolveSurfaceForWorkflow(surfaceId?: string): WorkspaceSurface | undefined {
		if (surfaceId) {
			return this.consoleService.getSurface(surfaceId);
		}
		const selected = this.getSelectedSurface();
		if (selected) {
			return selected;
		}
		const embeddedUrl = this.getEmbeddedUiUrl();
		if (embeddedUrl) {
			const matched = this.consoleService.getSurfaces().find(surface => surface.localUrl === embeddedUrl);
			if (matched) {
				return matched;
			}
		}
		return this.consoleService.getSurfaces()[0];
	}

	private async seedSurfaceWorkflowIfMissing(surfaceId: string): Promise<WorkflowSpec | undefined> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		const surface = this.consoleService.getSurface(surfaceId);
		if (!workspaceFolder || !surface) {
			return undefined;
		}
		const blueprint = await readBlueprint(this.fileService, blueprintResource(workspaceFolder, surfaceId));
		if (!blueprint) {
			return undefined;
		}
		const routeSteps = blueprint.acceptance.requiredRoutes.map((route, index) => ({
			id: `navigate-${index + 1}`,
			type: 'navigate' as const,
			route,
		}));
		const actionSteps = blueprint.acceptance.requiredUiSignals.map((signal, index) => ({
			id: `action-${index + 1}`,
			type: 'click' as const,
			target: { text: signal },
		}));
		const assertSteps = blueprint.acceptance.requiredWorkflows.slice(0, 2).map((workflow, index) => ({
			id: `assert-${index + 1}`,
			type: 'assertText' as const,
			target: { text: workflow },
		}));
		const seeded: WorkflowSpec = {
			id: surfaceId === 'booking' ? 'booking-intake' : `${surfaceId}-autoplay`,
			label: `${surface.name} workflow`,
			scope: 'surface',
			surfaceId,
			source: `template:${blueprint.templateId}`,
			steps: [{ id: 'ensure-server', type: 'ensureServer' }, ...routeSteps, ...actionSteps, ...assertSteps],
			events: [...surface.events],
			ixBindings: blueprint.manifest.ixSubsystems.slice(0, actionSteps.length).map((label, index) => ({
				stepId: actionSteps[index]?.id ?? `action-${index + 1}`,
				subsystemLabel: label,
			})),
			fixtures: {
				leadEmail: 'booking-autoplay@example.com',
			},
		};
		const workflowsRoot = this.consoleService.getWorkspace()?.shared.workflows ?? 'workflows';
		await upsertWorkflowSpec(this.fileService, workflowCatalogResource(workspaceFolder, workflowsRoot), seeded);
		await this.workflowCatalogService.refresh();
		return this.workflowCatalogService.getWorkflow(seeded.id);
	}

	private joinSurfaceRoute(baseUrl: string | undefined, route: string | undefined): string | undefined {
		if (!baseUrl) {
			return undefined;
		}
		if (!route || route === '/') {
			return baseUrl;
		}
		try {
			return new URL(route.startsWith('/') ? route : `/${route}`, baseUrl).toString();
		} catch {
			return baseUrl;
		}
	}

	private async waitForEmbeddedUiSettled(): Promise<void> {
		await new Promise<void>(resolve => setTimeout(resolve, 250));
	}

	private async clickEmbeddedUiTarget(step: WorkflowStep): Promise<void> {
		const target = step.target;
		if (!target) {
			throw new Error(`Step ${step.id} has no click target.`);
		}
		const text = target.text ? JSON.stringify(target.text) : 'undefined';
		const ariaLabel = target.ariaLabel ? JSON.stringify(target.ariaLabel) : 'undefined';
		const selector = target.selector ? JSON.stringify(target.selector) : 'undefined';
		const script = `(function(){const bySelector=${selector};const byAria=${ariaLabel};const byText=${text};let el; if (bySelector) { el = document.querySelector(bySelector); } if (!el && byAria) { el = document.querySelector('[aria-label="' + byAria.replace(/"/g,'\\"') + '"]'); } if (!el && byText) { const candidates = Array.from(document.querySelectorAll('button,a,label,[role="button"]')); el = candidates.find(node => ((node.textContent||'').trim()).includes(byText)); } if (!el) { throw new Error('No element matched click target'); } el.click(); return true; })()`;
		await this.executeEmbeddedUiScript(script);
		await this.waitForEmbeddedUiSettled();
	}

	private async assertEmbeddedUiText(step: WorkflowStep): Promise<void> {
		const expected = step.target?.text ?? step.value;
		if (!expected) {
			throw new Error(`Step ${step.id} has no assertion text.`);
		}
		const script = `(function(){ const expected=${JSON.stringify(expected)}; const text=((document.body && document.body.innerText) || '').toLowerCase(); if (!text.includes(expected.toLowerCase())) { throw new Error('Missing expected text: ' + expected); } return true; })()`;
		await this.executeEmbeddedUiScript(script);
	}

	private async executeEmbeddedUiScript(script: string): Promise<unknown> {
		if (isWeb) {
			const iframe = this.uiBrowser as unknown as HTMLIFrameElement;
			const doc = iframe.contentDocument;
			if (!doc?.defaultView) {
				throw new Error('Embedded iframe is not ready.');
			}
			return doc.defaultView.eval(script);
		}
		const webview = this.uiBrowser as unknown as { executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown> };
		return webview.executeJavaScript?.(script, true);
	}

	private setAddSurfaceState(): void {
		this.setSurfaceSetupDashboardState();
	}

	private setSurfaceSetupDashboardState(): void {
		this.uiSetup.classList.add('custom-mode-setup-hidden');
		this.uiBrowserShell.classList.add('custom-mode-ui-surface-missing-url');
		this.uiSurfaceEmptyState.classList.add('hidden');
		this.uiSurfaceSetupDashboard.classList.remove('hidden');
		this.setSurfaceSetupBuilderOpen(true);
		void this.refreshSurfaceSetupDashboard();
	}

	private setSurfaceMissingUrlState(surface: WorkspaceSurface | undefined): void {
		if (!surface) {
			this.setSurfaceEmptyState(undefined);
			return;
		}

		this.setSurfaceEmptyState({
			title: localize('customMode.surfaceMissingUrlTitle', '{0} has no preview URL', surface.name),
			subtitle: localize(
				'customMode.surfaceMissingUrlSubtitle',
				'Add localUrl to this surface in workspace.goal.json to route the preview.'
			)
		});
	}

	private setSurfaceServerDownState(surface: WorkspaceSurface, url: string): void {
		this.setSurfaceEmptyState({
			title: localize('customMode.surfaceServerDownTitle', '{0} preview is not reachable', surface.name),
			subtitle: surface.devCommand?.trim()
				? localize('customMode.surfaceServerDownWithCommand', 'Starting `{0}` for {1}. The preview will load when the server is ready.', surface.devCommand.trim(), url)
				: localize('customMode.surfaceServerDownNoCommand', 'Start the surface dev server for {0}, or add devCommand to this surface in workspace.goal.json.', url)
		});
	}

	private setGoalOverviewState(): void {
		const goal = this.consoleService.getGoal();
		const surfaces = this.consoleService.getSurfaces();
		const title = goal?.name
			? localize('customMode.goalOverviewTitle', 'Goal: {0}', goal.name)
			: localize('customMode.goalOverviewFallbackTitle', 'Goal Workspace');
		const parts: string[] = [];
		if (goal?.description) {
			parts.push(goal.description);
		}
		if (goal?.northStarMetric) {
			parts.push(localize('customMode.goalOverviewNorthStar', 'North-star metric: {0}.', goal.northStarMetric));
		}
		parts.push(localize('customMode.goalOverviewSurfaceCount', '{0} surface(s): {1}.', surfaces.length, surfaces.map(surface => surface.name).join(', ')));
		this.setSurfaceEmptyState({ title, subtitle: parts.join('\n') });
	}

	private setGoalWorkspaceManifestStateMessage(status: string, diagnostics: readonly { readonly path: string; readonly message: string }[]): void {
		if (status === 'no-workspace') {
			this.setSurfaceEmptyState({
				title: localize('customMode.goalWorkspaceNoWorkspaceTitle', 'Build your goal workspace'),
				subtitle: localize(
					'customMode.goalWorkspaceNoWorkspaceDetail',
					'Open a goal workspace to name the business, set brand assets, and generate surfaces one at a time from the Guided Builder.'
				)
			});
			return;
		}

		if (status === 'invalid') {
			const diagnostic = diagnostics[0];
			this.setSurfaceEmptyState({
				title: localize('customMode.goalWorkspaceInvalidTitle', 'Invalid workspace.goal.json'),
				subtitle: diagnostic
					? localize('customMode.goalWorkspaceInvalidDetail', '{0}: {1}', diagnostic.path, diagnostic.message)
					: localize('customMode.goalWorkspaceInvalidGeneric', 'Fix the manifest diagnostics to show goal surfaces.')
			});
			return;
		}

		if (status === 'missing') {
			this.setSurfaceEmptyState({
				title: localize('customMode.goalWorkspaceMissingTitle', 'No goal workspace manifest'),
				subtitle: localize('customMode.goalWorkspaceMissingDetail', 'Add workspace.goal.json at the workspace root or convert this folder into a goal workspace to show business surfaces.')
			});
			return;
		}

		this.setSurfaceEmptyState(undefined);
	}

	private setSurfaceEmptyState(message: { readonly title: string; readonly subtitle: string } | undefined): void {
		this.uiBrowserShell.classList.toggle('custom-mode-ui-surface-missing-url', Boolean(message));
		this.uiSurfaceSetupDashboard.classList.add('hidden');
		this.setSurfaceSetupBuilderOpen(false);
		this.uiSurfaceEmptyState.classList.toggle('hidden', !message);
		this.uiSurfaceEmptyTitle.textContent = message?.title ?? '';
		this.uiSurfaceEmptySubtitle.textContent = message?.subtitle ?? '';
	}

	private formatGoalSurfaceDescription(surface: WorkspaceSurface): string {
		const parts = [surface.name];
		if (surface.type) {
			parts.push(localize('customMode.surfaceDescriptionType', 'Type: {0}', surface.type));
		}
		if (surface.path) {
			parts.push(localize('customMode.surfaceDescriptionPath', 'Path: {0}', surface.path));
		}
		if (surface.purpose) {
			parts.push(surface.purpose);
		}
		if (surface.devCommand) {
			parts.push(localize('customMode.surfaceDescriptionCommand', 'Start command: {0}', surface.devCommand));
		}
		if (surface.localUrl) {
			parts.push(localize('customMode.surfaceDescriptionUrl', 'Preview: {0}', surface.localUrl));
		}
		if (surface.capabilities.length) {
			parts.push(localize('customMode.surfaceDescriptionCapabilities', 'Capabilities: {0}', surface.capabilities.join(', ')));
		}
		if (surface.events.length) {
			parts.push(localize('customMode.surfaceDescriptionEvents', 'Events: {0}', surface.events.join(', ')));
		}
		if (surface.entities.length) {
			parts.push(localize('customMode.surfaceDescriptionEntities', 'Entities: {0}', surface.entities.join(', ')));
		}
		if (surface.ixSubsystems.length) {
			parts.push(localize('customMode.surfaceDescriptionIxSubsystems', 'Ix subsystems: {0}', surface.ixSubsystems.join(', ')));
		}
		if (surface.ix?.tags.length) {
			parts.push(localize('customMode.surfaceDescriptionIxTags', 'Ix tags: {0}', surface.ix.tags.join(', ')));
		}
		if (surface.ix?.notes) {
			parts.push(localize('customMode.surfaceDescriptionIxNotes', 'Ix notes: {0}', surface.ix.notes));
		}
		return parts.join('\n');
	}

	private logSelectedSurfaceRoute(surface: WorkspaceSurface, url: string | undefined): void {
		const key = `${surface.id}:${url ?? ''}`;
		if (this.lastSurfaceRoutingLogKey === key) {
			return;
		}
		this.lastSurfaceRoutingLogKey = key;
		this.pushUiRuntimeLog(`[surface] selected ${surface.id} (${surface.name}) url=${url ?? 'none'}`);
	}

	private refreshStartCommandHints(): void {
		void this.devServerService.getSuggestedStartCommands().then(hints => {
			this.startHintActionDisposables.clear();
			this.renderUiStartBar(hints);
			this.renderStartHintsInto(this.processStartHints, hints);
		});
	}

	private renderUiStartBar(hints: DevServerSuggestedCommands | undefined): void {
		this.lastUiStartHints = hints;
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const surface = this.getSelectedSurface();
		const surfaceCommand = surface?.devCommand?.trim();
		const goalWorkspaceState = this.consoleService.getState();

		if (!hasProject) {
			this.uiStartSubtitle.textContent = '';
			this.updateStartAppControl();
			this.syncUiStartPanelVisibility();
			return;
		}

		if (goalWorkspaceState.status === 'loaded' && !surface) {
			this.uiStartSubtitle.textContent = '';
			this.uiStartStatus.textContent = '';
			this.uiRuntimeText.textContent = '';
			this.updateStartAppControl();
			this.syncUiStartPanelVisibility();
			return;
		}

		if (surface) {
			if (!surfaceCommand) {
				this.uiStartSubtitle.textContent = localize(
					'customMode.surfaceStartNoCommand',
					'Add devCommand to {0} in workspace.goal.json to start this surface from UI Mode.',
					surface.name
				);
			} else {
				const urlPart = surface.localUrl
					? localize('customMode.surfaceStartWillLoadUrl', ' Opens {0} when the server is ready.', surface.localUrl)
					: '';
				this.uiStartSubtitle.textContent = localize('customMode.surfaceStartSubtitleRun', 'Runs for {0}: {1}.{2}', surface.name, surfaceCommand, urlPart);
			}
			this.updateStartAppControl();
			this.maybeAutoStartApp();
			this.syncUiStartPanelVisibility();
			return;
		}

		if (!hints) {
			this.uiStartSubtitle.textContent = localize('customMode.startAppNoPackageJson', 'Open a folder whose root contains package.json to start the app.');
			this.updateStartAppControl();
			this.syncUiStartPanelVisibility();
			return;
		}

		if (!hints.primaryRunCommand) {
			this.uiStartSubtitle.textContent = localize('customMode.startAppNoDevScript', 'Add a "dev", "start", or "web" script to package.json, then click Start App.');
			this.updateStartAppControl();
			this.syncUiStartPanelVisibility();
			return;
		}

		const cmd = hints.combinedCommandLine ?? hints.primaryRunCommand;
		const urlPart = hints.inferredUrl
			? localize('customMode.startAppWillLoadUrl', ' Opens {0} when the server is ready.', hints.inferredUrl)
			: '';
		this.uiStartSubtitle.textContent = hints.hasNodeModules
			? localize('customMode.startAppSubtitleRun', 'Runs: {0}.{1}', cmd, urlPart)
			: localize('customMode.startAppSubtitleInstallRun', 'Installs dependencies if needed, then runs: {0}.{1}', cmd, urlPart);
		this.updateStartAppControl();
		this.maybeAutoStartApp();
		this.syncUiStartPanelVisibility();
	}

	private syncUiStartPanelVisibility(): void {
		const state = this.devServerService.getState();
		const starting = state.phase === 'installing' || state.phase === 'starting';
		this.uiSetup.classList.toggle('custom-mode-setup-active', starting);
		this.uiSetup.classList.toggle('custom-mode-setup-hidden', !starting);

		if (!starting) {
			this.uiRuntimeText.textContent = '';
			this.uiRuntimeLogs.length = 0;
		}
	}

	private updateStartAppControl(): void {
		const state = this.devServerService.getState();
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const hints = this.lastUiStartHints;
		const surfaceCommand = this.getSelectedSurface()?.devCommand?.trim();
		const goalWorkspaceState = this.consoleService.getState();
		const canStartAll = goalWorkspaceState.status === 'loaded'
			&& this.selectedSurfaceId === ADD_SURFACE_ID
			&& this.consoleService.getSurfaces().some(surface => Boolean(surface.devCommand?.trim()));
		const canUseFallbackScript = goalWorkspaceState.status !== 'loaded';
		const canStart = hasProject && Boolean(surfaceCommand || (canUseFallbackScript && hints?.primaryRunCommand));
		const busy = state.phase === 'installing' || state.phase === 'starting';
		this.uiStartAppButton.disabled = !canStart || busy;
		this.uiStartAllSurfacesButton.disabled = this.startAllSurfacesInProgress || !canStartAll;
		this.uiStartAllSurfacesButton.classList.toggle('hidden', this.selectedSurfaceId !== ADD_SURFACE_ID);
	}

	private async onStartAppClicked(): Promise<void> {
		try {
			const goalWorkspaceState = this.consoleService.getState();
			const surface = this.getSelectedSurface();
			const surfaceCommand = surface?.devCommand?.trim();
			if (goalWorkspaceState.status === 'loaded') {
				if (!surface) {
					this.notificationService.notify({
						severity: Severity.Warning,
						message: localize('customMode.startAppSurfaceRequired', 'Select a surface before starting an app in goal-workspace mode.')
					});
					return;
				}
				if (!surfaceCommand) {
					this.notificationService.notify({
						severity: Severity.Warning,
						message: localize(
							'customMode.startAppSurfaceMissingCommand',
							'Surface launch contract invalid: add devCommand for {0} in workspace.goal.json.',
							surface.name
						)
					});
					return;
				}
			}
			const url = surfaceCommand
				? await this.devServerService.ensureRunningWithCommand(surfaceCommand, surface?.localUrl, surface?.name)
				: await this.devServerService.ensureRunning();
			if (url === undefined) {
				const st = this.devServerService.getState();
				this.notificationService.notify({
					severity: Severity.Warning,
					message: st.lastError ?? localize('customMode.startAppFailedGeneric', 'Could not start the app. See the status below or check package.json scripts.')
				});
			}
		} catch (e: unknown) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: String((e as Error)?.message ?? e)
			});
		}
	}

	private async onStartAllSurfacesClicked(): Promise<void> {
		if (this.startAllSurfacesInProgress) {
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.startAllSurfacesNoWorkspace', 'Open a workspace folder before starting surfaces.')
			});
			return;
		}
		const surfaces = this.consoleService.getSurfaces().filter(surface => Boolean(surface.devCommand?.trim()));
		if (surfaces.length === 0) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.startAllSurfacesNoCommands', 'No surfaces have a devCommand in workspace.goal.json.')
			});
			return;
		}

		this.startAllSurfacesInProgress = true;
		this.updateStartAppControl();
		await freeSurfacePorts(collectUniqueSurfacePorts(surfaces));
		const pending = [...surfaces];
		const started: string[] = [];
		const failed: string[] = [];
		const workers = Array.from({ length: Math.min(5, pending.length) }, async () => {
			while (pending.length > 0) {
				const surface = pending.shift();
				if (!surface) {
					return;
				}
				const command = surface.devCommand?.trim();
				if (!command) {
					continue;
				}
				try {
					await this.runSurfaceCommandInTerminal(surface.id, workspaceFolder, surface.name, command, surface.localUrl, { force: true });
					started.push(surface.name);
					this.pushUiRuntimeLog(`[surface-start-all] ${surface.id}: ${command}`);
				} catch (error: unknown) {
					failed.push(`${surface.name}: ${String((error as Error)?.message ?? error)}`);
				}
			}
		});

		try {
			await Promise.all(workers);
		} finally {
			this.startAllSurfacesInProgress = false;
			this.updateStartAppControl();
			void this.refreshStarterSurfaceCardStatuses();
		}

		if (failed.length === 0) {
			this.notificationService.notify({
				severity: Severity.Info,
				message: localize('customMode.startAllSurfacesSuccess', 'Started {0} surface dev server(s).', started.length)
			});
			return;
		}

		this.notificationService.notify({
			severity: Severity.Warning,
			message: localize(
				'customMode.startAllSurfacesPartial',
				'Started {0} surface(s); {1} failed. See runtime logs for details.',
				started.length,
				failed.length,
			)
		});
		for (const line of failed.slice(0, 5)) {
			this.pushUiRuntimeLog(`[surface-start-all:error] ${line}`);
		}
	}

	private async ensureSurfaceServerStarted(surface: WorkspaceSurface): Promise<void> {
		const command = surface.devCommand?.trim();
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!command || !workspaceFolder) {
			return;
		}
		try {
			await this.runSurfaceCommandInTerminal(surface.id, workspaceFolder, surface.name, command, surface.localUrl);
		} catch (error: unknown) {
			this.pushUiRuntimeLog(`[surface-autostart:error] ${surface.id}: ${String((error as Error)?.message ?? error)}`);
		}
	}

	private async runSurfaceCommandInTerminal(surfaceId: string, workspaceFolder: URI, surfaceName: string, command: string, preferredUrl?: string, options?: { force?: boolean }): Promise<void> {
		if (!options?.force && (this.startedSurfaceServers.has(surfaceId) || this.startingSurfaceServers.has(surfaceId))) {
			return;
		}
		this.startingSurfaceServers.add(surfaceId);
		const title = `Surface Dev — ${surfaceName}`;
		const existing = this.terminalService.instances.find(instance => instance.title === title);
		try {
			const alignedCommand = this.alignSurfaceCommandToPreferredPort(command, preferredUrl);
			await this.freeSurfacePortForLaunch(preferredUrl, alignedCommand);
			const terminal = existing ?? await this.terminalService.createTerminal({
				cwd: workspaceFolder,
				config: isWindows ? undefined : { executable: '/bin/bash' }
			});
			if (!existing) {
				await terminal.rename(title);
			}
			terminal.sendText(alignedCommand, true);
			this.startedSurfaceServers.add(surfaceId);
			void this.refreshStarterSurfaceCardStatuses();
		} finally {
			this.startingSurfaceServers.delete(surfaceId);
		}
	}

	private alignSurfaceCommandToPreferredPort(command: string, preferredUrl: string | undefined): string {
		const preferredPort = this.parsePortFromUrl(preferredUrl);
		if (typeof preferredPort !== 'number') {
			return command;
		}
		if (/\b(?:npm|pnpm)\b.*\brun\s+dev\b/i.test(command) || /\byarn\b.*\bdev\b/i.test(command)) {
			return `${this.removeSurfaceCommandPortFlags(command, true)} -- --port ${preferredPort}`;
		}
		if (/\bnext\s+dev\b/i.test(command)) {
			return `${this.removeSurfaceCommandPortFlags(command, false)} --port ${preferredPort}`;
		}
		return command;
	}

	private removeSurfaceCommandPortFlags(command: string, isScriptRunCommand: boolean): string {
		let next = command.replace(/\bPORT=\d{2,5}\b/g, '').trim();
		if (isScriptRunCommand) {
			next = next.replace(/\s+--\s+(?:--\s+)*--port(?:=|\s+)\d{2,5}\b/g, '');
			next = next.replace(/\s+--\s+(?:--\s+)*-p\s+\d{2,5}\b/g, '');
			next = next.replace(/\s+--\s*$/g, '');
		}
		next = next.replace(/\s--port(?:=|\s+)\d{2,5}\b/g, '');
		next = next.replace(/\s-p\s+\d{2,5}\b/g, '');
		return next.replace(/\s{2,}/g, ' ').trim();
	}

	private parsePortFromUrl(url: string | undefined): number | undefined {
		if (!url) {
			return undefined;
		}
		const match = /:(\d{2,5})(?:\/|$)/.exec(url);
		if (!match) {
			return undefined;
		}
		const parsed = Number(match[1]);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	private maybeAutoStartApp(): void {
		if (this.autoStartAppAttempted) {
			return;
		}

		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const hints = this.lastUiStartHints;
		const goalWorkspaceState = this.consoleService.getState();
		const surfaceCommand = this.getSelectedSurface()?.devCommand?.trim();
		const canUseFallbackScript = goalWorkspaceState.status !== 'loaded';
		if (!hasProject || !(surfaceCommand || (canUseFallbackScript && hints?.primaryRunCommand))) {
			return;
		}

		const state = this.devServerService.getState();
		if (state.phase !== 'idle') {
			this.autoStartAppAttempted = true;
			return;
		}

		this.autoStartAppAttempted = true;
		queueMicrotask(() => void this.onStartAppClicked());
	}

	private renderStartHintsInto(root: HTMLElement, hints: DevServerSuggestedCommands | undefined): void {
		while (root.firstChild) {
			root.removeChild(root.firstChild);
		}

		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		if (!hasProject) {
			return;
		}

		const goalWorkspaceState = this.consoleService.getState();
		if (goalWorkspaceState.status === 'loaded') {
			const selectedSurface = this.getSelectedSurface();
			if (!selectedSurface) {
				root.appendChild($('div.custom-mode-start-hints-title', undefined, localize('customMode.startHintsSurfaceRequiredTitle', 'Select a surface')));
				root.appendChild($('div.custom-mode-start-hints-row', undefined,
					localize('customMode.startHintsSurfaceRequiredDetail', 'Goal-workspace launch uses per-surface commands from workspace.goal.json.')));
				return;
			}
			const command = selectedSurface.devCommand?.trim();
			if (!command) {
				root.appendChild($('div.custom-mode-start-hints-title', undefined, localize('customMode.startHintsSurfaceMissingCommandTitle', 'Missing devCommand')));
				root.appendChild($('div.custom-mode-start-hints-row', undefined,
					localize('customMode.startHintsSurfaceMissingCommandDetail', 'Add devCommand for {0} to satisfy the surface launch contract.', selectedSurface.name)));
				return;
			}
			const commandRow = $('div.custom-mode-start-hints-cmdRow');
			commandRow.appendChild($('pre.custom-mode-start-hints-pre', undefined, command));
			const cwd = this.getWorkspaceFolderUri();
			if (cwd) {
				commandRow.appendChild(this.addStartHintRunButton(
					localize('customMode.startHintsRunSurfaceCommand', 'Run surface command'),
					cwd,
					command
				));
			}
			root.appendChild($('div.custom-mode-start-hints-title', undefined, localize('customMode.startHintsSurfaceCommandTitle', 'Surface start command')));
			root.appendChild(commandRow);
			if (selectedSurface.localUrl) {
				root.appendChild($('div.custom-mode-start-hints-row', undefined,
					localize('customMode.startHintsSurfaceUrl', 'Expected preview URL: {0}', selectedSurface.localUrl)));
			}
			return;
		}

		if (!hints) {
			root.appendChild($('div.custom-mode-start-hints-title', undefined, localize('customMode.startHintsNoPackage', 'No package.json')));
			root.appendChild($('div.custom-mode-start-hints-row', undefined,
				localize('customMode.startHintsNoPackageDetail', 'Open a folder whose root contains package.json to see install and dev server commands.')));
			return;
		}

		root.appendChild($('div.custom-mode-start-hints-title', undefined, localize('customMode.startHintsTitle', 'Start commands (from package.json)')));

		root.appendChild($('div.custom-mode-start-hints-row', undefined, localize('customMode.startHintsPm', 'Package manager: {0}', hints.packageManager)));

		const installRow = $('div.custom-mode-start-hints-row.custom-mode-start-hints-actionRow');
		installRow.appendChild(document.createTextNode(localize('customMode.startHintsInstall', 'Install dependencies: ')));
		installRow.appendChild($('code', undefined, hints.installCommand));
		installRow.appendChild(this.addStartHintRunButton(
			localize('customMode.startHintsRunInstall', 'Run install'),
			hints.workspaceFolder,
			hints.installCommand
		));
		root.appendChild(installRow);

		if (hints.primaryRunCommand) {
			const primaryLabel = hints.primaryScript
				? localize('customMode.startHintsPrimary', 'Recommended dev server (script "{0}"):', hints.primaryScript)
				: localize('customMode.startHintsPrimaryGeneric', 'Recommended dev server:');
			root.appendChild($('div.custom-mode-start-hints-row', undefined, primaryLabel));
			const primaryCmd = hints.combinedCommandLine ?? hints.primaryRunCommand;
			const cmdRow = $('div.custom-mode-start-hints-cmdRow');
			cmdRow.appendChild($('pre.custom-mode-start-hints-pre', undefined, primaryCmd));
			cmdRow.appendChild(this.addStartHintRunButton(
				localize('customMode.startHintsRunInTerminal', 'Run in terminal'),
				hints.workspaceFolder,
				primaryCmd
			));
			root.appendChild(cmdRow);
			if (!hints.hasNodeModules) {
				root.appendChild($('div.custom-mode-start-hints-row', undefined,
					localize('customMode.startHintsNoNodeModules', 'node_modules is missing; the command above chains install then start (same as UI mode auto-start).')));
			}
		} else {
			root.appendChild($('div.custom-mode-start-hints-row', undefined,
				localize('customMode.startHintsNoScript', 'No dev, start, or web script found. Pick a script from the list below or add a "dev" script.')));
		}

		if (hints.inferredUrl) {
			root.appendChild($('div.custom-mode-start-hints-row', undefined,
				localize('customMode.startHintsUrl', 'Typical app URL: {0}', hints.inferredUrl)));
		}

		if (hints.listedScripts.length > 0) {
			root.appendChild($('div.custom-mode-start-hints-row', undefined, localize('customMode.startHintsScripts', 'package.json scripts:')));
			const ul = document.createElement('ul');
			ul.className = 'custom-mode-start-hints-list';
			for (const s of hints.listedScripts) {
				const li = document.createElement('li');
				li.className = 'custom-mode-start-hints-list-item';
				const span = document.createElement('span');
				span.className = 'custom-mode-start-hints-list-text';
				span.textContent = `${s.name} — ${s.runCommand}`;
				li.appendChild(span);
				const runOne = this.addStartHintRunButton(
					localize('customMode.startHintsRunScript', 'Run'),
					hints.workspaceFolder,
					s.runCommand
				);
				runOne.setAttribute('aria-label', localize('customMode.startHintsRunScriptAria', 'Run script {0} in terminal', s.name));
				li.appendChild(runOne);
				ul.appendChild(li);
			}
			root.appendChild(ul);
		}
	}

	private addStartHintRunButton(label: string, cwd: URI, command: string): HTMLButtonElement {
		const btn = $('button.custom-mode-start-hints-run', { type: 'button' }, label) as HTMLButtonElement;
		this.startHintActionDisposables.add(addDisposableListener(btn, 'click', () => {
			void this.runSuggestedCommandInTerminal(cwd, command);
		}));
		return btn;
	}

	private async runSuggestedCommandInTerminal(cwd: URI, command: string): Promise<void> {
		const terminal = await this.terminalService.createTerminal({
			cwd,
			config: isWindows ? undefined : { executable: '/bin/bash' }
		});
		terminal.focus();
		terminal.sendText(command, true);
	}

	private pipelineNeedsLiveDuration(state: IxIntegrationState): boolean {
		return state.pipelineSteps.some(s => s.status === 'running');
	}

	private formatStepDuration(step: IxPipelineStepSnapshot): string {
		const now = Date.now();
		if (step.status === 'running' && step.startedAtMs !== undefined) {
			return `${((now - step.startedAtMs) / 1000).toFixed(1)}s`;
		}
		if (step.startedAtMs !== undefined && step.endedAtMs !== undefined) {
			return `${((step.endedAtMs - step.startedAtMs) / 1000).toFixed(1)}s`;
		}
		return '—';
	}

	private ixPipelineStatusGlyph(status: IxPipelineStepStatus): string {
		switch (status) {
			case 'idle': return '\u25cb';
			case 'running': return '\u25d4';
			case 'success': return '\u2713';
			case 'error': return '\u2717';
			case 'skipped': return '\u2014';
			default: return '?';
		}
	}

	private clearPipelineContainer(el: HTMLElement): void {
		while (el.firstChild) {
			el.removeChild(el.firstChild);
		}
	}

	private async copyTextToClipboard(text: string): Promise<void> {
		try {
			await mainWindow.navigator?.clipboard?.writeText(text);
			return;
		} catch {
			// fall through
		}
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', 'true');
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			ta.style.top = '0';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		} catch {
			// ignore
		}
	}

	private appendPipelineStep(parent: HTMLElement, step: IxPipelineStepSnapshot): void {
		const cached = this.ixPipelineStepNodes.get(step.id);
		if (cached) {
			this.updatePipelineStepNode(cached, step);
			parent.appendChild(cached.wrap);
			return;
		}

		const stepId = step.id;
		const wrap = $('div.custom-mode-ix-pipeline-step');
		wrap.classList.add(`status-${step.status}`);
		const head = $('div.custom-mode-ix-pipeline-step-head');
		const statusEl = $('span.custom-mode-ix-pipeline-status', { title: step.status, 'aria-label': step.status }, this.ixPipelineStatusGlyph(step.status));
		const labelEl = $('span.custom-mode-ix-pipeline-label', undefined, step.label);
		const durEl = $('span.custom-mode-ix-pipeline-dur', undefined, this.formatStepDuration(step));
		durEl.dataset['stepId'] = stepId;
		head.appendChild(statusEl);
		head.appendChild(labelEl);
		head.appendChild(durEl);
		wrap.appendChild(head);

		let cmdEl: HTMLElement | undefined;
		if (step.command) {
			const shown = step.command.length > 96 ? `${step.command.slice(0, 93)}\u2026` : step.command;
			cmdEl = $('div.custom-mode-ix-pipeline-cmd', { title: step.command }, shown);
			wrap.appendChild(cmdEl);
		}

		let errEl: HTMLElement | undefined;
		if (step.error) {
			errEl = $('div.custom-mode-ix-pipeline-err', undefined, step.error);
			wrap.appendChild(errEl);
		}

		const details = document.createElement('details');
		details.open = this.ixPipelineOpenOutput.has(stepId);
		const summary = document.createElement('summary');
		summary.textContent = localize('customMode.ixPipeline.output', 'Output');
		// Track open state synchronously on user intent to survive re-renders mid-toggle.
		this._register(addDisposableListener(summary, 'click', () => {
			// Click fires before <details> open flips; predict the post-click state.
			if (details.open) {
				this.ixPipelineOpenOutput.delete(stepId);
			} else {
				this.ixPipelineOpenOutput.add(stepId);
			}
		}));
		this._register(addDisposableListener(details, 'toggle', () => {
			if (details.open) {
				this.ixPipelineOpenOutput.add(stepId);
			} else {
				this.ixPipelineOpenOutput.delete(stepId);
			}
		}));
		details.appendChild(summary);

		const copyBtn = $('button.custom-mode-ix-pipeline-copy', { type: 'button' }, localize('customMode.ixPipeline.copy', 'Copy')) as HTMLButtonElement;
		this._register(addDisposableListener(copyBtn, 'click', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const cachedNode = this.ixPipelineStepNodes.get(stepId);
			const liveStep = this.lastIxPipelineState?.pipelineSteps.find(s => s.id === stepId);
			const text = (liveStep?.outputTail ?? cachedNode?.pre.textContent ?? '').trim();
			void this.copyTextToClipboard(text);
		}));
		details.appendChild(copyBtn);

		const tail = step.outputTail.trim();
		const pre = $('pre.custom-mode-ix-pipeline-pre', undefined,
			tail.length > 0 ? tail : localize('customMode.ixPipeline.noOutput', '(no output yet)'));
		pre.dataset['stepId'] = stepId;
		const restored = this.ixPipelineOutputScrollTops.get(stepId);
		if (typeof restored === 'number' && restored >= 0) {
			queueMicrotask(() => {
				try { pre.scrollTop = restored; } catch { /* ignore */ }
			});
		}
		this._register(addDisposableListener(pre, 'scroll', () => {
			try { this.ixPipelineOutputScrollTops.set(stepId, pre.scrollTop); } catch { /* ignore */ }
		}));
		details.appendChild(pre);
		wrap.appendChild(details);
		parent.appendChild(wrap);

		this.ixPipelineStepNodes.set(stepId, {
			wrap, statusEl, labelEl, durEl, cmdEl, errEl, details, pre,
			currentStatus: step.status,
		});
	}

	private updatePipelineStepNode(
		node: {
			readonly wrap: HTMLElement;
			readonly statusEl: HTMLElement;
			readonly labelEl: HTMLElement;
			readonly durEl: HTMLElement;
			cmdEl: HTMLElement | undefined;
			errEl: HTMLElement | undefined;
			readonly details: HTMLDetailsElement;
			readonly pre: HTMLElement;
			currentStatus: IxPipelineStepStatus;
		},
		step: IxPipelineStepSnapshot,
	): void {
		if (node.currentStatus !== step.status) {
			node.wrap.classList.remove(`status-${node.currentStatus}`);
			node.wrap.classList.add(`status-${step.status}`);
			node.statusEl.textContent = this.ixPipelineStatusGlyph(step.status);
			node.statusEl.setAttribute('title', step.status);
			node.statusEl.setAttribute('aria-label', step.status);
			node.currentStatus = step.status;
		}
		if (node.labelEl.textContent !== step.label) {
			node.labelEl.textContent = step.label;
		}
		const nextDur = this.formatStepDuration(step);
		if (node.durEl.textContent !== nextDur) {
			node.durEl.textContent = nextDur;
		}

		if (step.command) {
			const shown = step.command.length > 96 ? `${step.command.slice(0, 93)}\u2026` : step.command;
			if (!node.cmdEl) {
				node.cmdEl = $('div.custom-mode-ix-pipeline-cmd', { title: step.command }, shown);
				// Insert after head (first child).
				const after = node.wrap.firstChild?.nextSibling ?? null;
				node.wrap.insertBefore(node.cmdEl, after);
			} else {
				if (node.cmdEl.textContent !== shown) {
					node.cmdEl.textContent = shown;
				}
				node.cmdEl.setAttribute('title', step.command);
			}
		} else if (node.cmdEl) {
			node.cmdEl.remove();
			node.cmdEl = undefined;
		}

		if (step.error) {
			if (!node.errEl) {
				node.errEl = $('div.custom-mode-ix-pipeline-err', undefined, step.error);
				node.wrap.insertBefore(node.errEl, node.details);
			} else if (node.errEl.textContent !== step.error) {
				node.errEl.textContent = step.error;
			}
		} else if (node.errEl) {
			node.errEl.remove();
			node.errEl = undefined;
		}

		const tail = step.outputTail.trim();
		const nextText = tail.length > 0 ? tail : localize('customMode.ixPipeline.noOutput', '(no output yet)');
		if (node.pre.textContent !== nextText) {
			// Preserve scroll position; only update text when changed.
			const prevScroll = node.pre.scrollTop;
			node.pre.textContent = nextText;
			try { node.pre.scrollTop = prevScroll; } catch { /* ignore */ }
		}
	}

	private pruneStalePipelineStepNodes(activeIds: ReadonlySet<string>): void {
		for (const [id, node] of this.ixPipelineStepNodes) {
			if (!activeIds.has(id)) {
				node.wrap.remove();
				this.ixPipelineStepNodes.delete(id);
			}
		}
	}

	private updateIxPipelineDurationsOnly(state: IxIntegrationState): void {
		const durations = new Map<string, string>();
		for (const s of state.pipelineSteps) {
			durations.set(s.id, this.formatStepDuration(s));
		}
		for (const el of Array.from(this.processIxPipeline.querySelectorAll('.custom-mode-ix-pipeline-dur'))) {
			const span = el as HTMLElement;
			const id = span.dataset['stepId'];
			if (!id) {
				continue;
			}
			const d = durations.get(id);
			if (typeof d === 'string') {
				span.textContent = d;
			}
		}
	}

	private renderIxPipeline(state: IxIntegrationState): void {
		if (isWeb) {
			this.processIxPipeline.style.display = 'none';
			return;
		}
		// Hide pipeline cards that are noisy in the Process UI.
		const visibleSteps = state.pipelineSteps.filter(s => s.id !== 'resolve' && !s.id.startsWith('watch:'));
		if (visibleSteps.length === 0) {
			this.processIxPipeline.style.display = 'none';
			return;
		}
		this.processIxPipeline.style.display = '';
		this.clearPipelineContainer(this.processIxPipelineGlobalRow);
		this.clearPipelineContainer(this.processIxPipelineWorkspaceRows);

		const globals = visibleSteps.filter(s => s.kind === 'global');
		const workspaces = visibleSteps.filter(s => s.kind === 'workspace');

		// Workspace steps header row + hide toggle (collapses the cards while keeping the header visible).
		const controls = $('div.custom-mode-ix-pipeline-controls', undefined,
			this.workspaceStepsHideButton,
		);

		// Put everything into one combined row so the user sees a single "pipeline" line.
		// (Globals + workspace steps rendered as siblings.)
		this.processIxPipelineWorkspaceRows.appendChild(
			$('div.custom-mode-ix-pipeline-workspace-head', undefined,
				$('div.custom-mode-ix-pipeline-workspace-label', undefined, localize('customMode.ixPipeline.workspaceSteps', 'Workspace steps')),
				controls,
			));
		const combinedRow = $('div.custom-mode-ix-pipeline-combined-row');
		// Reuse existing per-step DOM nodes; appendChild on an already-parented node moves it without
		// rebuilding, which keeps native <details> open state and click handlers alive during streaming.
		const activeIds = new Set<string>();
		for (const s of [...globals, ...workspaces]) {
			activeIds.add(s.id);
			this.appendPipelineStep(combinedRow, s);
		}
		this.pruneStalePipelineStepNodes(activeIds);
		this.processIxPipelineWorkspaceRows.appendChild(combinedRow);
		// Re-apply current collapsed state after the DOM is rebuilt.
		this.applyWorkspaceStepsHiddenState();

		this.refreshIxPipelineTicker(state);
	}

	private setWorkspaceStepsHidden(hidden: boolean): void {
		if (this.workspaceStepsHidden === hidden) {
			return;
		}
		this.workspaceStepsHidden = hidden;
		this.applyWorkspaceStepsHiddenState();
	}

	private applyWorkspaceStepsHiddenState(): void {
		this.processIxPipelineWorkspaceRows.classList.toggle('workspace-steps-hidden', this.workspaceStepsHidden);
		this.workspaceStepsHideButton.textContent = this.workspaceStepsHidden
			? localize('customMode.workspaceStepsShowBtn', 'Show')
			: localize('customMode.workspaceStepsHideBtn', 'Hide');
	}

	private refreshIxPipelineTicker(state: IxIntegrationState): void {
		if (isWeb) {
			return;
		}
		const needs = this.pipelineNeedsLiveDuration(state);
		const processVisible = this.modeService.getMode() === 'Process';
		if (needs && processVisible) {
			if (!this.ixPipelineDurationTicker.value) {
				const id = mainWindow.setInterval(() => {
					if (this.modeService.getMode() !== 'Process' || !this.lastIxPipelineState) {
						return;
					}
					if (!this.pipelineNeedsLiveDuration(this.lastIxPipelineState)) {
						this.ixPipelineDurationTicker.clear();
						return;
					}
					this.updateIxPipelineDurationsOnly(this.lastIxPipelineState);
				}, 450);
				this.ixPipelineDurationTicker.value = toDisposable(() => mainWindow.clearInterval(id));
			}
		} else if (!needs) {
			this.ixPipelineDurationTicker.clear();
		}
	}

	private updateIxDebug(state: IxIntegrationState): void {
		this.lastIxPipelineState = state;
		this.renderIxPipeline(state);
	}

	private onProcessNotesGraphMessage(message: ProcessNotesGraphWebviewMessage): void {
		void this.handleProcessNotesGraphMessage(message);
	}

	private async handleProcessNotesGraphMessage(message: ProcessNotesGraphWebviewMessage): Promise<void> {
		if (message.type !== 'processNotes.nodeClick') {
			return;
		}

		if (this.processNotesGraphLayer === 'overview' && this.processNotesMergedTopicIds.some(id => id === message.nodeId)) {
			await this.drillIntoProcessTopic(message.nodeId as ProcessNoteId);
			return;
		}

		if (this.processNotesGraphLayer !== 'detail') {
			return;
		}

		const topic = this.processNotesTopicSelect.value;
		const notesFile = await this.processNotesStore.load();
		const note = notesFile?.notes.find(n => n.id === topic);
		const node = note?.graph.nodes.find(n => n.id === message.nodeId);
		if (!node?.file) {
			return;
		}

		const resource = URI.revive(node.file as UriComponents);
		const selection = node.startLine !== undefined
			? {
				startLineNumber: node.startLine,
				startColumn: 1,
				endLineNumber: node.endLine ?? node.startLine,
				endColumn: 1,
			} satisfies IRange
			: undefined;
		await this.editorService.openEditor({ resource, options: selection ? { selection } : undefined });
	}

	private localizeProcessTopicTitle(id: ProcessNoteId): string {
		return id;
	}

	private rebuildProcessNotesTopicSelectOptions(file: ProcessNotesFile | undefined, preferredTopicId?: string): void {
		const merged = mergeProcessNoteTopicIds(file);
		this.processNotesMergedTopicIds = merged;
		while (this.processNotesTopicSelect.options.length > 0) {
			this.processNotesTopicSelect.remove(0);
		}
		for (const id of merged) {
			const label = resolveProcessTopicLabel(id, file, i => this.localizeProcessTopicTitle(i));
			this.processNotesTopicSelect.appendChild(new Option(label, id));
		}
		const pick =
			preferredTopicId && merged.includes(preferredTopicId as ProcessNoteId)
				? preferredTopicId
				: merged[0] ?? '';
		if (pick) {
			this.processNotesTopicSelect.value = pick;
		}
	}

	// Saved-notes cards have been removed; keep topic selection internal only.

	private updateProcessNotesGraphLayerUi(): void {
		this.processNotesBackButton.classList.toggle('hidden', this.processNotesGraphLayer !== 'detail');
		const detail = this.processNotesGraphLayer === 'detail';
		this.processNotesCards.classList.toggle('hidden', detail);
		this.processNotesGraphAnchor.classList.toggle('hidden', !detail);
		this.processNotesDetail.classList.toggle('hidden', !detail);
		this.processNotesMarkdown.classList.toggle('hidden', !detail);
		this.processNotesExpandedActions.classList.toggle('hidden', !detail);
		this.processNotesDeleteButton.disabled = this.processNotesGraphLayer !== 'detail';
		if (detail) {
			this.renderProcessNotesSubsystemDetail();
		}
		this.updateProcessNotesLogText();
	}

	private updateProcessNotesLogText(): void {
		const lines = this.processNotesGraphLayer === 'overview'
			? this.processNotesSuggestionsLoadLog
			: this.processNotesGenerateLog;
		this.processNotesLogs.textContent = lines.join('\n');
	}

	private showProcessNotesOverview(): void {
		this.processNotesGraphLayer = 'overview';
		this.renderProcessNotesCards();
		this.processNotesGraphView.setGraph({ nodes: [], edges: [] });
		this.updateProcessNotesGraphLayerUi();
	}

	private renderProcessNotesCards(): void {
		this.processNotesCards.replaceChildren();
		this.processNotesCards.appendChild($('div.custom-mode-process-notes-section-title', undefined, localize('customMode.processNotes.systemTitle', 'System processes')));
		if (this.processNotesSuggestions.length) {
			for (const s of this.processNotesSuggestions.slice(0, 12)) {
				const kindChip = $('span.custom-mode-process-notes-card-chip', undefined, s.kind);
				const titleRow = $('div.custom-mode-process-notes-card-title-row', undefined,
					$('div.custom-mode-process-notes-card-title', undefined, s.label),
					kindChip,
				);
				const pathLine = s.entryPath
					? s.entryPath
					: localize('customMode.processNotes.card.noEntry', '—');
				const couplingLine = s.couplingSummary ?? localize(
					'customMode.processNotes.card.couplingFallback',
					'{0} files',
					String(s.files ?? 0),
				);
				const edgeParts: string[] = [];
				if (s.topDependencyPath) {
					edgeParts.push(localize('customMode.processNotes.card.dependsOn', '→ {0}', s.topDependencyPath));
				}
				if (s.inboundSummary) {
					edgeParts.push(localize('customMode.processNotes.card.inbound', '← {0}', s.inboundSummary));
				}
				const chips: HTMLElement[] = [];
				if (s.healthScore !== undefined) {
					const pct = Math.round(s.healthScore * 100);
					chips.push($('span.custom-mode-process-notes-card-chip', undefined,
						localize('customMode.processNotes.card.health', 'health {0}%', String(pct))));
				}
				if (s.confidence !== undefined && s.confidence < LOW_CONFIDENCE_THRESHOLD) {
					chips.push($('span.custom-mode-process-notes-card-chip', undefined,
						localize('customMode.processNotes.card.lowConfidence', 'low confidence')));
				}
				for (const sig of s.signals?.slice(0, 2) ?? []) {
					chips.push($('span.custom-mode-process-notes-card-chip', undefined, sig));
				}
				const cardChildren: HTMLElement[] = [
					titleRow,
					$('div.custom-mode-process-notes-card-path', undefined, pathLine),
					$('div.custom-mode-process-notes-card-coupling', undefined, couplingLine),
				];
				if (edgeParts.length) {
					cardChildren.push($('div.custom-mode-process-notes-card-edge', undefined, edgeParts.join(' · ')));
				}
				cardChildren.push($('div.custom-mode-process-notes-card-summary', undefined, s.promptTemplates[0] ?? ''));
				if (chips.length) {
					cardChildren.push($('div.custom-mode-process-notes-card-chips', undefined, ...chips));
				}
				const card = $('button.custom-mode-process-notes-card', { type: 'button' }, ...cardChildren) as HTMLButtonElement;
				const titleParts = [
					s.label,
					s.kind,
					pathLine,
					couplingLine,
					...edgeParts,
					s.promptTemplates[0] ?? '',
				].filter(Boolean);
				card.title = titleParts.join('\n');
				this._register(addDisposableListener(card, 'click', () => {
					// Select this process so Generate saves into it.
					this.processNotesTopicSelect.value = this.processNoteIdForSuggestionId(s.id);
					void this.drillIntoProcessTopic(this.processNotesTopicSelect.value);
				}));
				this.processNotesCards.appendChild(card);
			}
		} else {
			this.processNotesCards.appendChild($('div.custom-mode-placeholder', undefined, localize(
				'customMode.processNotes.noSuggestions',
				'No system processes yet. Ix discovery runs on load; see the logs below for details.'
			)));
		}
	}

	private formatProcessNoteMarkdownWithProvenance(
		synth: ProcessNotesSynthesisResult,
		raw: readonly { readonly label: string }[],
		commandPhases?: readonly { readonly phase: string; readonly labels: readonly string[] }[],
		selection?: {
			readonly reason: string;
			readonly systemPrompt: string;
			readonly userPrompt: string;
			readonly modelId?: string;
		},
	): string {
		return formatSavedProcessNoteMarkdown({
			bodyMarkdown: synth.markdown,
			ixCommandLabels: ixCommandLabelsFromEvidenceRaw(raw),
			ixCommandPhases: commandPhases,
			selectionReason: selection?.reason,
			selectionPrompt: selection ? `${selection.systemPrompt}\n\n${selection.userPrompt}` : undefined,
			selectionModelId: selection?.modelId,
			systemPrompt: synth.systemPrompt,
			userPrompt: synth.userPrompt,
			modelId: synth.modelId,
		});
	}

	private async drillIntoProcessTopic(topicId: ProcessNoteId): Promise<void> {
		this.processNotesGraphLayer = 'detail';
		this.processNotesTopicSelect.value = topicId;
		await this.loadSelectedProcessNote();
		this.updateProcessNotesGraphLayerUi();
	}

	private async loadSelectedProcessNote(preferredTopicId?: string): Promise<void> {
		if (preferredTopicId) {
			this.processNotesTopicSelect.value = preferredTopicId;
		}
		const topic = this.processNotesTopicSelect.value;
		const file = await this.processNotesStore.load();
		const note = topic ? file?.notes.find(n => n.id === topic) : undefined;
		this.processNotesMarkdown.textContent = note?.markdown ?? localize('customMode.processNotes.empty', 'No note generated for this system yet. Select a system process card and use Generate.');
		this.processNotesGenerateLog = (note?.meta?.generationLog ?? '').split(/\r?\n/).filter(line => line.length > 0);
		this.updateProcessNotesLogText();
		this.processNotesDeleteButton.disabled = !note;
		if (this.processNotesGraphLayer === 'detail') {
			this.renderProcessNotesSubsystemDetail();
			const suggestion = this.selectedProcessNoteSuggestion();
			const discoveryGraph = suggestion && (suggestion.memberFiles?.length || suggestion.importsOut?.length || suggestion.callsOut?.length)
				? buildSubsystemDetailGraph(
					suggestion.memberFiles ?? [],
					suggestion.importsOut ?? [],
					suggestion.callsOut ?? [],
					suggestion.importsIn ?? [],
					suggestion.callsIn ?? [],
				)
				: undefined;
			this.processNotesGraphView.setGraph(note?.graph?.nodes.length ? note.graph : (discoveryGraph ?? { nodes: [], edges: [] }));
		}
	}

	private selectedProcessNoteSuggestion(): ProcessNoteSuggestion | undefined {
		const suggestionId = this.suggestionIdFromProcessNoteId(this.processNotesTopicSelect.value);
		return suggestionId ? this.processNotesSuggestions.find(s => s.id === suggestionId) : undefined;
	}

	private renderProcessNotesSubsystemDetail(): void {
		this.processNotesDetail.replaceChildren();
		const suggestion = this.selectedProcessNoteSuggestion();
		if (!suggestion) {
			this.processNotesDetail.appendChild($('div.custom-mode-process-notes-detail-empty', undefined,
				localize('customMode.processNotes.detail.noSelection', 'No subsystem selected.')));
			return;
		}

		this.processNotesDetail.appendChild($('div.custom-mode-process-notes-detail-title', undefined, suggestion.label));

		const appendSection = (title: string, items: readonly string[]) => {
			const section = $('div.custom-mode-process-notes-detail-section');
			section.appendChild($('div.custom-mode-process-notes-detail-section-title', undefined, title));
			if (!items.length) {
				section.appendChild($('div.custom-mode-process-notes-detail-empty', undefined,
					localize('customMode.processNotes.detail.none', 'None')));
			} else {
				const list = $('ul.custom-mode-process-notes-detail-list');
				for (const item of items) {
					list.appendChild($('li', undefined, item));
				}
				section.appendChild(list);
			}
			this.processNotesDetail.appendChild(section);
		};

		const memberCount = suggestion.memberFiles?.length ?? suggestion.files ?? 0;
		appendSection(
			localize('customMode.processNotes.detail.memberFiles', 'Member files ({0})', String(memberCount)),
			suggestion.memberFiles ?? [],
		);
		appendSection(
			localize('customMode.processNotes.detail.importsOut', 'Imports out ({0})', String(suggestion.importsOut?.length ?? suggestion.importsOutTotal ?? 0)),
			(suggestion.importsOut ?? []).map(formatSubsystemPathEdge),
		);
		appendSection(
			localize('customMode.processNotes.detail.callsOut', 'Calls out ({0})', String(suggestion.callsOut?.length ?? suggestion.callsOutTotal ?? 0)),
			(suggestion.callsOut ?? []).map(formatSubsystemPathEdge),
		);
		appendSection(
			localize('customMode.processNotes.detail.importsIn', 'Imports in ({0})', String(suggestion.importsIn?.length ?? suggestion.importsInTotal ?? 0)),
			(suggestion.importsIn ?? []).map(formatSubsystemPathEdge),
		);
		appendSection(
			localize('customMode.processNotes.detail.callsIn', 'Calls in ({0})', String(suggestion.callsIn?.length ?? suggestion.callsInTotal ?? 0)),
			(suggestion.callsIn ?? []).map(formatSubsystemPathEdge),
		);

		if (!suggestion.memberFiles?.length && !suggestion.importsOut?.length && !suggestion.callsOut?.length) {
			this.processNotesDetail.appendChild($('div.custom-mode-process-notes-detail-empty', undefined,
				localize('customMode.processNotes.detail.noDetailedData', 'Detailed Ix data is not available for this process. Re-run discovery or use Generate to build a note.')));
		}
	}

	private async generateProcessNoteFromPrompt(): Promise<void> {
		const selectedNoteId = this.processNotesTopicSelect.value;
		const selectedSuggestionId = selectedNoteId ? this.suggestionIdFromProcessNoteId(selectedNoteId) : undefined;
		const selectedSuggestion = selectedSuggestionId
			? this.processNotesSuggestions.find(s => s.id === selectedSuggestionId)
			: undefined;
		if (!selectedSuggestion) {
			this.notificationService.notify({ severity: Severity.Info, message: localize('customMode.processNotes.custom.needSelection', 'Select a system/module card to generate a note.') });
			return;
		}

		// Generate from the selected subsystem/module card (grid selection; no separate prompt field).
		const prompt = selectedSuggestion.promptTemplates[0] ?? `Explain the "${selectedSuggestion.label}" ${selectedSuggestion.kind} end-to-end.`;
		const folder = resolveIxEvidenceWorkspaceFolderUri(this.workspaceContextService, this.configurationService);
		if (!folder) {
			this.notificationService.notify({ severity: Severity.Warning, message: localize('customMode.processNotes.noWorkspace', 'Open a workspace folder to generate process notes.') });
			return;
		}

		// Save generated output into the currently selected system process (if present).
		const noteId = selectedNoteId || stableCustomNoteId(prompt);
		const title = selectedSuggestion.label;

		this.processNotesGenerateButton.disabled = true;
		try {
			this.processNotesGraphLayer = 'detail';
			this.processNotesGenerateLog = [];
			this.updateProcessNotesGraphLayerUi();
			this.processNotesMarkdown.textContent = localize('customMode.processNotes.generating', 'Generating process note…');

			const logLine = (line: string) => {
				this.processNotesGenerateLog.push(line);
				this.updateProcessNotesLogText();
				this.processNotesLogs.scrollTop = this.processNotesLogs.scrollHeight;
			};
			const onProgress = (e: ProcessNotesGenerationProgressEvent) => {
				const tag = e.status === 'start' ? '…' : e.status === 'success' ? '✓' : e.status === 'error' ? 'x' : '•';
				const detail = e.detail ? ` — ${e.detail}` : '';
				logLine(`[${e.phase}] ${tag} ${e.label}${detail}`);
			};

			const forcedSelector = async (
				_userQuestion: string,
				candidates: readonly { id: string; label: string; labelKind?: string; level?: number; score: number; keywords: readonly string[] }[],
				_fallbackKeywords: readonly string[],
				fallbackReason: string,
			) => {
				const labelLower = selectedSuggestion.label.toLowerCase();
				const wantKind = selectedSuggestion.kind.toLowerCase();
				const chosen = candidates.find(c => c.label.toLowerCase() === labelLower && (c.labelKind?.toLowerCase() ?? wantKind) === wantKind)
					?? candidates.find(c => c.label.toLowerCase() === labelLower)
					?? candidates[0];
				return {
					candidateIds: chosen ? [chosen.id] : [],
					keywords: [],
					reason: localize('customMode.processNotes.forcedSelection', 'Forced selection from card: {0}', selectedSuggestion.label),
					systemPrompt: localize('customMode.processNotes.forcedSelection.systemPrompt', 'Select the already-chosen subsystem/module from the UI card.'),
					userPrompt: JSON.stringify({ selected: selectedSuggestion.label }),
					modelId: undefined,
					selectedBy: 'deterministic' as const,
				};
			};

			const evidence = await buildCustomPromptEvidencePack(
				this.ixIntegrationService,
				folder,
				prompt,
				forcedSelector,
				onProgress
			);
			onProgress({ phase: 'synthesis', label: 'AI synthesis', status: 'start' });
			const synth = await synthesizeCustomPromptNote(this.languageModelsService, evidence, this.chatSessionsCts.token);
			onProgress({ phase: 'synthesis', label: 'AI synthesis', status: 'success' });
			const now = Date.now();
			const generationLog = this.processNotesGenerateLog.join('\n');
			await this.processNotesStore.upsertNote({
				id: noteId,
				title,
				markdown: this.formatProcessNoteMarkdownWithProvenance(synth, evidence.raw, evidence.commandPhases, evidence.selection),
				graph: synth.graph,
				meta: {
					generatedAt: now,
					workspaceUri: folder.toString(),
					userPrompt: prompt,
					recipeId: RECIPE_CUSTOM_PROMPT,
					binding: evidence.binding,
					generationLog,
				},
			});
			await this.loadSelectedProcessNote(noteId);
			this.updateProcessNotesGraphLayerUi();
		} finally {
			this.processNotesGenerateButton.disabled = false;
		}
	}

	private async deleteSelectedProcessNote(): Promise<void> {
		const topic = this.processNotesTopicSelect.value;
		if (!topic) {
			return;
		}
		const existing = await this.processNotesStore.load();
		const note = existing?.notes.find(n => n.id === topic);
		if (!note) {
			return;
		}
		this.processNotesDeleteButton.disabled = true;
		try {
			await this.processNotesStore.deleteNote(topic);
			this.processNotesGraphLayer = 'overview';
			await this.loadSelectedProcessNote();
			this.showProcessNotesOverview();
		} finally {
			this.processNotesDeleteButton.disabled = this.processNotesGraphLayer !== 'detail';
		}
	}

	private ensureCodeModeForDevServerTerminal(): void {
		if (this.modeService.getMode() === 'Code') {
			return;
		}
		this.modeService.setMode('Code');
	}

	private updateDevServerDebug(state: DevServerState): void {
		if (state.phase === 'installing' || state.phase === 'starting') {
			this.ensureCodeModeForDevServerTerminal();
		}

		const lines: string[] = [];
		lines.push(`phase: ${state.phase}`);
		if (state.script) {
			lines.push(`script: ${state.script}`);
		}
		if (state.command) {
			lines.push(`command: ${state.command}`);
		}
		if (state.activeUrl) {
			lines.push(`url: ${state.activeUrl}`);
		}
		if (state.lastError) {
			lines.push(`error: ${state.lastError}`);
		}
		if (state.lastOutput) {
			lines.push('');
			lines.push(state.lastOutput);
		}

		this.uiStartStatus.textContent = lines.join('\n');
		this.updateStartAppControl();
		this.syncUiStartPanelVisibility();
		this.updateReachabilityFromState(state);
	}

	private setUiSelectionCount(count: number): void {
		const normalized = Math.max(0, Math.floor(count));
		this.uiSelectionCount = normalized;
		this.uiSelectionCountEl.textContent = String(normalized);
		this.uiSelectionPill.classList.toggle('has-selection', normalized > 0);
		this.uiSelectionClearBtn.disabled = normalized === 0;
		const label = normalized === 0
			? localize('customMode.dragToSelect', 'Drag to Select')
			: localize('customMode.clearSelectionShort', 'Clear');
		this.uiSelectionClearBtn.textContent = label;
		this.uiSelectionClearBtn.setAttribute('aria-label', label);
		this.uiSelectionClearBtn.title = label;
	}

	private clearUiSelection(): void {
		if (this.uiSelectionCount === 0) {
			return;
		}
		this.setUiSelectionCount(0);
		this.removeUiMappedInjectedChatAttachments();
		this.sendClearSelectionToOverlay();
		this.pushUiRuntimeLog('[ui-selection] cleared via top-bar button');
	}

	private sendClearSelectionToOverlay(): void {
		const clearJs = `(function(){ try { document.querySelectorAll('.__vscode_mapped_selected').forEach(function(n){ n.classList.remove('__vscode_mapped_selected'); }); } catch (e) { /* ignore */ } })()`;
		if (isWeb) {
			try {
				const iframe = this.uiBrowser as unknown as HTMLIFrameElement;
				iframe.contentWindow?.postMessage({ type: 'vscode-clear-selection' }, '*');
			} catch {
				// ignore (cross-origin etc.)
			}
			return;
		}
		try {
			const webview = this.uiBrowser as unknown as { executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown> };
			void webview.executeJavaScript?.(clearJs);
		} catch {
			// ignore
		}
	}

	private workspaceKeyForSuggestions(): string | undefined {
		const folder = resolveIxEvidenceWorkspaceFolderUri(this.workspaceContextService, this.configurationService);
		return folder ? folder.toString() : undefined;
	}

	private async loadProcessNotesSuggestions(): Promise<void> {
		const workspaceKey = this.workspaceKeyForSuggestions();
		if (!workspaceKey || isWeb) {
			this.processNotesSuggestions = [];
			this.processNotesSuggestionsLoadLog = [];
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}

		const log = (line: string) => {
			this.processNotesSuggestionsLoadLog.push(line);
			// Keep the UI responsive while discovery is running.
			this.updateProcessNotesLogText();
			this.renderProcessNotesCards();
		};

		this.processNotesSuggestionsLoadLog = [];
		log(`[discovery] • Starting discovery`);

		// Always recompute suggestions on each app load when Ix runs again.
		// Suggested processes are intentionally NOT persisted across reloads.
		this.processNotesSuggestions = [];
		this.renderProcessNotesCards();

		// Compute from Ix discovery
		const discoveryFolder = resolveIxEvidenceWorkspaceFolderUri(this.workspaceContextService, this.configurationService);
		if (!discoveryFolder) {
			this.processNotesSuggestions = [];
			log(`[discovery] x No workspace folder for Ix evidence.`);
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}

		log(`[discovery] … ensure ix backend`);
		const backendReady = await this.ixIntegrationService.prepareForDiscovery(discoveryFolder);
		if (!backendReady) {
			const hint = formatIxDiscoveryFailureHint('fetch failed', 'fetch failed');
			log(`[discovery] x ix docker start failed or backend still unreachable${hint ? `\n${hint}` : ''}`);
			log(`[discovery] x No discovery JSON available.`);
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}
		log(`[discovery] ✓ ix backend ready`);

		log(`[discovery] … ensure ix mapped`);
		const hydrate = await this.ixIntegrationService.ensureIxMappedIfEmpty(discoveryFolder);
		if (!hydrate.statsOk) {
			const hint = formatIxDiscoveryFailureHint(hydrate.statsPreview, hydrate.statsPreview);
			log(`[discovery] x ix stats failed${hint ? `\n${hint}` : ''}`);
			if (hydrate.statsPreview) {
				log(hydrate.statsPreview.split(/\r?\n/).slice(-6).join('\n'));
			}
		} else {
			log(hydrate.ranMap ? `[discovery] ✓ ix map --all-items . (graph was empty)` : `[discovery] ✓ ensure ix mapped`);
		}

		const detailedCmd = formatIxSubsystemsDetailedDiscoveryCommand(
			['subsystems', '--list', '--detailed', '--sort', 'importance', '--format', 'json'],
		);
		log(`[discovery] … ${detailedCmd}`);
		const detailed = await runSubsystemsDetailedDiscovery(this.ixIntegrationService, discoveryFolder, 180_000);
		if (detailed.ok) {
			log(`[discovery] ✓ ${formatIxSubsystemsDetailedDiscoveryCommand(detailed.args)}`);
		} else {
			const hint = formatIxDiscoveryFailureHint(detailed.error, detailed.raw);
			log(`[discovery] x ${formatIxSubsystemsDetailedDiscoveryCommand(detailed.args)}\n${detailed.error}${hint ? `\n${hint}` : ''}`);
		}

		let suggestions: ProcessNoteSuggestion[] = [];
		if (detailed.ok) {
			const fingerprints = parseSubsystemFingerprints(detailed.value);
			if (fingerprints.length) {
				suggestions = this.processNoteSuggestionsFromFingerprints(fingerprints);
				log(`[selection] ✓ fingerprints=${fingerprints.length}`);
			} else {
				log(`[selection] x fingerprints=0 from detailed json\n${describeIxDiscoveryShape(detailed.value)}`);
			}
		}

		if (!suggestions.length) {
			log(`[discovery] … fallback ix subsystems --sort importance --all-items --format json`);
			const subsystems = await this.ixIntegrationService.runJsonQuery(
				['subsystems', '--sort', 'importance', '--all-items', '--format', 'json'],
				discoveryFolder,
				180_000,
			);
			if (subsystems.ok) {
				log(`[discovery] ✓ ix subsystems --sort importance --all-items --format json`);
			} else {
				const hint = formatIxDiscoveryFailureHint(subsystems.error, subsystems.raw);
				log(`[discovery] x ix subsystems --sort importance --all-items --format json\n${subsystems.error}${hint ? `\n${hint}` : ''}`);
			}
			if (subsystems.ok) {
				suggestions = this.processNoteSuggestionsFromHierarchyCards(
					this.extractDiscoveryCardsFromIxSubsystems(subsystems.value),
				);
				log(`[selection] ${suggestions.length ? '✓' : 'x'} hierarchy cards=${suggestions.length}`);
				if (!suggestions.length) {
					log(describeIxDiscoveryShape(subsystems.value));
				}
			}
		}

		if (!suggestions.length) {
			log(`[discovery] x No discovery JSON available.`);
			return;
		}

		// Populate the hidden "topic" select with note ids so Generate/Delete operate on the selected card.
		while (this.processNotesTopicSelect.options.length > 0) {
			this.processNotesTopicSelect.remove(0);
		}
		for (const s of suggestions) {
			this.processNotesTopicSelect.appendChild(new Option(s.label, this.processNoteIdForSuggestionId(s.id)));
		}
		if (this.processNotesTopicSelect.options.length > 0) {
			this.processNotesTopicSelect.value = this.processNotesTopicSelect.options[0].value;
		}

		this.processNotesSuggestions = suggestions;
		log(`[done] ✓ suggestions=${this.processNotesSuggestions.length}`);
	}

	private processNoteSuggestionsFromFingerprints(fingerprints: readonly SubsystemFingerprint[]): ProcessNoteSuggestion[] {
		return fingerprints.map((f) => {
			const id = this.stableHash(`${f.labelKind}|${f.name}`);
			return {
				id,
				label: f.name,
				subsystemKey: f.regionId,
				kind: f.labelKind,
				confidence: f.confidence,
				files: f.fileCount,
				regionId: f.regionId,
				entryPath: f.entryPath,
				topDependencyPath: f.topDependencyPath,
				couplingSummary: f.couplingSummary,
				inboundSummary: f.inboundSummary,
				healthScore: f.healthScore,
				importsOutTotal: f.importsOutTotal,
				callsOutTotal: f.callsOutTotal,
				importsInTotal: f.importsInTotal,
				callsInTotal: f.callsInTotal,
				memberFiles: f.memberFiles,
				importsOut: f.importsOut,
				callsOut: f.callsOut,
				importsIn: f.importsIn,
				callsIn: f.callsIn,
				promptTemplates: [
					f.prompt,
					`What is the ${f.name} pipeline?`,
					`How does ${f.name} run end-to-end (UI → API → core logic)?`,
				],
			} satisfies ProcessNoteSuggestion;
		});
	}

	private processNoteSuggestionsFromHierarchyCards(
		cards: Array<{ label: string; kind: ProcessNoteSuggestion['kind']; prompt: string }>,
	): ProcessNoteSuggestion[] {
		return cards.map((c) => {
			const id = this.stableHash(`${c.kind}|${c.label}`);
			return {
				id,
				label: c.label,
				subsystemKey: this.stableHash(`${c.kind}|${c.label}`),
				kind: c.kind,
				promptTemplates: [
					c.prompt,
					`What is the ${c.label} pipeline?`,
					`How does ${c.label} run end-to-end (UI → API → core logic)?`,
				],
			} satisfies ProcessNoteSuggestion;
		});
	}

	private stableHash(text: string): string {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return (h >>> 0).toString(16);
	}

	// Legacy: system-only extraction replaced by ordered hierarchy discovery cards.

	private extractDiscoveryCardsFromIxSubsystems(json: unknown): Array<{ label: string; kind: ProcessNoteSuggestion['kind']; prompt: string }> {
		type Node = { label?: unknown; name?: unknown; title?: unknown; kind?: unknown; label_kind?: unknown; type?: unknown; children?: unknown };
		const out: Array<{ label: string; kind: ProcessNoteSuggestion['kind']; prompt: string }> = [];
		const seen = new Set<string>();

		const toLabel = (v: Node): string | undefined => {
			const raw = (typeof v.label === 'string' ? v.label : typeof v.name === 'string' ? v.name : typeof v.title === 'string' ? v.title : undefined);
			const t = raw?.trim();
			return t?.length ? t : undefined;
		};
		const toKind = (v: Node): ProcessNoteSuggestion['kind'] => {
			const k = (typeof v.label_kind === 'string' ? v.label_kind : typeof v.kind === 'string' ? v.kind : typeof v.type === 'string' ? v.type : '')?.toLowerCase();
			if (k === 'system') { return 'system'; }
			if (k === 'subsystem') { return 'subsystem'; }
			return 'module';
		};

		const push = (label: string, kind: ProcessNoteSuggestion['kind'], parent?: string) => {
			const key = `${kind}:${parent ?? ''}:${label}`.toLowerCase().replace(/\s+/g, ' ').trim();
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			// Keep the label quoted so deterministic scoring can still match it reliably.
			const prompt = parent
				? `Explain the "${label}" ${kind} in the context of the "${parent}" system, end-to-end.`
				: `Explain the "${label}" ${kind} end-to-end.`;
			out.push({ label, kind, prompt });
		};

		const visitHierarchy = (v: unknown, parentSystem?: string) => {
			if (!v || typeof v !== 'object') { return; }
			const n = v as Node;
			const label = toLabel(n);
			const kind = toKind(n);
			if (label) {
				if (kind === 'system') {
					push(label, kind);
					parentSystem = label;
				} else {
					push(label, kind, parentSystem);
				}
			}
			if (Array.isArray(n.children)) {
				for (const c of n.children) {
					visitHierarchy(c, parentSystem);
				}
			}
		};

		// Prefer the structured hierarchy when present: it matches CLI ordering (systems then their modules).
		if (json && typeof json === 'object' && 'hierarchy' in (json as any)) {
			visitHierarchy((json as any).hierarchy, undefined);
		}

		// Fallback: walk the whole object if hierarchy is missing.
		if (!out.length) {
			const visitAny = (v: unknown, parentSystem?: string) => {
				if (Array.isArray(v)) { for (const i of v) { visitAny(i, parentSystem); } return; }
				if (!v || typeof v !== 'object') { return; }
				const n = v as Node;
				const label = toLabel(n);
				const kind = toKind(n);
				if (label) {
					if (kind === 'system') {
						push(label, kind);
						parentSystem = label;
					} else {
						push(label, kind, parentSystem);
					}
				}
				for (const k of ['children', 'items', 'modules', 'subsystems', 'systems', 'regions', 'branches']) {
					if (k in (n as any)) {
						visitAny((n as any)[k], parentSystem);
					}
				}
			};
			visitAny(json, undefined);
		}

		return out;
	}

	private processNoteIdForSuggestionId(id: string): string {
		return `ix:${id}`;
	}

	private suggestionIdFromProcessNoteId(id: string): string | undefined {
		return id.startsWith('ix:') ? id.slice('ix:'.length) : undefined;
	}

	private updateReachabilityFromState(state: DevServerState): void {
		const url = state.activeUrl;
		if (state.phase === 'running' && url) {
			// Trust local dev server state — fetch/no-cors probes can time out or fail spuriously, which left
			// `custom-mode-app-reachable` false so Start App stayed visible and iframe height caps never applied.
			this.reachabilityUrl = url;
			this.setAppReachable(true);
			const surface = this.getSelectedSurface();
			if (surface?.localUrl) {
				this.setSurfaceEmptyState(undefined);
				if (!this.embeddedUiShowsUrl(surface.localUrl)) {
					this.setEmbeddedUiUrl(surface.localUrl);
				}
			}
			return;
		}
		if (state.phase === 'error') {
			this.autoStartAppAttempted = false;
		}
		if (!url || state.phase === 'idle' || state.phase === 'error') {
			this.reachabilityUrl = undefined;
			this.setAppReachable(false);
			return;
		}
		// installing / starting: optional network hint when URL first appears
		if (this.reachabilityUrl !== url) {
			void this.checkUrlReachable(url);
		}
	}

	private setAppReachable(reachable: boolean): void {
		const wasReachable = this.appReachable;
		this.appReachable = reachable;
		this.container.classList.toggle('custom-mode-app-reachable', reachable);

		// When the dev server transitions from unreachable to reachable, the embedded UI is
		// almost certainly showing an ERR_CONNECTION_REFUSED page from the initial load attempt
		// (we set the iframe src early, before the server is actually serving). Force a reload
		// so the user sees the running app without manually refreshing.
		if (reachable && !wasReachable) {
			this.reloadEmbeddedUi();
		}
	}

	private reloadEmbeddedUi(): void {
		const url = this.getTargetEmbeddedUiUrl();
		if (!url) {
			return;
		}

		const current = this.getEmbeddedUiUrl();
		const isBlank = !current || current === 'about:blank';

		// First navigation after startup: webview is still on about:blank — reload() would only
		// reload the blank page and leave the preview black while app-reachable hides Start App.
		if (isBlank || current !== url) {
			this.setEmbeddedUiUrl(url);
			return;
		}

		if (!isWeb && this.isWebviewElement(this.uiBrowser)) {
			// Electron <webview> exposes `reload()`. This avoids the ERR_ABORTED-from-double-navigation
			// pitfall we'd hit by toggling `src` rapidly when we're already on the target URL.
			const webview = this.uiBrowser as unknown as { reload?: () => void };
			if (typeof webview.reload === 'function') {
				try {
					webview.reload();
					return;
				} catch {
					// Fall through to src-toggle fallback.
				}
			}
		}

		// Cross-platform fallback: force a fresh navigation without an intermediate `about:blank`
		// hop — that hop aborts Electron <webview> loads and has been observed to leave the preview black.
		const reloadUrl = this.withCacheBust(url);
		this.setEmbeddedUiUrl(reloadUrl);
	}

	private async checkUrlReachable(url: string): Promise<void> {
		this.reachabilityUrl = url;
		const selectedSurface = this.getSelectedSurface();
		const isSelectedSurfaceUrl = selectedSurface?.localUrl === url;
		// Delegate to the dev server service so we share one authoritative probe implementation
		// (which can optionally probe nearby ports). For surface tabs, require exact localUrl.
		const reachableUrl = await this.devServerService.findRunningDevServerUrl(url, { allowNearbyPorts: !isSelectedSurfaceUrl });
		const reachable = reachableUrl !== undefined;
		if (this.reachabilityUrl !== url) {
			return;
		}
		if (reachable) {
			this.setAppReachable(true);
			const surface = this.getSelectedSurface();
			if (surface?.localUrl === url) {
				this.setSurfaceEmptyState(undefined);
				if (reachableUrl && !this.embeddedUiShowsUrl(reachableUrl)) {
					this.setEmbeddedUiUrl(reachableUrl);
				}
			}
			return;
		}
		// Don't clear when the dev server already reported running (avoids spurious false
		// negatives from a transiently stalled probe).
		if (this.devServerService.getState().phase !== 'running') {
			this.setAppReachable(false);
			const surface = this.getSelectedSurface();
			if (surface?.localUrl === url) {
				this.setSurfaceServerDownState(surface, url);
			}
		}
	}

	private pushUiRuntimeLog(line: string): void {
		if (this.uiSetup.classList.contains('custom-mode-setup-hidden')) {
			return;
		}
		this.uiRuntimeLogs.push(line);
		if (this.uiRuntimeLogs.length > 50) {
			this.uiRuntimeLogs.splice(0, this.uiRuntimeLogs.length - 50);
		}
		this.uiRuntimeText.textContent = this.uiRuntimeLogs.slice(-20).join('\n');
	}

	private isWebviewElement(el: HTMLElement): boolean {
		return el.tagName.toLowerCase() === 'webview';
	}

	private getEmbeddedUiUrl(): string {
		if (isWeb) {
			return (this.uiBrowser as unknown as { src: string }).src ?? '';
		}
		return (this.uiBrowser as unknown as HTMLElement).getAttribute('src') ?? '';
	}

	private embeddedUiShowsUrl(targetUrl: string): boolean {
		const current = this.getEmbeddedUiUrl();
		if (!current || current === 'about:blank') {
			return false;
		}
		try {
			const currentUrl = new URL(current);
			const target = new URL(targetUrl);
			currentUrl.searchParams.delete('_vscodeUiReload');
			target.searchParams.delete('_vscodeUiReload');
			return currentUrl.toString() === target.toString();
		} catch {
			return current === targetUrl;
		}
	}

	private setEmbeddedUiUrl(url: string): void {
		if (isWeb) {
			(this.uiBrowser as unknown as { src: string }).src = url;
		} else {
			(this.uiBrowser as unknown as HTMLElement).setAttribute('src', url);
		}
	}

	private clearEmbeddedUiUrl(): void {
		const current = this.getEmbeddedUiUrl();
		if (!current || current === 'about:blank') {
			return;
		}
		if (isWeb) {
			(this.uiBrowser as unknown as { src: string }).src = 'about:blank';
		} else {
			(this.uiBrowser as unknown as HTMLElement).setAttribute('src', 'about:blank');
		}
	}

	private withCacheBust(url: string): string {
		try {
			const parsed = new URL(url);
			parsed.searchParams.set('_vscodeUiReload', String(Date.now()));
			return parsed.toString();
		} catch {
			const sep = url.includes('?') ? '&' : '?';
			return `${url}${sep}_vscodeUiReload=${Date.now()}`;
		}
	}

	private createGoalWorkspaceLandingCallout(run: () => void): HTMLElement {
		const buttonLabel = localize('customMode.openGoalWorkspaceExample', 'Open Goal Workspace Example');
		const button = $('button.custom-mode-callout-button', { type: 'button' }, buttonLabel) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => run()));

		const steps = [
			localize('customMode.uiCalloutStepGoal', 'Name the business and describe what you sell'),
			localize('customMode.uiCalloutStepBrand', 'Upload logos and choose primary, secondary, and accent colors'),
			localize('customMode.uiCalloutStepSurfaces', 'Pick a starter surface—or create a new one—to scaffold with AI'),
		];
		const stepsList = $('ol.custom-mode-callout-steps', undefined,
			...steps.map(step => $('li.custom-mode-callout-step', undefined, step))
		);
		const surfaceChips = $('div.custom-mode-callout-surfaces', undefined,
			...STARTER_SURFACES.map(surface => $('span.custom-mode-callout-surface-chip', undefined, surface.name))
		);

		return $('div.custom-mode-callout', undefined,
			$('div.custom-mode-callout-title', undefined, localize('customMode.uiCalloutTitle', 'Build your goal workspace')),
			$('div.custom-mode-callout-subtitle', undefined, localize('customMode.uiCalloutSubtitle', 'A goal workspace ties your business definition, brand, and customer-facing apps together. Changes autosave as you work.')),
			stepsList,
			$('div.custom-mode-callout-surfaces-label', undefined, localize('customMode.uiCalloutSurfacesLabel', 'Starter surfaces')),
			surfaceChips,
			$('div.custom-mode-callout-button-row', undefined, button)
		);
	}

	private createDefaultProjectCallout(title: string, subtitle: string, run: () => void, buttonLabel = localize('customMode.createDefaultProject', 'Create Default Project')): HTMLElement {
		const button = $('button.custom-mode-callout-button', { type: 'button' }, buttonLabel) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => run()));

		return $('div.custom-mode-callout', undefined,
			$('div.custom-mode-callout-title', undefined, title),
			$('div.custom-mode-callout-subtitle', undefined, subtitle),
			$('div.custom-mode-callout-button-row', undefined, button)
		);
	}

	// Next component mapping enablement is implemented as a command/service so it can be invoked
	// without duplicating this workbench contribution instance.
}

registerWorkbenchContribution2(ModeShellContribution.ID, ModeShellContribution, WorkbenchPhase.BlockStartup);

registerAction2(class EnableNextComponentMappingAction extends Action2 {
	constructor() {
		super({
			id: 'custom.enableNextComponentMapping',
			title: { value: localize('customMode.enableNextMapping.action', 'Enable component mapping for Next.js (SWC plugin)'), original: 'Enable component mapping for Next.js (SWC plugin)' },
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const fileService = accessor.get(IFileService);
		const configurationService = accessor.get(IConfigurationService);
		const nativeEnvironmentService = accessor.get(INativeEnvironmentService);

		const folders = workspaceContextService.getWorkspace().folders;
		if (!folders.length) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.enableNextMapping.noWorkspace', 'Open a project folder first.')
			});
			return;
		}

		const root = folders[0].uri;
		const configCandidates = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
		let configResource: URI | undefined;
		for (const name of configCandidates) {
			const candidate = resolvePath(root, name);
			try {
				await fileService.stat(candidate);
				configResource = candidate;
				break;
			} catch {
				// ignore
			}
		}

		if (!configResource) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.enableNextMapping.noConfig', 'Could not find a next.config.js/.mjs/.ts in the workspace root.')
			});
			return;
		}

		const configuredPath = String(configurationService.getValue('custom.nextComponentMapping.swcPluginWasmPath') ?? '').trim();
		const bundledDefault = nativeEnvironmentService.appRoot
			? URI.file(nativeEnvironmentService.appRoot)
			: undefined;
		const bundledWasm = bundledDefault ? resolvePath(bundledDefault, 'resources/custom/swc_plugin_vscode_ui_src.wasm') : undefined;

		let wasmPath = configuredPath;
		if (wasmPath) {
			try {
				await fileService.stat(URI.file(wasmPath));
			} catch {
				notificationService.notify({
					severity: Severity.Warning,
					message: localize('customMode.enableNextMapping.badConfiguredWasm', 'Configured SWC plugin .wasm path does not exist. Falling back to bundled default or prompt.')
				});
				wasmPath = '';
			}
		}

		if (!wasmPath && bundledWasm) {
			try {
				await fileService.stat(bundledWasm);
				wasmPath = bundledWasm.fsPath;
			} catch {
				// ignore
			}
		}

		// One-click: only prompt if we couldn't resolve a valid wasm path.
		if (!wasmPath) {
			wasmPath = (await quickInputService.input({
				title: localize('customMode.enableNextMapping.title', 'Enable component mapping for Next.js'),
				placeHolder: localize('customMode.enableNextMapping.placeholder', 'Absolute path to swc_plugin_vscode_ui_src.wasm'),
				prompt: localize('customMode.enableNextMapping.prompt', 'Provide the SWC plugin .wasm path (build it once, then reuse across repos).'),
				value: ''
			}))?.trim() ?? '';
		}

		if (!wasmPath) {
			return;
		}

		const wasmUri = URI.file(wasmPath);
		try {
			await fileService.stat(wasmUri);
		} catch {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('customMode.enableNextMapping.badWasm', 'The provided .wasm path does not exist: {0}', wasmPath)
			});
			return;
		}

		const raw = await fileService.readFile(configResource);
		const text = raw.value.toString();
		if (text.includes('swcPlugins') && (text.includes('data-vscode-src') || text.includes('swc_plugin_vscode_ui_src'))) {
			notificationService.notify({
				severity: Severity.Info,
				message: localize('customMode.enableNextMapping.already', 'Next.js SWC plugins already appear configured in {0}.', configResource.path)
			});
			return;
		}

		const experimentalBlock = createNextSwcPluginsSnippet(wasmPath);
		const updated = patchNextConfigText(text, experimentalBlock);
		if (!updated) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('customMode.enableNextMapping.patchFailed', 'Could not automatically patch {0}. Please add experimental.swcPlugins manually.', configResource.path)
			});
			return;
		}

		await fileService.writeFile(configResource, VSBuffer.fromString(updated));
		notificationService.notify({
			severity: Severity.Info,
			message: localize('customMode.enableNextMapping.done', 'Updated {0}. Restart your Next dev server, then reload the embedded UI.', configResource.path)
		});
	}
});

function withModeShellChatManager(accessor: ServicesAccessor, fn: (mgr: ModeShellChatSessionManager) => Promise<void> | void): Promise<void> | void {
	const chatService = accessor.get(IChatService);
	const chatWidgetService = accessor.get(IChatWidgetService);
	const storageService = accessor.get(IStorageService);
	const mgr = new ModeShellChatSessionManager(chatService, chatWidgetService, storageService);
	return fn(mgr);
}

registerAction2(class SwitchChatToUiAction extends Action2 {
	constructor() {
		super({
			id: 'custom.modeShell.chat.switchToUI',
			title: { value: localize('customMode.chat.switchToUI', 'Custom: Switch Chat to UI'), original: 'Custom: Switch Chat to UI' },
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IModeService).setMode('UI');
		await withModeShellChatManager(accessor, mgr => mgr.openSessionForMode('UI'));
	}
});

registerAction2(class SwitchChatToProcessAction extends Action2 {
	constructor() {
		super({
			id: 'custom.modeShell.chat.switchToProcess',
			title: { value: localize('customMode.chat.switchToProcess', 'Custom: Switch Chat to Process'), original: 'Custom: Switch Chat to Process' },
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IModeService).setMode('Process');
		await withModeShellChatManager(accessor, mgr => mgr.openSessionForMode('Process'));
	}
});

registerAction2(class SwitchChatToCodeAction extends Action2 {
	constructor() {
		super({
			id: 'custom.modeShell.chat.switchToCode',
			title: { value: localize('customMode.chat.switchToCode', 'Custom: Switch Chat to Code'), original: 'Custom: Switch Chat to Code' },
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IModeService).setMode('Code');
		await withModeShellChatManager(accessor, mgr => mgr.openSessionForMode('Code'));
	}
});

registerAction2(class ResetModeShellChatsAction extends Action2 {
	constructor() {
		super({
			id: 'custom.modeShell.chat.resetModeChats',
			title: { value: localize('customMode.chat.resetModeChats', 'Custom: Reset Mode Chats (UI surfaces/Process/Code)'), original: 'Custom: Reset Mode Chats (UI surfaces/Process/Code)' },
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const modeService = accessor.get(IModeService);
		const notificationService = accessor.get(INotificationService);
		const consoleService = accessor.get(IConsoleService);
		await withModeShellChatManager(accessor, async mgr => {
			const uiSurfaceIds = [
				ADD_SURFACE_ID,
				...consoleService.getSurfaces().map(surface => surface.id),
			];
			mgr.resetSessions(uiSurfaceIds);
			notificationService.notify({
				severity: Severity.Info,
				message: localize('customMode.chat.resetModeChats.done', 'Reset Mode Shell chat sessions (including per-surface UI chats).'),
			});
			const mode = modeService.getMode();
			if (mode === 'Code') {
				await mgr.openSessionForMode('Code');
			} else {
				await ModeShellContribution.getActiveInstance()?.refreshEmbeddedChatForCurrentMode();
			}
		});
	}
});

function createNextSwcPluginsSnippet(wasmPath: string): string {
	// Turbopack currently expects SWC plugin paths to be relative to `process.cwd()`.
	// Use a small runtime computation so the same config works in more environments.
	return `experimental: {\\n\\t\\tswcPlugins: [\\n\\t\\t\\t[\\n\\t\\t\\t\\t'./' + require('node:path').relative(process.cwd(), ${JSON.stringify(wasmPath)}).replace(/\\\\\\\\/g, '/'),\\n\\t\\t\\t\\t{ attributeName: 'data-vscode-src' },\\n\\t\\t\\t],\\n\\t\\t],\\n\\t},`;
}

function patchNextConfigText(text: string, experimentalBlock: string): string | undefined {
	const moduleExports = /module\\.exports\\s*=\\s*\\{([\\s\\S]*?)\\n\\};?/m.exec(text);
	if (moduleExports) {
		const insertPos = moduleExports.index + 'module.exports = {'.length;
		return text.slice(0, insertPos) + '\\n\\t' + experimentalBlock + '\\n' + text.slice(insertPos);
	}

	const exportDefault = /export\\s+default\\s*\\{([\\s\\S]*?)\\n\\};?/m.exec(text);
	if (exportDefault) {
		const insertPos = exportDefault.index + 'export default {'.length;
		return text.slice(0, insertPos) + '\\n\\t' + experimentalBlock + '\\n' + text.slice(insertPos);
	}

	const constConfig = /(const|let|var)\\s+nextConfig\\s*=\\s*\\{([\\s\\S]*?)\\n\\};/m.exec(text);
	if (constConfig) {
		const openBracePos = text.indexOf('{', constConfig.index);
		if (openBracePos > 0) {
			return text.slice(0, openBracePos + 1) + '\\n\\t' + experimentalBlock + '\\n' + text.slice(openBracePos + 1);
		}
	}

	return undefined;
}

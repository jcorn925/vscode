/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode, Dimension } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableMap, DisposableStore, type IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { disposableTimeout, RunOnceScheduler, timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { isMacintosh, isWeb, isWindows } from '../../../../base/common/platform.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { basename, extUri, isEqual, isEqualOrParent, joinPath, resolvePath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IContextKeyService, type IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, type ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { DevServerState, DevServerSuggestedCommands, IDevServerService } from '../../../../../custom/devserver/DevServerService.js';
import { freeSurfacePorts, killProcessListeningOnPort } from '../../../../../custom/devserver/surfaceDevPortFreeing.js';
import { collectUniqueSurfacePorts, parsePortFromLocalUrl } from '../../../../../custom/devserver/surfaceDevPortUtils.js';
import { IDefaultProjectService } from '../../../../../custom/devserver/DefaultProjectService.js';
import { IModeService, Mode } from '../../../../../custom/mode/ModeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { splitRecentLabel } from '../../../../base/common/labels.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IRecentWorkspace, IWorkspacesService, isRecentFolder, isRecentWorkspace } from '../../../../platform/workspaces/common/workspaces.js';
import { ITerminalService, type ITerminalInstance } from '../../terminal/browser/terminal.js';
import { TerminalExitReason } from '../../../../platform/terminal/common/terminal.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IQuickInputService, type IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import {
	buildGhPublishWorkspaceCommand,
	buildGitPushOriginCommand,
	defaultGitHubRepositoryName,
	githubBrowseUrlFromRemote,
	hasGitHubOriginRemote,
	originRemoteUrlFromGitConfig,
	sanitizeGitHubRepositoryName,
} from './publishWorkspaceToGitHub.js';
import {
	buildOpenVercelDeploymentCommand,
	vercelProductionUrlFromProjectJson,
} from './publishWorkspaceToVercel.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { BabadabaStage, deriveBabadabaStageState, type BabadabaStageState, type IBabadabaStageNode } from './babadabaStage.js';
import {
	babadabaHubHasAttention,
	buildBabadabaHubGraph,
	type BabadabaHubActionId,
	type BabadabaHubNode,
} from './babadabaHubGraph.js';
import { createUiClickOverlayScript, UiClickOverlayMessage } from './uiClickOverlayScript.js';
import { ChatSendResult, IChatService, ResponseModelState, type IChatModelReference } from '../../chat/common/chatService/chatService.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ChatWidget } from '../../chat/browser/widget/chatWidget.js';
import { ChatAgentLocation, ChatModeKind, ChatPermissionLevel } from '../../chat/common/constants.js';
import type { IChatRequestFileEntry } from '../../chat/common/attachments/chatVariableEntries.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { IPluginGitService } from '../../chat/common/plugins/pluginGitService.js';
import { editorBackground, editorForeground, inputBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { EDITOR_DRAG_AND_DROP_BACKGROUND } from '../../../common/theme.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ModeShellChatSessionManager } from './modeShellChatSessions.js';
import { IIxIntegrationService, type IxIntegrationState, type IxPipelineStepSnapshot, type IxPipelineStepStatus } from '../../../../../custom/ix/IxIntegrationService.js';
import { formatIxPruneWorkspaceRegistryDetail } from '../../../../../custom/ix/ixPruneWorkspaceRegistry.js';
import { DOCKER_DESKTOP_URL, DockerAvailabilityStatus, dockerAvailabilityCardValue, IDockerAvailabilityService, isDockerAvailabilityReady } from '../../../../../custom/docker/DockerAvailabilityService.js';
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
import { buildGoalOverviewModel, type GoalOverviewCta } from './goalOverviewModel.js';
import { nextProbeDelay, shouldProbeNearbyPorts } from './devServerProbePolicy.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { buildCadreClaudeMcpJson, buildSurfacePlanKickoffPrompt, buildSurfacePurposeRegenPrompt, buildSurfaceSchemaRegenPrompt, buildWorkstreamGeneratePrompt, buildWorkspaceDescriptionRegenPrompt, buildWorkspacePlanAnalysisPrompt, buildWorkspacePlanKickoffPrompt, CADRE_CLAUDE_SETTINGS_JSON, CADRE_INSPECT_GOAL_WORKSPACE_PY, CADRE_SURFACE_CLAUDE_MD } from '../../../../../custom/goalWorkspace/cadreSurfaceClaudeTemplate.js';
import {
	createRunningPhaseProgress,
	serializeSurfacePhaseProgress,
	surfacePhaseProgressResource,
} from '../../../../../custom/goalWorkspace/surfacePhaseProgress.js';
import {
	createRunningWorkstreamRuns,
	serializeSurfaceWorkstreamRuns,
	surfaceWorkstreamRunsResource,
} from '../../../../../custom/goalWorkspace/surfaceWorkstreamRuns.js';
import { surfaceGraphProposalResource } from '../../../../../custom/goalWorkspace/surfacePlanPaths.js';
import { planClaudeWorkstreamFanout, type ClaudeWorkstreamSpawnSpec } from './proposalGraphDiff/claudeWorkstreamFanout.js';
import { shouldFanoutClaudeWorkstreams } from './claudeWorkstreamFanoutGate.js';
import { partitionProposalWorkstreams } from './proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument } from './proposalGraphDiff/proposalGraphDiffTypes.js';
import {
	AGENT_ORCHESTRATOR_PROVIDER_STORAGE_KEY,
	parseAgentOrchestratorProvider,
	resolveOrchestratorModelId,
	shouldRunCustomAiPlanOrchestration,
	type AgentOrchestratorProviderId,
} from '../../../../../custom/goalWorkspace/agentOrchestratorProvider.js';
import {
	ANTHROPIC_API_KEY_ENV,
	ANTHROPIC_API_KEY_SECRET,
} from '../../../../../custom/goalWorkspace/anthropicApiKey.js';
import { promptForAnthropicApiKey } from '../../../../../custom/goalWorkspace/anthropicApiKeyPrompt.js';
import { promptForCustomAiApiKey } from '../../../../../custom/ai/browser/customAiApiKeyPrompt.js';
import { CUSTOM_AI_SECRET_OPENAI_API_KEY } from '../../../../../custom/ai/common/customAiConstants.js';
import {
	buildClaudeDispatchNotification,
	buildSurfacePlanOrchestrationPrompt,
	parseDispatchClaudeMarker,
	shouldExecuteClaudeAfterOrchestration,
	shouldOrchestratePlanAction,
	type SurfacePlanOrchestrationActionId,
} from '../../../../../custom/goalWorkspace/surfacePlanOrchestration.js';
import {
	DEFAULT_WORKSPACE_PLAN_BUSINESS_NAME,
	DEFAULT_WORKSPACE_PLAN_INTENT,
	DEFAULT_WORKSPACE_PLAN_MARKDOWN,
	DEFAULT_WORKSPACE_SUGGESTED_SURFACES_JSON,
} from '../../../../../custom/goalWorkspace/defaultWorkspacePlan.js';
import {
	parseWorkspaceSuggestedSurfaces,
	selectedSuggestedSurfaces,
	serializeWorkspaceSuggestedSurfaces,
	withSuggestedSurfaceSelection,
	withSuggestedSurfacesStatus,
	workspaceAttachmentsDir,
	workspacePlanAnalysisResource,
	workspacePlanResource,
	workspaceSuggestedSurfacesResource,
	type WorkspaceSuggestedSurface,
	type WorkspaceSuggestedSurfaces,
} from '../../../../../custom/goalWorkspace/workspacePlanPaths.js';
import {
	archiveWorkspacePlanAnalysis,
	listWorkspacePlanAnalysisRuns,
	type WorkspacePlanAnalysisRun,
} from '../../../../../custom/goalWorkspace/workspacePlanAnalysisHistory.js';
import { resolveWorkspacePlanSubmitPhase } from '../../../../../custom/goalWorkspace/workspacePlanSubmitState.js';
import {
	isConsoleHomeSection,
	resolveConsoleWorkflowStatus,
	type ConsoleHomeSection,
	type ConsoleWorkflowAction,
	type ConsoleWorkflowSignals,
	type ConsoleWorkflowStepState,
} from '../../../../../custom/goalWorkspace/consoleWorkflowStatus.js';
import {
	CONSOLE_HOME_DEFAULT_SECTION,
	exclusiveConsoleHomeOpenStates,
} from '../../../../../custom/goalWorkspace/consoleHomeAccordion.js';
import {
	consoleExampleBriefs,
	consoleWorkflowStepDisplayLabel,
	shouldShowConsoleFirstRun,
} from './consoleFirstRunModel.js';
import { resolveSurfacePendingPlanAction } from '../../../../../custom/goalWorkspace/surfacePlanPendingAction.js';
import {
	decideSurfaceAutoContinue,
	isResearchAutoContinueStage,
	SURFACE_AUTO_CONTINUE_COOLDOWN_MS,
	SURFACE_AUTO_CONTINUE_STALL_MS,
} from '../../../../../custom/goalWorkspace/surfacePlanAutoContinue.js';
import {
	isSurfaceDeployedWired,
	resolvePreferredCompleteSurfaceSectionId,
	shouldPreferPreviewSurfaceSection,
	shouldPromoteCompleteSurfaceSectionOnTransition,
	resolveSurfaceSectionIdForStep,
	type SurfacePlanWorkflowProgress,
} from '../../../../../custom/goalWorkspace/surfacePlanWorkflowStatus.js';
import { shouldAutoStartSurfacePreview } from '../../../../../custom/goalWorkspace/surfacePreviewAutoStart.js';
import {
	deleteSurfaceUiSnapshot,
	preferredSurfaceUiSnapshotSource,
	readSurfaceUiSnapshotSidecar,
	resolveSurfaceUiSnapshotForCard,
	shouldCaptureSurfaceUiSnapshot,
	surfaceUiSnapshotUrlsMatch,
	writeSurfaceUiSnapshot,
	type SurfaceUiSnapshotSource,
} from '../../../../../custom/goalWorkspace/surfaceUiSnapshot.js';
import {
	brandFolderResource,
	deleteGoalWorkspaceSurface,
	hasBrandConfigured,
	inferSurfaceSetupStep,
	loadSurfaceSetupDraft,
	saveGoalWorkspaceBuilderFields,
	saveSurfaceSetupDraft,
	upsertImportedGoalWorkspaceSurface,
	type SurfaceSetupStep,
} from '../../../../../custom/goalWorkspace/goalWorkspaceSurfaceSetup.js';
import {
	attachmentRefDisplayPath,
	attachmentRefResource,
	clearDescribeAppDraft,
	loadDescribeAppDraft,
	saveDescribeAppDraft,
	stageDescribeAppAttachment,
	toWorkspaceOrFsPaths,
	type DescribeAppAttachmentRef,
} from '../../../../../custom/goalWorkspace/describeAppDraft.js';
import { getPathForFile } from '../../../../platform/dnd/browser/dnd.js';
import { SurfaceBuilderHandoffState, type SurfaceBuilderHandoffStateValue } from '../../../../../custom/goalWorkspace/surfaceBuilderHandoffState.js';
import { blueprintResource, createBlueprintFromTemplateId, readBlueprint } from '../../../../../custom/goalWorkspace/surfaceBlueprintService.js';
import { registerSurfaceFromBlueprint } from '../../../../../custom/goalWorkspace/surfaceBlueprintScaffold.js';
import { verifySurfaceBlueprint } from '../../../../../custom/goalWorkspace/surfaceBlueprintVerify.js';
import { MAX_SURFACE_BLUEPRINT_REPAIR_ATTEMPTS, SurfaceBlueprintOrchestrator } from '../../../../../custom/goalWorkspace/surfaceBlueprintOrchestrator.js';
import { ISurfaceFeatureChecklistService } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistService.js';
import { IWorkflowCatalogService, upsertWorkflowSpec, workflowCatalogResource } from '../../../../../custom/goalWorkspace/workflowCatalogService.js';
import { IWorkflowRunnerService } from '../../../../../custom/goalWorkspace/workflowRunnerService.js';
import { discoverIxSubsystemRegions } from '../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import { SurfaceFeatureChecklistPanel } from './surfaceFeatureChecklistPanel.js';
import { registerModeShellChatTarget } from './modeShellChatTarget.js';
import { CustomAiAgentTaskExecutor } from './agentTaskTreeChatExecutor.js';
import { IAgentTaskTreeService, resolveCurrentTaskTreeStep } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import type { AgentTaskTree } from '../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import { normalizeSurfaceMainView, resolveDefaultSurfaceMainView, shouldShowSurfaceMainViewToggle, type SurfaceMainView } from '../../../../../custom/agentTaskTree/surfaceMainViewHelpers.js';
import { resolveSurfacePlanResource, surfacePlanResource } from '../../../../../custom/goalWorkspace/surfacePlanPaths.js';
import type { WorkflowSpec, WorkflowStep } from '../../../../../custom/goalWorkspace/workflowCatalogTypes.js';
import { buildTaskPrompt } from './agentTaskTreeChatExecutor.js';
import { SurfacePlanPanel } from './surfacePlanPanel.js';
import { SurfaceActionsPanel } from './surfaceActionsPanel.js';
import { SurfaceClaudeMdPanel } from './surfaceClaudeMdPanel.js';
import { SurfaceExtensibilityRegistry, type ISurfaceContext, type ISurfaceViewDescriptor, type ISurfaceViewRenderer } from './surfaceExtensibilityRegistry.js';
import {
	orderSurfaceProposalTreeCards,
	resolveSurfaceUrlRailCardValue,
	staticSurfaceProposalTreeCards,
	surfaceDescriptionCardValue,
	surfaceRailCardsLookLikePlaceholders,
	SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
	type SurfaceProposalTreeCardItem,
} from './surfaceProposalTreeCards.js';
import {
	isLiveSurfaceRailSection,
	resolveLiveSurfaceEmbeddedUrl,
	shouldAssignEmbeddedUrlForRailSection,
} from './surfaceEmbeddedPreviewRouting.js';
import { applyWheelToHorizontalScroll } from './horizontalWheelScroll.js';
import { CARD_RAIL_AUTO_HIDE_MS, CARD_RAIL_DEFAULT_WIDTH, CARD_RAIL_NARROW_WIDTH, CARD_RAIL_STYLESHEET, cardRailItemsEqual, clampCardRailWidth, createCardRailLayout, type CardRailItem, type CardRailLayout } from './cardRailLayout.js';
import {
	isRailHoverPreviewActive,
	railParentRowEndIndex,
	resolveRailChildrenDisplayParent,
	surfaceIdFromRailParentId,
} from './workspaceHomeRailHover.js';
import {
	claudeTerminalTabKeysEqual,
	claudeTerminalTitleFor,
	isClaudeKeyForSurface,
	ACTIONS_CLAUDE_KEY,
	isClaudeTerminalTitle,
	isReservedClaudeKey,
	LEGACY_CLAUDE_TERMINAL_TITLE,
	listLiveClaudeTerminalKeys,
	parseClaudeTerminalKey,
	parseClaudeWorkstreamKey,
	shouldRebindClaudeTerminalToSelection,
	surfaceIdFromClaudeKey,
	workstreamClaudeKeysForSurface,
	WORKSPACE_CLAUDE_KEY,
} from './claudeTerminalKeys.js';
import {
	formatActionsCommonOutcomePrompt,
	formatActionsWorkflowOutcomePrompt,
} from './actionsClaudePrompt.js';

const STORAGE_PROCESS_CHAT_DISMISSED = 'modeShell.processChatDismissed';
const STORAGE_UI_CHAT_DISMISSED = 'modeShell.uiChatDismissed';
const STORAGE_CONTEXT_GATHERING_OPEN = 'modeShell.contextGatheringOpen';
const STORAGE_SELECTED_GOAL_SURFACE = 'modeShell.selectedGoalSurface';
const STORAGE_ACTIVE_UI_CHAT_SURFACE = 'modeShell.activeUiChatSurface';
const STORAGE_UI_CHAT_DRAFT_PREFIX = 'modeShell.uiChatDraft.';
const STORAGE_SURFACE_MAIN_VIEW_PREFIX = 'modeShell.surfaceMainView.';
/** Last focused surface section card per surface id (plan / files / …). */
const STORAGE_SURFACE_SECTION_PREFIX = 'modeShell.surfaceSection.';
const STORAGE_WORKSPACE_HOME_VIEW = 'modeShell.workspaceHomeView';
const STORAGE_CONSOLE_SECTION = 'modeShell.consoleSection';
const STORAGE_CONSOLE_EXPANDED = 'modeShell.consoleExpanded';
const STORAGE_CARD_RAIL_WIDTH = 'modeShell.cardRailWidth';
const STORAGE_SURFACE_FEATURE_CHECKLIST_HIDDEN = 'modeShell.surfaceFeatureChecklistHidden';
/** When `'1'`, Steps Next / Run workstreams may spawn parallel Claudes. Default off (sequential). */
const STORAGE_PARALLEL_CLAUDE_WORKSTREAMS = 'modeShell.parallelClaudeWorkstreams';
/** Workspace Agent Orchestrator LLM: `claude` | `openaiCompatible` | `ollama`. */
const STORAGE_AGENT_ORCHESTRATOR_PROVIDER = AGENT_ORCHESTRATOR_PROVIDER_STORAGE_KEY;
const STORAGE_CLAUDE_TERMINAL_HEIGHT = 'modeShell.claudeTerminalHeight';
const STORAGE_CLAUDE_TERMINAL_ACTIVE_KEYS = 'modeShell.claudeTerminalActiveKeys';
/** Legacy boolean — migrated into {@link STORAGE_CLAUDE_TERMINAL_ACTIVE_KEYS}. */
const STORAGE_CLAUDE_TERMINAL_ACTIVE_LEGACY = 'modeShell.claudeTerminalActive';
const CLAUDE_TERMINAL_MIN_HEIGHT = 120;
const CLAUDE_TERMINAL_DEFAULT_HEIGHT = 240;
/** Pointer distance from the UI container's bottom edge that re-shows a collapsed Claude pane. */
const CLAUDE_TERMINAL_REVEAL_EDGE_PX = 14;
/** Pointer distance from the UI container's top edge that re-shows a collapsed Steps pane. */
const STEPS_REVEAL_EDGE_PX = 14;
/** Pointer distance from the body row's right edge that re-shows a dismissed AI chat. */
const UI_CHAT_REVEAL_EDGE_PX = 14;
const ADD_SURFACE_ID = '__add_surface__';

/** Section shown inside the Console host (Plan / Surfaces / Rules / Brand / Settings). */
type WorkspaceHomeView = ConsoleHomeSection;

function isWorkspaceHomeView(value: string | undefined): value is WorkspaceHomeView {
	return isConsoleHomeSection(value);
}

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

function surfaceIdFromRepoUrl(value: string): string {
	const withoutQuery = value.trim().split(/[?#]/)[0] ?? value.trim();
	const leaf = withoutQuery.replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
	return slugifySurfaceId(leaf.replace(/\.git$/i, ''));
}

function normalizeOptionalSurfaceInput(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

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

	private static readonly MODES: readonly Mode[] = [];

	private readonly container: HTMLElement;
	private readonly topModeButtons = new Map<Mode, HTMLButtonElement>();
	private readonly modeTopBar: HTMLElement;
	private readonly uiCodeTab: HTMLButtonElement;
	private readonly uiProjectName: HTMLElement;
	private readonly uiProjectNameLabel: HTMLElement;
	private readonly modeSurface: HTMLElement;
	private readonly uiContainer: HTMLElement;
	private readonly processContainer: HTMLElement;
	private readonly processMainColumn: HTMLElement;
	private readonly processMainContent: HTMLElement;
	private readonly processChatColumn: HTMLElement;
	private readonly processChatReopenBtn: HTMLButtonElement;
	private readonly uiMainColumn: HTMLElement;
	private readonly uiBodyRow: HTMLElement;
	private readonly uiStepsPane: HTMLElement;
	private readonly uiStepsHost: HTMLElement;
	private readonly uiStepsReopenBtn: HTMLButtonElement;
	private readonly uiStepsReopenPendingDot: HTMLElement;
	private readonly uiClaudeTerminalPane: HTMLElement;
	private readonly uiClaudeTerminalSash: HTMLElement;
	private readonly uiClaudeTerminalHost: HTMLElement;
	private readonly uiClaudeTerminalEmpty: HTMLElement;
	private readonly uiClaudeTerminalReopenBtn: HTMLButtonElement;
	private readonly uiClaudeTerminalReopenPendingDot: HTMLElement;
	private uiClaudeTerminalStatus!: HTMLElement;
	private uiClaudeTerminalKeyLabel!: HTMLElement;
	private uiClaudeTerminalKeyTabs!: HTMLElement;
	private readonly claudeTerminalKeyTabListeners = this._register(new DisposableStore());
	/** Surface ids where Claude is mid-phase (`phase-progress` running). */
	private readonly surfaceClaudeWorkingById = new Map<string, string>();
	/**
	 * Recent Claude PTY output / prompt submit — event-driven (not polled).
	 * Cleared by {@link claudeTerminalActivityClear} after a short idle window.
	 */
	private claudeTerminalActivityLabel: string | undefined;
	private readonly claudeTerminalActivityClear = this._register(new RunOnceScheduler(() => {
		this.claudeTerminalActivityLabel = undefined;
		this.syncClaudeReopenAttention();
	}, 6000));
	private readonly claudeKickoffLogs: string[] = [];
	/** Keep-alive Claude Code terminals keyed by surface id, {@link WORKSPACE_CLAUDE_KEY}, or {@link ACTIONS_CLAUDE_KEY}. */
	private readonly claudeTerminalByKey = new Map<string, ITerminalInstance>();
	private readonly claudeTerminalLifecycleByKey = new Map<string, IDisposable>();
	private visibleClaudeTerminalKey: string | undefined;
	/**
	 * While > 0, ignore terminalService.onDidChangeInstances rebinds — close/switch
	 * dispose races otherwise stomp the intended next tab.
	 */
	private claudeTerminalUiMutationDepth = 0;
	/**
	 * Re-entrancy guard for Claude terminal map sync. `syncClaudeWorkstreamSwitcher`
	 * → `syncClaudeTerminalMapFromService` → `registerClaudeTerminalInstance` → (dispose)
	 * → `syncClaudeWorkstreamSwitcher` previously blew the stack (42× in one session).
	 */
	private claudeTerminalSyncDepth = 0;
	private pendingClaudeWorkstreamActiveKey: string | undefined;
	/** Last rendered Claude header tab keys — skip full rebuild when only active changes. */
	private lastClaudeTerminalTabKeys: string[] = [];
	private readonly syncClaudeWorkstreamSwitcherScheduler = this._register(new RunOnceScheduler(() => {
		// Prefer the currently visible tab over a stale queued key (dispose races).
		this.syncClaudeWorkstreamSwitcher(
			this.visibleClaudeTerminalKey ?? this.pendingClaudeWorkstreamActiveKey,
		);
	}, 0));
	private claudeTerminalHeight = CLAUDE_TERMINAL_DEFAULT_HEIGHT;
	private claudeTerminalCollapsed = true;
	private claudeTerminalHovering = false;
	private claudeTerminalHideTimer: number | undefined;
	private claudeTerminalLastPointerX = 0;
	private claudeTerminalLastPointerY = 0;
	private stepsCollapsed = false;
	private stepsHovering = false;
	private stepsHideTimer: number | undefined;
	/** When the Console card column is expanded, Steps stays open (one-way couple). */
	private consoleRailCollapsed = false;
	private uiChatHovering = false;
	private uiChatHideTimer: number | undefined;
	private claudeTerminalRestoreInFlight = false;
	/** Keys currently creating/starting a Claude terminal so selection does not wait on Steps/planning. */
	private readonly claudeTerminalEnsureInFlightByKey = new Set<string>();
	/** Coalesce concurrent createTerminal calls for the same Claude key. */
	private readonly claudeTerminalCreateInFlightByKey = new Map<string, Promise<{ terminal: ITerminalInstance; created: boolean }>>();
	/** Keys that already had `claude` / `claude --continue` sent for the current PTY. */
	private readonly claudeCliStartedByKey = new Set<string>();
	private readonly claudeTerminalAutoRestoreAttemptsByKey = new Map<string, { attempts: number; windowStart: number }>();
	private readonly uiFeatureChecklistColumn: HTMLElement;
	private readonly uiChatColumn: HTMLElement;
	private readonly uiActionsHost: HTMLElement;
	private readonly uiChatTitleEl: HTMLElement;
	private readonly uiChatNewButton: HTMLButtonElement;
	private activeUiChatSurfaceId: string | undefined;
	/** Surface id currently bound to the shared UI chat widget (composer state). */
	private boundUiChatSurfaceId: string | undefined;
	private readonly uiChatReopenBtn: HTMLButtonElement;
	private readonly styleSheet = createStyleSheet();
	private readonly uiBrowser: HTMLElement & { src: string };
	private readonly uiBrowserShell: HTMLElement;
	private readonly processCallout: HTMLElement;
	private readonly processStartHints: HTMLElement;
	private readonly uiSetup: HTMLElement;
	private readonly processSetup: HTMLElement;
	private readonly uiSelectionPill: HTMLElement;
	private readonly uiSelectionCountEl: HTMLElement;
	private readonly uiSelectionClearBtn: HTMLButtonElement;
	private readonly uiClearAllSurfacesBtn: HTMLButtonElement;
	private uiSelectionCount = 0;
	private readonly uiStartAppButton: HTMLButtonElement;
	private uiStartAllSurfacesButton!: HTMLButtonElement;
	private readonly uiStartSubtitle: HTMLElement;
	private readonly uiStartStatus: HTMLElement;
	private readonly uiRuntimeText: HTMLElement;
	private readonly uiSurfaceSwitcher: HTMLElement;
	private readonly uiSurfaceLaunchPanel: HTMLElement;
	private readonly uiSurfaceMainViewToggle: HTMLElement;
	private readonly uiSurfaceMainContent: HTMLElement;
	private readonly uiSurfacePlanPanelRoot: HTMLElement;
	private readonly uiSurfaceClaudeMdPanelRoot: HTMLElement;
	private readonly uiSurfaceIxSubsystemsPanelRoot: HTMLElement;
	/** Host for registry-contributed surface views; one lazily created slot per view id. */
	private readonly uiSurfaceCustomViewsRoot: HTMLElement;
	private readonly surfaceCustomViewSlots = this._register(new DisposableMap<string, { readonly root: HTMLElement; readonly renderer: ISurfaceViewRenderer } & IDisposable>());
	private readonly uiSurfaceTaskTreeToggleButtons = new Map<SurfaceMainView, HTMLButtonElement>();
	private surfacePlanPanel: SurfacePlanPanel | undefined;
	private surfaceMainView: SurfaceMainView = 'plan';
	private selectedSurfaceTaskTree: AgentTaskTree | undefined;
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
	private uiWorkspaceHomeCardRail!: CardRailLayout;
	/** Section cards of the selected surface, shown in the shared rail below the surfaces group. */
	private surfaceRailCards: readonly CardRailItem[] = [];
	/** Warm section cards per surface id for hover-preview without opening the surface. */
	private readonly surfaceRailCardsById = new Map<string, readonly CardRailItem[]>();
	/** Transient Console/surface parent hover — swaps child cards without changing selection. */
	private hoveredRailParentId: string | undefined;
	private hoveredRailParentClearTimer: number | undefined;
	/** True while a surface is open and its section cards have not published yet. */
	private surfaceRailCardsLoading = false;
	/** Prefer this section when surface cards finish loading after a Step click. */
	private pendingSurfaceSectionId: string | undefined;
	/** surfaceId → pending Next CTA or in-progress step label (Surface / Steps attention dots). */
	private readonly surfacePendingActionById = new Map<string, string>();
	/** surfaceId → plan/build completion for Console surface cards. */
	private readonly surfaceProgressById = new Map<string, SurfacePlanWorkflowProgress>();
	/** Last observed `complete` per surface — used for one-shot Preview/Deployed promote on 100%. */
	private readonly surfaceWasCompleteById = new Map<string, boolean>();
	/** Stall watchdog: fingerprint + first-seen / last-nudge times for Claude-owned stages. */
	private readonly surfaceAutoContinueStateById = new Map<string, {
		fingerprint: string;
		firstSeenMs: number;
		lastNudgeMs?: number;
	}>();
	private surfaceAutoContinueTimer: number | undefined;
	private surfacePendingActionRefreshGeneration = 0;
	private readonly surfacePendingActionWatcher = this._register(new MutableDisposable());
	/** Which left-rail card is highlighted — independent of surface open state so section/home cards can stick. */
	private activeRailCardId: string | undefined;
	private uiWorkspacePlanHomePanel!: HTMLElement;
	private uiWorkspaceClaudeMdPanelRoot!: HTMLElement;
	private workspaceClaudeMdPanel: SurfaceClaudeMdPanel | undefined;
	/** Active Console section (Plan / Surfaces / Rules / Brand / Settings). */
	private workspaceHomeView: WorkspaceHomeView = 'surfaces';
	/** True while programmatically setting details.open (ignore toggle → rail feedback). */
	private consoleHomeAccordionApplying = false;
	/** When true (and no surface open), Console section cards appear under the Console rail card. */
	private consoleExpanded = true;
	private uiConsoleHomeHost!: HTMLElement;
	private uiConsoleFirstRunHero!: HTMLElement;
	private uiFirstRunComposer!: HTMLElement;
	private uiFirstRunBriefInput!: HTMLTextAreaElement;
	private uiFirstRunAttachmentsNote!: HTMLElement;
	private uiConsolePreflightPill!: HTMLButtonElement;
	/** Docker guidance opened from the preflight pill while first-run would otherwise hide it. */
	private consoleFirstRunDockerPeek = false;
	private readonly firstRunFlashTimer = this._register(new MutableDisposable());
	private uiConsoleStatusTracker!: HTMLElement;
	private uiConsoleStatusRail!: HTMLElement;
	private uiConsoleStatusLabel!: HTMLElement;
	private uiConsoleStatusNextActionButton!: HTMLButtonElement;
	private uiBabadabaSteps!: HTMLElement;
	private uiBabadabaStepsParent!: HTMLElement;
	private uiBabadabaStepsChildren!: HTMLElement;
	private readonly babadabaStepsListeners = this._register(new DisposableStore());
	private lastBabadabaHubNodes: readonly BabadabaHubNode[] = [];
	private uiConsoleSectionHost!: HTMLElement;
	private lastConsoleCenteredStepId: string | undefined;
	private uiWorkspacePlanBrandFields!: HTMLElement;
	private uiWorkspaceSettingsPanel!: HTMLElement;
	private uiWorkspaceHowItWorksPanel!: HTMLElement;
	private uiWorkspaceDescriptionPanel!: HTMLElement;
	private uiWorkspaceDescriptionBody!: HTMLElement;
	private uiWorkspaceDescriptionRegenButton!: HTMLButtonElement;
	private uiWorkspaceDockerPanel!: HTMLElement;
	private uiDockerStatusHeadline!: HTMLElement;
	private uiDockerStatusDetail!: HTMLElement;
	private uiDockerRefreshButton!: HTMLButtonElement;
	private uiDockerGetDesktopButton!: HTMLButtonElement;
	private uiParallelClaudeWorkstreamsToggle!: HTMLInputElement;
	private uiSettingsAgentOrchestratorProviderGroup!: HTMLElement;
	private uiSettingsAgentOrchestratorProviderInputs = new Map<AgentOrchestratorProviderId, HTMLInputElement>();
	private uiSettingsAnthropicKeyStatusEl!: HTMLElement;
	private uiSettingsOpenAiKeyRow!: HTMLElement;
	private uiSettingsOpenAiKeyStatusEl!: HTMLElement;
	private uiSurfaceSetupSurfacesBody!: HTMLElement;
	private uiSurfaceCreateHost!: HTMLElement;
	private uiSurfaceCreateChooser!: HTMLElement;
	private uiSurfaceDescribeCompose!: HTMLElement;
	private uiSurfaceDescribeNameInput!: HTMLInputElement;
	private uiSurfaceDescribeIntentInput!: HTMLTextAreaElement;
	private uiSurfaceDescribeAttachmentList!: HTMLElement;
	private uiSurfaceDescribeSubmitButton!: HTMLButtonElement;
	private readonly describeAppAttachments: DescribeAppAttachmentRef[] = [];
	private readonly describeAppAttachmentListeners = this._register(new DisposableStore());
	private readonly describeAppAttachmentPreviewUrls: string[] = [];
	private describeAppDraftHydrating = false;
	private readonly describeAppDraftAutosaveScheduler = this._register(new RunOnceScheduler(() => void this.persistDescribeAppDraft(), 400));
	private uiWorkspacePlanStrip!: HTMLElement;
	private uiBabadabaStageHost: HTMLElement | undefined;
	private babadabaStage: BabadabaStage | undefined;
	private babadabaStageState: BabadabaStageState = 'idle';
	/** Whether the workspace root has a .git directory; undefined until probed. */
	private workspaceHasGitRepo: boolean | undefined;
	private uiWorkspacePlanIntentInput!: HTMLTextAreaElement;
	private uiWorkspacePlanAttachmentList!: HTMLElement;
	private uiWorkspacePlanSubmitButton!: HTMLButtonElement;
	private uiWorkspacePlanAnalysisHistory!: HTMLDetailsElement;
	private uiWorkspacePlanAnalysisHistorySummary!: HTMLElement;
	private uiWorkspacePlanAnalysisHistoryBody!: HTMLElement;
	private readonly workspacePlanAnalysisHistoryListeners = this._register(new DisposableStore());
	private uiWorkspaceSurfacesHost!: HTMLElement;
	private uiWorkspaceSurfacesGrid!: HTMLElement;
	private readonly workspaceSurfaceCardListeners = this._register(new DisposableStore());
	/** In-flight UI snapshot captures keyed by surface id (debounce concurrent loads). */
	private readonly surfaceUiSnapshotCaptureInFlight = new Set<string>();
	/** Object URLs for surface-card snapshot previews — revoked on card rebuild. */
	private readonly surfaceUiSnapshotObjectUrls: string[] = [];
	private readonly surfaceUiSnapshotCaptureScheduler = this._register(new RunOnceScheduler(
		() => void this.maybeCaptureSurfaceUiSnapshot(),
		900,
	));
	private uiWorkspaceSuggestedHost!: HTMLElement;
	private uiWorkspaceSuggestedGrid!: HTMLElement;
	private uiWorkspaceSuggestedCreateButton!: HTMLButtonElement;
	private readonly workspacePlanAttachments: Array<{
		readonly id: string;
		readonly kind: 'image' | 'file';
		readonly name: string;
		readonly mimeType: string;
		readonly data: Uint8Array;
	}> = [];
	private readonly workspacePlanAttachmentListeners = this._register(new DisposableStore());
	private readonly workspaceSuggestedCardListeners = this._register(new DisposableStore());
	private readonly workspaceSuggestedWatcher = this._register(new MutableDisposable());
	private readonly workspacePlanAnalysisWatcher = this._register(new MutableDisposable());
	private workspaceSuggestedSurfaces: WorkspaceSuggestedSurfaces | undefined;
	private workspaceSuggestedWriteInFlight = false;
	private workspacePlanKickoffInFlight = false;
	/** True while Kickoff analysis is submitting / waiting for the report artifact. */
	private workspacePlanAnalysisInFlight = false;
	/** True after kickoff prompt is sent until suggested surfaces (or failure) arrive. */
	private workspacePlanSessionActive = false;
	private workspacePlanArtifactExists = false;
	/** Ensures Surfaces is opened once when suggestions first appear after kickoff. */
	private workspaceSuggestedSurfacesRevealPending = false;
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
	private readonly uiSurfaceEmptyBody: HTMLElement;
	private readonly uiSurfaceEmptyFolders: HTMLElement;
	private readonly uiSurfaceEmptyActions: HTMLElement;
	private readonly emptyOpenableFolderListeners = this._register(new DisposableStore());
	private readonly workspaceSwitcherListeners = this._register(new DisposableStore());
	private workspaceSwitcherPopover: HTMLElement | undefined;
	private workspaceSwitcherOpenGeneration = 0;
	private readonly goalOverviewListeners = this._register(new DisposableStore());
	private emptyOpenableFoldersEnabled = false;
	private readonly uiSurfaceButtons = new Map<string, HTMLButtonElement>();
	private selectedSurfaceId: string | undefined;
	/** Bumped on each surface open / deselect so in-flight opens cannot re-select after collapse. */
	private surfacePlanOpenGeneration = 0;
	private lastSurfaceRoutingLogKey: string | undefined;
	private lastUiStartHints: DevServerSuggestedCommands | undefined;
	private surfacePortsFreedAtStartup = false;
	private startAllSurfacesInProgress = false;
	private readonly startedSurfaceServers = new Set<string>();
	private readonly startingSurfaceServers = new Set<string>();
	private readonly uiRuntimeLogs: string[] = [];
	private readonly uiClickOverlayScript = createUiClickOverlayScript();
	private readonly startHintActionDisposables = this._register(new DisposableStore());
	private readonly surfaceLaunchActionDisposables = this._register(new DisposableStore());
	private reachabilityUrl: string | undefined;
	private appReachable = false;
	private readonly uiDevServerProbeScheduler = this._register(new RunOnceScheduler(() => this.scheduleEmbeddedUiDevServerProbe(), 2500));
	private readonly surfacePreviewRetryScheduler = this._register(new RunOnceScheduler(() => this.retrySelectedSurfacePreview(), 2500));
	/** Consecutive missed probes driving the backoff in devServerProbePolicy. */
	private uiDevServerProbeFailures = 0;
	private surfacePreviewProbeFailures = 0;
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
		@ILogService private readonly logService: ILogService,
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
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IHostService private readonly hostService: IHostService,
		@ILabelService private readonly labelService: ILabelService,
		@IStartupGuideService private readonly startupGuideService: IStartupGuideService,
		@IAppLaunchGuideService private readonly appLaunchGuideService: IAppLaunchGuideService,
		@IConsoleService private readonly consoleService: IConsoleService,
		@ISurfaceFeatureChecklistService private readonly surfaceFeatureChecklistService: ISurfaceFeatureChecklistService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IWorkflowCatalogService private readonly workflowCatalogService: IWorkflowCatalogService,
		@IWorkflowRunnerService private readonly workflowRunnerService: IWorkflowRunnerService,
		@IAgentTaskTreeService private readonly agentTaskTreeService: IAgentTaskTreeService,
		@IPluginGitService private readonly pluginGitService: IPluginGitService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super();
		ModeShellContribution.activeInstance = this;
		this._register(toDisposable(() => {
			if (ModeShellContribution.activeInstance === this) {
				ModeShellContribution.activeInstance = undefined;
			}
			this.clearSurfaceAutoContinueTimer();
			this.revokeSurfaceUiSnapshotObjectUrls();
		}));

		this._processChatDismissed = this.storageService.get(STORAGE_PROCESS_CHAT_DISMISSED, StorageScope.PROFILE) === '1';
		this._uiChatDismissed = this.storageService.get(STORAGE_UI_CHAT_DISMISSED, StorageScope.PROFILE) === '1';
		this.contextGatheringOpen = this.storageService.get(STORAGE_CONTEXT_GATHERING_OPEN, StorageScope.PROFILE) !== '0';
		this.activeUiChatSurfaceId = this.storageService.get(STORAGE_ACTIVE_UI_CHAT_SURFACE, StorageScope.WORKSPACE);

		this.chatSessionManager = new ModeShellChatSessionManager(this.chatService, this.chatWidgetService, this.storageService);
		this._register(this.agentTaskTreeService.setExecutor(new CustomAiAgentTaskExecutor(
			this.chatService,
			this.chatSessionManager,
			this.fileService,
			this.workspaceContextService,
		)));
		this._register(this.agentTaskTreeService.setIxIntegrationService(this.ixIntegrationService));
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
			${CARD_RAIL_STYLESHEET.split('\n').map(line => line.trim() ? `\t\t\t${line}` : '').join('\n')}

			.monaco-workbench .custom-mode-ui-workspace-home-rail {
				flex: 1 1 auto;
				min-height: 0;
				height: 100%;
				margin: 0;
				border: 0;
				border-radius: 0;
				overflow: hidden;
				background: var(--vscode-editor-background);
			}

			.monaco-workbench .custom-mode-ui-workspace-home-rail .custom-mode-card-rail-cards {
				/* Match Surface proposal tree: sticky left 2-col meta rail */
				background: var(--vscode-sideBar-background);
				/* Keep above in-flow webviews that can otherwise steal hits from the rail. */
				position: relative;
				z-index: 2;
			}

			.monaco-workbench .custom-mode-ui-workspace-home-rail .custom-mode-card-rail-content {
				padding: 16px 28px;
				gap: 12px;
			}

			/* Start-preview chrome is full-bleed inside the content host (own toolbar + body padding). */
			.monaco-workbench .custom-mode-ui-workspace-home-rail .custom-mode-card-rail-content:has(> .custom-mode-ui-surface-launch-panel:not(.hidden)) {
				padding: 0;
				gap: 0;
				overflow: hidden;
			}

			/* Collapsed rail: clear the left Console edge chip so it cannot cover titles/cards. */
			.monaco-workbench .custom-mode-ui-workspace-home-rail.collapsed .custom-mode-card-rail-content {
				padding-left: 40px;
			}

			.monaco-workbench .custom-mode-ui-workspace-home-rail.collapsed .custom-mode-card-rail-content:has(> .custom-mode-ui-surface-launch-panel:not(.hidden)) {
				padding-left: 0;
			}

			.monaco-workbench .custom-mode-ui-workspace-home-rail .custom-mode-card-rail-content > .hidden {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-workspace-home-panel {
				display: flex;
				flex-direction: column;
				gap: 0;
				/* Content-sized so the Console section host can scroll long Plan/Surfaces/Brand views. */
				flex: 0 0 auto;
				min-height: auto;
			}

			.monaco-workbench .custom-mode-ui-workspace-home-panel.hidden {
				display: none !important;
			}

			/* Code mode: prominent ← Console on the shell top bar (top-left). */
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .custom-mode-ui-project-name {
				background: var(--vscode-button-secondaryBackground, var(--vscode-toolbar-hoverBackground));
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				border: 1px solid var(--vscode-button-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
				font-weight: 700;
			}

			.monaco-workbench.custom-mode-shell-enabled.custom-mode-code .custom-mode-ui-project-name:hover {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
			}

			.monaco-workbench.custom-mode-shell-enabled {
				--custom-mode-shell-height: 34px;
				--custom-mode-shell-bottom-inset: 0px;
			}

			/* Console mode: no top tab row — Code lives as a card in the shared rail. */
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-top-collapsed {
				--custom-mode-shell-height: 0px;
			}

			.monaco-workbench.custom-mode-shell-enabled.custom-mode-top-collapsed > .custom-mode-top-modes {
				display: none;
			}

			/* Keep the first rail cards clear of the macOS traffic lights when the top bar is gone. */
			.monaco-workbench.custom-mode-shell-enabled.custom-mode-top-collapsed.mac:not(.fullscreen) .custom-mode-ui-workspace-home-rail .custom-mode-card-rail-cards {
				padding-top: 40px;
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
				padding: 0 20px;
				box-sizing: border-box;
				border-bottom: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
				-webkit-app-region: no-drag;
			}

			/* Native macOS traffic lights sit in the top-left corner and overlay our shell bar. */
			.monaco-workbench.custom-mode-shell-enabled.mac:not(.fullscreen) > .custom-mode-top-modes,
			.monaco-workbench.custom-mode-shell-enabled > .custom-mode-top-modes.mac-native:not(.custom-mode-top-modes-fullscreen) {
				padding-left: 100px;
			}

			.monaco-workbench.custom-mode-shell-enabled.mac.macos-tahoe:not(.fullscreen) > .custom-mode-top-modes,
			.monaco-workbench.custom-mode-shell-enabled > .custom-mode-top-modes.mac-native.macos-tahoe:not(.custom-mode-top-modes-fullscreen) {
				padding-left: 108px;
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
				display: inline-flex;
				align-items: center;
				gap: 5px;
				max-width: min(240px, 28vw);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				line-height: 1;
				padding: 4px 8px;
				margin: 0;
				border: 0;
				border-radius: 4px;
				background: transparent;
				cursor: pointer;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench .custom-mode-ui-code-tab {
				margin-left: 0;
			}

			.monaco-workbench .custom-mode-ui-code-tab + .custom-mode-ui-project-name {
				margin-left: 4px;
			}

			.monaco-workbench .custom-mode-ui-project-name-label {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
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
				flex-direction: column;
				flex: 1 1 auto !important;
				height: 100% !important;
				min-height: 0 !important;
				align-self: stretch;
				align-items: stretch;
				justify-content: flex-start;
				position: relative;
			}

			.monaco-workbench .custom-mode-ui-body-row {
				display: flex;
				flex-direction: row;
				flex: 1 1 auto;
				min-width: 0;
				min-height: 0;
				align-items: stretch;
				overflow: hidden;
				position: relative;
			}

			.monaco-workbench .custom-mode-ui-claude-reopen {
				display: flex;
				position: absolute;
				left: 50%;
				bottom: 0;
				transform: translateX(-50%) translateY(4px);
				z-index: 25;
				align-items: center;
				justify-content: center;
				gap: 6px;
				/* Tighter bottom so the docked chip doesn’t look bottom-heavy over the preview. */
				padding: 5px 14px 2px;
				border: 1px solid var(--vscode-panel-border);
				border-bottom: none;
				border-radius: 6px 6px 0 0;
				background-color: var(--vscode-sideBar-background);
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				line-height: 1.2;
				cursor: pointer;
				box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.2);
				opacity: 0;
				pointer-events: none;
				transition: opacity 120ms ease, transform 160ms ease;
			}

			.monaco-workbench .custom-mode-ui-claude-reopen-label {
				line-height: 1.2;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-claude-collapsed.visible .custom-mode-ui-claude-reopen {
				opacity: 1;
				pointer-events: auto;
				transform: translateX(-50%) translateY(0);
			}

			.monaco-workbench .custom-mode-ui-claude-reopen:hover {
				background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-sideBar-background));
			}

			.monaco-workbench .custom-mode-ui-steps-pane {
				display: flex;
				flex-direction: column;
				flex: 0 0 auto;
				min-height: 0;
				padding: 8px 12px 8px;
				box-sizing: border-box;
				overflow: hidden;
				transition: flex-basis 160ms ease, height 160ms ease, min-height 160ms ease, opacity 120ms ease, padding 160ms ease;
			}

			.monaco-workbench .custom-mode-ui-steps-pane.hidden {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-steps-host {
				display: flex;
				flex-direction: row;
				align-items: stretch;
				min-width: 0;
				width: 100%;
				gap: 0;
			}

			.monaco-workbench .custom-mode-ui-steps-host > .custom-mode-surface-plan-status-tracker {
				flex: 1 1 auto;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-steps-host > .custom-mode-surface-plan-status-tracker.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-steps-collapsed .custom-mode-ui-steps-pane:not(.hidden) {
				flex: 0 0 0 !important;
				height: 0 !important;
				min-height: 0 !important;
				padding-top: 0 !important;
				padding-bottom: 0 !important;
				opacity: 0;
				overflow: hidden;
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-steps-reopen {
				display: flex;
				position: absolute;
				left: 50%;
				top: 0;
				transform: translateX(-50%) translateY(-4px);
				z-index: 25;
				align-items: center;
				justify-content: center;
				gap: 6px;
				padding: 6px 14px;
				border: 1px solid var(--vscode-panel-border);
				border-top: none;
				border-radius: 0 0 6px 6px;
				background-color: var(--vscode-sideBar-background);
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
				opacity: 0;
				pointer-events: none;
				transition: opacity 120ms ease, transform 160ms ease;
			}

			.monaco-workbench .custom-mode-ui-steps-reopen.hidden {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-steps-collapsed.visible .custom-mode-ui-steps-reopen:not(.hidden) {
				opacity: 1;
				pointer-events: auto;
				transform: translateX(-50%) translateY(0);
			}

			.monaco-workbench .custom-mode-ui-steps-reopen:hover {
				background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-sideBar-background));
			}

			/* Flashing attention dot when Steps has a pending / in-progress action. */
			.monaco-workbench .custom-mode-ui-steps-reopen-pending-dot {
				display: none;
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex: 0 0 auto;
				background: var(--vscode-textLink-foreground, var(--vscode-focusBorder, #3794ff));
				box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
				animation: custom-mode-card-rail-pending-pulse 1.6s ease-out infinite;
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-steps-reopen.has-pending-action .custom-mode-ui-steps-reopen-pending-dot {
				display: block;
			}

			/* Flashing attention dot when Claude is actively working (collapsed chip). */
			.monaco-workbench .custom-mode-ui-claude-reopen-pending-dot {
				display: none;
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex: 0 0 auto;
				background: var(--vscode-textLink-foreground, var(--vscode-focusBorder, #3794ff));
				box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
				animation: custom-mode-card-rail-pending-pulse 1.6s ease-out infinite;
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-claude-reopen.has-pending-action .custom-mode-ui-claude-reopen-pending-dot {
				display: block;
			}

			@keyframes custom-mode-card-rail-pending-pulse {
				0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent); }
				70% { box-shadow: 0 0 0 8px transparent; }
				100% { box-shadow: 0 0 0 0 transparent; }
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-sash {
				flex: 0 0 5px;
				height: 5px;
				margin: 0;
				padding: 0;
				border: none;
				border-top: 1px solid var(--vscode-panel-border);
				background: transparent;
				cursor: ns-resize;
				position: relative;
				z-index: 5;
				transition: flex-basis 160ms ease, height 160ms ease, opacity 120ms ease, border-color 120ms ease;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-sash::before {
				content: '';
				position: absolute;
				left: 0;
				right: 0;
				top: -3px;
				bottom: -3px;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-sash:hover,
			.monaco-workbench .custom-mode-ui-claude-terminal-sash.active {
				background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
			}

			.monaco-workbench .custom-mode-ui-claude-terminal {
				display: flex;
				flex-direction: column;
				flex: 0 0 auto;
				min-height: ${CLAUDE_TERMINAL_MIN_HEIGHT}px;
				background: var(--vscode-terminal-background, var(--vscode-panel-background));
				overflow: hidden;
				transition: flex-basis 160ms ease, height 160ms ease, min-height 160ms ease, opacity 120ms ease;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-claude-collapsed .custom-mode-ui-claude-terminal-sash {
				flex: 0 0 0 !important;
				height: 0 !important;
				opacity: 0;
				overflow: hidden;
				pointer-events: none;
				border: none;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-claude-collapsed .custom-mode-ui-claude-terminal {
				flex: 0 0 0 !important;
				height: 0 !important;
				min-height: 0 !important;
				opacity: 0;
				overflow: hidden;
				pointer-events: none;
				border: none;
			}

			/* File/media drag target feedback — green outline while dragging into Claude. */
			.monaco-workbench .custom-mode-ui-claude-terminal.dragover {
				outline: 2px solid var(--vscode-charts-green, #89d185);
				outline-offset: -2px;
				box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--vscode-charts-green, #89d185) 35%, transparent);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				padding: 6px 20px;
				border-bottom: 1px solid var(--vscode-panel-border);
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 600;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key {
				flex: 0 1 auto;
				min-width: 0;
				max-width: 28%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 500;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tabs {
				display: flex;
				align-items: center;
				flex: 1 1 auto;
				min-width: 0;
				gap: 2px;
				overflow-x: auto;
				overflow-y: hidden;
				scrollbar-width: thin;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tabs.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap {
				display: inline-flex;
				align-items: center;
				flex: 0 0 auto;
				gap: 0;
				border-radius: 4px;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap:hover,
			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap.active {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap.active {
				background: var(--vscode-list-activeSelectionBackground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab {
				flex: 0 0 auto;
				height: 22px;
				padding: 0 6px 0 8px;
				border: none;
				border-radius: 4px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 500;
				cursor: pointer;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap:hover .custom-mode-ui-claude-terminal-key-tab,
			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab:hover {
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap.active .custom-mode-ui-claude-terminal-key-tab,
			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab.active {
				color: var(--vscode-list-activeSelectionForeground);
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-close {
				flex: 0 0 auto;
				width: 18px;
				height: 18px;
				margin-right: 2px;
				padding: 0;
				border: 0;
				border-radius: 4px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				cursor: pointer;
				line-height: 1;
				font-size: 12px;
				font-weight: 700;
				opacity: 0.55;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap:hover .custom-mode-ui-claude-terminal-key-close,
			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap.active .custom-mode-ui-claude-terminal-key-close,
			.monaco-workbench .custom-mode-ui-claude-terminal-key-close:focus {
				opacity: 1;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-tab-wrap.active .custom-mode-ui-claude-terminal-key-close {
				color: var(--vscode-list-activeSelectionForeground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-close:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-close-all {
				flex: 0 0 auto;
				height: 22px;
				margin-left: 4px;
				padding: 0 8px;
				border: none;
				border-radius: 4px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 500;
				cursor: pointer;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-key-close-all:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-status {
				flex: 1 1 auto;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 500;
				text-align: right;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-status.error {
				color: var(--vscode-errorForeground);
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-host {
				flex: 1 1 auto;
				min-height: 0;
				position: relative;
				overflow: hidden;
				background: var(--vscode-terminal-background, var(--vscode-panel-background));
			}

			/*
			 * Terminal panel styles are scoped to .pane-body.integrated-terminal /
			 * .terminal-editor. The Claude pane hosts a hideFromUser instance outside
			 * those containers — without these rules xterm stays unpositioned and the
			 * pane looks blank while Claude still runs in the PTY.
			 */
			.monaco-workbench .custom-mode-ui-claude-terminal-host .terminal-wrapper {
				display: block;
				position: absolute;
				inset: 0;
				height: 100%;
				width: 100%;
				box-sizing: border-box;
				background-color: var(--vscode-terminal-background, var(--vscode-editorPane-background));
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-host .terminal-wrapper > .terminal-xterm-host {
				position: absolute;
				inset: 0;
				height: 100%;
				width: 100%;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-host .xterm {
				position: absolute;
				inset: 0;
				height: 100% !important;
				width: 100% !important;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-host .xterm-viewport {
				z-index: 30;
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-host .xterm-screen {
				z-index: 31;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-host .terminal-wrapper:not(.fixed-dims) .xterm-viewport {
				right: 14px;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-empty {
				display: flex;
				align-items: center;
				justify-content: center;
				height: 100%;
				padding: 12px 16px;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				text-align: center;
			}

			.monaco-workbench .custom-mode-ui-claude-terminal-empty.hidden {
				display: none;
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
				overflow: hidden;
				transition: flex-basis 160ms ease, width 160ms ease, min-width 160ms ease, max-width 160ms ease, opacity 120ms ease, border-color 120ms ease;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-chat-dismissed .custom-mode-ui-chat-column {
				flex: 0 0 0 !important;
				width: 0 !important;
				min-width: 0 !important;
				max-width: 0 !important;
				opacity: 0;
				overflow: hidden;
				pointer-events: none;
				border-left-color: transparent;
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

			.monaco-workbench .custom-mode-ui-chat-header-actions {
				display: inline-flex;
				align-items: center;
				gap: 2px;
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

			.monaco-workbench .custom-mode-ui-chat-header button.custom-mode-ui-chat-new .codicon {
				font-size: 14px;
			}

			.monaco-workbench .custom-mode-ui-chat-reopen {
				display: flex;
				position: absolute;
				right: 0;
				top: 50%;
				transform: translateY(-50%) translateX(4px);
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
				opacity: 0;
				pointer-events: none;
				transition: opacity 120ms ease, transform 160ms ease;
			}

			.monaco-workbench .custom-mode-ui-container.custom-mode-ui-chat-dismissed.visible .custom-mode-ui-chat-reopen {
				opacity: 1;
				pointer-events: auto;
				transform: translateY(-50%) translateX(0);
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

			.monaco-workbench .custom-mode-ui-chat-column .custom-mode-ui-actions-host {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-chat-column .custom-mode-embedded-chat.custom-mode-ui-side-chat {
				display: none !important;
			}

			.monaco-workbench .custom-mode-surface-actions {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				padding: 10px 10px 12px;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-surface-actions-empty {
				flex: 1 1 auto;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 16px 12px;
				font-size: 12px;
				line-height: 1.4;
				color: var(--vscode-descriptionForeground);
				text-align: center;
			}

			.monaco-workbench .custom-mode-surface-actions-empty.hidden,
			.monaco-workbench .custom-mode-surface-actions-list.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-actions-list {
				display: flex;
				flex-direction: column;
				gap: 6px;
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-surface-actions-section-title {
				font-size: 10px;
				font-weight: 650;
				text-transform: uppercase;
				letter-spacing: 0.04em;
				color: var(--vscode-descriptionForeground);
				margin: 4px 0 0;
			}

			.monaco-workbench .custom-mode-surface-actions-action {
				display: block;
				width: 100%;
				text-align: left;
				padding: 8px 10px;
				border-radius: 4px;
				border: 1px solid var(--vscode-panel-border);
				background: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				font-size: 12px;
				line-height: 1.35;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-actions-action:hover {
				background: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-focusBorder, var(--vscode-panel-border));
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

			/*
			 * Start-preview chrome lives in the card-rail content host (same pane as Plan).
			 * Live webview takes over that pane beside the cards (full-bleed sibling column).
			 */
			.monaco-workbench .custom-mode-ui-surface-launch-panel {
				display: none;
				flex-direction: column;
				align-items: stretch;
				justify-content: stretch;
				gap: 0;
				flex: 1 1 auto;
				width: 100%;
				min-width: 0;
				min-height: 0;
				padding: 0;
				border: 0;
				background: var(--vscode-editorBackground);
				color: var(--vscode-foreground);
				font-size: 13px;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-panel:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-surface-main-content {
				flex-direction: row;
				align-items: stretch;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-surface-setup:not(.hidden) {
				flex: 0 0 auto;
				width: auto;
				min-width: 0;
				max-width: none;
				order: 1;
				position: relative;
				z-index: 5;
				overflow: visible;
				border-right: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.24)));
				background: transparent;
			}

			/* Live preview: cards stay; content host yields to the webview column. */
			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-workspace-home-rail .custom-mode-card-rail-content {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-workspace-home-rail {
				position: relative;
				z-index: 6;
				overflow: visible;
				height: 100%;
				background: transparent;
			}

			/*
			 * Collapsed over live preview: native <webview> paints over HTML, so the Console chip
			 * needs a real layout strip — match common light app chrome so it doesn't read as a
			 * dark "padding bar" against the preview.
			 */
			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible:not(.custom-mode-ui-surface-preview-waiting) .custom-mode-ui-surface-setup:has(.custom-mode-card-rail.collapsed) {
				flex: 0 0 22px;
				width: 22px;
				min-width: 22px;
				border-right: none;
				background: #f5f5f5;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible:not(.custom-mode-ui-surface-preview-waiting) .custom-mode-card-rail.collapsed {
				display: flex;
				flex-direction: row;
				align-items: stretch;
				width: 22px;
				min-width: 22px;
				overflow: visible;
				background: #f5f5f5;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-card-rail.collapsed > .custom-mode-card-rail-reveal.has-label {
				position: relative;
				left: auto;
				top: auto;
				transform: none;
				align-self: center;
				margin: 0;
				z-index: 40;
				pointer-events: auto;
			}

			/* Waiting chrome is HTML — float the chip with no gutter so the pane stays flush. */
			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible.custom-mode-ui-surface-preview-waiting .custom-mode-ui-surface-setup:has(.custom-mode-card-rail.collapsed) {
				flex: 0 0 0;
				width: 0;
				min-width: 0;
				border-right: none;
				overflow: visible;
				background: transparent;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible.custom-mode-ui-surface-preview-waiting .custom-mode-card-rail.collapsed {
				position: absolute;
				left: 0;
				top: 0;
				bottom: 0;
				width: 0;
				min-width: 0;
				overflow: visible;
				pointer-events: none;
				background: transparent;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible.custom-mode-ui-surface-preview-waiting .custom-mode-card-rail.collapsed > .custom-mode-card-rail-reveal.has-label {
				position: absolute;
				left: 0;
				top: 50%;
				transform: translateY(-50%);
				pointer-events: auto;
			}

			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-surface-launch-panel:not(.hidden),
			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-frame,
			.monaco-workbench .custom-mode-ui-browser-shell.custom-mode-ui-surface-preview-visible .custom-mode-ui-webview {
				flex: 1 1 auto;
				width: auto;
				min-width: 0;
				min-height: 0;
				height: auto;
				align-self: stretch;
				order: 2;
				position: relative;
				z-index: 1;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-chrome {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				width: 100%;
				height: 100%;
				min-height: 0;
				margin: 0;
				border: 0;
				border-radius: 0;
				overflow: hidden;
				background: var(--vscode-editorBackground);
				box-shadow: none;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-toolbar {
				display: flex;
				align-items: center;
				gap: 8px;
				flex: 0 0 auto;
				padding: 10px 12px;
				border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.22));
				background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
			}

			.monaco-workbench .custom-mode-ui-surface-launch-dots {
				display: flex;
				gap: 5px;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-dots > span {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				background: var(--vscode-descriptionForeground);
				opacity: 0.45;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-url {
				flex: 1 1 auto;
				min-width: 0;
				padding: 6px 10px;
				border-radius: 999px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.22));
				background: var(--vscode-input-background, var(--vscode-editor-background));
				color: var(--vscode-descriptionForeground);
				font-family: var(--monaco-monospace-font, ui-monospace, monospace);
				font-size: 11px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-body {
				display: flex;
				flex-direction: column;
				align-items: flex-start;
				justify-content: center;
				gap: 10px;
				flex: 1 1 auto;
				min-height: 0;
				padding: 32px 36px;
				box-sizing: border-box;
				background:
					radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent), transparent 55%),
					var(--vscode-editorBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-launch-body > * {
				max-width: min(560px, 100%);
			}

			.monaco-workbench .custom-mode-ui-surface-launch-kicker {
				margin: 0;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.06em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-launch-title {
				margin: 0;
				font-size: 18px;
				font-weight: 650;
				line-height: 1.25;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-copy {
				margin: 0;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-command {
				width: min(560px, 100%);
				box-sizing: border-box;
				margin: 4px 0 0;
				padding: 8px 10px;
				border-radius: 8px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				background-color: var(--vscode-textCodeBlock-background);
				color: var(--vscode-editor-foreground);
				font-family: var(--monaco-monospace-font, ui-monospace, monospace);
				font-size: 11px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-top: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-run {
				flex: 0 0 auto;
				height: 32px;
				padding: 0 14px;
				border-radius: 8px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-launch-run:hover {
				background-color: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-launch-run.secondary {
				background-color: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				border-color: var(--vscode-widget-border, rgba(128, 128, 128, 0.28));
			}

			.monaco-workbench .custom-mode-ui-surface-launch-run.secondary:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle {
				display: none;
				flex: 0 0 auto;
				gap: 0;
				padding: 8px 10px 0;
				align-items: center;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle button {
				flex: 0 0 auto;
				height: 30px;
				padding: 0 16px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
				background: var(--vscode-editorWidget-background);
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				transition: background-color 0.12s ease, color 0.12s ease;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle button:hover:not(.active) {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle button:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
				z-index: 1;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle button:first-child {
				border-top-left-radius: 6px;
				border-bottom-left-radius: 6px;
				border-right: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle button:last-child {
				border-top-right-radius: 6px;
				border-bottom-right-radius: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-toggle button.active {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}

			/* Surface Console: view switcher as left 2-col card rail */
			.monaco-workbench.custom-mode-ui.custom-mode-shell-hasProject .custom-mode-ui-browser-shell.custom-mode-ui-surface-view-cards {
				flex-direction: row;
				align-items: stretch;
			}

			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle:not(.hidden) {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 8px;
				align-content: start;
				align-self: stretch;
				flex: 0 0 220px;
				width: 220px;
				max-width: 220px;
				padding: 12px;
				border-right: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
				background: var(--vscode-sideBar-background);
				overflow-x: hidden;
				overflow-y: auto;
			}

			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle button {
				display: flex;
				flex-direction: column;
				align-items: flex-start;
				justify-content: center;
				gap: 4px;
				height: auto;
				min-height: 56px;
				width: 100%;
				padding: 10px 12px;
				border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.24)));
				border-radius: 7px;
				background: var(--vscode-editorWidget-background);
				color: var(--vscode-foreground);
				text-align: left;
			}

			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle button:first-child,
			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle button:last-child {
				border-radius: 7px;
				border-right: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.24)));
			}

			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle button:hover:not(.active) {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle button.active {
				background: var(--vscode-button-background);
				border-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-card-key {
				font: 700 10px/1.3 var(--vscode-font-family);
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-browser-shell > .custom-mode-ui-surface-main-view-toggle button.active .custom-mode-ui-surface-main-view-card-key {
				color: inherit;
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-ui-surface-main-view-card-value {
				font-size: 12px;
				font-weight: 600;
				line-height: 1.25;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				max-width: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-main-content {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-width: 0;
				min-height: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-plan-panel,
			.monaco-workbench .custom-mode-ui-surface-claude-md-panel,
			.monaco-workbench .custom-mode-ui-surface-ix-subsystems-panel,
			.monaco-workbench .custom-mode-ui-surface-custom-views {
				display: none;
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-plan-panel:not(.hidden),
			.monaco-workbench .custom-mode-ui-surface-claude-md-panel:not(.hidden),
			.monaco-workbench .custom-mode-ui-surface-ix-subsystems-panel:not(.hidden),
			.monaco-workbench .custom-mode-ui-surface-custom-views:not(.hidden) {
				display: flex;
				flex-direction: column;
			}

			.monaco-workbench .custom-mode-ui-surface-custom-view {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-ui-surface-custom-view.hidden {
				display: none;
			}

			/* Padding comes from the shared card rail content host the panel renders in. */
			.monaco-workbench .custom-mode-surface-plan {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
				box-sizing: border-box;
				padding: 0;
				gap: 12px;
				width: 100%;
			}

			.monaco-workbench .custom-mode-surface-plan-header {
				display: flex;
				flex-direction: column;
				gap: 4px;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-surface-plan-header-top {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-surface-plan-title {
				font-size: 14px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-surface-plan-path {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				font-family: var(--monaco-monospace-font, monospace);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-surface-plan-status {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-plan-status-tracker {
				flex: 0 0 auto;
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 8px;
				padding: 10px 12px;
				border: 1px solid var(--vscode-editorWidget-border);
				border-radius: 8px;
				background: var(--vscode-editorWidget-background);
				min-width: 0;
			}

			.monaco-workbench .custom-mode-surface-plan-status-scroll {
				flex: 0 0 auto;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 26px;
				height: 26px;
				padding: 0;
				border: 1px solid var(--vscode-button-border, transparent);
				border-radius: 6px;
				background: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-plan-status-scroll:hover:not(:disabled) {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-plan-status-scroll:disabled {
				opacity: 0.35;
				cursor: default;
			}

			.monaco-workbench .custom-mode-surface-plan-status-scroll .codicon {
				font-size: 14px;
			}

			.monaco-workbench .custom-mode-surface-plan-status-rail {
				display: flex;
				flex-direction: row;
				align-items: stretch;
				gap: 0;
				flex: 1 1 auto;
				min-width: 0;
				overflow-x: auto;
				overflow-y: hidden;
				/* No scroll-snap — it fights macOS trackpad horizontal scrolling. */
				overscroll-behavior-x: contain;
				/* Allow both axes so vertical trackpad gestures still reach our wheel handler. */
				touch-action: pan-x pan-y;
				/* Thin scrollbar so horizontal scrolling is discoverable (was fully hidden). */
				scrollbar-width: thin;
				scrollbar-color: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 80%, transparent) transparent;
				padding: 2px 0 4px;
			}

			.monaco-workbench .custom-mode-surface-plan-status-rail::-webkit-scrollbar {
				height: 6px;
			}

			.monaco-workbench .custom-mode-surface-plan-status-rail::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 3px;
			}

			.monaco-workbench .custom-mode-surface-plan-status-rail::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-plan-status-rail::-webkit-scrollbar-track {
				background: transparent;
			}

			.monaco-workbench .custom-mode-surface-plan-status-step {
				position: relative;
				display: flex;
				flex-direction: column;
				justify-content: center;
				gap: 4px;
				flex: 0 0 auto;
				width: min(200px, 42vw);
				min-width: 148px;
				max-width: 220px;
				padding: 4px 18px 4px 8px;
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.linked-surface {
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.linked-surface:hover {
				background: color-mix(in srgb, var(--vscode-focusBorder) 8%, transparent);
				border-radius: 6px;
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.has-next-action {
				width: min(280px, 56vw);
				min-width: 200px;
				max-width: 300px;
				padding: 6px 18px 8px 10px;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.current .custom-mode-surface-plan-status-value {
				color: var(--vscode-foreground);
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.completed .custom-mode-surface-plan-status-value {
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.pending .custom-mode-surface-plan-status-value {
				color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.current {
				border-radius: 6px;
				background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
			}

			.monaco-workbench .custom-mode-surface-plan-status-connector {
				position: absolute;
				top: 50%;
				right: 4px;
				width: 10px;
				height: 1px;
				background: var(--vscode-editorWidget-border);
				transform: translateY(-50%);
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-surface-plan-status-label {
				font: 700 10px/1.3 var(--vscode-font-family);
				letter-spacing: .04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-plan-status-step.current .custom-mode-surface-plan-status-label {
				color: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
			}

			.monaco-workbench .custom-mode-surface-plan-status-value {
				font-size: 12px;
				line-height: 1.35;
				color: var(--vscode-descriptionForeground);
				overflow: hidden;
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
			}

			.monaco-workbench .custom-mode-surface-plan-status-next-action {
				flex: 0 0 auto;
				align-self: flex-start;
				height: 24px;
				margin-top: 2px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-size: 11px;
				font-weight: 600;
				cursor: pointer;
				max-width: 100%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			/* Parked on the tracker shell only when there is no current-step host. */
			.monaco-workbench .custom-mode-surface-plan-status-tracker > .custom-mode-surface-plan-status-next-action {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-plan-status-next-action.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-plan-status-next-action:disabled {
				opacity: 0.55;
				cursor: default;
			}

			.monaco-workbench .custom-mode-surface-plan-status-in-flight {
				flex: 0 0 auto;
				align-self: flex-start;
				margin-top: 2px;
				padding: 2px 8px;
				border-radius: 6px;
				border: 1px solid var(--vscode-editorWidget-border);
				background: color-mix(in srgb, var(--vscode-badge-background) 40%, transparent);
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 600;
				max-width: 100%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-surface-plan-references {
				flex: 0 0 auto;
				padding: 10px 12px;
				border: 1px solid var(--vscode-editorWidget-border);
				border-radius: 8px;
				background: var(--vscode-editorWidget-background);
			}

			.monaco-workbench .custom-mode-surface-plan-references.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-plan-references-inner {
				display: flex;
				flex-direction: column;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-surface-plan-references-heading {
				font-size: 12px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-surface-plan-references-hint {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				line-height: 1.35;
			}

			.monaco-workbench .custom-mode-surface-plan-references-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-surface-plan-references-chip {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				height: 26px;
				padding: 0 10px;
				border-radius: 999px;
				border: 1px solid var(--vscode-editorWidget-border);
				background: transparent;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-plan-references-chip:disabled {
				cursor: default;
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-surface-plan-references-chip:not(:disabled):hover {
				color: var(--vscode-foreground);
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-plan-references-chip.selected {
				color: var(--vscode-foreground);
				border-color: var(--vscode-focusBorder, var(--vscode-editorWidget-border));
				background: color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 16%, transparent);
			}

			.monaco-workbench .custom-mode-surface-plan-references-chip-badge {
				font-size: 9px;
				font-weight: 700;
				letter-spacing: 0.02em;
				text-transform: uppercase;
				opacity: 0.8;
			}

			.monaco-workbench .custom-mode-surface-plan-references-chip-meta {
				font-size: 10px;
				font-weight: 500;
				opacity: 0.75;
			}

			.monaco-workbench .custom-mode-surface-plan-references-actions {
				display: flex;
				justify-content: flex-end;
			}

			.monaco-workbench .custom-mode-surface-plan-references-confirm {
				height: 26px;
				padding: 0 12px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-size: 11px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-plan-references-confirm:hover:not(:disabled) {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-plan-references-confirm:disabled {
				opacity: 0.5;
				cursor: default;
			}

			.monaco-workbench .custom-mode-surface-plan-refresh {
				flex: 0 0 auto;
				padding: 4px 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				cursor: pointer;
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-surface-plan-body {
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
				padding-right: 4px;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-host {
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-host.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-plan-tree-anchor {
				flex: 1 1 auto;
				min-height: 0;
				position: relative;
			}

			.monaco-workbench .custom-mode-surface-plan-tree-anchor.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-plan-empty {
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 32px 16px;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				text-align: center;
			}

			.monaco-workbench .custom-mode-surface-plan-compose {
				display: flex;
				flex-direction: column;
				align-items: stretch;
				justify-content: center;
				gap: 12px;
				max-width: 560px;
				margin: 24px auto 12px;
				padding: 8px 16px 16px;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-heading {
				font-size: 22px;
				font-weight: 600;
				letter-spacing: -0.02em;
				color: var(--vscode-foreground);
				text-align: center;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-hint {
				font-size: 12px;
				line-height: 1.45;
				color: var(--vscode-descriptionForeground);
				text-align: center;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-input {
				width: 100%;
				min-height: 96px;
				resize: vertical;
				box-sizing: border-box;
				padding: 12px 14px;
				border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
				border-radius: 8px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-family: inherit;
				font-size: 13px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-input:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-actions {
				display: flex;
				justify-content: flex-end;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-submit {
				appearance: none;
				border: 1px solid var(--vscode-button-border, transparent);
				border-radius: 6px;
				padding: 8px 14px;
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-plan-compose-submit:hover:not(:disabled) {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-plan-compose-submit:disabled {
				opacity: 0.55;
				cursor: default;
			}

			.monaco-workbench .custom-mode-surface-plan-markdown {
				font-size: 13px;
				line-height: 1.55;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-surface-plan-markdown h1,
			.monaco-workbench .custom-mode-surface-plan-markdown h2,
			.monaco-workbench .custom-mode-surface-plan-markdown h3 {
				margin: 1.1em 0 0.45em;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-surface-plan-markdown h1 { font-size: 1.35em; }
			.monaco-workbench .custom-mode-surface-plan-markdown h2 { font-size: 1.2em; }
			.monaco-workbench .custom-mode-surface-plan-markdown h3 { font-size: 1.05em; }

			.monaco-workbench .custom-mode-surface-plan-markdown p,
			.monaco-workbench .custom-mode-surface-plan-markdown ul,
			.monaco-workbench .custom-mode-surface-plan-markdown ol,
			.monaco-workbench .custom-mode-surface-plan-markdown table {
				margin: 0.55em 0;
			}

			.monaco-workbench .custom-mode-surface-plan-markdown code {
				font-family: var(--monaco-monospace-font, monospace);
				font-size: 0.92em;
			}

			.monaco-workbench .custom-mode-surface-plan-markdown pre {
				padding: 10px 12px;
				overflow: auto;
				border-radius: 8px;
				background: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-surface-task-tree {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
				padding: 16px 18px;
				gap: 12px;
				width: 100%;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
				padding: 16px 18px;
				gap: 10px;
				width: 100%;
				height: 100%;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-header {
				display: flex;
				flex-direction: column;
				gap: 4px;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-header-top {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-title {
				font-size: 14px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-path {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				font-family: var(--monaco-monospace-font, monospace);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-status {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-refresh {
				flex: 0 0 auto;
				padding: 4px 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				cursor: pointer;
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-body {
				position: relative;
				flex: 1 1 auto;
				min-height: 240px;
				overflow: hidden;
				border-radius: 8px;
				border: 1px solid var(--vscode-panel-border);
				background: var(--vscode-editor-background);
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-anchor {
				position: absolute;
				inset: 0;
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-empty {
				position: absolute;
				inset: 0;
				z-index: 2;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 32px 16px;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				text-align: center;
				background: var(--vscode-editor-background);
			}

			.monaco-workbench .custom-mode-surface-proposal-graph-empty.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-task-tree-header {
				display: flex;
				flex-direction: column;
				gap: 8px;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-surface-task-tree-empty {
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 32px 16px;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-status {
				align-self: flex-start;
				display: inline-flex;
				align-items: center;
				padding: 2px 10px;
				border-radius: 999px;
				border: 1px solid var(--vscode-panel-border);
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.monaco-workbench .custom-mode-surface-task-tree-status[data-tree-status="active"] {
				border-color: var(--vscode-textLink-foreground);
				color: var(--vscode-textLink-foreground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-status[data-tree-status="complete"] {
				border-color: var(--vscode-testing-iconPassed);
				color: var(--vscode-testing-iconPassed);
			}

			.monaco-workbench .custom-mode-surface-task-tree-status[data-tree-status="failed"] {
				border-color: var(--vscode-errorForeground);
				color: var(--vscode-errorForeground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-progress {
				position: relative;
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-surface-task-tree-progress::before {
				content: '';
				position: absolute;
				top: 0;
				left: 0;
				right: 0;
				height: 6px;
				border-radius: 999px;
				background: color-mix(in srgb, var(--vscode-progressBar-background, var(--vscode-button-background)) 18%, transparent);
			}

			.monaco-workbench .custom-mode-surface-task-tree-progress-bar {
				position: relative;
				height: 6px;
				border-radius: 999px;
				background: var(--vscode-progressBar-background, var(--vscode-button-background));
				width: 0%;
				transition: width 0.25s ease;
			}

			.monaco-workbench .custom-mode-surface-task-tree-progress-label {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-list {
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				border-radius: 8px;
				padding: 6px 0;
				background: var(--vscode-editorWidget-background);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node {
				display: flex;
				flex-wrap: wrap;
				align-items: flex-start;
				gap: 8px;
				padding: 7px 12px;
				font-size: 12px;
				line-height: 1.5;
				border-left: 2px solid transparent;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-root {
				margin-top: 6px;
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-root:first-child {
				margin-top: 0;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-root > .custom-mode-surface-task-tree-node-title {
				font-size: 13px;
				font-weight: 700;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-current {
				background: var(--vscode-list-activeSelectionBackground);
				color: var(--vscode-list-activeSelectionForeground);
				border-left-color: var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-icon {
				flex: 0 0 auto;
				width: 16px;
				margin-top: 1px;
				font-size: 14px;
				text-align: center;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-icon[data-node-status="complete"] {
				color: var(--vscode-testing-iconPassed);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-icon[data-node-status="in_progress"] {
				color: var(--vscode-textLink-foreground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-icon[data-node-status="blocked"] {
				color: var(--vscode-editorWarning-foreground, #cca700);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-icon[data-node-status="failed"] {
				color: var(--vscode-errorForeground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-title {
				flex: 1 1 auto;
				min-width: 0;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-detail {
				flex: 1 1 100%;
				padding-left: 24px;
				font-size: 11px;
				line-height: 1.55;
				color: var(--vscode-descriptionForeground);
				overflow-wrap: anywhere;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-current .custom-mode-surface-task-tree-node-detail {
				color: inherit;
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-surface-task-tree-detail-toggle {
				display: inline;
				margin-left: 6px;
				padding: 0;
				border: 0;
				background: transparent;
				color: var(--vscode-textLink-foreground);
				font-size: 11px;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-surface-task-tree-detail-toggle:hover {
				text-decoration: underline;
			}

			.monaco-workbench .custom-mode-surface-task-tree-detail-toggle:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 1px;
			}

			.monaco-workbench .custom-mode-surface-task-tree-node-actions {
				flex: 1 1 100%;
				display: flex;
				gap: 6px;
				padding-left: 24px;
			}

			.monaco-workbench .custom-mode-surface-task-tree-message {
				flex: 0 0 auto;
				padding: 6px 10px;
				border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground, #cca700));
				border-radius: 6px;
				background: var(--vscode-inputValidation-warningBackground, transparent);
				color: var(--vscode-foreground);
				font-size: 11px;
				line-height: 1.5;
			}

			.monaco-workbench .custom-mode-surface-task-tree-message.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-surface-task-tree-controls {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				flex: 0 0 auto;
				padding-top: 2px;
			}

			.monaco-workbench .custom-mode-surface-task-tree-control,
			.monaco-workbench .custom-mode-surface-task-tree-inline-action {
				height: 28px;
				padding: 0 12px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				transition: background-color 0.12s ease;
			}

			.monaco-workbench .custom-mode-surface-task-tree-control:hover:not(:disabled),
			.monaco-workbench .custom-mode-surface-task-tree-inline-action:hover:not(:disabled) {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-surface-task-tree-control:focus-visible,
			.monaco-workbench .custom-mode-surface-task-tree-inline-action:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}

			.monaco-workbench .custom-mode-surface-task-tree-control-primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-control-primary:hover:not(:disabled) {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-surface-task-tree-control:disabled,
			.monaco-workbench .custom-mode-surface-task-tree-inline-action:disabled {
				opacity: 0.5;
				cursor: default;
			}

			/* Live Preview webview sits beside the rail only while Preview is selected. */
			.monaco-workbench .custom-mode-ui-browser-shell:not(.custom-mode-ui-surface-preview-visible) > .custom-mode-ui-surface-main-content > .custom-mode-ui-frame,
			.monaco-workbench .custom-mode-ui-browser-shell:not(.custom-mode-ui-surface-preview-visible) > .custom-mode-ui-surface-main-content > .custom-mode-ui-webview {
				display: none !important;
			}

			.monaco-workbench .custom-mode-setup.custom-mode-setup-hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-setup {
				display: none;
				flex: 1 1 auto;
				min-height: 0;
				padding: 0;
				background: var(--vscode-editorBackground);
				color: var(--vscode-foreground);
				overflow: hidden;
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
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-setup-main {
				min-width: 0;
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-context-item.handoff-active {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-list-hoverBackground);
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

			.monaco-workbench .custom-mode-ui-surface-starter-card.generated:not(.has-preview) .custom-mode-ui-surface-starter-card-preview-shell {
				opacity: 0.6;
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

			.monaco-workbench .custom-mode-ui-surface-business-context {
				display: flex;
				flex-direction: column;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-business-context.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-home-panel.hidden {
				display: none;
			}

			/* Content-sized in the stacked Console list (host scrolls), same as Surface .section. */
			.monaco-workbench .custom-mode-ui-workspace-claude-md-panel {
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-ui-workspace-claude-md-body {
				min-height: 220px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
				border-radius: 8px;
				overflow: hidden;
				background: var(--vscode-editorWidget-background);
			}

			.monaco-workbench .custom-mode-ui-workspace-home-toggle {
				padding: 0;
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
				display: flex;
				flex-direction: column;
				gap: 12px;
				padding-top: 24px;
				padding-bottom: 16px;
			}

			.monaco-workbench .custom-mode-ui-surface-surfaces-title {
				color: var(--vscode-foreground);
				font-size: 15px;
				font-weight: 650;
				line-height: 1.3;
			}

			.monaco-workbench .custom-mode-ui-surface-surfaces-body {
				display: flex;
				flex-direction: column;
				gap: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-header-actions {
				display: flex;
				align-items: center;
				justify-content: flex-end;
				gap: 8px;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-header .custom-mode-ui-surface-surfaces-title {
				flex: 1 1 auto;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-starters-subtitle {
				flex: 1 1 auto;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-start-all-surfaces {
				flex: 0 0 auto;
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

			.monaco-workbench .custom-mode-start-all-surfaces:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 2px;
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
				gap: 16px;
			}

			.monaco-workbench .custom-mode-ui-surface-create-host > .custom-mode-ui-surface-starter-grid.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan {
				display: flex;
				flex-direction: column;
				gap: 10px;
				margin: 0 0 16px;
				padding: 14px 16px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 10px;
				background: var(--vscode-editorWidget-background);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-title {
				font-size: 13px;
				font-weight: 650;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-hint {
				font-size: 11px;
				line-height: 1.4;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-intent {
				width: 100%;
				min-height: 72px;
				resize: vertical;
				padding: 8px 10px;
				border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
				border-radius: 6px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-family: inherit;
				font-size: 12px;
				line-height: 1.4;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan.dragover {
				border-color: var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-footer {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-attachments {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
				flex: 1 1 auto;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-actions {
				display: flex;
				align-items: center;
				gap: 8px;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-submit {
				height: 28px;
				padding: 0 12px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-submit:hover:not(:disabled) {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-submit:disabled {
				opacity: 0.55;
				cursor: default;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-submit.is-complete {
				opacity: 0.85;
				background: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 22%, var(--vscode-button-background));
				border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 45%, transparent);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history {
				margin: 0;
				border-top: 1px solid var(--vscode-panel-border);
				padding-top: 8px;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history > summary {
				cursor: pointer;
				list-style: none;
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
				user-select: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history > summary::-webkit-details-marker {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history > summary::before {
				content: '▸';
				display: inline-block;
				width: 1em;
				margin-right: 4px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history[open] > summary::before {
				content: '▾';
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history-count {
				margin-left: 6px;
				font-weight: 500;
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history-body {
				display: flex;
				flex-direction: column;
				gap: 4px;
				margin-top: 8px;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-history-empty {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-run {
				display: block;
				width: 100%;
				text-align: left;
				padding: 6px 8px;
				border: 1px solid transparent;
				border-radius: 6px;
				background: transparent;
				color: var(--vscode-foreground);
				font-size: 11px;
				line-height: 1.35;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-run:hover {
				background: var(--vscode-list-hoverBackground);
				border-color: var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-workspace-plan-analysis-run.is-live {
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator {
				display: flex;
				flex-direction: column;
				gap: 8px;
				margin: 4px 0 2px;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-title {
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-hint {
				opacity: 0.8;
				font-size: 0.92em;
				line-height: 1.35;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-options {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-option {
				display: flex;
				align-items: flex-start;
				gap: 8px;
				flex: 1 1 160px;
				min-width: 140px;
				padding: 8px 10px;
				border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
				border-radius: 6px;
				cursor: pointer;
				background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-foreground));
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-option:has(input:checked) {
				border-color: var(--vscode-focusBorder);
				background: color-mix(in srgb, var(--vscode-focusBorder) 12%, var(--vscode-editor-background));
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-option input {
				margin-top: 2px;
				flex-shrink: 0;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-option-copy {
				display: flex;
				flex-direction: column;
				gap: 2px;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-option-label {
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-agent-orchestrator-option-hint {
				opacity: 0.8;
				font-size: 0.88em;
				line-height: 1.3;
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-row {
				display: flex;
				flex-wrap: wrap;
				align-items: flex-start;
				justify-content: space-between;
				gap: 10px;
				margin-top: 10px;
				padding: 10px;
				border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
				border-radius: 6px;
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-copy {
				display: flex;
				flex-direction: column;
				gap: 4px;
				min-width: 0;
				flex: 1 1 220px;
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-label {
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-hint {
				opacity: 0.8;
				font-size: 0.88em;
				line-height: 1.35;
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-status {
				font-size: 0.88em;
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-status.is-set {
				color: var(--vscode-testing-iconPassed, #73c991);
			}

			.monaco-workbench .custom-mode-ui-anthropic-key-btn {
				height: 28px;
				padding: 0 12px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				flex: 0 0 auto;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-body {
				display: flex;
				flex-direction: column;
				gap: 16px;
				padding: 4px 0 12px;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-section {
				display: flex;
				flex-direction: column;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-section-title {
				font-size: 13px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-p {
				margin: 0;
				opacity: 0.9;
				font-size: 12px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-list {
				margin: 0;
				padding-left: 18px;
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-li {
				font-size: 12px;
				line-height: 1.45;
				opacity: 0.9;
			}

			.monaco-workbench .custom-mode-ui-how-it-works-pre {
				margin: 0;
				padding: 10px 12px;
				font-size: 11px;
				line-height: 1.4;
				opacity: 0.9;
				white-space: pre;
				overflow-x: auto;
				border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
				border-radius: 6px;
				background: var(--vscode-textCodeBlock-background, transparent);
				font-family: var(--monaco-monospace-font, monospace);
			}

			.monaco-workbench .custom-mode-ui-docker-status-body {
				display: flex;
				flex-direction: column;
				gap: 16px;
				padding: 4px 0 12px;
			}

			.monaco-workbench .custom-mode-ui-docker-status-badge {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				font-size: 13px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-docker-status-dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex: 0 0 auto;
				background: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-docker-status-dot[data-status="available"] {
				background: var(--vscode-testing-iconPassed, #3fb950);
			}

			.monaco-workbench .custom-mode-ui-docker-status-dot[data-status="missing"],
			.monaco-workbench .custom-mode-ui-docker-status-dot[data-status="mcpToolkitMissing"] {
				background: var(--vscode-inputValidation-warningForeground, #d29922);
			}

			.monaco-workbench .custom-mode-ui-docker-status-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-console-home {
				display: flex;
				flex-direction: column;
				gap: 12px;
				flex: 1 1 auto;
				min-height: 0;
				min-width: 0;
				/* Match Surface plan: pin steps, scroll section content below. */
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-console-home.hidden {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-console-home-status {
				flex: 0 0 auto;
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-console-home-status.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-console-section-host {
				display: flex;
				flex-direction: column;
				flex: 1 1 auto;
				min-height: 0;
				min-width: 0;
				/* Same role as Surface proposal-tree .sections — scroll all card content. */
				overflow: auto;
				padding-right: 4px;
			}

			/* First-run: the goal composer leads; the section stack waits until planning starts. */
			.monaco-workbench .custom-mode-ui-console-home.custom-mode-first-run .custom-mode-ui-console-section-host,
			.monaco-workbench .custom-mode-ui-console-home.custom-mode-first-run .custom-mode-ui-console-home-status {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-first-run {
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
				display: flex;
				flex-direction: column;
				align-items: center;
				padding: 40px 24px 32px;
			}

			.monaco-workbench .custom-mode-ui-first-run.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-first-run-head {
				text-align: center;
				max-width: 560px;
				margin-bottom: 20px;
			}

			.monaco-workbench .custom-mode-ui-first-run-title {
				font-size: 22px;
				font-weight: 600;
				margin-bottom: 6px;
			}

			.monaco-workbench .custom-mode-ui-first-run-sub {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-first-run-composer {
				width: 100%;
				max-width: 680px;
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 10px;
				padding: 12px;
				box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
				transition: border-color 0.15s ease, box-shadow 0.15s ease;
			}

			.monaco-workbench .custom-mode-ui-first-run-composer.flash {
				border-color: var(--vscode-focusBorder);
				box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
			}

			.monaco-workbench .custom-mode-ui-first-run-brief {
				width: 100%;
				min-height: 84px;
				resize: vertical;
				border: none;
				outline: none;
				background: transparent;
				color: var(--vscode-input-foreground, inherit);
				font-family: inherit;
				font-size: 13px;
				line-height: 1.55;
				padding: 4px;
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-ui-first-run-brief::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.monaco-workbench .custom-mode-ui-first-run-composer-foot {
				display: flex;
				align-items: center;
				gap: 8px;
				border-top: 1px solid var(--vscode-panel-border);
				padding-top: 10px;
				margin-top: 6px;
			}

			.monaco-workbench .custom-mode-ui-first-run-attach {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				background: none;
				border: none;
				border-radius: 6px;
				padding: 4px 8px;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-first-run-attach:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: inherit;
			}

			.monaco-workbench .custom-mode-ui-first-run-attach-note {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				margin-right: auto;
			}

			.monaco-workbench .custom-mode-ui-first-run-submit {
				margin-left: auto;
				height: 28px;
				padding: 0 16px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-first-run-submit:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-first-run-alt {
				margin-top: 10px;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				display: flex;
				align-items: baseline;
				gap: 4px;
			}

			.monaco-workbench .custom-mode-ui-first-run-import {
				background: none;
				border: none;
				padding: 0;
				font-size: 12px;
				color: var(--vscode-textLink-foreground);
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-first-run-import:hover {
				text-decoration: underline;
			}

			.monaco-workbench .custom-mode-ui-first-run-gallery {
				width: 100%;
				max-width: 680px;
				margin-top: 36px;
			}

			.monaco-workbench .custom-mode-ui-first-run-gallery-head {
				display: flex;
				align-items: baseline;
				gap: 8px;
				margin-bottom: 10px;
			}

			.monaco-workbench .custom-mode-ui-first-run-gallery-title {
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-first-run-gallery-hint {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-first-run-cards {
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
				gap: 10px;
			}

			.monaco-workbench .custom-mode-ui-first-run-card {
				display: flex;
				flex-direction: column;
				gap: 6px;
				text-align: left;
				background: none;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 10px;
				padding: 12px;
				color: inherit;
				font-family: inherit;
				cursor: pointer;
				transition: border-color 0.12s ease, background-color 0.12s ease;
			}

			.monaco-workbench .custom-mode-ui-first-run-card:hover {
				background: var(--vscode-editor-background);
				border-color: var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-ui-first-run-card:focus-visible {
				outline: 2px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}

			.monaco-workbench .custom-mode-ui-first-run-card-title {
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-first-run-card-goal {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-first-run-card-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 4px;
				margin-top: 2px;
			}

			.monaco-workbench .custom-mode-ui-first-run-chip {
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 999px;
				padding: 1px 8px;
			}

			@media (prefers-reduced-motion: reduce) {
				.monaco-workbench .custom-mode-ui-first-run-composer,
				.monaco-workbench .custom-mode-ui-first-run-card {
					transition: none;
				}
			}

			/* Docker preflight pill — quiet status at the end of the journey strip. */
			.monaco-workbench .custom-mode-console-preflight {
				flex: 0 0 auto;
				display: inline-flex;
				align-items: center;
				gap: 6px;
				margin-left: 12px;
				padding: 3px 10px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 999px;
				background: none;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-family: inherit;
				white-space: nowrap;
				cursor: default;
			}

			.monaco-workbench .custom-mode-console-preflight.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-console-preflight .custom-mode-console-preflight-glyph {
				color: var(--vscode-charts-green);
			}

			.monaco-workbench .custom-mode-console-preflight.blocked {
				cursor: pointer;
				color: inherit;
				border-color: var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-console-preflight.blocked .custom-mode-console-preflight-glyph {
				color: var(--vscode-charts-yellow);
			}

			.monaco-workbench .custom-mode-console-preflight.blocked:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			/* Match Surface proposal-tree .section card chrome (exclusive <details> accordion). */
			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel {
				margin: 0;
				scroll-margin-top: 16px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 7px;
				overflow: hidden;
				background: var(--vscode-editor-background);
				gap: 0;
			}

			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel + .custom-mode-ui-workspace-home-panel {
				margin-top: 12px;
			}

			/* Babadaba stage — the workspace presence band above the Surfaces section.
			 * Same chrome as its sibling section panels; the character canvas fills it. */
			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-babadaba-stage {
				position: relative;
				flex: 0 0 auto;
				height: 208px;
				margin: 0 0 12px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 7px;
				overflow: hidden;
				background:
					radial-gradient(120% 90% at 62% 88%, color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 5%, transparent), transparent 55%),
					var(--vscode-editor-background);
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage.hidden {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage > canvas {
				position: absolute;
				inset: 0;
				width: 100%;
				height: 100%;
				display: block;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-copy {
				position: absolute;
				left: 16px;
				top: 12px;
				max-width: 30%;
				pointer-events: none;
				z-index: 1;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-wordmark {
				font-size: 13px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-step {
				margin-top: 2px;
				font-size: 11px;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-step.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-status {
				margin-top: 1px;
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-nodes {
				position: absolute;
				inset: 0;
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node {
				position: absolute;
				transform: translate(-50%, -50%);
				display: flex;
				align-items: center;
				gap: 5px;
				max-width: 180px;
				padding: 3px 9px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				background: var(--vscode-editor-background);
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 16px;
				white-space: nowrap;
				pointer-events: auto;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-far {
				transform: translate(-50%, -50%) scale(0.92);
				opacity: 0.75;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-passive {
				cursor: default;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node:not(.is-passive):hover {
				color: var(--vscode-foreground);
				background: var(--vscode-toolbar-hoverBackground, var(--vscode-editor-background));
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 1px;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node-label {
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node-dot {
				flex: 0 0 auto;
				width: 5px;
				height: 5px;
				border-radius: 999px;
				background: var(--vscode-descriptionForeground);
				opacity: 0.45;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-active {
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-active .custom-mode-ui-babadaba-stage-node-dot {
				background: var(--vscode-testing-iconPassed, #73c991);
				opacity: 1;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-building {
				color: var(--vscode-foreground);
				border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 45%, var(--vscode-panel-border));
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-building .custom-mode-ui-babadaba-stage-node-dot {
				background: var(--vscode-testing-iconPassed, #73c991);
				opacity: 1;
				animation: custom-mode-babadaba-node-pulse 1.6s ease-in-out infinite;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-attention .custom-mode-ui-babadaba-stage-node-dot {
				background: var(--vscode-editorWarning-foreground, #cca700);
				opacity: 1;
			}

			.monaco-workbench .custom-mode-ui-babadaba-stage-node.has-progress::after {
				content: '';
				position: absolute;
				left: 8px;
				right: 8px;
				bottom: 1px;
				height: 2px;
				border-radius: 2px;
				background: linear-gradient(
					to right,
					var(--vscode-testing-iconPassed, #73c991) var(--babadaba-node-progress, 0%),
					transparent var(--babadaba-node-progress, 0%)
				);
				opacity: 0.7;
			}

			@keyframes custom-mode-babadaba-node-pulse {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.35; }
			}

			@media (prefers-reduced-motion: reduce) {
				.monaco-workbench .custom-mode-ui-babadaba-stage-node.is-building .custom-mode-ui-babadaba-stage-node-dot {
					animation: none;
				}
			}

			.monaco-workbench.reduce-motion .custom-mode-ui-babadaba-stage-node.is-building .custom-mode-ui-babadaba-stage-node-dot {
				animation: none;
			}

			/* Babadaba workspace-manager block in the Console Steps panel. */
			.monaco-workbench .custom-mode-babadaba-steps {
				display: flex;
				flex-direction: column;
				gap: 6px;
				flex: 0 0 auto;
				min-width: 180px;
				max-width: 240px;
				padding: 6px 8px 6px 10px;
				border-right: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.28));
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-babadaba-steps.hidden {
				display: none !important;
			}

			.monaco-workbench .custom-mode-babadaba-steps-parent {
				font-size: 11px;
				font-weight: 600;
				color: var(--vscode-foreground);
				letter-spacing: 0.02em;
			}

			.monaco-workbench .custom-mode-babadaba-steps-parent-detail {
				font-weight: 400;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-babadaba-steps-children {
				display: flex;
				flex-direction: column;
				gap: 2px;
				max-height: 88px;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child {
				display: flex;
				align-items: center;
				gap: 6px;
				width: 100%;
				padding: 3px 6px;
				border: 0;
				border-radius: 4px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 16px;
				text-align: left;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child.is-passive {
				cursor: default;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child:not(.is-passive):hover,
			.monaco-workbench .custom-mode-babadaba-steps-child:not(.is-passive):focus-visible {
				color: var(--vscode-foreground);
				background: var(--vscode-list-hoverBackground);
				outline: none;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child-dot {
				flex: 0 0 auto;
				width: 5px;
				height: 5px;
				border-radius: 999px;
				background: var(--vscode-descriptionForeground);
				opacity: 0.45;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child.is-active {
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-babadaba-steps-child.is-active .custom-mode-babadaba-steps-child-dot {
				background: var(--vscode-testing-iconPassed, #73c991);
				opacity: 1;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child.is-building .custom-mode-babadaba-steps-child-dot {
				background: var(--vscode-testing-iconPassed, #73c991);
				opacity: 1;
				animation: custom-mode-babadaba-node-pulse 1.6s ease-in-out infinite;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child.is-attention .custom-mode-babadaba-steps-child-dot {
				background: var(--vscode-editorWarning-foreground, #cca700);
				opacity: 1;
			}

			.monaco-workbench .custom-mode-babadaba-steps-child-label {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel > summary.custom-mode-ui-surface-starters-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				padding: 10px 12px;
				font-weight: 600;
				cursor: pointer;
				user-select: none;
				list-style: none;
				background: var(--vscode-sideBar-background);
				border-bottom: 1px solid transparent;
			}

			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel > summary.custom-mode-ui-surface-starters-header::-webkit-details-marker {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel[open] > summary.custom-mode-ui-surface-starters-header {
				border-bottom-color: var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-console-section-host .custom-mode-ui-surface-starters-header .custom-mode-ui-surface-surfaces-title {
				font-size: 13px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel > .custom-mode-ui-surface-starters-body {
				display: flex;
				flex-direction: column;
				gap: 0;
				padding: 12px 14px;
			}

			/* Author display:flex must not override UA hiding of closed <details> bodies
			 * (otherwise Plan form stays visible while Surfaces is the selected rail card). */
			.monaco-workbench .custom-mode-ui-console-section-host > .custom-mode-ui-workspace-home-panel:not([open]) > .custom-mode-ui-surface-starters-body {
				display: none !important;
			}

			.monaco-workbench .custom-mode-ui-console-description-regen {
				appearance: none;
				border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
				border-radius: 4px;
				padding: 4px 10px;
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				color: var(--vscode-button-foreground);
				background: var(--vscode-button-background);
			}

			.monaco-workbench .custom-mode-ui-console-description-regen:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-console-description-body {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-console-description-label {
				margin: 0;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-console-description-text {
				margin: 0;
				font-size: 13px;
				line-height: 1.45;
				white-space: pre-wrap;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-console-description-empty {
				margin: 0;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-console-section-host .custom-mode-ui-workspace-surfaces,
			.monaco-workbench .custom-mode-ui-console-section-host .custom-mode-ui-workspace-suggested {
				margin: 0;
			}

			/* Inner compose strip sits inside the section body — drop the nested card chrome. */
			.monaco-workbench .custom-mode-ui-console-section-host .custom-mode-ui-workspace-plan {
				margin: 0;
				padding: 0;
				border: none;
				border-radius: 0;
				background: transparent;
			}

			/* Rules markdown already has its own inset chrome. */
			.monaco-workbench .custom-mode-ui-console-section-host .custom-mode-ui-workspace-claude-md-body {
				border-radius: 6px;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces,
			.monaco-workbench .custom-mode-ui-workspace-suggested {
				display: flex;
				flex-direction: column;
				gap: 10px;
				margin: 0 0 16px;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces.hidden,
			.monaco-workbench .custom-mode-ui-workspace-suggested.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-title {
				font-size: 13px;
				font-weight: 650;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card.active {
				border-color: var(--vscode-focusBorder, var(--vscode-panel-border));
				background: color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 12%, var(--vscode-editor-background));
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-badge {
				color: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-media {
				position: relative;
				width: 100%;
				height: 148px;
				margin: 0;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 8px;
				overflow: hidden;
				background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground));
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-media.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-media-img {
				display: block;
				width: 100%;
				height: 100%;
				object-fit: cover;
				object-position: top center;
				pointer-events: none;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-purpose.has-snapshot {
				display: -webkit-box;
				-webkit-box-orient: vertical;
				-webkit-line-clamp: 2;
				line-clamp: 2;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress {
				display: flex;
				flex-direction: column;
				gap: 5px;
				margin-top: 2px;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-track {
				position: relative;
				height: 4px;
				border-radius: 999px;
				background: color-mix(in srgb, var(--vscode-progressBar-background, var(--vscode-button-background)) 18%, transparent);
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-bar {
				height: 100%;
				border-radius: 999px;
				background: var(--vscode-progressBar-background, var(--vscode-button-background));
				width: 0%;
				transition: width 0.28s ease;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-bar.is-complete {
				background: var(--vscode-testing-iconPassed, #73c991);
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-bar.is-running {
				background: linear-gradient(
					90deg,
					color-mix(in srgb, var(--vscode-progressBar-background, #3794ff) 55%, transparent),
					var(--vscode-progressBar-background, #3794ff),
					color-mix(in srgb, var(--vscode-progressBar-background, #3794ff) 55%, transparent)
				);
				background-size: 200% 100%;
				animation: custom-mode-surface-card-progress-pulse 1.4s linear infinite;
			}

			@keyframes custom-mode-surface-card-progress-pulse {
				0% { background-position: 100% 0; }
				100% { background-position: -100% 0; }
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-meta {
				display: flex;
				align-items: baseline;
				justify-content: space-between;
				gap: 8px;
				font-size: 10px;
				line-height: 1.3;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-label {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress-pct {
				flex: 0 0 auto;
				font-variant-numeric: tabular-nums;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-workspace-surfaces-card-progress.is-complete .custom-mode-ui-workspace-surfaces-card-progress-pct {
				color: var(--vscode-testing-iconPassed, #73c991);
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-title {
				font-size: 13px;
				font-weight: 650;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-create {
				height: 26px;
				padding: 0 12px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, transparent);
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-size: 11px;
				font-weight: 600;
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-create:disabled {
				opacity: 0.5;
				cursor: default;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-grid {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card {
				display: flex;
				flex-direction: column;
				gap: 8px;
				min-height: 140px;
				padding: 12px 14px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 10px;
				background: var(--vscode-editor-background);
				color: inherit;
				text-align: left;
				cursor: pointer;
				font-family: inherit;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card.selected {
				border-color: var(--vscode-focusBorder, var(--vscode-panel-border));
				background: color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 12%, var(--vscode-editor-background));
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card:disabled {
				cursor: default;
				opacity: 0.85;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card-top {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card-name {
				font-size: 13px;
				font-weight: 650;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card-badge {
				flex: 0 0 auto;
				font-size: 9px;
				font-weight: 700;
				letter-spacing: 0.02em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card-purpose {
				font-size: 11px;
				line-height: 1.4;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 4px;
				margin-top: auto;
			}

			.monaco-workbench .custom-mode-ui-workspace-suggested-card-chip {
				padding: 2px 7px;
				border-radius: 999px;
				border: 1px solid var(--vscode-panel-border);
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-create-panel {
				display: flex;
				flex-direction: column;
				min-height: 176px;
				border: 1px dashed var(--vscode-panel-border);
				border-radius: 10px;
				background: transparent;
				overflow: hidden;
			}

			.monaco-workbench .custom-mode-ui-surface-create-panel-title {
				flex: 0 0 auto;
				padding: 12px 14px 0;
				color: var(--vscode-foreground);
				font-size: 13px;
				font-weight: 650;
				line-height: 1.3;
				text-align: center;
			}

			.monaco-workbench .custom-mode-ui-surface-create-panel-body {
				flex: 1 1 auto;
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
				align-items: stretch;
				min-height: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-create-separator {
				width: 1px;
				align-self: stretch;
				margin: 12px 0 18px;
				background: var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card {
				position: relative;
				display: block;
				min-height: 176px;
				padding: 0;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 10px;
				background: var(--vscode-editor-background);
				color: inherit;
				text-align: left;
				cursor: pointer;
				font-family: inherit;
				overflow: hidden;
				transition: border-color 0.12s ease, box-shadow 0.15s ease, transform 0.15s ease;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card:hover {
				border-color: var(--vscode-focusBorder);
				box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
				transform: translateY(-1px);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card:focus-visible {
				outline: 2px solid var(--vscode-focusBorder);
				outline-offset: 2px;
			}

			@media (prefers-reduced-motion: reduce) {
				.monaco-workbench .custom-mode-ui-surface-starter-card,
				.monaco-workbench .custom-mode-ui-surface-starter-card:hover {
					transition: none;
					transform: none;
				}
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

			.monaco-workbench .custom-mode-ui-surface-starter-card-meta,
			.monaco-workbench .custom-mode-ui-surface-starter-card-preview-row {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-description {
				display: flex;
				flex-direction: column;
				justify-content: flex-start;
				gap: 8px;
				width: 100%;
				height: 100%;
				padding: 52px 14px 14px;
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card.has-preview .custom-mode-ui-surface-starter-card-description {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-summary {
				display: block;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
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

			.monaco-workbench .custom-mode-ui-surface-starter-card-meta {
				display: flex;
				flex-direction: column;
				gap: 4px;
				width: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-status {
				display: none;
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

			.monaco-workbench .custom-mode-ui-surface-starter-card-task-tree {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				flex: 0 0 auto;
				width: 26px;
				height: 26px;
				padding: 0;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent);
				color: var(--vscode-descriptionForeground);
				cursor: pointer;
				backdrop-filter: blur(4px);
				transition: border-color 0.12s ease, color 0.12s ease, background-color 0.12s ease;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-task-tree:hover {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-textLink-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-task-tree:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 1px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-task-tree .codicon {
				font-size: 14px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-status.created,
			.monaco-workbench .custom-mode-ui-surface-starter-card-status.running {
				display: inline-flex;
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
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 10px;
				min-height: 0;
				padding: 24px;
				box-sizing: border-box;
				text-align: center;
				border: 0;
				border-radius: 0;
				background: transparent;
				box-shadow: none;
				transform: none;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new:hover {
				background: var(--vscode-list-hoverBackground);
				border-color: transparent;
				box-shadow: none;
				transform: none;
			}

			.monaco-workbench .custom-mode-ui-surface-create-panel .custom-mode-ui-surface-starter-card-new:focus-visible {
				outline: 2px solid var(--vscode-focusBorder);
				outline-offset: -2px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-header {
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 10px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-title {
				flex: 0 1 auto;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-icon.codicon {
				width: 40px;
				height: 40px;
				font-size: 22px;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card.has-preview .custom-mode-ui-surface-starter-card-preview {
				position: absolute;
				inset: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-starter-card-new .custom-mode-ui-surface-starter-card-highlights {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose {
				display: none;
				flex-direction: column;
				gap: 14px;
				min-height: 176px;
				padding: 18px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 10px;
				background: var(--vscode-editor-background);
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose.visible {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose.dragover {
				border-color: var(--vscode-focusBorder);
				box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose-header {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose-title {
				color: var(--vscode-foreground);
				font-size: 15px;
				font-weight: 650;
				line-height: 1.3;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose-hint {
				margin-top: 4px;
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose-back {
				flex: 0 0 auto;
				height: 28px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
				background: transparent;
				color: var(--vscode-foreground);
				cursor: pointer;
				font-size: 11px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-compose-back:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-field {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-label {
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-name,
			.monaco-workbench .custom-mode-ui-surface-describe-intent {
				width: 100%;
				box-sizing: border-box;
				border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
				border-radius: 8px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-family: inherit;
				font-size: 13px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-name {
				height: 34px;
				padding: 0 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-intent {
				min-height: 96px;
				padding: 10px 12px;
				resize: vertical;
				line-height: 1.45;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-name:focus,
			.monaco-workbench .custom-mode-ui-surface-describe-intent:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-footer {
				display: flex;
				flex-direction: column;
				gap: 10px;
				margin-top: 2px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachments {
				display: flex;
				flex-direction: row;
				flex-wrap: nowrap;
				align-items: stretch;
				gap: 8px;
				max-width: 100%;
				overflow-x: auto;
				padding-bottom: 2px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachments:empty {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment {
				display: flex;
				flex: 0 0 auto;
				align-items: center;
				gap: 8px;
				max-width: 220px;
				padding: 6px 8px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 8px;
				background: var(--vscode-sideBar-background);
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-preview {
				flex: 0 0 auto;
				width: 36px;
				height: 36px;
				border-radius: 6px;
				object-fit: cover;
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-panel-border);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-icon {
				display: flex;
				flex: 0 0 auto;
				align-items: center;
				justify-content: center;
				width: 36px;
				height: 36px;
				border-radius: 6px;
				border: 1px solid var(--vscode-panel-border);
				background: var(--vscode-editor-background);
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-icon .codicon {
				font-size: 16px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-meta {
				display: flex;
				flex-direction: column;
				gap: 2px;
				min-width: 0;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-name {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-foreground);
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-kind {
				color: var(--vscode-descriptionForeground);
				font-size: 10px;
				text-transform: uppercase;
				letter-spacing: 0.02em;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-path {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				color: var(--vscode-descriptionForeground);
				font-size: 10px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-remove {
				flex: 0 0 auto;
				width: 22px;
				height: 22px;
				padding: 0;
				border: 0;
				border-radius: 4px;
				background: transparent;
				color: var(--vscode-descriptionForeground);
				cursor: pointer;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-attachment-remove:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-actions {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-media {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-media-btn {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				height: 30px;
				padding: 0 10px;
				border-radius: 6px;
				border: 1px dashed var(--vscode-panel-border);
				background: transparent;
				color: var(--vscode-foreground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-media-btn:hover {
				border-color: var(--vscode-focusBorder);
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-media-btn .codicon {
				font-size: 14px;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-submit {
				height: 32px;
				padding: 0 14px;
				border-radius: 6px;
				border: 0;
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-describe-submit:hover:not(:disabled) {
				background: var(--vscode-button-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-describe-submit:disabled {
				opacity: 0.55;
				cursor: default;
			}

			@media (max-width: 760px) {
				.monaco-workbench .custom-mode-ui-surface-starter-grid {
					grid-template-columns: minmax(0, 1fr);
				}

				.monaco-workbench .custom-mode-ui-surface-create-panel-body {
					grid-template-columns: minmax(0, 1fr);
					grid-template-rows: auto auto auto;
				}

				.monaco-workbench .custom-mode-ui-surface-create-separator {
					width: auto;
					height: 1px;
					margin: 0 18px;
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
				max-width: 520px;
				width: min(520px, 100%);
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

			.monaco-workbench .custom-mode-ui-surface-empty.custom-mode-ui-surface-empty-overview {
				text-align: left;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-overview .custom-mode-ui-surface-empty-inner {
				max-width: 680px;
				width: min(680px, 100%);
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-overview .custom-mode-ui-surface-empty-title {
				font-size: 16px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-overview .custom-mode-ui-surface-empty-subtitle {
				font-size: 13px;
				line-height: 1.55;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-body {
				display: flex;
				flex-direction: column;
				gap: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-body:empty {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-facts {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-fact {
				display: inline-flex;
				align-items: baseline;
				gap: 6px;
				padding: 3px 10px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
				border-radius: 10px;
				font-size: 11px;
				max-width: 100%;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-fact-label {
				font-weight: 700;
				font-size: 10px;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-fact-value {
				color: var(--vscode-foreground);
				overflow-wrap: anywhere;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-details-toggle {
				align-self: flex-start;
				background: none;
				border: none;
				padding: 0;
				cursor: pointer;
				font-size: 12px;
				color: var(--vscode-textLink-foreground, var(--vscode-focusBorder, #3794ff));
			}

			.monaco-workbench .custom-mode-ui-surface-overview-details-toggle::before {
				content: '▸ ';
			}

			.monaco-workbench .custom-mode-ui-surface-overview-details-toggle[aria-expanded="true"]::before {
				content: '▾ ';
			}

			.monaco-workbench .custom-mode-ui-surface-overview-details {
				display: flex;
				flex-direction: column;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-details.hidden {
				display: none;
			}

			.monaco-workbench .custom-mode-ui-surface-overview-details p {
				margin: 0;
				font-size: 12px;
				line-height: 1.55;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folders {
				display: none;
				flex-direction: column;
				gap: 6px;
				margin-top: 12px;
				text-align: left;
				max-height: min(360px, 50vh);
				overflow: auto;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folders:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folders-heading {
				font-size: 11px;
				font-weight: 600;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 2px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folder {
				display: flex;
				flex-direction: column;
				align-items: flex-start;
				gap: 2px;
				width: 100%;
				padding: 10px 12px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
				border-radius: 6px;
				background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
				color: var(--vscode-foreground);
				cursor: pointer;
				text-align: left;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folder:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folder:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 1px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folder-name {
				font-size: 13px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-folder-path {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				word-break: break-all;
			}

			.monaco-workbench .custom-mode-workspace-switcher-popover {
				position: fixed;
				z-index: 2800;
				display: flex;
				flex-direction: column;
				width: min(280px, calc(100vw - 24px));
				max-height: min(360px, 55vh);
				padding: 8px;
				border-radius: 8px;
				background: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border));
				box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
				color: var(--vscode-foreground);
				box-sizing: border-box;
			}

			.monaco-workbench .custom-mode-workspace-switcher-heading {
				padding: 4px 8px 6px;
				font-size: 11px;
				font-weight: 600;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-workspace-switcher-list {
				display: flex;
				flex-direction: column;
				gap: 4px;
				flex: 1 1 auto;
				min-height: 0;
				overflow: auto;
			}

			.monaco-workbench .custom-mode-workspace-switcher-item {
				display: flex;
				flex-direction: column;
				align-items: flex-start;
				gap: 2px;
				width: 100%;
				padding: 8px 10px;
				border: 0;
				border-radius: 6px;
				background: transparent;
				color: var(--vscode-foreground);
				cursor: pointer;
				text-align: left;
			}

			.monaco-workbench .custom-mode-workspace-switcher-item:hover,
			.monaco-workbench .custom-mode-workspace-switcher-item:focus-visible {
				background: var(--vscode-list-hoverBackground);
				outline: none;
			}

			.monaco-workbench .custom-mode-workspace-switcher-item-name {
				font-size: 12px;
				font-weight: 600;
				max-width: 100%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-workspace-switcher-item-path {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				max-width: 100%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.monaco-workbench .custom-mode-workspace-switcher-empty {
				padding: 10px 8px;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
			}

			.monaco-workbench .custom-mode-workspace-switcher-create {
				display: block;
				width: 100%;
				margin-top: 8px;
				padding: 8px 10px;
				border: 1px solid var(--vscode-button-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
				border-radius: 6px;
				background: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				cursor: pointer;
				font-size: 12px;
				font-weight: 600;
				text-align: center;
			}

			.monaco-workbench .custom-mode-workspace-switcher-create:hover,
			.monaco-workbench .custom-mode-workspace-switcher-create:focus-visible {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
				outline: none;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-actions {
				display: none;
				flex-wrap: wrap;
				justify-content: center;
				gap: 8px;
				margin-top: 14px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-actions:not(.hidden) {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-action {
				padding: 7px 12px;
				border: 1px solid var(--vscode-button-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.35)));
				border-radius: 6px;
				background: var(--vscode-button-secondaryBackground, transparent);
				color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
				cursor: pointer;
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-ui-surface-empty-action:hover {
				background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
			}

			.monaco-workbench .custom-mode-ui-surface-empty-action.primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border-color: var(--vscode-button-background);
			}

			.monaco-workbench .custom-mode-ui-surface-empty-action.primary:hover {
				background: var(--vscode-button-hoverBackground);
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
			
			/*
			 * UI Mode Start App / runtime overlay removed — preview + surface launch chrome own
			 * startup UX. Scope to the UI column only; Process mode still uses .custom-mode-setup.
			 */
			.monaco-workbench .custom-mode-ui-main > .custom-mode-setup {
				display: none !important;
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

			.monaco-workbench.custom-mode-shell-hasProject.custom-mode-shell-preview-select .custom-mode-ui-selection-pill {
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

			.monaco-workbench.custom-mode-shell-hasProject.custom-mode-shell-preview-select .custom-mode-ui-selection-clear {
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

			.monaco-workbench .custom-mode-ui-clear-all-surfaces {
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

			.monaco-workbench.custom-mode-shell-hasProject:not(.custom-mode-shell-preview-select) .custom-mode-ui-clear-all-surfaces {
				display: inline-block;
			}

			.monaco-workbench .custom-mode-ui-clear-all-surfaces:hover:not(:disabled) {
				color: var(--vscode-foreground);
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.monaco-workbench .custom-mode-ui-clear-all-surfaces:disabled {
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
		this.uiCodeTab = $('button.custom-mode-ui-project-name.custom-mode-ui-code-tab.hidden', {
			type: 'button',
			role: 'tab',
			title: localize('customMode.codeTabTitle', 'Open Code editor'),
			'aria-pressed': 'false',
		}, localize('customMode.codeTab', 'Code')) as HTMLButtonElement;
		this.uiProjectNameLabel = $('span.custom-mode-ui-project-name-label');
		this.uiProjectName = $('button.custom-mode-ui-project-name.hidden', {
			type: 'button',
			role: 'tab',
			title: localize('customMode.backToConsoleTitle', 'Back to Console'),
			'aria-pressed': 'false',
		}, this.uiProjectNameLabel) as HTMLButtonElement;
		this.modeTopBar.appendChild(this.uiCodeTab);
		this.modeTopBar.appendChild(this.uiProjectName);
		this._register(addDisposableListener(this.uiCodeTab, 'click', () => {
			this.openCodeTab();
		}));
		this._register(addDisposableListener(this.uiProjectName, 'click', () => {
			this.goToConsoleHome();
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
		this.uiStepsHost = $('div.custom-mode-ui-steps-host');
		this.uiStepsPane = $('div.custom-mode-ui-steps-pane.hidden', {
			role: 'region',
			'aria-label': localize('customMode.stepsPanelLabel', 'Steps'),
		}, this.uiStepsHost);
		this.uiStepsReopenPendingDot = $('span.custom-mode-ui-steps-reopen-pending-dot', {
			'aria-hidden': 'true',
		});
		this.uiStepsReopenBtn = $('button.custom-mode-ui-steps-reopen.hidden', {
			type: 'button',
			title: localize('customMode.stepsReopen', 'Open Steps'),
			'aria-label': localize('customMode.stepsReopen', 'Open Steps'),
		},
			$('span.custom-mode-ui-steps-reopen-label', undefined, localize('customMode.stepsReopenShort', 'Steps')),
			this.uiStepsReopenPendingDot,
		) as HTMLButtonElement;
		this.uiBodyRow = $('div.custom-mode-ui-body-row');
		this.uiMainColumn = $('div.custom-mode-ui-main');
		this.uiClaudeTerminalEmpty = $('div.custom-mode-ui-claude-terminal-empty', undefined,
			localize('customMode.claudeTerminalStarting', 'Starting Claude…'),
		);
		this.uiClaudeTerminalHost = $('div.custom-mode-ui-claude-terminal-host', undefined, this.uiClaudeTerminalEmpty);
		this.uiClaudeTerminalSash = $('div.custom-mode-ui-claude-terminal-sash', {
			role: 'separator',
			'aria-orientation': 'horizontal',
			'aria-label': localize('customMode.claudeTerminalSash', 'Resize Claude terminal'),
			title: localize('customMode.claudeTerminalSash', 'Resize Claude terminal'),
			tabindex: '0',
		});
		this.uiClaudeTerminalStatus = $('span.custom-mode-ui-claude-terminal-status', {
			title: localize('customMode.claudeKickoffStatusTitle', 'Claude kickoff status'),
		});
		this.uiClaudeTerminalKeyLabel = $('span.custom-mode-ui-claude-terminal-key');
		this.uiClaudeTerminalKeyTabs = $('div.custom-mode-ui-claude-terminal-key-tabs', {
			role: 'tablist',
			'aria-label': localize('customMode.claudeTerminalKeyTabs', 'Claude sessions'),
		});
		this.uiClaudeTerminalKeyTabs.classList.add('hidden');
		this.uiClaudeTerminalPane = $('div.custom-mode-ui-claude-terminal', undefined,
			$('div.custom-mode-ui-claude-terminal-header', undefined,
				$('span', undefined, localize('customMode.claudeTerminalTitle', 'Claude')),
				this.uiClaudeTerminalKeyLabel,
				this.uiClaudeTerminalKeyTabs,
				this.uiClaudeTerminalStatus,
			),
			this.uiClaudeTerminalHost,
		);
		this.uiClaudeTerminalReopenPendingDot = $('span.custom-mode-ui-claude-reopen-pending-dot', {
			'aria-hidden': 'true',
		});
		this.uiClaudeTerminalReopenBtn = $('button.custom-mode-ui-claude-reopen', {
			type: 'button',
			title: localize('customMode.claudeTerminalReopen', 'Open Claude'),
			'aria-label': localize('customMode.claudeTerminalReopen', 'Open Claude'),
		},
			$('span.custom-mode-ui-claude-reopen-label', undefined, localize('customMode.claudeTerminalReopenShort', 'Claude')),
			this.uiClaudeTerminalReopenPendingDot,
		) as HTMLButtonElement;
		this.uiFeatureChecklistColumn = $('div.custom-mode-ui-feature-checklist-column');
		if (this.isSurfaceFeatureChecklistHidden()) {
			this.uiFeatureChecklistColumn.classList.add('hidden');
		}
		this._register(new SurfaceFeatureChecklistPanel(
			this.uiFeatureChecklistColumn,
			this.surfaceFeatureChecklistService,
			(surfaceId, stepId) => stepId
				? void this.playSelectedSurfaceWorkflowStep(surfaceId, stepId)
				: void this.playSelectedSurfaceWorkflow(surfaceId),
			() => this.setSurfaceFeatureChecklistHidden(true),
		));
		this.uiSetup = $('div.custom-mode-setup.custom-mode-setup-hidden');
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
		this.uiClearAllSurfacesBtn = $('button.custom-mode-ui-clear-all-surfaces', {
			type: 'button',
			'aria-label': localize('customMode.clearAllSurfaces', 'Clear all Surfaces'),
			title: localize('customMode.clearAllSurfacesTitle', 'Delete every surface, plan, proposal, and wipe the entire apps/ directory'),
		}, localize('customMode.clearAllSurfaces', 'Clear all Surfaces')) as HTMLButtonElement;
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
		this.uiSurfaceMainViewToggle = $('div.custom-mode-ui-surface-main-view-toggle.hidden', {
			role: 'tablist',
			'aria-label': localize('customMode.surfaceMainViewToggle', 'Surface main view'),
		});
		const planToggleButton = $('button', {
			type: 'button',
			role: 'tab',
			'aria-selected': 'false',
			title: localize('customMode.surfaceMainViewPlan', 'Plan'),
		},
			$('span.custom-mode-ui-surface-main-view-card-key', undefined, localize('customMode.surfaceMainViewPlanKey', 'Plan')),
			$('span.custom-mode-ui-surface-main-view-card-value', undefined, localize('customMode.surfaceMainViewPlanValue', 'plan.md')),
		) as HTMLButtonElement;
		const claudeMdToggleButton = $('button', {
			type: 'button',
			role: 'tab',
			'aria-selected': 'false',
			title: localize('customMode.surfaceMainViewClaudeMd', 'CLAUDE.md'),
		},
			$('span.custom-mode-ui-surface-main-view-card-key', undefined, localize('customMode.surfaceMainViewClaudeMdKey', 'Rules')),
			$('span.custom-mode-ui-surface-main-view-card-value', undefined, localize('customMode.surfaceMainViewClaudeMd', 'CLAUDE.md')),
		) as HTMLButtonElement;
		const previewToggleButton = $('button', {
			type: 'button',
			role: 'tab',
			'aria-selected': 'false',
			title: localize('customMode.surfaceMainViewPreview', 'Preview'),
		},
			$('span.custom-mode-ui-surface-main-view-card-key', undefined, localize('customMode.surfaceMainViewPreviewKey', 'Preview')),
			$('span.custom-mode-ui-surface-main-view-card-value', undefined, localize('customMode.surfaceMainViewPreviewValue', 'Live app')),
		) as HTMLButtonElement;
		const ixSubsystemsToggleButton = $('button', {
			type: 'button',
			role: 'tab',
			'aria-selected': 'false',
			title: localize('customMode.surfaceMainViewIxSubsystems', 'Code Graph'),
		},
			$('span.custom-mode-ui-surface-main-view-card-key', undefined, localize('customMode.surfaceMainViewIxSubsystemsKey', 'Graph')),
			$('span.custom-mode-ui-surface-main-view-card-value', undefined, localize('customMode.surfaceMainViewIxSubsystemsShort', 'Code graph')),
		) as HTMLButtonElement;
		this.uiSurfaceTaskTreeToggleButtons.set('claudeMd', claudeMdToggleButton);
		this.uiSurfaceTaskTreeToggleButtons.set('plan', planToggleButton);
		this.uiSurfaceTaskTreeToggleButtons.set('preview', previewToggleButton);
		this.uiSurfaceTaskTreeToggleButtons.set('ixSubsystems', ixSubsystemsToggleButton);
		this.uiSurfaceMainViewToggle.appendChild(claudeMdToggleButton);
		this.uiSurfaceMainViewToggle.appendChild(planToggleButton);
		this.uiSurfaceMainViewToggle.appendChild(ixSubsystemsToggleButton);
		this.uiSurfaceMainViewToggle.appendChild(previewToggleButton);
		this._register(addDisposableListener(planToggleButton, 'click', () => this.setSurfaceMainView('plan')));
		this._register(addDisposableListener(claudeMdToggleButton, 'click', () => this.setSurfaceMainView('claudeMd')));
		this._register(addDisposableListener(previewToggleButton, 'click', () => this.setSurfaceMainView('preview')));
		this._register(addDisposableListener(ixSubsystemsToggleButton, 'click', () => this.setSurfaceMainView('ixSubsystems')));
		this.uiSurfacePlanPanelRoot = $('div.custom-mode-ui-surface-plan-panel.hidden');
		this.uiSurfacePlanPanelRoot.hidden = true;
		this.surfacePlanPanel = this._register(new SurfacePlanPanel(
			this.uiSurfacePlanPanelRoot,
			this.fileService,
			this.webviewService,
			this.ixIntegrationService,
		));
		this.surfacePlanPanel.attachStatusTracker(this.uiStepsHost);
		this.surfacePlanPanel.statusTrackerElement.classList.add('hidden');
		this._register(this.surfacePlanPanel.onDidRequestBuild(request => {
			this.selectOwningSurfaceCard(request.surfaceId);
			void this.submitPlanBuildIntent(request);
		}));
		this._register(this.surfacePlanPanel.onDidConfirmReferenceSelection(selection => {
			this.selectOwningSurfaceCard(selection.surfaceId);
			void this.notifyClaudeReferenceSelectionConfirmed(selection);
		}));
		this._register(this.surfacePlanPanel.onDidRequestNextAction(request => {
			this.selectOwningSurfaceCard(request.surfaceId);
			void this.notifyClaudePlanNextAction(request);
		}));
		this._register(this.surfacePlanPanel.onDidSelectOwningSurface(request => {
			this.selectSurfaceForPlanStep(request);
		}));
		this._register(this.surfacePlanPanel.onDidRequestSection(sectionId => {
			const openSurfaceId = this.getOpenSurfaceId();
			if (!openSurfaceId || !sectionId) {
				return;
			}
			if (this.surfaceRailCards.some(card => card.id === `surfaceSection:${sectionId}`)) {
				this.selectSurfaceSectionCard(openSurfaceId, sectionId);
			}
		}));
		this._register(this.surfacePlanPanel.onDidRequestRunWorkstreams(request => {
			void this.runParallelWorkstreamsForSurface(
				request.surfaceId,
				request.surfaceName,
				request.stepId,
				request.stepLabel,
			);
		}));
		this._register(this.surfacePlanPanel.onDidRequestRegenerateRealGraph(request => {
			this.selectOwningSurfaceCard(request.surfaceId);
			void this.regenerateRealGraphFromActions();
		}));
		this._register(this.surfacePlanPanel.onDidRequestRegenerateDescription(request => {
			this.selectOwningSurfaceCard(request.surfaceId);
			void this.regenerateSurfaceDescriptionFromActions(request.surfaceId, request.surfaceName);
		}));
		this._register(this.surfacePlanPanel.onDidRequestRegenerateSchema(request => {
			this.selectOwningSurfaceCard(request.surfaceId);
			void this.regenerateSurfaceSchemaFromActions(request.surfaceId, request.surfaceName);
		}));
		// Keep finished workstream Claude tabs as history — user closes via tab × / Close all.
		this._register(this.surfacePlanPanel.onDidWorkstreamsComplete(() => {
			this.syncClaudeWorkstreamSwitcher(this.visibleClaudeTerminalKey);
		}));
		this._register(this.surfacePlanPanel.onDidChangeCards(cards => {
			// Ignore tree republishes after the surface was collapsed — otherwise stale section
			// cards keep the rail in surface mode and setCards thrash destroys pressable buttons.
			const openSurfaceId = this.getOpenSurfaceId();
			if (!openSurfaceId) {
				this.surfaceRailCardsLoading = false;
				return;
			}
			const next = this.toSurfaceRailSectionCards(cards);
			const wasLoading = this.surfaceRailCardsLoading;
			this.surfaceRailCardsLoading = false;
			const activeSectionId = this.activeRailCardId?.startsWith('surfaceSection:')
				? this.activeRailCardId.slice('surfaceSection:'.length)
				: undefined;
			const activeSectionStillValid = Boolean(
				activeSectionId && next.some(card => card.id === `surfaceSection:${activeSectionId}`),
			);
			if (cardRailItemsEqual(this.surfaceRailCards, next)) {
				// Values unchanged — only finish the initial open focus once.
				if (wasLoading && !activeSectionStillValid) {
					this.selectDefaultSurfaceSectionOrOwner(openSurfaceId);
				}
				return;
			}
			this.surfaceRailCards = next;
			this.surfaceRailCardsById.set(openSurfaceId, next);
			// Do not re-drive section selection on every plan/graph value publish — that fights clicks.
			if (!activeSectionStillValid && (wasLoading || this.activeRailCardId === `surface:${openSurfaceId}` || !activeSectionId)) {
				this.selectDefaultSurfaceSectionOrOwner(openSurfaceId);
				return;
			}
			this.syncWorkspaceHomeView();
		}));
		this._register(this.surfacePlanPanel.onDidChangeCurrentStep(() => {
			this.resyncSurfaceRailCardOrderForCurrentStep();
		}));
		this.uiSurfaceClaudeMdPanelRoot = $('div.custom-mode-ui-surface-claude-md-panel.hidden');
		this.uiSurfaceClaudeMdPanelRoot.hidden = true;
		this.uiSurfaceIxSubsystemsPanelRoot = $('div.custom-mode-ui-surface-ix-subsystems-panel.hidden');
		this.uiSurfaceIxSubsystemsPanelRoot.hidden = true;
		this.uiSurfaceCustomViewsRoot = $('div.custom-mode-ui-surface-custom-views.hidden');
		this.uiSurfaceCustomViewsRoot.hidden = true;
		this._register(this.agentTaskTreeService.onDidChangeTaskTree(tree => {
			if (!tree?.surfaceId || tree.surfaceId !== this.selectedSurfaceId) {
				return;
			}
			this.selectedSurfaceTaskTree = tree;
			if (!this.getStoredSurfaceMainView(tree.surfaceId)) {
				void this.resolveAndApplyDefaultSurfaceMainView(tree.surfaceId, tree);
				return;
			}
			this.syncSurfaceMainView();
			this.syncUiChatInputToTaskTreeStep(tree);
		}));
		// Empty-state copy lives in the card-rail content host so the side cards stay visible.
		this.uiSurfaceEmptyTitle = $('div.custom-mode-ui-surface-empty-title');
		this.uiSurfaceEmptySubtitle = $('div.custom-mode-ui-surface-empty-subtitle');
		this.uiSurfaceEmptyBody = $('div.custom-mode-ui-surface-empty-body');
		this.uiSurfaceEmptyFolders = $('div.custom-mode-ui-surface-empty-folders.hidden', {
			role: 'list',
			'aria-label': localize('customMode.emptyOpenableFoldersAria', 'Folders you can open'),
		});
		this.uiSurfaceEmptyActions = $('div.custom-mode-ui-surface-empty-actions.hidden');
		this.uiSurfaceEmptyState = $('div.custom-mode-ui-surface-empty.hidden', undefined,
			$('div.custom-mode-ui-surface-empty-inner', undefined,
				this.uiSurfaceEmptyTitle,
				this.uiSurfaceEmptySubtitle,
				this.uiSurfaceEmptyBody,
				this.uiSurfaceEmptyFolders,
				this.uiSurfaceEmptyActions,
			)
		);
		this._register(this.workspacesService.onDidChangeRecentlyOpened(() => {
			if (this.emptyOpenableFoldersEnabled) {
				void this.refreshEmptyOpenableFolders();
			}
		}));
		this.uiSurfaceSetupDashboard = this.createSurfaceSetupDashboard();
		// Plan + Start-preview chrome render inside the shared card rail content host (see
		// createSurfaceSetupDashboard). Live webview stays a sibling so it can paint full-bleed.
		this.uiSurfaceMainContent = $('div.custom-mode-ui-surface-main-content', undefined,
			this.uiSurfaceClaudeMdPanelRoot,
			this.uiSurfaceIxSubsystemsPanelRoot,
			this.uiSurfaceCustomViewsRoot,
			this.uiSurfaceSetupDashboard,
			this.uiBrowser,
		);
		this.uiBrowserShell.appendChild(this.uiSurfaceMainViewToggle);
		this.uiBrowserShell.appendChild(this.uiSurfaceMainContent);

		this.uiMainColumn.appendChild(this.uiSetup);
		this.uiMainColumn.appendChild(this.uiBrowserShell);

		this.uiChatContainer = $('div.custom-mode-embedded-chat.custom-mode-ui-side-chat');
		this.uiActionsHost = $('div.custom-mode-ui-actions-host');
		this.uiChatTitleEl = $('span', undefined, localize('customMode.uiChatTitle', 'Actions'));
		const uiChatCloseLabel = localize('customMode.uiChatClose', 'Close');
		const uiCloseBtn = $('button', { type: 'button', 'aria-label': uiChatCloseLabel, title: uiChatCloseLabel }, '\u2715') as HTMLButtonElement;
		const uiChatNewLabel = localize('customMode.uiChatNew', 'New conversation');
		// Kept for later re-enable of embedded chat; not shown in the Actions column.
		this.uiChatNewButton = $('button.custom-mode-ui-chat-new', {
			type: 'button',
			'aria-label': uiChatNewLabel,
			title: uiChatNewLabel,
		}, $('span.codicon' + ThemeIcon.asCSSSelector(Codicon.add))) as HTMLButtonElement;
		const uiChatHeaderActions = $('div.custom-mode-ui-chat-header-actions', undefined,
			uiCloseBtn
		);
		const uiChatHeaderTop = $('div.custom-mode-ui-chat-header-top', undefined,
			this.uiChatTitleEl,
			uiChatHeaderActions
		);
		const uiChatHeader = $('div.custom-mode-ui-chat-header', undefined, uiChatHeaderTop);
		this.uiChatColumn = $('div.custom-mode-ui-chat-column', undefined, uiChatHeader, this.uiActionsHost, this.uiChatContainer);
		this.registerBuiltinSurfaceActions();
		this._register(new SurfaceActionsPanel(
			this.uiActionsHost,
			this.surfaceFeatureChecklistService,
			(surfaceId?: string, stepId?: string) => stepId
				? void this.playSelectedSurfaceWorkflowStep(surfaceId, stepId)
				: void this.playSelectedSurfaceWorkflow(surfaceId),
			SurfaceExtensibilityRegistry,
			() => this.getSurfaceExtensibilityContext(),
		));
		this._register(SurfaceExtensibilityRegistry.onDidChange(() => this.onDidChangeSurfaceExtensibilityRegistrations()));

		this.uiChatReopenBtn = $('button.custom-mode-ui-chat-reopen', {
			type: 'button',
			title: localize('customMode.uiChatReopen', 'Open Actions'),
			'aria-label': localize('customMode.uiChatReopen', 'Open Actions'),
		}, localize('customMode.uiChatReopenShort', 'Actions')) as HTMLButtonElement;

		this.uiBodyRow.appendChild(this.uiFeatureChecklistColumn);
		this.uiBodyRow.appendChild(this.uiMainColumn);
		this.uiBodyRow.appendChild(this.uiChatColumn);
		this.uiBodyRow.appendChild(this.uiChatReopenBtn);
		this.uiContainer.appendChild(this.uiStepsPane);
		this.uiContainer.appendChild(this.uiBodyRow);
		this.uiContainer.appendChild(this.uiClaudeTerminalSash);
		this.uiContainer.appendChild(this.uiClaudeTerminalPane);
		this.uiContainer.appendChild(this.uiClaudeTerminalReopenBtn);
		this.uiContainer.appendChild(this.uiStepsReopenBtn);
		this.restoreClaudeTerminalHeight();
		this.bindClaudeTerminalSash();
		this.bindClaudeTerminalAutoHide();
		this.bindStepsAutoHide();
		this.bindUiChatAutoHide();
		this.bindClaudeTerminalDragOverFeedback();
		const claudeHostObserver = new ResizeObserver(() => {
			const visible = this.getVisibleClaudeTerminalInstance();
			if (visible && !visible.isDisposed) {
				this.relayoutTerminalInstances();
			}
		});
		claudeHostObserver.observe(this.uiClaudeTerminalHost);
		this._register(toDisposable(() => claudeHostObserver.disconnect()));
		void this.restoreClaudeTerminalSession();
		this._register(this.terminalService.onDidChangeInstances(() => {
			// Persisted PTYs often appear after the first restore attempt — rebind when
			// the preferred key has a terminal but the host is still empty.
			this.syncClaudeTerminalMapFromService();
			const key = this.resolveClaudeTerminalKeyForSelection();
			const restored = key ? this.findClaudeTerminalInstance(key) : undefined;
			const visible = this.getVisibleClaudeTerminalInstance();
			const visibleAttached = Boolean(
				visible
				&& restored
				&& visible === restored
				&& restored.domElement?.parentElement === this.uiClaudeTerminalHost,
			);
			if (!shouldRebindClaudeTerminalToSelection({
				uiMutationDepth: this.claudeTerminalUiMutationDepth,
				selectionKey: key,
				visibleKey: this.visibleClaudeTerminalKey,
				selectionTerminalAvailable: Boolean(restored),
				visibleIsSelectionAttached: visibleAttached,
			})) {
				return;
			}
			this.showClaudeTerminalForKey(key);
		}));

		this._register(addDisposableListener(this.uiChatNewButton, 'click', () => void this.startNewUiChatConversation()));
		this._register(addDisposableListener(uiCloseBtn, 'click', () => this.setUiChatDismissed(true)));
		this._register(addDisposableListener(this.uiChatReopenBtn, 'click', () => this.setUiChatDismissed(false)));
		this._register(addDisposableListener(this.uiClaudeTerminalReopenBtn, 'click', () => this.setClaudeTerminalCollapsed(false)));
		this._register(addDisposableListener(this.uiStepsReopenBtn, 'click', () => this.setStepsCollapsed(false)));

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
			this.uiClearAllSurfacesBtn.remove();
		}));
		this._register(addDisposableListener(this.uiSelectionClearBtn, 'click', () => this.clearUiSelection()));
		this._register(addDisposableListener(this.uiClearAllSurfacesBtn, 'click', () => void this.clearAllSurfacesFromActions()));
		this.syncTopBarSelectionChrome();

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

		// In the web workbench there is no app root on disk (and no `process` global),
		// so the cytoscape scripts cannot be served from node_modules; leave the graph
		// webview empty there instead of failing the whole contribution.
		const appRoot = this.nativeEnvironmentService.appRoot ? URI.file(this.nativeEnvironmentService.appRoot) : undefined;
		const graphScriptRoots = appRoot ? [
			URI.joinPath(appRoot, 'node_modules', 'cytoscape', 'dist'),
			URI.joinPath(appRoot, 'node_modules', 'layout-base'),
			URI.joinPath(appRoot, 'node_modules', 'cose-base'),
			URI.joinPath(appRoot, 'node_modules', 'cytoscape-fcose'),
		] : [];
		this.processNotesGraphView = this._register(new ProcessNotesCytoscapeView(
			this.webviewService,
			graphScriptRoots,
			(msg: ProcessNotesGraphWebviewMessage) => this.onProcessNotesGraphMessage(msg),
		));

		// Attach the webview overlay to the placeholder element.
		this.processNotesGraphView.attach(this.processNotesGraphAnchor, this.processMainColumn);

		if (graphScriptRoots.length) {
			const [cytoscapeRoot, layoutBaseRoot, coseBaseRoot, fcoseRoot] = graphScriptRoots;
			const cytoscapeUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(cytoscapeRoot, 'cytoscape.min.js'));
			const layoutBaseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(layoutBaseRoot, 'layout-base.js'));
			const coseBaseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(coseBaseRoot, 'cose-base.js'));
			const fcoseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(fcoseRoot, 'cytoscape-fcose.js'));
			this.processNotesGraphView.setHtml(cytoscapeUri, layoutBaseUri, coseBaseUri, fcoseUri);
			this.processNotesGraphView.setGraph({ nodes: [], edges: [] } satisfies ProcessNoteGraph);
		}

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
		registerModeShellChatTarget(() => this.getPreferredChatWidgetForTerminalAttachment());

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
			void this.refreshSurfacePendingActions();
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
			this._register(this.dockerAvailabilityService.onDidChangeStatus(() => {
				this.updateProcessDockerBanner();
				this.updateDockerWorkspacePanel();
				this.syncWorkspaceHomeView();
			}));
			void this.dockerAvailabilityService.refresh().then(() => {
				this.updateProcessDockerBanner();
				this.updateDockerWorkspacePanel();
				this.syncWorkspaceHomeView();
			});
		} else {
			this.updateDockerWorkspacePanel();
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
			webview.addEventListener('did-stop-loading', () => {
				log('did-stop-loading');
				this.surfaceUiSnapshotCaptureScheduler.schedule();
			});
			webview.addEventListener('did-finish-load', () => {
				log('did-finish-load');
				this.surfaceUiSnapshotCaptureScheduler.schedule();
			});
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
			webview.addEventListener('did-navigate-in-page', (e: unknown) => {
				log('did-navigate-in-page', asRecord(e)?.url ? String(asRecord(e)?.url) : undefined);
				this.surfaceUiSnapshotCaptureScheduler.schedule();
			});

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
				const surface = this.getSelectedSurface();
				if (evt?.isMainFrame !== false && surface?.localUrl && this.urlsShareOrigin(url, surface.localUrl)) {
					// The preview navigation itself failed (dev server not up yet): swap the blank
					// error page for the server-down copy and keep probing until it responds.
					this.setAppReachable(false);
					if (this.isPreviewSectionSelected()) {
						this.setSurfaceServerDownState(surface, surface.localUrl);
					}
					this.surfacePreviewRetryScheduler.schedule();
				}
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
			&& Boolean(this.configurationService.getValue<boolean>('custom.appLaunchGuide.autoRun') ?? false)) {
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
		this.updateUiProjectName();

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

		// Embedded chat in UI/Process. Code uses the workbench Chat side bar only when
		// the user opens it — never auto-reveal on mode switch.
		void this.updateEmbeddedChat(mode);
		if (mode === 'Code') {
			this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		}

		this.syncTabGuides(mode);
		this.syncTopBarSelectionChrome();

		if (isUi) {
			this.routeSelectedSurfacePreview();
			// Fresh user-visible mode switch — restart probing from the base cadence.
			this.uiDevServerProbeFailures = 0;
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
				// Always remeasure terminals — UI/Process hide the grid at display:none, so
				// switching back to Code (or revealing a Surface Dev PTY) must refresh cols
				// before any more output is written.
				this.relayoutTerminalInstances();
			});
		});
	}

	private restoreClaudeTerminalHeight(): void {
		const stored = Number(this.storageService.get(STORAGE_CLAUDE_TERMINAL_HEIGHT, StorageScope.PROFILE));
		const initial = Number.isFinite(stored) && stored > 0 ? stored : CLAUDE_TERMINAL_DEFAULT_HEIGHT;
		this.applyClaudeTerminalHeight(initial, { persist: false });
	}

	private getClaudeTerminalMaxHeight(): number {
		const containerHeight = this.uiContainer.clientHeight || mainWindow.innerHeight;
		return Math.max(CLAUDE_TERMINAL_MIN_HEIGHT, Math.floor(containerHeight * 0.7));
	}

	private applyClaudeTerminalHeight(height: number, options?: { persist?: boolean }): void {
		const next = Math.max(CLAUDE_TERMINAL_MIN_HEIGHT, Math.min(this.getClaudeTerminalMaxHeight(), Math.round(height)));
		this.claudeTerminalHeight = next;
		this.uiClaudeTerminalPane.style.height = `${next}px`;
		this.uiClaudeTerminalPane.style.flexBasis = `${next}px`;
		this.uiClaudeTerminalSash.setAttribute('aria-valuenow', String(next));
		if (options?.persist !== false) {
			this.storageService.store(STORAGE_CLAUDE_TERMINAL_HEIGHT, String(next), StorageScope.PROFILE, StorageTarget.USER);
		}
		this.relayoutTerminalInstances();
	}

	private bindClaudeTerminalSash(): void {
		this.uiClaudeTerminalSash.setAttribute('aria-valuemin', String(CLAUDE_TERMINAL_MIN_HEIGHT));
		this._register(addDisposableListener(this.uiClaudeTerminalSash, 'pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			const startY = event.clientY;
			const startHeight = this.uiClaudeTerminalPane.clientHeight || this.claudeTerminalHeight;
			this.uiClaudeTerminalSash.classList.add('active');
			this.setClaudeTerminalCollapsed(false);
			this.clearClaudeTerminalHideTimer();
			try {
				this.uiClaudeTerminalSash.setPointerCapture(event.pointerId);
			} catch {
				// Pointer capture is best-effort.
			}

			const onMove = (moveEvent: PointerEvent) => {
				// Dragging the sash up increases terminal height.
				const delta = startY - moveEvent.clientY;
				this.applyClaudeTerminalHeight(startHeight + delta, { persist: false });
			};
			const onUp = (upEvent: PointerEvent) => {
				this.uiClaudeTerminalSash.classList.remove('active');
				try {
					this.uiClaudeTerminalSash.releasePointerCapture(upEvent.pointerId);
				} catch {
					// ignore
				}
				mainWindow.removeEventListener('pointermove', onMove);
				mainWindow.removeEventListener('pointerup', onUp);
				this.applyClaudeTerminalHeight(this.claudeTerminalHeight, { persist: true });
				this.scheduleClaudeTerminalHide();
			};
			mainWindow.addEventListener('pointermove', onMove);
			mainWindow.addEventListener('pointerup', onUp);
		}));
		this._register(addDisposableListener(this.uiClaudeTerminalSash, 'keydown', (event: KeyboardEvent) => {
			const step = event.shiftKey ? 40 : 16;
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.setClaudeTerminalCollapsed(false);
				this.applyClaudeTerminalHeight(this.claudeTerminalHeight + step);
			} else if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.setClaudeTerminalCollapsed(false);
				this.applyClaudeTerminalHeight(this.claudeTerminalHeight - step);
			} else if (event.key === 'Home') {
				event.preventDefault();
				this.setClaudeTerminalCollapsed(false);
				this.applyClaudeTerminalHeight(this.getClaudeTerminalMaxHeight());
			} else if (event.key === 'End') {
				event.preventDefault();
				this.setClaudeTerminalCollapsed(false);
				this.applyClaudeTerminalHeight(CLAUDE_TERMINAL_MIN_HEIGHT);
			}
		}));
	}

	private clearClaudeTerminalHideTimer(): void {
		if (this.claudeTerminalHideTimer !== undefined) {
			mainWindow.clearTimeout(this.claudeTerminalHideTimer);
			this.claudeTerminalHideTimer = undefined;
		}
	}

	private setClaudeTerminalCollapsed(collapsed: boolean): void {
		if (this.claudeTerminalCollapsed === collapsed) {
			if (!collapsed) {
				this.clearClaudeTerminalHideTimer();
				this.scheduleClaudeTerminalHide();
			}
			return;
		}
		this.claudeTerminalCollapsed = collapsed;
		this.uiContainer.classList.toggle('custom-mode-ui-claude-collapsed', collapsed);
		if (!collapsed) {
			this.clearClaudeTerminalHideTimer();
			this.applyClaudeTerminalHeight(this.claudeTerminalHeight, { persist: false });
			queueMicrotask(() => this.relayoutTerminalInstances());
			this.scheduleClaudeTerminalHide();
		} else {
			this.clearClaudeTerminalHideTimer();
		}
		this.syncClaudeReopenAttention();
	}

	/** True when the pointer is currently over the Claude pane / sash / reopen chip. */
	private isPointerOverClaudeTerminal(clientX = this.claudeTerminalLastPointerX, clientY = this.claudeTerminalLastPointerY): boolean {
		const hit = mainWindow.document.elementFromPoint(clientX, clientY);
		if (hit instanceof Node) {
			if (this.uiClaudeTerminalPane.contains(hit)
				|| this.uiClaudeTerminalSash.contains(hit)
				|| this.uiClaudeTerminalReopenBtn.contains(hit)) {
				return true;
			}
		}
		for (const el of [this.uiClaudeTerminalPane, this.uiClaudeTerminalSash, this.uiClaudeTerminalReopenBtn]) {
			const rect = el.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				continue;
			}
			if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
				return true;
			}
		}
		return false;
	}

	private scheduleClaudeTerminalHide(): void {
		if (this.uiClaudeTerminalSash.classList.contains('active')) {
			return;
		}
		this.clearClaudeTerminalHideTimer();
		this.claudeTerminalHideTimer = mainWindow.setTimeout(() => {
			this.claudeTerminalHideTimer = undefined;
			if (this.uiClaudeTerminalSash.classList.contains('active')) {
				return;
			}
			// Re-check geometry — preview webviews often swallow pointerleave and leave
			// `claudeTerminalHovering` stuck true, which used to block auto-hide forever.
			if (this.isPointerOverClaudeTerminal()) {
				this.claudeTerminalHovering = true;
				this.scheduleClaudeTerminalHide();
				return;
			}
			this.claudeTerminalHovering = false;
			this.setClaudeTerminalCollapsed(true);
		}, CARD_RAIL_AUTO_HIDE_MS);
	}

	private bindClaudeTerminalAutoHide(): void {
		const onEnter = (): void => {
			this.claudeTerminalHovering = true;
			this.setClaudeTerminalCollapsed(false);
		};
		const onLeave = (): void => {
			this.claudeTerminalHovering = false;
			this.scheduleClaudeTerminalHide();
		};
		this._register(addDisposableListener(this.uiClaudeTerminalPane, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiClaudeTerminalPane, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiClaudeTerminalSash, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiClaudeTerminalSash, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiClaudeTerminalReopenBtn, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiClaudeTerminalReopenBtn, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiClaudeTerminalReopenBtn, 'focus', () => this.setClaudeTerminalCollapsed(false)));
		// Preview webviews steal pointer events — clear the hover latch when the main
		// content / launch panel is entered so Claude can still auto-hide.
		const clearHoverFromMain = (): void => {
			if (!this.claudeTerminalHovering && this.claudeTerminalCollapsed) {
				return;
			}
			this.claudeTerminalHovering = false;
			this.scheduleClaudeTerminalHide();
		};
		this._register(addDisposableListener(this.uiBrowserShell, 'pointerenter', clearHoverFromMain));
		this._register(addDisposableListener(this.uiSurfaceLaunchPanel, 'pointerenter', clearHoverFromMain));
		this._register(addDisposableListener(this.uiContainer, 'pointermove', (event: PointerEvent) => {
			this.claudeTerminalLastPointerX = event.clientX;
			this.claudeTerminalLastPointerY = event.clientY;
			const overClaude = this.isPointerOverClaudeTerminal(event.clientX, event.clientY);
			if (this.claudeTerminalHovering && !overClaude) {
				this.claudeTerminalHovering = false;
				this.scheduleClaudeTerminalHide();
			}
			if (!this.claudeTerminalCollapsed) {
				return;
			}
			const rect = this.uiContainer.getBoundingClientRect();
			if (rect.bottom - event.clientY <= CLAUDE_TERMINAL_REVEAL_EDGE_PX) {
				this.setClaudeTerminalCollapsed(false);
			}
		}));
		this._register(toDisposable(() => this.clearClaudeTerminalHideTimer()));
		// Mount collapsed; only edge / reopen / explicit reveal opens Claude.
		this.uiContainer.classList.add('custom-mode-ui-claude-collapsed');
	}

	private clearStepsHideTimer(): void {
		if (this.stepsHideTimer !== undefined) {
			mainWindow.clearTimeout(this.stepsHideTimer);
			this.stepsHideTimer = undefined;
		}
	}

	private setStepsCollapsed(collapsed: boolean): void {
		if (this.uiStepsPane.classList.contains('hidden')) {
			return;
		}
		// Console expanded ⇒ Steps stays visible (Steps alone does not force Console).
		if (collapsed && !this.consoleRailCollapsed) {
			return;
		}
		if (this.stepsCollapsed === collapsed) {
			if (!collapsed) {
				this.clearStepsHideTimer();
				this.scheduleStepsHide();
			}
			return;
		}
		this.stepsCollapsed = collapsed;
		this.uiContainer.classList.toggle('custom-mode-ui-steps-collapsed', collapsed);
		if (!collapsed) {
			this.clearStepsHideTimer();
			this.scheduleStepsHide();
		} else {
			this.clearStepsHideTimer();
		}
	}

	private scheduleStepsHide(): void {
		if (this.stepsHovering || this.uiStepsPane.classList.contains('hidden') || !this.consoleRailCollapsed) {
			return;
		}
		this.clearStepsHideTimer();
		this.stepsHideTimer = mainWindow.setTimeout(() => {
			this.stepsHideTimer = undefined;
			if (!this.stepsHovering && !this.uiStepsPane.classList.contains('hidden') && this.consoleRailCollapsed) {
				this.setStepsCollapsed(true);
			}
		}, CARD_RAIL_AUTO_HIDE_MS);
	}

	/** One-way couple: Console card column shown ⇒ Steps shown; Steps does not open Console. */
	private onConsoleRailCollapsedChange(collapsed: boolean): void {
		this.consoleRailCollapsed = collapsed;
		if (!collapsed) {
			this.setStepsCollapsed(false);
			return;
		}
		// Collapse together on the same clock — do not start a second Steps timer.
		if (!this.stepsHovering) {
			this.setStepsCollapsed(true);
		}
	}

	private bindStepsAutoHide(): void {
		const onEnter = (): void => {
			this.stepsHovering = true;
			this.setStepsCollapsed(false);
		};
		const onLeave = (): void => {
			this.stepsHovering = false;
			this.scheduleStepsHide();
		};
		this._register(addDisposableListener(this.uiStepsPane, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiStepsPane, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiStepsReopenBtn, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiStepsReopenBtn, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiStepsReopenBtn, 'focus', () => this.setStepsCollapsed(false)));
		// Preview webviews steal pointer events — clear the hover latch when the main
		// content / launch panel is entered so Steps can still auto-hide.
		const clearHoverFromMain = (): void => {
			if (!this.stepsHovering && this.stepsCollapsed) {
				return;
			}
			this.stepsHovering = false;
			this.scheduleStepsHide();
		};
		this._register(addDisposableListener(this.uiBrowserShell, 'pointerenter', clearHoverFromMain));
		this._register(addDisposableListener(this.uiSurfaceLaunchPanel, 'pointerenter', clearHoverFromMain));
		this._register(addDisposableListener(this.uiContainer, 'pointermove', (event: PointerEvent) => {
			if (!this.stepsCollapsed || this.uiStepsPane.classList.contains('hidden')) {
				return;
			}
			const rect = this.uiContainer.getBoundingClientRect();
			if (event.clientY - rect.top <= STEPS_REVEAL_EDGE_PX) {
				this.setStepsCollapsed(false);
			}
		}));
		this._register(toDisposable(() => this.clearStepsHideTimer()));
	}

	/**
	 * Show the top Steps panel for Console lifecycle or Surface plan Steps.
	 * Hides the pane entirely when neither context is active.
	 */
	private syncStepsPanel(): void {
		const showConsole = this.isConsoleCardSelected();
		const showSurface = Boolean(this.getOpenSurfaceId());
		const active = showConsole || showSurface;

		this.uiStepsPane.classList.toggle('hidden', !active);
		this.uiStepsReopenBtn.classList.toggle('hidden', !active);

		const surfaceTracker = this.surfacePlanPanel?.statusTrackerElement;
		if (surfaceTracker) {
			this.surfacePlanPanel?.attachStatusTracker(this.uiStepsHost);
			surfaceTracker.classList.toggle('hidden', !showSurface);
		}
		if (this.uiConsoleStatusTracker) {
			if (this.uiConsoleStatusTracker.parentElement !== this.uiStepsHost) {
				this.uiStepsHost.appendChild(this.uiConsoleStatusTracker);
			}
			// Console visibility is also toggled in renderConsoleWorkflowProgress.
			this.uiConsoleStatusTracker.classList.toggle('hidden', !showConsole);
		}
		if (this.uiBabadabaSteps) {
			if (this.uiBabadabaSteps.parentElement !== this.uiStepsHost) {
				this.uiStepsHost.insertBefore(this.uiBabadabaSteps, this.uiStepsHost.firstChild);
			}
			this.uiBabadabaSteps.classList.toggle('hidden', !showConsole);
		}

		if (!active) {
			this.clearStepsHideTimer();
			this.stepsCollapsed = false;
			this.uiContainer.classList.remove('custom-mode-ui-steps-collapsed');
			this.syncStepsReopenAttention();
			return;
		}

		if (!this.stepsHovering) {
			this.scheduleStepsHide();
		}
		this.syncStepsReopenAttention();
	}

	/** Pulse the Steps chip when the active context has a pending or in-progress step. */
	private syncStepsReopenAttention(): void {
		if (!this.uiStepsReopenBtn) {
			return;
		}
		const openSurfaceId = this.getOpenSurfaceId();
		let attentionLabel: string | undefined;
		if (openSurfaceId) {
			attentionLabel = this.surfacePendingActionById.get(openSurfaceId);
		} else if (this.isConsoleCardSelected()) {
			// Console Steps: surface-level pending/in-progress, Start Apps, hub attention, or an incomplete lifecycle step.
			attentionLabel = [...this.surfacePendingActionById.values()][0];
			if (!attentionLabel) {
				const status = resolveConsoleWorkflowStatus(this.collectConsoleWorkflowSignals());
				attentionLabel = status.nextAction?.label;
				if (!attentionLabel) {
					const current = status.steps.find(step => step.status === 'current');
					if (current && status.stageId !== 'running') {
						attentionLabel = current.label;
					}
				}
			}
			if (!attentionLabel && babadabaHubHasAttention(this.lastBabadabaHubNodes)) {
				attentionLabel = localize('customMode.babadabaStepsAttention', 'Workspace manager needs attention');
			}
		}
		const hasAttention = Boolean(attentionLabel) && !this.uiStepsReopenBtn.classList.contains('hidden');
		this.uiStepsReopenBtn.classList.toggle('has-pending-action', hasAttention);
		this.uiStepsReopenBtn.title = attentionLabel
			? localize('customMode.stepsReopenPending', 'Open Steps — {0}', attentionLabel)
			: localize('customMode.stepsReopen', 'Open Steps');
		this.uiStepsReopenBtn.setAttribute(
			'aria-label',
			attentionLabel
				? localize('customMode.stepsReopenPendingAria', 'Open Steps, {0}', attentionLabel)
				: localize('customMode.stepsReopen', 'Open Steps'),
		);
	}

	/** Pulse the Claude chip while Claude is mid-kickoff / mid-phase / terminal ensure. */
	private syncClaudeReopenAttention(): void {
		if (!this.uiClaudeTerminalReopenBtn) {
			return;
		}
		const workingLabel = this.resolveClaudeWorkingLabel();
		const hasAttention = Boolean(workingLabel);
		this.uiClaudeTerminalReopenBtn.classList.toggle('has-pending-action', hasAttention);
		this.uiClaudeTerminalReopenBtn.title = workingLabel
			? localize('customMode.claudeTerminalReopenWorking', 'Open Claude — {0}', workingLabel)
			: localize('customMode.claudeTerminalReopen', 'Open Claude');
		this.uiClaudeTerminalReopenBtn.setAttribute(
			'aria-label',
			workingLabel
				? localize('customMode.claudeTerminalReopenWorkingAria', 'Open Claude, {0}', workingLabel)
				: localize('customMode.claudeTerminalReopen', 'Open Claude'),
		);
	}

	private resolveClaudeWorkingLabel(): string | undefined {
		if (this.workspacePlanKickoffInFlight) {
			return localize('customMode.claudeWorkingKickoff', 'Starting workspace planning…');
		}
		if (this.workspacePlanSessionActive) {
			return localize('customMode.claudeWorkingWorkspacePlan', 'Drafting workspace plan…');
		}
		if (this.claudeTerminalEnsureInFlightByKey.size > 0) {
			return localize('customMode.claudeWorkingTerminal', 'Starting Claude…');
		}
		const openSurfaceId = this.getOpenSurfaceId();
		if (openSurfaceId) {
			const phaseLabel = this.surfaceClaudeWorkingById.get(openSurfaceId);
			if (phaseLabel) {
				return phaseLabel;
			}
		} else {
			const anyPhase = [...this.surfaceClaudeWorkingById.values()][0];
			if (anyPhase) {
				return anyPhase;
			}
		}
		// Interactive Claude turns (streaming output / just-submitted prompt).
		return this.claudeTerminalActivityLabel;
	}

	/** Mark the Claude chip busy from PTY activity or a prompt submit — no polling. */
	private noteClaudeTerminalActivity(_key: string, reason?: string): void {
		const label = reason?.trim()
			|| localize('customMode.claudeWorkingActivity', 'Claude is working…');
		const changed = this.claudeTerminalActivityLabel !== label;
		this.claudeTerminalActivityLabel = label;
		this.claudeTerminalActivityClear.schedule();
		if (changed || !this.uiClaudeTerminalReopenBtn.classList.contains('has-pending-action')) {
			this.syncClaudeReopenAttention();
		}
	}

	private clearUiChatHideTimer(): void {
		if (this.uiChatHideTimer !== undefined) {
			mainWindow.clearTimeout(this.uiChatHideTimer);
			this.uiChatHideTimer = undefined;
		}
	}

	private scheduleUiChatHide(): void {
		if (this.uiChatHovering || this._uiChatDismissed) {
			return;
		}
		this.clearUiChatHideTimer();
		this.uiChatHideTimer = mainWindow.setTimeout(() => {
			this.uiChatHideTimer = undefined;
			if (!this.uiChatHovering && !this._uiChatDismissed) {
				this.setUiChatDismissed(true);
			}
		}, CARD_RAIL_AUTO_HIDE_MS);
	}

	private bindUiChatAutoHide(): void {
		const onEnter = (): void => {
			this.uiChatHovering = true;
			this.setUiChatDismissed(false);
		};
		const onLeave = (): void => {
			this.uiChatHovering = false;
			this.scheduleUiChatHide();
		};
		this._register(addDisposableListener(this.uiChatColumn, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiChatColumn, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiChatReopenBtn, 'pointerenter', onEnter));
		this._register(addDisposableListener(this.uiChatReopenBtn, 'pointerleave', onLeave));
		this._register(addDisposableListener(this.uiChatReopenBtn, 'focus', () => this.setUiChatDismissed(false)));
		this._register(addDisposableListener(this.uiBodyRow, 'pointermove', (event: PointerEvent) => {
			if (!this._uiChatDismissed) {
				return;
			}
			const rect = this.uiBodyRow.getBoundingClientRect();
			if (rect.right - event.clientX <= UI_CHAT_REVEAL_EDGE_PX) {
				this.setUiChatDismissed(false);
			}
		}));
		this._register(toDisposable(() => this.clearUiChatHideTimer()));
		if (!this._uiChatDismissed) {
			this.scheduleUiChatHide();
		}
	}

	/** Green outline while dragging files/media into the Claude Code terminal pane. */
	private bindClaudeTerminalDragOverFeedback(): void {
		const pane = this.uiClaudeTerminalPane;
		const clear = (): void => pane.classList.remove('dragover');
		const show = (event: DragEvent): void => {
			if (!this.dragEventHasFiles(event)) {
				return;
			}
			// Keep the browser drop target live so Claude Code still receives the file.
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
			this.setClaudeTerminalCollapsed(false);
			pane.classList.add('dragover');
		};
		this._register(addDisposableListener(pane, 'dragenter', show));
		this._register(addDisposableListener(pane, 'dragover', show));
		this._register(addDisposableListener(pane, 'dragleave', event => {
			const related = event.relatedTarget;
			if (related instanceof Node && pane.contains(related)) {
				return;
			}
			clear();
		}));
		// Visual only — do not handle the drop; Claude Code owns the file ingest.
		this._register(addDisposableListener(pane, 'drop', clear));
		this._register(addDisposableListener(pane, 'dragend', clear));
	}

	private relayoutTerminalInstances(): void {
		const fallbackWidth = Math.max(640, Math.floor(mainWindow.innerWidth * 0.55));
		const fallbackHeight = Math.max(180, Math.floor(mainWindow.innerHeight * 0.28));
		const claudeHostWidth = this.uiClaudeTerminalHost.clientWidth;
		const claudeHostHeight = this.uiClaudeTerminalHost.clientHeight;
		const visibleClaude = this.getVisibleClaudeTerminalInstance();
		for (const instance of this.terminalService.instances) {
			if (instance === visibleClaude && claudeHostWidth > 0 && claudeHostHeight > 0) {
				instance.layout(new Dimension(claudeHostWidth, claudeHostHeight));
				continue;
			}
			const container = instance.domElement?.parentElement;
			const measuredWidth = container instanceof HTMLElement ? container.clientWidth : 0;
			const measuredHeight = container instanceof HTMLElement ? container.clientHeight : 0;
			const width = measuredWidth > 0 ? measuredWidth : fallbackWidth;
			const height = measuredHeight > 0 ? measuredHeight : fallbackHeight;
			instance.layout(new Dimension(width, height));
		}
	}

	/**
	 * Surface Dev terminals are often created while Console UI has `.monaco-grid-view` at
	 * `display:none`. Without activate + reveal + a real layout, the PTY stays ~16 cols and
	 * `npm run dev` banners wrap forever. Mirror DevServerService's wait-for-width pattern.
	 */
	private async prepareTerminalForCommandOutput(instance: ITerminalInstance, minCols = 40, timeoutMs = 1500): Promise<void> {
		this.terminalService.setActiveInstance(instance);
		await this.terminalService.revealTerminal(instance, true);
		this.relayoutTerminalInstances();
		if (instance.cols >= minCols) {
			return;
		}
		await new Promise<void>(resolve => {
			let settled = false;
			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				mainWindow.clearInterval(poll);
				mainWindow.clearTimeout(timer);
				resolve();
			};
			const poll = mainWindow.setInterval(() => {
				this.relayoutTerminalInstances();
				if (instance.cols >= minCols) {
					finish();
				}
			}, 50);
			const timer = mainWindow.setTimeout(finish, timeoutMs);
		});
		// Last-chance synthetic layout if the grid is still hidden.
		if (instance.cols < minCols) {
			instance.layout(new Dimension(
				Math.max(640, Math.floor(mainWindow.innerWidth * 0.55)),
				Math.max(180, Math.floor(mainWindow.innerHeight * 0.28)),
			));
		}
	}

	private scheduleEmbeddedUiDevServerProbe(): void {
		if (isWeb || this.modeService.getMode() !== 'UI') {
			return;
		}
		// Startup does no probe network work — the first probe waits for the workbench to restore.
		if (this.lifecycleService.phase < LifecyclePhase.Restored) {
			void this.lifecycleService.when(LifecyclePhase.Restored).then(() => this.scheduleEmbeddedUiDevServerProbe());
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
				this.uiDevServerProbeScheduler.schedule(nextProbeDelay(++this.uiDevServerProbeFailures));
			} else {
				this.uiDevServerProbeFailures = 0;
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
			if (!dismissed) {
				this.clearUiChatHideTimer();
				this.scheduleUiChatHide();
			}
			return;
		}
		this._uiChatDismissed = dismissed;
		this.uiContainer.classList.toggle('custom-mode-ui-chat-dismissed', dismissed);
		this.storageService.store(STORAGE_UI_CHAT_DISMISSED, dismissed ? '1' : '0', StorageScope.PROFILE, StorageTarget.USER);
		if (dismissed) {
			this.clearUiChatHideTimer();
			this.endSurfaceSetupHandoff();
		} else {
			this.clearUiChatHideTimer();
			this.scheduleUiChatHide();
		}
		// Actions panel replaced the visible UI chat column; keep the widget hidden for later reuse.
		this.uiChatContainer.classList.remove('visible');
		this.uiChatWidget.setVisible(false);
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
		// UI chat column now hosts Actions; keep the embedded chat widget mounted but not visible.
		this.uiChatContainer.classList.remove('visible');
		const processChatOpen = showProcess && !this._processChatDismissed;
		this.processChatContainer.classList.toggle('visible', processChatOpen);

		if (showUi) {
			this.syncActiveUiChatSurfaceId(this.consoleService.getSurfaces());
			this.updateUiChatNewButtonTitle();
			await this.ensureEmbeddedChatModel('UI', this.getActiveUISurfaceChatKey());
		} else if (showProcess) {
			await this.ensureEmbeddedChatModel('Process');
		}

		this.uiChatWidget.setVisible(false);
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

	private selectUiChatSurfaceAsync(surfaceId: string): Promise<void> {
		this.activeUiChatSurfaceId = surfaceId;
		this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
		this.updateUiChatNewButtonTitle();
		return this.ensureEmbeddedChatModel('UI', surfaceId);
	}

	private setActiveUiChatSurfaceFromSurfaceTab(surfaceId: string): void {
		this.activeUiChatSurfaceId = surfaceId;
		this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
		this.updateUiChatNewButtonTitle();
		if (this.modeService.getMode() === 'UI') {
			void this.ensureEmbeddedChatModel('UI', surfaceId);
		}
	}

	private updateUiChatNewButtonTitle(): void {
		const label = this.getUiChatSurfaceLabel(this.getActiveUISurfaceChatKey());
		const title = localize('customMode.uiChatNewForView', 'New conversation for {0}', label);
		this.uiChatNewButton.title = title;
		this.uiChatNewButton.setAttribute('aria-label', title);
	}

	private async startNewUiChatConversation(): Promise<void> {
		const surfaceId = this.getActiveUISurfaceChatKey();
		this.clearStoredUiChatDraft(surfaceId);
		this.chatSessionManager.createNewUISurfaceSessionResource(surfaceId);
		await this.ensureEmbeddedChatModel('UI', surfaceId);
		this.syncUiChatInputToTaskTreeStep(this.selectedSurfaceTaskTree);
		this.uiChatWidget.focusInput();
	}

	async refreshEmbeddedChatForCurrentMode(): Promise<void> {
		await this.updateEmbeddedChat(this.modeService.getMode());
	}

	/**
	 * Switch to Console/UI, select the surface tab, and show its task tree.
	 * Returns false when the surface is not in the workspace manifest.
	 */
	viewSurfaceTab(surfaceId: string): boolean {
		const surface = this.consoleService.getSurface(surfaceId);
		if (!surface) {
			return false;
		}
		this.modeService.setMode('UI');
		this.selectGoalSurface(surface.id);
		this.setSurfaceMainView('plan');
		return true;
	}

	getPreferredChatWidgetForTerminalAttachment(): ChatWidget | undefined {
		const mode = this.modeService.getMode();
		if (mode === 'UI' && !this._uiChatDismissed) {
			return this.uiChatWidget;
		}
		if (mode === 'Process' && !this._processChatDismissed) {
			return this.processChatWidget;
		}
		return undefined;
	}

	private uiChatDraftStorageKey(surfaceId: string): string {
		return `${STORAGE_UI_CHAT_DRAFT_PREFIX}${surfaceId}`;
	}

	private clearStoredUiChatDraft(surfaceId: string): void {
		this.storageService.remove(this.uiChatDraftStorageKey(surfaceId), StorageScope.WORKSPACE);
	}

	private clearTransientUiChatAttachments(): void {
		try {
			if (!this.embeddedChatRefs.UI.value) {
				return;
			}
			const attachmentModel = this.uiChatWidget.input.attachmentModel;
			const toDelete = attachmentModel.attachments
				.filter(a => a.id.startsWith('surface-handoff:') || a.id.startsWith('vscode-ui-map:'))
				.map(a => a.id);
			if (toDelete.length > 0) {
				attachmentModel.delete(...toDelete);
			}
		} catch {
			// Chat session may not be bound yet.
		}
	}

	/**
	 * Keep the shared UI chat composer aligned with the selected surface's current task-tree step.
	 * Also clears handoff/UI-map chips so another surface's context cannot linger.
	 */
	private syncUiChatInputToTaskTreeStep(tree?: AgentTaskTree): void {
		try {
			if (!this.embeddedChatRefs.UI.value) {
				return;
			}
			this.clearTransientUiChatAttachments();
			const activeSurfaceId = this.getActiveUISurfaceChatKey();
			if (activeSurfaceId === ADD_SURFACE_ID) {
				this.uiChatWidget.setInput('');
				return;
			}
			const stepTree = tree?.surfaceId === activeSurfaceId
				? tree
				: (this.selectedSurfaceTaskTree?.surfaceId === activeSurfaceId ? this.selectedSurfaceTaskTree : undefined);
			const step = stepTree ? resolveCurrentTaskTreeStep(stepTree) : undefined;
			this.uiChatWidget.setInput(step && stepTree ? buildTaskPrompt(stepTree, step) : '');
		} catch {
			// Chat session may not be bound yet.
		}
	}

	private async syncUiChatInputForSurface(surfaceId: string): Promise<void> {
		if (surfaceId === ADD_SURFACE_ID) {
			this.syncUiChatInputToTaskTreeStep(undefined);
			return;
		}
		const tree = this.selectedSurfaceTaskTree?.surfaceId === surfaceId
			? this.selectedSurfaceTaskTree
			: await this.agentTaskTreeService.loadLatestTaskTreeForSurface(surfaceId);
		this.syncUiChatInputToTaskTreeStep(tree);
	}

	private async ensureEmbeddedChatModel(mode: 'UI' | 'Process', surfaceId?: string): Promise<void> {
		const token = this.chatSessionsCts.token;
		const resolvedSurfaceId = mode === 'UI' ? (surfaceId ?? this.getActiveUISurfaceChatKey()) : undefined;
		const previousBoundSurfaceId = mode === 'UI' ? this.boundUiChatSurfaceId : undefined;
		const previousSessionResource = mode === 'UI' ? this.embeddedChatRefs.UI.value?.object.sessionResource : undefined;
		const surfaceChanged = mode === 'UI' && resolvedSurfaceId !== undefined && resolvedSurfaceId !== previousBoundSurfaceId;

		const resource = mode === 'UI'
			? this.chatSessionManager.getOrCreateUISurfaceSessionResource(resolvedSurfaceId!)
			: this.chatSessionManager.getOrCreateSessionResource(mode);
		const ref = await this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, token, `ModeShellContribution#ensureEmbeddedChatModel(${mode})`);
		if (!ref) {
			return;
		}

		const holder = this.embeddedChatRefs[mode];
		const widget = mode === 'UI' ? this.uiChatWidget : this.processChatWidget;
		const sessionChanged = mode === 'UI' && (!previousSessionResource || !isEqual(previousSessionResource, ref.object.sessionResource));

		if (mode === 'UI' && (surfaceChanged || sessionChanged) && holder.value) {
			// Flush the outgoing unsent draft into its input model before releasing the ref.
			widget.setModel(undefined);
		}

		holder.value?.dispose();
		holder.value = ref;
		widget.setModel(ref.object);

		if (mode === 'UI' && resolvedSurfaceId !== undefined) {
			this.boundUiChatSurfaceId = resolvedSurfaceId;
			if (sessionChanged && !surfaceChanged) {
				this.clearStoredUiChatDraft(resolvedSurfaceId);
			}
			if (surfaceChanged || sessionChanged) {
				await this.syncUiChatInputForSurface(resolvedSurfaceId);
			}
		}
	}

	private refreshUiChatTabsAndSession(): void {
		const surfaces = this.consoleService.getSurfaces();
		this.syncActiveUiChatSurfaceId(surfaces);
		this.updateUiChatNewButtonTitle();
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
		const createPanel = $('div.custom-mode-ui-surface-create-panel', undefined,
			$('div.custom-mode-ui-surface-create-panel-title', undefined, localize('customMode.surfaceCreatePanelTitle', 'Create Surface')),
			$('div.custom-mode-ui-surface-create-panel-body', undefined,
				this.createDescribeAppCard(),
				$('div.custom-mode-ui-surface-create-separator', {
					role: 'separator',
					'aria-orientation': 'vertical',
				}),
				this.createImportRepoCard(),
			),
		);
		// 2-col grid: Create Surface occupies one card slot; workspace suggestions render above.
		const starterGrid = $('div.custom-mode-ui-surface-starter-grid', undefined, createPanel);
		this.uiSurfaceCreateChooser = starterGrid;
		this.uiSurfaceDescribeCompose = this.createDescribeAppCompose();
		this.uiSurfaceCreateHost = $('div.custom-mode-ui-surface-create-host', undefined,
			this.uiSurfaceCreateChooser,
			this.uiSurfaceDescribeCompose,
		);
		this.uiWorkspacePlanStrip = this.createWorkspacePlanStrip();
		this.uiWorkspaceSurfacesHost = this.createWorkspaceSurfacesHost();
		this.uiWorkspaceSuggestedHost = this.createWorkspaceSuggestedHost();
		this.uiStartAllSurfacesButton = $('button.custom-mode-start-all-surfaces', { type: 'button' }, localize('customMode.startAllSurfaces', 'Start all surfaces')) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiStartAllSurfacesButton, 'click', () => void this.startAllSurfacesFromActions()));
		const surfacesTitle = $('div.custom-mode-ui-surface-surfaces-title', undefined, localize('customMode.surfaceSetupStartersTitle', 'Surfaces'));

		this.uiSurfaceSetupGoalNameInput = $('input.custom-mode-ui-surface-goal-input', {
			type: 'text',
			value: DEFAULT_WORKSPACE_PLAN_BUSINESS_NAME,
			placeholder: localize('customMode.surfaceSetupGoalNamePlaceholder', 'e.g. Summit Coaching Co.'),
			'aria-label': localize('customMode.surfaceSetupGoalNameAria', 'Business name'),
		}) as HTMLInputElement;
		this.uiSurfaceSetupGoalDescriptionInput = $('textarea.custom-mode-ui-surface-goal-textarea', {
			placeholder: localize('customMode.surfaceSetupGoalDescriptionPlaceholder', 'Describe what this business does and who it serves.'),
			'aria-label': localize('customMode.surfaceSetupGoalDescriptionAria', 'Business description'),
			rows: '3',
		}) as HTMLTextAreaElement;
		this._register(addDisposableListener(this.uiSurfaceSetupGoalNameInput, 'input', () => {
			this.scheduleSurfaceSetupAutosave();
			this.syncWorkspaceHomeView();
		}));
		this._register(addDisposableListener(this.uiSurfaceSetupGoalDescriptionInput, 'input', () => this.scheduleSurfaceSetupAutosave()));

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

		this.uiWorkspacePlanHomePanel = this.createConsoleHomeSectionPanel(
			'workspacePlan',
			localize('customMode.workspacePlanSectionTitle', 'Plan'),
			[
				$('div.custom-mode-ui-workspace-surfaces', undefined,
					$('div.custom-mode-ui-workspace-surfaces-header', undefined,
						$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspacePlanSectionSubtitle', 'Workspace plan')),
					),
					$('label.custom-mode-ui-surface-goal-field', undefined,
						this.uiSurfaceSetupGoalNameInput
					),
					this.uiWorkspacePlanStrip,
				),
			],
			{ extraClassName: 'custom-mode-ui-workspace-plan-home' },
		);

		this.uiSurfaceSetupSurfacesBody = this.createConsoleHomeSectionPanel(
			'surfaces',
			localize('customMode.surfaceSetupStartersTitle', 'Surfaces'),
			[
				// Order: real workspace surfaces → suggested → Create Surface.
				this.uiWorkspaceSurfacesHost,
				this.uiWorkspaceSuggestedHost,
				this.uiSurfaceCreateHost,
			],
			{
				extraClassName: 'custom-mode-ui-surface-surfaces-body',
				elementId: 'surface-setup-surfaces-body',
				headerActions: $('div.custom-mode-ui-surface-starters-header-actions', undefined,
					this.uiStartAllSurfacesButton,
					this.uiClearAllSurfacesBtn,
				),
				titleEl: surfacesTitle,
			},
		);

		const rulesBody = $('div.custom-mode-ui-workspace-claude-md-body');
		this.uiWorkspaceClaudeMdPanelRoot = this.createConsoleHomeSectionPanel(
			'claudeMd',
			localize('customMode.workspaceRulesSectionTitle', 'Rules'),
			[
				$('div.custom-mode-ui-workspace-surfaces', undefined,
					$('div.custom-mode-ui-workspace-surfaces-header', undefined,
						$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspaceRulesSectionSubtitle', 'Workspace agent agreement')),
					),
					rulesBody,
				),
			],
			{ extraClassName: 'custom-mode-ui-workspace-claude-md-panel' },
		);
		this.workspaceClaudeMdPanel = this._register(new SurfaceClaudeMdPanel(rulesBody, this.fileService));

		this.uiWorkspaceDescriptionPanel = this.createWorkspaceDescriptionPanel();
		this.uiWorkspaceHowItWorksPanel = this.createHowItWorksPanel();
		this.uiWorkspaceDockerPanel = this.createDockerPanel();

		this.uiWorkspacePlanBrandFields = this.createConsoleHomeSectionPanel(
			'branding',
			localize('customMode.workspaceBrandSectionTitle', 'Brand'),
			[
				$('div.custom-mode-ui-workspace-surfaces', undefined,
					$('div.custom-mode-ui-workspace-surfaces-header', undefined,
						$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspaceBrandSectionSubtitle', 'Identity')),
					),
					$('label.custom-mode-ui-surface-goal-field', undefined,
						$('span.custom-mode-ui-surface-goal-label', undefined, localize('customMode.surfaceSetupGoalDescriptionLabel', 'Description')),
						this.uiSurfaceSetupGoalDescriptionInput
					),
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
					brandColors,
				),
			],
			{ extraClassName: 'custom-mode-ui-surface-business-context' },
		);

		this.uiParallelClaudeWorkstreamsToggle = $('input.custom-mode-ui-workspace-settings-checkbox', {
			type: 'checkbox',
			'aria-label': localize('customMode.parallelClaudeWorkstreamsAria', 'Parallel Claude workstreams'),
		}) as HTMLInputElement;
		this.uiParallelClaudeWorkstreamsToggle.checked = this.isParallelClaudeWorkstreamsEnabled();
		this._register(addDisposableListener(this.uiParallelClaudeWorkstreamsToggle, 'change', () => {
			this.setParallelClaudeWorkstreamsEnabled(this.uiParallelClaudeWorkstreamsToggle.checked);
		}));
		const settingsOrchestrator = this.createAgentOrchestratorProviderPicker();
		this.uiSettingsAgentOrchestratorProviderGroup = settingsOrchestrator.root;
		this.uiSettingsAgentOrchestratorProviderInputs = settingsOrchestrator.inputs;
		const settingsOpenAiKeyRow = this.createOpenAiCompatibleKeyRow();
		this.uiSettingsOpenAiKeyRow = settingsOpenAiKeyRow.root;
		this.uiSettingsOpenAiKeyStatusEl = settingsOpenAiKeyRow.statusEl;
		const settingsAnthropicKeyRow = this.createAnthropicKeyRow();
		this.uiSettingsAnthropicKeyStatusEl = settingsAnthropicKeyRow.statusEl;
		this.uiWorkspaceSettingsPanel = this.createConsoleHomeSectionPanel(
			'settings',
			localize('customMode.workspaceSettingsSectionTitle', 'Settings'),
			[
				$('div.custom-mode-ui-workspace-surfaces', undefined,
					$('div.custom-mode-ui-workspace-surfaces-header', undefined,
						$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspaceSettingsOrchestratorTitle', 'Agent orchestrator')),
					),
					this.uiSettingsAgentOrchestratorProviderGroup,
					settingsOpenAiKeyRow.root,
					settingsAnthropicKeyRow.root,
					$('div.custom-mode-ui-workspace-surfaces-header', undefined,
						$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspaceSettingsSectionSubtitle', 'Claude execution')),
					),
					$('label.custom-mode-ui-workspace-settings-row', undefined,
						this.uiParallelClaudeWorkstreamsToggle,
						$('span.custom-mode-ui-workspace-settings-copy', undefined,
							$('span.custom-mode-ui-workspace-settings-label', undefined, localize('customMode.parallelClaudeWorkstreamsLabel', 'Parallel Claude workstreams')),
							$('span.custom-mode-ui-workspace-settings-hint', undefined, localize(
								'customMode.parallelClaudeWorkstreamsHint',
								'Planning still shows parallel streams. When off, generate uses one Claude per surface.',
							)),
						),
					),
				),
			],
			{ extraClassName: 'custom-mode-ui-surface-business-context' },
		);
		this.syncAgentOrchestratorProviderPicker();
		void this.syncAnthropicKeyStatus();
		void this.syncOpenAiCompatibleKeyStatus();
		this.syncOrchestratorCredentialRows();

		this.uiConsoleStatusRail = $('div.custom-mode-surface-plan-status-rail', {
			role: 'list',
			'aria-label': localize('customMode.consoleWorkflowProgressRail', 'Console lifecycle progress'),
		});
		this.uiConsoleStatusNextActionButton = $('button.custom-mode-surface-plan-status-next-action.hidden', {
			type: 'button',
		}) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiConsoleStatusNextActionButton, 'click', () => {
			if (this.uiConsoleStatusNextActionButton.dataset.actionId === 'start_apps') {
				void this.startAllSurfacesFromActions();
			}
		}));
		this.uiConsolePreflightPill = $('button.custom-mode-console-preflight.hidden', {
			type: 'button',
		}) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiConsolePreflightPill, 'click', () => {
			// Only actionable while blocked: open the Docker section for setup guidance,
			// peeking past the first-run hero if it is currently hiding the sections.
			if (this.uiConsoleHomeHost?.classList.contains('custom-mode-first-run')) {
				this.consoleFirstRunDockerPeek = true;
			}
			this.openConsoleWithSection('docker');
			this.renderConsoleWorkflowProgress();
		}));
		this.uiConsoleStatusTracker = $('div.custom-mode-surface-plan-status-tracker.hidden', {
			'aria-live': 'polite',
		}, this.uiConsoleStatusRail, this.uiConsoleStatusNextActionButton, this.uiConsolePreflightPill);
		const onConsoleStatusWheel = (event: WheelEvent) => this.handleConsoleStatusRailWheel(event);
		this._register(addDisposableListener(this.uiConsoleStatusRail, 'wheel', onConsoleStatusWheel, { capture: true, passive: false }));
		this._register(addDisposableListener(this.uiConsoleStatusTracker, 'wheel', onConsoleStatusWheel, { capture: true, passive: false }));
		// Capture on the Steps host so padding / chevrons still pan the visible rail.
		this._register(addDisposableListener(this.uiStepsHost, 'wheel', onConsoleStatusWheel, { capture: true, passive: false }));
		this._register(addDisposableListener(this.uiStepsPane, 'wheel', onConsoleStatusWheel, { capture: true, passive: false }));
		this.uiBabadabaStepsParent = $('div.custom-mode-babadaba-steps-parent', undefined,
			localize('customMode.babadabaStepsParent', 'Babadaba'),
			$('span.custom-mode-babadaba-steps-parent-detail', undefined,
				localize('customMode.babadabaStepsParentDetail', ' · Workspace manager')),
		);
		this.uiBabadabaStepsChildren = $('div.custom-mode-babadaba-steps-children', {
			role: 'list',
			'aria-label': localize('customMode.babadabaStepsChildrenAria', 'Systems Babadaba manages'),
		});
		this.uiBabadabaSteps = $('div.custom-mode-babadaba-steps.hidden', {
			'aria-label': localize('customMode.babadabaStepsAria', 'Babadaba workspace manager'),
		}, this.uiBabadabaStepsParent, this.uiBabadabaStepsChildren);
		// Console Steps share the shell top panel with Surface plan Steps.
		this.uiStepsHost.appendChild(this.uiBabadabaSteps);
		this.uiStepsHost.appendChild(this.uiConsoleStatusTracker);
		this.uiConsoleStatusLabel = $('div.custom-mode-ui-console-home-status');
		// Babadaba stage: workspace-manager hub (surfaces + integrations).
		this.uiBabadabaStageHost = $('div.custom-mode-ui-babadaba-stage.hidden');
		this.babadabaStage = this._register(new BabadabaStage(this.uiBabadabaStageHost, () => this.accessibilityService.isMotionReduced()));
		this._register(this.themeService.onDidColorThemeChange(() => this.babadabaStage?.refreshTheme()));
		this._register(this.accessibilityService.onDidChangeReducedMotion(() => this.babadabaStage?.refreshTheme()));
		const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (workspaceRoot) {
			this.fileService.exists(joinPath(workspaceRoot, '.git')).then(exists => {
				this.workspaceHasGitRepo = exists;
				this.renderConsoleWorkflowProgress();
			}, () => undefined);
		}
		// Stack order matches Console section rail cards: Surfaces (default) → Description → Docker → Plan → Rules → Dev Loop → Brand → Settings.
		this.uiConsoleSectionHost = $('div.custom-mode-ui-console-section-host', undefined,
			this.uiBabadabaStageHost,
			this.uiSurfaceSetupSurfacesBody,
			this.uiWorkspaceDescriptionPanel,
			this.uiWorkspaceDockerPanel,
			this.uiWorkspacePlanHomePanel,
			this.uiWorkspaceClaudeMdPanelRoot,
			this.uiWorkspaceHowItWorksPanel,
			this.uiWorkspacePlanBrandFields,
			this.uiWorkspaceSettingsPanel,
		);
		this.uiConsoleFirstRunHero = this.createConsoleFirstRunHero();
		this.uiConsoleHomeHost = $('div.custom-mode-ui-console-home', undefined,
			this.uiConsoleStatusLabel,
			this.uiConsoleFirstRunHero,
			this.uiConsoleSectionHost,
		);

		// Surfaces is always the Workspace landing section (do not restore Plan/Brand/etc. across reloads).
		this.workspaceHomeView = CONSOLE_HOME_DEFAULT_SECTION;
		this.storageService.store(STORAGE_WORKSPACE_HOME_VIEW, CONSOLE_HOME_DEFAULT_SECTION, StorageScope.WORKSPACE, StorageTarget.USER);
		this.storageService.store(STORAGE_CONSOLE_SECTION, CONSOLE_HOME_DEFAULT_SECTION, StorageScope.WORKSPACE, StorageTarget.USER);
		const storedConsoleExpanded = this.storageService.get(STORAGE_CONSOLE_EXPANDED, StorageScope.WORKSPACE);
		this.consoleExpanded = storedConsoleExpanded !== '0';
		this.activeRailCardId = this.consoleExpanded
			? `consoleSection:${CONSOLE_HOME_DEFAULT_SECTION}`
			: 'console';

		// Recover the workbench grid if a prior session left it inside a removed in-canvas Code host.
		const strandedGrid = this.container.querySelector('.custom-mode-ui-workspace-code-panel > .monaco-grid-view');
		if (strandedGrid instanceof HTMLElement) {
			this.container.appendChild(strandedGrid);
			this.container.classList.remove('custom-mode-canvas-code');
			this.scheduleWorkbenchRelayout();
		}

		const storedRailWidth = Number(this.storageService.get(STORAGE_CARD_RAIL_WIDTH, StorageScope.PROFILE));
		this.uiWorkspaceHomeCardRail = createCardRailLayout({
			ariaLabel: localize('customMode.workspaceHomeTabs', 'Workspace home views'),
			className: 'custom-mode-ui-workspace-home-rail',
			activeId: this.consoleExpanded ? `consoleSection:${this.workspaceHomeView}` : 'console',
			width: Number.isFinite(storedRailWidth) ? clampCardRailWidth(storedRailWidth) : CARD_RAIL_DEFAULT_WIDTH,
			autoHideMs: CARD_RAIL_AUTO_HIDE_MS,
			revealLabel: localize('customMode.consoleEdgeTab', 'Console'),
			onCollapsedChange: collapsed => this.onConsoleRailCollapsedChange(collapsed),
			onWidthChange: width => {
				this.storageService.store(STORAGE_CARD_RAIL_WIDTH, String(width), StorageScope.PROFILE, StorageTarget.USER);
				// Settled resize may cross the narrow threshold (1↔2 surface columns),
				// which changes where section cards insert under a title-card row.
				this.refreshWorkspaceHomeRailCardsOnly();
			},
			onOpenHref: url => {
				void this.openerService.open(URI.parse(url), { openExternal: true });
			},
			onGroupLabelAction: anchor => this.toggleWorkspaceSwitcherMenu(anchor),
			cards: this.getWorkspaceHomeCards(),
			onHoverParent: id => this.onWorkspaceHomeRailHoverParent(id),
			onSelect: id => {
				const hoverParentAtClick = this.hoveredRailParentId;
				this.clearHoveredRailParent({ immediate: true });
				if (id === 'code') {
					this.openCodeTab();
					return;
				}
				if (id === 'console') {
					this.onSelectConsoleCard();
					return;
				}
				if (id === 'newSurface:describe') {
					this.openNewSurfaceDescribe();
					return;
				}
				if (id === 'newSurface:import') {
					this.openNewSurfaceImport();
					return;
				}
				if (id.startsWith('consoleSection:')) {
					const sectionId = id.slice('consoleSection:'.length);
					if (!isWorkspaceHomeView(sectionId)) {
						return;
					}
					this.consoleExpanded = true;
					this.persistConsoleExpanded();
					this.activeRailCardId = id;
					this.deselectSurfaceForHomeRail();
					this.setWorkspaceHomeView(sectionId);
					// Keep Console parent selected with the section subcard (same pattern as SURFACE + Plan).
					this.uiWorkspaceHomeCardRail.setActiveId(id, ['console']);
					return;
				}
				if (id.startsWith('surfaceSection:')) {
					const sectionId = id.slice('surfaceSection:'.length);
					if (!sectionId) {
						return;
					}
					const hoverSurfaceId = surfaceIdFromRailParentId(hoverParentAtClick ?? '');
					const openSurfaceId = this.getOpenSurfaceId();
					if (hoverSurfaceId && hoverSurfaceId !== openSurfaceId) {
						this.activeRailCardId = `surfaceSection:${sectionId}`;
						void this.openWorkspaceSuggestedSurfacePlan(hoverSurfaceId, { preferSectionId: sectionId });
						return;
					}
					if (openSurfaceId) {
						this.selectSurfaceSectionCard(openSurfaceId, sectionId);
					} else {
						this.activeRailCardId = id;
						this.uiWorkspaceHomeCardRail.setActiveId(id, []);
						this.surfaceMainView = isLiveSurfaceRailSection(sectionId) ? 'preview' : 'plan';
						this.syncSurfaceMainView();
						this.surfacePlanPanel?.selectSection(sectionId);
					}
					return;
				}
				if (id.startsWith('surface:')) {
					const surfaceId = id.slice('surface:'.length);
					if (!surfaceId) {
						return;
					}
					if (this.selectedSurfaceId === surfaceId) {
						// Selecting the open surface again collapses its section cards and returns to Console Surfaces.
						this.openConsoleWithSection(CONSOLE_HOME_DEFAULT_SECTION);
						return;
					}
					this.activeRailCardId = id;
					void this.openWorkspaceSuggestedSurfacePlan(surfaceId);
				}
			},
			content: [
				this.uiConsoleHomeHost,
				this.uiSurfacePlanPanelRoot,
				this.uiSurfaceLaunchPanel,
				this.uiSurfaceEmptyState,
			],
		});
		this._register({ dispose: () => {
			this.closeWorkspaceSwitcherMenu();
			this.uiWorkspaceHomeCardRail.dispose();
		} });
		// Landing/empty copy may have been set before the rail mounted — keep the rail
		// pinned open in that case instead of arming the mount-time hide clock.
		this.uiWorkspaceHomeCardRail.setAutoHideEnabled(this.uiSurfaceEmptyState.classList.contains('hidden'));

		for (const [step, section] of [
			['goal', this.uiWorkspacePlanHomePanel],
			['brand', this.uiWorkspacePlanBrandFields],
			['surfaces', this.uiSurfaceSetupSurfacesBody],
		] as const) {
			this.uiSurfaceSetupSections.set(step, section);
		}

		this.uiSurfaceSetupMain = $('div.custom-mode-ui-surface-setup-main', undefined,
			this.uiWorkspaceHomeCardRail.root,
		);
		this.syncWorkspaceHomeView();
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

	private createWorkspacePlanStrip(): HTMLElement {
		this.uiWorkspacePlanIntentInput = $('textarea.custom-mode-ui-workspace-plan-intent', {
			rows: '3',
			placeholder: localize(
				'customMode.workspacePlanIntentPlaceholder',
				'Optional: what should this workspace become? Or just drop a planning PDF…',
			),
			'aria-label': localize('customMode.workspacePlanIntentAria', 'Workspace planning intent'),
		}) as HTMLTextAreaElement;
		this.uiWorkspacePlanIntentInput.value = DEFAULT_WORKSPACE_PLAN_INTENT;
		this.uiWorkspacePlanAttachmentList = $('div.custom-mode-ui-workspace-plan-attachments');
		this.uiWorkspacePlanSubmitButton = $('button.custom-mode-ui-workspace-plan-submit', {
			type: 'button',
		}, localize('customMode.workspacePlanSubmit', 'Start workspace planning')) as HTMLButtonElement;

		const fileInput = $('input', { type: 'file', accept: '.pdf,application/pdf,image/*,.doc,.docx,.md,.txt', hidden: 'true', multiple: 'true' }) as HTMLInputElement;
		const fileButton = $('button.custom-mode-ui-surface-describe-media-btn', {
			type: 'button',
		},
			$('span.codicon' + ThemeIcon.asCSSSelector(Codicon.symbolFile)),
			localize('customMode.workspacePlanAddFile', 'PDF / file'),
		) as HTMLButtonElement;
		this._register(addDisposableListener(fileButton, 'click', () => fileInput.click()));
		this._register(addDisposableListener(fileInput, 'change', () => {
			void this.addWorkspacePlanFiles(fileInput.files);
			fileInput.value = '';
		}));
		this._register(addDisposableListener(this.uiWorkspacePlanSubmitButton, 'click', () => void this.onWorkspacePlanSubmitClick()));
		this._register(addDisposableListener(this.uiWorkspacePlanIntentInput, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void this.onWorkspacePlanSubmitClick();
			}
		}));

		this.uiWorkspacePlanAnalysisHistorySummary = $('summary', undefined,
			localize('customMode.workspacePlanAnalysisHistoryTitle', 'Previous analyses'),
		);
		this.uiWorkspacePlanAnalysisHistoryBody = $('div.custom-mode-ui-workspace-plan-analysis-history-body');
		this.uiWorkspacePlanAnalysisHistory = $('details.custom-mode-ui-workspace-plan-analysis-history', undefined,
			this.uiWorkspacePlanAnalysisHistorySummary,
			this.uiWorkspacePlanAnalysisHistoryBody,
		) as HTMLDetailsElement;

		const root = $('div.custom-mode-ui-workspace-plan', undefined,
			$('div.custom-mode-ui-workspace-plan-hint', undefined, localize(
				'customMode.workspacePlanHint',
				'Edit the brief anytime. Start planning to propose surfaces; after a plan exists, Kickoff analysis grades how well this repo implements it.',
			)),
			this.uiWorkspacePlanIntentInput,
			$('div.custom-mode-ui-workspace-plan-footer', undefined,
				this.uiWorkspacePlanAttachmentList,
				$('div.custom-mode-ui-workspace-plan-actions', undefined, fileButton, fileInput, this.uiWorkspacePlanSubmitButton),
			),
			this.uiWorkspacePlanAnalysisHistory,
		);
		this.syncWorkspacePlanSubmitButton();
		void this.refreshWorkspacePlanAnalysisHistory();
		this._register(addDisposableListener(root, 'dragenter', event => {
			if (!this.dragEventHasFiles(event)) {
				return;
			}
			event.preventDefault();
			root.classList.add('dragover');
		}));
		this._register(addDisposableListener(root, 'dragover', event => {
			if (!this.dragEventHasFiles(event)) {
				return;
			}
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
			root.classList.add('dragover');
		}));
		this._register(addDisposableListener(root, 'dragleave', event => {
			const related = event.relatedTarget;
			if (related instanceof Node && root.contains(related)) {
				return;
			}
			root.classList.remove('dragover');
		}));
		this._register(addDisposableListener(root, 'drop', event => {
			event.preventDefault();
			root.classList.remove('dragover');
			const files = event.dataTransfer?.files;
			if (files?.length) {
				void this.addWorkspacePlanFiles(files);
			}
		}));
		return root;
	}

	/**
	 * First-run hero: the goal composer leads, example workspaces support.
	 * Shown instead of the Console section stack until the workspace produces
	 * its first planning artifact (see {@link shouldShowConsoleFirstRun}).
	 */
	private createConsoleFirstRunHero(): HTMLElement {
		this.uiFirstRunBriefInput = $('textarea.custom-mode-ui-first-run-brief', {
			rows: '4',
			placeholder: localize(
				'customMode.firstRunBriefPlaceholder',
				'e.g. A boutique pilates studio that sells class packages online, takes bookings for sessions, and needs a simple marketing site to bring in new clients…',
			),
			'aria-label': localize('customMode.firstRunBriefAria', 'Describe your business'),
		}) as HTMLTextAreaElement;
		this._register(addDisposableListener(this.uiFirstRunBriefInput, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void this.onFirstRunSubmit();
			}
		}));

		const fileInput = $('input', { type: 'file', accept: '.pdf,application/pdf,image/*,.doc,.docx,.md,.txt', hidden: 'true', multiple: 'true' }) as HTMLInputElement;
		const attachButton = $('button.custom-mode-ui-first-run-attach', {
			type: 'button',
		},
			$('span.codicon' + ThemeIcon.asCSSSelector(Codicon.symbolFile)),
			localize('customMode.firstRunAttach', 'Attach a brief — PDF, images, files'),
		) as HTMLButtonElement;
		this._register(addDisposableListener(attachButton, 'click', () => fileInput.click()));
		this._register(addDisposableListener(fileInput, 'change', () => {
			void this.addWorkspacePlanFiles(fileInput.files);
			fileInput.value = '';
		}));
		this.uiFirstRunAttachmentsNote = $('span.custom-mode-ui-first-run-attach-note');

		const submitButton = $('button.custom-mode-ui-first-run-submit', {
			type: 'button',
		}, localize('customMode.firstRunSubmit', 'Start planning')) as HTMLButtonElement;
		this._register(addDisposableListener(submitButton, 'click', () => void this.onFirstRunSubmit()));

		this.uiFirstRunComposer = $('div.custom-mode-ui-first-run-composer', undefined,
			this.uiFirstRunBriefInput,
			$('div.custom-mode-ui-first-run-composer-foot', undefined,
				attachButton,
				fileInput,
				this.uiFirstRunAttachmentsNote,
				submitButton,
			),
		);

		const importButton = $('button.custom-mode-ui-first-run-import', {
			type: 'button',
		}, localize('customMode.firstRunImport', 'Import an existing repo instead')) as HTMLButtonElement;
		this._register(addDisposableListener(importButton, 'click', () => void this.importSurfaceRepo()));

		const cards = consoleExampleBriefs().map(example => {
			const card = $('button.custom-mode-ui-first-run-card', {
				type: 'button',
				title: localize('customMode.firstRunCardTitle', 'Fill the brief with this example'),
			},
				$('div.custom-mode-ui-first-run-card-title', undefined, example.title),
				$('div.custom-mode-ui-first-run-card-goal', undefined, example.goal),
				$('div.custom-mode-ui-first-run-card-chips', undefined,
					...example.surfaces.map(surface => $('span.custom-mode-ui-first-run-chip', undefined, surface)),
				),
			) as HTMLButtonElement;
			this._register(addDisposableListener(card, 'click', () => this.applyFirstRunExample(example.brief)));
			return card;
		});

		return $('div.custom-mode-ui-first-run.hidden', undefined,
			$('div.custom-mode-ui-first-run-head', undefined,
				$('div.custom-mode-ui-first-run-title', undefined, localize('customMode.firstRunTitle', 'What are you building?')),
				$('div.custom-mode-ui-first-run-sub', undefined, localize(
					'customMode.firstRunSub',
					'Describe the business in your own words. Console drafts a plan, proposes the apps to build — your surfaces — and runs them for you.',
				)),
			),
			this.uiFirstRunComposer,
			$('div.custom-mode-ui-first-run-alt', undefined,
				$('span', undefined, localize('customMode.firstRunAltPrefix', 'Already have code?')),
				importButton,
			),
			$('div.custom-mode-ui-first-run-gallery', undefined,
				$('div.custom-mode-ui-first-run-gallery-head', undefined,
					$('div.custom-mode-ui-first-run-gallery-title', undefined, localize('customMode.firstRunGalleryTitle', 'Or explore an example')),
					$('span.custom-mode-ui-first-run-gallery-hint', undefined, localize(
						'customMode.firstRunGalleryHint',
						'Selecting one fills in the brief — edit anything before you start.',
					)),
				),
				$('div.custom-mode-ui-first-run-cards', undefined, ...cards),
			),
		);
	}

	private applyFirstRunExample(brief: string): void {
		this.uiFirstRunBriefInput.value = brief;
		this.uiFirstRunBriefInput.focus();
		this.uiFirstRunComposer.classList.add('flash');
		this.firstRunFlashTimer.value = disposableTimeout(() => this.uiFirstRunComposer.classList.remove('flash'), 900);
	}

	private async onFirstRunSubmit(): Promise<void> {
		const brief = this.uiFirstRunBriefInput.value.trim();
		if (!brief && this.workspacePlanAttachments.length === 0) {
			this.notificationService.warn(localize(
				'customMode.firstRunBriefRequired',
				'Add a brief description or attach a planning file before starting.',
			));
			this.uiFirstRunBriefInput.focus();
			return;
		}
		if (brief) {
			this.uiWorkspacePlanIntentInput.value = brief;
		}
		await this.onWorkspacePlanSubmitClick();
	}

	/** Toggle the first-run hero vs. the Console section stack (progressive disclosure). */
	private syncConsoleFirstRun(signals: ConsoleWorkflowSignals): void {
		if (!this.uiConsoleHomeHost || !this.uiConsoleFirstRunHero) {
			return;
		}
		if (signals.dockerReady !== false) {
			this.consoleFirstRunDockerPeek = false;
		}
		const firstRun = shouldShowConsoleFirstRun(signals) && !this.consoleFirstRunDockerPeek;
		this.uiConsoleHomeHost.classList.toggle('custom-mode-first-run', firstRun);
		this.uiConsoleFirstRunHero.classList.toggle('hidden', !firstRun);
	}

	private createWorkspaceSurfacesHost(): HTMLElement {
		this.uiWorkspaceSurfacesGrid = $('div.custom-mode-ui-workspace-surfaces-grid');
		return $('div.custom-mode-ui-workspace-surfaces.hidden', undefined,
			$('div.custom-mode-ui-workspace-surfaces-header', undefined,
				$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspaceSurfacesTitle', 'Your surfaces')),
			),
			this.uiWorkspaceSurfacesGrid,
		);
	}

	private createWorkspaceSuggestedHost(): HTMLElement {
		this.uiWorkspaceSuggestedGrid = $('div.custom-mode-ui-workspace-suggested-grid');
		this.uiWorkspaceSuggestedCreateButton = $('button.custom-mode-ui-workspace-suggested-create', {
			type: 'button',
		}, localize('customMode.workspaceSuggestedCreate', 'Create selected surfaces')) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiWorkspaceSuggestedCreateButton, 'click', () => void this.createSelectedWorkspaceSurfaces()));
		const host = $('div.custom-mode-ui-workspace-suggested.hidden', undefined,
			$('div.custom-mode-ui-workspace-suggested-header', undefined,
				$('div.custom-mode-ui-workspace-suggested-title', undefined, localize('customMode.workspaceSuggestedTitle', 'Suggested surfaces')),
				this.uiWorkspaceSuggestedCreateButton,
			),
			this.uiWorkspaceSuggestedGrid,
		);
		return host;
	}

	private async addWorkspacePlanFiles(fileList: FileList | null | undefined): Promise<void> {
		if (!fileList?.length) {
			return;
		}
		for (const file of Array.from(fileList)) {
			const buffer = new Uint8Array(await file.arrayBuffer());
			this.workspacePlanAttachments.push({
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				kind: file.type.startsWith('image/') ? 'image' : 'file',
				name: file.name,
				mimeType: file.type || 'application/octet-stream',
				data: buffer,
			});
		}
		this.renderWorkspacePlanAttachments();
	}

	private renderWorkspacePlanAttachments(): void {
		this.workspacePlanAttachmentListeners.clear();
		this.uiWorkspacePlanAttachmentList.replaceChildren();
		if (this.uiFirstRunAttachmentsNote) {
			this.uiFirstRunAttachmentsNote.textContent = this.workspacePlanAttachments.length === 0
				? ''
				: localize('customMode.firstRunAttachCount', '{0} attached', this.workspacePlanAttachments.length);
		}
		for (const attachment of this.workspacePlanAttachments) {
			const remove = $('button.custom-mode-ui-surface-describe-attachment-remove', {
				type: 'button',
				title: localize('customMode.workspacePlanRemoveAttachment', 'Remove {0}', attachment.name),
				'aria-label': localize('customMode.workspacePlanRemoveAttachment', 'Remove {0}', attachment.name),
			}, '\u00d7') as HTMLButtonElement;
			this.workspacePlanAttachmentListeners.add(addDisposableListener(remove, 'click', () => {
				const index = this.workspacePlanAttachments.findIndex(item => item.id === attachment.id);
				if (index >= 0) {
					this.workspacePlanAttachments.splice(index, 1);
					this.renderWorkspacePlanAttachments();
				}
			}));
			this.uiWorkspacePlanAttachmentList.appendChild(
				$('div.custom-mode-ui-surface-describe-attachment', { title: attachment.name },
					$('div.custom-mode-ui-surface-describe-attachment-icon', undefined,
						$('span.codicon' + ThemeIcon.asCSSSelector(Codicon.symbolFile)),
					),
					$('div.custom-mode-ui-surface-describe-attachment-meta', undefined,
						$('span.custom-mode-ui-surface-describe-attachment-name', undefined, attachment.name),
						$('span.custom-mode-ui-surface-describe-attachment-kind', undefined, attachment.kind),
					),
					remove,
				),
			);
		}
	}

	private async onWorkspacePlanSubmitClick(): Promise<void> {
		if (this.hasWorkspacePlanForAnalysis()) {
			await this.submitWorkspacePlanAnalysis();
			return;
		}
		await this.submitWorkspacePlanCompose();
	}

	/** Plan artifacts exist — submit button becomes Kickoff analysis instead of Start planning. */
	private hasWorkspacePlanForAnalysis(): boolean {
		return this.workspacePlanArtifactExists
			|| Boolean(this.workspaceSuggestedSurfaces?.surfaces.length);
	}

	private async submitWorkspacePlanCompose(): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceClaudeNoWorkspace', 'Open a workspace folder before creating a new surface.'));
			return;
		}
		const intent = this.uiWorkspacePlanIntentInput.value.trim();
		if (!intent && this.workspacePlanAttachments.length === 0) {
			this.notificationService.warn(localize(
				'customMode.workspacePlanIntentRequired',
				'Add a brief description or drop a planning PDF before starting workspace planning.',
			));
			this.uiWorkspacePlanIntentInput.focus();
			return;
		}
		if (this.workspacePlanKickoffInFlight || this.isWorkspacePlanningLocked()) {
			return;
		}
		this.workspacePlanKickoffInFlight = true;
		this.workspacePlanSessionActive = false;
		this.syncClaudeReopenAttention();
		this.syncWorkspacePlanSubmitButton();
		this.renderConsoleWorkflowProgress();
		const attachmentsSnapshot = [...this.workspacePlanAttachments];
		try {
			this.logClaudeKickoff(`workspace-plan start attachments=${attachmentsSnapshot.length}`);
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			await this.fileService.createFolder(joinPath(workspaceFolder, '.agent'));
			await this.fileService.createFolder(workspaceAttachmentsDir(workspaceFolder));
			// Re-derive planning from the current brief: the kickoff prompt stops when both
			// artifacts exist, so stale ones from a previous pass would short-circuit it.
			for (const resource of [workspacePlanResource(workspaceFolder), workspaceSuggestedSurfacesResource(workspaceFolder)]) {
				try {
					await this.fileService.del(resource);
				} catch {
					// Missing artifacts are fine on a first run.
				}
			}
			this.workspaceSuggestedSurfaces = undefined;
			this.renderWorkspaceSuggestedSurfaces();
			this.logClaudeKickoff('workspace-plan cleared previous planning artifacts');
			const attachmentPaths: string[] = [];
			const usedNames = new Set<string>();
			for (const attachment of attachmentsSnapshot) {
				const safeName = this.uniqueAttachmentFileName(attachment.name, usedNames);
				usedNames.add(safeName);
				const resource = joinPath(workspaceAttachmentsDir(workspaceFolder), safeName);
				await this.fileService.writeFile(resource, VSBuffer.wrap(attachment.data));
				attachmentPaths.push(`.agent/workspace/attachments/${safeName}`);
			}
			this.logClaudeKickoff(`workspace-plan saved ${attachmentPaths.length} attachment(s)`);

			// Stay on Console home so suggestion cards appear here.
			this.modeService.setMode('UI');
			this.selectedSurfaceId = ADD_SURFACE_ID;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
			this.contextGatheringOpen = true;
			this.persistContextGatheringOpen();
			this.renderGoalSurfaceButtons(this.consoleService.getSurfaces());
			this.syncSurfaceSetupDashboardVisibility();
			this.setAddSurfaceState();
			this.syncContextGatheringUi();

			const prompt = buildWorkspacePlanKickoffPrompt({
				businessName: this.uiSurfaceSetupGoalNameInput.value.trim() || undefined,
				intent,
				attachmentPaths,
			});
			this.logClaudeKickoff(`workspace-plan reset Claude terminal`);
			await this.resetClaudeTerminalSession(WORKSPACE_CLAUDE_KEY);
			this.logClaudeKickoff(`workspace-plan create Claude terminal`);
			const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, WORKSPACE_CLAUDE_KEY, { forceNew: true, reveal: true });
			await terminal.processReady;
			await this.prepareTerminalForCommandOutput(terminal, 40, 2000);
			await terminal.focusWhenReady(true);
			this.relayoutTerminalInstances();
			await timeout(120);
			this.relayoutTerminalInstances();
			this.logClaudeKickoff(`workspace-plan terminal ${created ? 'created' : 'reused'} id=${terminal.instanceId} host=${this.uiClaudeTerminalHost.clientWidth}x${this.uiClaudeTerminalHost.clientHeight} cols=${terminal.cols}`);
			if (created && this.markClaudeCliStarted(WORKSPACE_CLAUDE_KEY)) {
				this.logClaudeKickoff(`workspace-plan send 'claude'`);
				await terminal.sendText('claude', true);
				await timeout(1800);
				this.relayoutTerminalInstances();
			}
			await this.submitClaudePrompt(terminal, prompt);
			if (terminal.isDisposed || terminal.exitReason !== undefined) {
				throw new Error(`Claude terminal exited during kickoff (reason=${terminal.exitReason ?? 'disposed'})`);
			}
			this.logClaudeKickoff(`workspace-plan kickoff submitted (${prompt.length} chars)`);
			this.workspacePlanSessionActive = true;
			this.workspaceSuggestedSurfacesRevealPending = true;
			this.applyClaudeTerminalHeight(Math.max(this.claudeTerminalHeight, CLAUDE_TERMINAL_DEFAULT_HEIGHT), { persist: false });
			this.watchWorkspaceSuggestedSurfaces(workspaceFolder);
			this.renderConsoleWorkflowProgress();
			this.syncClaudeReopenAttention();
			this.notificationService.info(localize(
				'customMode.workspacePlanStarted',
				'Claude is drafting a workspace plan and suggested surfaces. Cards will appear under Surfaces.',
			));
		} catch (error: unknown) {
			this.workspacePlanSessionActive = false;
			this.logClaudeKickoff(`workspace-plan FAILED: ${String((error as Error)?.message ?? error)}`, true);
			this.notificationService.error(localize(
				'customMode.workspacePlanStartFailed',
				'Failed to start workspace planning: {0}',
				String((error as Error)?.message ?? error),
			));
			this.renderConsoleWorkflowProgress();
		} finally {
			this.workspacePlanKickoffInFlight = false;
			this.syncWorkspacePlanSubmitButton();
			this.syncClaudeReopenAttention();
			if (this.workspacePlanSessionActive) {
				this.renderConsoleWorkflowProgress();
			}
		}
	}

	/** True once workspace planning has produced artifacts (or is mid-kickoff / drafting). */
	private isWorkspacePlanningLocked(): boolean {
		return this.workspacePlanKickoffInFlight
			|| this.workspacePlanSessionActive
			|| this.workspacePlanArtifactExists
			|| Boolean(this.workspaceSuggestedSurfaces?.surfaces.length);
	}

	private async submitWorkspacePlanAnalysis(): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceClaudeNoWorkspace', 'Open a workspace folder before creating a new surface.'));
			return;
		}
		if (!this.hasWorkspacePlanForAnalysis()) {
			this.notificationService.warn(localize(
				'customMode.workspacePlanAnalysisNeedsPlan',
				'Start workspace planning first so there is a plan to compare against the repo.',
			));
			return;
		}
		if (this.workspacePlanAnalysisInFlight || this.workspacePlanKickoffInFlight || this.workspacePlanSessionActive) {
			return;
		}
		this.workspacePlanAnalysisInFlight = true;
		this.syncWorkspacePlanSubmitButton();
		try {
			this.logClaudeKickoff('workspace-plan-analysis start');
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			await this.fileService.createFolder(joinPath(workspaceFolder, '.agent'));
			try {
				const archived = await archiveWorkspacePlanAnalysis(this.fileService, workspaceFolder);
				if (archived) {
					this.logClaudeKickoff(`workspace-plan-analysis archived prior report → ${archived.path}`);
				}
			} catch (error: unknown) {
				this.logClaudeKickoff(`workspace-plan-analysis archive skipped: ${String((error as Error)?.message ?? error)}`);
			}
			try {
				await this.fileService.del(workspacePlanAnalysisResource(workspaceFolder));
			} catch {
				// Missing report is fine on a first run.
			}
			void this.refreshWorkspacePlanAnalysisHistory(workspaceFolder);
			const prompt = buildWorkspacePlanAnalysisPrompt({
				businessName: this.uiSurfaceSetupGoalNameInput.value.trim() || undefined,
				intent: this.uiWorkspacePlanIntentInput.value.trim() || undefined,
			});
			this.modeService.setMode('UI');
			await this.resetClaudeTerminalSession(WORKSPACE_CLAUDE_KEY);
			const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, WORKSPACE_CLAUDE_KEY, { forceNew: true, reveal: true });
			await terminal.processReady;
			await this.prepareTerminalForCommandOutput(terminal, 40, 2000);
			await terminal.focusWhenReady(true);
			this.relayoutTerminalInstances();
			await timeout(120);
			this.relayoutTerminalInstances();
			if (created && this.markClaudeCliStarted(WORKSPACE_CLAUDE_KEY)) {
				await terminal.sendText('claude', true);
				await timeout(1800);
				this.relayoutTerminalInstances();
			}
			await this.submitClaudePrompt(terminal, prompt);
			if (terminal.isDisposed || terminal.exitReason !== undefined) {
				throw new Error(`Claude terminal exited during analysis kickoff (reason=${terminal.exitReason ?? 'disposed'})`);
			}
			this.logClaudeKickoff(`workspace-plan-analysis kickoff submitted (${prompt.length} chars)`);
			this.applyClaudeTerminalHeight(Math.max(this.claudeTerminalHeight, CLAUDE_TERMINAL_DEFAULT_HEIGHT), { persist: false });
			this.watchWorkspacePlanAnalysis(workspaceFolder);
			this.notificationService.info(localize(
				'customMode.workspacePlanAnalysisStarted',
				'Claude is analyzing how well this repo implements the workspace plan. Report: .agent/workspace.plan-analysis.md',
			));
		} catch (error: unknown) {
			this.workspacePlanAnalysisInFlight = false;
			this.logClaudeKickoff(`workspace-plan-analysis FAILED: ${String((error as Error)?.message ?? error)}`, true);
			this.notificationService.error(localize(
				'customMode.workspacePlanAnalysisFailed',
				'Failed to start workspace plan analysis: {0}',
				String((error as Error)?.message ?? error),
			));
			this.syncWorkspacePlanSubmitButton();
		}
	}

	private watchWorkspacePlanAnalysis(workspaceFolder: URI): void {
		const store = new DisposableStore();
		this.workspacePlanAnalysisWatcher.value = store;
		const resource = workspacePlanAnalysisResource(workspaceFolder);
		const finish = () => {
			this.workspacePlanAnalysisInFlight = false;
			this.workspacePlanAnalysisWatcher.clear();
			this.syncWorkspacePlanSubmitButton();
			void this.refreshWorkspacePlanAnalysisHistory();
			this.notificationService.info(localize(
				'customMode.workspacePlanAnalysisReady',
				'Workspace plan analysis ready — open .agent/workspace.plan-analysis.md',
			));
		};
		try {
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent')));
			store.add(this.fileService.onDidFilesChange(e => {
				if (!this.workspacePlanAnalysisInFlight) {
					return;
				}
				if (e.affects(resource) || e.contains(resource)) {
					void this.fileService.exists(resource).then(exists => {
						if (exists && this.workspacePlanAnalysisInFlight) {
							finish();
						}
					});
				}
			}));
		} catch {
			// Watching is best-effort.
		}
		void this.fileService.exists(resource).then(exists => {
			if (exists && this.workspacePlanAnalysisInFlight) {
				finish();
			}
		});
	}

	private syncWorkspacePlanSubmitButton(): void {
		if (!this.uiWorkspacePlanSubmitButton) {
			return;
		}
		this.uiWorkspacePlanSubmitButton.classList.remove('is-complete');
		const phase = resolveWorkspacePlanSubmitPhase({
			kickoffInFlight: this.workspacePlanKickoffInFlight,
			sessionActive: this.workspacePlanSessionActive,
			analysisInFlight: this.workspacePlanAnalysisInFlight,
			hasPlanArtifacts: this.hasWorkspacePlanForAnalysis(),
		});
		switch (phase) {
			case 'starting':
				this.uiWorkspacePlanSubmitButton.disabled = true;
				this.uiWorkspacePlanSubmitButton.textContent = localize('customMode.workspacePlanSubmitStarting', 'Starting…');
				return;
			case 'planning':
				this.uiWorkspacePlanSubmitButton.disabled = true;
				this.uiWorkspacePlanSubmitButton.textContent = localize('customMode.workspacePlanSubmitDrafting', 'Planning…');
				return;
			case 'analyzing':
				this.uiWorkspacePlanSubmitButton.disabled = true;
				this.uiWorkspacePlanSubmitButton.textContent = localize('customMode.workspacePlanSubmitAnalyzing', 'Analyzing…');
				return;
			case 'analyze':
				this.uiWorkspacePlanSubmitButton.disabled = false;
				this.uiWorkspacePlanSubmitButton.textContent = localize('customMode.workspacePlanSubmitAnalyze', 'Kickoff analysis');
				return;
			default:
				this.uiWorkspacePlanSubmitButton.disabled = false;
				this.uiWorkspacePlanSubmitButton.textContent = localize('customMode.workspacePlanSubmit', 'Start workspace planning');
		}
	}

	private watchWorkspaceSuggestedSurfaces(workspaceFolder: URI): void {
		const store = new DisposableStore();
		this.workspaceSuggestedWatcher.value = store;
		try {
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent')));
			store.add(this.fileService.onDidFilesChange(e => {
				if (this.workspaceSuggestedWriteInFlight) {
					return;
				}
				const resource = workspaceSuggestedSurfacesResource(workspaceFolder);
				if (e.affects(resource) || e.affects(workspacePlanResource(workspaceFolder))) {
					void this.refreshWorkspaceSuggestedSurfaces(workspaceFolder);
				}
			}));
		} catch {
			// Watching is best-effort.
		}
		void this.refreshWorkspaceSuggestedSurfaces(workspaceFolder);
		this.watchSurfacePendingActions(workspaceFolder);
	}

	/** Watch plan/workflow/candidates/proposal files so surface-card attention dots stay current. */
	private watchSurfacePendingActions(workspaceFolder: URI): void {
		const store = new DisposableStore();
		this.surfacePendingActionWatcher.value = store;
		try {
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent')));
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent', 'surfaces')));
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent', 'task-trees')));
			store.add(this.fileService.onDidFilesChange(e => {
				const surfacesDir = joinPath(workspaceFolder, '.agent', 'surfaces');
				const treesDir = joinPath(workspaceFolder, '.agent', 'task-trees');
				if (e.affects(surfacesDir) || e.contains(surfacesDir) || e.affects(treesDir) || e.contains(treesDir)) {
					void this.refreshSurfacePendingActions(workspaceFolder);
				}
			}));
		} catch {
			// Watching is best-effort.
		}
		void this.refreshSurfacePendingActions(workspaceFolder);
	}

	private async refreshSurfacePendingActions(workspaceFolder?: URI): Promise<void> {
		const folder = workspaceFolder ?? this.getWorkspaceFolderUri();
		const generation = ++this.surfacePendingActionRefreshGeneration;
		if (!folder) {
			this.surfacePendingActionById.clear();
			this.surfaceClaudeWorkingById.clear();
			this.surfaceProgressById.clear();
			this.surfaceAutoContinueStateById.clear();
			this.clearSurfaceAutoContinueTimer();
			this.syncWorkspaceHomeView();
			this.syncStepsReopenAttention();
			this.syncClaudeReopenAttention();
			return;
		}
		const surfaces = this.consoleService.getSurfaces();
		const entries = await Promise.all(surfaces.map(async surface => {
			const probe = await resolveSurfacePendingPlanAction(this.fileService, folder, surface.id, {
				surfacePath: surface.path,
				surfaceConfirmed: true,
				localUrl: surface.localUrl,
				devCommand: surface.devCommand,
				productionUrl: surface.productionUrl,
			});
			return [surface, probe] as const;
		}));
		if (generation !== this.surfacePendingActionRefreshGeneration) {
			return;
		}
		this.surfacePendingActionById.clear();
		this.surfaceClaudeWorkingById.clear();
		this.surfaceProgressById.clear();
		const autoContinueRequests: Array<{
			readonly surfaceId: string;
			readonly surfaceName: string;
			readonly stepId: string;
			readonly stepLabel: string;
			readonly kind: 'research' | 'phase';
		}> = [];
		const nowMs = Date.now();
		const aliveIds = new Set<string>();
		for (const [surface, probe] of entries) {
			aliveIds.add(surface.id);
			if (probe.attentionLabel) {
				this.surfacePendingActionById.set(surface.id, probe.attentionLabel);
			}
			if (probe.workingLabel) {
				this.surfaceClaudeWorkingById.set(surface.id, probe.workingLabel);
			}
			this.surfaceProgressById.set(surface.id, probe.progress);
			// Seed complete-state for non-open surfaces so focusing an already-100% surface
			// later does not look like a false→true transition. Open surface is updated in
			// resyncSurfaceRailCardOrderForCurrentStep (one-shot promote lives there).
			const openSurfaceId = this.getOpenSurfaceId();
			if (surface.id !== openSurfaceId) {
				this.surfaceWasCompleteById.set(
					surface.id,
					shouldPreferPreviewSurfaceSection(probe.progress),
				);
			}
			const prior = this.surfaceAutoContinueStateById.get(surface.id);
			const decision = decideSurfaceAutoContinue({
				fingerprint: probe.autoContinueFingerprint,
				previousFingerprint: prior?.fingerprint,
				firstSeenMs: prior?.firstSeenMs,
				lastNudgeMs: prior?.lastNudgeMs,
				nowMs,
				stallMs: SURFACE_AUTO_CONTINUE_STALL_MS,
				cooldownMs: SURFACE_AUTO_CONTINUE_COOLDOWN_MS,
				stageEligible: probe.autoContinueEligible,
			});
			this.surfaceAutoContinueStateById.set(surface.id, {
				fingerprint: decision.fingerprint,
				firstSeenMs: decision.firstSeenMs,
				lastNudgeMs: prior?.lastNudgeMs,
			});
			if (decision.shouldContinue) {
				const phaseStepId = probe.phaseInFlightStepId?.trim();
				if (phaseStepId) {
					autoContinueRequests.push({
						surfaceId: surface.id,
						surfaceName: surface.name,
						stepId: phaseStepId,
						stepLabel: probe.phaseInFlightStepLabel
							|| probe.workingLabel
							|| phaseStepId,
						kind: 'phase',
					});
				} else if (isResearchAutoContinueStage(probe.stageId)) {
					const stepId = probe.nextAction?.stepId || probe.stageId;
					const stepLabel = probe.nextAction?.label
						|| probe.workingLabel
						|| localize('customMode.autoContinueResearch', 'Continue research');
					autoContinueRequests.push({
						surfaceId: surface.id,
						surfaceName: surface.name,
						stepId,
						stepLabel,
						kind: 'research',
					});
				}
			}
		}
		for (const surfaceId of [...this.surfaceAutoContinueStateById.keys()]) {
			if (!aliveIds.has(surfaceId)) {
				this.surfaceAutoContinueStateById.delete(surfaceId);
			}
		}
		for (const surfaceId of [...this.surfaceWasCompleteById.keys()]) {
			if (!aliveIds.has(surfaceId)) {
				this.surfaceWasCompleteById.delete(surfaceId);
			}
		}
		this.resyncSurfaceRailCardOrderForCurrentStep({ promotePreviewIfComplete: true });
		this.syncWorkspaceHomeView();
		this.syncStepsReopenAttention();
		this.syncClaudeReopenAttention();
		this.scheduleSurfaceAutoContinueWatchdog(folder);
		for (const request of autoContinueRequests) {
			void this.autoContinueStuckSurface(folder, request);
		}
	}

	private scheduleSurfaceAutoContinueWatchdog(workspaceFolder: URI): void {
		this.clearSurfaceAutoContinueTimer();
		if (!this.surfaceAutoContinueStateById.size) {
			return;
		}
		this.surfaceAutoContinueTimer = mainWindow.setTimeout(() => {
			this.surfaceAutoContinueTimer = undefined;
			void this.refreshSurfacePendingActions(workspaceFolder);
		}, Math.min(SURFACE_AUTO_CONTINUE_STALL_MS, 15_000));
	}

	private clearSurfaceAutoContinueTimer(): void {
		if (this.surfaceAutoContinueTimer !== undefined) {
			mainWindow.clearTimeout(this.surfaceAutoContinueTimer);
			this.surfaceAutoContinueTimer = undefined;
		}
	}

	/** Auto-nudge Claude when a Claude-owned stage fingerprint stalls. */
	private async autoContinueStuckSurface(
		workspaceFolder: URI,
		request: {
			readonly surfaceId: string;
			readonly surfaceName: string;
			readonly stepId: string;
			readonly stepLabel: string;
			readonly kind: 'research' | 'phase';
		},
	): Promise<void> {
		const state = this.surfaceAutoContinueStateById.get(request.surfaceId);
		if (!state) {
			return;
		}
		state.lastNudgeMs = Date.now();
		this.surfaceAutoContinueStateById.set(request.surfaceId, state);
		this.surfaceClaudeWorkingById.set(request.surfaceId, request.stepLabel);
		this.syncClaudeReopenAttention();
		try {
			if (request.kind === 'phase') {
				const prompt = [
					`Console auto-resume: surface ${request.surfaceId} (${request.surfaceName}) is stalled on phase "${request.stepLabel}" (${request.stepId}).`,
					`Inspect .agent/surfaces/${request.surfaceId}.phase-progress.json and current phase deliverables, then continue that generate phase from the first incomplete checklist item.`,
					`Do not restart Research. Do not re-ask for repo confirmation. Do not edit .workflow.json — the Console owns the Steps row.`,
					`When the phase gate passes, update .agent/surfaces/${request.surfaceId}.phase-progress.json to status "completed" for the same stepId/stepLabel.`,
				].join(' ');
				await this.submitPromptToClaudeKey(workspaceFolder, request.surfaceId, prompt, { reveal: false });
				this.notificationService.info(localize(
					'customMode.autoContinuePhaseSent',
					'Auto-resumed Claude on phase "{0}" for {1}.',
					request.stepLabel,
					request.surfaceName,
				));
				return;
			}
			await this.continueClaudeResearch(workspaceFolder, {
				surfaceId: request.surfaceId,
				surfaceName: request.surfaceName,
				stepId: request.stepId,
				stepLabel: request.stepLabel,
				automatic: true,
			});
		} catch {
			// Best-effort — next watchdog tick can retry after cooldown.
		}
	}

	/** Stable manifest order — Surface cards do not reshuffle by step activity. */
	private orderedWorkspaceSurfaces(): WorkspaceSurface[] {
		return [...this.consoleService.getSurfaces()];
	}

	private async refreshWorkspaceSuggestedSurfaces(workspaceFolder?: URI): Promise<void> {
		const folder = workspaceFolder ?? this.getWorkspaceFolderUri();
		if (!folder) {
			this.workspaceSuggestedSurfaces = undefined;
			this.workspacePlanArtifactExists = false;
			this.renderWorkspaceSuggestedSurfaces();
			void this.refreshWorkspacePlanGeneratedState(undefined);
			void this.refreshWorkspacePlanAnalysisHistory(undefined);
			return;
		}
		try {
			const content = await this.fileService.readFile(workspaceSuggestedSurfacesResource(folder));
			this.workspaceSuggestedSurfaces = parseWorkspaceSuggestedSurfaces(content.value.toString());
		} catch {
			this.workspaceSuggestedSurfaces = undefined;
		}
		try {
			this.workspacePlanArtifactExists = await this.fileService.exists(workspacePlanResource(folder));
		} catch {
			this.workspacePlanArtifactExists = false;
		}
		if (this.workspaceSuggestedSurfaces?.surfaces.length) {
			this.workspacePlanSessionActive = false;
		}
		this.syncClaudeReopenAttention();
		this.renderWorkspaceSuggestedSurfaces();
		void this.refreshWorkspacePlanGeneratedState(folder);
		void this.refreshWorkspacePlanAnalysisHistory(folder);
	}

	private async refreshWorkspacePlanGeneratedState(_workspaceFolder?: URI): Promise<void> {
		this.syncWorkspacePlanSubmitButton();
		this.renderConsoleWorkflowProgress();
		this.syncWorkspaceHomeView();
	}

	private async refreshWorkspacePlanAnalysisHistory(workspaceFolder?: URI): Promise<void> {
		if (!this.uiWorkspacePlanAnalysisHistoryBody || !this.uiWorkspacePlanAnalysisHistorySummary) {
			return;
		}
		const folder = workspaceFolder ?? this.getWorkspaceFolderUri();
		this.workspacePlanAnalysisHistoryListeners.clear();
		clearNode(this.uiWorkspacePlanAnalysisHistoryBody);
		// Reset summary to title (+ optional count) each refresh.
		clearNode(this.uiWorkspacePlanAnalysisHistorySummary);
		this.uiWorkspacePlanAnalysisHistorySummary.appendChild(
			document.createTextNode(localize('customMode.workspacePlanAnalysisHistoryTitle', 'Previous analyses')),
		);
		if (!folder) {
			this.uiWorkspacePlanAnalysisHistoryBody.appendChild(
				$('div.custom-mode-ui-workspace-plan-analysis-history-empty', undefined,
					localize('customMode.workspacePlanAnalysisHistoryNone', 'None yet')),
			);
			return;
		}
		let runs: readonly WorkspacePlanAnalysisRun[] = [];
		try {
			runs = await listWorkspacePlanAnalysisRuns(this.fileService, folder);
		} catch {
			runs = [];
		}
		if (!runs.length) {
			this.uiWorkspacePlanAnalysisHistoryBody.appendChild(
				$('div.custom-mode-ui-workspace-plan-analysis-history-empty', undefined,
					localize('customMode.workspacePlanAnalysisHistoryNone', 'None yet')),
			);
			return;
		}
		const count = $('span.custom-mode-ui-workspace-plan-analysis-history-count', undefined, String(runs.length));
		this.uiWorkspacePlanAnalysisHistorySummary.appendChild(count);
		for (const run of runs) {
			const button = $('button.custom-mode-ui-workspace-plan-analysis-run', {
				type: 'button',
				title: run.resource.fsPath,
			}, run.label) as HTMLButtonElement;
			if (run.isLive) {
				button.classList.add('is-live');
			}
			this.workspacePlanAnalysisHistoryListeners.add(addDisposableListener(button, 'click', (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.openWorkspacePlanAnalysisRun(run.resource);
			}));
			this.uiWorkspacePlanAnalysisHistoryBody.appendChild(button);
		}
	}

	private async openWorkspacePlanAnalysisRun(resource: URI): Promise<void> {
		try {
			await this.editorService.openEditor({
				resource,
				options: {
					pinned: false,
					revealIfOpened: true,
				},
			});
		} catch (error: unknown) {
			this.notificationService.error(localize(
				'customMode.workspacePlanAnalysisOpenFailed',
				'Failed to open analysis report: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	/** Workspace/Console steps row — only while Console (parent or section) is the selection. */
	private isConsoleCardSelected(): boolean {
		if (this.getOpenSurfaceId()) {
			return false;
		}
		const activeId = this.activeRailCardId ?? '';
		return activeId === 'console' || activeId.startsWith('consoleSection:');
	}

	/** Derive Console lifecycle stage signals from the same progress used by surface cards. */
	private collectConsoleWorkflowSignals(): ConsoleWorkflowSignals {
		const progresses = [...this.surfaceProgressById.values()];
		const pendingLabels = [...this.surfacePendingActionById.values()];
		const anySurfaceComplete = progresses.some(progress => progress.complete);
		const anySurfacePastCreate = progresses.some(progress =>
			progress.complete
			|| progress.stageId === 'plan_locked'
			|| progress.stageId === 'building'
		);
		return {
			dockerReady: isWeb || isDockerAvailabilityReady(this.dockerAvailabilityService.getStatus()),
			kickoffInFlight: this.workspacePlanKickoffInFlight,
			sessionActive: this.workspacePlanSessionActive,
			hasWorkspacePlan: this.workspacePlanArtifactExists,
			hasSuggestedSurfaces: Boolean(this.workspaceSuggestedSurfaces?.surfaces.length),
			suggestedStatus: this.workspaceSuggestedSurfaces?.status,
			surfaceCount: this.consoleService.getSurfaces().length,
			anySurfaceRunning: this.startedSurfaceServers.size > 0,
			anySurfaceBuilding: this.startingSurfaceServers.size > 0
				|| anySurfacePastCreate
				|| progresses.some(progress => progress.inProgress)
				|| pendingLabels.some(label => !/start planning|confirm repos/i.test(label)),
			anySurfacePlanLocked: anySurfacePastCreate
				|| pendingLabels.some(label => /lock/i.test(label)),
			anySurfaceComplete,
		};
	}

	/**
	 * Feed the Babadaba stage (and Steps children) from the shared hub graph:
	 * every surface plus Ix / Docker / GitHub / Vercel.
	 */
	private updateBabadabaStage(signals: ConsoleWorkflowSignals): void {
		if (!this.babadabaStage || !this.uiBabadabaStageHost) {
			return;
		}
		const surfaces = this.consoleService.getSurfaces();
		const graph = buildBabadabaHubGraph({
			signals,
			surfaces: surfaces.map(surface => ({
				id: surface.id,
				name: surface.name,
				productionUrl: surface.productionUrl,
				ixSubsystems: surface.ixSubsystems,
				hasIxMeta: Boolean(surface.ix),
			})),
			surfaceProgressById: this.surfaceProgressById,
			startedSurfaceIds: this.startedSurfaceServers,
			workspaceHasGitRepo: this.workspaceHasGitRepo,
		});
		const { nodes: hubNodes, surfaceCount, completeCount } = graph;
		this.lastBabadabaHubNodes = hubNodes;
		const allComplete = surfaceCount > 0 && completeCount >= surfaceCount;
		this.babadabaStageState = deriveBabadabaStageState(this.babadabaStageState, Boolean(signals.anySurfaceBuilding), allComplete);
		// Hub stays visible on Console home even before surfaces exist (integrations-only ring).
		this.uiBabadabaStageHost.classList.remove('hidden');

		const workflow = resolveConsoleWorkflowStatus(signals);
		const currentStep = workflow.steps.find(step => step.status === 'current');
		const stepLabel = currentStep ? consoleWorkflowStepDisplayLabel(currentStep.id, currentStep.label) : undefined;

		const nodes: IBabadabaStageNode[] = hubNodes.map(node => ({
			id: node.id,
			label: node.label,
			state: node.state,
			progress: node.progress,
			detail: node.detail,
			open: node.actionId
				? () => this.activateBabadabaHubNode(node)
				: undefined,
		}));

		this.babadabaStage.setStatus({ state: this.babadabaStageState, surfaceCount, completeCount, stepLabel, nodes });
		this.renderBabadabaSteps(hubNodes, stepLabel);
	}

	/** Shared click handler for canvas chips and Steps children. */
	private activateBabadabaHubNode(node: BabadabaHubNode): void {
		const actionId = node.actionId as BabadabaHubActionId | undefined;
		if (!actionId) {
			return;
		}
		switch (actionId) {
			case 'open_surface':
				if (node.targetId) {
					void this.openWorkspaceSuggestedSurfacePlan(node.targetId);
				}
				return;
			case 'open_ix':
				this.openConsoleWithSection('workspacePlan');
				return;
			case 'open_docker':
				this.openConsoleWithSection('docker');
				return;
			case 'open_github':
				this.openConsoleWithSection('settings');
				return;
			case 'open_vercel':
				if (node.href) {
					void this.openerService.open(URI.parse(node.href));
				}
				return;
		}
	}

	/** Console Steps: Babadaba parent + spoke children from the same hub graph. */
	private renderBabadabaSteps(nodes: readonly BabadabaHubNode[], stepLabel: string | undefined): void {
		if (!this.uiBabadabaSteps || !this.uiBabadabaStepsChildren || !this.uiBabadabaStepsParent) {
			return;
		}
		const show = this.isConsoleCardSelected();
		this.uiBabadabaSteps.classList.toggle('hidden', !show);
		if (!show) {
			this.babadabaStepsListeners.clear();
			this.uiBabadabaStepsChildren.replaceChildren();
			return;
		}

		clearNode(this.uiBabadabaStepsParent);
		this.uiBabadabaStepsParent.append(
			localize('customMode.babadabaStepsParent', 'Babadaba'),
			$('span.custom-mode-babadaba-steps-parent-detail', undefined,
				stepLabel
					? localize('customMode.babadabaStepsParentDetailStep', ' · {0}', stepLabel)
					: localize('customMode.babadabaStepsParentDetail', ' · Workspace manager')),
		);

		this.babadabaStepsListeners.clear();
		this.uiBabadabaStepsChildren.replaceChildren();
		for (const node of nodes) {
			const child = $('button.custom-mode-babadaba-steps-child', {
				type: 'button',
				role: 'listitem',
				title: node.detail ?? node.label,
				'aria-label': node.detail
					? localize('customMode.babadabaStepsChildAria', '{0}: {1}', node.label, node.detail)
					: node.label,
			},
				$('span.custom-mode-babadaba-steps-child-dot', { 'aria-hidden': 'true' }),
				$('span.custom-mode-babadaba-steps-child-label', undefined, node.label),
			) as HTMLButtonElement;
			child.classList.toggle('is-active', node.state === 'active');
			child.classList.toggle('is-building', node.state === 'building');
			child.classList.toggle('is-attention', node.state === 'attention');
			child.classList.toggle('is-passive', !node.actionId);
			if (node.actionId) {
				this.babadabaStepsListeners.add(addDisposableListener(child, 'click', () => {
					this.activateBabadabaHubNode(node);
				}));
			}
			this.uiBabadabaStepsChildren.appendChild(child);
		}
	}

	private renderConsoleWorkflowProgress(): void {
		if (!this.uiConsoleStatusTracker || !this.uiConsoleStatusRail || !this.uiConsoleStatusLabel || !this.uiConsoleStatusNextActionButton) {
			return;
		}
		const signals = this.collectConsoleWorkflowSignals();
		this.updateBabadabaStage(signals);
		this.syncConsoleFirstRun(signals);
		const showSteps = this.isConsoleCardSelected();
		this.uiConsoleStatusTracker.classList.toggle('hidden', !showSteps);
		this.uiConsoleStatusLabel.classList.toggle('hidden', !showSteps);
		this.syncStepsPanel();
		if (!showSteps) {
			this.uiConsoleStatusRail.replaceChildren();
			this.uiConsoleStatusLabel.textContent = '';
			this.renderConsoleWorkflowNextAction(undefined);
			this.renderConsolePreflightPill(undefined);
			this.lastConsoleCenteredStepId = undefined;
			this.syncStepsReopenAttention();
			return;
		}
		const status = resolveConsoleWorkflowStatus(signals);
		this.uiConsoleStatusRail.replaceChildren();
		// Docker is preflight plumbing, not a journey step — it renders as a status pill.
		const journeySteps = status.steps.filter(step => step.id !== 'docker');
		for (let index = 0; index < journeySteps.length; index++) {
			const step = journeySteps[index]!;
			this.uiConsoleStatusRail.appendChild(this.createConsoleWorkflowProgressStep(step, index < journeySteps.length - 1));
		}
		this.renderConsoleWorkflowNextAction(status.nextAction);
		this.renderConsolePreflightPill(signals);
		this.uiConsoleStatusLabel.textContent = status.stageId === 'docker'
			? localize('customMode.consoleWorkflowDocker', 'Start Docker Desktop (with MCP Toolkit) to continue Workspace steps.')
			: '';
		const focusStepId = status.nextAction?.stepId
			?? status.steps.find(step => step.status === 'current')?.id;
		if (focusStepId && focusStepId !== this.lastConsoleCenteredStepId) {
			this.lastConsoleCenteredStepId = focusStepId;
			queueMicrotask(() => this.centerConsoleWorkflowProgressStep(focusStepId));
		} else if (!focusStepId) {
			this.lastConsoleCenteredStepId = undefined;
		}
		this.syncStepsReopenAttention();
	}

	/** Attach Start Apps (etc.) to the upcoming Apps running chip — parked on tracker when absent. */
	private renderConsoleWorkflowNextAction(action: ConsoleWorkflowAction | undefined): void {
		const button = this.uiConsoleStatusNextActionButton;
		if (!button || !this.uiConsoleStatusRail || !this.uiConsoleStatusTracker) {
			return;
		}
		for (const child of Array.from(this.uiConsoleStatusRail.children)) {
			if (child instanceof HTMLElement) {
				child.classList.remove('has-next-action');
			}
		}
		if (!action) {
			button.classList.add('hidden');
			button.disabled = true;
			button.textContent = '';
			button.removeAttribute('data-action-id');
			button.removeAttribute('data-step-id');
			button.removeAttribute('title');
			if (button.parentElement !== this.uiConsoleStatusTracker) {
				this.uiConsoleStatusTracker.appendChild(button);
			}
			return;
		}
		button.classList.remove('hidden');
		button.disabled = this.startAllSurfacesInProgress;
		button.textContent = localize('customMode.consoleWorkflowStartApps', '{0}', action.label);
		button.dataset.actionId = action.id;
		button.dataset.stepId = action.stepId;
		button.title = localize(
			'customMode.consoleWorkflowStartAppsTitle',
			'Start surface apps for this workspace',
		);
		const host = Array.from(this.uiConsoleStatusRail.children).find(child =>
			child instanceof HTMLElement && child.dataset.stepId === action.stepId
		) as HTMLElement | undefined;
		if (!host) {
			this.uiConsoleStatusTracker.appendChild(button);
			return;
		}
		host.classList.add('has-next-action');
		const connector = host.querySelector('.custom-mode-surface-plan-status-connector');
		if (button.parentElement !== host || (connector && button.nextElementSibling !== connector)) {
			if (connector) {
				host.insertBefore(button, connector);
			} else {
				host.appendChild(button);
			}
		}
	}

	/** Docker preflight pill: quiet status when ready, actionable when blocking. */
	private renderConsolePreflightPill(signals: ConsoleWorkflowSignals | undefined): void {
		const pill = this.uiConsolePreflightPill;
		if (!pill) {
			return;
		}
		if (!signals) {
			pill.classList.add('hidden');
			return;
		}
		const blocked = signals.dockerReady === false;
		pill.classList.remove('hidden');
		pill.classList.toggle('blocked', blocked);
		pill.disabled = !blocked;
		pill.replaceChildren(
			$('span.custom-mode-console-preflight-glyph', { 'aria-hidden': 'true' }, blocked ? '●' : '✓'),
			$('span', undefined, blocked
				? localize('customMode.preflightDockerBlocked', 'Start Docker Desktop')
				: localize('customMode.preflightDockerReady', 'Docker ready')),
		);
		pill.title = blocked
			? localize('customMode.consoleWorkflowDocker', 'Start Docker Desktop (with MCP Toolkit) to continue Workspace steps.')
			: localize('customMode.preflightDockerReadyTitle', 'Docker Desktop (with MCP Toolkit) is running');
	}

	private createConsoleWorkflowProgressStep(step: ConsoleWorkflowStepState, withConnector: boolean): HTMLElement {
		const statusLabel = step.status === 'completed'
			? localize('surfacePlan.statusCompleted', 'Done')
			: step.status === 'current'
				? localize('surfacePlan.statusCurrent', 'Current')
				: localize('surfacePlan.statusUpcoming', 'Upcoming');
		const displayLabel = consoleWorkflowStepDisplayLabel(step.id, step.label);
		const stepEl = $('div.custom-mode-surface-plan-status-step', {
			role: 'listitem',
			'data-step-id': step.id,
			'data-status': step.status,
			'aria-current': step.status === 'current' ? 'step' : undefined,
			title: displayLabel,
		},
			$('div.custom-mode-surface-plan-status-label', undefined, statusLabel),
			$('div.custom-mode-surface-plan-status-value', undefined, displayLabel),
		);
		stepEl.classList.toggle('completed', step.status === 'completed');
		stepEl.classList.toggle('current', step.status === 'current');
		stepEl.classList.toggle('pending', step.status === 'pending' || step.status === 'skipped');
		if (withConnector) {
			stepEl.appendChild($('div.custom-mode-surface-plan-status-connector', { 'aria-hidden': 'true' }));
		}
		return stepEl;
	}

	private centerConsoleWorkflowProgressStep(stepId: string): void {
		const rail = this.uiConsoleStatusRail;
		if (!rail) {
			return;
		}
		const stepEl = Array.from(rail.children).find(child =>
			child instanceof HTMLElement && child.dataset.stepId === stepId
		) as HTMLElement | undefined;
		if (!stepEl) {
			return;
		}
		const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
		// Keep earlier Done chips in view; only scroll when current would be clipped.
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
		if (Math.abs(rail.scrollLeft - left) < 2) {
			return;
		}
		rail.scrollTo({ left, behavior: 'auto' });
	}

	/** Vertical / horizontal trackpad wheel pans the visible Steps rail. */
	private handleConsoleStatusRailWheel(event: WheelEvent): void {
		const target = event.target;
		if (target instanceof Element) {
			const direct = target.closest('.custom-mode-surface-plan-status-rail');
			if (direct instanceof HTMLElement) {
				applyWheelToHorizontalScroll(direct, event);
				return;
			}
		}
		const rail = this.getVisibleStepsStatusRail();
		if (rail) {
			applyWheelToHorizontalScroll(rail, event);
		}
	}

	/** Visible Steps rail in the top panel (surface plan or console lifecycle). */
	private getVisibleStepsStatusRail(): HTMLElement | undefined {
		const trackers = this.uiStepsHost.querySelectorAll('.custom-mode-surface-plan-status-tracker');
		for (const tracker of trackers) {
			if (!(tracker instanceof HTMLElement) || tracker.classList.contains('hidden')) {
				continue;
			}
			const rail = tracker.querySelector('.custom-mode-surface-plan-status-rail');
			if (rail instanceof HTMLElement) {
				return rail;
			}
		}
		return this.uiConsoleStatusRail;
	}

	/** Collapse any selected surface so the rail returns to a workspace home view. */
	private deselectSurfaceForHomeRail(): void {
		if (!this.selectedSurfaceId || this.selectedSurfaceId === ADD_SURFACE_ID) {
			return;
		}
		this.clearHoveredRailParent({ immediate: true });
		// Invalidate any in-flight openWorkspaceSuggestedSurfacePlan so refresh completion
		// cannot snap the surface back open after the user collapsed it.
		this.surfacePlanOpenGeneration++;
		this.surfaceRailCards = [];
		this.surfaceRailCardsLoading = false;
		this.selectedSurfaceId = ADD_SURFACE_ID;
		if (!this.activeRailCardId || this.activeRailCardId.startsWith('surface:') || this.activeRailCardId.startsWith('surfaceSection:')) {
			this.activeRailCardId = this.consoleExpanded
				? `consoleSection:${this.workspaceHomeView}`
				: 'console';
		}
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
		// Hide the surface plan webview immediately — async routing used to leave it painted
		// over the rail so cards looked dead.
		this.uiSurfacePlanPanelRoot.classList.add('hidden');
		this.uiSurfacePlanPanelRoot.hidden = true;
		this.uiBrowserShell.classList.remove('custom-mode-ui-surface-main-view-overlay');
		// Drop Steps ownership so home never shows another surface's tracker.
		this.surfacePlanPanel?.clear();
		this.applySurfaceSelection(ADD_SURFACE_ID, { contextGathering: true });
		this.syncGoalSurfaceSwitcher();
		this.syncSurfaceMainView();
		this.showClaudeTerminalForKey(WORKSPACE_CLAUDE_KEY);
	}

	/** Ensure this SURFACE is open and a section card owns the content pane. */
	private selectOwningSurfaceCard(surfaceId: string): void {
		const id = surfaceId.trim();
		if (!id) {
			return;
		}
		if (this.selectedSurfaceId !== id) {
			void this.openWorkspaceSuggestedSurfacePlan(id);
			return;
		}
		const currentSection = this.activeRailCardId?.startsWith('surfaceSection:')
			? this.activeRailCardId.slice('surfaceSection:'.length)
			: undefined;
		if (currentSection && this.surfaceRailCards.some(card => card.id === `surfaceSection:${currentSection}`)) {
			this.selectSurfaceSectionCard(id, currentSection);
			return;
		}
		this.selectDefaultSurfaceSectionOrOwner(id);
	}

	/** Step click: open the surface and focus the card associated with that step. */
	private selectSurfaceForPlanStep(request: {
		readonly surfaceId: string;
		readonly stepId?: string;
		readonly stepKind?: 'stage' | 'action' | 'phase' | 'blocker';
	}): void {
		const surfaceId = request.surfaceId.trim();
		if (!surfaceId) {
			return;
		}
		const available = this.surfaceRailCards
			.map(card => card.id.startsWith('surfaceSection:') ? card.id.slice('surfaceSection:'.length) : '')
			.filter((id): id is string => Boolean(id));
		const sectionId = request.stepId
			? resolveSurfaceSectionIdForStep(
				{ id: request.stepId, kind: request.stepKind ?? 'stage' },
				available,
			)
			: undefined;
		if (sectionId) {
			this.pendingSurfaceSectionId = sectionId;
		}
		if (this.selectedSurfaceId !== surfaceId) {
			void this.openWorkspaceSuggestedSurfacePlan(surfaceId);
			return;
		}
		if (sectionId && this.surfaceRailCards.some(card => card.id === `surfaceSection:${sectionId}`)) {
			this.pendingSurfaceSectionId = undefined;
			this.selectSurfaceSectionCard(surfaceId, sectionId);
			return;
		}
		if (sectionId) {
			// Cards still loading — pendingSurfaceSectionId is consumed when they publish.
			this.selectOwningSurfaceCard(surfaceId);
			return;
		}
		this.selectOwningSurfaceCard(surfaceId);
	}

	private surfaceSectionStorageKey(surfaceId: string): string {
		return `${STORAGE_SURFACE_SECTION_PREFIX}${surfaceId}`;
	}

	private getStoredSurfaceSection(surfaceId: string): string | undefined {
		const stored = this.storageService.get(this.surfaceSectionStorageKey(surfaceId), StorageScope.WORKSPACE)?.trim();
		return stored || undefined;
	}

	private persistSurfaceSection(surfaceId: string, sectionId: string): void {
		this.storageService.store(this.surfaceSectionStorageKey(surfaceId), sectionId, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	/** Last-used section for this surface, else the first ready section card. */
	private resolveDefaultSurfaceSectionId(surfaceId: string): string | undefined {
		if (!this.surfaceRailCards.length) {
			return undefined;
		}
		const pending = this.pendingSurfaceSectionId;
		if (pending && this.surfaceRailCards.some(card => card.id === `surfaceSection:${pending}`)) {
			this.pendingSurfaceSectionId = undefined;
			return pending;
		}
		// Respect the user's last section — do not keep snapping complete surfaces back to Preview.
		const stored = this.getStoredSurfaceSection(surfaceId);
		if (stored && this.surfaceRailCards.some(card => card.id === `surfaceSection:${stored}`)) {
			return stored;
		}
		// No stored preference yet: complete surfaces open on Deployed (else Preview).
		const availableSectionIds = this.surfaceRailCards
			.map(card => card.id.startsWith('surfaceSection:') ? card.id.slice('surfaceSection:'.length) : '')
			.filter((id): id is string => Boolean(id));
		const preferredComplete = resolvePreferredCompleteSurfaceSectionId({
			progress: this.surfaceProgressById.get(surfaceId),
			availableSectionIds,
			deployedWired: isSurfaceDeployedWired(this.consoleService.getSurface(surfaceId)),
		});
		if (preferredComplete) {
			return preferredComplete;
		}
		const first = this.surfaceRailCards[0]?.id;
		return first?.startsWith('surfaceSection:') ? first.slice('surfaceSection:'.length) : undefined;
	}

	private selectSurfaceSectionCard(surfaceId: string, sectionId: string): void {
		const id = `surfaceSection:${sectionId}`;
		this.activeRailCardId = id;
		const livePane = isLiveSurfaceRailSection(sectionId);
		this.surfaceMainView = livePane ? 'preview' : 'plan';
		this.persistSurfaceMainView(surfaceId, this.surfaceMainView);
		this.persistSurfaceSection(surfaceId, sectionId);
		this.uiWorkspaceHomeCardRail?.setActiveId(id, [`surface:${surfaceId}`]);
		// Preview/Deployed waiting empty chrome must not stick when focusing Graph/Plan/…
		// — otherwise syncWorkspaceHomeView keeps the plan column hidden under that copy.
		if (!livePane) {
			this.lastSurfacePreviewRouteKey = undefined;
			this.setSurfaceEmptyState(undefined);
		}
		this.syncWorkspaceHomeView();
		this.syncSurfaceMainView();
		this.surfacePlanPanel?.selectSection(sectionId);
		if (livePane) {
			this.routeSelectedSurfacePreview();
		}
	}

	/** Prefer a section card so the content pane is never "surface selected, nothing focused". */
	private selectDefaultSurfaceSectionOrOwner(surfaceId: string): void {
		const sectionId = this.resolveDefaultSurfaceSectionId(surfaceId);
		if (sectionId) {
			this.selectSurfaceSectionCard(surfaceId, sectionId);
			return;
		}
		const cardId = `surface:${surfaceId}`;
		this.activeRailCardId = cardId;
		this.uiWorkspaceHomeCardRail?.setActiveId(cardId, []);
		this.syncWorkspaceHomeView();
	}

	private setWorkspaceHomeView(view: WorkspaceHomeView, options?: { scroll?: boolean }): void {
		if (this.workspaceHomeView !== view) {
			this.workspaceHomeView = view;
			this.storageService.store(STORAGE_WORKSPACE_HOME_VIEW, view, StorageScope.WORKSPACE, StorageTarget.USER);
			this.storageService.store(STORAGE_CONSOLE_SECTION, view, StorageScope.WORKSPACE, StorageTarget.USER);
		}
		this.syncWorkspaceHomeView();
		this.applyConsoleHomeSectionAccordion(view);
		if (options?.scroll !== false) {
			this.scrollConsoleHomeSectionIntoView(view);
		}
	}

	private getConsoleHomeSectionElement(view: WorkspaceHomeView): HTMLElement | undefined {
		switch (view) {
			case 'workspacePlan':
				return this.uiWorkspacePlanHomePanel;
			case 'claudeMd':
				return this.uiWorkspaceClaudeMdPanelRoot;
			case 'docker':
				return this.uiWorkspaceDockerPanel;
			case 'description':
				return this.uiWorkspaceDescriptionPanel;
			case 'howItWorks':
				return this.uiWorkspaceHowItWorksPanel;
			case 'branding':
				return this.uiWorkspacePlanBrandFields;
			case 'settings':
				return this.uiWorkspaceSettingsPanel;
			case 'surfaces':
				return this.uiSurfaceSetupSurfacesBody;
		}
	}

	private scrollConsoleHomeSectionIntoView(view: WorkspaceHomeView): void {
		this.getConsoleHomeSectionElement(view)?.scrollIntoView({ behavior: 'auto', block: 'start' });
	}

	private persistConsoleExpanded(): void {
		this.storageService.store(
			STORAGE_CONSOLE_EXPANDED,
			this.consoleExpanded ? '1' : '0',
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
	}

	/** Open Console (expanded) on a section — used by ← Console and collapsing a surface. */
	private openConsoleWithSection(view: WorkspaceHomeView): void {
		this.consoleExpanded = true;
		this.persistConsoleExpanded();
		this.activeRailCardId = `consoleSection:${view}`;
		this.deselectSurfaceForHomeRail();
		this.setWorkspaceHomeView(view);
	}

	/** Console card: expand home on Surfaces (Workspace default), or collapse section cards when already open. */
	private onSelectConsoleCard(): void {
		const openSurfaceId = this.getOpenSurfaceId();
		if (openSurfaceId) {
			this.openConsoleWithSection(CONSOLE_HOME_DEFAULT_SECTION);
			return;
		}
		if (this.consoleExpanded) {
			this.clearHoveredRailParent({ immediate: true });
			this.consoleExpanded = false;
			this.persistConsoleExpanded();
			this.activeRailCardId = 'console';
			this.syncWorkspaceHomeView();
			return;
		}
		this.openConsoleWithSection(CONSOLE_HOME_DEFAULT_SECTION);
	}

	private getWorkspaceSectionLabel(): string {
		const fromInput = this.uiSurfaceSetupGoalNameInput?.value?.trim();
		if (fromInput) {
			return fromInput;
		}
		const fromGoal = this.consoleService.getGoal()?.name?.trim();
		if (fromGoal) {
			return fromGoal;
		}
		return localize('customMode.workspaceHomeWorkspaceSection', 'Workspace');
	}

	private getWorkspaceHomeCards(): CardRailItem[] {
		const existing = this.orderedWorkspaceSurfaces();
		const openSurfaceId = this.getOpenSurfaceId();
		const displayParent = resolveRailChildrenDisplayParent({
			hoveredRailParentId: this.hoveredRailParentId,
			openSurfaceId,
			consoleExpanded: this.consoleExpanded,
		});
		const showConsoleChildren = displayParent === 'console';
		const displaySurfaceId = displayParent?.startsWith('surface:')
			? surfaceIdFromRailParentId(displayParent)
			: undefined;
		// Subtitles only on surface-related cards (Surfaces / Surface rows / sections).
		const workspaceLabel = this.getWorkspaceSectionLabel();
		const cards: CardRailItem[] = [
			{
				id: 'console',
				key: localize('customMode.workspaceHomeConsoleKey', 'Console'),
				value: '',
				title: this.consoleExpanded && !openSurfaceId
					? localize('customMode.workspaceHomeConsoleCollapse', 'Collapse Console sections')
					: localize('customMode.workspaceHomeConsoleOpen', 'Open Console'),
				groupLabel: workspaceLabel,
				groupLabelAction: true,
				groupLabelActionAriaLabel: localize(
					'customMode.workspaceSwitcherAria',
					'Switch workspace, current: {0}',
					workspaceLabel,
				),
			},
			{
				id: 'code',
				key: localize('customMode.workspaceHomeCodeKey', 'Code'),
				value: '',
				title: localize('customMode.codeTabTitle', 'Open Code editor'),
			},
		];

		if (showConsoleChildren) {
			cards.push(...this.buildConsoleSectionRailCards());
		}

		// Surfaces list — keep the hovered parent's grid row intact; insert section
		// cards right under that row so only lower title-card rows get pushed down.
		const surfaceParentCards: CardRailItem[] = [];
		let surfaceGroupStarted = false;
		for (const surface of existing) {
			const open = surface.id === openSurfaceId;
			const pendingLabel = this.surfacePendingActionById.get(surface.id);
			const pendingAction = Boolean(pendingLabel);
			const progress = this.surfaceProgressById.get(surface.id);
			const progressPercent = progress?.percent;
			const progressTitle = progress
				? localize(
					'customMode.workspaceHomeSurfaceProgressTitle',
					'{0} — {1} ({2}%)',
					surface.name,
					progress.label,
					progress.percent,
				)
				: undefined;
			surfaceParentCards.push({
				id: `surface:${surface.id}`,
				// Name-only: skip the redundant "Surface" eyebrow above each parent card.
				key: surface.name,
				value: '',
				title: pendingLabel
					? localize(
						'customMode.workspaceHomeSurfacePending',
						'{0} — next: {1}',
						surface.name,
						pendingLabel,
					)
					: progressTitle
						?? (open
							? localize('customMode.workspaceHomeSurfaceClose', 'Close {0}', surface.name)
							: localize('customMode.workspaceHomeSurfaceOpen', 'Open {0}', surface.name)),
				pendingAction,
				progressPercent,
				groupLabel: !surfaceGroupStarted
					? localize('customMode.workspaceHomeSurfacesSection', 'Surfaces')
					: undefined,
			});
			surfaceGroupStarted = true;
		}
		const sectionCardsForDisplay: CardRailItem[] = [];
		if (displaySurfaceId) {
			const sectionCards = displaySurfaceId === openSurfaceId
				? this.surfaceRailCards
				: this.getSurfaceRailCardsForHover(displaySurfaceId);
			if (sectionCards.length) {
				const surfaceAssoc = `surface:${displaySurfaceId}`;
				let sectionGroupStarted = false;
				for (const card of sectionCards) {
					sectionCardsForDisplay.push({
						...card,
						groupStart: !sectionGroupStarted,
						assocGroup: surfaceAssoc,
					});
					sectionGroupStarted = true;
				}
			}
		}
		const displayParentIndex = displaySurfaceId
			? surfaceParentCards.findIndex(card => card.id === `surface:${displaySurfaceId}`)
			: -1;
		const surfaceColumns = this.uiWorkspaceHomeCardRail
			&& this.uiWorkspaceHomeCardRail.getWidth() < CARD_RAIL_NARROW_WIDTH
			? 1
			: 2;
		const insertAfter = displayParentIndex >= 0 && sectionCardsForDisplay.length
			? railParentRowEndIndex(displayParentIndex, surfaceParentCards.length, surfaceColumns)
			: -1;
		for (let i = 0; i < surfaceParentCards.length; i++) {
			cards.push(surfaceParentCards[i]!);
			if (i === insertAfter) {
				cards.push(...sectionCardsForDisplay);
			}
		}
		return cards;
	}

	private buildConsoleSectionRailCards(): CardRailItem[] {
		const suggestedCount = this.workspaceSuggestedSurfaces?.surfaces.length ?? 0;
		return [
			{
				id: 'consoleSection:surfaces',
				key: localize('customMode.workspaceHomeSurfacesKey', 'Surfaces'),
				value: suggestedCount > 0
					? localize('customMode.workspaceHomeSurfacesSuggestedValue', '{0} suggested', suggestedCount)
					: localize('customMode.workspaceHomeSurfacesValue', 'apps'),
				title: localize('customMode.workspaceHomeSurfaces', 'Surfaces — suggested apps and create'),
				groupStart: true,
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:description',
				key: localize('customMode.workspaceHomeDescriptionKey', 'Description'),
				value: surfaceDescriptionCardValue(this.consoleService.getGoal()?.description),
				title: localize('customMode.workspaceHomeDescription', 'Workspace Description — goal.description'),
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:docker',
				key: localize('customMode.workspaceHomeDockerKey', 'Docker'),
				value: dockerAvailabilityCardValue(this.dockerAvailabilityService.getStatus()),
				title: localize('customMode.workspaceHomeDocker', 'Docker Desktop health and status'),
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:workspacePlan',
				key: localize('customMode.workspaceHomePlanKey', 'Plan'),
				value: '',
				title: localize('customMode.workspaceHomePlan', 'Workspace Plan'),
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:claudeMd',
				key: localize('customMode.workspaceHomeClaudeMdKey', 'Rules'),
				value: '',
				title: localize('customMode.workspaceHomeClaudeMd', 'CLAUDE.md'),
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:howItWorks',
				key: localize('customMode.workspaceHomeHowItWorksKey', 'Dev Loop'),
				value: '',
				title: localize('customMode.workspaceHomeHowItWorks', 'Dev loop — how Claude Code works in this workspace'),
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:branding',
				key: localize('customMode.workspaceHomeBrandingKey', 'Brand'),
				value: '',
				title: localize('customMode.workspaceHomeBranding', 'Branding'),
				assocGroup: 'console',
			},
			{
				id: 'consoleSection:settings',
				key: localize('customMode.workspaceHomeSettingsKey', 'Settings'),
				value: '',
				title: localize('customMode.workspaceHomeSettings', 'Workspace Settings'),
				assocGroup: 'console',
			},
		];
	}

	/** Section cards for a surface that is not currently open (hover preview). */
	private getSurfaceRailCardsForHover(surfaceId: string): readonly CardRailItem[] {
		const cached = this.surfaceRailCardsById.get(surfaceId);
		if (cached?.length) {
			return cached;
		}
		const surface = this.consoleService.getSurface(surfaceId);
		if (!surface) {
			return [];
		}
		return this.toSurfaceRailSectionCards(staticSurfaceProposalTreeCards({
			localUrl: surface.localUrl,
			productionUrl: surface.productionUrl,
			databaseUrl: surface.databaseUrl,
			purposeValue: surface.purpose,
			schema: surface.schema,
		}), surface);
	}

	private onWorkspaceHomeRailHoverParent(id: string | undefined): void {
		if (id) {
			if (this.hoveredRailParentClearTimer !== undefined) {
				mainWindow.clearTimeout(this.hoveredRailParentClearTimer);
				this.hoveredRailParentClearTimer = undefined;
			}
			if (this.hoveredRailParentId === id) {
				return;
			}
			this.hoveredRailParentId = id;
			this.refreshWorkspaceHomeRailCardsOnly();
			return;
		}
		if (this.hoveredRailParentClearTimer !== undefined) {
			return;
		}
		this.hoveredRailParentClearTimer = mainWindow.setTimeout(() => {
			this.hoveredRailParentClearTimer = undefined;
			this.clearHoveredRailParent({ immediate: true });
		}, 150);
	}

	private clearHoveredRailParent(options?: { immediate?: boolean }): void {
		if (this.hoveredRailParentClearTimer !== undefined) {
			mainWindow.clearTimeout(this.hoveredRailParentClearTimer);
			this.hoveredRailParentClearTimer = undefined;
		}
		if (!this.hoveredRailParentId) {
			return;
		}
		this.hoveredRailParentId = undefined;
		if (options?.immediate !== false) {
			this.refreshWorkspaceHomeRailCardsOnly();
		}
	}

	/** Swap child cards for hover preview without re-routing the content pane. */
	private refreshWorkspaceHomeRailCardsOnly(): void {
		if (!this.uiWorkspaceHomeCardRail) {
			return;
		}
		const cards = this.getWorkspaceHomeCards();
		const openSurfaceId = this.getOpenSurfaceId();
		const preview = isRailHoverPreviewActive({
			hoveredRailParentId: this.hoveredRailParentId,
			openSurfaceId,
			consoleExpanded: this.consoleExpanded,
		});
		this.uiWorkspaceHomeCardRail.setCards(cards);
		// Preview children reuse surfaceSection:* ids — never paint the committed section
		// active onto another parent's preview group.
		if (preview) {
			if (openSurfaceId) {
				this.uiWorkspaceHomeCardRail.setActiveId(`surface:${openSurfaceId}`, []);
			} else if (this.consoleExpanded) {
				this.uiWorkspaceHomeCardRail.setActiveId('console', []);
			}
		} else {
			const alsoSelected: string[] = [];
			const activeId = this.activeRailCardId;
			if (openSurfaceId && activeId !== `surface:${openSurfaceId}`) {
				alsoSelected.push(`surface:${openSurfaceId}`);
			}
			if (!openSurfaceId && this.consoleExpanded) {
				alsoSelected.push('console');
			}
			if (activeId) {
				this.uiWorkspaceHomeCardRail.setActiveId(activeId, alsoSelected);
			}
		}
		this.uiWorkspaceHomeCardRail.setPreviewAssocGroup(preview ? this.hoveredRailParentId : undefined);
	}

	/** The surface whose cards are expanded in the shared rail, if any. */
	private getOpenSurfaceId(): string | undefined {
		return this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID
			? this.selectedSurfaceId
			: undefined;
	}

	private syncWorkspaceHomeView(): void {
		if (!this.uiWorkspaceHomeCardRail || !this.uiWorkspacePlanStrip || !this.uiWorkspaceClaudeMdPanelRoot || !this.uiWorkspaceHowItWorksPanel || !this.uiWorkspaceDescriptionPanel || !this.uiWorkspaceDockerPanel || !this.uiWorkspacePlanHomePanel || !this.uiConsoleHomeHost) {
			return;
		}
		// With a surface open, the rail content host shows the surface plan panel instead of
		// the Console host (its visibility is driven by syncSurfaceMainView).
		const openSurfaceId = this.getOpenSurfaceId();
		const showConsoleHost = !openSurfaceId;
		// Stack Console sections in one scrollable host (same pattern as Surface .sections).
		// workspaceHomeView is the exclusive open section (Surface-style accordion).

		const cards = this.getWorkspaceHomeCards();
		const cardIds = new Set(cards.map(card => card.id));
		const defaultSurfaceSectionId = openSurfaceId ? this.resolveDefaultSurfaceSectionId(openSurfaceId) : undefined;
		const fallbackActive = openSurfaceId
			? (defaultSurfaceSectionId
				? `surfaceSection:${defaultSurfaceSectionId}`
				: `surface:${openSurfaceId}`)
			: (this.consoleExpanded ? `consoleSection:${this.workspaceHomeView}` : 'console');
		let activeId = this.activeRailCardId && cardIds.has(this.activeRailCardId)
			? this.activeRailCardId
			: fallbackActive;
		// Don't keep a Console / new-surface card highlighted while surface content is still open.
		if (openSurfaceId && (
			activeId === 'code'
			|| activeId === 'console'
			|| activeId.startsWith('consoleSection:')
			|| isWorkspaceHomeView(activeId)
			|| activeId.startsWith('newSurface:')
		)) {
			activeId = fallbackActive;
		}
		// Surface open: always focus a section subcard once cards exist (never leave only SURFACE selected).
		const promoteSurfaceSection = Boolean(
			openSurfaceId
			&& defaultSurfaceSectionId
			&& activeId === `surface:${openSurfaceId}`
		);
		if (promoteSurfaceSection && defaultSurfaceSectionId) {
			activeId = `surfaceSection:${defaultSurfaceSectionId}`;
		}
		// Console expanded: always focus a section subcard (never leave only the parent selected).
		if (!openSurfaceId && this.consoleExpanded && !activeId.startsWith('consoleSection:')) {
			activeId = `consoleSection:${this.workspaceHomeView}`;
		}
		this.activeRailCardId = activeId;
		if (promoteSurfaceSection && openSurfaceId && defaultSurfaceSectionId) {
			this.persistSurfaceSection(openSurfaceId, defaultSurfaceSectionId);
			this.surfaceMainView = (defaultSurfaceSectionId === 'preview' || defaultSurfaceSectionId === 'deployed')
				? 'preview'
				: 'plan';
			this.surfacePlanPanel?.selectSection(defaultSurfaceSectionId);
		}
		// Keep the open Console / surface parent highlighted when a nested section card is focused.
		const preview = isRailHoverPreviewActive({
			hoveredRailParentId: this.hoveredRailParentId,
			openSurfaceId,
			consoleExpanded: this.consoleExpanded,
		});
		// Preview children share surfaceSection:* ids with the committed surface — only keep
		// the open parent highlighted so Real Graph etc. don't light up on the wrong group.
		const paintActiveId = preview && openSurfaceId
			? `surface:${openSurfaceId}`
			: preview && this.consoleExpanded
				? 'console'
				: activeId;
		const alsoSelected: string[] = [];
		if (!preview) {
			if (openSurfaceId && paintActiveId !== `surface:${openSurfaceId}`) {
				alsoSelected.push(`surface:${openSurfaceId}`);
			}
			if (!openSurfaceId && this.consoleExpanded) {
				alsoSelected.push('console');
			}
		}
		// Apply selection before setCards so a rail rebuild paints parent + subcard active together.
		this.uiWorkspaceHomeCardRail.setActiveId(paintActiveId, alsoSelected);
		this.uiWorkspaceHomeCardRail.setCards(cards);
		this.uiWorkspaceHomeCardRail.setActiveId(paintActiveId, alsoSelected);
		this.uiWorkspaceHomeCardRail.setPreviewAssocGroup(preview ? this.hoveredRailParentId : undefined);
		this.uiWorkspaceHomeCardRail.setLoading(
			Boolean(openSurfaceId && this.surfaceRailCardsLoading && this.surfaceRailCards.length === 0),
			localize('customMode.surfaceRailCardsLoading', 'Loading surface…'),
		);

		// Manifest/missing empty copy owns the content pane — keep section hosts hidden.
		const showEmptyContent = !this.uiSurfaceEmptyState.classList.contains('hidden');
		const showConsoleSections = showConsoleHost && !showEmptyContent;
		// Stack every Console section in one column (Surface proposal-tree style).
		// Only the focused section's <details> is open; the rest stay collapsed.
		this.uiConsoleHomeHost.classList.toggle('hidden', !showConsoleSections);
		for (const panel of [
			this.uiWorkspacePlanHomePanel,
			this.uiWorkspaceClaudeMdPanelRoot,
			this.uiWorkspaceHowItWorksPanel,
			this.uiWorkspaceDescriptionPanel,
			this.uiWorkspaceDockerPanel,
			this.uiSurfaceSetupSurfacesBody,
			this.uiWorkspacePlanBrandFields,
			this.uiWorkspaceSettingsPanel,
		]) {
			panel.classList.toggle('hidden', !showConsoleSections);
		}
		this.uiSurfaceEmptyState.classList.toggle('hidden', !showEmptyContent);
		if (showEmptyContent) {
			this.uiSurfacePlanPanelRoot.classList.add('hidden');
			this.uiSurfacePlanPanelRoot.hidden = true;
			this.uiSurfaceCustomViewsRoot.classList.add('hidden');
			this.uiSurfaceCustomViewsRoot.hidden = true;
		}
		this.uiWorkspacePlanStrip.classList.toggle('hidden', !showConsoleSections);
		// Steps row visibility follows Console selection (not merely "no surface open").
		this.renderConsoleWorkflowProgress();
		if (showConsoleSections) {
			this.applyConsoleHomeSectionAccordion(this.workspaceHomeView);
			this.renderWorkspaceSurfaces();
			this.renderWorkspaceDescriptionPanel();
			void this.workspaceClaudeMdPanel?.load({ workspaceFolder: this.getWorkspaceFolderUri() });
		}
	}

	private renderWorkspaceSurfaces(): void {
		this.workspaceSurfaceCardListeners.clear();
		this.revokeSurfaceUiSnapshotObjectUrls();
		this.uiWorkspaceSurfacesGrid.replaceChildren();
		const surfaces = this.orderedWorkspaceSurfaces();
		if (!surfaces.length) {
			this.uiWorkspaceSurfacesHost.classList.add('hidden');
			return;
		}
		this.uiWorkspaceSurfacesHost.classList.remove('hidden');
		const openId = this.getOpenSurfaceId();
		for (const surface of surfaces) {
			this.uiWorkspaceSurfacesGrid.appendChild(this.createWorkspaceSurfaceCard(surface, openId === surface.id));
		}
	}

	private revokeSurfaceUiSnapshotObjectUrls(): void {
		for (const url of this.surfaceUiSnapshotObjectUrls.splice(0)) {
			URL.revokeObjectURL(url);
		}
	}

	private createWorkspaceSurfaceCard(surface: WorkspaceSurface, active: boolean): HTMLElement {
		const progress = this.surfaceProgressById.get(surface.id);
		const progressLabel = progress?.label;
		const card = $('button.custom-mode-ui-workspace-suggested-card.custom-mode-ui-workspace-surfaces-card', {
			type: 'button',
			title: progressLabel
				? localize(
					'customMode.workspaceSurfaceOpenProgressTitle',
					'Open {0} — {1} ({2}%)',
					surface.name,
					progressLabel,
					progress?.percent ?? 0,
				)
				: localize('customMode.workspaceSurfaceOpenTitle', 'Open {0}', surface.name),
			'aria-pressed': active ? 'true' : 'false',
		}) as HTMLButtonElement;
		card.classList.toggle('active', active);
		card.classList.toggle('selected', active);

		const top = $('div.custom-mode-ui-workspace-suggested-card-top', undefined,
			$('div.custom-mode-ui-workspace-suggested-card-name', undefined, surface.name),
			$('span.custom-mode-ui-workspace-suggested-card-badge.custom-mode-ui-workspace-surfaces-card-badge', undefined,
				localize('customMode.workspaceSurfaceBadge', 'Surface')),
		);
		card.appendChild(top);
		const media = $('div.custom-mode-ui-workspace-surfaces-card-media.hidden', {
			'aria-hidden': 'true',
		}) as HTMLElement;
		card.appendChild(media);
		let purposeEl: HTMLElement | undefined;
		if (surface.purpose) {
			purposeEl = $('div.custom-mode-ui-workspace-suggested-card-purpose.custom-mode-ui-workspace-surfaces-card-purpose', undefined, surface.purpose);
			card.appendChild(purposeEl);
		}
		card.appendChild(this.createWorkspaceSurfaceProgressEl(surface.id, progress));
		const chips = [
			...(surface.path ? [surface.path] : []),
			...surface.capabilities.slice(0, 6),
		];
		if (chips.length) {
			card.appendChild($('div.custom-mode-ui-workspace-suggested-card-chips', undefined,
				...chips.map(chip =>
					$('span.custom-mode-ui-workspace-suggested-card-chip', undefined, chip)
				),
			));
		}
		this.workspaceSurfaceCardListeners.add(addDisposableListener(card, 'click', () => {
			void this.openWorkspaceSuggestedSurfacePlan(surface.id);
		}));
		void this.hydrateWorkspaceSurfaceCardSnapshot(surface, media, purposeEl);
		return card;
	}

	private async hydrateWorkspaceSurfaceCardSnapshot(
		surface: WorkspaceSurface,
		mediaHost: HTMLElement,
		purposeEl: HTMLElement | undefined,
	): Promise<void> {
		const preferred = preferredSurfaceUiSnapshotSource(surface);
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!preferred || !workspaceFolder) {
			return;
		}
		const resolved = await resolveSurfaceUiSnapshotForCard(
			this.fileService,
			workspaceFolder,
			surface.id,
			preferred.url,
		);
		if (!resolved || !mediaHost.isConnected) {
			return;
		}
		try {
			const content = await this.fileService.readFile(resolved.image);
			if (!mediaHost.isConnected) {
				return;
			}
			const blob = new Blob([content.value.buffer as BlobPart], { type: 'image/jpeg' });
			const objectUrl = URL.createObjectURL(blob);
			this.surfaceUiSnapshotObjectUrls.push(objectUrl);
			const img = $('img.custom-mode-ui-workspace-surfaces-card-media-img', {
				src: objectUrl,
				alt: '',
				draggable: 'false',
			}) as HTMLImageElement;
			mediaHost.replaceChildren(img);
			mediaHost.classList.remove('hidden');
			purposeEl?.classList.add('has-snapshot');
		} catch {
			// Missing/unreadable cache — keep purpose-first layout.
		}
	}

	private maybeCaptureSurfaceUiSnapshot(): void {
		if (isWeb) {
			return;
		}
		const surface = this.getSelectedSurface();
		const preferred = surface ? preferredSurfaceUiSnapshotSource(surface) : undefined;
		if (!surface || !preferred) {
			return;
		}
		if (!this.embeddedUiShowsSurfacePreview(preferred.url)) {
			return;
		}
		const current = this.getEmbeddedUiUrl();
		if (!current || current === 'about:blank' || current.startsWith('chrome-error://')) {
			return;
		}
		if (preferred.kind === 'local' && !this.appReachable) {
			return;
		}
		// Deployed snapshots only when Deployed (or any load of production origin) is showing.
		// Local snapshots only when there is no productionUrl (preferred already enforces that).
		if (preferred.kind === 'deployed' && !this.urlsShareOrigin(current, preferred.url)) {
			return;
		}
		void this.captureAndPersistSurfaceUiSnapshot(surface, preferred);
	}

	private async captureAndPersistSurfaceUiSnapshot(
		surface: WorkspaceSurface,
		preferred: SurfaceUiSnapshotSource,
	): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder || this.surfaceUiSnapshotCaptureInFlight.has(surface.id)) {
			return;
		}
		this.surfaceUiSnapshotCaptureInFlight.add(surface.id);
		try {
			const sidecar = await readSurfaceUiSnapshotSidecar(this.fileService, workspaceFolder, surface.id);
			if (sidecar && !surfaceUiSnapshotUrlsMatch(sidecar.sourceUrl, preferred.url)) {
				await deleteSurfaceUiSnapshot(this.fileService, workspaceFolder, surface.id);
			} else if (!shouldCaptureSurfaceUiSnapshot(sidecar, preferred.url, Date.now())) {
				return;
			}
			if (!this.embeddedUiShowsSurfacePreview(preferred.url)) {
				return;
			}
			const bytes = await this.captureEmbeddedUiSnapshotBytes();
			if (!bytes?.byteLength) {
				return;
			}
			await writeSurfaceUiSnapshot(this.fileService, workspaceFolder, surface.id, {
				imageBytes: bytes,
				sourceUrl: preferred.url,
				kind: preferred.kind,
			});
			this.pushUiRuntimeLog(`[surface-snapshot] saved ${preferred.kind} for ${surface.id}`);
			this.renderWorkspaceSurfaces();
		} catch (e: unknown) {
			const err = e as { message?: string } | undefined;
			this.pushUiRuntimeLog(`[surface-snapshot] failed ${surface.id}: ${String(err?.message ?? e)}`);
		} finally {
			this.surfaceUiSnapshotCaptureInFlight.delete(surface.id);
		}
	}

	private async captureEmbeddedUiSnapshotBytes(): Promise<Uint8Array | undefined> {
		if (isWeb || !this.isWebviewElement(this.uiBrowser)) {
			return undefined;
		}
		const webview = this.uiBrowser as unknown as {
			capturePage?: () => Promise<{
				isEmpty?: () => boolean;
				toJPEG?: (quality: number) => Uint8Array;
				toPNG?: () => Uint8Array;
			}>;
		};
		if (typeof webview.capturePage !== 'function') {
			return undefined;
		}
		try {
			const image = await webview.capturePage();
			if (image?.isEmpty?.()) {
				return undefined;
			}
			if (typeof image?.toJPEG !== 'function') {
				return undefined;
			}
			const jpeg = image.toJPEG(80);
			return jpeg?.byteLength ? jpeg : undefined;
		} catch {
			return undefined;
		}
	}

	private createWorkspaceSurfaceProgressEl(
		_surfaceId: string,
		progress: SurfacePlanWorkflowProgress | undefined,
	): HTMLElement {
		const percent = progress?.percent ?? 0;
		const label = progress?.label
			?? localize('customMode.workspaceSurfaceProgressIdle', 'Not started');
		const complete = Boolean(progress?.complete);
		const inProgress = Boolean(progress?.inProgress);
		const root = $('div.custom-mode-ui-workspace-surfaces-card-progress');
		root.classList.toggle('is-complete', complete);
		root.classList.toggle('is-running', inProgress);
		const bar = $('div.custom-mode-ui-workspace-surfaces-card-progress-bar') as HTMLElement;
		bar.style.width = `${percent}%`;
		bar.classList.toggle('is-complete', complete);
		bar.classList.toggle('is-running', inProgress && !complete);
		root.appendChild($('div.custom-mode-ui-workspace-surfaces-card-progress-track', undefined, bar));
		root.appendChild($('div.custom-mode-ui-workspace-surfaces-card-progress-meta', undefined,
			$('span.custom-mode-ui-workspace-surfaces-card-progress-label', {
				title: label,
			}, label),
			$('span.custom-mode-ui-workspace-surfaces-card-progress-pct', undefined, `${percent}%`),
		));
		return root;
	}

	private renderWorkspaceSuggestedSurfaces(): void {
		this.renderWorkspaceSurfaces();
		this.workspaceSuggestedCardListeners.clear();
		this.uiWorkspaceSuggestedGrid.replaceChildren();
		const doc = this.workspaceSuggestedSurfaces;
		// Keep Suggested for surfaces not yet materialized in workspace.goal.json.
		const pending = (doc?.surfaces ?? []).filter(surface => !this.findExistingSuggestedSurfaceId(surface));
		if (!pending.length) {
			this.uiWorkspaceSuggestedHost.classList.add('hidden');
			this.renderConsoleWorkflowProgress();
			this.syncWorkspaceHomeView();
			return;
		}

		this.uiWorkspaceSuggestedHost.classList.remove('hidden');
		const selectedCount = pending.filter(surface => surface.selected).length;
		this.uiWorkspaceSuggestedCreateButton.disabled = selectedCount === 0;
		this.renderConsoleWorkflowProgress();

		for (const surface of pending) {
			this.uiWorkspaceSuggestedGrid.appendChild(this.createWorkspaceSuggestedCard(surface));
		}
		// Suggestions belong on Surfaces — open that Console section once when they first appear after kickoff.
		if (
			this.workspaceSuggestedSurfacesRevealPending
			&& doc
			&& doc.status !== 'confirmed'
			&& !this.getOpenSurfaceId()
		) {
			this.workspaceSuggestedSurfacesRevealPending = false;
			this.openConsoleWithSection('surfaces');
			return;
		}
		this.syncWorkspaceHomeView();
	}

	private createWorkspaceSuggestedCard(surface: WorkspaceSuggestedSurface): HTMLElement {
		const existingId = this.findExistingSuggestedSurfaceId(surface);
		const card = $('button.custom-mode-ui-workspace-suggested-card', {
			type: 'button',
			'aria-pressed': surface.selected ? 'true' : 'false',
			title: existingId
				? localize('customMode.workspaceSuggestedOpenTitle', 'Open {0}', surface.name)
				: localize('customMode.workspaceSuggestedCreateTitle', 'Create {0}', surface.name),
		}) as HTMLButtonElement;
		card.classList.toggle('selected', surface.selected);

		const top = $('div.custom-mode-ui-workspace-suggested-card-top', undefined,
			$('div.custom-mode-ui-workspace-suggested-card-name', undefined, surface.name),
		);
		if (surface.suggested) {
			top.appendChild($('span.custom-mode-ui-workspace-suggested-card-badge', undefined,
				localize('customMode.workspaceSuggestedBadge', 'Suggested')));
		}
		card.appendChild(top);
		if (surface.purpose) {
			card.appendChild($('div.custom-mode-ui-workspace-suggested-card-purpose', undefined, surface.purpose));
		}
		const chips = [...surface.keyCapabilities, ...surface.primaryUsers.map(user => `user:${user}`)];
		if (chips.length) {
			card.appendChild($('div.custom-mode-ui-workspace-suggested-card-chips', undefined,
				...chips.slice(0, 8).map(chip =>
					$('span.custom-mode-ui-workspace-suggested-card-chip', undefined, chip)
				),
			));
		}
		this.workspaceSuggestedCardListeners.add(addDisposableListener(card, 'click', () => {
			void this.createAndOpenWorkspaceSuggestedSurface(surface);
		}));
		return card;
	}

	private findExistingSuggestedSurfaceId(surface: WorkspaceSuggestedSurface): string | undefined {
		const preferredId = slugifySurfaceId(surface.id || surface.name);
		const byId = this.consoleService.getSurface(preferredId)
			?? (preferredId !== surface.id ? this.consoleService.getSurface(surface.id) : undefined);
		if (byId) {
			return byId.id;
		}
		return this.consoleService.getSurfaces().find(candidate => candidate.name === surface.name)?.id;
	}

	/** Create (or reopen) one suggested surface and switch Console to its Plan view. */
	private async createAndOpenWorkspaceSuggestedSurface(surface: WorkspaceSuggestedSurface): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceClaudeNoWorkspace', 'Open a workspace folder before creating a new surface.'));
			return;
		}
		try {
			const existingId = this.findExistingSuggestedSurfaceId(surface);
			const surfaceId = existingId ?? await this.materializeWorkspaceSuggestedSurface(workspaceFolder, surface);
			if (!surfaceId) {
				this.notificationService.warn(localize(
					'customMode.workspaceSuggestedCreateOneFailed',
					'Could not create {0} as a surface view.',
					surface.name,
				));
				return;
			}
			// Console owns the confirm gate: durable status + selection before any Claude kickoff.
			if (this.workspaceSuggestedSurfaces) {
				const selected = withSuggestedSurfaceSelection(this.workspaceSuggestedSurfaces, surface.id, true);
				const confirmed = withSuggestedSurfacesStatus(selected, 'confirmed');
				await this.persistWorkspaceSuggestedSurfaces(workspaceFolder, confirmed);
			}
			await this.openWorkspaceSuggestedSurfacePlan(surfaceId);
			if (!existingId) {
				await this.kickoffSuggestedSurfaceResearch(workspaceFolder, surfaceId, surface);
				this.notificationService.info(localize(
					'customMode.workspaceSuggestedCreatedOne',
					'Created {0} surface view.',
					surface.name,
				));
			} else {
				this.notificationService.info(localize('customMode.workspaceSuggestedOpened', 'Opened {0}.', surface.name));
			}
		} catch (error: unknown) {
			this.notificationService.error(localize(
				'customMode.workspaceSuggestedCreateOneError',
				'Failed to create {0}: {1}',
				surface.name,
				String((error as Error)?.message ?? error),
			));
		}
	}

	/** After Console confirms a suggested surface, kick Claude into per-surface Research. */
	private async kickoffSuggestedSurfaceResearch(
		workspaceFolder: URI,
		surfaceId: string,
		surface: WorkspaceSuggestedSurface,
	): Promise<void> {
		const intentParts = [
			surface.purpose?.trim() || `Build ${surface.name}.`,
			surface.primaryUsers.length ? `Primary users: ${surface.primaryUsers.join(', ')}` : '',
			surface.keyCapabilities.length ? `Key capabilities:\n${surface.keyCapabilities.map(cap => `- ${cap}`).join('\n')}` : '',
		].filter(Boolean);
		try {
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			await this.beginSurfacePlanningSession({
				workspaceFolder,
				surfaceId,
				surfaceName: surface.name,
				intent: intentParts.join('\n'),
				writeProvisionalPlan: false,
			});
		} catch (error: unknown) {
			this.notificationService.warn(localize(
				'customMode.workspaceSuggestedResearchKickoffFailed',
				'Created {0}, but could not start Claude Research: {1}',
				surface.name,
				String((error as Error)?.message ?? error),
			));
		}
	}

	private async materializeWorkspaceSuggestedSurface(
		workspaceFolder: URI,
		surface: WorkspaceSuggestedSurface,
	): Promise<string | undefined> {
		await this.fileService.createFolder(joinPath(workspaceFolder, '.agent', 'surfaces'));
		await this.fileService.createFolder(joinPath(workspaceFolder, '.agent', 'task-trees'));
		const surfaceId = this.uniqueSurfaceId(surface.id || surface.name);
		const imported = await upsertImportedGoalWorkspaceSurface(this.fileService, workspaceFolder, {
			surfaceId,
			surfaceName: surface.name,
			relativePath: `apps/${surfaceId}`,
			purpose: surface.purpose || localize('customMode.surfaceClaudePurpose', 'Planning surface for {0}.', surface.name),
		});
		if (!imported) {
			return undefined;
		}
		const planResource = surfacePlanResource(workspaceFolder, surfaceId);
		try {
			await this.fileService.stat(planResource);
		} catch {
			const provisional = [
				`# ${surface.name} — Plan`,
				'',
				'## Status',
				'Created from workspace plan — open Plan to continue Research.',
				'',
				'## Intent',
				surface.purpose || surface.name,
				'',
				'## Primary users',
				...(surface.primaryUsers.length ? surface.primaryUsers.map(user => `- ${user}`) : ['- (tbd)']),
				'',
				'## Key capabilities',
				...(surface.keyCapabilities.length ? surface.keyCapabilities.map(cap => `- ${cap}`) : ['- (tbd)']),
				'',
				'## §0 Plan lock',
				'- [ ] Locked',
				'',
				'## Research',
				'(pending)',
				'',
				'## Risks / deferrals',
				'(pending)',
				'',
				'## Proposed Code Graph',
				`See \`.agent/task-trees/${surfaceId}.graph-proposal.json\` (pending).`,
				'',
			].join('\n');
			await this.fileService.writeFile(planResource, VSBuffer.fromString(provisional));
		}
		return surfaceId;
	}

	private async openWorkspaceSuggestedSurfacePlan(
		surfaceId: string,
		options?: { preferSectionId?: string },
	): Promise<void> {
		const generation = ++this.surfacePlanOpenGeneration;
		this.clearHoveredRailParent({ immediate: true });
		// Select eagerly so the rail highlights immediately and toggle-to-close works while
		// refresh is in flight. Without this, a second click starts another open instead of collapse.
		this.modeService.setMode('UI');
		const surfaceChanged = this.selectedSurfaceId !== surfaceId;
		const surface = this.consoleService.getSurface(surfaceId);
		if (surfaceChanged) {
			this.surfacePlanPanel?.clear();
		}
		this.selectedSurfaceId = surfaceId;
		const preferSectionId = options?.preferSectionId?.trim() || undefined;
		if (preferSectionId) {
			this.pendingSurfaceSectionId = preferSectionId;
			this.activeRailCardId = `surfaceSection:${preferSectionId}`;
		} else {
			this.activeRailCardId = `surface:${surfaceId}`;
		}
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
		// Section cards + default section once — avoid selectOwningSurfaceCard (it re-selects again).
		// Force placeholders only on surface switch; same-surface reopen keeps hydrated badges.
		if (surface) {
			this.applyImmediateSurfaceRailCards(surface, {
				focusDefaultSection: true,
				forcePlaceholders: surfaceChanged,
			});
		} else {
			this.surfaceRailCardsLoading = !this.surfaceRailCards.length;
			this.syncWorkspaceHomeView();
		}
		this.contextGatheringOpen = false;
		this.persistContextGatheringOpen();
		this.surfaceMainView = 'plan';
		this.persistSurfaceMainView(surfaceId, 'plan');
		this.showClaudeTerminalForKey(surfaceId);
		this.syncSurfaceMainView();

		await this.consoleService.refresh();
		if (generation !== this.surfacePlanOpenGeneration || this.selectedSurfaceId !== surfaceId) {
			return;
		}
		this.syncGoalSurfaceSwitcher();
		void this.surfaceFeatureChecklistService.refresh();
		// Only re-assert default section if the user hasn't already picked a section card.
		const stillOnParent = this.activeRailCardId === `surface:${surfaceId}`;
		const sectionStillValid = this.activeRailCardId?.startsWith('surfaceSection:')
			&& this.surfaceRailCards.some(card => card.id === this.activeRailCardId);
		if (stillOnParent || !sectionStillValid) {
			this.selectDefaultSurfaceSectionOrOwner(surfaceId);
		} else {
			this.syncSurfaceMainView();
			this.syncWorkspaceHomeView();
		}
		this.showClaudeTerminalForKey(surfaceId);
		// Plan overlay used to hide the Preview webview — keep routing the live URL into the main pane.
		this.lastSurfacePreviewRouteKey = undefined;
		this.routeSelectedSurfacePreview();
	}

	private async createSelectedWorkspaceSurfaces(): Promise<void> {
		const doc = this.workspaceSuggestedSurfaces;
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!doc || !workspaceFolder) {
			return;
		}
		const selected = selectedSuggestedSurfaces(doc);
		if (!selected.length) {
			return;
		}
		this.uiWorkspaceSuggestedCreateButton.disabled = true;
		const failed: string[] = [];
		const created: Array<{ surfaceId: string; surface: WorkspaceSuggestedSurface; isNew: boolean }> = [];
		try {
			for (const surface of selected) {
				try {
					const existingId = this.findExistingSuggestedSurfaceId(surface);
					const surfaceId = existingId ?? await this.materializeWorkspaceSuggestedSurface(workspaceFolder, surface);
					if (!surfaceId) {
						failed.push(surface.name);
						continue;
					}
					created.push({ surfaceId, surface, isNew: !existingId });
					if (!existingId) {
						await this.consoleService.refresh();
					}
				} catch {
					failed.push(surface.name);
				}
			}
			if (!created.length) {
				this.notificationService.warn(localize(
					'customMode.workspaceSuggestedCreateNone',
					'Could not create the selected surfaces.',
				));
				return;
			}
			if (failed.length === 0) {
				const confirmed = withSuggestedSurfacesStatus(doc, 'confirmed');
				await this.persistWorkspaceSuggestedSurfaces(workspaceFolder, confirmed);
			}
			const first = created[0]!;
			await this.openWorkspaceSuggestedSurfacePlan(first.surfaceId);
			const kickoffTarget = created.find(entry => entry.isNew) ?? first;
			if (kickoffTarget.isNew) {
				await this.kickoffSuggestedSurfaceResearch(workspaceFolder, kickoffTarget.surfaceId, kickoffTarget.surface);
			}
			if (failed.length) {
				this.notificationService.warn(localize(
					'customMode.workspaceSuggestedCreatePartial',
					'Created surfaces, but failed for: {0}',
					failed.join(', '),
				));
			} else {
				this.notificationService.info(localize(
					'customMode.workspaceSuggestedCreateSuccess',
					'Created {0} surface(s) from the workspace plan.',
					created.length,
				));
			}
		} finally {
			this.renderWorkspaceSuggestedSurfaces();
		}
	}

	private async persistWorkspaceSuggestedSurfaces(workspaceFolder: URI, doc: WorkspaceSuggestedSurfaces): Promise<void> {
		this.workspaceSuggestedSurfaces = doc;
		this.renderWorkspaceSuggestedSurfaces();
		this.workspaceSuggestedWriteInFlight = true;
		try {
			await this.fileService.writeFile(
				workspaceSuggestedSurfacesResource(workspaceFolder),
				VSBuffer.fromString(serializeWorkspaceSuggestedSurfaces(doc)),
			);
		} finally {
			this.workspaceSuggestedWriteInFlight = false;
		}
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

	private createDescribeAppCard(): HTMLButtonElement {
		const button = $('button.custom-mode-ui-surface-starter-card.custom-mode-ui-surface-starter-card-new', {
			type: 'button',
			title: localize('customMode.surfaceDescribeAppTitle', 'Describe an app and start Claude planning'),
		},
			$('div.custom-mode-ui-surface-starter-card-header', undefined,
				$('div.custom-mode-ui-surface-starter-card-icon.codicon' + ThemeIcon.asCSSSelector(Codicon.edit)),
				$('div.custom-mode-ui-surface-starter-card-title', undefined, localize('customMode.surfaceDescribeApp', 'Describe App')),
			),
			$('div.custom-mode-ui-surface-starter-card-summary', undefined, localize('customMode.surfaceDescribeAppSummary', 'Describe with text, images, or files — Claude drafts the plan and proposal graph.')),
		) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => this.showDescribeAppCompose()));
		return button;
	}

	private createImportRepoCard(): HTMLButtonElement {
		const button = $('button.custom-mode-ui-surface-starter-card.custom-mode-ui-surface-starter-card-new', {
			type: 'button',
			title: localize('customMode.surfaceImportRepoTitle', 'Import an existing repo as a surface'),
		},
			$('div.custom-mode-ui-surface-starter-card-header', undefined,
				$('div.custom-mode-ui-surface-starter-card-icon.codicon' + ThemeIcon.asCSSSelector(Codicon.repo)),
				$('div.custom-mode-ui-surface-starter-card-title', undefined, localize('customMode.surfaceImportRepo', 'Import Repo')),
			),
			$('div.custom-mode-ui-surface-starter-card-summary', undefined, localize('customMode.surfaceImportRepoSummary', 'Register an existing app folder or clone a Git URL.')),
		) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => void this.importSurfaceRepo()));
		return button;
	}

	private createDescribeAppCompose(): HTMLElement {
		this.uiSurfaceDescribeNameInput = $('input.custom-mode-ui-surface-describe-name', {
			type: 'text',
			placeholder: localize('customMode.surfaceDescribeNamePlaceholder', 'e.g. Cadre bot'),
			'aria-label': localize('customMode.surfaceDescribeNameAria', 'Surface name'),
		}) as HTMLInputElement;
		this.uiSurfaceDescribeIntentInput = $('textarea.custom-mode-ui-surface-describe-intent', {
			rows: '5',
			placeholder: localize(
				'customMode.surfaceDescribeIntentPlaceholder',
				'What should this app do? Who is it for? Key workflows, constraints, and success criteria…',
			),
			'aria-label': localize('customMode.surfaceDescribeIntentAria', 'App description'),
		}) as HTMLTextAreaElement;
		this.uiSurfaceDescribeAttachmentList = $('div.custom-mode-ui-surface-describe-attachments');
		this.uiSurfaceDescribeSubmitButton = $('button.custom-mode-ui-surface-describe-submit', {
			type: 'button',
		}, localize('customMode.surfaceDescribeSubmit', 'Start planning')) as HTMLButtonElement;

		const backButton = $('button.custom-mode-ui-surface-describe-compose-back', {
			type: 'button',
		}, localize('customMode.surfaceDescribeBack', 'Back')) as HTMLButtonElement;
		this._register(addDisposableListener(backButton, 'click', () => {
			this.scheduleDescribeAppDraftSave();
			this.showSurfaceCreateChooser();
		}));

		const imageInput = $('input', { type: 'file', accept: 'image/*', hidden: 'true', multiple: 'true' }) as HTMLInputElement;
		const fileInput = $('input', { type: 'file', hidden: 'true', multiple: 'true' }) as HTMLInputElement;
		const imageButton = $('button.custom-mode-ui-surface-describe-media-btn', {
			type: 'button',
		},
			$('span.codicon' + ThemeIcon.asCSSSelector(Codicon.fileMedia)),
			localize('customMode.surfaceDescribeAddImage', 'Image'),
		) as HTMLButtonElement;
		const fileButton = $('button.custom-mode-ui-surface-describe-media-btn', {
			type: 'button',
		},
			$('span.codicon' + ThemeIcon.asCSSSelector(Codicon.symbolFile)),
			localize('customMode.surfaceDescribeAddFile', 'File'),
		) as HTMLButtonElement;
		this._register(addDisposableListener(imageButton, 'click', () => imageInput.click()));
		this._register(addDisposableListener(fileButton, 'click', () => fileInput.click()));
		this._register(addDisposableListener(imageInput, 'change', () => {
			void this.addDescribeAppFiles(imageInput.files, 'image');
			imageInput.value = '';
		}));
		this._register(addDisposableListener(fileInput, 'change', () => {
			void this.addDescribeAppFiles(fileInput.files, 'file');
			fileInput.value = '';
		}));
		this._register(addDisposableListener(this.uiSurfaceDescribeSubmitButton, 'click', () => void this.submitDescribeAppCompose()));
		this._register(addDisposableListener(this.uiSurfaceDescribeNameInput, 'input', () => this.scheduleDescribeAppDraftSave()));
		this._register(addDisposableListener(this.uiSurfaceDescribeIntentInput, 'input', () => this.scheduleDescribeAppDraftSave()));
		this._register(addDisposableListener(this.uiSurfaceDescribeIntentInput, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void this.submitDescribeAppCompose();
			}
		}));
		this._register(toDisposable(() => this.clearDescribeAppAttachmentPreviews()));

		const root = $('div.custom-mode-ui-surface-describe-compose', undefined,
			$('div.custom-mode-ui-surface-describe-compose-header', undefined,
				$('div', undefined,
					$('div.custom-mode-ui-surface-describe-compose-title', undefined, localize('customMode.surfaceDescribeComposeTitle', 'Describe App')),
					$('div.custom-mode-ui-surface-describe-compose-hint', undefined, localize(
						'customMode.surfaceDescribeComposeHint',
						'Add text, or drop / attach images and files. Claude will draft plan.md and the proposal graph — no app code yet.',
					)),
				),
				backButton,
			),
			$('label.custom-mode-ui-surface-describe-field', undefined,
				$('span.custom-mode-ui-surface-describe-label', undefined, localize('customMode.surfaceDescribeNameLabel', 'Surface name')),
				this.uiSurfaceDescribeNameInput,
			),
			$('label.custom-mode-ui-surface-describe-field', undefined,
				$('span.custom-mode-ui-surface-describe-label', undefined, localize('customMode.surfaceDescribeIntentLabel', 'Text')),
				this.uiSurfaceDescribeIntentInput,
			),
			$('div.custom-mode-ui-surface-describe-footer', undefined,
				this.uiSurfaceDescribeAttachmentList,
				$('div.custom-mode-ui-surface-describe-actions', undefined,
					$('div.custom-mode-ui-surface-describe-media', undefined, imageButton, fileButton, imageInput, fileInput),
					this.uiSurfaceDescribeSubmitButton,
				),
			),
		);
		this._register(addDisposableListener(root, 'dragenter', event => {
			if (!this.dragEventHasFiles(event)) {
				return;
			}
			event.preventDefault();
			root.classList.add('dragover');
		}));
		this._register(addDisposableListener(root, 'dragover', event => {
			if (!this.dragEventHasFiles(event)) {
				return;
			}
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
			root.classList.add('dragover');
		}));
		this._register(addDisposableListener(root, 'dragleave', event => {
			const related = event.relatedTarget;
			if (related instanceof Node && root.contains(related)) {
				return;
			}
			root.classList.remove('dragover');
		}));
		this._register(addDisposableListener(root, 'drop', event => {
			event.preventDefault();
			root.classList.remove('dragover');
			const files = event.dataTransfer?.files;
			if (files?.length) {
				void this.addDescribeAppFiles(files, 'file');
			}
		}));
		return root;
	}

	private dragEventHasFiles(event: DragEvent): boolean {
		const types = event.dataTransfer?.types;
		if (!types) {
			return false;
		}
		return Array.from(types).includes('Files');
	}

	private openNewSurfaceDescribe(): void {
		this.consoleExpanded = true;
		this.persistConsoleExpanded();
		this.activeRailCardId = 'newSurface:describe';
		this.deselectSurfaceForHomeRail();
		this.setWorkspaceHomeView('surfaces');
		this.showDescribeAppCompose();
	}

	private openNewSurfaceImport(): void {
		this.consoleExpanded = true;
		this.persistConsoleExpanded();
		this.activeRailCardId = 'newSurface:import';
		this.deselectSurfaceForHomeRail();
		this.setWorkspaceHomeView('surfaces');
		this.showSurfaceCreateChooser();
		void this.importSurfaceRepo();
	}

	private showDescribeAppCompose(): void {
		this.uiSurfaceCreateChooser.classList.add('hidden');
		this.uiSurfaceDescribeCompose.classList.add('visible');
		void this.hydrateDescribeAppDraft().then(() => {
			this.renderDescribeAppAttachments();
			queueMicrotask(() => {
				if (this.uiSurfaceDescribeNameInput.value.trim()) {
					this.uiSurfaceDescribeIntentInput.focus();
				} else {
					this.uiSurfaceDescribeNameInput.focus();
				}
			});
		});
	}

	private showSurfaceCreateChooser(): void {
		this.uiSurfaceDescribeCompose.classList.remove('visible');
		this.uiSurfaceCreateChooser.classList.remove('hidden');
	}

	private resetDescribeAppCompose(): void {
		this.describeAppAttachments.length = 0;
		this.clearDescribeAppAttachmentPreviews();
		this.uiSurfaceDescribeNameInput.value = '';
		this.uiSurfaceDescribeIntentInput.value = '';
		this.renderDescribeAppAttachments();
		this.uiSurfaceDescribeSubmitButton.disabled = false;
		this.uiSurfaceDescribeSubmitButton.textContent = localize('customMode.surfaceDescribeSubmit', 'Start planning');
		void clearDescribeAppDraft(this.fileService, this.getWorkspaceFolderUri());
		this.showSurfaceCreateChooser();
	}

	private scheduleDescribeAppDraftSave(): void {
		if (this.describeAppDraftHydrating) {
			return;
		}
		this.describeAppDraftAutosaveScheduler.schedule();
	}

	private async persistDescribeAppDraft(): Promise<void> {
		if (!this.uiSurfaceDescribeNameInput || !this.uiSurfaceDescribeIntentInput) {
			return;
		}
		await saveDescribeAppDraft(this.fileService, this.getWorkspaceFolderUri(), {
			surfaceName: this.uiSurfaceDescribeNameInput.value,
			intent: this.uiSurfaceDescribeIntentInput.value,
			attachments: [...this.describeAppAttachments],
		});
	}

	private async hydrateDescribeAppDraft(): Promise<void> {
		const draft = await loadDescribeAppDraft(this.fileService, this.getWorkspaceFolderUri());
		if (!draft) {
			return;
		}
		this.describeAppDraftHydrating = true;
		try {
			this.uiSurfaceDescribeNameInput.value = draft.surfaceName;
			this.uiSurfaceDescribeIntentInput.value = draft.intent;
			this.describeAppAttachments.length = 0;
			this.describeAppAttachments.push(...draft.attachments);
		} finally {
			this.describeAppDraftHydrating = false;
		}
	}

	private clearDescribeAppAttachmentPreviews(): void {
		for (const url of this.describeAppAttachmentPreviewUrls) {
			URL.revokeObjectURL(url);
		}
		this.describeAppAttachmentPreviewUrls.length = 0;
	}

	private async addDescribeAppFiles(fileList: FileList | null | undefined, kind: 'image' | 'file'): Promise<void> {
		if (!fileList?.length) {
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceDescribeAttachNoWorkspace', 'Open a workspace folder before attaching files.'));
			return;
		}
		for (const file of Array.from(fileList)) {
			const resolvedKind = kind === 'image' || file.type.startsWith('image/') ? 'image' : 'file';
			const nativePath = getPathForFile(file);
			let ref: DescribeAppAttachmentRef;
			if (nativePath) {
				const paths = toWorkspaceOrFsPaths(workspaceFolder, nativePath);
				ref = {
					id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					kind: resolvedKind,
					name: file.name || basename(URI.file(nativePath)),
					mimeType: file.type || 'application/octet-stream',
					fsPath: paths.fsPath,
					workspacePath: paths.workspacePath,
				};
			} else {
				// No native path (e.g. pasted blob) — stage once under the draft folder and keep a path ref.
				ref = await stageDescribeAppAttachment(this.fileService, workspaceFolder, file, resolvedKind);
			}
			const duplicate = this.describeAppAttachments.some(existing =>
				(ref.workspacePath && existing.workspacePath === ref.workspacePath)
				|| (ref.fsPath && existing.fsPath === ref.fsPath)
			);
			if (duplicate) {
				continue;
			}
			this.describeAppAttachments.push(ref);
		}
		this.renderDescribeAppAttachments();
		this.scheduleDescribeAppDraftSave();
	}

	private renderDescribeAppAttachments(): void {
		this.describeAppAttachmentListeners.clear();
		this.clearDescribeAppAttachmentPreviews();
		this.uiSurfaceDescribeAttachmentList.replaceChildren();
		this.uiSurfaceDescribeAttachmentList.setAttribute(
			'aria-label',
			localize('customMode.surfaceDescribeAttachmentsAria', 'Attached images and files'),
		);
		for (const attachment of this.describeAppAttachments) {
			const remove = $('button.custom-mode-ui-surface-describe-attachment-remove', {
				type: 'button',
				title: localize('customMode.surfaceDescribeRemoveAttachment', 'Remove {0}', attachment.name),
				'aria-label': localize('customMode.surfaceDescribeRemoveAttachment', 'Remove {0}', attachment.name),
			}, '\u00d7') as HTMLButtonElement;
			this.describeAppAttachmentListeners.add(addDisposableListener(remove, 'click', () => {
				const index = this.describeAppAttachments.findIndex(item => item.id === attachment.id);
				if (index >= 0) {
					this.describeAppAttachments.splice(index, 1);
					this.renderDescribeAppAttachments();
					this.scheduleDescribeAppDraftSave();
				}
			}));

			let preview: HTMLElement;
			if (attachment.kind === 'image') {
				const img = $('img.custom-mode-ui-surface-describe-attachment-preview', {
					alt: attachment.name,
				}) as HTMLImageElement;
				preview = img;
				void this.hydrateDescribeAppAttachmentPreview(img, attachment);
			} else {
				preview = $('div.custom-mode-ui-surface-describe-attachment-icon', undefined,
					$('span.codicon' + ThemeIcon.asCSSSelector(Codicon.symbolFile)),
				);
			}

			const pathLabel = attachmentRefDisplayPath(attachment);
			this.uiSurfaceDescribeAttachmentList.appendChild(
				$('div.custom-mode-ui-surface-describe-attachment', {
					title: pathLabel,
				},
					preview,
					$('div.custom-mode-ui-surface-describe-attachment-meta', undefined,
						$('span.custom-mode-ui-surface-describe-attachment-name', undefined, attachment.name),
						$('span.custom-mode-ui-surface-describe-attachment-path', undefined, pathLabel),
					),
					remove,
				),
			);
		}
	}

	private async hydrateDescribeAppAttachmentPreview(img: HTMLImageElement, attachment: DescribeAppAttachmentRef): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return;
		}
		const resource = attachmentRefResource(workspaceFolder, attachment);
		if (!resource) {
			return;
		}
		try {
			const content = await this.fileService.readFile(resource);
			const objectUrl = URL.createObjectURL(new Blob([content.value.buffer as BlobPart], { type: attachment.mimeType || 'image/*' }));
			this.describeAppAttachmentPreviewUrls.push(objectUrl);
			img.src = objectUrl;
		} catch {
			// Preview is best-effort; path ref still counts.
		}
	}

	private async submitDescribeAppCompose(): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceClaudeNoWorkspace', 'Open a workspace folder before creating a new surface.'));
			return;
		}
		const name = this.uiSurfaceDescribeNameInput.value.trim();
		const intent = this.uiSurfaceDescribeIntentInput.value.trim();
		if (!name) {
			this.notificationService.warn(localize('customMode.surfaceDescribeNameRequired', 'Enter a surface name before starting planning.'));
			this.uiSurfaceDescribeNameInput.focus();
			return;
		}
		if (!intent && this.describeAppAttachments.length === 0) {
			this.notificationService.warn(localize('customMode.surfaceDescribeIntentRequired', 'Add a description or attach files before starting planning.'));
			this.uiSurfaceDescribeIntentInput.focus();
			return;
		}
		this.uiSurfaceDescribeSubmitButton.disabled = true;
		const submitLabel = this.uiSurfaceDescribeSubmitButton.textContent;
		this.uiSurfaceDescribeSubmitButton.textContent = localize('customMode.surfaceDescribeSubmitStarting', 'Starting…');
		const surfaceId = this.uniqueSurfaceId(name);
		const attachmentsSnapshot = [...this.describeAppAttachments];
		try {
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			await this.fileService.createFolder(joinPath(workspaceFolder, '.agent', 'surfaces'));
			await this.fileService.createFolder(joinPath(workspaceFolder, '.agent', 'task-trees'));
			const attachmentPaths: string[] = [];
			if (attachmentsSnapshot.length) {
				// Prefer path references — do not copy original files into a new attachments folder.
				for (const attachment of attachmentsSnapshot) {
					const path = attachmentRefDisplayPath(attachment);
					if (path) {
						attachmentPaths.push(path);
					}
				}
			}
			await upsertImportedGoalWorkspaceSurface(this.fileService, workspaceFolder, {
				surfaceId,
				surfaceName: name,
				relativePath: `apps/${surfaceId}`,
				purpose: localize('customMode.surfaceClaudePurpose', 'Planning surface for {0}.', name),
			});
			await this.consoleService.refresh();

			// Persist selection before switcher sync so we don't stay on ADD_SURFACE_ID.
			this.selectedSurfaceId = surfaceId;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);

			const intentParts = [intent];
			if (attachmentPaths.length) {
				intentParts.push(
					'',
					'Attached references (read these during Research / planning; use existing paths — do not copy):',
					...attachmentPaths.map(path => `- ${path}`),
				);
			}
			const fullIntent = intentParts.join('\n').trim() || `Build ${name}.`;
			this.logClaudeKickoff(`describe-app create surface=${surfaceId} attachments=${attachmentPaths.length}`);
			await this.beginSurfacePlanningSession({
				workspaceFolder,
				surfaceId,
				surfaceName: name,
				intent: fullIntent,
				writeProvisionalPlan: true,
			});
			this.syncGoalSurfaceSwitcher();
			void this.surfaceFeatureChecklistService.refresh();
			this.resetDescribeAppCompose();
			this.notificationService.info(localize(
				'customMode.surfaceDescribeStarted',
				'Claude is planning {0}. Follow along in the Claude panel.',
				name,
			));
		} catch (error: unknown) {
			this.uiSurfaceDescribeSubmitButton.disabled = false;
			this.uiSurfaceDescribeSubmitButton.textContent = submitLabel || localize('customMode.surfaceDescribeSubmit', 'Start planning');
			this.logClaudeKickoff(`describe-app failed: ${String((error as Error)?.message ?? error)}`, true);
			this.notificationService.error(localize(
				'customMode.surfaceDescribeStartFailed',
				'Failed to start planning: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	/**
	 * Keep Console UI visible (Claude panel lives here), select the surface, seed a
	 * provisional plan when needed, and kick off / continue Claude with the planning prompt.
	 */
	private async beginSurfacePlanningSession(options: {
		readonly workspaceFolder: URI;
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly intent: string;
		readonly writeProvisionalPlan?: boolean;
	}): Promise<void> {
		const { workspaceFolder, surfaceId, surfaceName, intent } = options;
		const logCtx = `surface=${surfaceId}`;

		this.logClaudeKickoff(`start ${logCtx} name=${surfaceName}`);
		try {
			// Do not call selectGoalSurface — that switches to Code and hides the Claude panel.
			this.logClaudeKickoff(`select UI + surface ${logCtx}`);
			this.modeService.setMode('UI');
			this.selectedSurfaceId = surfaceId;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, surfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
			this.contextGatheringOpen = false;
			this.persistContextGatheringOpen();
			this.renderGoalSurfaceButtons(this.consoleService.getSurfaces());
			this.surfaceMainView = 'plan';
			this.persistSurfaceMainView(surfaceId, 'plan');

			if (options.writeProvisionalPlan) {
				const planResource = surfacePlanResource(workspaceFolder, surfaceId);
				try {
					await this.fileService.stat(planResource);
					this.logClaudeKickoff(`plan exists ${logCtx}`);
				} catch {
					this.logClaudeKickoff(`write provisional plan ${logCtx}`);
					const provisional = [
						`# ${surfaceName} — Plan`,
						'',
						'## Status',
						'Planning in progress via Claude…',
						'',
						'## Intent',
						intent,
						'',
						'## §0 Plan lock',
						'- [ ] Locked',
						'',
						'## Research',
						'(pending — Claude is surveying comparable repos and drafting the proposal graph)',
						'',
						'## Risks / deferrals',
						'(pending)',
						'',
						'## Proposed Code Graph',
						`See \`.agent/task-trees/${surfaceId}.graph-proposal.json\` (pending).`,
						'',
					].join('\n');
					await this.fileService.writeFile(planResource, VSBuffer.fromString(provisional));
				}
			}

			this.container.classList.add('custom-mode-ui-surface-selected');
			this.syncSurfaceSetupDashboardVisibility();
			this.syncSurfaceMainView();
			this.syncContextGatheringUi();
			this.updateUiProjectName();
			this.routeSelectedSurfacePreview();

			// Custom AI narrate/dispatch when workspace orchestrator is OpenAI-compatible or Ollama.
			const startPlanningLabel = localize('customMode.planOrchestrateStartPlanning', 'Start planning');
			let orchestrationUsedFallback: boolean | undefined;
			if (shouldOrchestratePlanAction('start_planning')) {
				const orchestrated = await this.runSurfacePlanOrchestrationTurn({
					surfaceId,
					surfaceName,
					actionId: 'start_planning',
					stepId: 'intent',
					stepLabel: startPlanningLabel,
				});
				orchestrationUsedFallback = orchestrated.usedFallback;
				const provider = this.getAgentOrchestratorProvider();
				if (!shouldRunCustomAiPlanOrchestration(provider)) {
					this.logClaudeKickoff(`orchestrator=${provider ?? 'unset'}; Claude kickoff continues ${logCtx}`);
				} else if (!shouldExecuteClaudeAfterOrchestration('start_planning', orchestrated.dispatch)) {
					this.logClaudeKickoff(`orchestrate dispatch mismatch; falling back to Claude kickoff ${logCtx}`);
				} else if (!orchestrated.usedFallback) {
					this.logClaudeKickoff(`Custom AI dispatched start_planning to Claude ${logCtx}`);
				} else {
					this.logClaudeKickoff(`Custom AI orchestration fallback; Claude kickoff continues ${logCtx}`);
				}
			}

			this.logClaudeKickoff(`reset Claude terminal ${logCtx}`);
			await this.resetClaudeTerminalSession(surfaceId);
			this.logClaudeKickoff(`attach/create Claude terminal ${logCtx}`);
			const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, surfaceId, { reveal: true });
			this.logClaudeKickoff(`terminal ${created ? 'created' : 'reused'} id=${terminal.instanceId} ${logCtx}`);
			await terminal.processReady;
			this.logClaudeKickoff(`process ready ${logCtx}`);
			await this.prepareTerminalForCommandOutput(terminal, 40, 2000);
			await terminal.focusWhenReady(true);
			this.relayoutTerminalInstances();
			await timeout(120);
			this.relayoutTerminalInstances();
			this.logClaudeKickoff(`host ${this.uiClaudeTerminalHost.clientWidth}x${this.uiClaudeTerminalHost.clientHeight} cols=${terminal.cols} ${logCtx}`);

			const prompt = buildSurfacePlanKickoffPrompt({
				surfaceId,
				surfaceName,
				intent,
			});
			this.logClaudeKickoff(`submit kickoff (${prompt.length} chars, terminal ${created ? 'new' : 'reuse'}) ${logCtx}`);
			if (created && this.markClaudeCliStarted(surfaceId)) {
				// Start Claude, then submit the kickoff as the first turn so the TUI is visible
				// immediately and we avoid oversized `claude '…'` argv on long intents.
				this.logClaudeKickoff(`send 'claude' command ${logCtx}`);
				await terminal.sendText('claude', true);
				// Claude Code TUI often needs >900ms to paint before it can accept a pasted turn.
				await timeout(1800);
				this.relayoutTerminalInstances();
			}
			await this.submitClaudePrompt(terminal, prompt);
			this.logClaudeKickoff(`kickoff submitted ${logCtx}`);
			this.notificationService.info(localize(
				'customMode.planKickoffDispatched',
				'{0}',
				buildClaudeDispatchNotification(startPlanningLabel, orchestrationUsedFallback === true, { claudeDirect: orchestrationUsedFallback === undefined }),
			));

			// Refresh Plan tab in case the watcher has not picked up the provisional file yet.
			const surface = this.consoleService.getSurface(surfaceId);
			void this.surfacePlanPanel?.load({
				surfaceId,
				surfaceName,
				surfacePath: surface?.path,
				treeId: this.selectedSurfaceTaskTree?.id,
				localUrl: surface?.localUrl,
				surface,
				workspaceFolder,
				parallelClaudeWorkstreamsEnabled: this.isParallelClaudeWorkstreamsEnabled(),
			});
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			this.logClaudeKickoff(`FAILED ${logCtx}: ${message}`, true);
			throw error;
		}
	}

	/**
	 * Always-on kickoff logging: Claude header status, Output/log service, in-memory
	 * ring, Start App runtime panel (when visible), and `.agent/logs/claude-kickoff.log`.
	 * Local only — no LangGraph / remote telemetry required.
	 */
	private logClaudeKickoff(message: string, isError = false): void {
		const stamp = new Date().toISOString().slice(11, 23);
		const line = `[${stamp}] ${message}`;
		this.claudeKickoffLogs.push(line);
		if (this.claudeKickoffLogs.length > 80) {
			this.claudeKickoffLogs.splice(0, this.claudeKickoffLogs.length - 80);
		}
		if (this.uiClaudeTerminalStatus) {
			this.uiClaudeTerminalStatus.textContent = message;
			this.uiClaudeTerminalStatus.title = this.claudeKickoffLogs.slice(-12).join('\n');
			this.uiClaudeTerminalStatus.classList.toggle('error', isError);
		}
		if (isError) {
			this.logService.error(`[claude-kickoff] ${message}`);
		} else {
			this.logService.info(`[claude-kickoff] ${message}`);
		}
		this.pushUiRuntimeLog(`[claude-kickoff] ${message}`);
		void this.appendClaudeKickoffLogFile(line);
	}

	private async appendClaudeKickoffLogFile(line: string): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return;
		}
		try {
			const logsDir = joinPath(workspaceFolder, '.agent', 'logs');
			const logFile = joinPath(logsDir, 'claude-kickoff.log');
			await this.fileService.createFolder(logsDir);
			let existing = '';
			try {
				existing = (await this.fileService.readFile(logFile)).value.toString();
			} catch {
				// first write
			}
			const next = `${existing}${line}\n`.slice(-48_000);
			await this.fileService.writeFile(logFile, VSBuffer.fromString(next));
		} catch (error: unknown) {
			this.logService.warn(`[claude-kickoff] could not write log file: ${String((error as Error)?.message ?? error)}`);
		}
	}

	private uniqueAttachmentFileName(name: string, used: Set<string>): string {
		const cleaned = name.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '') || 'attachment';
		if (!used.has(cleaned)) {
			return cleaned;
		}
		const dot = cleaned.lastIndexOf('.');
		const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
		const ext = dot > 0 ? cleaned.slice(dot) : '';
		for (let i = 2; ; i++) {
			const candidate = `${stem}-${i}${ext}`;
			if (!used.has(candidate)) {
				return candidate;
			}
		}
	}

	private async importSurfaceRepo(): Promise<void> {		type ImportSourcePick = IQuickPickItem & { source: 'git' | 'folder' };
		const pick = await this.quickInputService.pick<ImportSourcePick>([
			{
				label: localize('customMode.surfaceImportGitLabel', 'Clone from Git URL'),
				description: localize('customMode.surfaceImportGitDescription', 'Clone into apps/<surface-id> and register it'),
				source: 'git',
			},
			{
				label: localize('customMode.surfaceImportFolderLabel', 'Use Existing Folder'),
				description: localize('customMode.surfaceImportFolderDescription', 'Register a folder already inside this workspace'),
				source: 'folder',
			},
		], {
			title: localize('customMode.surfaceImportSourceTitle', 'Import Repo'),
			placeHolder: localize('customMode.surfaceImportSourcePlaceholder', 'Choose where the repo comes from'),
		});
		if (!pick) {
			return;
		}
		if (pick.source === 'git') {
			await this.importSurfaceFromGitUrl();
		} else {
			await this.importSurfaceFromExistingFolder();
		}
	}

	private uniqueSurfaceId(preferredId: string): string {
		const used = new Set(this.consoleService.getSurfaces().map(surface => surface.id));
		const base = slugifySurfaceId(preferredId);
		if (!used.has(base)) {
			return base;
		}
		for (let i = 2; ; i++) {
			const candidate = `${base}-${i}`;
			if (!used.has(candidate)) {
				return candidate;
			}
		}
	}

	private async promptImportedSurfaceName(defaultName: string): Promise<string | undefined> {
		const name = await this.quickInputService.input({
			title: localize('customMode.surfaceImportNameTitle', 'Import Repo'),
			prompt: localize('customMode.surfaceImportNamePrompt', 'What should this surface be called?'),
			value: defaultName,
			placeHolder: localize('customMode.surfaceImportNamePlaceholder', 'e.g. Customer Portal'),
			validateInput: async value => value.trim() ? undefined : localize('customMode.surfaceImportNameRequired', 'Enter a surface name.'),
		});
		return normalizeOptionalSurfaceInput(name);
	}

	private async promptImportedSurfaceDevCommand(defaultPath: string): Promise<string | undefined> {
		const value = await this.quickInputService.input({
			title: localize('customMode.surfaceImportDevCommandTitle', 'Import Repo'),
			prompt: localize('customMode.surfaceImportDevCommandPrompt', 'Optional: enter the dev command for this surface.'),
			placeHolder: localize('customMode.surfaceImportDevCommandPlaceholder', 'e.g. npm --prefix {0} run dev', defaultPath),
		});
		return normalizeOptionalSurfaceInput(value);
	}

	private async importSurfaceFromGitUrl(): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceImportNoWorkspace', 'Open a workspace folder before importing a surface.'));
			return;
		}
		const repoUrl = await this.quickInputService.input({
			title: localize('customMode.surfaceImportGitTitle', 'Clone from Git URL'),
			prompt: localize('customMode.surfaceImportGitPrompt', 'Enter the Git repository URL to clone.'),
			placeHolder: localize('customMode.surfaceImportGitPlaceholder', 'https://github.com/acme/customer-portal.git'),
			validateInput: async value => value.trim() ? undefined : localize('customMode.surfaceImportGitRequired', 'Enter a Git repository URL.'),
		});
		const normalizedRepoUrl = normalizeOptionalSurfaceInput(repoUrl);
		if (!normalizedRepoUrl) {
			return;
		}
		const defaultId = surfaceIdFromRepoUrl(normalizedRepoUrl);
		const surfaceName = await this.promptImportedSurfaceName(defaultId.split('-').map(part => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part).join(' '));
		if (!surfaceName) {
			return;
		}
		const surfaceId = this.uniqueSurfaceId(surfaceName);
		const relativePath = `apps/${surfaceId}`;
		const target = joinPath(workspaceFolder, relativePath);
		try {
			await this.fileService.stat(target);
			this.notificationService.warn(localize('customMode.surfaceImportCloneTargetExists', 'Cannot clone because {0} already exists.', relativePath));
			return;
		} catch {
			// Missing is expected.
		}
		const devCommand = await this.promptImportedSurfaceDevCommand(relativePath);
		try {
			await this.fileService.createFolder(joinPath(workspaceFolder, 'apps'));
			await this.pluginGitService.cloneRepository(normalizedRepoUrl, target);
			await this.registerImportedSurface(surfaceId, surfaceName, relativePath, devCommand);
		} catch (error: unknown) {
			this.notificationService.error(localize('customMode.surfaceImportGitFailed', 'Could not import repo: {0}', String((error as Error)?.message ?? error)));
		}
	}

	private async importSurfaceFromExistingFolder(): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceImportNoWorkspace', 'Open a workspace folder before importing a surface.'));
			return;
		}
		const picked = await this.fileDialogService.showOpenDialog({
			title: localize('customMode.surfaceImportFolderTitle', 'Choose Surface Folder'),
			defaultUri: workspaceFolder,
			openLabel: localize('customMode.surfaceImportFolderOpenLabel', 'Import Surface'),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});
		const folder = picked?.[0];
		if (!folder) {
			return;
		}
		if (!isEqualOrParent(folder, workspaceFolder) || extUri.isEqual(folder, workspaceFolder)) {
			this.notificationService.warn(localize('customMode.surfaceImportFolderOutsideWorkspace', 'Choose a folder inside the current workspace.'));
			return;
		}
		const relativePath = extUri.relativePath(workspaceFolder, folder);
		if (!relativePath) {
			this.notificationService.warn(localize('customMode.surfaceImportFolderInvalidPath', 'Could not compute a workspace-relative surface path.'));
			return;
		}
		const defaultName = basename(folder).replace(/[-_]+/g, ' ');
		const surfaceName = await this.promptImportedSurfaceName(defaultName);
		if (!surfaceName) {
			return;
		}
		const surfaceId = this.uniqueSurfaceId(surfaceName);
		const devCommand = await this.promptImportedSurfaceDevCommand(relativePath);
		await this.registerImportedSurface(surfaceId, surfaceName, relativePath, devCommand);
	}

	private async registerImportedSurface(surfaceId: string, surfaceName: string, relativePath: string, devCommand?: string, localUrl?: string): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceImportNoWorkspace', 'Open a workspace folder before importing a surface.'));
			return;
		}
		const imported = await upsertImportedGoalWorkspaceSurface(this.fileService, workspaceFolder, {
			surfaceId,
			surfaceName,
			relativePath,
			devCommand,
			localUrl,
			purpose: localize('customMode.surfaceImportPurpose', 'Imported app surface for {0}.', surfaceName),
		});
		if (!imported) {
			this.notificationService.warn(localize('customMode.surfaceImportInvalid', 'Could not import {0}; choose a valid workspace-relative app folder.', surfaceName));
			return;
		}
		await this.consoleService.refresh();
		this.syncGoalSurfaceSwitcher();
		void this.refreshStarterSurfaceCardStatuses();
		void this.surfaceFeatureChecklistService.refresh();
		this.selectGoalSurface(surfaceId);
		this.notificationService.info(localize('customMode.surfaceImportSuccess', 'Imported {0} as a goal workspace surface.', surfaceName));
	}

	private async ensureWorkspaceClaudeMd(workspaceFolder: URI): Promise<void> {
		const resource = joinPath(workspaceFolder, 'CLAUDE.md');
		try {
			const existing = await this.fileService.readFile(resource);
			// Refresh stale seeded templates (identified by the seeded header) so contract
			// updates reach existing workspaces — hand-customized files are left alone.
			const text = existing.value.toString();
			const isSeededTemplate = text.startsWith('# CLAUDE.md — Surface agent working agreement');
			if (isSeededTemplate && text !== CADRE_SURFACE_CLAUDE_MD) {
				await this.fileService.writeFile(resource, VSBuffer.fromString(CADRE_SURFACE_CLAUDE_MD));
			}
		} catch {
			await this.fileService.writeFile(resource, VSBuffer.fromString(CADRE_SURFACE_CLAUDE_MD));
		}
		await this.ensureWorkspaceClaudeSettings(workspaceFolder);
	}

	/** Seed Claude permissions, inspect script, and ``.mcp.json`` (ix-graph stdio). */
	private async ensureWorkspaceClaudeSettings(workspaceFolder: URI): Promise<void> {
		const settingsResource = joinPath(workspaceFolder, '.claude', 'settings.json');
		const scriptResource = joinPath(workspaceFolder, '.claude', 'scripts', 'inspect_goal_workspace.py');
		const mcpResource = joinPath(workspaceFolder, '.mcp.json');
		try {
			await this.fileService.stat(settingsResource);
		} catch {
			await this.fileService.createFolder(joinPath(workspaceFolder, '.claude'));
			await this.fileService.writeFile(settingsResource, VSBuffer.fromString(CADRE_CLAUDE_SETTINGS_JSON));
		}
		try {
			await this.fileService.stat(scriptResource);
		} catch {
			await this.fileService.createFolder(joinPath(workspaceFolder, '.claude', 'scripts'));
			await this.fileService.writeFile(scriptResource, VSBuffer.fromString(CADRE_INSPECT_GOAL_WORKSPACE_PY));
		}
		// Always (re)write .mcp.json when missing so Claude Code can spawn ix-graph.
		// Permissions allow mcp__ix-graph__* but Claude will not connect without this file.
		try {
			await this.fileService.stat(mcpResource);
		} catch {
			const appRoot = this.nativeEnvironmentService.appRoot;
			if (appRoot) {
				const ixGraphScript = joinPath(URI.file(appRoot), 'scripts', 'ix_graph_mcp.py');
				try {
					await this.fileService.stat(ixGraphScript);
					await this.fileService.writeFile(
						mcpResource,
						VSBuffer.fromString(buildCadreClaudeMcpJson(ixGraphScript.fsPath)),
					);
				} catch {
					this.logService.warn('[modeShell] ix_graph_mcp.py missing; skipped seeding .mcp.json');
				}
			}
		}
	}

	/** Empty Plan tab → Claude Code: seed CLAUDE.md if needed, ensure session, send kickoff. */
	private async submitPlanBuildIntent(request: {
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly intent: string;
	}): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize('customMode.surfaceClaudeNoWorkspace', 'Open a workspace folder before creating a new surface.'));
			return;
		}
		const intent = request.intent.trim();
		if (!intent) {
			return;
		}
		try {
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			await this.beginSurfacePlanningSession({
				workspaceFolder,
				surfaceId: request.surfaceId,
				surfaceName: request.surfaceName,
				intent,
				writeProvisionalPlan: true,
			});
			this.notificationService.info(localize(
				'customMode.surfacePlanKickoffSent',
				'Sent build intent for {0} to Claude.',
				request.surfaceName,
			));
		} catch (error: unknown) {
			this.notificationService.error(localize(
				'customMode.surfacePlanKickoffFailed',
				'Could not send to Claude: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	/**
	 * Send a prompt to a running Claude Code session and actually submit it.
	 *
	 * Claude Code buffers a fast multi-line burst as a single "[Pasted text +N lines]"
	 * block and does NOT submit on the embedded newlines, so a plain
	 * `sendText(prompt, true)` leaves the message sitting unsent in the composer.
	 * Send the body without executing, let the paste settle, then send a lone
	 * Enter so Claude submits the buffered message.
	 */
	private async submitClaudePrompt(terminal: ITerminalInstance, prompt: string): Promise<void> {
		await terminal.sendText(prompt, false);
		await timeout(150);
		await terminal.sendText('', true);
	}

	/** After the Plan UI confirms Research repos, nudge Claude to clone only the selected set. */
	private async notifyClaudeReferenceSelectionConfirmed(selection: {
		readonly surfaceId: string;
		readonly selectedRepos: ReadonlyArray<{ readonly owner: string; readonly repo: string; readonly url: string }>;
	}): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.info(localize(
				'customMode.referenceSelectionSaved',
				'Saved {0} selected repo(s). Claude will pick this up from the candidates file.',
				selection.selectedRepos.length,
			));
			return;
		}
		const labels = selection.selectedRepos.map(repo => `${repo.owner}/${repo.repo}`);
		const prompt = [
			`Reference selection confirmed for surface ${selection.surfaceId}.`,
			`status is now "confirmed" in .agent/surfaces/${selection.surfaceId}.reference-candidates.json.`,
			`Clone and map ONLY these selected repos: ${labels.join(', ')}.`,
			`Skip deselected candidates. Continue the Research recipe from the shallow-clone step through remap_and_wait and draft_proposal_from_workspace.`,
		].join(' ');
		try {
			const state = this.surfaceAutoContinueStateById.get(selection.surfaceId);
			if (state) {
				state.lastNudgeMs = Date.now();
				this.surfaceAutoContinueStateById.set(selection.surfaceId, state);
			}
			await this.submitPromptToClaudeKey(workspaceFolder, selection.surfaceId, prompt, { reveal: true });
			this.notificationService.info(localize(
				'customMode.referenceSelectionSent',
				'Sent selected repos to Claude: {0}',
				labels.join(', '),
			));
		} catch (error: unknown) {
			this.notificationService.warn(localize(
				'customMode.referenceSelectionSendFailed',
				'Saved selection, but could not notify Claude: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	/** Plan status-tracker Next button — kick Claude; phase completion is via phase-progress.json. */
	private async notifyClaudePlanNextAction(request: {
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly actionId: string;
		readonly stepId: string;
		readonly stepLabel: string;
	}): Promise<void> {
		if (request.actionId === 'continue_research') {
			const workspaceFolder = this.getWorkspaceFolderUri();
			if (!workspaceFolder) {
				this.notificationService.warn(localize(
					'customMode.continueResearchNoWorkspace',
					'Open a workspace folder before continuing research in Claude.',
				));
				return;
			}
			await this.continueClaudeResearch(workspaceFolder, {
				surfaceId: request.surfaceId,
				surfaceName: request.surfaceName,
				stepId: request.stepId,
				stepLabel: request.stepLabel,
				automatic: false,
			});
			return;
		}
		if (request.actionId !== 'lock_plan' && request.actionId !== 'run_next_phase') {
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize(
				'customMode.planNextActionNoWorkspace',
				'Recorded "{0}", but open a workspace folder before continuing in Claude.',
				request.stepLabel,
			));
			return;
		}

		let usedFallback = true;
		if (shouldOrchestratePlanAction(request.actionId)) {
			const orchestrated = await this.runSurfacePlanOrchestrationTurn({
				surfaceId: request.surfaceId,
				surfaceName: request.surfaceName,
				actionId: request.actionId,
				stepId: request.stepId,
				stepLabel: request.stepLabel,
			});
			usedFallback = orchestrated.usedFallback;
			if (!shouldExecuteClaudeAfterOrchestration(request.actionId, orchestrated.dispatch)) {
				this.notificationService.warn(localize(
					'customMode.planNextActionDispatchMismatch',
					'Custom AI returned an unexpected dispatch for "{0}"; falling back to Claude.',
					request.stepLabel,
				));
				usedFallback = true;
			}
		}

		await this.executeClaudePlanNextAction(request, usedFallback);
	}

	/** Resume Claude-owned research (survey / clone / map / draft) after a stall or manual Continue. */
	private async continueClaudeResearch(
		workspaceFolder: URI,
		request: {
			readonly surfaceId: string;
			readonly surfaceName: string;
			readonly stepId: string;
			readonly stepLabel: string;
			readonly automatic: boolean;
		},
	): Promise<void> {
		const prompt = [
			request.automatic
				? `Console auto-resume: surface ${request.surfaceId} (${request.surfaceName}) is stalled on "${request.stepLabel}" (${request.stepId}).`
				: `Console Continue research for surface ${request.surfaceId} (${request.surfaceName}) at "${request.stepLabel}" (${request.stepId}).`,
			`Inspect current artifacts under .agent/surfaces/${request.surfaceId}.* and .agent/task-trees/${request.surfaceId}.* then continue the Research recipe from the first incomplete step.`,
			`If reference-candidates status is confirmed/done, remap_and_wait each selected clone, then draft_proposal_from_workspace into apps/${request.surfaceId} and write .agent/task-trees/${request.surfaceId}.graph-proposal.json.`,
			`Do not re-ask the user to confirm repos. Do not edit .workflow.json step statuses — the Console owns the Steps row.`,
		].join(' ');
		this.surfaceClaudeWorkingById.set(request.surfaceId, request.stepLabel);
		this.syncClaudeReopenAttention();
		await this.submitPromptToClaudeKey(workspaceFolder, request.surfaceId, prompt, { reveal: !request.automatic });
		if (!request.automatic) {
			this.notificationService.info(localize(
				'customMode.continueResearchSent',
				'Asked Claude to continue research for {0}.',
				request.surfaceName,
			));
		} else {
			this.notificationService.info(localize(
				'customMode.autoContinueResearchSent',
				'Auto-resumed Claude research for {0} — stuck on {1}.',
				request.surfaceName,
				request.stepLabel,
			));
		}
	}

	/**
	 * Custom AI Plan Steps orchestration turn. Returns a parsed DISPATCH_CLAUDE marker
	 * when present; on any failure omits the marker so the caller falls back to Claude.
	 * Skipped when workspace Agent Orchestrator is Claude (or unset).
	 */
	private async runSurfacePlanOrchestrationTurn(brief: {
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly actionId: SurfacePlanOrchestrationActionId;
		readonly stepId: string;
		readonly stepLabel: string;
	}): Promise<{ readonly dispatch: ReturnType<typeof parseDispatchClaudeMarker>; readonly usedFallback: boolean }> {
		const provider = this.getAgentOrchestratorProvider();
		if (!shouldRunCustomAiPlanOrchestration(provider)) {
			this.logService.info(`[plan-orchestrate] Skipping Custom AI (orchestrator=${provider ?? 'unset'}); Claude continues.`);
			return { dispatch: undefined, usedFallback: true };
		}
		const configuredOpenAiModel = this.configurationService.getValue<string>('custom.ai.openaiCompatible.model') ?? 'gpt-4o-mini';
		const userSelectedModelId = resolveOrchestratorModelId(provider, configuredOpenAiModel);
		try {
			const sessionResource = this.chatSessionManager.getOrCreateUISurfaceSessionResource(brief.surfaceId);
			const sessionRef = await this.chatService.acquireOrLoadSession(
				sessionResource,
				ChatAgentLocation.Chat,
				this.chatSessionsCts.token,
				'ModeShellContribution#runSurfacePlanOrchestrationTurn',
			);
			if (!sessionRef) {
				this.logService.warn('[plan-orchestrate] Could not load Custom AI session; falling back to Claude.');
				return { dispatch: undefined, usedFallback: true };
			}
			try {
				const prompt = buildSurfacePlanOrchestrationPrompt(brief);
				const sendResult = await this.chatService.sendRequest(sessionResource, prompt, {
					agentIdSilent: 'custom.ai',
					userSelectedModelId,
					location: ChatAgentLocation.Chat,
					modeInfo: {
						kind: ChatModeKind.Agent,
						isBuiltin: true,
						modeInstructions: undefined,
						telemetryModeId: 'agent',
						applyCodeBlockSuggestionId: undefined,
						permissionLevel: ChatPermissionLevel.AutoApprove,
					},
					isSystemInitiated: true,
					systemInitiatedLabel: localize('customMode.planOrchestrateLabel', 'Orchestrating: {0}', brief.stepLabel),
					instructionContext: { modeKind: ChatModeKind.Agent },
				});
				let current = sendResult;
				while (ChatSendResult.isQueued(current)) {
					current = await current.deferred;
				}
				if (!ChatSendResult.isSent(current)) {
					const reason = ChatSendResult.isRejected(current) ? current.reason : 'unknown';
					this.logService.warn(`[plan-orchestrate] Custom AI request not sent: ${reason}`);
					return { dispatch: undefined, usedFallback: true };
				}
				const response = await current.data.responseCreatedPromise;
				await current.data.responseCompletePromise;
				if (response.state === ResponseModelState.Failed || response.state === ResponseModelState.Cancelled || response.isCanceled) {
					this.logService.warn('[plan-orchestrate] Custom AI response failed or cancelled; falling back to Claude.');
					return { dispatch: undefined, usedFallback: true };
				}
				const text = response.entireResponse.getMarkdown() || response.entireResponse.toString();
				const dispatch = parseDispatchClaudeMarker(text);
				if (!dispatch) {
					this.logService.info('[plan-orchestrate] No DISPATCH_CLAUDE marker; falling back to Claude.');
					return { dispatch: undefined, usedFallback: true };
				}
				return { dispatch, usedFallback: false };
			} finally {
				sessionRef.dispose();
			}
		} catch (error: unknown) {
			this.logService.warn('[plan-orchestrate] Custom AI orchestration failed; falling back to Claude.', error);
			return { dispatch: undefined, usedFallback: true };
		}
	}

	/** Submit the existing Claude Plan Next coding prompt (unchanged contract). */
	private async executeClaudePlanNextAction(request: {
		readonly surfaceId: string;
		readonly surfaceName: string;
		readonly actionId: string;
		readonly stepId: string;
		readonly stepLabel: string;
	}, usedFallback: boolean): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return;
		}
		// Optimistic chip pulse until phase-progress watcher confirms running/idle.
		if (request.actionId === 'run_next_phase') {
			this.surfaceClaudeWorkingById.set(request.surfaceId, request.stepLabel);
			this.syncClaudeReopenAttention();
		}
		// Parallel workstream fan-out for generate phases (not lock / Preview / Deployed).
		const claudeDirect = !shouldRunCustomAiPlanOrchestration(this.getAgentOrchestratorProvider());
		if (
			request.actionId === 'run_next_phase'
			&& request.stepId !== 'enable_preview'
			&& request.stepId !== 'deployed'
			&& await this.tryFanoutClaudeWorkstreams(workspaceFolder, request)
		) {
			this.notificationService.info(localize(
				'customMode.planNextActionDispatchedParallel',
				'{0} — spawned parallel Claude workstreams.',
				buildClaudeDispatchNotification(request.stepLabel, usedFallback, { claudeDirect }),
			));
			return;
		}
		try {
			await this.submitSingleClaudePlanNextPrompt(workspaceFolder, request);
			this.notificationService.info(localize(
				'customMode.planNextActionDispatched',
				'{0}',
				buildClaudeDispatchNotification(request.stepLabel, usedFallback, { claudeDirect }),
			));
		} catch (error: unknown) {
			this.notificationService.warn(localize(
				'customMode.planNextActionSendFailed',
				'Recorded "{0}", but could not notify Claude: {1}',
				request.stepLabel,
				String((error as Error)?.message ?? error),
			));
		}
	}

	/** One Claude per surface — shared by Steps Next fallback and sequential Workstreams Run. */
	private async submitSingleClaudePlanNextPrompt(
		workspaceFolder: URI,
		request: {
			readonly surfaceId: string;
			readonly surfaceName: string;
			readonly actionId?: string;
			readonly stepId: string;
			readonly stepLabel: string;
		},
	): Promise<void> {
		const progressPath = `.agent/surfaces/${request.surfaceId}.phase-progress.json`;
		const prompt = request.actionId === 'lock_plan'
			? [
				`§0 Plan lock is checked for surface ${request.surfaceId} (${request.surfaceName}) via the Console Plan UI.`,
				`Do not start generate phases yet — wait for the Console Next button to kick each phase.`,
				`Do not re-open Research. Do not edit .workflow.json step statuses — the Console owns the Steps row.`,
			].join(' ')
			: request.stepId === 'enable_preview'
				? [
					`Console started step "Enable Preview" (${request.stepId}) for surface ${request.surfaceId} (${request.surfaceName}).`,
					`${progressPath} is status "running" for that stepId.`,
					`Update this surface entry in workspace.goal.json with path (apps/${request.surfaceId} unless already set), localUrl (http://localhost:<unique-unused-port>), and devCommand that serves that URL (prefer npm run dev --prefix apps/${request.surfaceId} -- --port <port>).`,
					`Pick a port not used by other surfaces in workspace.goal.json. Local Preview only for this step — public deploy is the separate Deployed step.`,
					`When localUrl and devCommand are written, update ${progressPath} to status "completed" for the same stepId/stepLabel (keep surfaceId).`,
					`On failure, set status "failed" with a short error field, then stop.`,
					`Do not edit .workflow.json — Console marks Steps completed only after it sees completed progress (or when it detects localUrl+devCommand).`,
				].join(' ')
				: request.stepId === 'deployed'
					? [
						`Console started step "Deployed" (${request.stepId}) for surface ${request.surfaceId} (${request.surfaceName}).`,
						`${progressPath} is status "running" for that stepId.`,
						`Publish this surface to a public host (prefer Vercel production deploy for the surface app path), then write productionUrl on this surface entry in workspace.goal.json (https public URL, not localhost).`,
						`When productionUrl is written and the deploy is live, update ${progressPath} to status "completed" for the same stepId/stepLabel (keep surfaceId).`,
						`On failure, set status "failed" with a short error field, then stop.`,
						`Do not edit .workflow.json — Console marks Steps completed only after it sees completed progress (or when it detects productionUrl).`,
					].join(' ')
					: [
						`Console started phase "${request.stepLabel}" (${request.stepId}) for surface ${request.surfaceId} (${request.surfaceName}).`,
						`${progressPath} is status "running" for that stepId.`,
						`Execute that phase from the graph proposal checklist, then remap_and_wait + compare_proposal.`,
						`When the phase gate passes, update ${progressPath} to status "completed" for the same stepId/stepLabel (keep surfaceId).`,
						`On failure, set status "failed" with a short error field, then stop.`,
						`Do not edit .workflow.json — Console marks Steps completed only after it sees completed progress.`,
					].join(' ');
		await this.submitPromptToClaudeKey(workspaceFolder, request.surfaceId, prompt, { reveal: true });
	}

	/**
	 * Manual / automatic fan-out: one Claude per parallel-safe workstream (serialize first).
	 * Returns false when Settings disables parallel or partition cannot fan out (caller uses single Claude).
	 */
	private async tryFanoutClaudeWorkstreams(
		workspaceFolder: URI,
		request: {
			readonly surfaceId: string;
			readonly surfaceName: string;
			readonly stepId: string;
			readonly stepLabel: string;
		},
	): Promise<boolean> {
		if (!this.isParallelClaudeWorkstreamsEnabled()) {
			return false;
		}
		const proposal = await this.readSurfaceGraphProposal(workspaceFolder, request.surfaceId);
		if (!proposal) {
			return false;
		}
		const plan = planClaudeWorkstreamFanout(request.surfaceId, partitionProposalWorkstreams(proposal));
		if (!shouldFanoutClaudeWorkstreams(true, plan.canFanout)) {
			return false;
		}
		await this.runClaudeWorkstreamFanout(workspaceFolder, request, plan.serialize, plan.parallel, plan.allKeys);
		return true;
	}

	/** Workstreams panel Run — parallel fan-out when Settings allows, else one Claude for the surface. */
	async runParallelWorkstreamsForSurface(surfaceId: string, surfaceName: string, stepId?: string, stepLabel?: string): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return;
		}
		const parallelEnabled = this.isParallelClaudeWorkstreamsEnabled();
		const request = {
			surfaceId,
			surfaceName,
			actionId: 'run_next_phase',
			stepId: stepId?.trim() || 'phase-generate',
			stepLabel: stepLabel?.trim() || (parallelEnabled
				? 'Generate (parallel workstreams)'
				: 'Generate'),
		};
		this.surfaceClaudeWorkingById.set(surfaceId, request.stepLabel);
		this.syncClaudeReopenAttention();
		// Keep the Surface rail on Build phases (workstreams nest inside) while Claudes are acting.
		this.selectSurfaceForPlanStep({
			surfaceId,
			stepId: request.stepId,
			stepKind: 'phase',
		});
		if (!parallelEnabled) {
			try {
				await this.submitSingleClaudePlanNextPrompt(workspaceFolder, request);
				this.notificationService.info(localize(
					'customMode.workstreamSequentialStarted',
					'Started generate with one Claude for {0}.',
					surfaceName || surfaceId,
				));
			} catch (error: unknown) {
				this.notificationService.warn(localize(
					'customMode.planNextActionSendFailed',
					'Recorded "{0}", but could not notify Claude: {1}',
					request.stepLabel,
					String((error as Error)?.message ?? error),
				));
			}
			return;
		}
		const ok = await this.tryFanoutClaudeWorkstreams(workspaceFolder, request);
		if (!ok) {
			this.notificationService.warn(localize(
				'customMode.workstreamFanoutUnavailable',
				'No parallel-safe workstreams for {0}. Need ≥2 disconnected streams without shared prefixes.',
				surfaceName || surfaceId,
			));
			return;
		}
		this.notificationService.info(localize(
			'customMode.workstreamFanoutStarted',
			'Spawned parallel Claude workstreams for {0}.',
			surfaceName || surfaceId,
		));
	}

	private async runClaudeWorkstreamFanout(
		workspaceFolder: URI,
		request: {
			readonly surfaceId: string;
			readonly surfaceName: string;
			readonly stepId: string;
			readonly stepLabel: string;
		},
		serialize: ClaudeWorkstreamSpawnSpec | undefined,
		parallel: readonly ClaudeWorkstreamSpawnSpec[],
		allKeys: readonly string[],
	): Promise<void> {
		await this.fileService.createFolder(joinPath(workspaceFolder, '.agent', 'surfaces'));
		const runsDoc = createRunningWorkstreamRuns({
			surfaceId: request.surfaceId,
			stepId: request.stepId,
			stepLabel: request.stepLabel,
			entries: [
				...(serialize ? [{
					key: serialize.key,
					workstreamId: serialize.workstreamId,
					mode: serialize.mode,
				}] : []),
				...parallel.map(spec => ({
					key: spec.key,
					workstreamId: spec.workstreamId,
					mode: spec.mode,
				})),
			],
		});
		await this.fileService.writeFile(
			surfaceWorkstreamRunsResource(workspaceFolder, request.surfaceId),
			VSBuffer.fromString(serializeSurfaceWorkstreamRuns(runsDoc)),
		);
		await this.fileService.writeFile(
			surfacePhaseProgressResource(workspaceFolder, request.surfaceId),
			VSBuffer.fromString(serializeSurfacePhaseProgress(createRunningPhaseProgress({
				surfaceId: request.surfaceId,
				stepId: request.stepId,
				stepLabel: request.stepLabel,
				message: localize(
					'customMode.workstreamFanoutRunning',
					'Running {0} Claude workstream(s)',
					String(allKeys.length),
				),
				inflightWorkstreamKeys: allKeys,
			}))),
		);

		const spawnSpec = async (spec: ClaudeWorkstreamSpawnSpec, reveal: boolean): Promise<void> => {
			const prompt = buildWorkstreamGeneratePrompt({
				surfaceId: request.surfaceId,
				surfaceName: request.surfaceName,
				stepId: request.stepId,
				stepLabel: request.stepLabel,
				workstreamId: spec.workstreamId,
				workstreamLabel: spec.label,
				mode: spec.mode,
				nodes: spec.nodes,
				sharedPrefixes: spec.sharedPrefixes,
				forbiddenNodes: spec.forbiddenNodes,
				claudeKey: spec.key,
			});
			await this.submitPromptToClaudeKey(workspaceFolder, spec.key, prompt, { reveal });
		};

		// Serial-then-parallel: start coupled Claude first, then fan out parallel-safe streams.
		if (serialize) {
			await spawnSpec(serialize, true);
		}
		await Promise.all(parallel.map((spec, index) => spawnSpec(spec, !serialize && index === 0)));
		this.syncClaudeWorkstreamSwitcher(serialize?.key ?? parallel[0]?.key);
	}

	private async readSurfaceGraphProposal(workspaceFolder: URI, surfaceId: string): Promise<GraphProposalDocument | undefined> {
		try {
			const content = await this.fileService.readFile(surfaceGraphProposalResource(workspaceFolder, surfaceId));
			return JSON.parse(content.value.toString()) as GraphProposalDocument;
		} catch {
			return undefined;
		}
	}

	private async submitPromptToClaudeKey(
		workspaceFolder: URI,
		key: string,
		prompt: string,
		options?: { reveal?: boolean },
	): Promise<void> {
		const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, key, { reveal: options?.reveal });
		await terminal.processReady;
		await this.prepareTerminalForCommandOutput(terminal, 40, 2000);
		if (options?.reveal) {
			await terminal.focusWhenReady(true);
		}
		this.relayoutTerminalInstances();
		if (created && this.markClaudeCliStarted(key)) {
			await terminal.sendText('claude --continue', true);
			await timeout(1800);
			this.relayoutTerminalInstances();
		}
		this.noteClaudeTerminalActivity(key, localize('customMode.claudeWorkingPrompt', 'Claude is working…'));
		await this.submitClaudePrompt(terminal, prompt);
	}

	private getVisibleClaudeTerminalInstance(): ITerminalInstance | undefined {
		if (!this.visibleClaudeTerminalKey) {
			return undefined;
		}
		const terminal = this.claudeTerminalByKey.get(this.visibleClaudeTerminalKey);
		return terminal && !terminal.isDisposed ? terminal : undefined;
	}

	private resolveClaudeTerminalKeyForSelection(): string | undefined {
		if (this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID) {
			// Prefer a visible workstream Claude for this surface when fan-out is active.
			if (this.visibleClaudeTerminalKey && isClaudeKeyForSurface(this.visibleClaudeTerminalKey, this.selectedSurfaceId)) {
				return this.visibleClaudeTerminalKey;
			}
			const sibling = [...this.claudeTerminalByKey.keys()]
				.filter(key => isClaudeKeyForSurface(key, this.selectedSurfaceId!) && !this.claudeTerminalByKey.get(key)?.isDisposed)
				.sort((a, b) => a.localeCompare(b))[0];
			return sibling ?? this.selectedSurfaceId;
		}
		return WORKSPACE_CLAUDE_KEY;
	}

	private resolveClaudeTerminalKeyFromInstance(instance: ITerminalInstance): string | undefined {
		return parseClaudeTerminalKey(instance.shellLaunchConfig.name)
			?? parseClaudeTerminalKey(instance.title);
	}

	private syncClaudeTerminalMapFromService(): void {
		if (this.claudeTerminalSyncDepth > 0) {
			return;
		}
		this.claudeTerminalSyncDepth++;
		try {
			for (const instance of this.terminalService.instances) {
				if (instance.isDisposed || instance.exitReason !== undefined) {
					continue;
				}
				let key = this.resolveClaudeTerminalKeyFromInstance(instance);
				if (!key) {
					const title = instance.shellLaunchConfig.name || instance.title;
					if (title === LEGACY_CLAUDE_TERMINAL_TITLE) {
						// One-time migration: adopt the pre-per-surface Claude terminal.
						key = this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID
							? this.selectedSurfaceId
							: WORKSPACE_CLAUDE_KEY;
						void instance.rename(claudeTerminalTitleFor(key));
					} else {
						continue;
					}
				}
				const existing = this.claudeTerminalByKey.get(key);
				// Already bound — re-registering would dispose+rebind lifecycle and can
				// re-enter the workstream switcher on the same stack.
				if (existing === instance && this.claudeTerminalLifecycleByKey.has(key)) {
					continue;
				}
				if (existing && existing !== instance && !existing.isDisposed) {
					continue;
				}
				this.registerClaudeTerminalInstance(key, instance);
			}
			this.persistClaudeTerminalActiveKeys();
		} finally {
			this.claudeTerminalSyncDepth--;
		}
	}

	private queueSyncClaudeWorkstreamSwitcher(activeKey: string | undefined): void {
		this.pendingClaudeWorkstreamActiveKey = activeKey;
		this.syncClaudeWorkstreamSwitcherScheduler.schedule();
	}

	private registerClaudeTerminalInstance(key: string, terminal: ITerminalInstance): void {
		if (this.claudeTerminalByKey.get(key) === terminal && this.claudeTerminalLifecycleByKey.has(key)) {
			return;
		}
		this.claudeTerminalByKey.set(key, terminal);
		const previousLifecycle = this.claudeTerminalLifecycleByKey.get(key);
		if (previousLifecycle) {
			previousLifecycle.dispose();
		}
		const store = new DisposableStore();
		store.add(terminal.onDisposed(() => {
			if (this.claudeTerminalByKey.get(key) !== terminal) {
				return;
			}
			this.claudeTerminalByKey.delete(key);
			this.claudeTerminalLifecycleByKey.delete(key);
			this.claudeCliStartedByKey.delete(key);
			this.persistClaudeTerminalActiveKeys();
			if (this.visibleClaudeTerminalKey === key) {
				this.visibleClaudeTerminalKey = undefined;
				this.uiClaudeTerminalEmpty.classList.remove('hidden');
				if (this.uiClaudeTerminalStatus && !this.uiClaudeTerminalStatus.classList.contains('error')) {
					this.uiClaudeTerminalStatus.textContent = '';
				}
			}
			// Defer tab rebuild — must not re-enter map sync on the dispose stack.
			this.queueSyncClaudeWorkstreamSwitcher(this.visibleClaudeTerminalKey);
			this.maybeAutoRestoreClaudeTerminal(key, terminal.exitReason);
		}));
		// PTY output while Claude streams — keeps the chip pulsing without polling.
		store.add(terminal.onData(() => {
			this.noteClaudeTerminalActivity(key);
		}));
		this.claudeTerminalLifecycleByKey.set(key, store);
		this.persistClaudeTerminalActiveKeys();
	}

	/** Returns true once per PTY lifetime so restore/ensure/plan-next do not double-launch Claude. */
	private markClaudeCliStarted(key: string): boolean {
		if (this.claudeCliStartedByKey.has(key)) {
			return false;
		}
		this.claudeCliStartedByKey.add(key);
		return true;
	}

	private detachVisibleClaudeTerminal(): void {
		const visible = this.getVisibleClaudeTerminalInstance();
		if (!visible) {
			this.visibleClaudeTerminalKey = undefined;
			return;
		}
		try {
			visible.detachFromElement();
			visible.setVisible(false);
		} catch {
			// Detach is best-effort; process stays alive.
		}
		this.visibleClaudeTerminalKey = undefined;
	}

	private showClaudeTerminalEmpty(key: string | undefined, options?: { starting?: boolean }): void {
		this.detachVisibleClaudeTerminal();
		this.uiClaudeTerminalEmpty.classList.remove('hidden');
		this.updateClaudeTerminalKeyLabel(key);
		if (options?.starting) {
			this.uiClaudeTerminalEmpty.textContent = localize(
				'customMode.claudeTerminalStarting',
				'Starting Claude…',
			);
			return;
		}
		if (!this.getWorkspaceFolderUri()) {
			this.uiClaudeTerminalEmpty.textContent = localize(
				'customMode.claudeTerminalNeedsWorkspace',
				'Open a workspace folder to start Claude.',
			);
			return;
		}
		if (key === ACTIONS_CLAUDE_KEY) {
			this.uiClaudeTerminalEmpty.textContent = localize(
				'customMode.claudeTerminalEmptyActions',
				'Actions Claude is unavailable.',
			);
		} else if (key && !isReservedClaudeKey(key)) {
			const surface = this.consoleService.getSurface(key);
			this.uiClaudeTerminalEmpty.textContent = localize(
				'customMode.claudeTerminalEmptyForSurface',
				'Claude is unavailable for {0}.',
				surface?.name ?? key,
			);
		} else {
			this.uiClaudeTerminalEmpty.textContent = localize(
				'customMode.claudeTerminalEmpty',
				'Claude is unavailable for this surface.',
			);
		}
	}

	private updateClaudeTerminalKeyLabel(key: string | undefined): void {
		if (!this.uiClaudeTerminalKeyLabel) {
			return;
		}
		// Tabs always own session identity for every live Claude; keep the label empty.
		this.uiClaudeTerminalKeyLabel.textContent = '';
		this.uiClaudeTerminalKeyLabel.title = '';
		if (this.claudeTerminalSyncDepth > 0) {
			this.queueSyncClaudeWorkstreamSwitcher(key);
			return;
		}
		this.syncClaudeWorkstreamSwitcher(key);
	}

	/** Tabs for every live Claude session — current key selected. */
	private syncClaudeWorkstreamSwitcher(activeKey: string | undefined): void {
		if (!this.uiClaudeTerminalKeyTabs) {
			return;
		}
		if (this.claudeTerminalSyncDepth > 0) {
			this.queueSyncClaudeWorkstreamSwitcher(activeKey);
			return;
		}
		const hideTabs = () => {
			this.lastClaudeTerminalTabKeys = [];
			this.claudeTerminalKeyTabListeners.clear();
			this.uiClaudeTerminalKeyTabs.classList.add('hidden');
			clearNode(this.uiClaudeTerminalKeyTabs);
			this.uiClaudeTerminalKeyLabel?.classList.remove('hidden');
		};
		this.syncClaudeTerminalMapFromService();
		const liveKeys = listLiveClaudeTerminalKeys(this.claudeTerminalByKey);
		if (!liveKeys.length) {
			hideTabs();
			return;
		}
		// Same session set: only flip active classes — full rebuild destroys the button
		// under the cursor and drops mid-click tab switches while Claude streams.
		if (
			claudeTerminalTabKeysEqual(this.lastClaudeTerminalTabKeys, liveKeys)
			&& this.uiClaudeTerminalKeyTabs.childElementCount > 0
		) {
			this.patchClaudeTerminalTabActive(activeKey);
			this.uiClaudeTerminalKeyTabs.classList.remove('hidden');
			this.uiClaudeTerminalKeyLabel.classList.add('hidden');
			return;
		}
		this.claudeTerminalKeyTabListeners.clear();
		clearNode(this.uiClaudeTerminalKeyTabs);
		this.lastClaudeTerminalTabKeys = [...liveKeys];
		const activeSurfaceId = activeKey ? surfaceIdFromClaudeKey(activeKey) : undefined;
		const hasWorkstreamTabs = activeSurfaceId
			? liveKeys.some(key => {
				const ws = parseClaudeWorkstreamKey(key);
				return Boolean(ws && ws.surfaceId === activeSurfaceId);
			})
			: false;
		for (const key of liveKeys) {
			const label = this.claudeTerminalTabLabel(key);
			const active = key === activeKey;
			const tab = $('button.custom-mode-ui-claude-terminal-key-tab', {
				type: 'button',
				role: 'tab',
				'aria-selected': active ? 'true' : 'false',
				title: claudeTerminalTitleFor(key),
			}, label) as HTMLButtonElement;
			if (active) {
				tab.classList.add('active');
			}
			const closeLabel = localize('customMode.claudeTerminalCloseSession', 'Close Claude session {0}', label);
			const closeButton = $('button.custom-mode-ui-claude-terminal-key-close', {
				type: 'button',
				title: closeLabel,
				'aria-label': closeLabel,
			}, '\u00d7') as HTMLButtonElement;
			const wrap = $('div.custom-mode-ui-claude-terminal-key-tab-wrap', undefined, tab, closeButton);
			if (active) {
				wrap.classList.add('active');
			}
			this.claudeTerminalKeyTabListeners.add(addDisposableListener(tab, 'click', () => {
				// Always reveal + attach — even when key matches, host may be empty/detached.
				this.showClaudeTerminalForKey(key, { reveal: true });
			}));
			this.claudeTerminalKeyTabListeners.add(addDisposableListener(tab, 'auxclick', (event: MouseEvent) => {
				if (event.button !== 1) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				void this.closeClaudeTerminalSession(key);
			}));
			this.claudeTerminalKeyTabListeners.add(addDisposableListener(closeButton, 'click', (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.closeClaudeTerminalSession(key);
			}));
			this.uiClaudeTerminalKeyTabs.appendChild(wrap);
		}
		if (hasWorkstreamTabs && activeSurfaceId) {
			const closeAll = $('button.custom-mode-ui-claude-terminal-key-close-all', {
				type: 'button',
				title: localize('customMode.claudeTerminalCloseAllWorkstreamsTitle', 'Close all workstream Claude sessions for this surface'),
			}, localize('customMode.claudeTerminalCloseAllWorkstreams', 'Close all')) as HTMLButtonElement;
			this.claudeTerminalKeyTabListeners.add(addDisposableListener(closeAll, 'click', (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.pruneClaudeWorkstreamTerminalsForSurface(activeSurfaceId);
			}));
			this.uiClaudeTerminalKeyTabs.appendChild(closeAll);
		}
		this.uiClaudeTerminalKeyTabs.classList.remove('hidden');
		this.uiClaudeTerminalKeyLabel.classList.add('hidden');
	}

	/** Update selected styling without recreating tab DOM. */
	private patchClaudeTerminalTabActive(activeKey: string | undefined): void {
		if (!this.uiClaudeTerminalKeyTabs) {
			return;
		}
		const wraps = this.uiClaudeTerminalKeyTabs.querySelectorAll('.custom-mode-ui-claude-terminal-key-tab-wrap');
		let index = 0;
		for (const key of this.lastClaudeTerminalTabKeys) {
			const wrap = wraps.item(index++) as HTMLElement | null;
			if (!wrap) {
				continue;
			}
			const active = key === activeKey;
			wrap.classList.toggle('active', active);
			const tab = wrap.querySelector('.custom-mode-ui-claude-terminal-key-tab');
			if (tab instanceof HTMLElement) {
				tab.classList.toggle('active', active);
				tab.setAttribute('aria-selected', active ? 'true' : 'false');
			}
		}
	}

	/** Short header-tab label for a Claude session key. */
	private claudeTerminalTabLabel(key: string): string {
		if (key === WORKSPACE_CLAUDE_KEY) {
			return localize('customMode.claudeTerminalWorkspaceLabel', 'Workspace');
		}
		if (key === ACTIONS_CLAUDE_KEY) {
			return localize('customMode.claudeTerminalActionsLabel', 'Actions');
		}
		const ws = parseClaudeWorkstreamKey(key);
		if (ws) {
			const surface = this.consoleService.getSurface(ws.surfaceId);
			const surfaceLabel = surface?.name?.trim() || ws.surfaceId;
			const wsLabel = ws.workstreamId === 'serialize'
				? localize('customMode.claudeTerminalSerializeOption', 'Serialize')
				: ws.workstreamId;
			return localize('customMode.claudeTerminalWorkstreamTab', '{0} · {1}', surfaceLabel, wsLabel);
		}
		const surface = this.consoleService.getSurface(key);
		return surface?.name?.trim() || key;
	}

	/** Dispose one Claude session tab and show a remaining live session. */
	private async closeClaudeTerminalSession(key: string): Promise<void> {
		this.claudeTerminalUiMutationDepth++;
		try {
			const wasVisible = this.visibleClaudeTerminalKey === key || !this.visibleClaudeTerminalKey;
			const before = listLiveClaudeTerminalKeys(this.claudeTerminalByKey);
			const closedIndex = before.indexOf(key);
			await this.resetClaudeTerminalSession(key);
			if (!wasVisible) {
				this.syncClaudeWorkstreamSwitcher(this.visibleClaudeTerminalKey);
				return;
			}
			const remaining = listLiveClaudeTerminalKeys(this.claudeTerminalByKey);
			const next = remaining.length
				? remaining[Math.min(Math.max(closedIndex, 0), remaining.length - 1)]
				: undefined;
			if (next) {
				this.showClaudeTerminalForKey(next, { reveal: true });
			} else {
				this.detachVisibleClaudeTerminal();
				this.updateClaudeTerminalKeyLabel(undefined);
			}
		} finally {
			this.claudeTerminalUiMutationDepth--;
		}
	}

	/**
	 * Detach the current Claude PTY (if any) and attach the terminal for `key`, or start Claude.
	 * Does not expand the Claude pane unless `reveal` is set or the pane is already open —
	 * Surface / Console card selection must not force Claude open.
	 */
	private showClaudeTerminalForKey(key: string | undefined, options?: { reveal?: boolean }): void {
		// Guard onDidChangeInstances during detach→attach — clearing visibleClaudeTerminalKey
		// mid-switch previously let selection rebind snap the tab back.
		this.claudeTerminalUiMutationDepth++;
		try {
			if (options?.reveal) {
				this.setClaudeTerminalCollapsed(false);
				this.scheduleClaudeTerminalHide();
			} else if (!this.claudeTerminalCollapsed) {
				// Already open — keep open and refresh the idle timer while switching sessions.
				this.scheduleClaudeTerminalHide();
			}
			this.syncClaudeTerminalMapFromService();
			if (key && this.visibleClaudeTerminalKey === key) {
				const current = this.claudeTerminalByKey.get(key);
				if (current && !current.isDisposed) {
					// Re-attach if the PTY is registered but no longer in the host (e.g. after detach race).
					if (current.domElement?.parentElement !== this.uiClaudeTerminalHost) {
						this.attachClaudeTerminalToHost(key, current);
						return;
					}
					this.updateClaudeTerminalKeyLabel(key);
					this.uiClaudeTerminalEmpty.classList.add('hidden');
					return;
				}
			}
			this.detachVisibleClaudeTerminal();
			if (!key) {
				this.showClaudeTerminalEmpty(undefined);
				return;
			}
			const terminal = this.findClaudeTerminalInstance(key);
			if (!terminal) {
				this.ensureClaudeTerminalInitialized(key, options);
				return;
			}
			this.attachClaudeTerminalToHost(key, terminal);
		} finally {
			this.claudeTerminalUiMutationDepth--;
		}
	}

	/**
	 * Create and start Claude for `key` immediately — do not wait for planning / Steps Next.
	 * Safe to call repeatedly; concurrent ensures for the same key coalesce.
	 */
	private ensureClaudeTerminalInitialized(key: string, options?: { reveal?: boolean }): void {
		if (this.findClaudeTerminalInstance(key)) {
			this.showClaudeTerminalForKey(key, options);
			return;
		}
		if (!this.terminalService.isProcessSupportRegistered) {
			// Terminals cannot launch here (e.g. web without a remote) — show the empty
			// state without a spinner instead of failing kickoff on every UI sync.
			this.showClaudeTerminalEmpty(key);
			return;
		}
		if (this.claudeTerminalEnsureInFlightByKey.has(key)) {
			this.showClaudeTerminalEmpty(key, { starting: true });
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.showClaudeTerminalEmpty(key);
			return;
		}
		this.showClaudeTerminalEmpty(key, { starting: true });
		this.claudeTerminalEnsureInFlightByKey.add(key);
		this.syncClaudeReopenAttention();
		void this.initializeClaudeTerminalForKey(key, workspaceFolder, options).finally(() => {
			this.claudeTerminalEnsureInFlightByKey.delete(key);
			this.syncClaudeReopenAttention();
		});
	}

	private async initializeClaudeTerminalForKey(key: string, workspaceFolder: URI, options?: { reveal?: boolean }): Promise<void> {
		try {
			const existing = this.findClaudeTerminalInstance(key);
			if (existing) {
				if (this.resolveClaudeTerminalKeyForSelection() === key) {
					this.showClaudeTerminalForKey(key, options);
				}
				return;
			}
			this.logClaudeKickoff(`ensure Claude terminal key=${key}`);
			const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, key, options);
			const stillRelevant = this.resolveClaudeTerminalKeyForSelection() === key
				|| this.visibleClaudeTerminalKey === key
				|| this.visibleClaudeTerminalKey === undefined;
			if (stillRelevant && !terminal.isDisposed) {
				this.showClaudeTerminalForKey(key, options);
			}
			if (!created || terminal.isDisposed) {
				// Adopted an existing PTY — leave it alone (restore / prior kickoff owns launch).
				return;
			}
			await terminal.processReady;
			if (terminal.isDisposed) {
				return;
			}
			await this.prepareTerminalForCommandOutput(terminal, 40, 2000);
			if (stillRelevant && this.resolveClaudeTerminalKeyForSelection() === key) {
				await terminal.focusWhenReady(true);
				this.relayoutTerminalInstances();
			}
			// Interactive Claude session — planning / Steps Next can submit turns later.
			if (!this.markClaudeCliStarted(key)) {
				this.logClaudeKickoff(`ensure Claude already started key=${key}`);
				return;
			}
			await terminal.sendText('claude', true);
			if (stillRelevant && this.resolveClaudeTerminalKeyForSelection() === key) {
				await timeout(1800);
				this.relayoutTerminalInstances();
			}
			this.logClaudeKickoff(`ensure Claude started key=${key}`);
		} catch (error: unknown) {
			this.logClaudeKickoff(`ensure Claude failed key=${key}: ${String((error as Error)?.message ?? error)}`, true);
			if (this.resolveClaudeTerminalKeyForSelection() === key && !this.findClaudeTerminalInstance(key)) {
				this.showClaudeTerminalEmpty(key);
			}
		}
	}

	private attachClaudeTerminalToHost(key: string, terminal: ITerminalInstance): void {
		this.registerClaudeTerminalInstance(key, terminal);
		this.visibleClaudeTerminalKey = key;
		this.updateClaudeTerminalKeyLabel(key);
		this.uiClaudeTerminalEmpty.classList.add('hidden');
		// Ensure the Claude pane has a usable height before measuring the host —
		// kickoff was attaching at ~89px and leaving xterm effectively invisible.
		if ((this.uiClaudeTerminalPane.clientHeight || 0) < CLAUDE_TERMINAL_DEFAULT_HEIGHT) {
			this.applyClaudeTerminalHeight(Math.max(this.claudeTerminalHeight, CLAUDE_TERMINAL_DEFAULT_HEIGHT), { persist: false });
		}
		terminal.attachToElement(this.uiClaudeTerminalHost);
		terminal.setVisible(true);
		const width = Math.max(480, this.uiClaudeTerminalHost.clientWidth || Math.floor(mainWindow.innerWidth * 0.6));
		const height = Math.max(CLAUDE_TERMINAL_MIN_HEIGHT, this.uiClaudeTerminalHost.clientHeight || this.claudeTerminalHeight || CLAUDE_TERMINAL_DEFAULT_HEIGHT);
		terminal.layout(new Dimension(width, height));
		const relayout = () => {
			if (this.visibleClaudeTerminalKey === key && this.claudeTerminalByKey.get(key) === terminal && !terminal.isDisposed) {
				this.relayoutTerminalInstances();
			}
		};
		mainWindow.requestAnimationFrame(() => {
			relayout();
			mainWindow.setTimeout(relayout, 50);
			mainWindow.setTimeout(relayout, 250);
		});
	}

	/** Dispose one surface/workspace Claude terminal; leave sibling sessions alive. */
	private async resetClaudeTerminalSession(key: string): Promise<void> {
		const existing = this.findClaudeTerminalInstance(key);
		this.claudeTerminalLifecycleByKey.get(key)?.dispose();
		this.claudeTerminalLifecycleByKey.delete(key);
		this.claudeTerminalByKey.delete(key);
		this.claudeCliStartedByKey.delete(key);
		this.claudeTerminalEnsureInFlightByKey.delete(key);
		this.claudeTerminalCreateInFlightByKey.delete(key);
		if (this.visibleClaudeTerminalKey === key) {
			this.visibleClaudeTerminalKey = undefined;
			this.uiClaudeTerminalEmpty.classList.remove('hidden');
			this.updateClaudeTerminalKeyLabel(undefined);
		}
		this.persistClaudeTerminalActiveKeys();
		if (existing && !existing.isDisposed) {
			const disposed = Event.toPromise(existing.onDisposed);
			existing.dispose(TerminalExitReason.User);
			await Promise.race([disposed, timeout(2000)]);
		}
	}

	/**
	 * Dispose fan-out Claude terminals (`surface · ws-N` / `· serialize`) on explicit
	 * Close all / surface delete. Finished workstream sessions are kept as history
	 * until the user closes them — do not call this on workstream completion.
	 */
	private async pruneClaudeWorkstreamTerminalsForSurface(
		surfaceId: string,
		keys?: readonly string[],
	): Promise<void> {
		const trimmed = surfaceId.trim();
		if (!trimmed) {
			return;
		}
		this.syncClaudeTerminalMapFromService();
		const candidates = new Set<string>([
			...(keys ?? []),
			...this.claudeTerminalByKey.keys(),
		]);
		for (const instance of this.terminalService.instances) {
			if (instance.isDisposed) {
				continue;
			}
			const key = parseClaudeTerminalKey(instance.shellLaunchConfig.name || instance.title);
			if (key) {
				candidates.add(key);
			}
		}
		const toPrune = workstreamClaudeKeysForSurface(trimmed, [...candidates]);
		if (!toPrune.length) {
			return;
		}
		this.claudeTerminalUiMutationDepth++;
		try {
			const visibleWasPruned = this.visibleClaudeTerminalKey !== undefined
				&& toPrune.includes(this.visibleClaudeTerminalKey);
			this.logClaudeKickoff(`prune ${toPrune.length} workstream Claude(s) for ${trimmed}`);
			for (const key of toPrune) {
				await this.resetClaudeTerminalSession(key);
			}
			if (visibleWasPruned || !this.visibleClaudeTerminalKey) {
				this.showClaudeTerminalForKey(trimmed, { reveal: true });
			} else {
				this.syncClaudeWorkstreamSwitcher(this.visibleClaudeTerminalKey);
			}
		} finally {
			this.claudeTerminalUiMutationDepth--;
		}
	}

	/** Dispose every Claude terminal (clear-all surfaces / hard reset). */
	private async resetAllClaudeTerminalSessions(): Promise<void> {
		const keys = [...this.claudeTerminalByKey.keys()];
		this.detachVisibleClaudeTerminal();
		for (const key of keys) {
			await this.resetClaudeTerminalSession(key);
		}
		// Also dispose any orphan Claude terminals still in the service.
		for (const instance of [...this.terminalService.instances]) {
			if (instance.isDisposed) {
				continue;
			}
			const title = instance.shellLaunchConfig.name || instance.title;
			if (!isClaudeTerminalTitle(title)) {
				continue;
			}
			const disposed = Event.toPromise(instance.onDisposed);
			instance.dispose(TerminalExitReason.User);
			await Promise.race([disposed, timeout(2000)]);
		}
		this.persistClaudeTerminalActiveKeys();
		this.showClaudeTerminalEmpty(undefined);
	}

	/**
	 * Reattach persisted Claude terminals after reload/restart, then show the
	 * terminal for the currently selected surface (or workspace plan).
	 */
	private async restoreClaudeTerminalSession(): Promise<void> {
		if (this.claudeTerminalRestoreInFlight) {
			return;
		}
		this.claudeTerminalRestoreInFlight = true;
		try {
			await this.terminalService.whenConnected;
			this.syncClaudeTerminalMapFromService();
			const preferredKey = this.resolveClaudeTerminalKeyForSelection();
			const hasAny = this.claudeTerminalByKey.size > 0;
			const markedKeys = this.getClaudeTerminalActiveKeys();
			if (hasAny) {
				this.showClaudeTerminalForKey(preferredKey);
				this.relayoutTerminalInstances();
				return;
			}
			if (!markedKeys.length) {
				this.showClaudeTerminalForKey(preferredKey);
				return;
			}
			const workspaceFolder = this.getWorkspaceFolderUri();
			if (!workspaceFolder) {
				this.persistClaudeTerminalActiveKeys([]);
				return;
			}
			const restoreKey = (preferredKey && markedKeys.includes(preferredKey) ? preferredKey : markedKeys[0]) || preferredKey;
			if (!restoreKey) {
				return;
			}
			const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, restoreKey);
			if (!created) {
				this.showClaudeTerminalForKey(restoreKey);
				this.relayoutTerminalInstances();
				return;
			}
			await terminal.processReady;
			await terminal.focusWhenReady(true);
			this.showClaudeTerminalForKey(restoreKey);
			this.relayoutTerminalInstances();
			// Process did not survive quit — continue the last Claude Code session for this cwd.
			if (this.markClaudeCliStarted(restoreKey)) {
				await terminal.sendText('claude --continue', true);
			}
		} finally {
			this.claudeTerminalRestoreInFlight = false;
		}
	}

	/**
	 * A Claude terminal for `key` died without an explicit reset. Restart and
	 * resume that key only when it is still the selected/visible session.
	 */
	private maybeAutoRestoreClaudeTerminal(key: string, exitReason: TerminalExitReason | undefined): void {
		if (exitReason === TerminalExitReason.User || exitReason === TerminalExitReason.Shutdown || exitReason === TerminalExitReason.Extension) {
			return;
		}
		const now = Date.now();
		const state = this.claudeTerminalAutoRestoreAttemptsByKey.get(key) ?? { attempts: 0, windowStart: now };
		if (now - state.windowStart > 60_000) {
			state.windowStart = now;
			state.attempts = 0;
		}
		state.attempts++;
		this.claudeTerminalAutoRestoreAttemptsByKey.set(key, state);
		if (state.attempts > 2) {
			this.logClaudeKickoff(`Claude terminal for ${key} keeps exiting — auto-restart paused`, true);
			return;
		}
		this.logClaudeKickoff(`Claude terminal for ${key} exited unexpectedly — restarting with claude --continue`, true);
		void this.autoRestoreClaudeTerminalForKey(key);
	}

	private async autoRestoreClaudeTerminalForKey(key: string): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return;
		}
		try {
			const { terminal, created } = await this.attachOrCreateClaudeTerminal(workspaceFolder, key);
			const stillRelevant = this.resolveClaudeTerminalKeyForSelection() === key
				|| this.visibleClaudeTerminalKey === key
				|| this.visibleClaudeTerminalKey === undefined;
			if (stillRelevant) {
				this.showClaudeTerminalForKey(key);
			}
			if (created) {
				await terminal.processReady;
				await terminal.focusWhenReady(true);
				this.relayoutTerminalInstances();
				if (this.markClaudeCliStarted(key)) {
					await terminal.sendText('claude --continue', true);
				}
			} else {
				this.relayoutTerminalInstances();
			}
		} catch (error: unknown) {
			this.logClaudeKickoff(`auto-restore failed for ${key}: ${String((error as Error)?.message ?? error)}`, true);
		}
	}

	private findClaudeTerminalInstance(key: string): ITerminalInstance | undefined {
		const mapped = this.claudeTerminalByKey.get(key);
		if (mapped && !mapped.isDisposed && mapped.exitReason === undefined) {
			return mapped;
		}
		const title = claudeTerminalTitleFor(key);
		const found = this.terminalService.instances.find(instance =>
			!instance.isDisposed
			&& instance.exitReason === undefined
			&& (instance.title === title || instance.shellLaunchConfig.name === title)
		);
		if (found) {
			this.registerClaudeTerminalInstance(key, found);
			return found;
		}
		// Adopt a pre-per-surface Claude terminal for this key (one-time migration).
		const legacy = this.terminalService.instances.find(instance =>
			!instance.isDisposed
			&& instance.exitReason === undefined
			&& (instance.title === LEGACY_CLAUDE_TERMINAL_TITLE || instance.shellLaunchConfig.name === LEGACY_CLAUDE_TERMINAL_TITLE)
		);
		if (legacy) {
			void legacy.rename(title);
			this.registerClaudeTerminalInstance(key, legacy);
			return legacy;
		}
		return undefined;
	}

	private async attachOrCreateClaudeTerminal(
		workspaceFolder: URI,
		key: string,
		options?: { forceNew?: boolean; reveal?: boolean },
	): Promise<{ terminal: ITerminalInstance; created: boolean }> {
		const showOptions = options?.reveal ? { reveal: true as const } : undefined;
		if (options?.forceNew) {
			await this.resetClaudeTerminalSession(key);
			this.claudeTerminalCreateInFlightByKey.delete(key);
		} else {
			const existing = this.findClaudeTerminalInstance(key);
			if (existing) {
				this.showClaudeTerminalForKey(key, showOptions);
				return { terminal: existing, created: false };
			}
			const inFlight = this.claudeTerminalCreateInFlightByKey.get(key);
			if (inFlight) {
				return inFlight;
			}
		}
		const createPromise = (async (): Promise<{ terminal: ITerminalInstance; created: boolean }> => {
			const raced = this.findClaudeTerminalInstance(key);
			if (raced && !options?.forceNew) {
				this.showClaudeTerminalForKey(key, showOptions);
				return { terminal: raced, created: false };
			}
			const anthropicEnv = await this.getClaudeTerminalAnthropicEnv();
			const terminal = await this.terminalService.createTerminal({
				cwd: workspaceFolder,
				config: {
					name: claudeTerminalTitleFor(key),
					hideFromUser: true,
					// Persist across reload/restart (background hideFromUser terminals need forcePersist).
					forcePersist: true,
					...(isWindows ? {} : { executable: '/bin/bash' }),
					...(anthropicEnv ? { env: anthropicEnv } : {}),
				},
			});
			this.registerClaudeTerminalInstance(key, terminal);
			this.showClaudeTerminalForKey(key, showOptions);
			return { terminal, created: true };
		})();
		this.claudeTerminalCreateInFlightByKey.set(key, createPromise);
		try {
			return await createPromise;
		} finally {
			if (this.claudeTerminalCreateInFlightByKey.get(key) === createPromise) {
				this.claudeTerminalCreateInFlightByKey.delete(key);
			}
		}
	}

	private async getClaudeTerminalAnthropicEnv(): Promise<Record<string, string> | undefined> {
		try {
			const key = (await this.secretStorageService.get(ANTHROPIC_API_KEY_SECRET))?.trim();
			if (!key) {
				return undefined;
			}
			return { [ANTHROPIC_API_KEY_ENV]: key };
		} catch (error: unknown) {
			this.logService.warn('[modeShell] Failed to read Anthropic API key for Claude terminal', error);
			return undefined;
		}
	}

	private getClaudeTerminalActiveKeys(): string[] {
		const raw = this.storageService.get(STORAGE_CLAUDE_TERMINAL_ACTIVE_KEYS, StorageScope.WORKSPACE);
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
				}
			} catch {
				// Fall through to legacy.
			}
		}
		if (this.storageService.getBoolean(STORAGE_CLAUDE_TERMINAL_ACTIVE_LEGACY, StorageScope.WORKSPACE, false)) {
			const legacyKey = this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID
				? this.selectedSurfaceId
				: WORKSPACE_CLAUDE_KEY;
			return [legacyKey];
		}
		return [];
	}

	private persistClaudeTerminalActiveKeys(keys?: readonly string[]): void {
		const next = keys
			? [...keys]
			: [...this.claudeTerminalByKey.entries()]
				.filter(([, terminal]) => !terminal.isDisposed)
				.map(([key]) => key);
		this.storageService.remove(STORAGE_CLAUDE_TERMINAL_ACTIVE_LEGACY, StorageScope.WORKSPACE);
		if (!next.length) {
			this.storageService.remove(STORAGE_CLAUDE_TERMINAL_ACTIVE_KEYS, StorageScope.WORKSPACE);
			return;
		}
		this.storageService.store(
			STORAGE_CLAUDE_TERMINAL_ACTIVE_KEYS,
			JSON.stringify(next),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}

	private async refreshStarterSurfaceCardStatuses(): Promise<void> {
		// Suggested starter cards are hidden. Retain references to the guided-builder helpers so
		// they stay available for import/scaffold paths and do not trip noUnusedLocals.
		void this.isSurfaceScaffolded;
		void this.draftSurfacePrompt;
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

	private syncHandoffChatPlacement(): void {
		if (this.uiActionsHost.parentElement !== this.uiChatColumn) {
			this.uiChatColumn.appendChild(this.uiActionsHost);
		}
		if (this.uiChatContainer.parentElement !== this.uiChatColumn) {
			this.uiChatColumn.appendChild(this.uiChatContainer);
		}
	}

	private focusSurfaceSetupSection(step: SurfaceSetupStep, options?: { scroll?: boolean }): void {
		this.surfaceSetupCurrentStep = step;
		const section: WorkspaceHomeView | undefined = step === 'goal'
			? 'workspacePlan'
			: step === 'brand'
				? 'branding'
				: step === 'surfaces'
					? 'surfaces'
					: undefined;
		const shouldScroll = options?.scroll !== false;
		if (section) {
			this.consoleExpanded = true;
			this.persistConsoleExpanded();
			this.activeRailCardId = `consoleSection:${section}`;
			this.setWorkspaceHomeView(section, { scroll: shouldScroll });
			return;
		}
		if (!shouldScroll) {
			return;
		}
		this.uiSurfaceSetupSections.get(step)?.scrollIntoView({ behavior: 'auto', block: 'start' });
	}

	private populateSurfaceSetupBuilderFields(): void {
		const goal = this.consoleService.getGoal();
		const brand = this.consoleService.getWorkspace()?.brand;
		this.uiSurfaceSetupGoalNameInput.value = goal?.name?.trim() || DEFAULT_WORKSPACE_PLAN_BUSINESS_NAME;
		this.uiSurfaceSetupGoalDescriptionInput.value = goal?.description ?? '';
		if (!this.uiWorkspacePlanIntentInput.value.trim()) {
			this.uiWorkspacePlanIntentInput.value = DEFAULT_WORKSPACE_PLAN_INTENT;
		}
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
		this.surfaceSetupCurrentStep = step;
		// Wizard step is tracked separately — never let hydrate steal the Console rail off Surfaces
		// (goal → Plan was overriding the default Console card on every reload).
		// Always pin the landing section to Surfaces (memory + storage). When a surface is open,
		// still clear stale Plan so ← Console / Console card lands on Surfaces.
		this.workspaceHomeView = CONSOLE_HOME_DEFAULT_SECTION;
		this.storageService.store(STORAGE_WORKSPACE_HOME_VIEW, CONSOLE_HOME_DEFAULT_SECTION, StorageScope.WORKSPACE, StorageTarget.USER);
		this.storageService.store(STORAGE_CONSOLE_SECTION, CONSOLE_HOME_DEFAULT_SECTION, StorageScope.WORKSPACE, StorageTarget.USER);
		if (!this.getOpenSurfaceId()) {
			if (this.consoleExpanded) {
				this.activeRailCardId = `consoleSection:${CONSOLE_HOME_DEFAULT_SECTION}`;
				this.setWorkspaceHomeView(CONSOLE_HOME_DEFAULT_SECTION, { scroll: false });
			} else {
				this.syncWorkspaceHomeView();
			}
		}
		await this.refreshStarterSurfaceCardStatuses();
		if (workspaceFolder) {
			this.watchWorkspaceSuggestedSurfaces(workspaceFolder);
		} else {
			this.workspaceSuggestedSurfaces = undefined;
			this.renderWorkspaceSuggestedSurfaces();
			void this.refreshWorkspacePlanGeneratedState(undefined);
		}
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
		try {
			const workspaceFolder = this.getWorkspaceFolderUri();
			if (!workspaceFolder) {
				return;
			}
			let blueprint = await readBlueprint(this.fileService, blueprintResource(workspaceFolder, surfaceId));
			if (!blueprint) {
				const created = await createBlueprintFromTemplateId(this.fileService, workspaceFolder, templateId, {
					surfaceId,
					surfaceName,
					goal: this.consoleService.getGoal(),
				});
				if (!created) {
					throw new Error(`No surface blueprint template found for ${templateId}.`);
				}
				blueprint = created.blueprint;
			}
			await registerSurfaceFromBlueprint(this.fileService, workspaceFolder, blueprint);
			await this.consoleService.refresh();
			this.syncGoalSurfaceSwitcher();
			const objective = `Create ${surfaceName} for ${workflow}.`;
			const tree = await this.ensureSurfaceTaskTree(surfaceId, objective, { surfaceId, surfaceName, templateId });
			this.selectedSurfaceTaskTree = tree;
			void this.refreshStarterSurfaceCardStatuses();
			void this.surfaceFeatureChecklistService.refresh();
			this.endSurfaceSetupHandoff();
			this.ensureWorkspaceView();
			// New surface always starts a fresh chat instance so prior drafts/history cannot leak in.
			this.clearStoredUiChatDraft(surfaceId);
			this.chatSessionManager.createNewUISurfaceSessionResource(surfaceId);
			await this.selectUiChatSurfaceAsync(surfaceId);
			this.selectGoalSurface(surfaceId);
			this.setSurfaceMainView('plan');
			this.syncUiChatInputToTaskTreeStep(tree);
			this.notificationService.info(localize('customMode.surfaceTaskTreeReady', '{0} task tree is ready. Continue the next task or run all.', surfaceName));
		} catch (e: unknown) {
			this.pushUiRuntimeLog(`[surface-setup:task-tree] failed to create task tree: ${String((e as Error)?.message ?? e)}`);
			this.notificationService.error(localize('customMode.surfaceTaskTreeCreateFailed', 'Could not create {0} task tree: {1}', surfaceName, String((e as Error)?.message ?? e)));
		}
	}

	private isCodeTabSelected(): boolean {
		return this.modeService.getMode() === 'Code';
	}

	private updateUiProjectName(): void {
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const codeOpen = this.modeService.getMode() === 'Code';
		const label = codeOpen
			? localize('customMode.backToConsole', '← Console')
			: localize('customMode.consoleTab', 'Console');
		this.uiProjectNameLabel.textContent = hasProject ? label : '';
		this.uiProjectName.setAttribute(
			'aria-label',
			codeOpen
				? localize('customMode.backToConsoleAria', 'Back to Console')
				: localize('customMode.consoleHomeAria', 'Open Console surfaces home'),
		);
		this.uiProjectName.title = codeOpen
			? localize('customMode.backToConsoleTitle', 'Back to Console')
			: localize('customMode.consoleHomeTitle', 'Open Console surfaces home');
		this.uiProjectName.classList.toggle('hidden', !hasProject || !codeOpen);
		// Code entry lives on the Console rail card; top bar only shows ← Console in Code mode.
		this.uiCodeTab.classList.add('hidden');
		this.syncContextGatheringUi();
	}

	/** Leave separate Code mode and return to Console canvas on Surfaces. */
	private goToConsoleHome(): void {
		this.ensureWorkspaceView();
		this.selectGoalSurface(ADD_SURFACE_ID);
		this.openConsoleWithSection(CONSOLE_HOME_DEFAULT_SECTION);
		this.syncContextGatheringUi();
		this.updateUiProjectName();
	}

	/** Separate Code mode — full editor; use ← Console on the top bar to return. */
	private openCodeTab(): void {
		this.modeService.setMode('Code');
		this.syncContextGatheringUi();
		this.renderGoalSurfaceButtons(this.consoleService.getSurfaces());
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
		const codeOpen = this.modeService.getMode() === 'Code';
		// Console collapses the shell strip; Code mode shows it with ← Console top-left.
		this.container.classList.toggle('custom-mode-top-collapsed', !codeOpen);
		const builderOpen = !codeOpen && this.selectedSurfaceId === ADD_SURFACE_ID && this.modeService.getMode() === 'UI';
		this.uiCodeTab.classList.toggle('active', codeOpen);
		this.uiCodeTab.setAttribute('aria-pressed', String(codeOpen));
		this.uiCodeTab.setAttribute('aria-selected', String(codeOpen));
		// In Code mode, highlight the back control so the exit path is obvious.
		this.uiProjectName.classList.toggle('active', codeOpen || builderOpen);
		this.uiProjectName.setAttribute('aria-pressed', String(codeOpen || builderOpen));
		this.uiProjectName.setAttribute('aria-selected', String(codeOpen || builderOpen));
		// Keep ← Console on the shell top bar (never the editor tabs row).
		if (this.uiProjectName.parentElement !== this.modeTopBar) {
			this.uiCodeTab.insertAdjacentElement('afterend', this.uiProjectName);
		}
		this.syncTopBarSelectionChrome();
	}

	private applySurfaceSelection(surfaceId: string, options?: { contextGathering?: boolean; deferPreviewRouting?: boolean }): void {
		if (options?.contextGathering !== undefined) {
			this.contextGatheringOpen = options.contextGathering;
			this.persistContextGatheringOpen();
			this.syncContextGatheringUi();
		}
		// Surfaces always open in Console (UI). Code is only via the top Code tab.
		this.ensureWorkspaceView();
		this.renderGoalSurfaceButtons(this.consoleService.getSurfaces());
		this.syncWorkspaceHomeView();
		// Keep Claude pane aligned with the selected surface (or workspace home).
		// Preserve the active workstream tab when re-selecting the same surface.
		const preferWorkstream = surfaceId !== ADD_SURFACE_ID
			&& Boolean(this.visibleClaudeTerminalKey)
			&& isClaudeKeyForSurface(this.visibleClaudeTerminalKey!, surfaceId);
		this.showClaudeTerminalForKey(
			surfaceId === ADD_SURFACE_ID
				? WORKSPACE_CLAUDE_KEY
				: (preferWorkstream ? this.visibleClaudeTerminalKey : surfaceId),
		);
		if (surfaceId !== ADD_SURFACE_ID) {
			const storedView = this.getStoredSurfaceMainView(surfaceId);
			if (storedView) {
				this.surfaceMainView = storedView;
			}
		}
		this.refreshSelectedSurfaceTaskTreeAndRoute(!options?.deferPreviewRouting);
		this.refreshStartCommandHints();
		this.setActiveUiChatSurfaceFromSurfaceTab(surfaceId);
		if (surfaceId !== ADD_SURFACE_ID) {
			this.syncSurfaceSetupDashboardVisibility();
		}
		this.syncContextGatheringUi();
		this.updateUiProjectName();
	}

	private refreshSelectedSurfaceTaskTreeAndRoute(routePreview = true): void {
		const selectedSurfaceId = this.selectedSurfaceId;
		void this.loadSelectedSurfaceTaskTree().then(async () => {
			if (this.selectedSurfaceId !== selectedSurfaceId) {
				return;
			}
			if (this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID && !this.getStoredSurfaceMainView(this.selectedSurfaceId)) {
				await this.resolveAndApplyDefaultSurfaceMainView(this.selectedSurfaceId, this.selectedSurfaceTaskTree);
			}
			if (routePreview) {
				this.routeSelectedSurfacePreview();
			} else {
				this.syncSurfaceMainView();
			}
		});
	}

	private syncGoalSurfaceSwitcher(): void {
		const state = this.consoleService.getState();
		const surfaces = this.consoleService.getSurfaces();
		const goalWorkspaceLoaded = state.status === 'loaded';
		const hasManifestSurfaces = goalWorkspaceLoaded && surfaces.length > 0;
		// Surfaces live as cards in the shared left rail — the top tab row stays hidden.
		this.uiSurfaceSwitcher.classList.add('hidden');

		if (!goalWorkspaceLoaded) {
			this.selectedSurfaceId = undefined;
			this.container.classList.remove('custom-mode-ui-surface-selected');
			this.uiSurfaceButtons.clear();
			this.uiSurfaceSwitcher.replaceChildren();
			this.setGoalWorkspaceManifestStateMessage(state.status, state.diagnostics);
			this.syncWorkspaceHomeView();

			const activeUrl = this.devServerService.getActiveUrl();
			if (!this.uiBrowserShell.classList.contains('custom-mode-ui-surface-missing-url') && activeUrl && !this.embeddedUiShowsUrl(activeUrl)) {
				this.setEmbeddedUiUrl(activeUrl);
			}
			this.showClaudeTerminalForKey(undefined);
			return;
		}

		if (!hasManifestSurfaces) {
			this.selectedSurfaceId = ADD_SURFACE_ID;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
			this.uiSurfaceButtons.clear();
			this.uiSurfaceSwitcher.replaceChildren();
			this.refreshSelectedSurfaceTaskTreeAndRoute();
			this.refreshStartCommandHints();
			this.refreshUiChatTabsAndSession();
			this.showClaudeTerminalForKey(WORKSPACE_CLAUDE_KEY);
			return;
		}

		const previousSelectedId = this.selectedSurfaceId;
		const storedSurfaceId = this.storageService.get(STORAGE_SELECTED_GOAL_SURFACE, StorageScope.WORKSPACE);
		const selectedSurface = this.resolveSelectedSurface(surfaces, storedSurfaceId);
		this.selectedSurfaceId = storedSurfaceId === ADD_SURFACE_ID
			? ADD_SURFACE_ID
			: selectedSurface?.id ?? surfaces[0]?.id ?? ADD_SURFACE_ID;
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, this.selectedSurfaceId, StorageScope.WORKSPACE, StorageTarget.USER);
		const selectionChanged = previousSelectedId !== this.selectedSurfaceId;

		this.renderGoalSurfaceButtons(surfaces);
		// Only blank the preview when freeing ports at first startup (or when sync
		// actually changes the selected surface). Routine syncs were aborting healthy
		// localhost loads via about:blank → ERR_ABORTED → black preview.
		if (!this.surfacePortsFreedAtStartup) {
			this.clearEmbeddedUiUrl();
			this.setAppReachable(false);
			void this.freeWorkspaceSurfacePortsAtStartup(surfaces).then(() => {
				// Ports were killed — do not navigate Preview until a probe succeeds;
				// kick autostart so the selected surface comes back.
				this.refreshSelectedSurfaceTaskTreeAndRoute();
				this.maybeAutoStartSelectedSurfacePreview();
			});
		} else if (selectionChanged) {
			this.setAppReachable(false);
			this.lastSurfacePreviewRouteKey = undefined;
			this.refreshSelectedSurfaceTaskTreeAndRoute();
		}
		this.refreshStartCommandHints();
		this.refreshUiChatTabsAndSession();
		this.syncTopBarSelectionChrome();
		this.syncWorkspaceHomeView();
		// Surface id is restored here — after the early Claude restore ran without it.
		this.showClaudeTerminalForKey(this.resolveClaudeTerminalKeyForSelection());
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
		await freeSurfacePorts(ports, this.instantiationService);
		// Whatever was listening is gone — require a fresh start before Preview navigates.
		this.startedSurfaceServers.clear();
		this.setAppReachable(false);
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
		await Promise.all([...ports].map(port => killProcessListeningOnPort(port, this.instantiationService)));
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
		const codeViewActive = this.isCodeTabSelected();

		for (const surface of surfaces) {
			let button = this.uiSurfaceButtons.get(surface.id);
			if (!button) {
				button = $('button.custom-mode-ui-surface-button', {
					type: 'button',
					role: 'tab'
				}) as HTMLButtonElement;
				this._register(addDisposableListener(button, 'click', () => this.selectGoalSurface(surface.id)));
			}

			const isActive = surface.id === this.selectedSurfaceId && !codeViewActive;
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
		if (surfaceId === ADD_SURFACE_ID) {
			this.surfaceRailCards = [];
			this.surfaceRailCardsLoading = false;
			this.selectedSurfaceId = ADD_SURFACE_ID;
			this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
			this.applySurfaceSelection(surfaceId, { contextGathering: true });
			this.showClaudeTerminalForKey(WORKSPACE_CLAUDE_KEY);
			return;
		}

		const surface = this.consoleService.getSurface(surfaceId);
		if (!surface) {
			return;
		}

		// Surface tabs always open Console (UI). Code is only via the top Code tab.
		const surfaceChanged = this.selectedSurfaceId !== surface.id;
		this.selectedSurfaceId = surface.id;
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, surface.id, StorageScope.WORKSPACE, StorageTarget.USER);
		// Show static section cards immediately on switch — do not wait for plan/Ix load.
		// Same-surface reselect must not wipe hydrated badges back to "—".
		this.applyImmediateSurfaceRailCards(surface, {
			focusDefaultSection: surfaceChanged,
			forcePlaceholders: surfaceChanged,
		});
		// On surface switch, mark unreachable and re-route — do NOT hop through about:blank
		// (Electron aborts the in-flight load and the preview flashes black).
		if (surfaceChanged) {
			this.setAppReachable(false);
			this.lastSurfacePreviewRouteKey = undefined;
		}
		this.applySurfaceSelection(surfaceId, { contextGathering: false, deferPreviewRouting: true });
		// applySurfaceSelection already aligns Claude (preserves workstream tabs on same surface).
		// Preview-wired surfaces auto-start when the Preview section is open.
		this.maybeAutoStartSelectedSurfacePreview();
	}

	/**
	 * Paint Proposed Graph / Real Graph / Preview / Plan / Rules cards before async load finishes.
	 * Do not clobber already-hydrated badges (plan.md / CLAUDE.md / graph counts) with static "—" —
	 * re-open / refresh churn + load() coalesce was leaving those placeholders stuck.
	 */
	private applyImmediateSurfaceRailCards(
		surface: WorkspaceSurface,
		options?: { focusDefaultSection?: boolean; forcePlaceholders?: boolean },
	): void {
		const next = this.toSurfaceRailSectionCards(staticSurfaceProposalTreeCards({
			localUrl: surface.localUrl,
			productionUrl: surface.productionUrl,
			databaseUrl: surface.databaseUrl,
			purposeValue: surface.purpose,
			schema: surface.schema,
		}));
		this.surfaceRailCardsLoading = false;
		const replace = options?.forcePlaceholders === true
			|| this.surfaceRailCards.length === 0
			|| surfaceRailCardsLookLikePlaceholders(this.surfaceRailCards);
		if (replace && !cardRailItemsEqual(this.surfaceRailCards, next)) {
			this.surfaceRailCards = next;
		}
		this.surfaceRailCardsById.set(surface.id, this.surfaceRailCards);
		this.syncWorkspaceHomeView();
		if (options?.focusDefaultSection) {
			this.selectDefaultSurfaceSectionOrOwner(surface.id);
		}
	}

	/** Pin Preview (when complete) or the Plan Steps current-step section to the front of the rail. */
	private toSurfaceRailSectionCards(
		cards: readonly SurfaceProposalTreeCardItem[],
		surfaceOverride?: WorkspaceSurface,
	): CardRailItem[] {
		const available = cards.map(card => card.id);
		const preferred = this.resolvePreferredSurfaceRailSectionId(available);
		const surface = surfaceOverride ?? this.getSelectedSurface();
		const mapped: CardRailItem[] = orderSurfaceProposalTreeCards(cards, preferred).map(card => {
			const href = card.id === 'preview'
				? surface?.localUrl?.trim() || undefined
				: card.id === 'deployed'
					? surface?.productionUrl?.trim() || undefined
					: card.id === 'database'
						? surface?.databaseUrl?.trim() || undefined
						: undefined;
			const value = (card.id === 'preview' || card.id === 'deployed' || card.id === 'database')
				? resolveSurfaceUrlRailCardValue({ value: card.value, href })
				: card.value;
			return {
				id: `surfaceSection:${card.id}`,
				key: card.key,
				value,
				href,
				title: href
					? localize(
						'customMode.surfaceRailSectionUrlTitle',
						'Show {0} — click URL to open {1}',
						card.key,
						href,
					)
					: localize('customMode.surfaceRailSectionTitle', 'Show {0}', card.key),
			};
		});
		if (!surface) {
			return mapped;
		}
		const customCards: CardRailItem[] = SurfaceExtensibilityRegistry.getViews(this.toSurfaceExtensibilityContext(surface)).map(view => ({
			id: `surfaceSection:${view.id}`,
			key: view.title,
			value: view.railValue ?? SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
			title: localize('customMode.surfaceRailSectionTitle', 'Show {0}', view.title),
		}));
		if (!customCards.length) {
			return mapped;
		}
		// Registry views append after the built-in sections; resync round-trips existing card
		// ids through this mapper, so drop any stale copies before re-appending.
		const customIds = new Set(customCards.map(card => card.id));
		return mapped.filter(card => !customIds.has(card.id)).concat(customCards);
	}

	private resolvePreferredSurfaceRailSectionId(available: readonly string[]): string | undefined {
		const surfaceId = this.getOpenSurfaceId();
		const progress = surfaceId ? this.surfaceProgressById.get(surfaceId) : undefined;
		const preferredComplete = resolvePreferredCompleteSurfaceSectionId({
			progress,
			availableSectionIds: available,
			deployedWired: isSurfaceDeployedWired(surfaceId ? this.consoleService.getSurface(surfaceId) : undefined),
		});
		if (preferredComplete) {
			return preferredComplete;
		}
		const current = this.surfacePlanPanel?.getCurrentWorkflowStep();
		return current ? resolveSurfaceSectionIdForStep(current, available) : undefined;
	}

	/** Re-pin when the current Plan step or completion progress changes without a full card republish. */
	private resyncSurfaceRailCardOrderForCurrentStep(options?: { readonly promotePreviewIfComplete?: boolean }): void {
		const openSurfaceId = this.getOpenSurfaceId();
		if (!openSurfaceId || !this.surfaceRailCards.length) {
			return;
		}
		const asTreeCards: SurfaceProposalTreeCardItem[] = this.surfaceRailCards.map(card => ({
			id: card.id.startsWith('surfaceSection:') ? card.id.slice('surfaceSection:'.length) : card.id,
			key: card.key,
			value: card.value,
		}));
		const next = this.toSurfaceRailSectionCards(asTreeCards);
		if (!cardRailItemsEqual(this.surfaceRailCards, next)) {
			this.surfaceRailCards = next;
		}
		this.surfaceRailCardsById.set(openSurfaceId, this.surfaceRailCards);
		const availableSectionIds = next
			.map(card => card.id.startsWith('surfaceSection:') ? card.id.slice('surfaceSection:'.length) : '')
			.filter((id): id is string => Boolean(id));
		const progress = this.surfaceProgressById.get(openSurfaceId);
		const isComplete = shouldPreferPreviewSurfaceSection(progress);
		const wasComplete = this.surfaceWasCompleteById.get(openSurfaceId);
		this.surfaceWasCompleteById.set(openSurfaceId, isComplete);
		// One-shot only when complete flips false→true — not on every progress refresh / reopen.
		const preferredComplete = options?.promotePreviewIfComplete
			&& shouldPromoteCompleteSurfaceSectionOnTransition(wasComplete, isComplete)
			? resolvePreferredCompleteSurfaceSectionId({
				progress,
				availableSectionIds,
				deployedWired: isSurfaceDeployedWired(this.consoleService.getSurface(openSurfaceId)),
			})
			: undefined;
		if (preferredComplete && next.some(card => card.id === `surfaceSection:${preferredComplete}`)) {
			const activeSectionId = this.activeRailCardId?.startsWith('surfaceSection:')
				? this.activeRailCardId.slice('surfaceSection:'.length)
				: undefined;
			if (activeSectionId !== preferredComplete) {
				this.selectSurfaceSectionCard(openSurfaceId, preferredComplete);
				return;
			}
		}
		this.syncWorkspaceHomeView();
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
			this.clearStoredUiChatDraft(surfaceId);
			if (this.boundUiChatSurfaceId === surfaceId) {
				this.boundUiChatSurfaceId = undefined;
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
			await this.pruneClaudeWorkstreamTerminalsForSurface(surfaceId);
			await this.resetClaudeTerminalSession(surfaceId);
			const showKey = this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID
				? this.selectedSurfaceId
				: WORKSPACE_CLAUDE_KEY;
			this.showClaudeTerminalForKey(showKey);
			await this.consoleService.refresh();
			this.syncGoalSurfaceSwitcher();
			void this.refreshStarterSurfaceCardStatuses();
			this.syncTopBarSelectionChrome();
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

	/** Preview tab + reachable app — only then is drag-to-select useful. */
	private isAppPreviewInView(): boolean {
		return this.modeService.getMode() === 'UI'
			&& !this.contextGatheringOpen
			&& !!this.getSelectedSurface()
			&& this.surfaceMainView === 'preview'
			&& this.appReachable;
	}

	private syncTopBarSelectionChrome(): void {
		const previewSelect = this.isAppPreviewInView();
		this.container.classList.toggle('custom-mode-shell-preview-select', previewSelect);
		// Keep enabled so orphan apps/ folders can still be wiped after the manifest is empty.
		this.uiClearAllSurfacesBtn.disabled = false;
	}

	private async clearAllSurfaces(): Promise<'ok' | 'partial' | 'cancelled' | 'noop'> {
		const surfaces = [...this.consoleService.getSurfaces()];
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.warn(localize(
				'customMode.clearAllSurfacesNoWorkspace',
				'Open a workspace folder before clearing surfaces.',
			));
			return 'noop';
		}
		const appsDir = joinPath(workspaceFolder, 'apps');
		let appsChildCount = 0;
		try {
			const appsStat = await this.fileService.resolve(appsDir);
			appsChildCount = appsStat.children?.length ?? 0;
		} catch {
			appsChildCount = 0;
		}
		if (!surfaces.length && appsChildCount === 0) {
			this.notificationService.info(localize(
				'customMode.clearAllSurfacesNothing',
				'Nothing to clear — no surfaces or apps/ folders.',
			));
			return 'noop';
		}
		const { confirmed } = await this.dialogService.confirm({
			message: localize(
				'customMode.clearAllSurfacesConfirm',
				'Clear all {0} surface(s) and wipe the entire apps/ directory? This deletes plans, proposals, the workspace plan, suggested surfaces, task trees, reference clones, and every generated app folder.',
				surfaces.length,
			),
			primaryButton: localize('customMode.clearAllSurfacesConfirmButton', 'Clear all Surfaces'),
			type: 'warning',
		});
		if (!confirmed) {
			return 'cancelled';
		}

		const failed: string[] = [];
		for (const surface of surfaces) {
			try {
				const deleted = await deleteGoalWorkspaceSurface(this.fileService, workspaceFolder, surface.id);
				if (!deleted) {
					failed.push(surface.name);
					continue;
				}
				this.clearStoredUiChatDraft(surface.id);
				this.chatSessionManager.removeUISurfaceSession(surface.id);
			} catch {
				failed.push(surface.name);
			}
		}

		// Always wipe apps/ so orphan folders (not in the manifest) are removed too.
		let appsWipeFailed = false;
		try {
			await this.fileService.del(appsDir, { recursive: true, useTrash: false });
		} catch {
			// Directory may already be gone after per-surface deletes.
		}
		try {
			await this.fileService.createFolder(appsDir);
		} catch {
			appsWipeFailed = true;
		}
		try {
			const leftover = await this.fileService.resolve(appsDir);
			if ((leftover.children?.length ?? 0) > 0) {
				appsWipeFailed = true;
			}
		} catch {
			appsWipeFailed = true;
		}

		// Planning residue goes too — stale suggestion cards and plans would otherwise
		// resurrect surfaces after a clear. Attachments (user-provided briefs) are kept.
		const planningArtifacts = [
			workspacePlanResource(workspaceFolder),
			workspaceSuggestedSurfacesResource(workspaceFolder),
			joinPath(workspaceFolder, '.agent', 'surfaces'),
			joinPath(workspaceFolder, '.agent', 'task-trees'),
			joinPath(workspaceFolder, '.agent', 'references'),
		];
		for (const resource of planningArtifacts) {
			try {
				await this.fileService.del(resource, { recursive: true, useTrash: false });
			} catch {
				// Already gone is fine.
			}
		}
		// Restore the hardcoded default Workspace Plan so Console stays past kickoff.
		try {
			await this.fileService.createFolder(joinPath(workspaceFolder, '.agent'));
			await this.fileService.writeFile(
				workspacePlanResource(workspaceFolder),
				VSBuffer.fromString(DEFAULT_WORKSPACE_PLAN_MARKDOWN),
			);
			await this.fileService.writeFile(
				workspaceSuggestedSurfacesResource(workspaceFolder),
				VSBuffer.fromString(DEFAULT_WORKSPACE_SUGGESTED_SURFACES_JSON),
			);
		} catch {
			// Non-fatal — user can still Start workspace planning.
		}
		this.workspaceSuggestedSurfaces = undefined;
		await this.refreshWorkspaceSuggestedSurfaces(workspaceFolder);
		this.renderWorkspaceSuggestedSurfaces();

		this.boundUiChatSurfaceId = undefined;
		this.selectedSurfaceId = ADD_SURFACE_ID;
		this.activeUiChatSurfaceId = ADD_SURFACE_ID;
		this.storageService.store(STORAGE_SELECTED_GOAL_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
		this.storageService.store(STORAGE_ACTIVE_UI_CHAT_SURFACE, ADD_SURFACE_ID, StorageScope.WORKSPACE, StorageTarget.USER);
		this.clearEmbeddedUiUrl();
		this.setAppReachable(false);
		await this.resetAllClaudeTerminalSessions();
		await this.consoleService.refresh();
		this.applySurfaceSelection(ADD_SURFACE_ID, { contextGathering: true });
		this.syncGoalSurfaceSwitcher();
		void this.refreshStarterSurfaceCardStatuses();
		this.syncTopBarSelectionChrome();

		if (failed.length || appsWipeFailed) {
			this.notificationService.warn(localize(
				'customMode.clearAllSurfacesPartial',
				'Cleared surfaces, but failed for: {0}{1}',
				failed.length ? failed.join(', ') : 'none',
				appsWipeFailed ? '; apps/ directory was not fully wiped' : '',
			));
			return 'partial';
		}
		this.notificationService.info(localize(
			'customMode.clearAllSurfacesSuccess',
			'Cleared {0} surface(s), planning artifacts, and wiped apps/.',
			surfaces.length,
		));
		return 'ok';
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
			const live = resolveLiveSurfaceEmbeddedUrl({
				sectionId: this.activeSurfaceRailSectionId(),
				localUrl: selectedSurface.localUrl,
				productionUrl: selectedSurface.productionUrl,
				databaseUrl: selectedSurface.databaseUrl,
			});
			if (live) {
				return live;
			}
			// Non-live rail card: keep the warm webview URL (do not snap back to localUrl).
			const current = this.getEmbeddedUiUrl()?.trim();
			if (current && current !== 'about:blank' && !current.startsWith('chrome-error://')) {
				return current;
			}
			return selectedSurface.localUrl;
		}
		return this.devServerService.getActiveUrl();
	}

	/** Last route signature — avoid re-entrant preview routing that thrash-logs and leaks listeners. */
	private lastSurfacePreviewRouteKey: string | undefined;

	/** True when the Preview section card owns the content pane. */
	private isPreviewSectionSelected(): boolean {
		return this.activeRailCardId === 'surfaceSection:preview';
	}

	/** True when the Deployed (Vercel) section card owns the content pane. */
	private isDeployedSectionSelected(): boolean {
		return this.activeRailCardId === 'surfaceSection:deployed';
	}

	/** Preview, Deployed, or Database — routes a URL into the embedded Console pane. */
	private isLiveUrlSectionSelected(): boolean {
		return isLiveSurfaceRailSection(this.activeSurfaceRailSectionId());
	}

	private activeSurfaceRailSectionId(): string | undefined {
		return this.activeRailCardId?.startsWith('surfaceSection:')
			? this.activeRailCardId.slice('surfaceSection:'.length)
			: undefined;
	}

	private routeSelectedSurfacePreview(): void {
		if (this.modeService.getMode() === 'Code') {
			return;
		}
		// Include the focused section card so Preview ↔ Graph/Plan re-routes (clears waiting chrome).
		const routeKey = `${this.contextGatheringOpen ? '1' : '0'}:${this.selectedSurfaceId ?? ''}:${this.surfaceMainView}:${this.activeRailCardId ?? ''}`;
		if (this.lastSurfacePreviewRouteKey === routeKey) {
			return;
		}
		this.lastSurfacePreviewRouteKey = routeKey;
		this.updateSurfaceFeatureChecklistVisibility();

		if (this.contextGatheringOpen) {
			this.container.classList.add('custom-mode-ui-surface-selected');
			if (this.selectedSurfaceId === ADD_SURFACE_ID) {
				this.setAddSurfaceState();
				this.clearEmbeddedUiUrl();
				this.pushUiRuntimeLog('[surface] selected add surface');
			} else {
				this.setGoalOverviewState();
				this.clearEmbeddedUiUrl();
				this.pushUiRuntimeLog('[surface] context gathering open');
			}
		} else if (this.selectedSurfaceId === ADD_SURFACE_ID) {
			this.contextGatheringOpen = true;
			this.persistContextGatheringOpen();
			this.syncContextGatheringUi();
			this.container.classList.add('custom-mode-ui-surface-selected');
			this.setAddSurfaceState();
			this.clearEmbeddedUiUrl();
			this.pushUiRuntimeLog('[surface] selected add surface');
		} else {
			const surface = this.getSelectedSurface();
			this.container.classList.toggle('custom-mode-ui-surface-selected', Boolean(surface));
			if (!surface) {
				this.setSurfaceEmptyState(undefined);
			} else {
				const sectionId = this.activeSurfaceRailSectionId();
				const liveSelected = isLiveSurfaceRailSection(sectionId);
				const url = resolveLiveSurfaceEmbeddedUrl({
					sectionId,
					localUrl: surface.localUrl,
					productionUrl: surface.productionUrl,
					databaseUrl: surface.databaseUrl,
				});
				// Non-live rail cards (Proposed / Plan / Graph / …): keep the webview warm.
				// Only Preview / Deployed / Database assign src — flipping docs must not reload Next.
				if (!liveSelected) {
					this.setSurfaceEmptyState(undefined);
					this.logSelectedSurfaceRoute(surface, this.getEmbeddedUiUrl() || undefined);
				} else if (!url) {
					this.setSurfaceMissingUrlState(surface);
					this.clearEmbeddedUiUrl();
					this.logSelectedSurfaceRoute(surface, undefined);
				} else if (sectionId === 'preview' && !this.appReachable) {
					// Local Preview owns waiting chrome until the dev server is up.
					// Probe via HTTP only — do not assign webview src while unreachable
					// (port-free → ERR_CONNECTION_REFUSED chrome-error page).
					this.setSurfaceServerDownState(surface, url);
					const current = this.getEmbeddedUiUrl()?.trim();
					if (current?.startsWith('chrome-error://')
						|| (current && current !== 'about:blank' && this.urlsShareOrigin(current, url))) {
						this.clearEmbeddedUiUrl();
					}
					void this.checkUrlReachable(url);
					this.maybeAutoStartSelectedSurfacePreview();
					this.logSelectedSurfaceRoute(surface, url);
				} else {
					this.setSurfaceEmptyState(undefined);
					if (shouldAssignEmbeddedUrlForRailSection({
						sectionId,
						targetUrl: url,
						currentUrl: this.getEmbeddedUiUrl(),
						urlsShareOrigin: (a, b) => this.urlsShareOrigin(a, b),
						previewReachable: sectionId === 'preview' ? this.appReachable : undefined,
					})) {
						this.setEmbeddedUiUrl(url);
					}
					void this.checkUrlReachable(url);
					this.logSelectedSurfaceRoute(surface, url);
				}
			}
		}

		this.syncSurfaceMainView();
	}

	private surfaceMainViewStorageKey(surfaceId: string): string {
		return `${STORAGE_SURFACE_MAIN_VIEW_PREFIX}${surfaceId}`;
	}

	private getStoredSurfaceMainView(surfaceId: string): SurfaceMainView | undefined {
		const stored = this.storageService.get(this.surfaceMainViewStorageKey(surfaceId), StorageScope.WORKSPACE);
		return normalizeSurfaceMainView(stored);
	}

	private async surfaceHasPlan(surfaceId: string): Promise<boolean> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return false;
		}
		const surface = this.consoleService.getSurface(surfaceId);
		const resource = await resolveSurfacePlanResource(this.fileService, workspaceFolder, surfaceId, surface?.path);
		return Boolean(resource);
	}

	private async resolveAndApplyDefaultSurfaceMainView(surfaceId: string, tree?: AgentTaskTree): Promise<void> {
		const hasPlan = await this.surfaceHasPlan(surfaceId);
		this.surfaceMainView = resolveDefaultSurfaceMainView(
			tree ?? this.selectedSurfaceTaskTree,
			this.isSelectedSurfacePreviewReachable(),
			hasPlan,
		);
		this.syncSurfaceMainView();
		this.syncUiChatInputToTaskTreeStep(tree ?? this.selectedSurfaceTaskTree);
	}

	private persistSurfaceMainView(surfaceId: string, view: SurfaceMainView): void {
		const stored = view === 'taskTree' ? 'plan' : view;
		this.storageService.store(this.surfaceMainViewStorageKey(surfaceId), stored, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private async ensureSurfaceTaskTree(
		surfaceId: string,
		prompt: string,
		metadata: { surfaceId: string; surfaceName: string; templateId: string },
	): Promise<AgentTaskTree> {
		const existing = await this.agentTaskTreeService.loadLatestTaskTreeForSurface(surfaceId);
		if (existing) {
			this.selectedSurfaceTaskTree = existing;
			return existing;
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		const blueprint = workspaceFolder
			? await readBlueprint(this.fileService, blueprintResource(workspaceFolder, surfaceId))
			: undefined;
		const tree = await this.agentTaskTreeService.generateSurfaceCoreBuildPlanTree(prompt, metadata, { blueprint });
		this.selectedSurfaceTaskTree = tree;
		return tree;
	}

	private async loadSelectedSurfaceTaskTree(): Promise<void> {
		if (!this.selectedSurfaceId || this.selectedSurfaceId === ADD_SURFACE_ID) {
			this.selectedSurfaceTaskTree = undefined;
			this.syncUiChatInputToTaskTreeStep(undefined);
			return;
		}
		const tree = await this.agentTaskTreeService.loadLatestTaskTreeForSurface(this.selectedSurfaceId);
		this.selectedSurfaceTaskTree = tree;
		this.syncUiChatInputToTaskTreeStep(tree);
	}

	private isSelectedSurfacePreviewReachable(): boolean {
		const surface = this.getSelectedSurface();
		if (!surface?.localUrl) {
			return false;
		}
		return this.appReachable && this.embeddedUiShowsUrl(surface.localUrl);
	}

	/** Production URL is treated as live once loaded into the embedded pane (no local server gate). */
	private isSelectedSurfaceDeployedReachable(): boolean {
		const surface = this.getSelectedSurface();
		const url = surface?.productionUrl?.trim();
		if (!url) {
			return false;
		}
		return this.appReachable && this.embeddedUiShowsUrl(url);
	}

	private setSurfaceMainView(view: SurfaceMainView): void {
		this.ensureWorkspaceView();
		const next = view === 'taskTree' ? 'plan' : view;
		this.surfaceMainView = next === 'preview' ? 'preview' : 'plan';
		if (this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID) {
			this.persistSurfaceMainView(this.selectedSurfaceId, this.surfaceMainView);
		}
		if (this.surfaceMainView === 'preview') {
			this.activeRailCardId = 'surfaceSection:preview';
		} else if (this.activeRailCardId === 'surfaceSection:preview') {
			const openSurfaceId = this.getOpenSurfaceId();
			this.activeRailCardId = openSurfaceId ? `surface:${openSurfaceId}` : this.activeRailCardId;
		}
		this.syncSurfaceMainView();
		this.syncContextGatheringUi();
		this.updateUiProjectName();
	}

	private syncSurfaceMainView(): void {
		this.syncSurfaceSetupDashboardVisibility();
		if (this.surfaceMainView === 'taskTree' || this.surfaceMainView === 'claudeMd' || this.surfaceMainView === 'ixSubsystems') {
			this.surfaceMainView = 'plan';
		}
		const showToggle = shouldShowSurfaceMainViewToggle({
			selectedSurfaceId: this.selectedSurfaceId,
			addSurfaceId: ADD_SURFACE_ID,
			contextGatheringOpen: this.contextGatheringOpen,
		});
		// Unified Plan column owns Rules / Graph / Preview sections — never show the left rail.
		this.uiSurfaceMainViewToggle.classList.add('hidden');
		this.uiBrowserShell.classList.remove('custom-mode-ui-surface-view-cards');
		const showLivePane = showToggle && this.isLiveUrlSectionSelected();
		for (const [view, button] of this.uiSurfaceTaskTreeToggleButtons) {
			const active = showLivePane ? view === 'preview' : view === 'plan';
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', String(active));
		}

		// Waiting Start-preview chrome fills the card-rail content host; only the live webview
		// takes over as a sibling column beside the cards (preview-visible).
		const activeCustomView = showToggle && !showLivePane ? this.resolveActiveCustomSurfaceView() : undefined;
		const showPlan = showToggle && !showLivePane && !activeCustomView;
		const deployedSelected = this.isDeployedSectionSelected();
		const previewLive = showLivePane && (
			deployedSelected
				? this.isSelectedSurfaceDeployedReachable()
				: this.isSelectedSurfacePreviewReachable()
		);
		this.uiBrowserShell.classList.toggle('custom-mode-ui-surface-preview-visible', previewLive);
		this.uiBrowserShell.classList.toggle('custom-mode-ui-surface-main-view-overlay', previewLive);
		this.uiBrowserShell.classList.toggle('custom-mode-ui-surface-preview-waiting', showLivePane && !previewLive);
		// Never let stale Preview waiting empty-state own the pane when a non-Preview section is focused.
		if ((showPlan || activeCustomView) && !this.uiSurfaceEmptyState.classList.contains('hidden')) {
			this.uiSurfaceEmptyState.classList.add('hidden');
			this.uiBrowserShell.classList.remove('custom-mode-ui-surface-missing-url');
		}
		this.uiSurfacePlanPanelRoot.classList.toggle('hidden', !showPlan);
		this.uiSurfacePlanPanelRoot.hidden = !showPlan;
		this.uiSurfaceClaudeMdPanelRoot.classList.add('hidden');
		this.uiSurfaceClaudeMdPanelRoot.hidden = true;
		this.syncCustomSurfaceViewSlot(activeCustomView);
		this.uiSurfaceIxSubsystemsPanelRoot.classList.add('hidden');
		// Always hydrate Plan/Graph/Rules card values when a surface is open — even if Preview
		// owns the main pane (100% surfaces default there). Gating load on showPlan left the
		// rail stuck on static "—" placeholders from applyImmediateSurfaceRailCards.
		if (showToggle && this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID) {
			const surface = this.getSelectedSurface();
			void this.surfacePlanPanel?.load({
				surfaceId: this.selectedSurfaceId,
				surfaceName: surface?.name,
				surfacePath: surface?.path,
				treeId: this.selectedSurfaceTaskTree?.id,
				localUrl: surface?.localUrl,
				surface,
				workspaceFolder: this.getWorkspaceFolderUri(),
				parallelClaudeWorkstreamsEnabled: this.isParallelClaudeWorkstreamsEnabled(),
			});
		}
		this.syncStepsPanel();
		this.syncWorkspaceHomeView();
		this.renderSelectedSurfaceLaunchPanel();
		this.syncTopBarSelectionChrome();
	}

	/** First-party Actions-panel entries, registered on the same seam third-party actions use. */
	private registerBuiltinSurfaceActions(): void {
		this._register(SurfaceExtensibilityRegistry.registerAction({
			id: 'regenerate-real-graph',
			label: localize('customMode.surfaceActions.regenerateRealGraph', 'Regenerate Real Graph'),
			tooltip: localize('customMode.surfaceActions.regenerateRealGraphTitle', 'Re-run Ix map and rebuild Real Graph from on-disk files for the selected surface'),
			run: () => this.regenerateRealGraphFromActions(),
		}));
		this._register(SurfaceExtensibilityRegistry.registerAction({
			id: 'prune-graph-registry',
			label: localize('customMode.surfaceActions.pruneGraphRegistry', 'Prune Graph Registry'),
			tooltip: localize('customMode.surfaceActions.pruneGraphRegistryTitle', 'Remove dead /tmp, dogfood, and file registrations from ~/.ix/config.yaml (ix workspace address book)'),
			run: () => this.pruneIxWorkspaceRegistry(),
		}));
		this._register(SurfaceExtensibilityRegistry.registerAction({
			id: 'publish-to-github',
			label: localize('customMode.surfaceActions.publishToGitHub', 'Publish to GitHub'),
			tooltip: localize('customMode.surfaceActions.publishToGitHubTitle', 'Create a GitHub repository and push this workspace (uses gh CLI when the built-in GitHub extension is disabled)'),
			run: () => this.publishWorkspaceToGitHub(),
		}));
		this._register(SurfaceExtensibilityRegistry.registerAction({
			id: 'show-github',
			label: localize('customMode.surfaceActions.showGitHub', 'Show GitHub'),
			tooltip: localize('customMode.surfaceActions.showGitHubTitle', 'Open the GitHub repository for this workspace in the browser'),
			run: () => this.showPublishedGitHub(),
		}));
		this._register(SurfaceExtensibilityRegistry.registerAction({
			id: 'publish-to-vercel',
			label: localize('customMode.surfaceActions.publishToVercel', 'Publish to Vercel'),
			tooltip: localize('customMode.surfaceActions.publishToVercelTitle', 'Deploy the selected surface (or workspace) to Vercel'),
			run: () => this.publishWorkspaceToVercel(),
		}));
		this._register(SurfaceExtensibilityRegistry.registerAction({
			id: 'show-vercel',
			label: localize('customMode.surfaceActions.showVercel', 'Show Vercel'),
			tooltip: localize('customMode.surfaceActions.showVercelTitle', 'Open the Vercel deployment for the selected surface (or workspace) in the browser'),
			run: () => this.showPublishedVercel(),
		}));
	}

	private getSurfaceExtensibilityContext(): ISurfaceContext | undefined {
		if (!this.selectedSurfaceId || this.selectedSurfaceId === ADD_SURFACE_ID) {
			return undefined;
		}
		const surface = this.getSelectedSurface();
		return surface
			? this.toSurfaceExtensibilityContext(surface)
			: { surfaceId: this.selectedSurfaceId, workspaceFolder: this.getWorkspaceFolderUri() };
	}

	private toSurfaceExtensibilityContext(surface: WorkspaceSurface): ISurfaceContext {
		return {
			surfaceId: surface.id,
			surfaceName: surface.name,
			surfacePath: surface.path,
			localUrl: surface.localUrl,
			taskTreeId: surface.id === this.selectedSurfaceId ? this.selectedSurfaceTaskTree?.id : undefined,
			workspaceFolder: this.getWorkspaceFolderUri(),
		};
	}

	/** The registered view owning the main pane — active rail section id matches a registry view. */
	private resolveActiveCustomSurfaceView(): ISurfaceViewDescriptor | undefined {
		if (!this.activeRailCardId?.startsWith('surfaceSection:')) {
			return undefined;
		}
		const context = this.getSurfaceExtensibilityContext();
		if (!context) {
			return undefined;
		}
		const sectionId = this.activeRailCardId.slice('surfaceSection:'.length);
		return SurfaceExtensibilityRegistry.getViews(context).find(view => view.id === sectionId);
	}

	/** Show the active registered view's slot (creating it lazily) and hide the rest. */
	private syncCustomSurfaceViewSlot(view: ISurfaceViewDescriptor | undefined): void {
		const context = view ? this.getSurfaceExtensibilityContext() : undefined;
		const activeId = view && context ? view.id : undefined;
		for (const [id, slot] of this.surfaceCustomViewSlots) {
			slot.root.classList.toggle('hidden', id !== activeId);
			slot.root.hidden = id !== activeId;
		}
		if (!view || !context) {
			this.uiSurfaceCustomViewsRoot.classList.add('hidden');
			this.uiSurfaceCustomViewsRoot.hidden = true;
			return;
		}
		let slot = this.surfaceCustomViewSlots.get(view.id);
		if (!slot) {
			const root = $('div.custom-mode-ui-surface-custom-view');
			this.uiSurfaceCustomViewsRoot.appendChild(root);
			const renderer = view.createRenderer(root);
			slot = { root, renderer, dispose: () => { renderer.dispose(); root.remove(); } };
			this.surfaceCustomViewSlots.set(view.id, slot);
		}
		slot.root.classList.remove('hidden');
		slot.root.hidden = false;
		this.uiSurfaceCustomViewsRoot.classList.remove('hidden');
		this.uiSurfaceCustomViewsRoot.hidden = false;
		void slot.renderer.load(context);
	}

	private onDidChangeSurfaceExtensibilityRegistrations(): void {
		const registered = new Set(SurfaceExtensibilityRegistry.getViews().map(view => view.id));
		for (const id of [...this.surfaceCustomViewSlots.keys()]) {
			if (!registered.has(id)) {
				this.surfaceCustomViewSlots.deleteAndDispose(id);
			}
		}
		const openSurfaceId = this.getOpenSurfaceId();
		if (openSurfaceId && this.surfaceRailCards.length) {
			this.resyncSurfaceRailCardOrderForCurrentStep();
			const activeSectionId = this.activeRailCardId?.startsWith('surfaceSection:')
				? this.activeRailCardId.slice('surfaceSection:'.length)
				: undefined;
			// The active section card may have been deregistered out from under us.
			if (activeSectionId && !this.surfaceRailCards.some(card => card.id === `surfaceSection:${activeSectionId}`)) {
				this.selectDefaultSurfaceSectionOrOwner(openSurfaceId);
				return;
			}
		}
		this.syncSurfaceMainView();
	}

	private updateSurfaceFeatureChecklistVisibility(): void {
		this.uiFeatureChecklistColumn.classList.toggle('hidden', this.isSurfaceFeatureChecklistHidden());
	}

	private isSurfaceFeatureChecklistHidden(): boolean {
		return this.storageService.getBoolean(STORAGE_SURFACE_FEATURE_CHECKLIST_HIDDEN, StorageScope.WORKSPACE, true);
	}

	private setSurfaceFeatureChecklistHidden(hidden: boolean): void {
		this.storageService.store(STORAGE_SURFACE_FEATURE_CHECKLIST_HIDDEN, hidden, StorageScope.WORKSPACE, StorageTarget.USER);
		this.uiFeatureChecklistColumn.classList.toggle('hidden', hidden);
	}

	/** Workspace Settings — default off (sequential one Claude per surface). */
	private isParallelClaudeWorkstreamsEnabled(): boolean {
		return this.storageService.get(STORAGE_PARALLEL_CLAUDE_WORKSTREAMS, StorageScope.WORKSPACE) === '1';
	}

	private setParallelClaudeWorkstreamsEnabled(enabled: boolean): void {
		this.storageService.store(
			STORAGE_PARALLEL_CLAUDE_WORKSTREAMS,
			enabled ? '1' : '0',
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
		if (this.uiParallelClaudeWorkstreamsToggle) {
			this.uiParallelClaudeWorkstreamsToggle.checked = enabled;
		}
		this.surfacePlanPanel?.setParallelClaudeWorkstreamsEnabled(enabled);
	}

	private getAgentOrchestratorProvider(): AgentOrchestratorProviderId | undefined {
		return parseAgentOrchestratorProvider(
			this.storageService.get(STORAGE_AGENT_ORCHESTRATOR_PROVIDER, StorageScope.WORKSPACE),
		);
	}

	private setAgentOrchestratorProvider(provider: AgentOrchestratorProviderId): void {
		this.storageService.store(
			STORAGE_AGENT_ORCHESTRATOR_PROVIDER,
			provider,
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
		this.syncAgentOrchestratorProviderPicker();
		this.syncOrchestratorCredentialRows();
		this.syncWorkspacePlanSubmitButton();
		if (provider === 'openaiCompatible') {
			void this.ensureOpenAiCompatibleApiKeyOnSelect();
		}
	}

	private syncAgentOrchestratorProviderPicker(): void {
		const selected = this.getAgentOrchestratorProvider();
		const inputs = this.uiSettingsAgentOrchestratorProviderInputs;
		if (!inputs?.size) {
			return;
		}
		for (const [id, input] of inputs) {
			input.checked = id === selected;
		}
	}

	/** Show OpenAI-compatible key row in Settings only when that orchestrator is selected. */
	private syncOrchestratorCredentialRows(): void {
		const showOpenAi = this.getAgentOrchestratorProvider() === 'openaiCompatible';
		const row = this.uiSettingsOpenAiKeyRow;
		if (!row) {
			return;
		}
		row.classList.toggle('hidden', !showOpenAi);
		row.hidden = !showOpenAi;
	}

	private createDockerPanel(): HTMLDetailsElement {
		this.uiDockerStatusHeadline = $('span.custom-mode-ui-docker-status-headline', undefined, localize(
			'customMode.docker.statusChecking',
			'Checking Docker…',
		));
		this.uiDockerStatusDetail = $('p.custom-mode-ui-how-it-works-p', undefined, localize(
			'customMode.docker.statusCheckingDetail',
			'Probing Docker Desktop and MCP Toolkit…',
		));
		const statusDot = $('span.custom-mode-ui-docker-status-dot', {
			'aria-hidden': 'true',
			'data-status': DockerAvailabilityStatus.Unknown,
		});
		this.uiDockerRefreshButton = $('button.custom-mode-callout-button', {
			type: 'button',
		}, localize('customMode.docker.refresh', 'Refresh status')) as HTMLButtonElement;
		this.uiDockerGetDesktopButton = $('button.custom-mode-callout-button', {
			type: 'button',
		}, localize('customMode.dockerDesktopDownload', 'Get Docker Desktop')) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiDockerRefreshButton, 'click', () => {
			void this.dockerAvailabilityService.refresh().then(() => {
				this.updateDockerWorkspacePanel();
				this.updateProcessDockerBanner();
				this.syncWorkspaceHomeView();
			});
		}));
		this._register(addDisposableListener(this.uiDockerGetDesktopButton, 'click', () => {
			void this.openerService.open(URI.parse(DOCKER_DESKTOP_URL));
		}));
		const panel = this.createConsoleHomeSectionPanel(
			'docker',
			localize('customMode.workspaceDockerSectionTitle', 'Docker'),
			[
				$('div.custom-mode-ui-docker-status-body', undefined,
					$('div.custom-mode-ui-how-it-works-section', undefined,
						$('div.custom-mode-ui-how-it-works-section-title', undefined, localize(
							'customMode.docker.healthTitle',
							'Docker Desktop health',
						)),
						$('div.custom-mode-ui-docker-status-badge', undefined, statusDot, this.uiDockerStatusHeadline),
						this.uiDockerStatusDetail,
						$('div.custom-mode-ui-docker-status-actions', undefined,
							this.uiDockerRefreshButton,
							this.uiDockerGetDesktopButton,
						),
					),
					$('div.custom-mode-ui-how-it-works-section', undefined,
						$('div.custom-mode-ui-how-it-works-section-title', undefined, localize(
							'customMode.docker.whyTitle',
							'Why Docker is required',
						)),
						$('p.custom-mode-ui-how-it-works-p', undefined, localize(
							'customMode.docker.whyDetail',
							'Docker Desktop powers the Ix map backend and Docker MCP Toolkit used on the Process tab. Keep Docker running while you plan and build surfaces.',
						)),
					),
				),
			],
			{ extraClassName: 'custom-mode-ui-docker-status-panel' },
		);
		this.uiWorkspaceDockerPanel = panel;
		this.updateDockerWorkspacePanel();
		return panel;
	}

	private createWorkspaceDescriptionPanel(): HTMLDetailsElement {
		this.uiWorkspaceDescriptionRegenButton = $('button.custom-mode-ui-console-description-regen', {
			type: 'button',
			title: localize('customMode.workspaceDescriptionRegenTitle', 'Regenerate goal.description via Actions Claude'),
		}, localize('customMode.workspaceDescriptionRegen', 'Regen Description')) as HTMLButtonElement;
		this._register(addDisposableListener(this.uiWorkspaceDescriptionRegenButton, 'click', () => {
			void this.regenerateWorkspaceDescriptionFromActions();
		}));
		this.uiWorkspaceDescriptionBody = $('div.custom-mode-ui-console-description-body');
		return this.createConsoleHomeSectionPanel(
			'description',
			localize('customMode.workspaceDescriptionSectionTitle', 'Description'),
			[
				$('div.custom-mode-ui-workspace-surfaces', undefined,
					$('div.custom-mode-ui-workspace-surfaces-header', undefined,
						$('div.custom-mode-ui-workspace-surfaces-title', undefined, localize('customMode.workspaceDescriptionSectionSubtitle', 'Workspace product narrative')),
					),
					this.uiWorkspaceDescriptionBody,
				),
			],
			{
				extraClassName: 'custom-mode-ui-workspace-description-panel',
				headerActions: $('div.custom-mode-ui-surface-starters-header-actions', undefined,
					this.uiWorkspaceDescriptionRegenButton,
				),
			},
		);
	}

	private renderWorkspaceDescriptionPanel(): void {
		if (!this.uiWorkspaceDescriptionBody) {
			return;
		}
		const description = this.consoleService.getGoal()?.description?.trim() ?? '';
		clearNode(this.uiWorkspaceDescriptionBody);
		if (description) {
			this.uiWorkspaceDescriptionBody.append(
				$('p.custom-mode-ui-console-description-label', undefined, localize('customMode.workspaceDescriptionPurposeLabel', 'Purpose')),
				$('p.custom-mode-ui-console-description-text', undefined, description),
			);
		} else {
			this.uiWorkspaceDescriptionBody.append(
				$('p.custom-mode-ui-console-description-empty', undefined, localize(
					'customMode.workspaceDescriptionEmpty',
					'No workspace description yet. Use Regen Description, or set goal.description in workspace.goal.json.',
				)),
			);
		}
	}

	private updateDockerWorkspacePanel(): void {
		if (!this.uiDockerStatusHeadline || !this.uiDockerStatusDetail || !this.uiDockerGetDesktopButton) {
			return;
		}
		const status = isWeb
			? DockerAvailabilityStatus.Available
			: this.dockerAvailabilityService.getStatus();
		const statusDot = this.uiWorkspaceDockerPanel?.querySelector('.custom-mode-ui-docker-status-dot');
		if (statusDot instanceof HTMLElement) {
			statusDot.dataset.status = status;
		}
		switch (status) {
			case DockerAvailabilityStatus.Available:
				this.uiDockerStatusHeadline.textContent = localize('customMode.docker.statusAvailable', 'Docker is ready');
				this.uiDockerStatusDetail.textContent = localize(
					'customMode.docker.statusAvailableDetail',
					'Docker Desktop is running and MCP Toolkit is available.',
				);
				this.uiDockerGetDesktopButton.classList.add('hidden');
				break;
			case DockerAvailabilityStatus.Missing:
				this.uiDockerStatusHeadline.textContent = localize('customMode.docker.statusMissing', 'Docker Desktop not detected');
				this.uiDockerStatusDetail.textContent = localize(
					'customMode.docker.statusMissingDetail',
					'Install Docker Desktop, start it, and keep it running for Ix and Docker MCP.',
				);
				this.uiDockerGetDesktopButton.classList.remove('hidden');
				break;
			case DockerAvailabilityStatus.McpToolkitMissing:
				this.uiDockerStatusHeadline.textContent = localize('customMode.docker.statusMcpMissing', 'MCP Toolkit not enabled');
				this.uiDockerStatusDetail.textContent = localize(
					'customMode.docker.statusMcpMissingDetail',
					'Docker is installed, but MCP Toolkit is not enabled. Open Docker Desktop → Settings → Beta features → enable Docker MCP Toolkit, then refresh.',
				);
				this.uiDockerGetDesktopButton.classList.add('hidden');
				break;
			case DockerAvailabilityStatus.Unknown:
			default:
				this.uiDockerStatusHeadline.textContent = localize('customMode.docker.statusChecking', 'Checking Docker…');
				this.uiDockerStatusDetail.textContent = localize(
					'customMode.docker.statusCheckingDetail',
					'Probing Docker Desktop and MCP Toolkit…',
				);
				this.uiDockerGetDesktopButton.classList.add('hidden');
				break;
		}
	}

	private createHowItWorksPanel(): HTMLDetailsElement {
		const section = (title: string, ...children: HTMLElement[]) =>
			$('div.custom-mode-ui-how-it-works-section', undefined,
				$('div.custom-mode-ui-how-it-works-section-title', undefined, title),
				...children,
			);
		const para = (text: string) => $('p.custom-mode-ui-how-it-works-p', undefined, text);
		const bullet = (text: string) => $('li.custom-mode-ui-how-it-works-li', undefined, text);

		return this.createConsoleHomeSectionPanel(
			'howItWorks',
			localize('customMode.howItWorksSectionTitle', 'Dev Loop'),
			[
				$('div.custom-mode-ui-how-it-works-body', undefined,
					section(
						localize('customMode.howItWorks.overviewTitle', 'Claude Code in this workspace'),
						para(localize(
							'customMode.howItWorks.overview',
							'Console drives Claude Code in a terminal. Standing rules live in CLAUDE.md; each Plan or Steps action sends an explicit prompt; Claude’s own CLI loop runs the tools. Skipping the Custom AI narrate/DISPATCH turn does not skip this path — it only skips an optional chat pre-turn before Claude.',
						)),
					),
					section(
						localize('customMode.howItWorks.usesTitle', 'What Claude uses'),
						$('ul.custom-mode-ui-how-it-works-list', undefined,
							bullet(localize(
								'customMode.howItWorks.usesClaudeMd',
								'CLAUDE.md — workspace agent agreement (seeded for you; standing process, artifacts, and phase-progress contract).',
							)),
							bullet(localize(
								'customMode.howItWorks.usesPrompt',
								'A Console-built prompt for each step — usually starts with “Read CLAUDE.md and follow it” (workspace planning kickoff, surface plan kickoff, or Plan Next phase prompts).',
							)),
							bullet(localize(
								'customMode.howItWorks.usesHandshake',
								'Handshake files — especially .agent/surfaces/<id>.phase-progress.json (running → completed / failed).',
							)),
						),
					),
					section(
						localize('customMode.howItWorks.loopTitle', 'Where the agent loop runs'),
						$('ul.custom-mode-ui-how-it-works-list', undefined,
							bullet(localize(
								'customMode.howItWorks.loopNotCustomAi',
								'Not in Custom AI chat tool rounds.',
							)),
							bullet(localize(
								'customMode.howItWorks.loopClaudePty',
								'In Claude Code in the terminal: Console attaches or creates the session, runs claude --continue when needed, then submits the prompt.',
							)),
							bullet(localize(
								'customMode.howItWorks.loopConsole',
								'Console’s loop is thinner: Next / kickoff → send prompt → watch phase-progress.json / artifacts → advance Steps.',
							)),
						),
					),
					section(
						localize('customMode.howItWorks.ixMapTitle', 'What the Ix map really indexes'),
						para(localize(
							'customMode.howItWorks.ixMapOverview',
							'The Arango graph is not “files + a few import edges.” Almost every indexed code entity is its own node. A full-repo map can be hundreds of thousands of nodes and over a million edges; a surface Real Graph that shows a couple dozen files is a file-level projection of that denser map.',
						)),
						para(localize(
							'customMode.howItWorks.ixMapKindsIntro',
							'Typical node kinds (counts vary by workspace size):',
						)),
						$('ul.custom-mode-ui-how-it-works-list', undefined,
							bullet(localize(
								'customMode.howItWorks.ixMapKindConfigEntry',
								'config_entry — individual config / settings keys (often the largest bucket).',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindModule',
								'module — modules / namespaces.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindMethod',
								'method — class / object methods.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindFunction',
								'function — top-level functions.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindFile',
								'file — source files (what Real Graph / Proposed usually draw).',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindInterface',
								'interface — interfaces / type declarations.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindClass',
								'class — classes.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapKindDocs',
								'section / heading — documentation structure (plus smaller kinds: macros, traits, views, …).',
							)),
						),
						para(localize(
							'customMode.howItWorks.ixMapEdgesIntro',
							'Edges connect those entities. Common predicates:',
						)),
						$('ul.custom-mode-ui-how-it-works-list', undefined,
							bullet(localize(
								'customMode.howItWorks.ixMapEdgeCalls',
								'CALLS — function / method call relationships.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapEdgeContainsDefines',
								'CONTAINS / DEFINES — file or module ownership of nested symbols.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapEdgeReferences',
								'REFERENCES — type / symbol references.',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapEdgeImports',
								'IMPORTS — module / file imports (often what a file-level UI highlights).',
							)),
							bullet(localize(
								'customMode.howItWorks.ixMapEdgeExtends',
								'EXTENDS — inheritance / interface implementation.',
							)),
						),
						para(localize(
							'customMode.howItWorks.ixMapProjection',
							'So when Console shows a small surface graph, you are usually seeing files and a few relationships — not the full symbol/config graph underneath. A “2000+ node” surface map is the same idea at smaller scope: still mostly symbols and config, not just the files drawn on screen.',
						)),
						para(localize(
							'customMode.howItWorks.ixMapMentalModelIntro',
							'Mental model:',
						)),
						$('pre.custom-mode-ui-how-it-works-pre', undefined,
							[
								'file ──DEFINES/CONTAINS──► class / function / interface / module / …',
								'                              │',
								'                              ├── CALLS ──► other functions/methods',
								'                              ├── REFERENCES ──► types/symbols',
								'                              └── EXTENDS ──► base types',
							].join('\n'),
						),
					),
				),
			],
			{ extraClassName: 'custom-mode-ui-how-it-works-panel' },
		);
	}

	/**
	 * Console home section as a Surface-style exclusive `<details>` accordion panel.
	 * Rail selection (and summary clicks) drive which section is open.
	 */
	private createConsoleHomeSectionPanel(
		sectionId: ConsoleHomeSection,
		title: string,
		bodyChildren: HTMLElement[],
		options?: {
			readonly extraClassName?: string;
			readonly elementId?: string;
			readonly headerActions?: HTMLElement;
			readonly titleEl?: HTMLElement;
		},
	): HTMLDetailsElement {
		const titleEl = options?.titleEl ?? $('div.custom-mode-ui-surface-surfaces-title', undefined, title);
		const summaryChildren: HTMLElement[] = [titleEl];
		if (options?.headerActions) {
			summaryChildren.push(options.headerActions);
			for (const button of options.headerActions.querySelectorAll('button')) {
				this.suppressDetailsSummaryToggle(button);
			}
		}
		const summary = $('summary.custom-mode-ui-surface-starters-header', undefined, ...summaryChildren);
		const body = $('div.custom-mode-ui-surface-starters-body', undefined, ...bodyChildren);
		const classNames = ['custom-mode-ui-workspace-home-panel', options?.extraClassName].filter(Boolean).join('.');
		const details = $(`details.${classNames}`, {
			...(options?.elementId ? { id: options.elementId } : {}),
			'data-console-section': sectionId,
		}, summary, body) as HTMLDetailsElement;
		this.bindConsoleHomeSectionPanel(details, sectionId);
		return details;
	}

	private suppressDetailsSummaryToggle(el: HTMLElement): void {
		this._register(addDisposableListener(el, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
	}

	private bindConsoleHomeSectionPanel(panel: HTMLDetailsElement, sectionId: ConsoleHomeSection): void {
		const summary = panel.querySelector(':scope > summary');
		if (summary instanceof HTMLElement) {
			// Summary click owns section selection. Do not sync from the generic `toggle`
			// event — Chromium opens <details> when focus lands on an input inside Plan,
			// which was stealing the Console rail off Surfaces on every reload.
			this._register(addDisposableListener(summary, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				if (!this.consoleExpanded) {
					this.consoleExpanded = true;
					this.persistConsoleExpanded();
				}
				this.activeRailCardId = `consoleSection:${sectionId}`;
				this.deselectSurfaceForHomeRail();
				this.setWorkspaceHomeView(sectionId, { scroll: false });
				this.uiWorkspaceHomeCardRail?.setActiveId(`consoleSection:${sectionId}`, ['console']);
			}));
		}
		this._register(addDisposableListener(panel, 'toggle', () => {
			if (this.consoleHomeAccordionApplying) {
				return;
			}
			// Focus / autofill can open a closed section without a summary click — snap back.
			if (panel.open && this.workspaceHomeView !== sectionId) {
				this.applyConsoleHomeSectionAccordion(this.workspaceHomeView);
			}
		}));
	}

	/** Mirror Surface `focusSection`: only the focused Console home section stays open. */
	private applyConsoleHomeSectionAccordion(focused: WorkspaceHomeView): void {
		const openStates = exclusiveConsoleHomeOpenStates(focused);
		const panels: Array<{ sectionId: ConsoleHomeSection; el: HTMLDetailsElement | undefined }> = [
			{ sectionId: 'workspacePlan', el: this.uiWorkspacePlanHomePanel as HTMLDetailsElement | undefined },
			{ sectionId: 'surfaces', el: this.uiSurfaceSetupSurfacesBody as HTMLDetailsElement | undefined },
			{ sectionId: 'description', el: this.uiWorkspaceDescriptionPanel as HTMLDetailsElement | undefined },
			{ sectionId: 'docker', el: this.uiWorkspaceDockerPanel as HTMLDetailsElement | undefined },
			{ sectionId: 'claudeMd', el: this.uiWorkspaceClaudeMdPanelRoot as HTMLDetailsElement | undefined },
			{ sectionId: 'howItWorks', el: this.uiWorkspaceHowItWorksPanel as HTMLDetailsElement | undefined },
			{ sectionId: 'branding', el: this.uiWorkspacePlanBrandFields as HTMLDetailsElement | undefined },
			{ sectionId: 'settings', el: this.uiWorkspaceSettingsPanel as HTMLDetailsElement | undefined },
		];
		this.consoleHomeAccordionApplying = true;
		try {
			for (const { sectionId, el } of panels) {
				if (!el) {
					continue;
				}
				const wantOpen = openStates.get(sectionId) === true;
				if (el.open !== wantOpen) {
					el.open = wantOpen;
				}
			}
		} finally {
			this.consoleHomeAccordionApplying = false;
		}
	}

	private createOpenAiCompatibleKeyRow(): { readonly root: HTMLElement; readonly statusEl: HTMLElement } {
		const statusEl = $('span.custom-mode-ui-anthropic-key-status', undefined, localize(
			'customMode.openAiKey.statusUnknown',
			'Checking…',
		));
		const button = $('button.custom-mode-ui-anthropic-key-btn', {
			type: 'button',
		}, localize('customMode.openAiKey.setButton', 'Set OpenAI API key')) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => void this.promptAndStoreOpenAiCompatibleApiKey({ allowEmpty: true })));
		const root = $('div.custom-mode-ui-anthropic-key-row.custom-mode-ui-openai-key-row.hidden', {
			hidden: 'true',
		},
			$('div.custom-mode-ui-anthropic-key-copy', undefined,
				$('div.custom-mode-ui-anthropic-key-label', undefined, localize(
					'customMode.openAiKey.label',
					'OpenAI-compatible API key',
				)),
				$('div.custom-mode-ui-anthropic-key-hint', undefined, localize(
					'customMode.openAiKey.hint',
					'Required for OpenAI-compatible / LiteLLM orchestration. Stored only on this device. Uses custom.ai.openaiCompatible.baseUrl.',
				)),
				statusEl,
			),
			button,
		);
		return { root, statusEl };
	}

	private createAnthropicKeyRow(): { readonly root: HTMLElement; readonly statusEl: HTMLElement } {
		const statusEl = $('span.custom-mode-ui-anthropic-key-status', undefined, localize(
			'customMode.anthropicKey.statusUnknown',
			'Checking…',
		));
		const button = $('button.custom-mode-ui-anthropic-key-btn', {
			type: 'button',
		}, localize('customMode.anthropicKey.setButton', 'Set Anthropic API key')) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => void this.promptAndStoreAnthropicApiKey()));
		const root = $('div.custom-mode-ui-anthropic-key-row', undefined,
			$('div.custom-mode-ui-anthropic-key-copy', undefined,
				$('div.custom-mode-ui-anthropic-key-label', undefined, localize(
					'customMode.anthropicKey.label',
					'Anthropic API key',
				)),
				$('div.custom-mode-ui-anthropic-key-hint', undefined, localize(
					'customMode.anthropicKey.hint',
					'Optional. Injected as ANTHROPIC_API_KEY into new Claude Code terminals. Required if Claude is not already logged in.',
				)),
				statusEl,
			),
			button,
		);
		return { root, statusEl };
	}

	private async syncOpenAiCompatibleKeyStatus(): Promise<void> {
		let hasKey = false;
		try {
			hasKey = Boolean((await this.secretStorageService.get(CUSTOM_AI_SECRET_OPENAI_API_KEY))?.trim());
		} catch {
			hasKey = false;
		}
		const text = hasKey
			? localize('customMode.openAiKey.statusSet', 'Key stored on this device')
			: localize('customMode.openAiKey.statusMissing', 'No key stored yet');
		if (this.uiSettingsOpenAiKeyStatusEl) {
			this.uiSettingsOpenAiKeyStatusEl.textContent = text;
			this.uiSettingsOpenAiKeyStatusEl.classList.toggle('is-set', hasKey);
		}
		const btn = this.uiSettingsOpenAiKeyRow?.querySelector('button.custom-mode-ui-anthropic-key-btn');
		if (btn instanceof HTMLButtonElement) {
			btn.textContent = hasKey
				? localize('customMode.openAiKey.changeButton', 'Change OpenAI API key')
				: localize('customMode.openAiKey.setButton', 'Set OpenAI API key');
		}
	}

	/** After selecting OpenAI-compatible, prompt when no key is stored yet. */
	private async ensureOpenAiCompatibleApiKeyOnSelect(): Promise<void> {
		await this.syncOpenAiCompatibleKeyStatus();
		let hasKey = false;
		try {
			hasKey = Boolean((await this.secretStorageService.get(CUSTOM_AI_SECRET_OPENAI_API_KEY))?.trim());
		} catch {
			hasKey = false;
		}
		if (hasKey) {
			return;
		}
		await this.promptAndStoreOpenAiCompatibleApiKey({ allowEmpty: false });
	}

	async promptAndStoreOpenAiCompatibleApiKey(options?: { readonly allowEmpty?: boolean }): Promise<void> {
		const openAiBase = (this.configurationService.getValue<string>('custom.ai.openaiCompatible.baseUrl') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
		const input = await promptForCustomAiApiKey(
			this.quickInputService,
			this.openerService,
			CancellationToken.None,
			{
				baseUrl: openAiBase,
				allowEmpty: options?.allowEmpty ?? true,
			},
		);
		if (input === undefined) {
			return;
		}
		try {
			const trimmed = input.trim();
			if (!trimmed) {
				await this.secretStorageService.delete(CUSTOM_AI_SECRET_OPENAI_API_KEY);
				this.notificationService.info(localize(
					'customMode.openAiKey.cleared',
					'OpenAI-compatible API key cleared.',
				));
			} else {
				await this.secretStorageService.set(CUSTOM_AI_SECRET_OPENAI_API_KEY, trimmed);
				this.notificationService.info(localize(
					'customMode.openAiKey.stored',
					'OpenAI-compatible API key stored on this device.',
				));
			}
			await this.syncOpenAiCompatibleKeyStatus();
		} catch (error: unknown) {
			this.logService.error('[modeShell] Failed to store OpenAI-compatible API key', error);
			this.notificationService.warn(localize(
				'customMode.openAiKey.storeFailed',
				'Could not store OpenAI-compatible API key: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	private async syncAnthropicKeyStatus(): Promise<void> {
		let hasKey = false;
		try {
			hasKey = Boolean((await this.secretStorageService.get(ANTHROPIC_API_KEY_SECRET))?.trim());
		} catch {
			hasKey = false;
		}
		const text = hasKey
			? localize('customMode.anthropicKey.statusSet', 'Key stored on this device')
			: localize('customMode.anthropicKey.statusMissing', 'No key stored yet');
		if (this.uiSettingsAnthropicKeyStatusEl) {
			this.uiSettingsAnthropicKeyStatusEl.textContent = text;
			this.uiSettingsAnthropicKeyStatusEl.classList.toggle('is-set', hasKey);
		}
	}

	async promptAndStoreAnthropicApiKey(): Promise<void> {
		const input = await promptForAnthropicApiKey(
			this.quickInputService,
			this.openerService,
			CancellationToken.None,
			{ allowEmpty: true },
		);
		if (input === undefined) {
			return;
		}
		try {
			const trimmed = input.trim();
			if (!trimmed) {
				await this.secretStorageService.delete(ANTHROPIC_API_KEY_SECRET);
				this.notificationService.info(localize(
					'customMode.anthropicKey.cleared',
					'Anthropic API key cleared. New Claude terminals will not inject ANTHROPIC_API_KEY.',
				));
			} else {
				await this.secretStorageService.set(ANTHROPIC_API_KEY_SECRET, trimmed);
				this.notificationService.info(localize(
					'customMode.anthropicKey.stored',
					'Anthropic API key stored. New Claude Code terminals will receive ANTHROPIC_API_KEY.',
				));
			}
			await this.syncAnthropicKeyStatus();
		} catch (error: unknown) {
			this.logService.error('[modeShell] Failed to store Anthropic API key', error);
			this.notificationService.warn(localize(
				'customMode.anthropicKey.storeFailed',
				'Could not store Anthropic API key: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	/** Settings-only picker — Workspace plan no longer gates on orchestrator choice. */
	private createAgentOrchestratorProviderPicker(): {
		readonly root: HTMLElement;
		readonly inputs: Map<AgentOrchestratorProviderId, HTMLInputElement>;
	} {
		const name = 'custom-mode-agent-orchestrator-settings';
		const inputs = new Map<AgentOrchestratorProviderId, HTMLInputElement>();
		const options: Array<{
			readonly id: AgentOrchestratorProviderId;
			readonly label: string;
			readonly hint: string;
		}> = [
			{
				id: 'claude',
				label: localize('customMode.agentOrchestrator.claude', 'Claude'),
				hint: localize('customMode.agentOrchestrator.claudeHint', 'Coding path — skip Custom AI narrate turn'),
			},
			{
				id: 'openaiCompatible',
				label: localize('customMode.agentOrchestrator.openai', 'OpenAI-compatible / LiteLLM'),
				hint: localize('customMode.agentOrchestrator.openaiHint', 'Custom AI via configured base URL + API key'),
			},
			{
				id: 'ollama',
				label: localize('customMode.agentOrchestrator.ollama', 'Ollama'),
				hint: localize('customMode.agentOrchestrator.ollamaHint', 'Local Custom AI (Ollama)'),
			},
		];
		const optionEls = options.map(option => {
			const input = $('input', {
				type: 'radio',
				name,
				value: option.id,
				'aria-label': option.label,
			}) as HTMLInputElement;
			inputs.set(option.id, input);
			this._register(addDisposableListener(input, 'change', () => {
				if (input.checked) {
					this.setAgentOrchestratorProvider(option.id);
				}
			}));
			return $('label.custom-mode-ui-agent-orchestrator-option', undefined,
				input,
				$('span.custom-mode-ui-agent-orchestrator-option-copy', undefined,
					$('span.custom-mode-ui-agent-orchestrator-option-label', undefined, option.label),
					$('span.custom-mode-ui-agent-orchestrator-option-hint', undefined, option.hint),
				),
			);
		});
		const root = $('div.custom-mode-ui-agent-orchestrator', {
			role: 'radiogroup',
			'aria-label': localize('customMode.agentOrchestratorAria', 'Agent orchestrator LLM'),
		},
			$('div.custom-mode-ui-agent-orchestrator-hint', undefined, localize(
				'customMode.agentOrchestratorSettingsHint',
				'Choose which LLM narrates Plan Steps before Claude coding. Claude skips the Custom AI narrate turn.',
			)),
			$('div.custom-mode-ui-agent-orchestrator-options', undefined, ...optionEls),
		);
		return { root, inputs };
	}

	private renderSelectedSurfaceLaunchPanel(): void {
		this.surfaceLaunchActionDisposables.clear();
		this.uiSurfaceLaunchPanel.replaceChildren();

		const surface = this.getSelectedSurface();
		const previewSelected = !this.contextGatheringOpen && this.isPreviewSectionSelected();
		if (!surface || !previewSelected || this.isSelectedSurfacePreviewReachable()) {
			this.uiSurfaceLaunchPanel.classList.add('hidden');
			this.uiSurfaceLaunchPanel.hidden = true;
			return;
		}

		const command = surface.devCommand?.trim();
		const workspaceFolder = this.getWorkspaceFolderUri();
		const url = surface.localUrl?.trim();
		const starting = Boolean(command && workspaceFolder && this.startingSurfaceServers.has(surface.id));
		const displayedCommand = command
			? this.alignSurfaceCommandToPreferredPort(command, surface.localUrl)
			: undefined;

		this.uiSurfaceLaunchPanel.classList.remove('hidden');
		this.uiSurfaceLaunchPanel.hidden = false;

		const toolbar = $('div.custom-mode-ui-surface-launch-toolbar', undefined,
			$('div.custom-mode-ui-surface-launch-dots', undefined, $('span'), $('span'), $('span')),
			$('div.custom-mode-ui-surface-launch-url', {
				title: url || localize('customMode.surfaceLaunchUrlMissing', 'No preview URL yet'),
			}, url || localize('customMode.surfaceLaunchUrlMissing', 'No preview URL yet')),
		);
		const body = $('div.custom-mode-ui-surface-launch-body');
		body.appendChild($('p.custom-mode-ui-surface-launch-kicker', undefined,
			localize('customMode.surfaceLaunchKicker', 'Live preview')));
		body.appendChild($('h2.custom-mode-ui-surface-launch-title', undefined, surface.name));
		if (!command) {
			body.appendChild($('p.custom-mode-ui-surface-launch-copy', undefined,
				localize('customMode.surfaceLaunchMissingCommand', 'No start command for {0}. Add devCommand in workspace.goal.json.', surface.name)));
		} else if (!url) {
			body.appendChild($('p.custom-mode-ui-surface-launch-copy', undefined,
				localize('customMode.surfaceLaunchMissingUrlDetail', 'Add localUrl for this surface in workspace.goal.json, then start the preview.')));
			body.appendChild($('code.custom-mode-ui-surface-launch-command', { title: displayedCommand }, displayedCommand!));
		} else if (starting) {
			body.appendChild($('p.custom-mode-ui-surface-launch-copy', undefined,
				localize('customMode.surfaceLaunchStartingDetail', 'Starting the dev server. This pane will show the live app when {0} responds.', url)));
			body.appendChild($('code.custom-mode-ui-surface-launch-command', { title: displayedCommand }, displayedCommand!));
		} else {
			body.appendChild($('p.custom-mode-ui-surface-launch-copy', undefined,
				localize('customMode.surfaceLaunchReadyDetail', 'Preview is wired to {0}. Start the surface to load it here.', url)));
			body.appendChild($('code.custom-mode-ui-surface-launch-command', { title: displayedCommand }, displayedCommand!));
		}

		const actions = $('div.custom-mode-ui-surface-launch-actions');
		if (command && workspaceFolder) {
			const startButton = $('button.custom-mode-ui-surface-launch-run', { type: 'button' }, starting
				? localize('customMode.surfaceLaunchStarting', 'Starting…')
				: localize('customMode.surfaceLaunchStartPreview', 'Start preview')) as HTMLButtonElement;
			startButton.disabled = starting;
			this.surfaceLaunchActionDisposables.add(addDisposableListener(startButton, 'click', () => {
				this.startingSurfaceServers.add(surface.id);
				this.renderSelectedSurfaceLaunchPanel();
				void this.ensureSurfaceServerStarted(surface, { force: true })
					.finally(() => this.renderSelectedSurfaceLaunchPanel());
			}));
			actions.appendChild(startButton);
		}
		if (url) {
			const openButton = $('button.custom-mode-ui-surface-launch-run.secondary', { type: 'button' },
				localize('customMode.surfaceLaunchOpenExternal', 'Open in browser')) as HTMLButtonElement;
			this.surfaceLaunchActionDisposables.add(addDisposableListener(openButton, 'click', () => {
				void this.openerService.open(URI.parse(url), { openExternal: true });
			}));
			actions.appendChild(openButton);
		}
		if (actions.childElementCount) {
			body.appendChild(actions);
		}

		this.uiSurfaceLaunchPanel.appendChild(
			$('div.custom-mode-ui-surface-launch-chrome', undefined, toolbar, body),
		);
		this.maybeAutoStartSelectedSurfacePreview();
	}

	private async publishWorkspaceToGitHub(): Promise<void> {
		const actionLabel = localize('customMode.surfaceActions.publishToGitHub', 'Publish to GitHub');
		try {
			// Always use our prompt so the default repo name is the workspace goal name
			// (built-in github.publish defaults to the folder basename, e.g. "Console").
			const ghResult = await this.publishWorkspaceToGitHubViaGhCli();
			if (ghResult === 'started') {
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'publish-to-github',
					actionLabel,
					ok: true,
					detail: 'Started GitHub publish/push in the terminal (create only when no GitHub origin exists; otherwise git push to origin). Verify the push finished; help with gh/git auth if needed.',
				}));
			}
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			this.notificationService.error(localize(
				'customMode.surfaceActions.publishToGitHubFailed',
				'Could not publish to GitHub: {0}',
				message,
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'publish-to-github',
				actionLabel,
				ok: false,
				detail: message,
			}));
		}
	}

	/**
	 * Publish via `gh` / git CLI.
	 * If `origin` already points at GitHub, push only — do not create another repo.
	 */
	private async publishWorkspaceToGitHubViaGhCli(): Promise<'started' | 'cancelled'> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			throw new Error(localize(
				'customMode.surfaceActions.publishToGitHubNoFolder',
				'Open a workspace folder before publishing to GitHub.',
			));
		}
		const gitConfig = joinPath(workspaceFolder, '.git', 'config');
		const configText = (await this.fileService.exists(gitConfig))
			? (await this.fileService.readFile(gitConfig)).value.toString()
			: undefined;
		if (hasGitHubOriginRemote(configText)) {
			const existingRemote = originRemoteUrlFromGitConfig(configText!);
			const browseUrl = (existingRemote && githubBrowseUrlFromRemote(existingRemote)) || existingRemote || 'origin';
			const { confirmed } = await this.dialogService.confirm({
				type: 'info',
				message: localize(
					'customMode.surfaceActions.publishToGitHubPushConfirm',
					'This workspace already has a GitHub remote. Push the current branch to {0}?',
					browseUrl,
				),
				primaryButton: localize('customMode.surfaceActions.publishToGitHubPushConfirmButton', 'Push to GitHub'),
			});
			if (!confirmed) {
				return 'cancelled';
			}
			await this.runSuggestedCommandInTerminal(workspaceFolder, buildGitPushOriginCommand());
			this.notificationService.info(localize(
				'customMode.surfaceActions.publishToGitHubPushStarted',
				'Started git push to the existing GitHub remote. Sign in if prompted, then wait for the push to finish.',
			));
			return 'started';
		}
		const defaultName = defaultGitHubRepositoryName({
			workspaceName: this.consoleService.getGoal()?.name,
			folderBasename: basename(workspaceFolder),
		});
		const nameInput = await this.quickInputService.input({
			title: localize('customMode.surfaceActions.publishToGitHubInputTitle', 'Publish to GitHub'),
			prompt: localize('customMode.surfaceActions.publishToGitHubNamePrompt', 'GitHub repository name'),
			value: defaultName,
			validateInput: async (value) => {
				if (!sanitizeGitHubRepositoryName(value)) {
					return localize('customMode.surfaceActions.publishToGitHubNameInvalid', 'Enter a valid repository name.');
				}
				return undefined;
			},
		});
		if (nameInput === undefined) {
			return 'cancelled';
		}
		const repoName = sanitizeGitHubRepositoryName(nameInput);
		const visibilityPick = await this.quickInputService.pick<{ label: string; visibility: 'private' | 'public' }>([
			{
				label: localize('customMode.surfaceActions.publishToGitHubPrivate', 'Private'),
				visibility: 'private',
				description: localize('customMode.surfaceActions.publishToGitHubPrivateDesc', 'Only you can see this repository'),
			},
			{
				label: localize('customMode.surfaceActions.publishToGitHubPublic', 'Public'),
				visibility: 'public',
				description: localize('customMode.surfaceActions.publishToGitHubPublicDesc', 'Anyone on the internet can see this repository'),
			},
		], {
			title: localize('customMode.surfaceActions.publishToGitHubVisibilityTitle', 'Repository visibility'),
			placeHolder: localize('customMode.surfaceActions.publishToGitHubVisibilityPlaceholder', 'Choose visibility'),
		});
		if (!visibilityPick) {
			return 'cancelled';
		}
		const { confirmed } = await this.dialogService.confirm({
			type: 'info',
			message: localize(
				'customMode.surfaceActions.publishToGitHubGhConfirm',
				'Create GitHub repository "{0}" from this workspace and push with the gh CLI? (Built-in Publish to GitHub is unavailable because vscode.github is disabled in this launch.)',
				repoName,
			),
			primaryButton: localize('customMode.surfaceActions.publishToGitHubGhConfirmButton', 'Publish with gh'),
		});
		if (!confirmed) {
			return 'cancelled';
		}
		const command = buildGhPublishWorkspaceCommand(repoName, visibilityPick.visibility);
		await this.runSuggestedCommandInTerminal(workspaceFolder, command);
		this.notificationService.info(localize(
			'customMode.surfaceActions.publishToGitHubGhStarted',
			'Started GitHub publish in the terminal. Sign in with gh if prompted, then wait for the push to finish.',
		));
		return 'started';
	}

	/** Deploy selected surface app path (or workspace root) with the Vercel CLI. */
	private async publishWorkspaceToVercel(): Promise<void> {
		const actionLabel = localize('customMode.surfaceActions.publishToVercel', 'Publish to Vercel');
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			const message = localize(
				'customMode.surfaceActions.publishToVercelNoWorkspace',
				'Open a workspace folder before publishing to Vercel.',
			);
			this.notificationService.warn(message);
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'publish-to-vercel',
				actionLabel,
				ok: false,
				detail: message,
			}));
			return;
		}
		const surface = this.getSelectedSurface();
		const surfacePath = surface?.path?.trim();
		const cwd = surfacePath
			? joinPath(workspaceFolder, ...surfacePath.split('/').filter(Boolean))
			: workspaceFolder;
		const targetName = surface?.name?.trim() || localize('customMode.surfaceActions.publishToVercelWorkspace', 'workspace');
		try {
			this.notificationService.info(localize(
				'customMode.surfaceActions.publishToVercelStarting',
				'Deploying {0} to Vercel…',
				targetName,
			));
			const title = `Vercel — ${targetName}`;
			const existing = this.terminalService.instances.find(instance => instance.title === title);
			const terminal = existing ?? await this.terminalService.createTerminal({
				cwd,
				config: isWindows ? undefined : { executable: '/bin/bash' },
			});
			if (!existing) {
				await terminal.rename(title);
			}
			await this.prepareTerminalForCommandOutput(terminal);
			terminal.focus();
			// Production deploy; --yes accepts defaults / skips confirmations where the CLI allows.
			terminal.sendText('npx --yes vercel@latest --prod --yes', true);
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'publish-to-vercel',
				actionLabel,
				ok: true,
				detail: `Started production Vercel deploy (npx vercel --prod --yes) for "${targetName}" in ${cwd.fsPath}. Verify the deploy succeeded and the live URL works.`,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			this.notificationService.error(localize(
				'customMode.surfaceActions.publishToVercelFailed',
				'Could not publish to Vercel: {0}',
				message,
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'publish-to-vercel',
				actionLabel,
				ok: false,
				detail: message,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		}
	}

	/** Open the GitHub repository for this workspace in the browser. */
	private async showPublishedGitHub(): Promise<void> {
		const actionLabel = localize('customMode.surfaceActions.showGitHub', 'Show GitHub');
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			const message = localize(
				'customMode.surfaceActions.showGitHubNoWorkspace',
				'Open a workspace folder before showing GitHub.',
			);
			this.notificationService.warn(message);
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'show-github',
				actionLabel,
				ok: false,
				detail: message,
			}));
			return;
		}
		const surface = this.getSelectedSurface();
		try {
			const gitConfig = joinPath(workspaceFolder, '.git', 'config');
			const remoteUrl = (await this.fileService.exists(gitConfig))
				? originRemoteUrlFromGitConfig((await this.fileService.readFile(gitConfig)).value.toString())
				: undefined;
			const browseUrl = remoteUrl ? githubBrowseUrlFromRemote(remoteUrl) : undefined;
			if (!browseUrl) {
				const message = localize(
					'customMode.surfaceActions.showGitHubNotLinked',
					'No GitHub origin remote found. Publish to GitHub first.',
				);
				this.notificationService.warn(message);
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'show-github',
					actionLabel,
					ok: false,
					detail: message,
					surfaceId: surface?.id,
					surfaceName: surface?.name,
				}));
				return;
			}
			await this.openerService.open(URI.parse(browseUrl), { openExternal: true });
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'show-github',
				actionLabel,
				ok: true,
				detail: `Opened ${browseUrl} in the browser.`,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			this.notificationService.error(localize(
				'customMode.surfaceActions.showGitHubFailed',
				'Could not open GitHub: {0}',
				message,
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'show-github',
				actionLabel,
				ok: false,
				detail: message,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		}
	}

	/** Open the Vercel deployment for the selected surface (or workspace) in the browser. */
	private async showPublishedVercel(): Promise<void> {
		const actionLabel = localize('customMode.surfaceActions.showVercel', 'Show Vercel');
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			const message = localize(
				'customMode.surfaceActions.showVercelNoWorkspace',
				'Open a workspace folder before showing Vercel.',
			);
			this.notificationService.warn(message);
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'show-vercel',
				actionLabel,
				ok: false,
				detail: message,
			}));
			return;
		}
		const surface = this.getSelectedSurface();
		const surfacePath = surface?.path?.trim();
		const cwd = surfacePath
			? joinPath(workspaceFolder, ...surfacePath.split('/').filter(Boolean))
			: workspaceFolder;
		try {
			const projectJson = joinPath(cwd, '.vercel', 'project.json');
			const linked = await this.fileService.exists(projectJson);
			if (!linked) {
				const message = localize(
					'customMode.surfaceActions.showVercelNotLinked',
					'No Vercel project linked here. Publish to Vercel first.',
				);
				this.notificationService.warn(message);
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'show-vercel',
					actionLabel,
					ok: false,
					detail: message,
					surfaceId: surface?.id,
					surfaceName: surface?.name,
				}));
				return;
			}
			const raw = (await this.fileService.readFile(projectJson)).value.toString();
			const browseUrl = vercelProductionUrlFromProjectJson(raw);
			if (browseUrl) {
				await this.openerService.open(URI.parse(browseUrl), { openExternal: true });
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'show-vercel',
					actionLabel,
					ok: true,
					detail: `Opened ${browseUrl} in the browser.`,
					surfaceId: surface?.id,
					surfaceName: surface?.name,
				}));
				return;
			}
			await this.runSuggestedCommandInTerminal(cwd, buildOpenVercelDeploymentCommand());
			this.notificationService.info(localize(
				'customMode.surfaceActions.showVercelViaCli',
				'Looking up the Vercel deployment URL in the terminal…',
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'show-vercel',
				actionLabel,
				ok: true,
				detail: `Started Vercel CLI lookup to open the deployment for ${cwd.fsPath}. Verify the live URL opened.`,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			this.notificationService.error(localize(
				'customMode.surfaceActions.showVercelFailed',
				'Could not open Vercel: {0}',
				message,
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'show-vercel',
				actionLabel,
				ok: false,
				detail: message,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		}
	}

	/** Dry-run then confirm apply for ~/.ix/config.yaml dead workspace registrations. */
	private async pruneIxWorkspaceRegistry(): Promise<void> {
		const actionLabel = localize('customMode.surfaceActions.pruneGraphRegistry', 'Prune Graph Registry');
		try {
			this.notificationService.info(localize(
				'customMode.surfaceActions.pruneGraphRegistryDryRun',
				'Scanning ~/.ix/config.yaml for dead workspace registrations…',
			));
			const dryRun = await this.ixIntegrationService.pruneWorkspaceRegistry();
			if (!dryRun.ok) {
				const message = dryRun.error || localize('customMode.surfaceActions.pruneGraphRegistryUnknownError', 'Prune dry-run failed.');
				this.notificationService.error(localize(
					'customMode.surfaceActions.pruneGraphRegistryFailed',
					'Could not prune graph registry: {0}',
					message,
				));
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'prune-graph-registry',
					actionLabel,
					ok: false,
					detail: message,
				}));
				return;
			}
			const summary = dryRun.summary;
			if (!summary) {
				const message = localize(
					'customMode.surfaceActions.pruneGraphRegistryUnparsed',
					'Prune dry-run finished but the summary could not be parsed. Check the Ix terminal output.',
				);
				this.notificationService.warn(message);
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'prune-graph-registry',
					actionLabel,
					ok: false,
					detail: message,
				}));
				return;
			}
			if (summary.remove <= 0) {
				const detail = `Graph registry is clean — kept ${summary.keep} workspace registration(s), nothing to remove.`;
				this.notificationService.info(localize(
					'customMode.surfaceActions.pruneGraphRegistryNothing',
					'Graph registry is clean — kept {0} workspace registration(s), nothing to remove.',
					summary.keep,
				));
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'prune-graph-registry',
					actionLabel,
					ok: true,
					detail: `${detail} Verify ~/.ix/config.yaml still looks correct.`,
				}));
				return;
			}
			const { confirmed } = await this.dialogService.confirm({
				type: 'warning',
				message: localize(
					'customMode.surfaceActions.pruneGraphRegistryConfirm',
					'Remove {0} dead workspace registration(s) from ~/.ix/config.yaml? Keeps {1} (including the default). Creates a timestamped backup, deletes orphan ingest caches, and restarts the Ix docker backend.',
					summary.remove,
					summary.keep,
				),
				detail: formatIxPruneWorkspaceRegistryDetail(summary),
				primaryButton: localize('customMode.surfaceActions.pruneGraphRegistryConfirmButton', 'Prune registry'),
			});
			if (!confirmed) {
				return;
			}
			const applied = await this.ixIntegrationService.pruneWorkspaceRegistry({
				apply: true,
				alsoMtimes: true,
				restartDocker: true,
			});
			if (!applied.ok) {
				const message = applied.error || localize('customMode.surfaceActions.pruneGraphRegistryUnknownError', 'Prune apply failed.');
				this.notificationService.error(localize(
					'customMode.surfaceActions.pruneGraphRegistryFailed',
					'Could not prune graph registry: {0}',
					message,
				));
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'prune-graph-registry',
					actionLabel,
					ok: false,
					detail: message,
				}));
				return;
			}
			const appliedSummary = applied.summary ?? summary;
			const restartNote = applied.dockerRestarted
				? localize('customMode.surfaceActions.pruneGraphRegistryRestarted', ' Ix docker backend restarted.')
				: localize('customMode.surfaceActions.pruneGraphRegistryRestartSkipped', ' Restart Ix (F1) if the backend still looks wedged.');
			this.notificationService.info(localize(
				'customMode.surfaceActions.pruneGraphRegistryDone',
				'Pruned graph registry: removed {0}, kept {1}.{2}',
				appliedSummary.remove,
				appliedSummary.keep,
				restartNote,
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'prune-graph-registry',
				actionLabel,
				ok: true,
				detail: `Pruned graph registry: removed ${appliedSummary.remove}, kept ${appliedSummary.keep}.${restartNote} Verify ~/.ix/config.yaml and that Ix still resolves the active workspace.`,
			}));
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			this.notificationService.error(localize(
				'customMode.surfaceActions.pruneGraphRegistryFailed',
				'Could not prune graph registry: {0}',
				message,
			));
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'prune-graph-registry',
				actionLabel,
				ok: false,
				detail: message,
			}));
		}
	}

	/** Open/create the Actions Claude session and paste a request/outcome prompt into chat. */
	private async submitActionsClaudePrompt(prompt: string): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder || !prompt.trim()) {
			return;
		}
		try {
			await this.submitPromptToClaudeKey(workspaceFolder, ACTIONS_CLAUDE_KEY, prompt, { reveal: true });
		} catch (error: unknown) {
			this.notificationService.warn(localize(
				'customMode.surfaceActions.claudePromptSendFailed',
				'Could not send action request to Actions Claude: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	/** Actions-panel / Real Graph header — regenerate locally, then hand outcome to Actions Claude. */
	private async regenerateRealGraphFromActions(): Promise<void> {
		const actionLabel = localize('customMode.surfaceActions.regenerateRealGraph', 'Regenerate Real Graph');
		const surface = this.getSelectedSurface();
		try {
			if (!this.surfacePlanPanel) {
				void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
					actionId: 'regenerate-real-graph',
					actionLabel,
					ok: false,
					detail: 'Surface plan panel is not available; could not regenerate Real Graph.',
					surfaceId: surface?.id,
					surfaceName: surface?.name,
				}));
				return;
			}
			await this.surfacePlanPanel.regenerateRealGraph();
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regenerate-real-graph',
				actionLabel,
				ok: true,
				detail: surface
					? `Requested Real Graph regenerate for surface "${surface.name}" (${surface.id}). Verify the graph regions refreshed from on-disk Ix map data. If the Real Graph is still sparse or wrong, run remap_and_wait + compare_proposal for this surface and fix Ix/overlay gaps.`
					: 'Requested Real Graph regenerate. Verify the graph regions refreshed from on-disk Ix map data.',
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		} catch (error: unknown) {
			const message = String((error as Error)?.message ?? error);
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regenerate-real-graph',
				actionLabel,
				ok: false,
				detail: message,
				surfaceId: surface?.id,
				surfaceName: surface?.name,
			}));
		}
	}

	/** Surface Description header — Actions Claude regenerates surfaces[].purpose. */
	private async regenerateSurfaceDescriptionFromActions(surfaceId: string, surfaceName: string): Promise<void> {
		const actionLabel = localize('customMode.workspaceDescriptionRegen', 'Regen Description');
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-description',
				actionLabel,
				ok: false,
				detail: 'Open a workspace folder before regenerating Description.',
				surfaceId,
				surfaceName,
			}));
			return;
		}
		try {
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			const regenPrompt = buildSurfacePurposeRegenPrompt({ surfaceId, surfaceName });
			await this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-description',
				actionLabel,
				ok: true,
				detail: [
					`Regenerate the Description for surface "${surfaceName}" (${surfaceId}) now (surfaces[].purpose in workspace.goal.json).`,
					regenPrompt,
				].join('\n\n'),
				surfaceId,
				surfaceName,
			}));
			this.applyClaudeTerminalHeight(Math.max(this.claudeTerminalHeight, CLAUDE_TERMINAL_DEFAULT_HEIGHT), { persist: false });
			this.notificationService.info(localize(
				'customMode.surfacePurposeRegenStarted',
				'Claude is regenerating the Description for {0} (surfaces[].purpose in workspace.goal.json).',
				surfaceName,
			));
		} catch (error: unknown) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-description',
				actionLabel,
				ok: false,
				detail: String((error as Error)?.message ?? error),
				surfaceId,
				surfaceName,
			}));
		}
	}

	/** Surface Schema header — Actions Claude regenerates surfaces[].schema. */
	private async regenerateSurfaceSchemaFromActions(surfaceId: string, surfaceName: string): Promise<void> {
		const actionLabel = localize('customMode.surfaceSchemaRegen', 'Regen Schema');
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-schema',
				actionLabel,
				ok: false,
				detail: 'Open a workspace folder before regenerating Schema.',
				surfaceId,
				surfaceName,
			}));
			return;
		}
		try {
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			const regenPrompt = buildSurfaceSchemaRegenPrompt({ surfaceId, surfaceName });
			await this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-schema',
				actionLabel,
				ok: true,
				detail: [
					`Regenerate the Schema for surface "${surfaceName}" (${surfaceId}) now (surfaces[].schema in workspace.goal.json).`,
					regenPrompt,
				].join('\n\n'),
				surfaceId,
				surfaceName,
			}));
			this.applyClaudeTerminalHeight(Math.max(this.claudeTerminalHeight, CLAUDE_TERMINAL_DEFAULT_HEIGHT), { persist: false });
			this.notificationService.info(localize(
				'customMode.surfaceSchemaRegenStarted',
				'Claude is regenerating the Schema for {0} (surfaces[].schema in workspace.goal.json).',
				surfaceName,
			));
		} catch (error: unknown) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-schema',
				actionLabel,
				ok: false,
				detail: String((error as Error)?.message ?? error),
				surfaceId,
				surfaceName,
			}));
		}
	}

	/** Console Description header — Actions Claude regenerates goal.description. */
	private async regenerateWorkspaceDescriptionFromActions(): Promise<void> {
		const actionLabel = localize('customMode.workspaceDescriptionRegen', 'Regen Description');
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-workspace-description',
				actionLabel,
				ok: false,
				detail: 'Open a workspace folder before regenerating Description.',
			}));
			return;
		}
		try {
			await this.ensureWorkspaceClaudeMd(workspaceFolder);
			const regenPrompt = buildWorkspaceDescriptionRegenPrompt({
				businessName: this.uiSurfaceSetupGoalNameInput?.value?.trim()
					|| this.consoleService.getGoal()?.name?.trim()
					|| undefined,
			});
			await this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-workspace-description',
				actionLabel,
				ok: true,
				detail: [
					'Regenerate the workspace Description now (goal.description in workspace.goal.json).',
					regenPrompt,
				].join('\n\n'),
			}));
			this.applyClaudeTerminalHeight(Math.max(this.claudeTerminalHeight, CLAUDE_TERMINAL_DEFAULT_HEIGHT), { persist: false });
			this.notificationService.info(localize(
				'customMode.workspaceDescriptionRegenStarted',
				'Claude is regenerating the workspace Description (goal.description in workspace.goal.json).',
			));
		} catch (error: unknown) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'regen-workspace-description',
				actionLabel,
				ok: false,
				detail: String((error as Error)?.message ?? error),
			}));
		}
	}

	/** Surfaces header — Start all, then hand outcome to Actions Claude. */
	private async startAllSurfacesFromActions(): Promise<void> {
		const actionLabel = localize('customMode.startAllSurfaces', 'Start all surfaces');
		try {
			const result = await this.onStartAllSurfacesClicked();
			if (result === 'noop') {
				return;
			}
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'start-all-surfaces',
				actionLabel,
				ok: result === 'ok',
				detail: result === 'ok'
					? 'Started surface dev servers. Verify each Preview URL is reachable and fix any start failures.'
					: 'Started some surface dev servers with failures. Check runtime logs and fix failing surfaces.',
			}));
		} catch (error: unknown) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'start-all-surfaces',
				actionLabel,
				ok: false,
				detail: String((error as Error)?.message ?? error),
			}));
		}
	}

	/** Surfaces header — Clear all, then hand outcome to Actions Claude. */
	private async clearAllSurfacesFromActions(): Promise<void> {
		const actionLabel = localize('customMode.clearAllSurfaces', 'Clear all Surfaces');
		try {
			const result = await this.clearAllSurfaces();
			if (result === 'cancelled' || result === 'noop') {
				return;
			}
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'clear-all-surfaces',
				actionLabel,
				ok: result === 'ok',
				detail: result === 'ok'
					? 'Cleared all surfaces, planning artifacts, and wiped apps/. Verify Console is back at workspace home with the default plan.'
					: 'Clear all Surfaces finished with partial failures. Inspect remaining apps/ folders and .agent artifacts.',
			}));
		} catch (error: unknown) {
			void this.submitActionsClaudePrompt(formatActionsCommonOutcomePrompt({
				actionId: 'clear-all-surfaces',
				actionLabel,
				ok: false,
				detail: String((error as Error)?.message ?? error),
			}));
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
		void this.submitActionsClaudePrompt(formatActionsWorkflowOutcomePrompt({
			surfaceName: surface.name,
			surfaceId: surface.id,
			workflowId: workflow.id,
			workflowLabel: workflow.label,
			result,
		}));
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
		void this.submitActionsClaudePrompt(formatActionsWorkflowOutcomePrompt({
			surfaceName: surface.name,
			surfaceId: surface.id,
			workflowId: workflow.id,
			workflowLabel: workflow.label,
			result,
			focusStepId: step.id,
		}));
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

	private syncSurfaceSetupDashboardVisibility(): void {
		if (this.selectedSurfaceId === ADD_SURFACE_ID) {
			return;
		}
		// The dashboard hosts the shared card rail, so it stays visible while a surface is open;
		// syncWorkspaceHomeView swaps its home panels for the surface plan panel.
		this.uiSurfaceSetupDashboard.classList.remove('hidden');
		this.setSurfaceSetupBuilderOpen(false);
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

		if (this.isDeployedSectionSelected()) {
			this.setSurfaceEmptyState({
				title: localize('customMode.surfaceMissingDeployedUrlTitle', '{0} is not deployed yet', surface.name),
				subtitle: localize(
					'customMode.surfaceMissingDeployedUrlSubtitle',
					'Publish to Vercel (Actions), then set productionUrl on this surface in workspace.goal.json.',
				),
			});
			return;
		}

		if (this.activeSurfaceRailSectionId() === 'database') {
			this.setSurfaceEmptyState({
				title: localize('customMode.surfaceMissingDatabaseUrlTitle', '{0} has no database console URL', surface.name),
				subtitle: localize(
					'customMode.surfaceMissingDatabaseUrlSubtitle',
					'When this surface uses Supabase (or another browsable DB console), set databaseUrl on this surface in workspace.goal.json.',
				),
			});
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
		const model = buildGoalOverviewModel(goal, surfaces);
		this.setSurfaceEmptyState({ title: model.title, subtitle: model.lede ?? '' });
		this.uiSurfaceEmptyState.classList.add('custom-mode-ui-surface-empty-overview');

		if (model.facts.length > 0) {
			this.uiSurfaceEmptyBody.appendChild($('div.custom-mode-ui-surface-overview-facts', undefined,
				...model.facts.map(fact => $('span.custom-mode-ui-surface-overview-fact', undefined,
					$('span.custom-mode-ui-surface-overview-fact-label', undefined, fact.label),
					$('span.custom-mode-ui-surface-overview-fact-value', undefined, fact.value),
				)),
			));
		}

		if (model.detailParagraphs.length > 0) {
			const toggle = $('button.custom-mode-ui-surface-overview-details-toggle', {
				type: 'button',
				'aria-expanded': 'false',
			}, localize('customMode.goalOverviewDetailsToggle', 'About This Goal')) as HTMLButtonElement;
			const details = $('div.custom-mode-ui-surface-overview-details.hidden', undefined,
				...model.detailParagraphs.map(paragraph => $('p', undefined, paragraph)),
			);
			this.goalOverviewListeners.add(addDisposableListener(toggle, 'click', () => {
				const expanded = !details.classList.toggle('hidden');
				toggle.setAttribute('aria-expanded', String(expanded));
			}));
			this.uiSurfaceEmptyBody.append(toggle, details);
		}

		if (model.ctas.length > 0) {
			const row = $('div.custom-mode-ui-surface-empty-actions');
			for (const cta of model.ctas) {
				const button = $(cta.kind === 'openDeployed'
					? 'button.custom-mode-ui-surface-empty-action.primary'
					: 'button.custom-mode-ui-surface-empty-action', {
					type: 'button',
				}, cta.label) as HTMLButtonElement;
				if (cta.url) {
					this.goalOverviewListeners.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, cta.url));
				}
				this.goalOverviewListeners.add(addDisposableListener(button, 'click', () => this.handleGoalOverviewCta(cta)));
				row.appendChild(button);
			}
			this.uiSurfaceEmptyBody.appendChild(row);
		}
	}

	private handleGoalOverviewCta(cta: GoalOverviewCta): void {
		if (cta.kind === 'openDeployed' && cta.url) {
			void this.openerService.open(URI.parse(cta.url), { openExternal: true });
			return;
		}
		if (cta.kind === 'openPreview' && cta.surfaceId) {
			void this.openWorkspaceSuggestedSurfacePlan(cta.surfaceId);
			return;
		}
		this.uiWorkspaceHomeCardRail?.reveal();
		this.openConsoleWithSection(CONSOLE_HOME_DEFAULT_SECTION);
	}

	private setGoalWorkspaceManifestStateMessage(status: string, diagnostics: readonly { readonly path: string; readonly message: string }[]): void {
		if (status === 'no-workspace') {
			this.setSurfaceEmptyState({
				title: localize('customMode.goalWorkspaceNoWorkspaceTitle', 'Build your goal workspace'),
				subtitle: localize(
					'customMode.goalWorkspaceNoWorkspaceDetail',
					'Open a folder below, or create a fresh Console workspace to name the business and generate surfaces.'
				)
			}, { showOpenableFolders: true });
			return;
		}

		if (status === 'invalid') {
			const diagnostic = diagnostics[0];
			this.setSurfaceEmptyState({
				title: localize('customMode.goalWorkspaceInvalidTitle', 'Invalid workspace.goal.json'),
				subtitle: diagnostic
					? localize('customMode.goalWorkspaceInvalidDetail', '{0}: {1}', diagnostic.path, diagnostic.message)
					: localize('customMode.goalWorkspaceInvalidGeneric', 'Fix the manifest diagnostics to show goal surfaces.')
			}, { showOpenableFolders: true });
			return;
		}

		if (status === 'missing') {
			this.setSurfaceEmptyState({
				title: localize('customMode.goalWorkspaceMissingTitle', 'No goal workspace manifest'),
				subtitle: localize(
					'customMode.goalWorkspaceMissingDetail',
					'This folder has no workspace.goal.json. Open a goal workspace below, or add a manifest at the root.'
				)
			}, { showOpenableFolders: true });
			return;
		}

		this.setSurfaceEmptyState(undefined);
	}

	private setSurfaceEmptyState(
		message: { readonly title: string; readonly subtitle: string } | undefined,
		options?: { readonly showOpenableFolders?: boolean },
	): void {
		this.uiBrowserShell.classList.toggle('custom-mode-ui-surface-missing-url', Boolean(message));
		// While landing/empty copy shows, the rail cards are the primary content — keep
		// them open; restore idle auto-hide once a surface preview takes over.
		this.uiWorkspaceHomeCardRail?.setAutoHideEnabled(!message);
		// Side cards live on the setup dashboard — never hide them for empty/missing states.
		this.uiSurfaceSetupDashboard.classList.remove('hidden');
		this.setSurfaceSetupBuilderOpen(false);
		this.uiSurfaceEmptyState.classList.toggle('hidden', !message);
		this.uiSurfaceEmptyTitle.textContent = message?.title ?? '';
		this.uiSurfaceEmptySubtitle.textContent = message?.subtitle ?? '';
		// Structured overview content (facts / disclosure / CTAs) belongs to the goal
		// overview state only — every other state starts from the plain copy.
		this.goalOverviewListeners.clear();
		this.uiSurfaceEmptyBody.replaceChildren();
		this.uiSurfaceEmptyState.classList.remove('custom-mode-ui-surface-empty-overview');
		this.emptyOpenableFoldersEnabled = Boolean(message && options?.showOpenableFolders);
		if (this.emptyOpenableFoldersEnabled) {
			void this.refreshEmptyOpenableFolders();
		} else {
			this.clearEmptyOpenableFolders();
		}
		if (message) {
			// Empty copy owns the content pane; keep Console/Plan/preview chrome out of the way.
			this.uiBrowserShell.classList.remove('custom-mode-ui-surface-main-view-overlay');
			this.uiBrowserShell.classList.remove('custom-mode-ui-surface-preview-visible');
			this.uiConsoleHomeHost.classList.add('hidden');
			this.uiSurfacePlanPanelRoot.classList.add('hidden');
			this.uiSurfacePlanPanelRoot.hidden = true;
			this.uiSurfaceCustomViewsRoot.classList.add('hidden');
			this.uiSurfaceCustomViewsRoot.hidden = true;
		} else if (this.uiWorkspaceHomeCardRail) {
			this.syncWorkspaceHomeView();
		}
	}

	private clearEmptyOpenableFolders(): void {
		this.emptyOpenableFolderListeners.clear();
		this.uiSurfaceEmptyFolders.replaceChildren();
		this.uiSurfaceEmptyFolders.classList.add('hidden');
		this.uiSurfaceEmptyActions.replaceChildren();
		this.uiSurfaceEmptyActions.classList.add('hidden');
	}

	private async refreshEmptyOpenableFolders(): Promise<void> {
		if (!this.emptyOpenableFoldersEnabled) {
			return;
		}
		const folders = await this.collectOpenableFolders();
		if (!this.emptyOpenableFoldersEnabled) {
			return;
		}
		this.emptyOpenableFolderListeners.clear();
		this.uiSurfaceEmptyFolders.replaceChildren();
		this.uiSurfaceEmptyActions.replaceChildren();

		this.uiSurfaceEmptyFolders.appendChild(
			$('div.custom-mode-ui-surface-empty-folders-heading', undefined,
				localize('customMode.emptyOpenableFoldersHeading', 'Open a folder')),
		);

		if (folders.length === 0) {
			this.uiSurfaceEmptyFolders.appendChild(
				$('div.custom-mode-ui-surface-empty-folder-path', undefined,
					localize('customMode.emptyOpenableFoldersNone', 'No recent folders yet.')),
			);
		} else {
			for (const folder of folders) {
				const button = $('button.custom-mode-ui-surface-empty-folder', {
					type: 'button',
					role: 'listitem',
					title: folder.fullPath,
					'aria-label': localize('customMode.emptyOpenableFolderAria', 'Open folder {0}', folder.name),
				},
					$('span.custom-mode-ui-surface-empty-folder-name', undefined, folder.name),
					$('span.custom-mode-ui-surface-empty-folder-path', undefined, folder.parentPath || folder.fullPath),
				) as HTMLButtonElement;
				this.emptyOpenableFolderListeners.add(addDisposableListener(button, 'click', () => {
					void this.hostService.openWindow([folder.openable], {
						forceReuseWindow: true,
						remoteAuthority: folder.remoteAuthority ?? null,
					});
				}));
				this.uiSurfaceEmptyFolders.appendChild(button);
			}
		}
		this.uiSurfaceEmptyFolders.classList.remove('hidden');

		const openFolderBtn = $('button.custom-mode-ui-surface-empty-action.primary', {
			type: 'button',
		}, localize('customMode.emptyOpenFolderAction', 'Open Folder…')) as HTMLButtonElement;
		const newWorkspaceBtn = $('button.custom-mode-ui-surface-empty-action', {
			type: 'button',
		}, localize('customMode.emptyNewConsoleWorkspaceAction', 'New Console workspace')) as HTMLButtonElement;
		this.emptyOpenableFolderListeners.add(addDisposableListener(openFolderBtn, 'click', () => {
			void this.fileDialogService.pickFolderAndOpen({ forceNewWindow: false });
		}));
		this.emptyOpenableFolderListeners.add(addDisposableListener(newWorkspaceBtn, 'click', () => {
			void this.defaultProjectService.openFallbackWorkspace();
		}));
		this.uiSurfaceEmptyActions.append(openFolderBtn, newWorkspaceBtn);
		this.uiSurfaceEmptyActions.classList.remove('hidden');
	}

	private toggleWorkspaceSwitcherMenu(anchor: HTMLElement): void {
		if (this.workspaceSwitcherPopover) {
			this.closeWorkspaceSwitcherMenu();
			return;
		}
		void this.openWorkspaceSwitcherMenu(anchor);
	}

	private closeWorkspaceSwitcherMenu(): void {
		this.workspaceSwitcherOpenGeneration++;
		this.workspaceSwitcherListeners.clear();
		const openAnchors = this.uiWorkspaceHomeCardRail?.rail.querySelectorAll(
			'.custom-mode-card-rail-group-label.is-action[aria-expanded="true"]',
		);
		openAnchors?.forEach(el => el.setAttribute('aria-expanded', 'false'));
		this.workspaceSwitcherPopover?.remove();
		this.workspaceSwitcherPopover = undefined;
	}

	private positionWorkspaceSwitcherPopover(anchor: HTMLElement, popover: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const margin = 8;
		const width = Math.min(280, mainWindow.innerWidth - margin * 2);
		let left = rect.left;
		if (left + width > mainWindow.innerWidth - margin) {
			left = Math.max(margin, mainWindow.innerWidth - margin - width);
		}
		popover.style.width = `${width}px`;
		popover.style.left = `${left}px`;
		popover.style.top = `${rect.bottom + 6}px`;
		const popoverHeight = popover.getBoundingClientRect().height;
		if (rect.bottom + 6 + popoverHeight > mainWindow.innerHeight - margin && rect.top > popoverHeight + margin) {
			popover.style.top = `${Math.max(margin, rect.top - popoverHeight - 6)}px`;
		}
	}

	private async openWorkspaceSwitcherMenu(anchor: HTMLElement): Promise<void> {
		const generation = ++this.workspaceSwitcherOpenGeneration;
		this.workspaceSwitcherListeners.clear();
		anchor.setAttribute('aria-expanded', 'true');

		const list = $('div.custom-mode-workspace-switcher-list', {
			role: 'none',
		});
		list.appendChild(
			$('div.custom-mode-workspace-switcher-empty', undefined,
				localize('customMode.workspaceSwitcherLoading', 'Loading workspaces…')),
		);

		const createBtn = $('button.custom-mode-workspace-switcher-create', {
			type: 'button',
			role: 'menuitem',
		}, localize('customMode.workspaceSwitcherCreate', '+ Create Workspace')) as HTMLButtonElement;
		this.workspaceSwitcherListeners.add(addDisposableListener(createBtn, 'click', () => {
			this.closeWorkspaceSwitcherMenu();
			void this.defaultProjectService.openFallbackWorkspace();
		}));

		const popover = $('div.custom-mode-workspace-switcher-popover', {
			role: 'menu',
			'aria-label': localize('customMode.workspaceSwitcherMenuAria', 'Workspaces'),
		},
			$('div.custom-mode-workspace-switcher-heading', undefined,
				localize('customMode.workspaceSwitcherHeading', 'Workspaces')),
			list,
			createBtn,
		);
		// Critical layout inline so the menu stays visible even if stylesheet scope drifts.
		popover.style.position = 'fixed';
		popover.style.zIndex = '2800';
		this.workspaceSwitcherPopover = popover;
		// Styles are scoped under `.monaco-workbench`; body is a sibling, not a descendant.
		this.container.appendChild(popover);
		this.positionWorkspaceSwitcherPopover(anchor, popover);

		this.workspaceSwitcherListeners.add(addDisposableListener(mainWindow.document, 'pointerdown', (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			if (popover.contains(target)) {
				return;
			}
			if (target instanceof Element && target.closest('.custom-mode-card-rail-group-label.is-action')) {
				return;
			}
			this.closeWorkspaceSwitcherMenu();
		}));
		this.workspaceSwitcherListeners.add(addDisposableListener(mainWindow.document, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.closeWorkspaceSwitcherMenu();
				anchor.focus();
			}
		}));
		this.workspaceSwitcherListeners.add(toDisposable(() => {
			if (this.workspaceSwitcherPopover === popover) {
				popover.remove();
				this.workspaceSwitcherPopover = undefined;
			}
		}));

		const folders = await this.collectOpenableFolders();
		if (generation !== this.workspaceSwitcherOpenGeneration || this.workspaceSwitcherPopover !== popover) {
			return;
		}

		clearNode(list);
		if (folders.length === 0) {
			list.appendChild(
				$('div.custom-mode-workspace-switcher-empty', undefined,
					localize('customMode.workspaceSwitcherEmpty', 'No other workspaces yet.')),
			);
		} else {
			for (const folder of folders) {
				const button = $('button.custom-mode-workspace-switcher-item', {
					type: 'button',
					role: 'menuitem',
					title: folder.fullPath,
					'aria-label': localize('customMode.workspaceSwitcherOpenAria', 'Open workspace {0}', folder.name),
				},
					$('span.custom-mode-workspace-switcher-item-name', undefined, folder.name),
					$('span.custom-mode-workspace-switcher-item-path', undefined, folder.parentPath || folder.fullPath),
				) as HTMLButtonElement;
				this.workspaceSwitcherListeners.add(addDisposableListener(button, 'click', () => {
					this.closeWorkspaceSwitcherMenu();
					void this.hostService.openWindow([folder.openable], {
						forceReuseWindow: true,
						remoteAuthority: folder.remoteAuthority ?? null,
					});
				}));
				list.appendChild(button);
			}
		}
		this.positionWorkspaceSwitcherPopover(anchor, popover);
	}

	private async collectOpenableFolders(): Promise<Array<{
		readonly name: string;
		readonly parentPath: string;
		readonly fullPath: string;
		readonly openable: { folderUri: URI } | { workspaceUri: URI };
		readonly remoteAuthority?: string;
		readonly key: string;
	}>> {
		const seen = new Set<string>();
		const currentFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const entries: Array<{
			readonly name: string;
			readonly parentPath: string;
			readonly fullPath: string;
			readonly openable: { folderUri: URI } | { workspaceUri: URI };
			readonly remoteAuthority?: string;
			readonly key: string;
		}> = [];

		const pushFolder = (folderUri: URI, label: string | undefined, remoteAuthority?: string) => {
			const key = folderUri.toString();
			if (seen.has(key) || (currentFolder && isEqual(currentFolder, folderUri))) {
				return;
			}
			seen.add(key);
			const fullPath = label || this.labelService.getWorkspaceLabel(folderUri, { verbose: Verbosity.LONG });
			const { name, parentPath } = splitRecentLabel(fullPath);
			entries.push({
				name: name || basename(folderUri),
				parentPath,
				fullPath,
				openable: { folderUri },
				remoteAuthority,
				key,
			});
		};

		const pushWorkspace = (recent: IRecentWorkspace) => {
			const key = recent.workspace.configPath.toString();
			if (seen.has(key) || this.workspaceContextService.isCurrentWorkspace(recent.workspace)) {
				return;
			}
			seen.add(key);
			const fullPath = recent.label || this.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
			const { name, parentPath } = splitRecentLabel(fullPath);
			entries.push({
				name: name || basename(recent.workspace.configPath),
				parentPath,
				fullPath,
				openable: { workspaceUri: recent.workspace.configPath },
				remoteAuthority: recent.remoteAuthority,
				key,
			});
		};

		try {
			const recentlyOpened = await this.workspacesService.getRecentlyOpened();
			for (const recent of recentlyOpened.workspaces) {
				if (isRecentFolder(recent)) {
					pushFolder(recent.folderUri, recent.label, recent.remoteAuthority);
				} else if (isRecentWorkspace(recent)) {
					pushWorkspace(recent);
				}
			}
		} catch {
			// Recents are best-effort for the empty state.
		}

		// Also surface managed Custom/* project folders that may not be in recents yet.
		try {
			const customRoot = joinPath(URI.file(this.nativeEnvironmentService.userDataPath), 'Custom');
			if (await this.fileService.exists(customRoot)) {
				const resolved = await this.fileService.resolve(customRoot);
				for (const child of resolved.children ?? []) {
					if (child.isDirectory) {
						pushFolder(child.resource, undefined);
					}
				}
			}
		} catch {
			// Optional discovery.
		}

		return entries;
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
		// Start App popup retired — never surface the runtime overlay.
		this.uiSetup.classList.remove('custom-mode-setup-active');
		this.uiSetup.classList.add('custom-mode-setup-hidden');
		this.uiRuntimeText.textContent = '';
		this.uiRuntimeLogs.length = 0;
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

	private async onStartAllSurfacesClicked(): Promise<'ok' | 'partial' | 'noop'> {
		if (this.startAllSurfacesInProgress) {
			return 'noop';
		}
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.startAllSurfacesNoWorkspace', 'Open a workspace folder before starting surfaces.')
			});
			return 'noop';
		}
		const surfaces = this.consoleService.getSurfaces().filter(surface => Boolean(surface.devCommand?.trim()));
		if (surfaces.length === 0) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('customMode.startAllSurfacesNoCommands', 'No surfaces have a devCommand in workspace.goal.json.')
			});
			return 'noop';
		}

		this.startAllSurfacesInProgress = true;
		this.updateStartAppControl();
		await freeSurfacePorts(collectUniqueSurfacePorts(surfaces), this.instantiationService);
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
					const ok = await this.ensureSurfaceServerStarted(surface, { force: true });
					if (ok) {
						started.push(surface.name);
						this.pushUiRuntimeLog(`[surface-start-all] ${surface.id}: ${command}`);
					} else {
						failed.push(`${surface.name}: not ready for autostart`);
					}
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
			return 'ok';
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
		return 'partial';
	}

	/**
	 * Auto-start preview servers only after scaffold verification completes.
	 * Surfaces still in draft/scaffolded/failed blueprint state (or mid-handoff) must not
	 * launch `npm run dev` just because package.json / devCommand already exist.
	 * Imported surfaces with no blueprint are allowed to start immediately.
	 */
	private async isSurfaceReadyForDevServerAutoStart(surface: WorkspaceSurface): Promise<boolean> {
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!workspaceFolder) {
			return false;
		}
		const blueprint = await readBlueprint(this.fileService, blueprintResource(workspaceFolder, surface.id));
		if (!blueprint) {
			return true;
		}
		return blueprint.status === 'verified';
	}

	private async ensureSurfaceServerStarted(surface: WorkspaceSurface, options?: { force?: boolean }): Promise<boolean> {
		const command = surface.devCommand?.trim();
		const workspaceFolder = this.getWorkspaceFolderUri();
		if (!command || !workspaceFolder) {
			return false;
		}
		// Manual Start preview always runs; auto-start waits for verified scaffold.
		if (!options?.force && !(await this.isSurfaceReadyForDevServerAutoStart(surface))) {
			this.pushUiRuntimeLog(`[surface-autostart:deferred] ${surface.id}: waiting for verified scaffold before starting dev server`);
			return false;
		}
		try {
			await this.runSurfaceCommandInTerminal(surface.id, workspaceFolder, surface.name, command, surface.localUrl, options);
			return true;
		} catch (error: unknown) {
			this.pushUiRuntimeLog(`[surface-autostart:error] ${surface.id}: ${String((error as Error)?.message ?? error)}`);
			return false;
		}
	}

	private async runSurfaceCommandInTerminal(surfaceId: string, workspaceFolder: URI, surfaceName: string, command: string, preferredUrl?: string, options?: { force?: boolean }): Promise<void> {
		if (!options?.force && (this.startedSurfaceServers.has(surfaceId) || this.startingSurfaceServers.has(surfaceId))) {
			return;
		}
		this.startingSurfaceServers.add(surfaceId);
		this.renderSelectedSurfaceLaunchPanel();
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
			await this.prepareTerminalForCommandOutput(terminal);
			terminal.sendText(alignedCommand, true);
			this.startedSurfaceServers.add(surfaceId);
			this.renderConsoleWorkflowProgress();
			void this.refreshStarterSurfaceCardStatuses();
		} finally {
			this.startingSurfaceServers.delete(surfaceId);
			this.renderSelectedSurfaceLaunchPanel();
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

	/** Legacy Start App hook — surface previews auto-start via Preview section. */
	private maybeAutoStartApp(): void {
		this.maybeAutoStartSelectedSurfacePreview();
	}

	/** Kick `devCommand` when Preview is open and the surface is wired but not reachable yet. */
	private maybeAutoStartSelectedSurfacePreview(): void {
		const surface = this.getSelectedSurface();
		if (!surface) {
			return;
		}
		const previewSelected = !this.contextGatheringOpen
			&& this.activeRailCardId === 'surfaceSection:preview';
		if (!shouldAutoStartSurfacePreview({
			localUrl: surface.localUrl,
			devCommand: surface.devCommand,
			previewSelected,
			reachable: this.isSelectedSurfacePreviewReachable(),
			alreadyStarted: this.startedSurfaceServers.has(surface.id),
			alreadyStarting: this.startingSurfaceServers.has(surface.id),
		})) {
			return;
		}
		void this.ensureSurfaceServerStarted(surface).finally(() => {
			this.renderSelectedSurfaceLaunchPanel();
		});
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

	private updateDevServerDebug(state: DevServerState): void {
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
				if (!this.embeddedUiShowsSurfacePreview(surface.localUrl)) {
					this.setEmbeddedUiUrl(surface.localUrl);
				}
			}
			return;
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
		this.syncTopBarSelectionChrome();
		// Swap the waiting chrome for the live webview (or back) as soon as reachability flips.
		if (reachable !== wasReachable) {
			this.syncSurfaceMainView();
		}

		// When the dev server transitions from unreachable to reachable, the embedded UI is
		// almost certainly showing an ERR_CONNECTION_REFUSED page from the initial load attempt
		// (we set the iframe src early, before the server is actually serving). Force a reload
		// so the user sees the running app without manually refreshing.
		if (reachable && !wasReachable) {
			this.reloadEmbeddedUi();
			if (this.selectedSurfaceId && this.selectedSurfaceId !== ADD_SURFACE_ID && !this.getStoredSurfaceMainView(this.selectedSurfaceId)) {
				void this.resolveAndApplyDefaultSurfaceMainView(this.selectedSurfaceId, this.selectedSurfaceTaskTree);
			}
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

	private async checkUrlReachable(url: string, options?: { readonly isRetry?: boolean }): Promise<void> {
		if (this.lifecycleService.phase < LifecyclePhase.Restored) {
			// Startup does no probe network work; `reachabilityUrl` dedupes queued repeats.
			await this.lifecycleService.when(LifecyclePhase.Restored);
		}
		if (!options?.isRetry) {
			// Fresh probe from a user action or dev-server state change — restart backoff.
			this.surfacePreviewProbeFailures = 0;
		}
		this.reachabilityUrl = url;
		const selectedSurface = this.getSelectedSurface();
		const isSelectedSurfaceUrl = selectedSurface?.localUrl === url;
		// Delegate to the dev server service so we share one authoritative probe implementation
		// (which can optionally probe nearby ports). For surface tabs, require exact localUrl;
		// after repeated misses the nearby-port fan-out stops (see devServerProbePolicy).
		const reachableUrl = await this.devServerService.findRunningDevServerUrl(url, { allowNearbyPorts: !isSelectedSurfaceUrl && shouldProbeNearbyPorts(this.surfacePreviewProbeFailures) });
		const reachable = reachableUrl !== undefined;
		if (this.reachabilityUrl !== url) {
			return;
		}
		if (reachable) {
			this.surfacePreviewProbeFailures = 0;
			this.setAppReachable(true);
			const surface = this.getSelectedSurface();
			if (surface?.localUrl === url) {
				this.setSurfaceEmptyState(undefined);
				if (reachableUrl && !this.embeddedUiShowsSurfacePreview(reachableUrl)) {
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
			if (surface?.localUrl === url && this.isPreviewSectionSelected()) {
				this.setSurfaceServerDownState(surface, url);
			}
		}
		if (this.getSelectedSurface()?.localUrl === url) {
			// Keep probing while this surface stays selected — the auto-started dev command can
			// take a while to boot, and the dev server service does not track servers it did not
			// start itself, so a state-change event is not guaranteed to arrive.
			this.surfacePreviewRetryScheduler.schedule(nextProbeDelay(++this.surfacePreviewProbeFailures));
		}
	}

	private urlsShareOrigin(a: string, b: string): boolean {
		try {
			return new URL(a).origin === new URL(b).origin;
		} catch {
			return false;
		}
	}

	private retrySelectedSurfacePreview(): void {
		const surface = this.getSelectedSurface();
		if (!surface?.localUrl || this.appReachable) {
			return;
		}
		void this.checkUrlReachable(surface.localUrl, { isRetry: true });
	}

	private pushUiRuntimeLog(line: string): void {
		this.uiRuntimeLogs.push(line);
		if (this.uiRuntimeLogs.length > 50) {
			this.uiRuntimeLogs.splice(0, this.uiRuntimeLogs.length - 50);
		}
		// Start App setup panel may be hidden during surface planning — still keep the ring.
		if (!this.uiSetup.classList.contains('custom-mode-setup-hidden')) {
			this.uiRuntimeText.textContent = this.uiRuntimeLogs.slice(-20).join('\n');
		}
		// Mirror into the renderer log so agents can tail window1/renderer.log / code.sh CONSOLE.
		const tagged = `[modeShell] ${line}`;
		if (/failed|error|bad /i.test(line)) {
			this.logService.error(tagged);
		} else {
			this.logService.info(tagged);
		}
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

	/** True when the webview is on the surface preview origin (any path — SPA routes OK). */
	private embeddedUiShowsSurfacePreview(targetUrl: string): boolean {
		const current = this.getEmbeddedUiUrl();
		if (!current || current === 'about:blank' || current.startsWith('chrome-error://')) {
			return false;
		}
		return this.urlsShareOrigin(current, targetUrl);
	}

	private setEmbeddedUiUrl(url: string): void {
		// Re-assigning the same src aborts Electron <webview> loads (ERR_ABORTED).
		if (this.embeddedUiShowsUrl(url)) {
			return;
		}
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

// BlockRestore, not BlockStartup: the shell must mount before first paint (its
// `custom-mode-shell-enabled` class hides vanilla workbench chrome), but nothing in it
// needs to run before `Starting`-phase services and layout are unblocked.
registerWorkbenchContribution2(ModeShellContribution.ID, ModeShellContribution, WorkbenchPhase.BlockRestore);

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

registerAction2(class ViewSurfaceTabAction extends Action2 {
	constructor() {
		super({
			id: 'custom.modeShell.viewSurface',
			title: { value: localize('customMode.viewSurface', 'Custom: View Surface Tab'), original: 'Custom: View Surface Tab' },
			f1: false,
		});
	}
	override async run(accessor: ServicesAccessor, surfaceId?: string): Promise<void> {
		if (typeof surfaceId !== 'string' || !surfaceId.trim()) {
			return;
		}
		const instance = ModeShellContribution.getActiveInstance();
		if (!instance?.viewSurfaceTab(surfaceId.trim())) {
			accessor.get(INotificationService).notify({
				severity: Severity.Warning,
				message: localize('customMode.viewSurface.missing', 'Could not find surface "{0}" in workspace.goal.json.', surfaceId),
			});
		}
	}
});

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

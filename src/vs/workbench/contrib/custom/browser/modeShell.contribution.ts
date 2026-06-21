/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, type IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { isWeb, isWindows } from '../../../../base/common/platform.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { basename, isEqualOrParent, resolvePath } from '../../../../base/common/resources.js';
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
import { StartupGuidePanel } from './startupGuidePanel.js';

const STORAGE_PROCESS_CHAT_DISMISSED = 'modeShell.processChatDismissed';
const STORAGE_UI_CHAT_DISMISSED = 'modeShell.uiChatDismissed';

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

	private static readonly MODES: readonly Mode[] = ['UI', 'Process', 'Code'];

	private readonly container: HTMLElement;
	private readonly topModeButtons = new Map<Mode, HTMLButtonElement>();
	private readonly modeTopBar: HTMLElement;
	private readonly modeSurface: HTMLElement;
	private readonly uiContainer: HTMLElement;
	private readonly processContainer: HTMLElement;
	private readonly processMainColumn: HTMLElement;
	private readonly processMainContent: HTMLElement;
	private readonly processChatColumn: HTMLElement;
	private readonly processChatReopenBtn: HTMLButtonElement;
	private readonly uiMainColumn: HTMLElement;
	private readonly uiChatColumn: HTMLElement;
	private readonly uiChatReopenBtn: HTMLButtonElement;
	private readonly styleSheet = createStyleSheet();
	private readonly uiBrowser: HTMLElement & { src: string };
	private readonly uiBrowserShell: HTMLElement;
	private readonly uiCallout: HTMLElement;
	private readonly processCallout: HTMLElement;
	private readonly processStartHints: HTMLElement;
	private readonly uiSetup: HTMLElement;
	private readonly processSetup: HTMLElement;
	private readonly uiSelectionPill: HTMLElement;
	private readonly uiSelectionCountEl: HTMLElement;
	private readonly uiSelectionClearBtn: HTMLButtonElement;
	private uiSelectionCount = 0;
	private readonly uiStartAppButton: HTMLButtonElement;
	private readonly uiStartSubtitle: HTMLElement;
	private readonly uiStartStatus: HTMLElement;
	private readonly uiRuntimeText: HTMLElement;
	private lastUiStartHints: DevServerSuggestedCommands | undefined;
	private autoStartAppAttempted = false;
	private readonly uiRuntimeLogs: string[] = [];
	private readonly uiClickOverlayScript = createUiClickOverlayScript();
	private readonly startHintActionDisposables = this._register(new DisposableStore());
	private reachabilityUrl: string | undefined;
	private appReachable = false;
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
	private readonly startupGuideButton: HTMLButtonElement;
	private readonly startupGuidePanel: StartupGuidePanel;

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
	) {
		super();

		this._processChatDismissed = this.storageService.get(STORAGE_PROCESS_CHAT_DISMISSED, StorageScope.PROFILE) === '1';
		this._uiChatDismissed = this.storageService.get(STORAGE_UI_CHAT_DISMISSED, StorageScope.PROFILE) === '1';

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
				justify-content: center;
				gap: 6px;
				padding: 0 12px;
				box-sizing: border-box;
				border-bottom: 1px solid var(--vscode-panel-border);
				background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
				-webkit-app-region: no-drag;
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
				align-items: center;
				gap: 10px;
				padding: 18px 18px 16px;
				border-radius: 10px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
				max-width: min(520px, calc(100% - 48px));
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-callout-title {
				font-size: 13px;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-callout-subtitle {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				text-align: center;
				line-height: 1.4;
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

			/* When the dev server is up (or network probe succeeded), hide Start App / runtime panel over the preview. */
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

			.monaco-workbench .custom-mode-startup-guide-btn {
				min-width: 34px;
				padding: 0 8px;
				font-size: 14px;
				line-height: 1;
			}

			.monaco-workbench .custom-mode-startup-guide-btn-attention {
				box-shadow: inset 0 0 0 1px var(--vscode-inputValidation-warningBorder);
			}

			.monaco-workbench .custom-mode-startup-guide-overlay {
				position: fixed;
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

			.monaco-workbench.custom-mode-shell-hasProject:not(.custom-mode-app-reachable) .custom-mode-setup {
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

		this.startupGuidePanel = this._register(new StartupGuidePanel(this.container, this.startupGuideService));
		this.startupGuideButton = $('button.custom-mode-top-tab.custom-mode-startup-guide-btn', {
			type: 'button',
			title: localize('startupGuide.open', 'Startup setup'),
			'aria-label': localize('startupGuide.open', 'Startup setup'),
		}, '\u2699') as HTMLButtonElement;
		const processTab = this.topModeButtons.get('Process');
		if (processTab) {
			this.modeTopBar.insertBefore(this.startupGuideButton, processTab);
		} else {
			this.modeTopBar.appendChild(this.startupGuideButton);
		}
		this._register(addDisposableListener(this.startupGuideButton, 'click', () => {
			this.startupGuidePanel.toggle();
			if (this.modeService.getMode() !== 'Process') {
				this.modeService.setMode('Process');
			}
		}));
		this._register(this.startupGuideService.onDidChangeState(() => this.startupGuidePanel.updateBadge(this.startupGuideButton)));
		this.startupGuidePanel.updateBadge(this.startupGuideButton);
		this._register(toDisposable(() => this.modeTopBar.remove()));
		queueMicrotask(() => this.layoutService.layout());

		this.modeSurface = $('div.custom-mode-surface');

		this.uiContainer = $('div.custom-mode-ui-container');
		if (this._uiChatDismissed) {
			this.uiContainer.classList.add('custom-mode-ui-chat-dismissed');
		}
		this.uiMainColumn = $('div.custom-mode-ui-main');
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
		this.uiRuntimeText = $('pre.custom-mode-start-app-runtime');
		const uiStartBar = $('div.custom-mode-ui-start-bar', undefined,
			this.uiStartAppButton,
			this.uiStartSubtitle,
			this.uiStartStatus,
			this.uiRuntimeText
		);
		this.uiSetup.appendChild(uiStartBar);
		this.uiCallout = this.createDefaultProjectCallout(localize('customMode.uiCalloutTitle', 'No project open'), localize('customMode.uiCalloutSubtitle', 'Create and open the default project to start coding.'), () => this.defaultProjectService.createAndOpenDefaultProject());
		const initialUrl = this.devServerService.getActiveUrl() ?? 'http://localhost:3000';
		// Use iframe on web and Electron webview on desktop.
		// Many dev servers (e.g. Next) send headers that block framing (X-Frame-Options / CSP frame-ancestors),
		// which would make an iframe appear blank even though the server is running.
		this.uiBrowser = isWeb
			? $('iframe.custom-mode-ui-frame', {
				src: initialUrl,
				title: localize('customMode.uiFrameTitle', 'UI Mode'),
				allow: 'clipboard-read; clipboard-write'
			}) as unknown as HTMLElement & { src: string }
			: $('webview.custom-mode-ui-webview', {
				src: initialUrl,
				allowpopups: 'true'
			}) as unknown as HTMLElement & { src: string };

		this.uiBrowserShell = $('div.custom-mode-ui-browser-shell');
		this.uiBrowserShell.appendChild(this.uiBrowser);

		this.uiMainColumn.appendChild(this.uiCallout);
		this.uiMainColumn.appendChild(this.uiSetup);
		this.uiMainColumn.appendChild(this.uiBrowserShell);
		this.uiContainer.appendChild(this.uiMainColumn);

		this.uiChatContainer = $('div.custom-mode-embedded-chat.custom-mode-ui-side-chat');
		const uiChatTitle = localize('customMode.uiChatTitle', 'AI chat');
		const uiChatCloseLabel = localize('customMode.uiChatClose', 'Close');
		const uiCloseBtn = $('button', { type: 'button', 'aria-label': uiChatCloseLabel, title: uiChatCloseLabel }, '\u2715') as HTMLButtonElement;
		const uiChatHeader = $('div.custom-mode-ui-chat-header', undefined,
			$('span', undefined, uiChatTitle),
			uiCloseBtn
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

		// Show the selection chip + Clear button in the top mode bar, right before the "UI" tab.
		// Order in DOM: [Clear] [N Selected] [UI tab].
		const uiTab = this.topModeButtons.get('UI');
		if (uiTab) {
			this.modeTopBar.insertBefore(this.uiSelectionPill, uiTab);
			this.modeTopBar.insertBefore(this.uiSelectionClearBtn, this.uiSelectionPill);
			this._register(toDisposable(() => {
				this.uiSelectionPill.remove();
				this.uiSelectionClearBtn.remove();
			}));
		}
		this._register(addDisposableListener(this.uiSelectionClearBtn, 'click', () => this.clearUiSelection()));

		this.processContainer = $('div.custom-mode-process-container');
		if (this._processChatDismissed) {
			this.processContainer.classList.add('custom-mode-process-chat-dismissed');
		}
		this.processMainColumn = $('div.custom-mode-process-main');
		this.processCallout = this.createDefaultProjectCallout(localize('customMode.processCalloutTitle', 'No project open'), localize('customMode.processCalloutSubtitle', 'Create and open the default project to start coding.'), () => this.defaultProjectService.createAndOpenDefaultProject());
		this.processStartHints = $('div.custom-mode-start-hints');
		this.processSetup = $('div.custom-mode-setup');
		const processSetupDetails = document.createElement('details');
		const processSetupSummary = document.createElement('summary');
		processSetupSummary.textContent = localize('customMode.setupSummary', 'Setup — open Startup setup (gear icon before Process) for the full checklist.');
		processSetupDetails.appendChild(processSetupSummary);
		processSetupDetails.appendChild(this.processStartHints);
		this.processSetup.appendChild(processSetupDetails);
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

		// Create embedded chat widgets for UI/Process.
		this.uiChatWidget = this.createEmbeddedChatWidget(this.uiChatContainer, 'customModeShellUI');
		this.processChatWidget = this.createEmbeddedChatWidget(this.processChatContainer, 'customModeShellProcess', 'how does the scrape videos process work');

		this.updateMode(this.modeService.getMode());
		this._register(this.modeService.onDidChange(mode => this.updateMode(mode)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.updateProjectState()));
		this._register(this.devServerService.onDidChangeActiveUrl(url => {
			if (url && this.uiBrowser.src !== url) {
				// IMPORTANT: Don't set both property + attribute on <webview>.
				// Doing so can cause a navigation to be canceled by a subsequent
				// navigation, which shows up as ERR_ABORTED (-3).
				if (isWeb) {
					this.uiBrowser.src = url;
				} else {
					(this.uiBrowser as unknown as HTMLElement).setAttribute('src', url);
				}
			}
		}));
		this._register(this.devServerService.onDidChangeState(state => this.updateDevServerDebug(state)));
		this._register(this.ixIntegrationService.onDidChangeState(state => this.updateIxDebug(state)));
		if (!isWeb) {
			this._register(this.dockerAvailabilityService.onDidChangeStatus(() => this.updateProcessDockerBanner()));
			void this.dockerAvailabilityService.refresh().then(() => this.updateProcessDockerBanner());
		}

		this.updateProjectState();
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
			const startupAutoRunScheduler = this._register(new RunOnceScheduler(() => {
				void this.startupGuideService.refresh().then(async () => {
					this.startupGuidePanel.updateBadge(this.startupGuideButton);
					if (!this.startupGuideService.shouldShowOnStartup()) {
						return;
					}
					this.modeService.setMode('Process');
					this.startupGuidePanel.show();
					if (Boolean(this.configurationService.getValue<boolean>('custom.startupGuide.autoRun') ?? true)) {
						await this.startupGuideService.runAutomaticFixes();
					}
				});
			}, 2500));
			startupAutoRunScheduler.schedule();
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
			await this.ensureEmbeddedChatModel('UI');
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
		const inUi = this.modeService.getMode() === 'UI';
		const showUiChat = inUi && !dismissed;
		this.uiChatContainer.classList.toggle('visible', showUiChat);
		this.uiChatWidget.setVisible(showUiChat);
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
			await this.ensureEmbeddedChatModel('UI');
		} else if (showProcess) {
			await this.ensureEmbeddedChatModel('Process');
		}

		this.uiChatWidget.setVisible(uiChatOpen);
		this.processChatWidget.setVisible(processChatOpen);
	}

	private async ensureEmbeddedChatModel(mode: 'UI' | 'Process'): Promise<void> {
		const resource = this.chatSessionManager.getOrCreateSessionResource(mode);
		const token = this.chatSessionsCts.token;
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

	private updateProjectState(): void {
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		this.container.classList.toggle('custom-mode-shell-hasProject', hasProject);
		this.refreshStartCommandHints();
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

		if (!hasProject) {
			this.uiStartSubtitle.textContent = '';
			this.updateStartAppControl();
			return;
		}

		if (!hints) {
			this.uiStartSubtitle.textContent = localize('customMode.startAppNoPackageJson', 'Open a folder whose root contains package.json to start the app.');
			this.updateStartAppControl();
			return;
		}

		if (!hints.primaryRunCommand) {
			this.uiStartSubtitle.textContent = localize('customMode.startAppNoDevScript', 'Add a "dev", "start", or "web" script to package.json, then click Start App.');
			this.updateStartAppControl();
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
	}

	private updateStartAppControl(): void {
		const state = this.devServerService.getState();
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const hints = this.lastUiStartHints;
		const canStart = hasProject && Boolean(hints?.primaryRunCommand);
		const busy = state.phase === 'installing' || state.phase === 'starting';
		this.uiStartAppButton.disabled = !canStart || busy;
	}

	private async onStartAppClicked(): Promise<void> {
		try {
			const url = await this.devServerService.ensureRunning();
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

	private maybeAutoStartApp(): void {
		if (this.autoStartAppAttempted) {
			return;
		}

		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const hints = this.lastUiStartHints;
		if (!hasProject || !hints?.primaryRunCommand) {
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

		// When the dev server transitions from unreachable to reachable, the embedded UI is
		// almost certainly showing an ERR_CONNECTION_REFUSED page from the initial load attempt
		// (we set the iframe src early, before the server is actually serving). Force a reload
		// so the user sees the running app without manually refreshing.
		if (reachable && !wasReachable) {
			this.reloadEmbeddedUi();
		}
	}

	private reloadEmbeddedUi(): void {
		const url = this.devServerService.getActiveUrl();
		if (!url) {
			return;
		}

		if (!isWeb && this.isWebviewElement(this.uiBrowser)) {
			// Electron <webview> exposes `reload()`. This avoids the ERR_ABORTED-from-double-navigation
			// pitfall we'd hit by toggling `src` rapidly.
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

		// Cross-platform fallback: blank the frame, then re-set the URL on the next tick so the
		// browser/webview treats it as a fresh navigation (assigning the same src is a no-op).
		const setSrc = (value: string) => {
			if (isWeb) {
				this.uiBrowser.src = value;
			} else {
				(this.uiBrowser as unknown as HTMLElement).setAttribute('src', value);
			}
		};
		setSrc('about:blank');
		mainWindow.setTimeout(() => setSrc(url), 0);
	}

	private async checkUrlReachable(url: string): Promise<void> {
		this.reachabilityUrl = url;
		// Delegate to the dev server service so we share one authoritative probe implementation
		// (which also tries `port+1`/`port+2` for frameworks that bump when the primary is busy).
		const reachable = (await this.devServerService.findRunningDevServerUrl(url)) !== undefined;
		if (this.reachabilityUrl !== url) {
			return;
		}
		if (reachable) {
			this.setAppReachable(true);
			return;
		}
		// Don't clear when the dev server already reported running (avoids spurious false
		// negatives from a transiently stalled probe).
		if (this.devServerService.getState().phase !== 'running') {
			this.setAppReachable(false);
		}
	}

	private pushUiRuntimeLog(line: string): void {
		this.uiRuntimeLogs.push(line);
		if (this.uiRuntimeLogs.length > 50) {
			this.uiRuntimeLogs.splice(0, this.uiRuntimeLogs.length - 50);
		}
		this.uiRuntimeText.textContent = this.uiRuntimeLogs.slice(-20).join('\n');
	}

	private isWebviewElement(el: HTMLElement): boolean {
		return el.tagName.toLowerCase() === 'webview';
	}

	private createDefaultProjectCallout(title: string, subtitle: string, run: () => void): HTMLElement {
		const button = $('button.custom-mode-callout-button', { type: 'button' }, localize('customMode.createDefaultProject', 'Create Default Project')) as HTMLButtonElement;
		this._register(addDisposableListener(button, 'click', () => run()));

		return $('div.custom-mode-callout', undefined,
			$('div.custom-mode-callout-title', undefined, title),
			$('div.custom-mode-callout-subtitle', undefined, subtitle),
			button
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
			title: { value: localize('customMode.chat.resetModeChats', 'Custom: Reset Mode Chats (UI/Process/Code)'), original: 'Custom: Reset Mode Chats (UI/Process/Code)' },
			f1: true,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		const modeService = accessor.get(IModeService);
		const notificationService = accessor.get(INotificationService);
		await withModeShellChatManager(accessor, async mgr => {
			mgr.resetSessions();
			notificationService.notify({
				severity: Severity.Info,
				message: localize('customMode.chat.resetModeChats.done', 'Reset Mode Shell chat sessions.'),
			});
			await mgr.openSessionForMode(modeService.getMode());
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

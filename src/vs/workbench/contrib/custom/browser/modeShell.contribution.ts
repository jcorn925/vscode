/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, type IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
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
import { IWebviewService } from '../../webview/browser/webview.js';
import { ProcessNotesCytoscapeView, type ProcessNotesGraphWebviewMessage } from './processNotesCytoscapeView.js';
import type { ProcessNoteGraph, ProcessNoteId, ProcessNotesFile } from './processNotesTypes.js';
import type { ProcessNoteSuggestion, ProcessTopicsFile } from './processNotesTypes.js';
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
import { selectProcessCandidatesFromIxMap } from './processNotesSynthesis.js';
import { applyProbeResults, computeProcessSuggestionsFromIxDiscovery } from './processNotesSuggestions.js';
import { resolveIxEvidenceWorkspaceFolderUri } from './processNotesIxFolder.js';

/** Every `ix` subcommand from https://ix-infra.com/docs/commands/ (grouped like the docs). */
const IX_DOCS_COMMANDS_URL = 'https://ix-infra.com/docs/commands/';

const STORAGE_PROCESS_CHAT_DISMISSED = 'modeShell.processChatDismissed';
const STORAGE_UI_CHAT_DISMISSED = 'modeShell.uiChatDismissed';
const STORAGE_PROCESS_NOTES_SUGGESTIONS_CACHE = 'modeShell.processNotesSuggestionsCache';

function getIxCliCommandReferenceText(): string {
	const L = (key: string, def: string) => localize(key, def);
	const sections: Array<{ title: string; commands: readonly string[] }> = [
		{
			title: L('customMode.ixCmdSectionSetup', 'Setup'),
			commands: ['ix map', 'ix status', 'ix watch', 'ix docker', 'ix upgrade']
		},
		{
			title: L('customMode.ixCmdSectionFind', 'Find'),
			commands: ['ix search', 'ix locate', 'ix inventory', 'ix text']
		},
		{
			title: L('customMode.ixCmdSectionUnderstand', 'Understand'),
			commands: ['ix explain', 'ix overview', 'ix read']
		},
		{
			title: L('customMode.ixCmdSectionAnalyze', 'Analyze'),
			commands: ['ix impact', 'ix rank', 'ix smells', 'ix subsystems']
		},
		{
			title: L('customMode.ixCmdSectionNavigate', 'Navigate'),
			commands: ['ix callers', 'ix callees', 'ix contains', 'ix imports', 'ix imported-by', 'ix depends', 'ix trace']
		},
		{
			title: L('customMode.ixCmdSectionHistory', 'History'),
			commands: ['ix entity', 'ix history', 'ix diff', 'ix conflicts', 'ix stats']
		},
		{
			title: L('customMode.ixCmdSectionOps', 'Ops'),
			commands: ['ix reset', 'ix config']
		},
	];
	const lines: string[] = [];
	for (const { title, commands } of sections) {
		lines.push(`— ${title} —`);
		lines.push(...commands);
		lines.push('');
	}
	return lines.join('\n').trimEnd();
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
	private readonly uiUrlPill: HTMLElement;
	private readonly uiStartAppButton: HTMLButtonElement;
	private readonly uiStartSubtitle: HTMLElement;
	private readonly uiStartStatus: HTMLElement;
	private readonly uiRuntimeText: HTMLElement;
	private lastUiStartHints: DevServerSuggestedCommands | undefined;
	private autoStartAppAttempted = false;
	private readonly uiRuntimeLogs: string[] = [];
	private readonly uiClickOverlayScript = createUiClickOverlayScript();
	private readonly startHintActionDisposables = this._register(new DisposableStore());
	private reachabilityAbort: AbortController | undefined;
	private reachabilityUrl: string | undefined;
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
	private readonly processNotesPanel: HTMLElement;
	private readonly processNotesGraphAnchor: HTMLElement;
	private readonly processNotesGraphView: ProcessNotesCytoscapeView;
	private readonly processNotesStore: ProcessNotesStore;
	private readonly processNotesTopicSelect: HTMLSelectElement;
	private readonly processNotesPromptInput: HTMLInputElement;
	private readonly processNotesGenerateButton: HTMLButtonElement;
	private readonly processNotesBackButton: HTMLButtonElement;
	private readonly processNotesDeleteButton: HTMLButtonElement;
	private readonly processNotesTypeahead: HTMLElement;
	private readonly processNotesOutputTab: HTMLButtonElement;
	private readonly processNotesLogsTab: HTMLButtonElement;
	private processNotesDetailTab: 'output' | 'logs' = 'output';
	private readonly processNotesLogs: HTMLElement;
	private readonly processNotesMarkdown: HTMLElement;
	private readonly processNotesCards: HTMLElement;
	private processNotesSuggestions: readonly ProcessNoteSuggestion[] = [];
	private processNotesGraphLayer: 'overview' | 'detail' = 'overview';
	private processNotesMergedTopicIds: ProcessNoteId[] = mergeProcessNoteTopicIds(undefined);
	private processNotesCachedFile: ProcessNotesFile | undefined;
	private readonly processIxDebugText: HTMLElement;
	private readonly processIxCommandsButton: HTMLButtonElement;
	private readonly processIxLogsButton: HTMLButtonElement;
	private readonly processIxCommandsPopover: HTMLElement;
	private readonly processIxLogsPopover: HTMLElement;
	private readonly processIxPipeline: HTMLElement;
	private readonly processIxPipelineGlobalRow: HTMLElement;
	private readonly processIxPipelineWorkspaceRows: HTMLElement;
	private readonly ixPipelineOpenOutput = new Set<string>();
	private lastIxPipelineState: IxIntegrationState | undefined;
	private readonly ixPipelineDurationTicker = this._register(new MutableDisposable<IDisposable>());

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
	) {
		super();

		this._processChatDismissed = this.storageService.get(STORAGE_PROCESS_CHAT_DISMISSED, StorageScope.PROFILE) === '1';
		this._uiChatDismissed = this.storageService.get(STORAGE_UI_CHAT_DISMISSED, StorageScope.PROFILE) === '1';

		this.chatSessionManager = new ModeShellChatSessionManager(this.chatService, this.chatWidgetService, this.storageService);
		this.processNotesStore = this._register(new ProcessNotesStore(this.fileService, this.workspaceContextService, this.configurationService));
		void this.loadProcessNotesSuggestions();

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
				z-index: 2600;
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
			}

			.monaco-workbench .custom-mode-ui-chat-column .custom-mode-ui-side-chat.visible .interactive-list {
				flex: 1 1 auto !important;
				min-height: 0 !important;
				max-height: none !important;
				overflow: auto !important;
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

			.monaco-workbench .custom-mode-embedded-chat .chat-input-container {
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
			}

			.monaco-workbench .custom-mode-process-ix-popover.visible {
				display: block;
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

			.monaco-workbench .custom-mode-process-notes-header {
				position: relative;
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-process-notes-header span {
				font-size: 12px;
				font-weight: 700;
				color: var(--vscode-foreground);
				margin-right: 6px;
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

			.monaco-workbench .custom-mode-process-notes-prompt {
				flex: 1 1 160px;
				min-width: 120px;
				height: 26px;
				padding: 0 8px;
				border-radius: 6px;
				border: 1px solid var(--vscode-input-border, transparent);
				background-color: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-size: 12px;
				box-sizing: border-box;
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
				margin-left: auto;
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

			.monaco-workbench .custom-mode-process-notes-detail-tabs {
				display: flex;
				gap: 6px;
				align-items: center;
				padding: 2px 0;
			}

			.monaco-workbench .custom-mode-process-notes-detail-tab {
				height: 22px;
				padding: 0 10px;
				border-radius: 999px;
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
				background: transparent;
				color: var(--vscode-descriptionForeground);
				cursor: pointer;
				font-size: 11px;
				font-weight: 600;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench .custom-mode-process-notes-detail-tab.active {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
				border-color: var(--vscode-focusBorder);
			}

			.monaco-workbench .custom-mode-process-notes-cards {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
				gap: 8px;
				min-height: 120px;
			}

			.monaco-workbench .custom-mode-process-notes-cards.hidden,
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

			.monaco-workbench .custom-mode-process-notes-card-title {
				font-size: 13px;
				font-weight: 700;
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

			.monaco-workbench .custom-mode-process-notes-typeahead {
				position: absolute;
				top: calc(100% + 6px);
				left: 0;
				right: 0;
				z-index: 2500;
				background: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				border-radius: 8px;
				box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
				max-height: min(240px, 35vh);
				overflow: auto;
				display: none;
			}

			.monaco-workbench .custom-mode-process-notes-typeahead.visible {
				display: block;
			}

			.monaco-workbench .custom-mode-process-notes-typeahead-item {
				padding: 8px 10px;
				cursor: pointer;
				display: flex;
				flex-direction: column;
				gap: 2px;
			}

			.monaco-workbench .custom-mode-process-notes-typeahead-item:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.monaco-workbench .custom-mode-process-notes-typeahead-title {
				font-size: 12px;
				font-weight: 700;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-process-notes-typeahead-meta {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
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

			.monaco-workbench .custom-mode-ui-urlPill {
				/* Inline chip in the top mode bar (inserted before the UI tab). */
				display: none;
				max-width: min(420px, calc(100% - 24px));
				height: 22px;
				padding: 0 10px;
				border-radius: 999px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 22px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				user-select: text;
				-webkit-user-select: text;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench.custom-mode-shell-hasProject .custom-mode-ui-urlPill.has-url {
				display: block;
			}

			.monaco-workbench .custom-mode-ui-urlPill strong {
				color: var(--vscode-foreground);
				font-weight: 700;
				margin-right: 6px;
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
				content: '▸';
				display: inline-block;
				margin-right: 8px;
				color: var(--vscode-descriptionForeground);
				transform: translateY(-0.5px);
			}

			.monaco-workbench .custom-mode-setup details[open] summary::before {
				content: '▾';
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
		this._register(toDisposable(() => this.modeTopBar.remove()));
		queueMicrotask(() => this.layoutService.layout());

		this.modeSurface = $('div.custom-mode-surface');

		this.uiContainer = $('div.custom-mode-ui-container');
		if (this._uiChatDismissed) {
			this.uiContainer.classList.add('custom-mode-ui-chat-dismissed');
		}
		this.uiMainColumn = $('div.custom-mode-ui-main');
		this.uiSetup = $('div.custom-mode-setup');
		this.uiUrlPill = $('div.custom-mode-ui-urlPill');
		this.uiUrlPill.appendChild($('strong', undefined, localize('customMode.urlLabel', 'URL')));
		this.uiUrlPill.appendChild($('span', undefined, ''));
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

		// Show the active URL in the top mode bar, right before the "UI" tab.
		const uiTab = this.topModeButtons.get('UI');
		if (uiTab) {
			this.modeTopBar.insertBefore(this.uiUrlPill, uiTab);
			this._register(toDisposable(() => this.uiUrlPill.remove()));
		}

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
		processSetupSummary.textContent = localize('customMode.setupSummary', 'Setup');
		processSetupDetails.appendChild(processSetupSummary);
		processSetupDetails.appendChild(this.processStartHints);
		this.processSetup.appendChild(processSetupDetails);
		this.processIxWebHint = $('div.custom-mode-ix-webhint', undefined,
			localize('customMode.ixWebHint', 'Ix CLI automation (install, Docker, map, watch) runs only in the desktop application, not in the browser.'));

		this.processIxPipeline = $('div.custom-mode-ix-pipeline');
		this.processIxPipelineGlobalRow = $('div.custom-mode-ix-pipeline-global-row');
		this.processIxPipelineWorkspaceRows = $('div.custom-mode-ix-pipeline-workspace-rows');
		this.processIxPipeline.appendChild(this.processIxPipelineGlobalRow);
		this.processIxPipeline.appendChild(this.processIxPipelineWorkspaceRows);

		// Ix buttons + popovers (shown next to the topic picker).
		this.processIxCommandsButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('customMode.processIxCommandsBtn', 'Ix commands')) as HTMLButtonElement;
		this.processIxLogsButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('customMode.processIxLogsBtn', 'Ix process')) as HTMLButtonElement;

		const ixCommandsDocsLink2 = document.createElement('a');
		ixCommandsDocsLink2.href = IX_DOCS_COMMANDS_URL;
		ixCommandsDocsLink2.target = '_blank';
		ixCommandsDocsLink2.rel = 'noopener noreferrer';
		ixCommandsDocsLink2.textContent = localize('customMode.ixCommandsDocsLink', 'ix-infra.com/docs/commands');

		this.processIxCommandsPopover = $('div.custom-mode-process-ix-popover', undefined,
			$('div.custom-mode-process-ix-popover-title', undefined,
				localize('customMode.ixCommandsTitle', 'Ix CLI commands'),
				ixCommandsDocsLink2
			),
			$('pre', undefined, getIxCliCommandReferenceText())
		);

		// Shared Ix log content element (used inside the popover).
		this.processIxDebugText = $('div');
		this.processIxLogsPopover = $('div.custom-mode-process-ix-popover', undefined,
			$('div.custom-mode-process-ix-popover-title', undefined,
				localize('customMode.ixDebugTitle', 'Ix')
			),
			this.processIxDebugText
		);

		// Process notes (generated via Ix + AI) with an interactive Cytoscape graph canvas.
		this.processNotesTopicSelect = $('select.custom-mode-process-notes-topic') as HTMLSelectElement;
		// Topic selection is driven by the card grid; keep the select offscreen as an internal state holder.
		this.processNotesTopicSelect.style.display = 'none';
		this.rebuildProcessNotesTopicSelectOptions(undefined);
		const backToTopicsLabel = localize('customMode.processNotes.backToTopics', 'Back to topics');
		this.processNotesBackButton = $('button.custom-mode-process-notes-back.hidden', {
			type: 'button',
			'aria-label': backToTopicsLabel,
			title: backToTopicsLabel,
		}, localize('customMode.processNotes.backToTopicsShort', 'Topics')) as HTMLButtonElement;
		this.processNotesPromptInput = $('input.custom-mode-process-notes-prompt', {
			type: 'text',
			placeholder: localize('customMode.processNotes.promptPlaceholder', 'Ask about a process in this workspace…'),
			'aria-label': localize('customMode.processNotes.promptAria', 'Question about a process in the open workspace'),
		}) as HTMLInputElement;
		this.processNotesTypeahead = $('div.custom-mode-process-notes-typeahead');
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
		this.processNotesOutputTab = $('button.custom-mode-process-notes-detail-tab', { type: 'button' }, localize('customMode.processNotes.tab.output', 'Output')) as HTMLButtonElement;
		this.processNotesLogsTab = $('button.custom-mode-process-notes-detail-tab', { type: 'button' }, localize('customMode.processNotes.tab.logs', 'Logs')) as HTMLButtonElement;
		const tabsRow = $('div.custom-mode-process-notes-detail-tabs', undefined, this.processNotesOutputTab, this.processNotesLogsTab);
		this.processNotesCards = $('div.custom-mode-process-notes-cards');
		this.processNotesLogs = $('pre.custom-mode-process-notes-logs');
		this.processNotesMarkdown = $('div.custom-mode-process-notes-markdown');
		this.processNotesGraphAnchor = $('div.custom-mode-process-notes-graph');
		this.processNotesPanel = $('div.custom-mode-process-notes', undefined,
			$('div.custom-mode-process-notes-header', undefined,
				$('span', undefined, localize('customMode.processNotesTitle', 'Process notes')),
				this.processNotesBackButton,
				this.processNotesPromptInput,
				this.processNotesGenerateButton,
				this.processNotesDeleteButton,
				this.processNotesTypeahead,
			),
			this.processNotesCards,
			tabsRow,
			this.processNotesLogs,
			this.processNotesMarkdown,
			this.processNotesGraphAnchor
		);

		const appRoot = this.nativeEnvironmentService.appRoot
			? URI.file(this.nativeEnvironmentService.appRoot)
			: URI.file(process.cwd());
		const cytoscapeRoot = URI.joinPath(appRoot, 'node_modules', 'cytoscape', 'dist');
		const coseBaseRoot = URI.joinPath(appRoot, 'node_modules', 'cose-base');
		const fcoseRoot = URI.joinPath(appRoot, 'node_modules', 'cytoscape-fcose');
		this.processNotesGraphView = this._register(new ProcessNotesCytoscapeView(
			this.webviewService,
			[cytoscapeRoot, coseBaseRoot, fcoseRoot],
			(msg: ProcessNotesGraphWebviewMessage) => this.onProcessNotesGraphMessage(msg),
		));

		// Attach the webview overlay to the placeholder element.
		this.processNotesGraphView.attach(this.processNotesGraphAnchor, this.processMainColumn);

		const cytoscapeUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(cytoscapeRoot, 'cytoscape.min.js'));
		const coseBaseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(coseBaseRoot, 'cose-base.js'));
		const fcoseUri = this.processNotesGraphView.asWebviewUri(URI.joinPath(fcoseRoot, 'cytoscape-fcose.js'));
		this.processNotesGraphView.setHtml(cytoscapeUri, coseBaseUri, fcoseUri);
		this.processNotesGraphView.setGraph({ nodes: [], edges: [] } satisfies ProcessNoteGraph);

		this.processMainColumn.appendChild(this.processCallout);
		this.processMainColumn.appendChild(this.processIxWebHint);
		this.processMainColumn.appendChild(this.processIxPipeline);
		this.processMainColumn.appendChild(this.processNotesPanel);
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
		this._register(addDisposableListener(this.processNotesOutputTab, 'click', () => this.setProcessNotesDetailTab('output')));
		this._register(addDisposableListener(this.processNotesLogsTab, 'click', () => this.setProcessNotesDetailTab('logs')));
		this._register(addDisposableListener(this.processNotesPromptInput, 'input', () => this.updateProcessNotesTypeahead()));
		this._register(addDisposableListener(this.processNotesPromptInput, 'focus', () => this.updateProcessNotesTypeahead()));
		this._register(addDisposableListener(this.processNotesPromptInput, 'blur', () => mainWindow.setTimeout(() => this.hideProcessNotesTypeahead(), 120)));
		// Dropdown removed from UI (selection happens via cards), but keep change handler for safety.
		this._register(addDisposableListener(this.processNotesTopicSelect, 'change', () => void this.loadSelectedProcessNote()));
		this._register(addDisposableListener(this.processNotesBackButton, 'click', () => this.showProcessNotesOverview()));
		this._register(addDisposableListener(this.processIxCommandsButton, 'click', () => {
			const show = !this.processIxCommandsPopover.classList.contains('visible');
			this.processIxCommandsPopover.classList.toggle('visible', show);
			this.processIxLogsPopover.classList.remove('visible');
		}));
		this._register(addDisposableListener(this.processIxLogsButton, 'click', () => {
			const show = !this.processIxLogsPopover.classList.contains('visible');
			this.processIxLogsPopover.classList.toggle('visible', show);
			this.processIxCommandsPopover.classList.remove('visible');
		}));
		this._register(addDisposableListener(mainWindow, 'mousedown', (e: MouseEvent) => {
			const target = e.target as Node | null;
			if (target && this.processNotesPanel.contains(target)) {
				return;
			}
			this.processIxCommandsPopover.classList.remove('visible');
			this.processIxLogsPopover.classList.remove('visible');
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
			this.updateUiUrlPill(url);
		}));
		this._register(this.devServerService.onDidChangeState(state => this.updateDevServerDebug(state)));
		this._register(this.ixIntegrationService.onDidChangeState(state => this.updateIxDebug(state)));

		this.updateProjectState();
		this.updateDevServerDebug(this.devServerService.getState());
		this.updateIxDebug(this.ixIntegrationService.getState());
		void this.loadSelectedProcessNote().then(() => this.showProcessNotesOverview());
		this.updateReachabilityFromState(this.devServerService.getState());
		this.updateUiUrlPill(this.devServerService.getActiveUrl());

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
		} else if (this.lastIxPipelineState) {
			this.refreshIxPipelineTicker(this.lastIxPipelineState);
		}

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
					renderStyle: 'compact',
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

	private appendPipelineStep(parent: HTMLElement, step: IxPipelineStepSnapshot): void {
		const wrap = $('div.custom-mode-ix-pipeline-step');
		wrap.classList.add(`status-${step.status}`);
		const head = $('div.custom-mode-ix-pipeline-step-head');
		const st = $('span.custom-mode-ix-pipeline-status', { title: step.status, 'aria-label': step.status }, this.ixPipelineStatusGlyph(step.status));
		const label = $('span.custom-mode-ix-pipeline-label', undefined, step.label);
		const dur = $('span.custom-mode-ix-pipeline-dur', undefined, this.formatStepDuration(step));
		head.appendChild(st);
		head.appendChild(label);
		head.appendChild(dur);
		wrap.appendChild(head);
		if (step.command) {
			const shown = step.command.length > 96 ? `${step.command.slice(0, 93)}\u2026` : step.command;
			wrap.appendChild($('div.custom-mode-ix-pipeline-cmd', { title: step.command }, shown));
		}
		if (step.error) {
			wrap.appendChild($('div.custom-mode-ix-pipeline-err', undefined, step.error));
		}
		const details = document.createElement('details');
		details.open = this.ixPipelineOpenOutput.has(step.id);
		this._register(addDisposableListener(details, 'toggle', () => {
			if (details.open) {
				this.ixPipelineOpenOutput.add(step.id);
			} else {
				this.ixPipelineOpenOutput.delete(step.id);
			}
		}));
		const summary = document.createElement('summary');
		summary.textContent = localize('customMode.ixPipeline.output', 'Output');
		details.appendChild(summary);
		const tail = step.outputTail.trim();
		details.appendChild($('pre.custom-mode-ix-pipeline-pre', undefined,
			tail.length > 0 ? tail : localize('customMode.ixPipeline.noOutput', '(no output yet)')));
		wrap.appendChild(details);
		parent.appendChild(wrap);
	}

	private renderIxPipeline(state: IxIntegrationState): void {
		if (isWeb) {
			this.processIxPipeline.style.display = 'none';
			return;
		}
		if (state.pipelineSteps.length === 0) {
			this.processIxPipeline.style.display = 'none';
			return;
		}
		this.processIxPipeline.style.display = '';
		this.clearPipelineContainer(this.processIxPipelineGlobalRow);
		this.clearPipelineContainer(this.processIxPipelineWorkspaceRows);

		const globals = state.pipelineSteps.filter(s => s.kind === 'global');
		const workspaces = state.pipelineSteps.filter(s => s.kind === 'workspace');

		for (const s of globals) {
			this.appendPipelineStep(this.processIxPipelineGlobalRow, s);
		}

		if (workspaces.length > 0) {
			// Workspace steps header row + Ix controls (moved here from Process Notes header).
			const controls = $('div.custom-mode-ix-pipeline-controls', undefined,
				this.processIxCommandsButton,
				this.processIxLogsButton,
				this.processIxCommandsPopover,
				this.processIxLogsPopover,
			);
			this.processIxPipelineWorkspaceRows.appendChild(
				$('div.custom-mode-ix-pipeline-workspace-head', undefined,
					$('div.custom-mode-ix-pipeline-workspace-label', undefined, localize('customMode.ixPipeline.workspaceSteps', 'Workspace steps')),
					controls,
				));
			const rowWrap = $('div.custom-mode-ix-pipeline-global-row');
			for (const s of workspaces) {
				this.appendPipelineStep(rowWrap, s);
			}
			this.processIxPipelineWorkspaceRows.appendChild(rowWrap);
		}

		this.refreshIxPipelineTicker(state);
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
					this.renderIxPipeline(this.lastIxPipelineState);
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

		const lines: string[] = [];
		lines.push(`phase: ${state.phase}`);
		lines.push(`pipelineGen: ${state.pipelineGeneration}`);
		if (state.lastCommand) {
			lines.push(`command: ${state.lastCommand}`);
		}
		if (state.lastError) {
			lines.push(`error: ${state.lastError}`);
		}
		if (state.lastOutput) {
			lines.push('');
			lines.push(state.lastOutput);
		}
		this.processIxDebugText.textContent = lines.join('\n');
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

	private getProcessTopicLabelEntries(): { id: ProcessNoteId; label: string }[] {
		return this.processNotesMergedTopicIds.map(id => ({
			id,
			label: resolveProcessTopicLabel(id, this.processNotesCachedFile, i => this.localizeProcessTopicTitle(i)),
		}));
	}

	private updateProcessNotesGraphLayerUi(): void {
		this.processNotesBackButton.classList.toggle('hidden', this.processNotesGraphLayer !== 'detail');
		this.processNotesCards.classList.toggle('hidden', this.processNotesGraphLayer !== 'overview');
		const detail = this.processNotesGraphLayer === 'detail';
		this.processNotesOutputTab.classList.toggle('hidden', !detail);
		this.processNotesLogsTab.classList.toggle('hidden', !detail);
		this.processNotesGraphAnchor.classList.toggle('hidden', !detail);
		this.processNotesLogs.classList.toggle('hidden', !detail || this.processNotesDetailTab !== 'logs');
		this.processNotesMarkdown.classList.toggle('hidden', !detail || this.processNotesDetailTab !== 'output');
		this.processNotesDeleteButton.disabled = this.processNotesGraphLayer !== 'detail';
	}

	private setProcessNotesDetailTab(tab: 'output' | 'logs'): void {
		this.processNotesDetailTab = tab;
		this.processNotesOutputTab.classList.toggle('active', tab === 'output');
		this.processNotesLogsTab.classList.toggle('active', tab === 'logs');
		this.updateProcessNotesGraphLayerUi();
	}

	private showProcessNotesOverview(): void {
		this.processNotesGraphLayer = 'overview';
		this.renderProcessNotesCards();
		this.processNotesGraphView.setGraph({ nodes: [], edges: [] });
		this.updateProcessNotesGraphLayerUi();
	}

	private renderProcessNotesCards(): void {
		this.processNotesCards.replaceChildren();
		if (this.processNotesSuggestions.length) {
			this.processNotesCards.appendChild($('div.custom-mode-process-notes-section-title', undefined, localize('customMode.processNotes.suggestedTitle', 'Suggested processes')));
			for (const s of this.processNotesSuggestions.slice(0, 12)) {
				const summary = s.probe
					? localize('customMode.processNotes.suggestion.probe', '{0} targets', String(s.probe.resolvedTargets))
					: localize('customMode.processNotes.suggestion.kind', String(s.kind));
				const card = $('button.custom-mode-process-notes-card', { type: 'button' },
					$('div.custom-mode-process-notes-card-title', undefined, s.label),
					$('div.custom-mode-process-notes-card-summary', undefined, s.promptTemplates[0] ?? ''),
					$('div.custom-mode-process-notes-card-meta', undefined, summary),
					$('div.custom-mode-process-notes-card-chips', undefined,
						...(s.signals?.slice(0, 3).map(sig => $('span.custom-mode-process-notes-card-chip', undefined, sig)) ?? [])
					),
				) as HTMLButtonElement;
				card.title = s.label;
				this._register(addDisposableListener(card, 'click', () => {
					this.processNotesPromptInput.value = s.promptTemplates[0] ?? `How does ${s.label} work?`;
					this.hideProcessNotesTypeahead();
					this.processNotesPromptInput.focus();
				}));
				this.processNotesCards.appendChild(card);
			}
			this.processNotesCards.appendChild($('div.custom-mode-process-notes-section-title', undefined, localize('customMode.processNotes.savedTitle', 'Saved notes')));	
		}
		for (const entry of this.getProcessTopicLabelEntries()) {
			const note = this.processNotesCachedFile?.notes.find(n => n.id === entry.id);
			const generated = note?.meta.generatedAt ? new Date(note.meta.generatedAt).toLocaleString() : localize('customMode.processNotes.card.never', 'Not generated');
			const binding = note?.meta.binding;
			const card = $('button.custom-mode-process-notes-card', { type: 'button' },
				$('div.custom-mode-process-notes-card-title', undefined, entry.label),
				$('div.custom-mode-process-notes-card-summary', undefined, note?.meta.userPrompt ?? ''),
				$('div.custom-mode-process-notes-card-meta', undefined, generated),
				$('div.custom-mode-process-notes-card-meta', undefined, localize(
					'customMode.processNotes.card.stats',
					'{0} targets · {1} subsystems',
					String(binding?.resolvedTargets.length ?? note?.graph.nodes.length ?? 0),
					String(binding?.selection.length ?? 0),
				)),
				$('div.custom-mode-process-notes-card-chips', undefined,
					...(binding?.selection.slice(0, 3).map(s => $('span.custom-mode-process-notes-card-chip', undefined, s.label)) ?? [])
				),
			) as HTMLButtonElement;
			card.title = entry.label;
			this._register(addDisposableListener(card, 'click', () => void this.drillIntoProcessTopic(entry.id)));
			this.processNotesCards.appendChild(card);
		}
	}

	private hideProcessNotesTypeahead(): void {
		this.processNotesTypeahead.classList.remove('visible');
		this.processNotesTypeahead.replaceChildren();
	}

	private updateProcessNotesTypeahead(): void {
		const q = this.processNotesPromptInput.value.trim();
		if (!q || this.processNotesGraphLayer !== 'detail') {
			this.hideProcessNotesTypeahead();
			return;
		}
		const qLower = q.toLowerCase();
		const scored = this.processNotesSuggestions.map(s => {
			const label = s.label.toLowerCase();
			let score = 0;
			if (label === qLower) { score += 5; }
			if (label.includes(qLower) || qLower.includes(label)) { score += 3; }
			for (const t of qLower.split(/[^a-z0-9]+/g).filter(Boolean)) {
				if (label.includes(t)) { score += 1; }
			}
			score += (s.confidence ?? 0) * 0.25;
			return { s, score };
		}).filter(x => x.score > 0.6).sort((a, b) => b.score - a.score).slice(0, 8);

		if (!scored.length) {
			this.hideProcessNotesTypeahead();
			return;
		}
		this.processNotesTypeahead.replaceChildren();
		for (const { s } of scored) {
			const meta = s.probe
				? localize('customMode.processNotes.typeahead.probe', '{0} targets', String(s.probe.resolvedTargets))
				: localize('customMode.processNotes.typeahead.kind', String(s.kind));
			const item = $('div.custom-mode-process-notes-typeahead-item', { role: 'button', tabindex: '0' },
				$('div.custom-mode-process-notes-typeahead-title', undefined, s.label),
				$('div.custom-mode-process-notes-typeahead-meta', undefined, meta),
			);
			this._register(addDisposableListener(item, 'mousedown', (e) => {
				e.preventDefault();
				this.processNotesPromptInput.value = s.promptTemplates[0] ?? `How does ${s.label} work?`;
				this.hideProcessNotesTypeahead();
				this.processNotesPromptInput.focus();
			}));
			this.processNotesTypeahead.appendChild(item);
		}
		this.processNotesTypeahead.classList.add('visible');
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

	private createProcessCandidateSelector() {
		return (
			userQuestion: string,
			candidates: Parameters<typeof selectProcessCandidatesFromIxMap>[2],
			fallbackKeywords: readonly string[],
			fallbackReason: string,
		) => selectProcessCandidatesFromIxMap(
			this.languageModelsService,
			userQuestion,
			candidates,
			fallbackKeywords,
			fallbackReason,
			this.chatSessionsCts.token,
		);
	}

	private async drillIntoProcessTopic(topicId: ProcessNoteId): Promise<void> {
		this.processNotesGraphLayer = 'detail';
		this.setProcessNotesDetailTab('output');
		this.processNotesTopicSelect.value = topicId;
		await this.loadSelectedProcessNote();
		this.updateProcessNotesGraphLayerUi();
	}

	private async loadSelectedProcessNote(preferredTopicId?: string): Promise<void> {
		const selectionHint = preferredTopicId ?? this.processNotesTopicSelect.value;
		const file = await this.processNotesStore.load();
		this.processNotesCachedFile = file;
		this.rebuildProcessNotesTopicSelectOptions(file, selectionHint);
		const topic = this.processNotesTopicSelect.value;
		const note = file?.notes.find(n => n.id === topic);
		this.processNotesPromptInput.value = note?.meta?.userPrompt ?? '';
		this.processNotesMarkdown.textContent = note?.markdown ?? localize('customMode.processNotes.empty', 'No saved note yet. Use Generate to create one.');
		this.processNotesLogs.textContent = note?.meta?.generationLog ?? '';
		if (this.processNotesGraphLayer === 'detail') {
			this.processNotesGraphView.setGraph(note?.graph ?? { nodes: [], edges: [] });
		}
	}

	private async generateProcessNoteFromPrompt(): Promise<void> {
		const prompt = this.processNotesPromptInput.value.trim();
		if (!prompt.length) {
			this.notificationService.notify({ severity: Severity.Info, message: localize('customMode.processNotes.custom.needPrompt', 'Enter a question about this workspace.') });
			return;
		}
		const folder = resolveIxEvidenceWorkspaceFolderUri(this.workspaceContextService, this.configurationService);
		if (!folder) {
			this.notificationService.notify({ severity: Severity.Warning, message: localize('customMode.processNotes.noWorkspace', 'Open a workspace folder to generate process notes.') });
			return;
		}

		const noteId = stableCustomNoteId(prompt);
		const title = prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt;

		this.processNotesGenerateButton.disabled = true;
		try {
			this.processNotesGraphLayer = 'detail';
			this.updateProcessNotesGraphLayerUi();
			this.processNotesLogs.textContent = '';
			this.processNotesMarkdown.textContent = localize('customMode.processNotes.generating', 'Generating process note…');
			this.setProcessNotesDetailTab('logs');

			const logLine = (line: string) => {
				this.processNotesLogs.textContent += (this.processNotesLogs.textContent ? '\n' : '') + line;
				this.processNotesLogs.scrollTop = this.processNotesLogs.scrollHeight;
			};
			const onProgress = (e: ProcessNotesGenerationProgressEvent) => {
				const tag = e.status === 'start' ? '…' : e.status === 'success' ? '✓' : e.status === 'error' ? '✗' : '•';
				const detail = e.detail ? ` — ${e.detail}` : '';
				logLine(`[${e.phase}] ${tag} ${e.label}${detail}`);
			};

			const evidence = await buildCustomPromptEvidencePack(
				this.ixIntegrationService,
				folder,
				prompt,
				this.createProcessCandidateSelector(),
				onProgress
			);
			onProgress({ phase: 'synthesis', label: 'AI synthesis', status: 'start' });
			const synth = await synthesizeCustomPromptNote(this.languageModelsService, evidence, this.chatSessionsCts.token);
			onProgress({ phase: 'synthesis', label: 'AI synthesis', status: 'success' });
			const now = Date.now();
			const generationLog = this.processNotesLogs.textContent;
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
			this.setProcessNotesDetailTab('output');
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

	private updateUiUrlPill(url: string | undefined): void {
		const span = this.uiUrlPill.querySelector('span');
		if (span) {
			span.textContent = url ?? '';
		}
		this.uiUrlPill.classList.toggle('has-url', Boolean(url));
	}

	private workspaceKeyForSuggestions(): string | undefined {
		const folder = resolveIxEvidenceWorkspaceFolderUri(this.workspaceContextService, this.configurationService);
		return folder ? folder.toString() : undefined;
	}

	private readCachedSuggestions(workspaceKey: string): ProcessTopicsFile | undefined {
		const raw = this.storageService.get(STORAGE_PROCESS_NOTES_SUGGESTIONS_CACHE, StorageScope.PROFILE);
		if (!raw) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as { byWorkspace?: Record<string, ProcessTopicsFile> };
			const entry = parsed?.byWorkspace?.[workspaceKey];
			return entry && entry.version === 1 && Array.isArray(entry.suggestions) ? entry : undefined;
		} catch {
			return undefined;
		}
	}

	private writeCachedSuggestions(workspaceKey: string, file: ProcessTopicsFile): void {
		let byWorkspace: Record<string, ProcessTopicsFile> = {};
		const raw = this.storageService.get(STORAGE_PROCESS_NOTES_SUGGESTIONS_CACHE, StorageScope.PROFILE);
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as { byWorkspace?: Record<string, ProcessTopicsFile> };
				if (parsed?.byWorkspace && typeof parsed.byWorkspace === 'object') {
					byWorkspace = parsed.byWorkspace;
				}
			} catch {
				// ignore
			}
		}
		byWorkspace[workspaceKey] = file;
		this.storageService.store(
			STORAGE_PROCESS_NOTES_SUGGESTIONS_CACHE,
			JSON.stringify({ byWorkspace }),
			StorageScope.PROFILE,
			StorageTarget.USER
		);
	}

	private async loadProcessNotesSuggestions(): Promise<void> {
		const workspaceKey = this.workspaceKeyForSuggestions();
		if (!workspaceKey || isWeb) {
			this.processNotesSuggestions = [];
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}

		// 1) Fast path: storage cache
		const cached = this.readCachedSuggestions(workspaceKey);
		if (cached) {
			this.processNotesSuggestions = cached.suggestions;
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}

		// 2) Workspace file
		const topics = await this.processNotesStore.loadTopics();
		if (topics?.suggestions?.length) {
			this.processNotesSuggestions = topics.suggestions;
			this.writeCachedSuggestions(workspaceKey, topics);
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}

		// 3) Compute from Ix discovery
		const discoveryFolder = resolveIxEvidenceWorkspaceFolderUri(this.workspaceContextService, this.configurationService);
		if (!discoveryFolder) {
			this.processNotesSuggestions = [];
			if (this.processNotesGraphLayer === 'overview') {
				this.renderProcessNotesCards();
			}
			return;
		}

		await this.ixIntegrationService.ensureIxMappedIfEmpty(discoveryFolder);

		const subsystems = await this.ixIntegrationService.runJsonQuery(['subsystems', '--format', 'json', '.'], discoveryFolder, 90_000);
		const map = await this.ixIntegrationService.runJsonQuery(['map', '--format', 'json', '.'], discoveryFolder, 90_000);
		const discoveryJsons: unknown[] = [];
		if (subsystems.ok) { discoveryJsons.push(subsystems.value); }
		if (map.ok) { discoveryJsons.push(map.value); }

		const computed = computeProcessSuggestionsFromIxDiscovery({
			workspaceUri: discoveryFolder.toString(),
			mapRev: (subsystems.ok && typeof (subsystems.value as any)?.map_rev === 'string') ? (subsystems.value as any).map_rev : (map.ok && typeof (map.value as any)?.map_rev === 'string') ? (map.value as any).map_rev : undefined,
			discoveryJsons,
			generatedAt: Date.now(),
		});
		// Optional light probe budget: validate top suggestions by running `ix search <label>`.
		const probes: Array<{ label: string; ok: boolean; json?: unknown; ranAt: number }> = [];
		let budget = 8;
		for (const s of computed.suggestions.slice(0, 12)) {
			if (budget <= 0) {
				break;
			}
			budget--;
			const ranAt = Date.now();
			const res = await this.ixIntegrationService.runJsonQuery(['search', s.label, '--format', 'json'], discoveryFolder, 30_000);
			if (res.ok) {
				probes.push({ label: s.label, ok: true, json: res.value, ranAt });
			} else {
				probes.push({ label: s.label, ok: false, ranAt });
			}
		}
		const probed = probes.length ? applyProbeResults(computed, probes) : computed;
		this.processNotesSuggestions = probed.suggestions;
		this.writeCachedSuggestions(workspaceKey, probed);
		await this.processNotesStore.saveTopics(probed);
		if (this.processNotesGraphLayer === 'overview') {
			this.renderProcessNotesCards();
		}
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
			this.reachabilityAbort?.abort();
			this.setAppReachable(false);
			return;
		}
		// installing / starting: optional network hint when URL first appears
		if (this.reachabilityUrl !== url) {
			void this.checkUrlReachable(url);
		}
	}

	private setAppReachable(reachable: boolean): void {
		this.container.classList.toggle('custom-mode-app-reachable', reachable);
	}

	private async checkUrlReachable(url: string): Promise<void> {
		this.reachabilityUrl = url;
		this.reachabilityAbort?.abort();
		const abort = new AbortController();
		this.reachabilityAbort = abort;

		// Note: Use `no-cors` so the promise resolves when the server is up even if it doesn't allow our origin.
		// We only care about reachability, not reading the body.
		const timeoutHandle = mainWindow.setTimeout(() => abort.abort(), 1200);
		try {
			await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: abort.signal });
			if (this.reachabilityAbort === abort && this.reachabilityUrl === url) {
				this.setAppReachable(true);
			}
		} catch {
			if (this.reachabilityAbort === abort && this.reachabilityUrl === url) {
				// Do not clear when the dev server already reported running (avoids abort/timeout false negatives).
				if (this.devServerService.getState().phase !== 'running') {
					this.setAppReachable(false);
				}
			}
		} finally {
			mainWindow.clearTimeout(timeoutHandle);
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

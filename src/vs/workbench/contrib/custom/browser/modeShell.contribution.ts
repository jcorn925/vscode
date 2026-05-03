/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb, isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { basename, isEqualOrParent, resolvePath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IContextKeyService, type IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
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
import { createClearUiMappedSelectionScript, createUiClickOverlayScript, UiClickOverlayMessage } from './uiClickOverlayScript.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ChatWidget } from '../../chat/browser/widget/chatWidget.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import type { IChatRequestFileEntry } from '../../chat/common/attachments/chatVariableEntries.js';
import { editorBackground, editorForeground, inputBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { EDITOR_DRAG_AND_DROP_BACKGROUND } from '../../../common/theme.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ModeShellChatSessionManager } from './modeShellChatSessions.js';
import { IIxIntegrationService, type IxIntegrationState } from '../../../../../custom/ix/IxIntegrationService.js';

class ModeShellContribution extends Disposable {

	static readonly ID = 'workbench.contrib.modeShell';

	private static readonly MODES: readonly Mode[] = ['UI', 'Process', 'Code'];

	private readonly container: HTMLElement;
	private readonly topModeButtons = new Map<Mode, HTMLButtonElement>();
	private readonly modeTopBar: HTMLElement;
	private readonly modeSurface: HTMLElement;
	private readonly uiContainer: HTMLElement;
	private readonly processContainer: HTMLElement;
	private readonly styleSheet = createStyleSheet();
	private readonly uiBrowser: HTMLElement & { src: string };
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
	private readonly uiMappedStrip: HTMLElement;
	private readonly uiMappedSelectionText: HTMLElement;
	private readonly uiMappedSelectionClear: HTMLButtonElement;
	private lastUiStartHints: DevServerSuggestedCommands | undefined;
	private readonly uiRuntimeLogs: string[] = [];
	private readonly uiClickOverlayScript = createUiClickOverlayScript();
	private readonly clearUiMappedSelectionScript = createClearUiMappedSelectionScript();
	private readonly startHintActionDisposables = this._register(new DisposableStore());
	private reachabilityAbort: AbortController | undefined;
	private reachabilityUrl: string | undefined;
	private readonly chatSessionsCts = this._register(new CancellationTokenSource());
	private readonly chatSessionManager: ModeShellChatSessionManager;
	private readonly embeddedChatRefs = {
		UI: this._register(new MutableDisposable<any>()),
		Process: this._register(new MutableDisposable<any>()),
	};
	private readonly uiChatContainer: HTMLElement;
	private readonly processChatContainer: HTMLElement;
	private readonly uiChatWidget: ChatWidget;
	private readonly processChatWidget: ChatWidget;
	private readonly processIxWebHint: HTMLElement;
	private readonly processIxDebug: HTMLElement;
	private readonly processIxDebugText: HTMLElement;

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
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IIxIntegrationService private readonly ixIntegrationService: IIxIntegrationService,
	) {
		super();

		this.chatSessionManager = new ModeShellChatSessionManager(this.chatService, this.chatWidgetService, this.storageService);

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
				justify-content: stretch;
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

			.monaco-workbench .custom-mode-ui-container.visible,
			.monaco-workbench .custom-mode-process-container.visible {
				display: flex;
				flex-direction: column;
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

			.monaco-workbench .custom-mode-ui-frame {
				flex: 1;
				width: 100%;
				height: 100%;
				border: 0;
				background: transparent;
				opacity: 0.35;
			}
			
			.monaco-workbench .custom-mode-ui-webview {
				flex: 1;
				width: 100%;
				height: 100%;
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

			.monaco-workbench .custom-mode-embedded-chat {
				display: none;
				flex: 0 0 320px;
				min-height: 220px;
				border-top: 1px solid var(--vscode-panel-border);
				background: var(--vscode-editorBackground);
			}

			.monaco-workbench .custom-mode-embedded-chat.visible {
				display: block;
			}

			/* When the app is reachable, hide the start bar (embedded browser is primary). */
			.monaco-workbench.custom-mode-app-reachable .custom-mode-ui-container .custom-mode-setup {
				display: none;
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

			.monaco-workbench .custom-mode-ui-mapped-strip {
				display: none;
				flex-direction: column;
				gap: 6px;
				position: absolute;
				left: 10px;
				top: 10px;
				right: auto;
				bottom: auto;
				z-index: 2400;
				min-width: min(220px, calc(100% - 20px));
				max-width: min(480px, calc(100% - 24px));
				max-height: min(200px, 34vh);
				padding: 8px 10px;
				border-radius: 8px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
				pointer-events: auto;
				-webkit-app-region: no-drag;
			}

			.monaco-workbench.custom-mode-shell-hasProject.custom-mode-app-reachable .custom-mode-ui-mapped-strip {
				display: flex;
			}

			.monaco-workbench .custom-mode-ui-mapped-strip-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
			}

			.monaco-workbench .custom-mode-ui-mapped-strip-title {
				font-size: 11px;
				font-weight: 700;
				color: var(--vscode-foreground);
			}

			.monaco-workbench .custom-mode-ui-mapped-strip-clear {
				height: 22px;
				padding: 0 8px;
				border-radius: 4px;
				border: 1px solid var(--vscode-button-border, transparent);
				background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
				color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
				cursor: pointer;
				font-size: 11px;
				font-weight: 600;
			}

			.monaco-workbench .custom-mode-ui-mapped-strip-clear:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-ui-mapped-strip-body {
				margin: 0;
				padding: 6px 8px;
				border-radius: 4px;
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
				font-family: var(--monaco-monospace-font);
				font-size: 10px;
				line-height: 1.35;
				white-space: pre-wrap;
				word-break: break-word;
				color: var(--vscode-editor-foreground);
				overflow: auto;
				flex: 1;
				min-height: 0;
			}

			.monaco-workbench .custom-mode-process-container.visible {
				align-items: stretch;
				justify-content: flex-start;
			}

			.monaco-workbench .custom-mode-process-container {
				position: relative;
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
		this.uiMappedSelectionText = $('pre.custom-mode-ui-mapped-strip-body', undefined, '');
		this.uiMappedSelectionClear = $('button.custom-mode-ui-mapped-strip-clear', { type: 'button' }, localize('customMode.uiMappedSelectionClear', 'Clear')) as HTMLButtonElement;
		this.uiMappedStrip = $('div.custom-mode-ui-mapped-strip', undefined,
			$('div.custom-mode-ui-mapped-strip-header', undefined,
				$('span.custom-mode-ui-mapped-strip-title', undefined, localize('customMode.uiMappedSelectionTitle', 'Mapped selection')),
				this.uiMappedSelectionClear
			),
			this.uiMappedSelectionText
		);
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

		this.uiContainer.appendChild(this.uiCallout);
		this.uiContainer.appendChild(this.uiSetup);
		this.uiContainer.appendChild(this.uiBrowser);
		this.uiContainer.appendChild(this.uiMappedStrip);
		this._register(addDisposableListener(this.uiMappedSelectionClear, 'click', () => this.clearUiMappedSelection()));
		this.updateUiMappedSelectionPanel([]);
		this.uiChatContainer = $('div.custom-mode-embedded-chat');
		this.uiContainer.appendChild(this.uiChatContainer);

		// Show the active URL in the top mode bar, right before the "UI" tab.
		const uiTab = this.topModeButtons.get('UI');
		if (uiTab) {
			this.modeTopBar.insertBefore(this.uiUrlPill, uiTab);
			this._register(toDisposable(() => this.uiUrlPill.remove()));
		}

		this.processContainer = $('div.custom-mode-process-container');
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
		this.processIxDebugText = $('div');
		this.processIxDebug = $('div.custom-mode-ix-debug', undefined,
			$('div.custom-mode-ix-debug-title', undefined, localize('customMode.ixDebugTitle', 'Ix')),
			this.processIxDebugText
		);
		this.processContainer.appendChild(this.processCallout);
		this.processContainer.appendChild(this.processSetup);
		this.processContainer.appendChild(this.processIxWebHint);
		this.processContainer.appendChild(this.processIxDebug);
		this.processChatContainer = $('div.custom-mode-embedded-chat');
		this.processContainer.appendChild(this.processChatContainer);

		this.modeSurface.appendChild(this.uiContainer);
		this.modeSurface.appendChild(this.processContainer);
		this.container.appendChild(this.modeSurface);

		// Create embedded chat widgets for UI/Process.
		this.uiChatWidget = this.createEmbeddedChatWidget(this.uiChatContainer, 'customModeShellUI');
		this.processChatWidget = this.createEmbeddedChatWidget(this.processChatContainer, 'customModeShellProcess');

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
				addEventListener: (type: string, listener: (e: any) => void) => void;
				executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
			};

			const log = (type: string, detail?: string) => this.pushUiRuntimeLog(`[webview:${type}]${detail ? ` ${detail}` : ''}`);

			webview.addEventListener('did-start-loading', () => log('did-start-loading'));
			webview.addEventListener('did-stop-loading', () => log('did-stop-loading'));
			webview.addEventListener('did-finish-load', () => log('did-finish-load'));
			webview.addEventListener('dom-ready', async () => {
				log('dom-ready');
				try {
					await webview.executeJavaScript?.(this.uiClickOverlayScript);
					log('inject-click-overlay');
				} catch (e: any) {
					log('inject-failed', String(e?.message ?? e));
				}
			});
			webview.addEventListener('did-navigate', (e: any) => log('did-navigate', e?.url ? String(e.url) : undefined));
			webview.addEventListener('did-navigate-in-page', (e: any) => log('did-navigate-in-page', e?.url ? String(e.url) : undefined));

			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'console-message', (e: any) => {
				const msg = e?.message ?? '';
				const level = e?.level ?? '';
				const line = e?.line ? `:${e.line}` : '';
				const source = e?.sourceId ? ` (${e.sourceId}${line})` : '';
				// Parse click overlay marker emitted from inside <webview>.
				if (typeof msg === 'string' && (msg.startsWith('__VSCODE_UI_CLICK__') || msg.startsWith('__VSCODE_UI_ENV__') || msg.startsWith('__VSCODE_UI_SELECTION__'))) {
					try {
						const json = msg.startsWith('__VSCODE_UI_ENV__')
							? msg.slice('__VSCODE_UI_ENV__'.length)
							: msg.startsWith('__VSCODE_UI_SELECTION__')
								? msg.slice('__VSCODE_UI_SELECTION__'.length)
								: msg.slice('__VSCODE_UI_CLICK__'.length);
						const data = JSON.parse(json) as UiClickOverlayMessage;
						this.onEmbeddedUiMessage(new MessageEvent('message', { data } as any));
						return;
					} catch {
						// fall through and log raw
					}
				}

				this.pushUiRuntimeLog(`[console${level ? `:${level}` : ''}] ${msg}${source}`);
			}));

			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'did-fail-load', (e: any) => {
				const url = e?.validatedURL ?? '';
				const desc = e?.errorDescription ?? e?.errorCode ?? 'load failed';
				// ERR_ABORTED (-3) is emitted when a navigation is intentionally interrupted
				// (e.g. subsequent src update). Don't treat it as a real error.
				if (e?.errorCode === -3 || String(desc).includes('ERR_ABORTED')) {
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
			this.updateUiMappedSelectionPanel(items);
			this.pushUiRuntimeLog(`[ui-selection] ${items.length} mapped item(s) href=${data.href}`);
			void this.injectUiMappedSelectionIntoChat(items);
			return;
		}
	}

	private updateUiMappedSelectionPanel(items: ReadonlyArray<{ vscodeSrc: string; tag?: string; text?: string }>): void {
		if (items.length === 0) {
			this.uiMappedSelectionText.textContent = localize('customMode.uiMappedSelectionEmpty', 'Drag a rectangle in the preview to select mapped components; they are added as file context to the UI chat below. Shift+click a mapped element to switch to the Code tab and open that location in the editor.');
			return;
		}
		const lines = items.map((it, i) => {
			const tag = it.tag ? `${it.tag} ` : '';
			const hint = it.text ? ` — ${it.text}` : '';
			return `${i + 1}. ${tag}${it.vscodeSrc}${hint}`;
		});
		this.uiMappedSelectionText.textContent = lines.join('\n');
	}

	private clearUiMappedSelection(): void {
		this.updateUiMappedSelectionPanel([]);
		void this.runClearMappedSelectionInEmbeddedSurface();
	}

	private async runClearMappedSelectionInEmbeddedSurface(): Promise<void> {
		const code = this.clearUiMappedSelectionScript;
		if (!isWeb && this.isWebviewElement(this.uiBrowser)) {
			const webview = this.uiBrowser as unknown as { executeJavaScript?: (c: string, userGesture?: boolean) => Promise<unknown> };
			try {
				await webview.executeJavaScript?.(code, false);
			} catch {
				// ignore
			}
			return;
		}
		if (isWeb) {
			try {
				const iframe = this.uiBrowser as unknown as HTMLIFrameElement;
				const doc = iframe.contentDocument;
				if (doc?.head) {
					const s = doc.createElement('script');
					s.textContent = code;
					doc.head.appendChild(s);
					s.remove();
				}
			} catch {
				// cross-origin
			}
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
		const attachmentModel = this.uiChatWidget.input.attachmentModel;
		let added = 0;
		for (const it of items) {
			const resolved = this.resolveVscodeSrcToWorkspaceResource(it.vscodeSrc, '[ui-selection:chat]');
			if (!resolved) {
				continue;
			}
			const range: IRange = {
				startLineNumber: resolved.line,
				startColumn: resolved.column,
				endLineNumber: resolved.line,
				endColumn: resolved.column,
			};
			try {
				// Use a stable id per vscodeSrc path. Plain IRange objects do not implement toString(),
				// so ChatAttachmentModel.asFileVariableEntry would otherwise collapse many locations to one id.
				const id = `vscode-ui-map:${it.vscodeSrc}`;
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

		const isUi = mode === 'UI';
		this.uiContainer.classList.toggle('visible', isUi);
		this.processContainer.classList.toggle('visible', mode === 'Process');

		// Embedded chat in UI/Process; keep sidebar chat session switching for Code only.
		void this.updateEmbeddedChat(mode);
		if (mode === 'Code') {
			void this.chatSessionManager.openSessionForMode(mode, this.chatSessionsCts.token);
		}
	}

	private createEmbeddedChatWidget(container: HTMLElement, viewId: string): ChatWidget {
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
		widget.setVisible(true);

		const ro = new ResizeObserver(() => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w > 0 && h > 0) {
				widget.layout(h, w);
			}
		});
		ro.observe(container);
		this._register(toDisposable(() => ro.disconnect()));

		return widget;
	}

	private async updateEmbeddedChat(mode: Mode): Promise<void> {
		const showUi = mode === 'UI';
		const showProcess = mode === 'Process';
		this.uiChatContainer.classList.toggle('visible', showUi);
		this.processChatContainer.classList.toggle('visible', showProcess);

		if (showUi) {
			await this.ensureEmbeddedChatModel('UI');
		} else if (showProcess) {
			await this.ensureEmbeddedChatModel('Process');
		}
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
		widget.setVisible(true);
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

	private updateIxDebug(state: IxIntegrationState): void {
		const lines: string[] = [];
		lines.push(`phase: ${state.phase}`);
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

	private updateReachabilityFromState(state: DevServerState): void {
		const url = state.activeUrl;
		if (!url) {
			this.setAppReachable(false);
			return;
		}
		// If we believe we're running but the URL changed, re-check.
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
				this.setAppReachable(false);
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

	override async run(accessor: any): Promise<void> {
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

function withModeShellChatManager(accessor: any, fn: (mgr: ModeShellChatSessionManager) => Promise<void> | void): Promise<void> | void {
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
	override async run(accessor: any): Promise<void> {
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
	override async run(accessor: any): Promise<void> {
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
	override async run(accessor: any): Promise<void> {
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
	override async run(accessor: any): Promise<void> {
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

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
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { DevServerState, DevServerSuggestedCommands, IDevServerService } from '../../../../../custom/devserver/DevServerService.js';
import { IDefaultProjectService } from '../../../../../custom/devserver/DefaultProjectService.js';
import { IModeService, Mode } from '../../../../../custom/mode/ModeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../vs/platform/workspace/common/workspace.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { createUiClickOverlayScript, UiClickOverlayMessage } from './uiClickOverlayScript.js';

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
	private readonly uiStartHints: HTMLElement;
	private readonly processStartHints: HTMLElement;
	private readonly uiSetup: HTMLElement;
	private readonly processSetup: HTMLElement;
	private readonly uiUrlPill: HTMLElement;
	private readonly uiDebug: HTMLElement;
	private readonly uiDebugText: HTMLElement;
	private readonly uiRuntimeText: HTMLElement;
	private readonly uiDevtoolsButton: HTMLButtonElement;
	private readonly uiLoadUrlInput: HTMLInputElement;
	private readonly uiLoadUrlButton: HTMLButtonElement;
	private readonly uiRuntimeLogs: string[] = [];
	private readonly uiClickOverlayScript = createUiClickOverlayScript();
	private readonly startHintActionDisposables = this._register(new DisposableStore());
	private reachabilityAbort: AbortController | undefined;
	private reachabilityUrl: string | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IModeService private readonly modeService: IModeService,
		@IDevServerService private readonly devServerService: IDevServerService,
		@IDefaultProjectService private readonly defaultProjectService: IDefaultProjectService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@INativeHostService private readonly nativeHostService: INativeHostService
	) {
		super();

		this.container = this.layoutService.getContainer(mainWindow);
		this.container.classList.add('custom-mode-shell-enabled');
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

			.monaco-workbench .custom-mode-process-container.visible {
				align-items: stretch;
				justify-content: flex-start;
			}

			.monaco-workbench .custom-mode-devserver-debug {
				position: absolute;
				left: 16px;
				bottom: 16px;
				max-width: min(720px, calc(100% - 32px));
				max-height: 35%;
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

			.monaco-workbench .custom-mode-devserver-debug-title {
				font-weight: 600;
				margin-bottom: 6px;
			}

			.monaco-workbench .custom-mode-devserver-debug-actions {
				display: flex;
				gap: 8px;
				align-items: center;
				margin-bottom: 6px;
				flex-wrap: wrap;
			}

			.monaco-workbench .custom-mode-devserver-debug-button {
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

			.monaco-workbench .custom-mode-devserver-debug-button:hover {
				background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
			}

			.monaco-workbench .custom-mode-devserver-debug-input {
				height: 26px;
				min-width: min(380px, calc(100vw - 140px));
				padding: 0 10px;
				border-radius: 6px;
				border: 1px solid var(--vscode-input-border, transparent);
				background-color: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				font-size: 12px;
			}

			.monaco-workbench .custom-mode-devserver-debug-sectionTitle {
				font-weight: 600;
				margin: 10px 0 6px;
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
				position: absolute;
				top: 12px;
				right: 12px;
				z-index: 2200;
				display: none;
				max-width: min(520px, calc(100% - 24px));
				padding: 6px 10px;
				border-radius: 999px;
				background-color: var(--vscode-editorWidget-background);
				border: 1px solid var(--vscode-editorWidget-border);
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				line-height: 1.3;
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
		this.uiStartHints = $('div.custom-mode-start-hints');
		this.uiSetup = $('div.custom-mode-setup');
		this.uiUrlPill = $('div.custom-mode-ui-urlPill');
		this.uiUrlPill.appendChild($('strong', undefined, localize('customMode.urlLabel', 'URL')));
		this.uiUrlPill.appendChild($('span', undefined, ''));
		const uiSetupDetails = document.createElement('details');
		const uiSetupSummary = document.createElement('summary');
		uiSetupSummary.textContent = localize('customMode.setupSummary', 'Setup');
		uiSetupDetails.appendChild(uiSetupSummary);
		uiSetupDetails.appendChild(this.uiStartHints);
		this.uiSetup.appendChild(uiSetupDetails);
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
		this.uiContainer.appendChild(this.uiUrlPill);
		this.uiDebugText = $('div');
		this.uiRuntimeText = $('div');
		this.uiDevtoolsButton = $('button.custom-mode-devserver-debug-button', { type: 'button' }, localize('customMode.openUiDevtools', 'Open UI DevTools')) as HTMLButtonElement;
		this.uiLoadUrlInput = $('input.custom-mode-devserver-debug-input', {
			type: 'text',
			inputmode: 'url',
			spellcheck: 'false',
			placeholder: localize('customMode.loadUrlPlaceholder', 'https://example.com'),
			value: ''
		}) as unknown as HTMLInputElement;
		this.uiLoadUrlButton = $('button.custom-mode-devserver-debug-button', { type: 'button' }, localize('customMode.loadUrlButton', 'Load URL')) as HTMLButtonElement;
		this.uiDebug = $('div.custom-mode-devserver-debug', undefined,
			$('div.custom-mode-devserver-debug-title', undefined, localize('customMode.devserverDebugTitle', 'Debug')),
			$('div.custom-mode-devserver-debug-actions', undefined, this.uiDevtoolsButton, this.uiLoadUrlInput, this.uiLoadUrlButton),
			$('div.custom-mode-devserver-debug-sectionTitle', undefined, localize('customMode.devserverSection', 'Dev Server')),
			this.uiDebugText,
			$('div.custom-mode-devserver-debug-sectionTitle', undefined, localize('customMode.uiRuntimeSection', 'UI Runtime')),
			this.uiRuntimeText
		);
		this.uiContainer.appendChild(this.uiDebug);
		this.uiContainer.appendChild(this.uiBrowser);

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
		this.processContainer.appendChild(this.processCallout);
		this.processContainer.appendChild(this.processSetup);

		this.modeSurface.appendChild(this.uiContainer);
		this.modeSurface.appendChild(this.processContainer);
		this.container.appendChild(this.modeSurface);

		this.updateMode(this.modeService.getMode());
		this._register(this.modeService.onDidChange(mode => this.updateMode(mode)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.updateProjectState()));
		this._register(this.devServerService.onDidChangeActiveUrl(url => {
			if (url && this.uiBrowser.src !== url) {
				this.uiBrowser.src = url;
				// Webview sometimes ignores property-only updates; set attribute too.
				(this.uiBrowser as unknown as HTMLElement).setAttribute('src', url);
			}
			this.updateUiUrlPill(url);
		}));
		this._register(this.devServerService.onDidChangeState(state => this.updateDevServerDebug(state)));

		this.updateProjectState();
		this.updateDevServerDebug(this.devServerService.getState());
		this.updateReachabilityFromState(this.devServerService.getState());
		this.updateUiUrlPill(this.devServerService.getActiveUrl());

		this._register(addDisposableListener(this.uiDevtoolsButton, 'click', () => this.openUiDevTools()));
		this._register(addDisposableListener(this.uiLoadUrlButton, 'click', () => this.loadUiUrlFromInput()));
		this._register(addDisposableListener(this.uiLoadUrlInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				this.loadUiUrlFromInput();
			}
		}));
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
			};

			const log = (type: string, detail?: string) => this.pushUiRuntimeLog(`[webview:${type}]${detail ? ` ${detail}` : ''}`);

			webview.addEventListener('did-start-loading', () => log('did-start-loading'));
			webview.addEventListener('did-stop-loading', () => log('did-stop-loading'));
			webview.addEventListener('did-finish-load', () => log('did-finish-load'));
			webview.addEventListener('dom-ready', () => log('dom-ready'));
			webview.addEventListener('did-navigate', (e: any) => log('did-navigate', e?.url ? String(e.url) : undefined));
			webview.addEventListener('did-navigate-in-page', (e: any) => log('did-navigate-in-page', e?.url ? String(e.url) : undefined));

			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'console-message', (e: any) => {
				const msg = e?.message ?? '';
				const level = e?.level ?? '';
				const line = e?.line ? `:${e.line}` : '';
				const source = e?.sourceId ? ` (${e.sourceId}${line})` : '';
				this.pushUiRuntimeLog(`[console${level ? `:${level}` : ''}] ${msg}${source}`);
			}));

			this._register(addDisposableListener(this.uiBrowser as unknown as HTMLElement, 'did-fail-load', (e: any) => {
				const url = e?.validatedURL ?? '';
				const desc = e?.errorDescription ?? e?.errorCode ?? 'load failed';
				this.pushUiRuntimeLog(`[load-failed] ${desc}${url ? ` (${url})` : ''}`);
			}));

			// Some implementations require explicit addEventListener registration.
			webview.addEventListener('console-message', (e: any) => {
				const msg = e?.message ?? '';
				const level = e?.level ?? '';
				this.pushUiRuntimeLog(`[console${level ? `:${level}` : ''}] ${msg}`);
			});
			webview.addEventListener('did-fail-load', (e: any) => {
				const url = e?.validatedURL ?? '';
				const desc = e?.errorDescription ?? e?.errorCode ?? 'load failed';
				this.pushUiRuntimeLog(`[load-failed] ${desc}${url ? ` (${url})` : ''}`);
			});
		}
	}

	private onEmbeddedUiMessage(e: MessageEvent): void {
		const data = e.data as UiClickOverlayMessage | undefined;
		if (!data || data.type !== 'vscode-ui-click') {
			return;
		}

		// For now, log into the debug panel (UI Runtime section).
		const target = data.target?.tag ? `${data.target.tag}${data.target.id ? `#${data.target.id}` : ''}` : 'unknown';
		const source = data.source ? ` source=${data.source}` : '';
		this.pushUiRuntimeLog(`[ui-click] ${target}${source} href=${data.href}`);
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

		if (isUi) {
			void this.devServerService.ensureRunning();
		}
	}

	private updateProjectState(): void {
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		this.container.classList.toggle('custom-mode-shell-hasProject', hasProject);
		this.refreshStartCommandHints();
	}

	private refreshStartCommandHints(): void {
		void this.devServerService.getSuggestedStartCommands().then(hints => {
			this.startHintActionDisposables.clear();
			this.renderStartHintsInto(this.uiStartHints, hints);
			this.renderStartHintsInto(this.processStartHints, hints);
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

		this.uiDebugText.textContent = lines.join('\n');
		this.updateReachabilityFromState(state);
	}

	private updateUiUrlPill(url: string | undefined): void {
		const span = this.uiUrlPill.querySelector('span');
		if (span) {
			span.textContent = url ?? '';
		}
		this.uiUrlPill.classList.toggle('has-url', Boolean(url));
	}

	private loadUiUrlFromInput(): void {
		const raw = (this.uiLoadUrlInput.value ?? '').trim();
		if (!raw) {
			const fallback = 'https://example.com';
			this.uiBrowser.src = fallback;
			(this.uiBrowser as unknown as HTMLElement).setAttribute('src', fallback);
			this.pushUiRuntimeLog('[ui-load] https://example.com');
			return;
		}

		// Best-effort normalization: if user types "localhost:3000", add scheme.
		const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
		this.uiBrowser.src = url;
		(this.uiBrowser as unknown as HTMLElement).setAttribute('src', url);
		this.pushUiRuntimeLog(`[ui-load] ${url}`);
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

	private openUiDevTools(): void {
		if (!isWeb && this.isWebviewElement(this.uiBrowser)) {
			const webview = this.uiBrowser as unknown as { openDevTools?: () => void };
			try {
				webview.openDevTools?.();
				return;
			} catch {
				// ignore and fall through
			}
		}
		// Fallback: open the host window devtools (useful for diagnosing blank/failed loads).
		void this.nativeHostService.openDevTools();
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
}

registerWorkbenchContribution2(ModeShellContribution.ID, ModeShellContribution, WorkbenchPhase.BlockStartup);

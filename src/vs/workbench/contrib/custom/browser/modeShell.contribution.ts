/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { DevServerState, IDevServerService } from '../../../../../custom/devserver/DevServerService.js';
import { IDefaultProjectService } from '../../../../../custom/devserver/DefaultProjectService.js';
import { IModeService, Mode } from '../../../../../custom/mode/ModeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../vs/platform/workspace/common/workspace.js';

class ModeShellContribution extends Disposable {

	static readonly ID = 'workbench.contrib.modeShell';

	private static readonly MODES: readonly Mode[] = ['UI', 'Process', 'Code'];

	private readonly container: HTMLElement;
	private readonly modeButtons = new Map<Mode, HTMLButtonElement>();
	private readonly modeSurface: HTMLElement;
	private readonly uiContainer: HTMLElement;
	private readonly processContainer: HTMLElement;
	private readonly styleSheet = createStyleSheet();
	private readonly uiBrowser: HTMLElement & { src: string };
	private readonly uiCallout: HTMLElement;
	private readonly processCallout: HTMLElement;
	private readonly uiDebug: HTMLElement;
	private readonly uiDebugText: HTMLElement;
	private readonly uiRuntimeText: HTMLElement;
	private readonly uiDevtoolsButton: HTMLButtonElement;
	private readonly uiRuntimeLogs: string[] = [];

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IModeService private readonly modeService: IModeService,
		@IDevServerService private readonly devServerService: IDevServerService,
		@IDefaultProjectService private readonly defaultProjectService: IDefaultProjectService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();

		this.container = layoutService.getContainer(mainWindow);
		this.container.classList.add('custom-mode-shell-enabled');
		this.styleSheet.textContent = `
			.monaco-workbench.custom-mode-shell-enabled {
				--custom-mode-shell-height: 36px;
			}

			.monaco-workbench.custom-mode-shell-enabled > .monaco-grid-view {
				top: var(--custom-mode-shell-height);
				bottom: 0;
			}

			.monaco-workbench .custom-mode-shell-bar {
				position: absolute;
				top: 0;
				left: 0;
				right: 0;
				z-index: 2000;
				height: var(--custom-mode-shell-height);
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 0 12px;
				background-color: var(--vscode-editorGroupHeader-noTabsBackground);
				border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
			}

			.monaco-workbench.mac .custom-mode-shell-bar {
				padding-left: 120px;
			}

			.monaco-workbench .custom-mode-shell-tabs {
				display: flex;
				align-items: center;
				gap: 14px;
				padding: 2px 10px 0;
				border-radius: 999px;
				background-color: var(--vscode-tab-inactiveBackground);
			}

			.monaco-workbench .custom-mode-shell-tab {
				height: 24px;
				min-width: 68px;
				padding: 0 12px;
				border: 0;
				border-bottom: 2px solid transparent;
				border-radius: 6px 6px 0 0;
				background: transparent;
				color: var(--vscode-tab-inactiveForeground);
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				letter-spacing: 0.2px;
			}

			.monaco-workbench .custom-mode-shell-tab:hover {
				background-color: var(--vscode-tab-hoverBackground);
				color: var(--vscode-tab-hoverForeground);
			}

			.monaco-workbench .custom-mode-shell-tab.active {
				color: var(--vscode-tab-activeForeground);
				border-bottom-color: var(--vscode-tab-activeBorderTop);
				background-color: var(--vscode-tab-activeBackground);
			}

			.monaco-workbench .custom-mode-surface {
				position: absolute;
				top: var(--custom-mode-shell-height);
				right: 0;
				bottom: 0;
				left: 0;
				z-index: 1500;
				display: none;
				background-color: var(--vscode-editorBackground);
			}

			.monaco-workbench.custom-mode-ui .custom-mode-surface,
			.monaco-workbench.custom-mode-process .custom-mode-surface {
				display: flex;
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
				align-items: center;
				justify-content: center;
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

			.monaco-workbench .custom-mode-devserver-debug-sectionTitle {
				font-weight: 600;
				margin: 10px 0 6px;
			}
		`;

		const modeBar = $('div.custom-mode-shell-bar');
		const modeTabs = $('div.custom-mode-shell-tabs', { role: 'tablist' });
		modeBar.appendChild(modeTabs);
		this.container.prepend(modeBar);

		for (const mode of ModeShellContribution.MODES) {
			const button = $('button.custom-mode-shell-tab', {
				type: 'button',
				role: 'tab',
				'aria-label': mode,
				'aria-selected': false
			}, mode) as HTMLButtonElement;
			this.modeButtons.set(mode, button);
			modeTabs.appendChild(button);
			this._register(addDisposableListener(button, 'click', () => this.modeService.setMode(mode)));
		}

		this.modeSurface = $('div.custom-mode-surface');
		this.uiContainer = $('div.custom-mode-ui-container');
		this.uiCallout = this.createDefaultProjectCallout(localize('customMode.uiCalloutTitle', 'No project open'), localize('customMode.uiCalloutSubtitle', 'Create and open the default project to start coding.'), () => this.defaultProjectService.createAndOpenDefaultProject());
		const initialUrl = this.devServerService.getActiveUrl() ?? 'http://localhost:3000';
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
		this.uiDebugText = $('div');
		this.uiRuntimeText = $('div');
		this.uiDevtoolsButton = $('button.custom-mode-devserver-debug-button', { type: 'button' }, localize('customMode.openUiDevtools', 'Open UI DevTools')) as HTMLButtonElement;
		this.uiDebug = $('div.custom-mode-devserver-debug', undefined,
			$('div.custom-mode-devserver-debug-title', undefined, localize('customMode.devserverDebugTitle', 'Debug')),
			$('div.custom-mode-devserver-debug-actions', undefined, this.uiDevtoolsButton),
			$('div.custom-mode-devserver-debug-sectionTitle', undefined, localize('customMode.devserverSection', 'Dev Server')),
			this.uiDebugText,
			$('div.custom-mode-devserver-debug-sectionTitle', undefined, localize('customMode.uiRuntimeSection', 'UI Runtime')),
			this.uiRuntimeText
		);
		this.uiContainer.appendChild(this.uiDebug);
		this.uiContainer.appendChild(this.uiBrowser);

		this.processContainer = $('div.custom-mode-process-container');
		this.processCallout = this.createDefaultProjectCallout(localize('customMode.processCalloutTitle', 'No project open'), localize('customMode.processCalloutSubtitle', 'Create and open the default project to start coding.'), () => this.defaultProjectService.createAndOpenDefaultProject());
		this.processContainer.appendChild(this.processCallout);
		this.processContainer.appendChild($('div.custom-mode-placeholder', undefined, localize('customMode.processPlaceholder', 'Process mode surface')));

		this.modeSurface.appendChild(this.uiContainer);
		this.modeSurface.appendChild(this.processContainer);
		this.container.appendChild(this.modeSurface);

		this.updateMode(this.modeService.getMode());
		this._register(this.modeService.onDidChange(mode => this.updateMode(mode)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.updateProjectState()));
		this._register(this.devServerService.onDidChangeActiveUrl(url => {
			if (url && this.uiBrowser.src !== url) {
				this.uiBrowser.src = url;
			}
		}));
		this._register(this.devServerService.onDidChangeState(state => this.updateDevServerDebug(state)));

		this.updateProjectState();
		this.updateDevServerDebug(this.devServerService.getState());

		this._register(addDisposableListener(this.uiDevtoolsButton, 'click', () => this.openUiDevTools()));

		// Forward webview console/errors into the debug panel (desktop only).
		if (!isWeb && this.isWebviewElement(this.uiBrowser)) {
			const webview = this.uiBrowser as unknown as {
				addEventListener: (type: string, listener: (e: any) => void) => void;
			};

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

	private updateMode(mode: Mode): void {
		for (const [itemMode, button] of this.modeButtons) {
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
			webview.openDevTools?.();
		}
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

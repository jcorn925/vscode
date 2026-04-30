/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { isWindows } from '../../vs/base/common/platform.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';

export type DevServerPackageManager = 'npm' | 'yarn' | 'pnpm';

export interface DevServerSuggestedCommands {
	readonly workspaceFolder: URI;
	readonly packageManager: DevServerPackageManager;
	readonly installCommand: string;
	readonly primaryScript: string | undefined;
	readonly primaryRunCommand: string | undefined;
	readonly combinedCommandLine: string | undefined;
	readonly inferredUrl: string | undefined;
	readonly listedScripts: readonly { readonly name: string; readonly runCommand: string }[];
	readonly hasNodeModules: boolean;
}

export interface IDevServerService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeActiveUrl: Event<string | undefined>;
	readonly onDidChangeState: Event<DevServerState>;

	getActiveUrl(): string | undefined;
	getState(): DevServerState;
	ensureRunning(): Promise<string | undefined>;
	getSuggestedStartCommands(): Promise<DevServerSuggestedCommands | undefined>;
}

export const IDevServerService = createDecorator<IDevServerService>('devServerService');

type PackageJson = {
	packageManager?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

export type DevServerPhase = 'idle' | 'installing' | 'starting' | 'running' | 'error';

export interface DevServerState {
	readonly phase: DevServerPhase;
	readonly workspaceFolder: URI | undefined;
	readonly script: string | undefined;
	readonly command: string | undefined;
	readonly activeUrl: string | undefined;
	readonly lastOutput: string;
	readonly lastError: string | undefined;
}

export class DevServerService extends Disposable implements IDevServerService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveUrl = this._register(new Emitter<string | undefined>());
	readonly onDidChangeActiveUrl = this._onDidChangeActiveUrl.event;

	private readonly _onDidChangeState = this._register(new Emitter<DevServerState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private activeUrl: string | undefined;
	private started = false;
	private lastWorkspaceFolder: URI | undefined;
	private outputBuffer = '';
	private phase: DevServerPhase = 'idle';
	private script: string | undefined;
	private command: string | undefined;
	private lastError: string | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService
	) {
		super();

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.onWorkspaceChanged()));
		this.onWorkspaceChanged();
	}

	getActiveUrl(): string | undefined {
		return this.activeUrl;
	}

	getState(): DevServerState {
		return {
			phase: this.phase,
			workspaceFolder: this.lastWorkspaceFolder,
			script: this.script,
			command: this.command,
			activeUrl: this.activeUrl,
			lastOutput: this.getLastOutputSnippet(),
			lastError: this.lastError
		};
	}

	async getSuggestedStartCommands(): Promise<DevServerSuggestedCommands | undefined> {
		const workspaceFolder = this.getPrimaryWorkspaceFolder();
		if (!workspaceFolder) {
			return undefined;
		}

		const detected = await this.detectPackageJson(workspaceFolder);
		if (!detected) {
			return undefined;
		}

		const { folder, packageJson } = detected;
		const packageManager = await this.detectPackageManager(folder, packageJson);
		const primaryScript = this.pickStartScript(packageJson);
		const installCommand = this.formatInstallCommand(packageManager);
		const primaryRunCommand = primaryScript ? this.formatRunCommand(packageManager, primaryScript) : undefined;
		const hasNodeModules = await this.fileService.exists(joinPath(folder, 'node_modules'));
		const combinedCommandLine = primaryRunCommand
			? (hasNodeModules ? primaryRunCommand : `${installCommand} && ${primaryRunCommand}`)
			: undefined;
		const inferredUrl = primaryScript ? this.inferDevUrl(packageJson, primaryScript) : undefined;

		return {
			workspaceFolder: folder,
			packageManager,
			installCommand,
			primaryScript,
			primaryRunCommand,
			combinedCommandLine,
			inferredUrl,
			listedScripts: this.listStartLikeScripts(packageJson, packageManager),
			hasNodeModules
		};
	}

	async ensureRunning(): Promise<string | undefined> {
		const workspaceFolder = this.getPrimaryWorkspaceFolder();
		if (!workspaceFolder) {
			return undefined;
		}

		// If the workspace changed since last run, reset and re-detect.
		if (!this.lastWorkspaceFolder || this.lastWorkspaceFolder.toString() !== workspaceFolder.toString()) {
			this.onWorkspaceChanged();
		}

		if (this.started) {
			return this.activeUrl;
		}

		const detected = await this.detectPackageJson(workspaceFolder);
		if (!detected) {
			return undefined;
		}

		const { folder, packageJson } = detected;

		const startScript = this.pickStartScript(packageJson);
		if (!startScript) {
			this.setPhase('error', `No runnable script found. Expected one of: dev, web, start.`);
			return undefined;
		}

		const needsInstall = !(await this.fileService.exists(joinPath(folder, 'node_modules')));
		this.script = startScript;
		this.lastError = undefined;

		// Infer URL early so UI can load immediately; gets replaced once terminal output contains the real URL.
		const inferredUrl = this.inferDevUrl(packageJson, startScript);
		this.setActiveUrl(inferredUrl);

		const instance = await this.terminalService.createTerminal({
			cwd: folder,
			config: isWindows ? undefined : { executable: '/bin/bash' }
		});
		instance.focus();

		// Parse output to learn the actual URL/port once the dev server prints it.
		this._register(instance.onData(data => this.tryExtractUrlFromTerminalData(data)));

		const packageManager = await this.detectPackageManager(folder, packageJson);
		const startCommand = this.formatRunCommand(packageManager, startScript);
		const installCommand = this.formatInstallCommand(packageManager);
		const fullCommand = needsInstall ? `${installCommand} && ${startCommand}` : startCommand;
		this.command = fullCommand;
		this.setPhase(needsInstall ? 'installing' : 'starting');

		// Best-effort: free only the inferred port(s) before starting.
		// Note: freePortKillProcess can surface notifications when it cannot enumerate processes;
		// to avoid noisy warnings, keep this scoped to ports that matter for the active project.
		const ranViaFreePort = await this.tryRunWithFreedPorts(instance, inferredUrl, fullCommand);
		if (!ranViaFreePort) {
			instance.sendText(fullCommand, true);
		}

		this.started = true;
		return this.activeUrl;
	}

	private setActiveUrl(url: string | undefined): void {
		if (this.activeUrl === url) {
			return;
		}

		this.activeUrl = url;
		this._onDidChangeActiveUrl.fire(url);
		this.fireState();
	}

	private async detectPackageJson(folder: URI): Promise<{ folder: URI; packageJson: PackageJson } | undefined> {
		const packageJsonResource = joinPath(folder, 'package.json');
		try {
			const content = (await this.fileService.readFile(packageJsonResource)).value.toString();
			const parsed = JSON.parse(content) as PackageJson;
			return { folder, packageJson: parsed };
		} catch {
			return undefined;
		}
	}

	private inferDevUrl(packageJson: PackageJson, startScript: string): string {
		const scripts = packageJson.scripts ?? {};
		const scriptBody = scripts[startScript] ?? '';

		const deps = {
			...(packageJson.dependencies ?? {}),
			...(packageJson.devDependencies ?? {})
		};

		const fromScript = this.extractPortFromScript(scriptBody);
		const port = fromScript
			?? (deps['vite'] ? 5173 : undefined)
			?? (deps['next'] ? 3000 : undefined)
			?? (deps['expo'] ? 8081 : undefined)
			?? (deps['@angular/cli'] ? 4200 : undefined)
			?? (deps['react-scripts'] ? 3000 : undefined)
			?? 3000;

		return `http://localhost:${port}`;
	}

	private extractPortFromScript(script: string): number | undefined {
		// Common patterns:
		// - vite: --port 5173 / --port=5173
		// - next: -p 3000 / --port 3000
		// - env: PORT=3000 ...
		const envPort = /\bPORT=(\d{2,5})\b/.exec(script);
		if (envPort) {
			return Number(envPort[1]);
		}

		const portLong = /\b--port(?:=|\s+)(\d{2,5})\b/.exec(script);
		if (portLong) {
			return Number(portLong[1]);
		}

		const portShort = /\b-p\s+(\d{2,5})\b/.exec(script);
		if (portShort) {
			return Number(portShort[1]);
		}

		return undefined;
	}

	private getPrimaryWorkspaceFolder(): URI | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri : undefined;
	}

	private onWorkspaceChanged(): void {
		this.lastWorkspaceFolder = this.getPrimaryWorkspaceFolder();
		this.started = false;
		this.outputBuffer = '';
		this.script = undefined;
		this.command = undefined;
		this.lastError = undefined;
		this.phase = 'idle';
		this.setActiveUrl(undefined);
		this.fireState();
	}

	private tryExtractUrlFromTerminalData(data: string): void {
		// Strip ANSI escape sequences and keep a rolling buffer so we can match across chunks.
		const cleaned = data.replaceAll(/\x1b\[[0-9;]*[A-Za-z]/g, '');
		this.outputBuffer = (this.outputBuffer + cleaned).slice(-16_384);
		this.detectFailureHints(this.outputBuffer);

		// Match common dev server output patterns.
		// Examples:
		//   "Local:   http://localhost:5173/"
		//   "ready - started server on 0.0.0.0:3000, url: http://localhost:3000"
		//   "http://127.0.0.1:3000"
		const urlMatch = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5})/i.exec(this.outputBuffer);
		if (urlMatch) {
			this.setActiveUrl(urlMatch[1]);
			this.setPhase('running');
			return;
		}

		const portMatch = /\b(?:localhost|127\.0\.0\.1)[: ](\d{2,5})\b/i.exec(this.outputBuffer);
		if (portMatch) {
			this.setActiveUrl(`http://localhost:${portMatch[1]}`);
			this.setPhase('running');
		}

		this.fireState();
	}

	private pickStartScript(packageJson: PackageJson): string | undefined {
		const scripts = packageJson.scripts ?? {};

		// Prefer dev if it exists, otherwise pick common alternatives.
		if (scripts['dev']) {
			return 'dev';
		}
		if (scripts['start']) {
			return 'start';
		}
		if (scripts['web']) {
			return 'web';
		}

		return undefined;
	}

	private async detectPackageManager(folder: URI, packageJson: PackageJson): Promise<DevServerPackageManager> {
		const field = packageJson.packageManager;
		if (typeof field === 'string') {
			const lower = field.toLowerCase();
			if (lower.startsWith('yarn')) {
				return 'yarn';
			}
			if (lower.startsWith('pnpm')) {
				return 'pnpm';
			}
		}
		if (await this.fileService.exists(joinPath(folder, 'pnpm-lock.yaml'))) {
			return 'pnpm';
		}
		if (await this.fileService.exists(joinPath(folder, 'yarn.lock'))) {
			return 'yarn';
		}
		return 'npm';
	}

	private formatInstallCommand(pm: DevServerPackageManager): string {
		if (pm === 'yarn') {
			return 'yarn install';
		}
		if (pm === 'pnpm') {
			return 'pnpm install';
		}
		return 'npm install';
	}

	private formatRunCommand(pm: DevServerPackageManager, script: string): string {
		if (pm === 'yarn') {
			return script === 'start' ? 'yarn start' : `yarn ${script}`;
		}
		if (pm === 'pnpm') {
			return script === 'start' ? 'pnpm start' : `pnpm run ${script}`;
		}
		return script === 'start' ? 'npm start' : `npm run ${script}`;
	}

	private listStartLikeScripts(packageJson: PackageJson, pm: DevServerPackageManager): { name: string; runCommand: string }[] {
		const scripts = packageJson.scripts ?? {};
		const priority = ['dev', 'web', 'start', 'serve', 'develop', 'preview'];
		const result: { name: string; runCommand: string }[] = [];
		for (const name of priority) {
			if (scripts[name]) {
				result.push({ name, runCommand: this.formatRunCommand(pm, name) });
			}
		}
		if (result.length === 0) {
			const keys = Object.keys(scripts);
			for (const name of keys.slice(0, 8)) {
				result.push({ name, runCommand: this.formatRunCommand(pm, name) });
			}
		}
		return result;
	}

	private setPhase(phase: DevServerPhase, error?: string): void {
		this.phase = phase;
		if (error) {
			this.lastError = error;
		}
		this.fireState();
	}

	private fireState(): void {
		this._onDidChangeState.fire(this.getState());
	}

	private getLastOutputSnippet(): string {
		const text = this.outputBuffer.trim();
		if (!text) {
			return '';
		}
		const lines = text.split(/\r?\n/);
		return lines.slice(-12).join('\n');
	}

	private detectFailureHints(buffer: string): void {
		if (/\bMissing script:\s*"[^"]+"/i.test(buffer)) {
			this.setPhase('error', 'Missing npm script. Check package.json scripts.');
		} else if (/\bcommand not found\b/i.test(buffer)) {
			this.setPhase('error', 'Command not found. Dependencies may be missing (run npm install).');
		} else if (/\bERR!\b/i.test(buffer) || /\bnpm error\b/i.test(buffer)) {
			this.setPhase('error', 'npm error detected. Check terminal output.');
		}
	}

	private async tryRunWithFreedPorts(
		instance: { freePortKillProcess: (port: string, commandToRun: string) => Promise<void> },
		inferredUrl: string,
		commandToRun: string
	): Promise<boolean> {
		const inferredPort = this.tryParsePortFromUrl(inferredUrl);
		if (typeof inferredPort !== 'number') {
			return false;
		}

		// Try primary inferred port. If this fails (e.g. cannot enumerate processes),
		// fall back to plain sendText with no extra notifications.
		try {
			await instance.freePortKillProcess(String(inferredPort), commandToRun);
			return true;
		} catch {
			// ignore
		}

		// Expo often suggests the next port; try that as a secondary option.
		try {
			await instance.freePortKillProcess(String(inferredPort + 1), commandToRun);
			return true;
		} catch {
			// ignore
		}

		return false;
	}

	private tryParsePortFromUrl(url: string): number | undefined {
		const match = /:(\d{2,5})(?:\/|$)/.exec(url);
		if (!match) {
			return undefined;
		}
		const port = Number(match[1]);
		return Number.isFinite(port) ? port : undefined;
	}
}

registerSingleton(IDevServerService, DevServerService, InstantiationType.Delayed);


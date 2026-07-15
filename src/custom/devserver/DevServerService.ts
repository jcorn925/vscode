/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { basename, joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { isWindows } from '../../vs/base/common/platform.js';
import { createDecorator, IInstantiationService } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';
import { ITerminalInstance, ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { killProcessListeningOnPort } from './surfaceDevPortFreeing.js';
import { parsePortFromLocalUrl } from './surfaceDevPortUtils.js';

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
	ensureRunningWithCommand(command: string, preferredUrl: string | undefined, label?: string): Promise<string | undefined>;
	getSuggestedStartCommands(): Promise<DevServerSuggestedCommands | undefined>;
	/**
	 * Probes `preferredUrl` (and a couple of fallback ports such as `port+1`, `port+2`) to see
	 * whether something is already accepting connections. Returns the first URL that responded,
	 * or `undefined` if nothing is listening. Intended to be the single source of truth for
	 * "is the dev server already running?".
	 */
	findRunningDevServerUrl(preferredUrl: string | undefined, options?: { allowNearbyPorts?: boolean }): Promise<string | undefined>;
	/**
	 * Probes whether a dev server is already listening for the open workspace (e.g. started in an
	 * external terminal) and, if so, publishes `activeUrl` and `phase: running`.
	 */
	syncActiveUrlFromProbe(): Promise<string | undefined>;
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
	private attachedTerminalId: number | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
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
			if (this.activeUrl) {
				return this.activeUrl;
			}
			return this.syncActiveUrlFromProbe();
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

		// Infer the URL for probing and command hints, but do not publish it until a
		// server actually responds. Publishing an unverified URL makes the embedded
		// preview navigate too early and show ERR_CONNECTION_REFUSED during startup.
		const inferredUrl = this.inferDevUrl(packageJson, startScript);

		const packageManager = await this.detectPackageManager(folder, packageJson);
		const startCommand = this.formatRunCommand(packageManager, startScript);
		const installCommand = this.formatInstallCommand(packageManager);
		const fullCommand = needsInstall ? `${installCommand} && ${startCommand}` : startCommand;
		this.command = fullCommand;

		// The URL probe is the single source of truth for "is the dev server already running?".
		// We deliberately don't trust signals like `terminal.hasChildProcesses` here — a persistent
		// terminal across a window reload still has a shell process attached, which would lead us
		// to skip injection even when nothing is actually serving on the port.
		const reachableUrl = await this.findRunningDevServerUrl(inferredUrl);
		if (reachableUrl) {
			this.setActiveUrl(reachableUrl);
			this.setPhase('running');
			this.started = true;
			return this.activeUrl;
		}

		const { instance } = await this.getOrCreateDevServerTerminal(folder);

		// Make our terminal the active instance in its group — `revealTerminal` only opens the
		// panel, it does NOT switch the visible terminal. Without this our newly-created Dev
		// Server terminal can stay hidden behind whatever was active before, xterm never attaches
		// to it, and the PTY stays stuck at its tiny default column count.
		this.terminalService.setActiveInstance(instance);

		// Reveal the terminal in the panel so its xterm view attaches to a real container and
		// triggers a PTY resize. Without this `npm` / Next.js banner output wraps at ~16 chars.
		await this.terminalService.revealTerminal(instance, true);

		// Parse output to learn the actual URL/port once the dev server prints it.
		this.attachTerminalDataListener(instance);

		this.setPhase(needsInstall ? 'installing' : 'starting');

		// Defer sending the start command until xterm has attached and the PTY has resized to a
		// real column count. Otherwise `npm run dev` prints its multi-line banner into a 16-col
		// buffer and the wrapped lines stay wrapped forever, even after the panel reaches its
		// real width.
		await this.waitForReasonableTerminalWidth(instance);

		await this.freePortBeforeStart(inferredUrl);

		// Inject the start command exactly once for this session.
		instance.sendText(fullCommand, true);

		this.started = true;
		return this.activeUrl;
	}

	async ensureRunningWithCommand(command: string, preferredUrl: string | undefined, label?: string): Promise<string | undefined> {
		const workspaceFolder = this.getPrimaryWorkspaceFolder();
		const explicitCommand = command.trim();
		if (!workspaceFolder || !explicitCommand) {
			return undefined;
		}

		if (!this.lastWorkspaceFolder || this.lastWorkspaceFolder.toString() !== workspaceFolder.toString()) {
			this.onWorkspaceChanged();
		}

		const alignedCommand = this.alignCommandToPreferredPort(explicitCommand, preferredUrl);
		const reachableUrl = await this.findRunningDevServerUrl(preferredUrl, { allowNearbyPorts: false });
		const ownsReachableUrl = reachableUrl === this.activeUrl && Boolean(this.command?.endsWith(alignedCommand));
		if (reachableUrl && ownsReachableUrl) {
			this.setActiveUrl(reachableUrl);
			this.setPhase('running');
			this.started = true;
			return this.activeUrl;
		}

		const { instance } = await this.getOrCreateDevServerTerminal(workspaceFolder, label);
		this.terminalService.setActiveInstance(instance);
		await this.terminalService.revealTerminal(instance, true);
		this.attachTerminalDataListener(instance);

		const commandToRun = await this.resolveCommandWithSurfaceInstall(workspaceFolder, alignedCommand);

		this.script = undefined;
		this.command = commandToRun;
		this.lastError = undefined;
		this.setPhase(commandToRun !== explicitCommand ? 'installing' : 'starting');
		await this.waitForReasonableTerminalWidth(instance);
		await this.freePortBeforeStart(preferredUrl, alignedCommand);
		instance.sendText(commandToRun, true);

		this.started = true;
		if (preferredUrl) {
			const detectedUrl = await this.findRunningDevServerUrl(preferredUrl, { allowNearbyPorts: false });
			if (detectedUrl) {
				this.setActiveUrl(detectedUrl);
				this.setPhase('running');
				return this.activeUrl;
			}
			// Keep UI flow alive while the process boots; reachability checks will reconcile.
			return preferredUrl;
		}
		return this.activeUrl;
	}

	private alignCommandToPreferredPort(command: string, preferredUrl: string | undefined): string {
		const preferredPort = this.tryParsePortFromUrl(preferredUrl ?? '');
		if (typeof preferredPort !== 'number') {
			return command;
		}

		const isScriptRunCommand = /\b(?:npm|pnpm)\b.*\brun\s+dev\b/i.test(command) || /\byarn\b.*\bdev\b/i.test(command);
		const isDirectNextDev = /\bnext\s+dev\b/i.test(command);
		if (!isScriptRunCommand && !isDirectNextDev) {
			return command;
		}

		const normalized = this.removePortFlags(command, isScriptRunCommand);
		if (isScriptRunCommand) {
			return `${normalized} -- --port ${preferredPort}`;
		}
		return `${normalized} --port ${preferredPort}`;
	}

	/**
	 * Removes explicit port flags so repeated launch attempts don't accumulate
	 * duplicate `-- --port` or `--port` arguments.
	 */
	private removePortFlags(command: string, isScriptRunCommand: boolean): string {
		let next = command;

		// Remove environment-style port assignment.
		next = next.replace(/\bPORT=\d{2,5}\b/g, '').trim();
		// For npm/pnpm/yarn script passthrough, remove any existing `-- --port`.
		if (isScriptRunCommand) {
			next = next.replace(/\s+--\s+(?:--\s+)*--port(?:=|\s+)\d{2,5}\b/g, '');
			next = next.replace(/\s+--\s+(?:--\s+)*-p\s+\d{2,5}\b/g, '');
			// Also guard malformed repeated separators from prior bad appends.
			next = next.replace(/\s+--\s*$/g, '');
		}
		// Remove direct CLI port flags.
		next = next.replace(/\s--port(?:=|\s+)\d{2,5}\b/g, '');
		next = next.replace(/\s-p\s+\d{2,5}\b/g, '');

		return next.replace(/\s{2,}/g, ' ').trim();
	}

	private async resolveCommandWithSurfaceInstall(workspaceFolder: URI, command: string): Promise<string> {
		const appPath = this.parseSurfaceAppPath(command);
		if (!appPath) {
			return command;
		}

		const appFolder = joinPath(workspaceFolder, ...appPath.split('/').filter(Boolean));
		if (await this.fileService.exists(joinPath(appFolder, 'node_modules'))) {
			return command;
		}

		const detected = await this.detectPackageJson(appFolder);
		if (!detected) {
			return command;
		}
		const packageManager = await this.detectPackageManager(detected.folder, detected.packageJson);
		const installCommand = this.formatSurfaceInstallCommand(packageManager, appPath, command);
		return `${installCommand} && ${command}`;
	}

	private parseSurfaceAppPath(command: string): string | undefined {
		const npmPrefixAfterRun = /\bnpm\s+run\s+\S+\s+--prefix\s+(\S+)/i.exec(command);
		if (npmPrefixAfterRun) {
			return npmPrefixAfterRun[1];
		}
		const prefixMatch = /\bnpm\s+--prefix\s+(\S+)/i.exec(command);
		if (prefixMatch) {
			return prefixMatch[1];
		}
		const pnpmDir = /\bpnpm\s+--dir\s+(\S+)/i.exec(command);
		if (pnpmDir) {
			return pnpmDir[1];
		}
		const yarnCwd = /\byarn\s+--cwd\s+(\S+)/i.exec(command);
		if (yarnCwd) {
			return yarnCwd[1];
		}
		const workspaceMatch = /--workspace\s+(\S+)/i.exec(command);
		if (workspaceMatch) {
			return workspaceMatch[1];
		}
		return undefined;
	}

	private formatSurfaceInstallCommand(pm: DevServerPackageManager, appPath: string, command: string): string {
		if (/\bnpm\s+--prefix\s+/i.test(command)) {
			if (pm === 'pnpm') {
				return `pnpm install --prefix ${appPath}`;
			}
			if (pm === 'yarn') {
				return `yarn --cwd ${appPath} install`;
			}
			return `npm install --prefix ${appPath}`;
		}
		if (/--workspace\s+/i.test(command)) {
			if (pm === 'pnpm') {
				return `pnpm install --filter ${appPath}`;
			}
			if (pm === 'yarn') {
				return `yarn workspace ${appPath} install`;
			}
			return `npm install --workspace ${appPath}`;
		}
		return pm === 'pnpm' ? `pnpm install --prefix ${appPath}` : pm === 'yarn' ? `yarn --cwd ${appPath} install` : `npm install --prefix ${appPath}`;
	}

	/**
	 * Resolves once `instance.cols` reports a sane terminal width (at least 40 cols), or after a short
	 * timeout. Combined with `setActiveInstance` + `revealTerminal`, this is what guarantees the
	 * dev server's first output is wrapped at the panel's real width instead of the PTY default.
	 */
	private waitForReasonableTerminalWidth(instance: ITerminalInstance, minCols = 40, timeoutMs = 1500): Promise<void> {
		if (instance.cols >= minCols) {
			return Promise.resolve();
		}
		return new Promise<void>(resolve => {
			let settled = false;
			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				dimDisposable.dispose();
				clearTimeout(timer);
				resolve();
			};
			const dimDisposable = instance.onDimensionsChanged(() => {
				if (instance.cols >= minCols) {
					finish();
				}
			});
			const timer = setTimeout(finish, timeoutMs);
		});
	}

	async findRunningDevServerUrl(preferredUrl: string | undefined, options?: { allowNearbyPorts?: boolean }): Promise<string | undefined> {
		if (!preferredUrl) {
			return undefined;
		}
		const allowNearbyPorts = options?.allowNearbyPorts ?? true;
		for (const candidate of this.expandCandidateUrls(preferredUrl, allowNearbyPorts)) {
			if (await this.probeUrl(candidate, 1500)) {
				return candidate;
			}
		}
		return undefined;
	}

	private expandCandidateUrls(url: string, allowNearbyPorts: boolean): string[] {
		const port = this.tryParsePortFromUrl(url);
		if (typeof port !== 'number' || !allowNearbyPorts) {
			return [url];
		}
		// Frameworks like Vite/Next.js bump to the next available port if the configured one is
		// busy. Also probe one lower port to catch fallback from 3001 -> 3000.
		const replace = (p: number) => url.replace(`:${port}`, `:${p}`);
		const candidates = [
			replace(port),
			replace(port + 1),
			replace(port + 2),
			port > 1 ? replace(port - 1) : undefined,
		].filter((candidate): candidate is string => Boolean(candidate));
		return Array.from(new Set(candidates));
	}

	private async probeUrl(url: string, timeoutMs: number): Promise<boolean> {
		if (typeof fetch !== 'function') {
			return false;
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			// `no-cors` lets the promise resolve when the server is up even if it doesn't allow
			// our origin — we only care whether something is accepting connections on the port.
			// `cache: 'no-store'` defends against a stale 200 from a prior load surviving on the
			// HTTP cache after the dev server has been killed.
			await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controller.signal });
			return true;
		} catch {
			return false;
		} finally {
			clearTimeout(timeout);
		}
	}

	private tryParsePortFromUrl(url: string): number | undefined {
		return parsePortFromLocalUrl(url);
	}

	private parsePortFromCommand(command: string): number | undefined {
		const portFlag = /\b--port(?:=|\s+)(\d{2,5})\b/i.exec(command) ?? /\s-p\s+(\d{2,5})\b/i.exec(command);
		if (!portFlag) {
			return undefined;
		}
		const port = Number(portFlag[1]);
		return Number.isFinite(port) ? port : undefined;
	}

	private async freePortBeforeStart(preferredUrl: string | undefined, command?: string): Promise<void> {
		const ports = new Set<number>();
		const urlPort = this.tryParsePortFromUrl(preferredUrl ?? '');
		if (urlPort) {
			ports.add(urlPort);
		}
		const commandPort = command ? this.parsePortFromCommand(command) : undefined;
		if (commandPort) {
			ports.add(commandPort);
		}
		await Promise.all([...ports].map(port => killProcessListeningOnPort(port, this.instantiationService)));
	}

	private getDevServerTerminalTitle(folder: URI, label?: string): string {
		const suffix = label?.trim();
		return suffix ? `Dev Server — ${basename(folder)} — ${suffix}` : `Dev Server — ${basename(folder)}`;
	}

	private async getOrCreateDevServerTerminal(folder: URI, label?: string): Promise<{ instance: ITerminalInstance; isExisting: boolean }> {
		const expectedTitle = this.getDevServerTerminalTitle(folder, label);
		// Match strictly: only a terminal we previously labelled "Dev Server …". The looser
		// "any terminal whose cwd is the workspace folder" match would pick up the user's
		// regular shell terminals and cause us to send `npm run dev` into them.
		const existing = this.terminalService.instances.find(i =>
			i.title === expectedTitle
			|| (!label && typeof i.title === 'string' && i.title.startsWith('Dev Server') && this.terminalLaunchCwdMatches(i, folder))
		);
		if (existing) {
			return { instance: existing, isExisting: true };
		}

		const instance = await this.terminalService.createTerminal({
			cwd: folder,
			config: isWindows ? undefined : { executable: '/bin/bash' }
		});
		// Make it discoverable across reloads.
		await instance.rename(expectedTitle);
		return { instance, isExisting: false };
	}

	private terminalLaunchCwdMatches(instance: ITerminalInstance, folder: URI): boolean {
		const cwd = instance.shellLaunchConfig.cwd;
		if (!cwd) {
			return false;
		}
		const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').trim().toLowerCase();
		const folderFs = normalizePath(folder.fsPath);
		const folderStr = normalizePath(folder.toString());
		const folderBase = String(basename(folder) ?? '').toLowerCase();
		const matches = (candidate: string) => {
			const c = normalizePath(candidate);
			if (!c) {
				return false;
			}
			if (c === folderFs || c === folderStr) {
				return true;
			}
			// Some terminals report CWD as a child path (or with a different prefix); accept basename match as a fallback.
			return Boolean(folderBase) && (c.endsWith('/' + folderBase) || c === folderBase);
		};
		if (typeof cwd === 'string') {
			return matches(cwd);
		}
		return matches(cwd.toString());
	}

	private attachTerminalDataListener(instance: ITerminalInstance): void {
		const instanceId = instance?.instanceId;
		if (typeof instanceId === 'number' && this.attachedTerminalId === instanceId) {
			return;
		}
		if (typeof instanceId === 'number') {
			this.attachedTerminalId = instanceId;
		}
		this._register(instance.onData((data: string) => this.tryExtractUrlFromTerminalData(data)));
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
		const folder = this.getPrimaryWorkspaceFolder();
		this.lastWorkspaceFolder = folder;
		this.started = false;
		this.outputBuffer = '';
		this.script = undefined;
		this.command = undefined;
		this.lastError = undefined;
		this.phase = 'idle';
		this.setActiveUrl(undefined);
		this.fireState();
		void this.probeAlreadyRunningDevServer(folder);
	}

	async syncActiveUrlFromProbe(): Promise<string | undefined> {
		const folder = this.getPrimaryWorkspaceFolder();
		if (!folder) {
			return undefined;
		}
		const detected = await this.detectPackageJson(folder);
		if (!detected || this.lastWorkspaceFolder?.toString() !== folder.toString()) {
			return undefined;
		}
		const startScript = this.pickStartScript(detected.packageJson);
		if (!startScript) {
			return undefined;
		}
		const inferredUrl = this.inferDevUrl(detected.packageJson, startScript);
		const reachableUrl = await this.findRunningDevServerUrl(inferredUrl);
		if (!reachableUrl || this.lastWorkspaceFolder?.toString() !== folder.toString()) {
			return undefined;
		}
		this.script = startScript;
		if (this.activeUrl !== reachableUrl || this.phase !== 'running') {
			this.setActiveUrl(reachableUrl);
			this.setPhase('running');
		}
		this.started = true;
		return reachableUrl;
	}

	/** If a dev server is already listening (e.g. started in an external terminal), publish its URL. */
	private async probeAlreadyRunningDevServer(folder: URI | undefined): Promise<void> {
		if (!folder || this.lastWorkspaceFolder?.toString() !== folder.toString()) {
			return;
		}
		await this.syncActiveUrlFromProbe();
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
		const isRunnable = (script: string | undefined): boolean => {
			if (!script?.trim()) {
				return false;
			}
			// An echo-only script is documentation or a placeholder, not a persistent
			// dev server. Commands that continue after the echo remain eligible.
			return !/^\s*echo\b[^;&|\n]*$/i.test(script);
		};

		// Prefer dev if it exists, otherwise pick common alternatives.
		if (isRunnable(scripts['dev'])) {
			return 'dev';
		}
		if (isRunnable(scripts['start'])) {
			return 'start';
		}
		if (isRunnable(scripts['web'])) {
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

}

registerSingleton(IDevServerService, DevServerService, InstantiationType.Delayed);

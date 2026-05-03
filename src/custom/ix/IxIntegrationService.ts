/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable, DisposableStore } from '../../vs/base/common/lifecycle.js';
import { isWeb, isWindows } from '../../vs/base/common/platform.js';
import { URI } from '../../vs/base/common/uri.js';
import { RunOnceScheduler } from '../../vs/base/common/async.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../vs/platform/configuration/common/configuration.js';
import { IWorkspaceContextService, WorkbenchState } from '../../vs/platform/workspace/common/workspace.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { IStorageService, StorageScope, StorageTarget } from '../../vs/platform/storage/common/storage.js';
import { INotificationService, Severity } from '../../vs/platform/notification/common/notification.js';
import { ILifecycleService } from '../../vs/workbench/services/lifecycle/common/lifecycle.js';
import { IOpenerService } from '../../vs/platform/opener/common/opener.js';
import { localize } from '../../vs/nls.js';

export type IxPhase = 'idle' | 'installing' | 'docker' | 'mapping' | 'watching' | 'error';

export interface IxIntegrationState {
	readonly phase: IxPhase;
	readonly lastCommand: string | undefined;
	readonly lastError: string | undefined;
	readonly lastOutput: string;
}

export interface IIxIntegrationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<IxIntegrationState>;
	getState(): IxIntegrationState;
	restart(): Promise<void>;
	installOrResolve(): Promise<void>;
	openDocs(): Promise<void>;
}

export const IIxIntegrationService = createDecorator<IIxIntegrationService>('ixIntegrationService');

const STORAGE_IX_CLI = 'custom.ix/resolvedCliPath';

const OUTPUT_TAIL = 16_384;

function stripAnsi(data: string): string {
	return data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function tailOutput(text: string): string {
	const t = stripAnsi(text).trim();
	if (!t) {
		return '';
	}
	const lines = t.split(/\r?\n/);
	return lines.slice(-24).join('\n');
}

export class IxIntegrationService extends Disposable implements IIxIntegrationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IxIntegrationState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private phase: IxPhase = 'idle';
	private lastCommand: string | undefined;
	private lastError: string | undefined;
	private outputBuffer = '';

	private pipelineGeneration = 0;
	private readonly watchInstances = new Map<string, DisposableStore>();
	private readonly startScheduler = this._register(new RunOnceScheduler(() => void this.runAutoStartPipeline(), 900));

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();

		if (isWeb) {
			return;
		}

		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.scheduleStart()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.scheduleStart()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('custom.ix')) {
				this.scheduleStart();
			}
		}));
		this._register(this.lifecycleService.onWillShutdown(() => this.disposeWatchers()));

		this.scheduleStart();
	}

	getState(): IxIntegrationState {
		return {
			phase: this.phase,
			lastCommand: this.lastCommand,
			lastError: this.lastError,
			lastOutput: this.getLastOutputSnippet(),
		};
	}

	private getLastOutputSnippet(): string {
		return tailOutput(this.outputBuffer);
	}

	private pushOutput(chunk: string): void {
		this.outputBuffer = (this.outputBuffer + chunk).slice(-OUTPUT_TAIL);
		this.fireState();
	}

	private setPhase(phase: IxPhase, error?: string): void {
		this.phase = phase;
		if (error) {
			this.lastError = error;
		}
		this.fireState();
	}

	private fireState(): void {
		this._onDidChangeState.fire(this.getState());
	}

	private scheduleStart(): void {
		if (isWeb) {
			return;
		}
		this.startScheduler.schedule();
	}

	private isIxAutomationEnabled(): boolean {
		if (isWeb) {
			return false;
		}
		return Boolean(this.configurationService.getValue<boolean>('custom.ix.enabled') ?? true);
	}

	private isAutoStartEnabled(): boolean {
		return Boolean(this.configurationService.getValue<boolean>('custom.ix.autoStart') ?? true);
	}

	private getInstallUrl(): string {
		const raw = this.configurationService.getValue<string>('custom.ix.installScriptUrl');
		const url = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'https://ix-infra.com/install.sh';
		return url;
	}

	private getConfiguredCliPath(): string | undefined {
		const raw = this.configurationService.getValue<string>('custom.ix.cliPath');
		if (typeof raw === 'string') {
			const t = raw.trim();
			return t.length > 0 ? t : undefined;
		}
		return undefined;
	}

	private shellLaunchForCommand(commandLine: string): { executable: string; args: string[] } {
		if (isWindows) {
			return { executable: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
		}
		return { executable: '/bin/bash', args: ['-c', commandLine] };
	}

	private async runCommand(cwd: URI | undefined, commandLine: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
		const shell = this.shellLaunchForCommand(commandLine);
		const store = new DisposableStore();
		let buf = '';
		try {
			this.lastCommand = commandLine;
			this.fireState();

			const instance = await this.terminalService.createTerminal({
				cwd,
				config: {
					...shell,
					name: 'Ix',
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			});
			store.add(instance);
			store.add(instance.onData(d => {
				buf += d;
				this.pushOutput(d);
			}));

			const exitCode = await new Promise<number>((resolve, reject) => {
				const handle = setTimeout(() => reject(new Error('timeout')), timeoutMs);
				store.add({ dispose: () => clearTimeout(handle) });
				store.add(instance.onExit(code => {
					clearTimeout(handle);
					if (typeof code === 'number') {
						resolve(code);
					} else {
						resolve(1);
					}
				}));
			});

			return { exitCode, output: stripAnsi(buf) };
		} finally {
			store.dispose();
		}
	}

	private probeCommand(): string {
		return isWindows ? 'where ix >nul 2>nul' : 'command -v ix';
	}

	private async resolveIxBinary(cwd: URI): Promise<string | undefined> {
		const configured = this.getConfiguredCliPath();
		if (configured) {
			return configured;
		}

		const cached = this.storageService.get(STORAGE_IX_CLI, StorageScope.APPLICATION);
		if (cached && cached.length > 0) {
			return cached;
		}

		const probe = this.probeCommand();
		const r = await this.runCommand(cwd, probe, 30_000);
		if (r.exitCode !== 0) {
			return undefined;
		}

		if (isWindows) {
			const w = await this.runCommand(cwd, 'where ix', 30_000);
			const line = w.output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
			if (line) {
				this.storageService.store(STORAGE_IX_CLI, line, StorageScope.APPLICATION, StorageTarget.MACHINE);
				return line;
			}
			return 'ix';
		}

		const line = r.output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
		if (line) {
			this.storageService.store(STORAGE_IX_CLI, line, StorageScope.APPLICATION, StorageTarget.MACHINE);
			return line;
		}
		return 'ix';
	}

	private buildInstallCommand(): string {
		const url = this.getInstallUrl();
		if (isWindows) {
			const safe = url.replace(/'/g, "''");
			return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-Expression (Invoke-WebRequest -UseBasicParsing -Uri '${safe}').Content"`;
		}
		const safe = url.replace(/'/g, `'\\''`);
		return `curl -fsSL '${safe}' | sh`;
	}

	private async ensureInstalled(cwd: URI, gen: number): Promise<string | undefined> {
		let binary = await this.resolveIxBinary(cwd);
		if (binary) {
			return binary;
		}

		const allowInstall = Boolean(this.configurationService.getValue<boolean>('custom.ix.autoInstall') ?? true);
		if (!allowInstall) {
			this.setPhase('error', localize('ix.error.noCli', 'The ix CLI was not found and automatic installation is disabled (custom.ix.autoInstall).'));
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('ix.notify.noCli', 'Ix CLI not found. Install ix manually or enable custom.ix.autoInstall.'),
			});
			return undefined;
		}

		if (gen !== this.pipelineGeneration) {
			return undefined;
		}

		this.setPhase('installing');
		const installCmd = this.buildInstallCommand();
		try {
			const r = await this.runCommand(cwd, installCmd, 600_000);
			if (gen !== this.pipelineGeneration) {
				return undefined;
			}
			if (r.exitCode !== 0) {
				this.setPhase('error', localize('ix.error.installFailed', 'Ix install script failed (exit {0}).', String(r.exitCode)));
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('ix.notify.installFailed', 'Ix installation failed. Check the Process tab log or install ix manually.'),
				});
				return undefined;
			}
		} catch (e) {
			if (gen !== this.pipelineGeneration) {
				return undefined;
			}
			this.setPhase('error', String(e));
			this.notificationService.notify({ severity: Severity.Error, message: String(e) });
			return undefined;
		}

		this.storageService.remove(STORAGE_IX_CLI, StorageScope.APPLICATION);
		binary = await this.resolveIxBinary(cwd);
		if (!binary) {
			this.setPhase('error', localize('ix.error.afterInstall', 'Ix install finished but `ix` is still not on PATH.'));
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('ix.notify.afterInstall', 'Ix was installed but could not be detected on PATH. Restart VS Code or set custom.ix.cliPath.'),
			});
		}
		return binary;
	}

	private getPrimaryFolder(): URI | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri : undefined;
	}

	private async runAutoStartPipeline(): Promise<void> {
		if (isWeb || !this.isIxAutomationEnabled() || !this.isAutoStartEnabled()) {
			this.setPhase('idle');
			return;
		}

		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.disposeWatchers();
			this.setPhase('idle');
			this.lastCommand = undefined;
			this.lastError = undefined;
			this.outputBuffer = '';
			this.fireState();
			return;
		}

		const gen = ++this.pipelineGeneration;
		const primary = this.getPrimaryFolder();
		if (!primary) {
			return;
		}

		this.lastError = undefined;
		this.outputBuffer = '';

		const ix = await this.ensureInstalled(primary, gen);
		if (!ix || gen !== this.pipelineGeneration) {
			return;
		}

		this.setPhase('docker');
		try {
			const docker = await this.runCommand(primary, `${this.quoteIx(ix)} docker start`, 300_000);
			if (gen !== this.pipelineGeneration) {
				return;
			}
			if (docker.exitCode !== 0) {
				const tail = tailOutput(this.outputBuffer);
				const detail = tail
					? localize('ix.error.dockerWithLog', '`ix docker start` failed (exit {0}). Recent output:\n\n{1}', String(docker.exitCode), tail)
					: localize('ix.error.docker', '`ix docker start` failed (exit {0}). Is Docker running?', String(docker.exitCode));
				this.setPhase('error', detail);
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('ix.notify.docker', 'Ix Docker backend failed to start. See Process tab for details.'),
				});
				return;
			}
		} catch (e) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			this.setPhase('error', String(e));
			this.notificationService.notify({ severity: Severity.Error, message: String(e) });
			return;
		}

		this.setPhase('mapping');
		const folders = this.workspaceContextService.getWorkspace().folders;
		for (const folder of folders) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			try {
				const map = await this.runCommand(folder.uri, `${this.quoteIx(ix)} map`, 600_000);
				if (gen !== this.pipelineGeneration) {
					return;
				}
				if (map.exitCode !== 0) {
					this.setPhase('error', localize('ix.error.map', '`ix map` failed for {0} (exit {1}).', folder.name, String(map.exitCode)));
					this.notificationService.notify({
						severity: Severity.Error,
						message: localize('ix.notify.map', 'Ix map failed for folder {0}.', folder.name),
					});
					return;
				}
			} catch (e) {
				if (gen !== this.pipelineGeneration) {
					return;
				}
				this.setPhase('error', String(e));
				this.notificationService.notify({ severity: Severity.Error, message: String(e) });
				return;
			}
		}

		if (gen !== this.pipelineGeneration) {
			return;
		}

		this.startWatchers(ix, gen);
		this.setPhase('watching');
	}

	private quoteIx(ixPath: string): string {
		if (/\s/.test(ixPath)) {
			if (isWindows) {
				return `"${ixPath.replace(/"/g, '\\"')}"`;
			}
			return `'${ixPath.replace(/'/g, `'\\''`)}'`;
		}
		return ixPath;
	}

	private startWatchers(ix: string, gen: number): void {
		this.disposeWatchers();
		const folders = this.workspaceContextService.getWorkspace().folders;
		for (const folder of folders) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			const key = folder.uri.toString();
			void this.terminalService.createTerminal({
				cwd: folder.uri,
				config: {
					...this.shellLaunchForCommand(`${this.quoteIx(ix)} watch`),
					name: `Ix watch (${folder.name})`,
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			}).then(instance => {
				if (gen !== this.pipelineGeneration) {
					instance.dispose();
					return;
				}
				const store = new DisposableStore();
				store.add(instance);
				store.add(instance.onData(d => this.pushOutput(`[watch:${folder.name}] ${d}`)));
				store.add(instance.onDisposed(() => {
					this.watchInstances.delete(key);
					if (!store.isDisposed) {
						store.dispose();
					}
				}));
				this.watchInstances.set(key, store);
			});
		}
	}

	override dispose(): void {
		this.disposeWatchers();
		super.dispose();
	}

	private disposeWatchers(): void {
		const stores = [...this.watchInstances.values()];
		this.watchInstances.clear();
		for (const s of stores) {
			s.dispose();
		}
	}

	async restart(): Promise<void> {
		if (isWeb) {
			return;
		}
		this.pipelineGeneration++;
		this.disposeWatchers();
		this.scheduleStart();
	}

	async installOrResolve(): Promise<void> {
		if (isWeb) {
			return;
		}
		const primary = this.getPrimaryFolder();
		if (!primary) {
			return;
		}
		this.storageService.remove(STORAGE_IX_CLI, StorageScope.APPLICATION);
		await this.ensureInstalled(primary, this.pipelineGeneration);
		this.fireState();
	}

	async openDocs(): Promise<void> {
		await this.openerService.open(URI.parse('https://ix-infra.com/docs/'));
	}
}

registerSingleton(IIxIntegrationService, IxIntegrationService, InstantiationType.Delayed);

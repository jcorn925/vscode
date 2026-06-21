/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable, DisposableStore } from '../../vs/base/common/lifecycle.js';
import { isMacintosh, isWeb, isWindows } from '../../vs/base/common/platform.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../vs/platform/configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../vs/platform/environment/common/environment.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../vs/platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../vs/platform/workspace/common/workspace.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { DockerAvailabilityStatus, IDockerAvailabilityService } from '../docker/DockerAvailabilityService.js';
import { IDefaultProjectService } from '../devserver/DefaultProjectService.js';
import { IIxIntegrationService } from '../ix/IxIntegrationService.js';
import {
	buildIxInstallScriptCommand,
	buildShellEnvPreamble,
	ensureHomebrewShellEnvInProfile,
	HOMEBREW_INSTALL_CMD,
	HOMEBREW_PATH_MANUAL_HINT,
	IX_DEFAULT_INSTALL_URL,
	IX_INSTALL_MANUAL_HINT,
	resolveInstalledIxPath,
} from '../ix/ixInstallHelpers.js';
import { IOpenerService } from '../../vs/platform/opener/common/opener.js';
import { localize } from '../../vs/nls.js';

export type StartupGuideStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'warning';

export type StartupGuideStepId =
	| 'node'
	| 'homebrew'
	| 'git'
	| 'docker'
	| 'workspace'
	| 'ix-cli'
	| 'ix-backend';

export interface StartupGuideStepSnapshot {
	readonly id: StartupGuideStepId;
	readonly label: string;
	readonly description: string;
	readonly status: StartupGuideStepStatus;
	readonly detail: string;
	readonly manualHint: string;
	readonly canAutoFix: boolean;
	readonly autoFixLabel: string | undefined;
}

export interface StartupGuideState {
	readonly steps: ReadonlyArray<StartupGuideStepSnapshot>;
	readonly incompleteCount: number;
	readonly isRefreshing: boolean;
	readonly isAutoFixRunning: boolean;
}

export interface IStartupGuideService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<StartupGuideState>;
	getState(): StartupGuideState;
	shouldShowOnStartup(): boolean;
	markDismissed(): void;
	clearDismissed(): void;
	refresh(): Promise<void>;
	runAutomaticFixes(): Promise<void>;
	runStepFix(stepId: StartupGuideStepId): Promise<void>;
	openHomebrewInstallTerminal(): Promise<void>;
}

export const IStartupGuideService = createDecorator<IStartupGuideService>('startupGuideService');

const STORAGE_DISMISSED = 'custom.startupGuide/dismissed';
const STORAGE_IX_VERSION = 'custom.startupGuide/ixVersion';
const IX_DEFAULT_VERSION = '0.8.1';

interface StepMutable {
	readonly id: StartupGuideStepId;
	readonly label: string;
	readonly description: string;
	status: StartupGuideStepStatus;
	detail: string;
	readonly manualHint: string;
	readonly canAutoFix: boolean;
	readonly autoFixLabel: string | undefined;
}

export class StartupGuideService extends Disposable implements IStartupGuideService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<StartupGuideState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private readonly steps: StepMutable[];
	private isRefreshing = false;
	private isAutoFixRunning = false;
	private refreshInFlight: Promise<void> | undefined;

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IDockerAvailabilityService private readonly dockerAvailabilityService: IDockerAvailabilityService,
		@IDefaultProjectService private readonly defaultProjectService: IDefaultProjectService,
		@IIxIntegrationService private readonly ixIntegrationService: IIxIntegrationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this.steps = this.buildSteps();

		if (isWeb) {
			return;
		}

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.scheduleRefresh()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => void this.scheduleRefresh()));
		this._register(this.dockerAvailabilityService.onDidChangeStatus(() => void this.scheduleRefresh()));

		void this.refresh();
	}

	getState(): StartupGuideState {
		return this.snapshot();
	}

	shouldShowOnStartup(): boolean {
		if (isWeb) {
			return false;
		}
		if (!Boolean(this.configurationService.getValue<boolean>('custom.startupGuide.showOnIncomplete') ?? true)) {
			return false;
		}
		if (this.storageService.getBoolean(STORAGE_DISMISSED, StorageScope.APPLICATION, false)) {
			return false;
		}
		return this.snapshot().incompleteCount > 0;
	}

	markDismissed(): void {
		this.storageService.store(STORAGE_DISMISSED, true, StorageScope.APPLICATION, StorageTarget.USER);
	}

	clearDismissed(): void {
		this.storageService.remove(STORAGE_DISMISSED, StorageScope.APPLICATION);
	}

	async refresh(): Promise<void> {
		if (isWeb) {
			return;
		}
		if (this.refreshInFlight) {
			return this.refreshInFlight;
		}
		this.isRefreshing = true;
		this.fireState();
		this.refreshInFlight = this.doRefresh().finally(() => {
			this.isRefreshing = false;
			this.refreshInFlight = undefined;
			this.fireState();
		});
		return this.refreshInFlight;
	}

	async runAutomaticFixes(): Promise<void> {
		if (isWeb || this.isAutoFixRunning) {
			return;
		}
		this.isAutoFixRunning = true;
		this.fireState();
		try {
			await this.refresh();
			const order: StartupGuideStepId[] = isMacintosh
				? ['homebrew', 'workspace', 'docker', 'ix-cli', 'ix-backend']
				: ['workspace', 'docker', 'ix-cli', 'ix-backend'];
			for (const id of order) {
				const step = this.findStep(id);
				if (!step || step.status === 'success' || step.status === 'skipped') {
					continue;
				}
				if (!step.canAutoFix) {
					continue;
				}
				await this.runStepFix(id);
				await this.refresh();
			}
		} finally {
			this.isAutoFixRunning = false;
			this.fireState();
		}
	}

	async runStepFix(stepId: StartupGuideStepId): Promise<void> {
		if (isWeb) {
			return;
		}
		const step = this.findStep(stepId);
		if (!step?.canAutoFix) {
			return;
		}
		step.status = 'running';
		step.detail = localize('startupGuide.running', 'Running…');
		this.fireState();
		try {
			switch (stepId) {
				case 'homebrew':
					await this.fixHomebrewPath();
					break;
				case 'workspace':
					await this.fixWorkspace();
					break;
				case 'docker':
					await this.fixDocker();
					break;
				case 'ix-cli':
					await this.installIxCli();
					break;
				case 'ix-backend':
					await this.ixIntegrationService.restart();
					break;
			}
		} catch (e) {
			step.status = 'error';
			step.detail = String(e);
			this.fireState();
			return;
		}
		await this.refresh();
	}

	async openHomebrewInstallTerminal(): Promise<void> {
		if (isWeb) {
			return;
		}
		const terminal = await this.terminalService.createTerminal({
			cwd: URI.file(this.environmentService.userHome.fsPath),
			config: isWindows ? undefined : { executable: '/bin/bash' },
		});
		terminal.focus();
		terminal.sendText('echo >> ~/.zprofile', true);
		terminal.sendText('echo \'eval "$(/opt/homebrew/bin/brew shellenv zsh)"\' >> ~/.zprofile', true);
		terminal.sendText('eval "$(/opt/homebrew/bin/brew shellenv zsh)"', true);
		terminal.sendText('brew --version', true);
		terminal.sendText('curl -fsSL https://ix-infra.com/install.sh -o /tmp/ix-install.sh', true);
		terminal.sendText('bash /tmp/ix-install.sh', true);
	}

	private buildSteps(): StepMutable[] {
		const steps: StepMutable[] = [
			{
				id: 'node',
				label: localize('startupGuide.node.label', 'Node.js'),
				description: localize('startupGuide.node.description', 'Required to build and run this editor from source.'),
				status: 'pending',
				detail: '',
				manualHint: localize('startupGuide.node.manual', 'Install Node 24.x (see .nvmrc). Example:\n  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash\n  nvm install 24.15.0'),
				canAutoFix: false,
				autoFixLabel: undefined,
			},
			{
				id: 'git',
				label: localize('startupGuide.git.label', 'Git'),
				description: localize('startupGuide.git.description', 'Used to clone the default project and run Ix.'),
				status: 'pending',
				detail: '',
				manualHint: localize('startupGuide.git.manual', 'Install Xcode Command Line Tools:\n  xcode-select --install'),
				canAutoFix: false,
				autoFixLabel: undefined,
			},
			{
				id: 'docker',
				label: localize('startupGuide.docker.label', 'Docker Desktop'),
				description: localize('startupGuide.docker.description', 'Runs the Ix backend and Docker MCP on the Process tab.'),
				status: 'pending',
				detail: '',
				manualHint: localize('startupGuide.docker.manual', 'Install Docker Desktop, open it, and wait until it is running.'),
				canAutoFix: true,
				autoFixLabel: localize('startupGuide.docker.auto', 'Open Docker Desktop'),
			},
			{
				id: 'workspace',
				label: localize('startupGuide.workspace.label', 'Project folder'),
				description: localize('startupGuide.workspace.description', 'Open a folder that exists on disk (not a missing saved workspace).'),
				status: 'pending',
				detail: '',
				manualHint: localize('startupGuide.workspace.manual', 'Use File → Open Folder, click Create Default Project in Process mode, or launch with:\n  ./scripts/code.sh /path/to/your/project'),
				canAutoFix: true,
				autoFixLabel: localize('startupGuide.workspace.auto', 'Create or recover project'),
			},
			{
				id: 'ix-cli',
				label: localize('startupGuide.ixCli.label', 'Ix CLI'),
				description: localize('startupGuide.ixCli.description', 'Command-line tool for code graph, Docker backend, and Process notes.'),
				status: 'pending',
				detail: '',
				manualHint: `${HOMEBREW_PATH_MANUAL_HINT}\n\n${IX_INSTALL_MANUAL_HINT}`,
				canAutoFix: true,
				autoFixLabel: localize('startupGuide.ixCli.auto', 'Install Ix CLI'),
			},
			{
				id: 'ix-backend',
				label: localize('startupGuide.ixBackend.label', 'Ix backend'),
				description: localize('startupGuide.ixBackend.description', 'Starts Ix Docker services (map + watch run after a valid project is open).'),
				status: 'pending',
				detail: '',
				manualHint: localize('startupGuide.ixBackend.manual', 'After Ix CLI and Docker are ready, run:\n  ix docker start'),
				canAutoFix: true,
				autoFixLabel: localize('startupGuide.ixBackend.auto', 'Start Ix pipeline'),
			},
		];

		if (isMacintosh) {
			steps.splice(1, 0, {
				id: 'homebrew',
				label: localize('startupGuide.homebrew.label', 'Homebrew (macOS)'),
				description: localize('startupGuide.homebrew.description', 'On macOS, Homebrew must be on PATH before the Ix installer can run non-interactively. If brew is already installed under /opt/homebrew, add shellenv to ~/.zprofile.'),
				status: 'pending',
				detail: '',
				manualHint: `${HOMEBREW_PATH_MANUAL_HINT}\n\nIf Homebrew is not installed yet, run in an interactive terminal (sudo required):\n  ${HOMEBREW_INSTALL_CMD}`,
				canAutoFix: true,
				autoFixLabel: localize('startupGuide.homebrew.auto', 'Add Homebrew to PATH'),
			});
		}

		return steps;
	}

	private scheduleRefresh(): void {
		void this.refresh();
	}

	private async doRefresh(): Promise<void> {
		await this.probeNode();
		await this.probeGit();
		await this.probeDocker();
		if (isMacintosh) {
			await this.probeHomebrew();
		}
		await this.probeWorkspace();
		await this.probeIxCli();
		await this.probeIxBackend();
		this.fireState();
	}

	private async probeNode(): Promise<void> {
		const step = this.findStep('node')!;
		const version = await this.probeCommandOutput('command -v node >/dev/null 2>&1 && node -v');
		if (version) {
			step.status = 'success';
			step.detail = version.trim();
			return;
		}
		step.status = 'error';
		step.detail = localize('startupGuide.node.missing', 'Node.js was not found on PATH.');
	}

	private async probeHomebrew(): Promise<void> {
		const step = this.findStep('homebrew');
		if (!step) {
			return;
		}
		const hasBrewOnPath = await this.probeCommand('command -v brew >/dev/null 2>&1');
		if (hasBrewOnPath) {
			const version = await this.probeCommandOutput('brew --version | head -n1');
			step.status = 'success';
			step.detail = version.trim() || localize('startupGuide.homebrew.ok', 'Homebrew is available.');
			return;
		}

		const optBrewExists = await this.fileService.exists(URI.file('/opt/homebrew/bin/brew'));
		const localBrewExists = await this.fileService.exists(URI.file('/usr/local/bin/brew'));
		if (optBrewExists || localBrewExists) {
			step.status = 'warning';
			step.detail = localize('startupGuide.homebrew.pathMissing', 'Homebrew is installed but not on PATH. Use Add Homebrew to PATH or follow the manual steps.');
			return;
		}

		const nodeOk = this.findStep('node')?.status === 'success';
		const gitOk = this.findStep('git')?.status === 'success';
		const dockerOk = this.findStep('docker')?.status === 'success' || this.findStep('docker')?.status === 'warning';
		if (nodeOk && gitOk && dockerOk) {
			step.status = 'skipped';
			step.detail = localize('startupGuide.homebrew.skipped', 'Not required — git, Node.js, and Docker are already available.');
			return;
		}
		step.status = 'warning';
		step.detail = localize('startupGuide.homebrew.missing', 'Homebrew is not installed. Install it in an interactive terminal, then add it to PATH.');
	}

	private async probeGit(): Promise<void> {
		const step = this.findStep('git')!;
		const version = await this.probeCommandOutput('command -v git >/dev/null 2>&1 && git --version');
		if (version) {
			step.status = 'success';
			step.detail = version.trim();
			return;
		}
		step.status = 'error';
		step.detail = localize('startupGuide.git.missing', 'git was not found on PATH.');
	}

	private async probeDocker(): Promise<void> {
		const step = this.findStep('docker')!;
		const status = await this.dockerAvailabilityService.refresh();
		if (status === DockerAvailabilityStatus.Available) {
			step.status = 'success';
			step.detail = localize('startupGuide.docker.ready', 'Docker is running with MCP Toolkit enabled.');
			return;
		}
		if (status === DockerAvailabilityStatus.McpToolkitMissing) {
			step.status = 'warning';
			step.detail = localize('startupGuide.docker.mcpMissing', 'Docker is installed but MCP Toolkit is not enabled.');
			return;
		}
		step.status = 'error';
		step.detail = localize('startupGuide.docker.missing', 'Docker Desktop is not installed or not running.');
	}

	private async probeWorkspace(): Promise<void> {
		const step = this.findStep('workspace')!;
		const state = this.workspaceContextService.getWorkbenchState();
		if (state === WorkbenchState.EMPTY) {
			step.status = 'error';
			step.detail = localize('startupGuide.workspace.empty', 'No folder is open.');
			return;
		}
		const folders = this.workspaceContextService.getWorkspace().folders;
		const missing: string[] = [];
		for (const folder of folders) {
			if (!(await this.fileService.exists(folder.uri))) {
				missing.push(folder.uri.fsPath);
			}
		}
		if (missing.length > 0) {
			step.status = 'error';
			step.detail = localize('startupGuide.workspace.missing', 'Saved workspace folder is missing: {0}. Use Run automatic fixes to recover or open a folder.', missing[0]);
			return;
		}
		step.status = 'success';
		step.detail = folders.map(f => f.name).join(', ');
	}

	private async probeIxCli(): Promise<void> {
		const step = this.findStep('ix-cli')!;
		const configured = this.configurationService.getValue<string>('custom.ix.cliPath')?.trim();
		if (configured) {
			if (await this.fileService.exists(URI.file(configured))) {
				step.status = 'success';
				step.detail = configured;
				return;
			}
		}
		const version = await this.probeCommandOutput('command -v ix >/dev/null 2>&1 && ix --version');
		if (version) {
			step.status = 'success';
			step.detail = version.trim();
			return;
		}
		const localBin = joinPath(this.environmentService.userHome, '.local', 'bin', 'ix');
		if (await this.fileService.exists(localBin)) {
			step.status = 'success';
			step.detail = localize('startupGuide.ixCli.local', 'Installed at {0} (add ~/.local/bin to PATH or set custom.ix.cliPath).', localBin.fsPath);
			return;
		}
		step.status = 'error';
		step.detail = localize('startupGuide.ixCli.missing', 'The ix command was not found.');
	}

	private async probeIxBackend(): Promise<void> {
		const step = this.findStep('ix-backend')!;
		const ixStep = this.findStep('ix-cli');
		const dockerStep = this.findStep('docker');
		if (ixStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('startupGuide.ixBackend.waitCli', 'Install the Ix CLI first.');
			return;
		}
		if (dockerStep?.status !== 'success' && dockerStep?.status !== 'warning') {
			step.status = 'pending';
			step.detail = localize('startupGuide.ixBackend.waitDocker', 'Start Docker Desktop first.');
			return;
		}
		const workspaceStep = this.findStep('workspace');
		if (workspaceStep?.status !== 'success') {
			step.status = 'warning';
			step.detail = localize('startupGuide.ixBackend.waitWorkspace', 'Ix backend can start after a valid project folder is open.');
			return;
		}
		const ixState = this.ixIntegrationService.getState();
		if (ixState.phase === 'watching' || ixState.phase === 'mapping') {
			step.status = 'success';
			step.detail = localize('startupGuide.ixBackend.running', 'Ix pipeline is active ({0}).', ixState.phase);
			return;
		}
		if (ixState.phase === 'error') {
			step.status = 'error';
			step.detail = ixState.lastError ?? localize('startupGuide.ixBackend.error', 'Ix pipeline reported an error. See the Process tab.');
			return;
		}
		if (ixState.phase === 'installing' || ixState.phase === 'docker') {
			step.status = 'running';
			step.detail = localize('startupGuide.ixBackend.progress', 'Ix pipeline is starting ({0})…', ixState.phase);
			return;
		}
		step.status = 'warning';
		step.detail = localize('startupGuide.ixBackend.idle', 'Ix is installed but the pipeline has not finished starting.');
	}

	private async fixWorkspace(): Promise<void> {
		const repoUrl = this.configurationService.getValue<string>('custom.defaultProject.repoUrl')?.trim();
		if (repoUrl && !this.defaultProjectService.shouldSkipSilentClone(repoUrl)) {
			await this.defaultProjectService.createAndOpenDefaultProject({ silent: true });
			await this.refresh();
			if (this.findStep('workspace')?.status === 'success') {
				return;
			}
		}
		await this.defaultProjectService.openFallbackWorkspace();
	}

	private async fixDocker(): Promise<void> {
		if (isMacintosh) {
			await this.runVisibleCommand('open -a Docker');
			return;
		}
		if (isWindows) {
			await this.openerService.open(URI.parse('https://www.docker.com/products/docker-desktop/'));
			return;
		}
		await this.runVisibleCommand('systemctl start docker 2>/dev/null || true');
	}

	private async fixHomebrewPath(): Promise<void> {
		await ensureHomebrewShellEnvInProfile(this.fileService, this.environmentService.userHome);
		const verify = await this.probeCommandOutput(`${buildShellEnvPreamble()}\nbrew --version | head -n1`);
		if (!verify.trim()) {
			throw new Error(localize('startupGuide.homebrew.pathFixFailed', 'Homebrew is still not available. Follow the manual PATH steps or install Homebrew in Terminal.'));
		}
	}

	private async installIxCli(): Promise<void> {
		await this.fixHomebrewPath().catch(() => { /* best effort */ });
		const installUrl = this.configurationService.getValue<string>('custom.ix.installScriptUrl')?.trim() || IX_DEFAULT_INSTALL_URL;
		const installScript = [
			buildIxInstallScriptCommand(installUrl),
			'command -v ix >/dev/null 2>&1 && ix --version',
		].join('\n');
		const exitCode = await this.runHiddenCommand(undefined, installScript, 600_000);
		if (exitCode === 0) {
			const which = await this.probeCommandOutput(`${buildShellEnvPreamble()}\ncommand -v ix`);
			const ixPath = await resolveInstalledIxPath(which);
			if (ixPath) {
				await this.configurationService.updateValue('custom.ix.cliPath', ixPath);
				return;
			}
		}
		await this.installIxCliTarball();
	}

	private async installIxCliTarball(): Promise<void> {
		const version = this.storageService.get(STORAGE_IX_VERSION, StorageScope.APPLICATION) ?? IX_DEFAULT_VERSION;
		const platform = isWindows ? 'windows-amd64' : (process.arch === 'arm64' ? `${process.platform}-arm64` : `${process.platform}-amd64`);
		const tarball = `ix-${version}-${platform}.tar.gz`;
		const url = `https://github.com/ix-infrastructure/Ix/releases/download/v${version}/${tarball}`;
		const ixHome = joinPath(this.environmentService.userHome, '.ix');
		const cliDir = joinPath(ixHome, 'cli');
		const binDir = joinPath(this.environmentService.userHome, '.local', 'bin');
		await this.fileService.createFolder(cliDir);
		await this.fileService.createFolder(binDir);

		const script = [
			'set -eu',
			`mkdir -p ${this.quoteShell(this.environmentService.userHome.fsPath + '/.ix/cli')}`,
			`mkdir -p ${this.quoteShell(binDir.fsPath)}`,
			`curl -fL --progress-bar ${this.quoteShell(url)} -o /tmp/ix-cli.tar.gz`,
			`tar -xzf /tmp/ix-cli.tar.gz -C ${this.quoteShell(cliDir.fsPath)} --strip-components=1`,
			`printf '#!/bin/sh\\nexec "${this.environmentService.userHome.fsPath}/.ix/cli/ix" "$@"\\n' > ${this.quoteShell(binDir.fsPath + '/ix')}`,
			`chmod +x ${this.quoteShell(binDir.fsPath + '/ix')} ${this.quoteShell(cliDir.fsPath + '/ix')}`,
			'command -v ix >/dev/null 2>&1 && ix --version || true',
		].join('\n');

		const exitCode = await this.runHiddenCommand(undefined, script, 600_000);
		if (exitCode !== 0) {
			throw new Error(localize('startupGuide.ixCli.installFailed', 'Ix CLI download failed (exit {0}).', String(exitCode)));
		}

		await this.configurationService.updateValue('custom.ix.cliPath', joinPath(binDir, 'ix').fsPath);
	}

	private async runHiddenCommand(cwd: URI | undefined, commandLine: string, timeoutMs: number): Promise<number> {
		const shell = this.shellLaunchForCommand(commandLine);
		const store = new DisposableStore();
		try {
			const instance = await this.terminalService.createTerminal({
				cwd: cwd ?? URI.file(this.environmentService.userHome.fsPath),
				config: {
					...shell,
					name: 'Startup',
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			});
			store.add(instance);
			return await new Promise<number>((resolve, reject) => {
				const handle = setTimeout(() => reject(new Error('timeout')), timeoutMs);
				store.add({ dispose: () => clearTimeout(handle) });
				store.add(instance.onExit(code => {
					clearTimeout(handle);
					resolve(typeof code === 'number' ? code : 1);
				}));
			});
		} finally {
			store.dispose();
		}
	}

	private async runVisibleCommand(commandLine: string): Promise<void> {
		const terminal = await this.terminalService.createTerminal({
			cwd: URI.file(this.environmentService.userHome.fsPath),
			config: isWindows ? undefined : { executable: '/bin/bash' },
		});
		terminal.focus();
		terminal.sendText(commandLine, true);
	}

	private shellLaunchForCommand(commandLine: string): { executable: string; args: string[] } {
		if (isWindows) {
			return { executable: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
		}
		return { executable: '/bin/bash', args: ['-c', commandLine] };
	}

	private quoteShell(value: string): string {
		return `'${value.replace(/'/g, `'\\''`)}'`;
	}

	private async probeCommand(commandLine: string): Promise<boolean> {
		const exitCode = await this.runHiddenCommand(undefined, `${buildShellEnvPreamble()}\n${commandLine}`, 30_000);
		return exitCode === 0;
	}

	private async probeCommandOutput(commandLine: string): Promise<string> {
		const shell = this.shellLaunchForCommand(`${buildShellEnvPreamble()}\n${commandLine}`);
		const store = new DisposableStore();
		let buf = '';
		try {
			const instance = await this.terminalService.createTerminal({
				cwd: URI.file(this.environmentService.userHome.fsPath),
				config: {
					...shell,
					name: 'Startup probe',
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			});
			store.add(instance);
			store.add(instance.onData(d => { buf += d; }));
			const exitCode = await new Promise<number>((resolve, reject) => {
				const handle = setTimeout(() => reject(new Error('timeout')), 30_000);
				store.add({ dispose: () => clearTimeout(handle) });
				store.add(instance.onExit(code => {
					clearTimeout(handle);
					resolve(typeof code === 'number' ? code : 1);
				}));
			});
			return exitCode === 0 ? buf : '';
		} catch {
			return '';
		} finally {
			store.dispose();
		}
	}

	private findStep(id: StartupGuideStepId): StepMutable | undefined {
		return this.steps.find(s => s.id === id);
	}

	private snapshot(): StartupGuideState {
		const steps = this.steps.map(s => ({
			id: s.id,
			label: s.label,
			description: s.description,
			status: s.status,
			detail: s.detail,
			manualHint: s.manualHint,
			canAutoFix: s.canAutoFix,
			autoFixLabel: s.autoFixLabel,
		}));
		const incompleteCount = steps.filter(s => s.status !== 'success' && s.status !== 'skipped').length;
		return {
			steps,
			incompleteCount,
			isRefreshing: this.isRefreshing,
			isAutoFixRunning: this.isAutoFixRunning,
		};
	}

	private fireState(): void {
		this._onDidChangeState.fire(this.snapshot());
	}
}

registerSingleton(IStartupGuideService, StartupGuideService, InstantiationType.Delayed);

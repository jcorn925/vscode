/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../vs/base/common/event.js';
import { Disposable, DisposableStore } from '../../vs/base/common/lifecycle.js';
import { isWeb, isWindows } from '../../vs/base/common/platform.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../vs/platform/configuration/common/configuration.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../vs/platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../vs/platform/workspace/common/workspace.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { IDefaultProjectService } from '../devserver/DefaultProjectService.js';
import { IDevServerService } from '../devserver/DevServerService.js';
import { IConsoleService } from '../goalWorkspace/ConsoleService.js';
import type { SetupGuideController, SetupGuideState, SetupGuideStepSnapshot, SetupGuideStepStatus } from '../setup/setupGuideTypes.js';
import { localize } from '../../vs/nls.js';

export type AppLaunchGuideStepId =
	| 'workspace'
	| 'package-json'
	| 'dev-script'
	| 'dependencies'
	| 'dev-server';

export interface IAppLaunchGuideService extends SetupGuideController {
	readonly _serviceBrand: undefined;
}

export const IAppLaunchGuideService = createDecorator<IAppLaunchGuideService>('appLaunchGuideService');

const STORAGE_DISMISSED = 'custom.appLaunchGuide/dismissed';

interface StepMutable {
	readonly id: AppLaunchGuideStepId;
	readonly label: string;
	readonly description: string;
	status: SetupGuideStepStatus;
	detail: string;
	readonly manualHint: string;
	readonly canAutoFix: boolean;
	readonly autoFixLabel: string | undefined;
}

interface SurfaceLaunchTarget {
	readonly id: string;
	readonly name: string;
	readonly appPath: string;
	readonly appFolder: URI;
	readonly devCommand: string | undefined;
	readonly localUrl: string | undefined;
}

export class AppLaunchGuideService extends Disposable implements IAppLaunchGuideService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<SetupGuideState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private readonly steps: StepMutable[];
	private isRefreshing = false;
	private isAutoFixRunning = false;
	private refreshInFlight: Promise<void> | undefined;
	private lastHintsInstallCommand: string | undefined;
	private lastWorkspaceFolder: URI | undefined;
	private lastSurfaceTargets: readonly SurfaceLaunchTarget[] = [];
	private lastSurfaceInstallCommand: string | undefined;
	private deferGoalWorkspaceLaunch = false;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IDevServerService private readonly devServerService: IDevServerService,
		@IDefaultProjectService private readonly defaultProjectService: IDefaultProjectService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IConsoleService private readonly consoleService: IConsoleService,
	) {
		super();

		this.steps = this.buildSteps();
		this.deferGoalWorkspaceLaunch = this.consoleService.getState().status === 'loaded';

		if (isWeb) {
			return;
		}

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.scheduleRefresh()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => void this.scheduleRefresh()));
		this._register(this.devServerService.onDidChangeState(() => void this.scheduleRefresh()));
		this._register(this.consoleService.onDidChangeWorkspace(() => void this.scheduleRefresh()));

		void this.refresh();
	}

	getState(): SetupGuideState {
		return this.snapshot();
	}

	shouldShow(): boolean {
		if (isWeb) {
			return false;
		}
		if (!(this.configurationService.getValue<boolean>('custom.appLaunchGuide.showOnIncomplete') ?? false)) {
			return false;
		}
		if (this.storageService.getBoolean(STORAGE_DISMISSED, StorageScope.APPLICATION, false)) {
			return false;
		}
		if (this.deferGoalWorkspaceLaunch) {
			return false;
		}
		return this.snapshot().incompleteCount > 0;
	}

	markDismissed(): void {
		this.storageService.store(STORAGE_DISMISSED, true, StorageScope.APPLICATION, StorageTarget.USER);
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
			const order: AppLaunchGuideStepId[] = ['workspace', 'dependencies', 'dev-server'];
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

	async runStepFix(stepId: string): Promise<void> {
		if (isWeb) {
			return;
		}
		const step = this.findStep(stepId as AppLaunchGuideStepId);
		if (!step?.canAutoFix || !isFixableStepStatus(step.status)) {
			return;
		}
		step.status = 'running';
		step.detail = localize('appLaunchGuide.running', 'Running…');
		this.fireState();
		try {
			switch (stepId as AppLaunchGuideStepId) {
				case 'workspace':
					await this.fixWorkspace();
					break;
				case 'dependencies':
					await this.fixDependencies();
					break;
				case 'dev-server':
					await this.fixDevServer();
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

	private buildSteps(): StepMutable[] {
		return [
			{
				id: 'workspace',
				label: localize('appLaunchGuide.workspace.label', 'Project folder'),
				description: localize('appLaunchGuide.workspace.description', 'Open a workspace folder that exists on disk so app dev servers can run.'),
				status: 'pending',
				detail: '',
				manualHint: localize('appLaunchGuide.workspace.manual', 'Use File → Open Folder or click Create Default Project on the UI tab.'),
				canAutoFix: true,
				autoFixLabel: localize('appLaunchGuide.workspace.auto', 'Create or recover project'),
			},
			{
				id: 'package-json',
				label: localize('appLaunchGuide.packageJson.label', 'package.json'),
				description: localize('appLaunchGuide.packageJson.description', 'Each app folder needs a package.json for its dev server.'),
				status: 'pending',
				detail: '',
				manualHint: localize('appLaunchGuide.packageJson.manual', 'For each app surface folder, create package.json (or scaffold the app):\n  npm init -y'),
				canAutoFix: false,
				autoFixLabel: undefined,
			},
			{
				id: 'dev-script',
				label: localize('appLaunchGuide.devScript.label', 'Dev script'),
				description: localize('appLaunchGuide.devScript.description', 'Each app package.json needs a dev, start, or web script to launch localhost.'),
				status: 'pending',
				detail: '',
				manualHint: localize('appLaunchGuide.devScript.manual', 'Add app scripts to package.json, for example:\n  "scripts": { "dev": "next dev" }'),
				canAutoFix: false,
				autoFixLabel: undefined,
			},
			{
				id: 'dependencies',
				label: localize('appLaunchGuide.dependencies.label', 'Dependencies'),
				description: localize('appLaunchGuide.dependencies.description', 'node_modules must be installed before the dev server can start.'),
				status: 'pending',
				detail: '',
				manualHint: localize('appLaunchGuide.dependencies.manual', 'In a workspace terminal, run the install command shown above for each app (or run your workspace install).'),
				canAutoFix: true,
				autoFixLabel: localize('appLaunchGuide.dependencies.auto', 'Install dependencies'),
			},
			{
				id: 'dev-server',
				label: localize('appLaunchGuide.devServer.label', 'Localhost server'),
				description: localize('appLaunchGuide.devServer.description', 'The app preview loads from a dev server such as http://localhost:3000.'),
				status: 'pending',
				detail: '',
				manualHint: localize('appLaunchGuide.devServer.manual', 'Click Start App on the UI tab, or run your dev script in a terminal (e.g. npm run dev).'),
				canAutoFix: true,
				autoFixLabel: localize('appLaunchGuide.devServer.auto', 'Start app server'),
			},
		];
	}

	private scheduleRefresh(): void {
		void this.refresh();
	}

	private async doRefresh(): Promise<void> {
		const deferReason = await this.getGoalWorkspaceDeferReason();
		this.deferGoalWorkspaceLaunch = deferReason !== undefined;
		if (deferReason) {
			this.skipAllSteps(deferReason);
			return;
		}

		this.lastSurfaceTargets = this.getSurfaceLaunchTargets();
		this.lastSurfaceInstallCommand = undefined;
		await this.probeWorkspace();
		await this.probePackageJson();
		await this.probeDevScript();
		await this.probeDependencies();
		await this.probeDevServer();
	}

	private getGoalWorkspaceDeferReason(): string | undefined {
		const goalWorkspaceState = this.consoleService.getState();
		if (goalWorkspaceState.status !== 'loaded' || goalWorkspaceState.workspace?.surfaces?.length) {
			return undefined;
		}

		return localize(
			'appLaunchGuide.goalWorkspaceDeferred',
			'Goal workspace surfaces launch from their registered app paths and dev commands; the root App Launch checklist is deferred.'
		);
	}

	private skipAllSteps(detail: string): void {
		for (const step of this.steps) {
			step.status = 'skipped';
			step.detail = detail;
		}
		this.lastWorkspaceFolder = undefined;
		this.lastHintsInstallCommand = undefined;
		this.lastSurfaceTargets = [];
		this.lastSurfaceInstallCommand = undefined;
	}

	private async probeWorkspace(): Promise<void> {
		const step = this.findStep('workspace')!;
		const state = this.workspaceContextService.getWorkbenchState();
		if (state === WorkbenchState.EMPTY) {
			step.status = 'error';
			step.detail = localize('appLaunchGuide.workspace.empty', 'No folder is open.');
			this.lastWorkspaceFolder = undefined;
			return;
		}
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!folder || !(await this.fileService.exists(folder))) {
			step.status = 'error';
			step.detail = localize('appLaunchGuide.workspace.missing', 'The workspace folder is missing on disk.');
			this.lastWorkspaceFolder = undefined;
			return;
		}
		this.lastWorkspaceFolder = folder;
		step.status = 'success';
		step.detail = folder.fsPath;
	}

	private async probePackageJson(): Promise<void> {
		const step = this.findStep('package-json')!;
		const workspaceStep = this.findStep('workspace');
		if (workspaceStep?.status !== 'success' || !this.lastWorkspaceFolder) {
			step.status = 'pending';
			step.detail = localize('appLaunchGuide.packageJson.waitWorkspace', 'Open a project folder first.');
			return;
		}

		if (this.lastSurfaceTargets.length > 0) {
			let present = 0;
			for (const target of this.lastSurfaceTargets) {
				if (await this.fileService.exists(joinPath(target.appFolder, 'package.json'))) {
					present++;
				}
			}
			if (present === this.lastSurfaceTargets.length) {
				step.status = 'success';
				step.detail = localize('appLaunchGuide.packageJson.surface.all', 'All {0} surface app folders contain package.json.', String(this.lastSurfaceTargets.length));
			} else {
				step.status = 'error';
				step.detail = localize('appLaunchGuide.packageJson.surface.partial', '{0}/{1} surface app folders contain package.json.', String(present), String(this.lastSurfaceTargets.length));
			}
			return;
		}

		const packageJsonUri = joinPath(this.lastWorkspaceFolder, 'package.json');
		if (!(await this.fileService.exists(packageJsonUri))) {
			step.status = 'error';
			step.detail = localize('appLaunchGuide.packageJson.missing', 'No package.json in the project root.');
			return;
		}
		step.status = 'success';
		step.detail = packageJsonUri.fsPath;
	}

	private async probeDevScript(): Promise<void> {
		const step = this.findStep('dev-script')!;
		const packageStep = this.findStep('package-json');
		if (packageStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('appLaunchGuide.devScript.waitPackage', 'Add package.json first.');
			return;
		}

		if (this.lastSurfaceTargets.length > 0) {
			const runnable = this.lastSurfaceTargets.filter(target => Boolean(target.devCommand?.trim()));
			if (runnable.length === this.lastSurfaceTargets.length) {
				step.status = 'success';
				step.detail = localize('appLaunchGuide.devScript.surface.all', 'All surface apps define a dev command in workspace.goal.json.');
			} else {
				step.status = 'error';
				step.detail = localize('appLaunchGuide.devScript.surface.partial', '{0}/{1} surfaces define devCommand.', String(runnable.length), String(this.lastSurfaceTargets.length));
			}
			return;
		}

		const hints = await this.devServerService.getSuggestedStartCommands();
		this.lastHintsInstallCommand = hints?.installCommand;
		if (!hints?.primaryRunCommand) {
			step.status = 'error';
			step.detail = localize('appLaunchGuide.devScript.missing', 'No dev, start, or web script found in package.json.');
			return;
		}
		step.status = 'success';
		step.detail = hints.primaryScript ? `npm run ${hints.primaryScript}` : hints.primaryRunCommand;
	}

	private async probeDependencies(): Promise<void> {
		const step = this.findStep('dependencies')!;
		const devScriptStep = this.findStep('dev-script');
		if (devScriptStep?.status !== 'success' || !this.lastWorkspaceFolder) {
			step.status = devScriptStep?.status === 'error' ? 'skipped' : 'pending';
			step.detail = localize('appLaunchGuide.dependencies.waitScript', 'Add a runnable app script before installing dependencies.');
			return;
		}

		if (this.lastSurfaceTargets.length > 0) {
			let installed = 0;
			let installCommand: string | undefined;
			for (const target of this.lastSurfaceTargets) {
				const hasAppNodeModules = await this.fileService.exists(joinPath(target.appFolder, 'node_modules'));
				const hasWorkspaceNodeModules = await this.fileService.exists(joinPath(this.lastWorkspaceFolder, 'node_modules'));
				if (hasAppNodeModules || hasWorkspaceNodeModules) {
					installed++;
				}
				if (!installCommand) {
					installCommand = this.surfaceInstallCommand(target);
				}
			}
			this.lastSurfaceInstallCommand = installCommand;
			if (installed === this.lastSurfaceTargets.length) {
				step.status = 'success';
				step.detail = localize('appLaunchGuide.dependencies.surface.all', 'Dependencies are installed for all {0} surface apps.', String(this.lastSurfaceTargets.length));
				return;
			}
			step.status = 'warning';
			step.detail = installCommand
				? localize('appLaunchGuide.dependencies.surface.partial', '{0}/{1} surfaces appear installed. Run {2} to install dependencies.', String(installed), String(this.lastSurfaceTargets.length), installCommand)
				: localize('appLaunchGuide.dependencies.surface.partialNoCommand', '{0}/{1} surfaces appear installed.', String(installed), String(this.lastSurfaceTargets.length));
			return;
		}

		const hints = await this.devServerService.getSuggestedStartCommands();
		if (!hints) {
			step.status = 'pending';
			step.detail = '';
			return;
		}
		if (hints.hasNodeModules) {
			step.status = 'success';
			step.detail = localize('appLaunchGuide.dependencies.installed', 'node_modules is present.');
			return;
		}
		step.status = 'warning';
		step.detail = localize('appLaunchGuide.dependencies.missing', 'Run {0} before starting the server.', hints.installCommand);
	}

	private async probeDevServer(): Promise<void> {
		const step = this.findStep('dev-server')!;
		const depsStep = this.findStep('dependencies');
		const devScriptStep = this.findStep('dev-script');
		if (devScriptStep?.status !== 'success') {
			step.status = devScriptStep?.status === 'error' ? 'skipped' : 'pending';
			step.detail = localize('appLaunchGuide.devServer.waitScript', 'Add a runnable app script before starting localhost.');
			return;
		}
		if (depsStep?.status !== 'success' && depsStep?.status !== 'warning') {
			step.status = 'pending';
			step.detail = localize('appLaunchGuide.devServer.waitDeps', 'Install dependencies first.');
			return;
		}

		if (this.lastSurfaceTargets.length > 0) {
			const activeUrl = this.devServerService.getActiveUrl();
			const activeSurfaceTarget = activeUrl
				? this.lastSurfaceTargets.find(target => target.localUrl === activeUrl)
				: undefined;
			if (activeUrl && activeSurfaceTarget) {
				step.status = 'success';
				step.detail = localize('appLaunchGuide.devServer.surface.active', 'Serving at {0}', activeUrl);
				return;
			}
			for (const target of this.lastSurfaceTargets) {
				if (!target.localUrl) {
					continue;
				}
				const reachable = await this.devServerService.findRunningDevServerUrl(target.localUrl, { allowNearbyPorts: false });
				if (reachable) {
					step.status = 'success';
					step.detail = localize('appLaunchGuide.devServer.surface.reachable', 'Surface app reachable at {0}', reachable);
					return;
				}
			}
			const firstUrl = this.lastSurfaceTargets.find(target => !!target.localUrl)?.localUrl;
			step.status = 'warning';
			step.detail = firstUrl
				? localize('appLaunchGuide.devServer.surface.notReachable', 'No surface app is listening yet (expected one such as {0}).', firstUrl)
				: localize('appLaunchGuide.devServer.surface.notStarted', 'No surface app server has started yet.');
			return;
		}

		const hints = await this.devServerService.getSuggestedStartCommands();
		const preferredUrl = hints?.inferredUrl ?? this.devServerService.getActiveUrl();
		const state = this.devServerService.getState();

		if (state.phase === 'running' && state.activeUrl) {
			step.status = 'success';
			step.detail = localize('appLaunchGuide.devServer.running', 'Serving at {0}', state.activeUrl);
			return;
		}
		if (state.phase === 'installing' || state.phase === 'starting') {
			step.status = 'running';
			step.detail = localize('appLaunchGuide.devServer.starting', 'Starting ({0})…', state.phase);
			return;
		}
		if (state.phase === 'error') {
			step.status = 'error';
			step.detail = state.lastError ?? localize('appLaunchGuide.devServer.error', 'Dev server failed to start.');
			return;
		}

		const reachable = preferredUrl
			? (await this.devServerService.findRunningDevServerUrl(preferredUrl)) !== undefined
			: false;
		if (reachable && preferredUrl) {
			step.status = 'success';
			step.detail = localize('appLaunchGuide.devServer.reachable', 'Reachable at {0}', preferredUrl);
			return;
		}

		step.status = 'warning';
		step.detail = preferredUrl
			? localize('appLaunchGuide.devServer.notReachable', 'Nothing is listening at {0} yet.', preferredUrl)
			: localize('appLaunchGuide.devServer.notStarted', 'Dev server has not been started.');
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

	private async fixDependencies(): Promise<void> {
		if (this.lastSurfaceTargets.length > 0 && this.lastWorkspaceFolder) {
			const installCommand = this.lastSurfaceInstallCommand ?? this.surfaceInstallCommand(this.lastSurfaceTargets[0]);
			if (!installCommand) {
				throw new Error(localize('appLaunchGuide.dependencies.noCommand', 'No install command available for this project.'));
			}
			const exitCode = await this.runHiddenCommand(this.lastWorkspaceFolder, installCommand, 600_000);
			if (exitCode !== 0) {
				throw new Error(localize('appLaunchGuide.dependencies.failed', 'Dependency install failed (exit {0}).', String(exitCode)));
			}
			return;
		}

		const folder = this.lastWorkspaceFolder;
		const installCommand = this.lastHintsInstallCommand;
		if (!folder || !installCommand) {
			throw new Error(localize('appLaunchGuide.dependencies.noCommand', 'No install command available for this project.'));
		}
		const exitCode = await this.runHiddenCommand(folder, installCommand, 600_000);
		if (exitCode !== 0) {
			throw new Error(localize('appLaunchGuide.dependencies.failed', 'Dependency install failed (exit {0}).', String(exitCode)));
		}
	}

	private async fixDevServer(): Promise<void> {
		if (this.lastSurfaceTargets.length > 0) {
			const launchTarget = this.lastSurfaceTargets.find(target => !!target.devCommand?.trim());
			if (!launchTarget?.devCommand) {
				throw new Error(localize('appLaunchGuide.devServer.startFailed', 'Could not start the dev server.'));
			}
			const url = await this.devServerService.ensureRunningWithCommand(launchTarget.devCommand, launchTarget.localUrl, launchTarget.name);
			if (!url) {
				const state = this.devServerService.getState();
				throw new Error(state.lastError ?? localize('appLaunchGuide.devServer.startFailed', 'Could not start the dev server.'));
			}
			return;
		}

		const url = await this.devServerService.ensureRunning();
		if (!url) {
			const state = this.devServerService.getState();
			throw new Error(state.lastError ?? localize('appLaunchGuide.devServer.startFailed', 'Could not start the dev server.'));
		}
	}

	private getSurfaceLaunchTargets(): readonly SurfaceLaunchTarget[] {
		const state = this.consoleService.getState();
		const workspaceFolder = state.workspaceFolder;
		const surfaces = state.workspace?.surfaces ?? [];
		if (!workspaceFolder || state.status !== 'loaded' || surfaces.length === 0) {
			return [];
		}
		return surfaces.map(surface => {
			const appPath = (surface.path?.trim() || `apps/${surface.id}`).replace(/^\/+/, '');
			return {
				id: surface.id,
				name: surface.name,
				appPath,
				appFolder: joinPath(workspaceFolder, ...appPath.split('/').filter(Boolean)),
				devCommand: surface.devCommand?.trim() || undefined,
				localUrl: surface.localUrl?.trim() || undefined
			};
		});
	}

	private surfaceInstallCommand(target: SurfaceLaunchTarget): string | undefined {
		const command = target.devCommand ?? '';
		const appPath = target.appPath;
		if (/\bnpm\s+--prefix\s+\S+/i.test(command)) {
			return `npm install --prefix ${appPath}`;
		}
		if (/\bnpm\b.*--workspace\s+\S+/i.test(command)) {
			return `npm install --workspace ${appPath}`;
		}
		if (/\bpnpm\b.*--filter\s+\S+/i.test(command)) {
			return `pnpm install --filter ${appPath}`;
		}
		if (/\byarn\b.*\bworkspace\s+\S+/i.test(command)) {
			return `yarn workspace ${appPath} install`;
		}
		if (/\byarn\b.*--cwd\s+\S+/i.test(command)) {
			return `yarn --cwd ${appPath} install`;
		}
		return `npm install --prefix ${appPath}`;
	}

	private async runHiddenCommand(cwd: URI, commandLine: string, timeoutMs: number): Promise<number> {
		const shell = isWindows
			? { executable: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] as string[] }
			: { executable: '/bin/bash', args: ['-c', commandLine] as string[] };
		const store = new DisposableStore();
		try {
			const instance = await this.terminalService.createTerminal({
				cwd,
				config: {
					...shell,
					name: 'App Launch',
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

	private findStep(id: AppLaunchGuideStepId): StepMutable | undefined {
		return this.steps.find(s => s.id === id);
	}

	private snapshot(): SetupGuideState {
		const steps: SetupGuideStepSnapshot[] = this.steps.map(s => ({
			id: s.id,
			label: s.label,
			description: s.description,
			status: s.status,
			detail: s.detail,
			manualHint: s.manualHint,
			canAutoFix: s.canAutoFix && isFixableStepStatus(s.status),
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

function isFixableStepStatus(status: SetupGuideStepStatus): boolean {
	return status === 'error' || status === 'warning';
}

registerSingleton(IAppLaunchGuideService, AppLaunchGuideService, InstantiationType.Delayed);

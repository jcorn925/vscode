/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../vs/base/common/async.js';
import { Disposable, DisposableStore } from '../../vs/base/common/lifecycle.js';
import { join } from '../../vs/base/common/path.js';
import { joinPath, isEqualOrParent } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { isWindows } from '../../vs/base/common/platform.js';
import { IConfigurationService } from '../../vs/platform/configuration/common/configuration.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../vs/platform/notification/common/notification.js';
import { INativeEnvironmentService } from '../../vs/platform/environment/common/environment.js';
import { IStorageService, StorageScope, StorageTarget } from '../../vs/platform/storage/common/storage.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { IHostService } from '../../vs/workbench/services/host/browser/host.js';
import { IWorkbenchEnvironmentService } from '../../vs/workbench/services/environment/common/environmentService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../vs/platform/workspace/common/workspace.js';

export interface IDefaultProjectService {
	readonly _serviceBrand: undefined;
	createAndOpenDefaultProject(options?: { silent?: boolean }): Promise<void>;
	shouldBootstrapAtStartup(): Promise<boolean>;
	shouldSkipSilentClone(repoUrl: string): boolean;
	openFallbackWorkspace(): Promise<void>;
}

export const IDefaultProjectService = createDecorator<IDefaultProjectService>('defaultProjectService');

const STORAGE_FAILED_REPO_URL = 'custom.defaultProject/failedRepoUrl';

export class DefaultProjectService extends Disposable implements IDefaultProjectService {
	readonly _serviceBrand: undefined;

	private bootstrapInFlight: Promise<void> | undefined;
	private silentCloneAttempted = false;
	private lastSilentFailureMessage: string | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IHostService private readonly hostService: IHostService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
	}

	getCustomProjectsBaseDir(): URI {
		return URI.file(join(this.environmentService.userDataPath, 'Custom'));
	}

	isManagedProjectPath(folder: URI): boolean {
		return isEqualOrParent(folder, this.getCustomProjectsBaseDir());
	}

	async shouldBootstrapAtStartup(): Promise<boolean> {
		const repoUrl = this.configurationService.getValue<string>('custom.defaultProject.repoUrl')?.trim();
		if (!repoUrl || this.shouldSkipSilentClone(repoUrl)) {
			return false;
		}

		const state = this.workspaceContextService.getWorkbenchState();
		if (state === WorkbenchState.EMPTY) {
			return true;
		}

		if (state !== WorkbenchState.FOLDER) {
			return false;
		}

		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!folder) {
			return true;
		}

		if (!this.isManagedProjectPath(folder)) {
			return false;
		}

		return !(await this.isReadyProject(folder));
	}

	async createAndOpenDefaultProject(options?: { silent?: boolean }): Promise<void> {
		const silent = options?.silent ?? false;
		if (silent && this.silentCloneAttempted) {
			return;
		}
		if (silent) {
			this.silentCloneAttempted = true;
		}

		if (this.bootstrapInFlight) {
			return this.bootstrapInFlight;
		}

		this.bootstrapInFlight = this.doCreateAndOpenDefaultProject(options);
		try {
			await this.bootstrapInFlight;
		} finally {
			this.bootstrapInFlight = undefined;
		}
	}

	async openFallbackWorkspace(): Promise<void> {
		const appRoot = this.environmentService.appRoot;
		if (!appRoot) {
			return;
		}
		await this.openFolder(URI.file(appRoot));
	}

	shouldSkipSilentClone(repoUrl: string): boolean {
		const failed = this.storageService.get(STORAGE_FAILED_REPO_URL, StorageScope.APPLICATION);
		return typeof failed === 'string' && failed.length > 0 && failed === repoUrl.trim();
	}

	private markSilentCloneFailed(repoUrl: string): void {
		this.storageService.store(STORAGE_FAILED_REPO_URL, repoUrl.trim(), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private clearSilentCloneFailure(): void {
		this.storageService.remove(STORAGE_FAILED_REPO_URL, StorageScope.APPLICATION);
	}

	private async doCreateAndOpenDefaultProject(options?: { silent?: boolean }): Promise<void> {
		const repoUrl = this.configurationService.getValue<string>('custom.defaultProject.repoUrl')?.trim();
		if (!repoUrl) {
			if (!(options?.silent)) {
				await this.openFallbackWorkspace();
			}
			return;
		}

		if (options?.silent && this.shouldSkipSilentClone(repoUrl)) {
			return;
		}

		const branch = this.configurationService.getValue<string>('custom.defaultProject.branch')?.trim();
		const { targetFolder, targetName, parentFolder, alreadyExists } = await this.resolveTargetFolder();

		if (alreadyExists) {
			await this.openFolder(targetFolder);
			return;
		}

		const quotedName = this.quoteShellArg(targetName);
		let commandLine = `git clone ${this.quoteShellArg(repoUrl)} ${quotedName}`;
		if (branch) {
			commandLine += ` && cd ${quotedName} && git checkout ${this.quoteShellArg(branch)}`;
		}

		const silent = options?.silent ?? false;
		const cloneResult = silent
			? await this.runHiddenCommand(parentFolder, commandLine, 600_000)
			: { exitCode: await this.runVisibleClone(parentFolder, targetName, repoUrl, branch), output: '' };

		if (silent && cloneResult.exitCode !== 0) {
			this.markSilentCloneFailed(repoUrl);
			const detail = this.formatCloneFailureMessage(repoUrl, cloneResult.output);
			if (detail !== this.lastSilentFailureMessage) {
				this.lastSilentFailureMessage = detail;
				this.notificationService.notify({
					severity: Severity.Error,
					message: detail,
				});
			}
			return;
		}

		const created = await this.waitForReady(targetFolder);
		if (!created) {
			this.markSilentCloneFailed(repoUrl);
			this.notificationService.notify({
				severity: Severity.Error,
				message: 'Default project clone did not complete in time. Check the terminal output.'
			});
			return;
		}

		this.clearSilentCloneFailure();
		await this.openFolder(targetFolder);
	}

	private async runVisibleClone(parentFolder: URI, targetName: string, repoUrl: string, branch?: string): Promise<number> {
		const terminal = await this.terminalService.createTerminal({
			cwd: parentFolder,
			config: isWindows ? undefined : { executable: '/bin/bash' }
		});
		terminal.focus();

		const quotedName = this.quoteShellArg(targetName);
		terminal.sendText(`git clone ${this.quoteShellArg(repoUrl)} ${quotedName}`, true);
		if (branch) {
			terminal.sendText(`cd ${quotedName} && git checkout ${this.quoteShellArg(branch)}`, true);
		}

		return 0;
	}

	private async runHiddenCommand(cwd: URI, commandLine: string, timeoutMs: number): Promise<{ exitCode: number; output: string }> {
		const shell = isWindows
			? { executable: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] as string[] }
			: { executable: '/bin/bash', args: ['-c', commandLine] as string[] };

		const store = new DisposableStore();
		let output = '';
		try {
			const instance = await this.terminalService.createTerminal({
				cwd,
				config: {
					...shell,
					name: 'Default Project',
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			});
			store.add(instance);
			store.add(instance.onData(d => { output += d; }));

			const exitCode = await new Promise<number>((resolve, reject) => {
				const handle = setTimeout(() => reject(new Error('timeout')), timeoutMs);
				store.add({ dispose: () => clearTimeout(handle) });
				store.add(instance.onExit(code => {
					clearTimeout(handle);
					resolve(typeof code === 'number' ? code : 1);
				}));
			});
			return { exitCode, output };
		} catch (e) {
			return { exitCode: 1, output: String(e) };
		} finally {
			store.dispose();
		}
	}

	private formatCloneFailureMessage(repoUrl: string, output: string): string {
		const tail = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-4).join(' ');
		if (/could not read Username|Authentication failed|Permission denied/i.test(output)) {
			return `Default project clone failed: ${repoUrl} requires GitHub authentication or is private. Set custom.defaultProject.repoUrl to a public repo you can access, or use Startup setup to open the vscode folder instead.${tail ? ` (${tail})` : ''}`;
		}
		if (/Repository not found|does not exist|404/i.test(output)) {
			return `Default project clone failed: ${repoUrl} was not found (404). Update custom.defaultProject.repoUrl in settings, or use Startup setup → Run automatic fixes to open this repo instead.${tail ? ` (${tail})` : ''}`;
		}
		return `Default project clone failed for ${repoUrl}. Check the Process tab log or update custom.defaultProject.repoUrl.${tail ? ` ${tail}` : ''}`;
	}

	private async isReadyProject(folder: URI): Promise<boolean> {
		return this.fileService.exists(joinPath(folder, '.git'));
	}

	private async resolveTargetFolder(): Promise<{ targetFolder: URI; targetName: string; parentFolder: URI; alreadyExists: boolean }> {
		const baseDir = this.getCustomProjectsBaseDir();
		const baseName = 'DefaultProject';

		await this.fileService.createFolder(baseDir);

		let candidateName = baseName;
		for (let i = 0; i < 100; i++) {
			const candidate = joinPath(baseDir, candidateName);
			if (await this.isReadyProject(candidate)) {
				return { targetFolder: candidate, targetName: candidateName, parentFolder: baseDir, alreadyExists: true };
			}

			const exists = await this.fileService.exists(candidate);
			if (!exists) {
				return { targetFolder: candidate, targetName: candidateName, parentFolder: baseDir, alreadyExists: false };
			}

			candidateName = `${baseName}-${i + 1}`;
		}

		const fallback = `${baseName}-${Date.now()}`;
		return { targetFolder: joinPath(baseDir, fallback), targetName: fallback, parentFolder: baseDir, alreadyExists: false };
	}

	private async waitForReady(folder: URI): Promise<boolean> {
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			if (await this.isReadyProject(folder)) {
				return true;
			}
			await timeout(500);
		}

		return false;
	}

	private async openFolder(folderUri: URI): Promise<void> {
		await this.hostService.openWindow([{ folderUri }], {
			forceReuseWindow: true,
			remoteAuthority: this.workbenchEnvironmentService.remoteAuthority
		});
	}

	private quoteShellArg(arg: string): string {
		return `"${arg.replaceAll('"', '\\"')}"`;
	}
}

registerSingleton(IDefaultProjectService, DefaultProjectService, InstantiationType.Delayed);

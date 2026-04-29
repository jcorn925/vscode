/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../vs/base/common/async.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { join } from '../../vs/base/common/path.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { isWindows } from '../../vs/base/common/platform.js';
import { IConfigurationService } from '../../vs/platform/configuration/common/configuration.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../vs/platform/notification/common/notification.js';
import { INativeEnvironmentService } from '../../vs/platform/environment/common/environment.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { IHostService } from '../../vs/workbench/services/host/browser/host.js';
import { IWorkbenchEnvironmentService } from '../../vs/workbench/services/environment/common/environmentService.js';

export interface IDefaultProjectService {
	readonly _serviceBrand: undefined;
	createAndOpenDefaultProject(): Promise<void>;
}

export const IDefaultProjectService = createDecorator<IDefaultProjectService>('defaultProjectService');

export class DefaultProjectService extends Disposable implements IDefaultProjectService {
	readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IHostService private readonly hostService: IHostService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
	}

	async createAndOpenDefaultProject(): Promise<void> {
		const repoUrl = this.configurationService.getValue<string>('custom.defaultProject.repoUrl')?.trim();
		if (!repoUrl) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: 'Configure custom.defaultProject.repoUrl before creating the default project.'
			});
			return;
		}

		const branch = this.configurationService.getValue<string>('custom.defaultProject.branch')?.trim();

		const { targetFolder, targetName, parentFolder, alreadyExists } = await this.resolveTargetFolder();

		if (alreadyExists) {
			await this.openFolder(targetFolder);
			return;
		}

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

		// Wait for folder to materialize on disk before opening.
		const created = await this.waitForExists(targetFolder);
		if (!created) {
			this.notificationService.notify({
				severity: Severity.Error,
				message: 'Default project clone did not complete in time. Check the terminal output.'
			});
			return;
		}

		await this.openFolder(targetFolder);
	}

	private async resolveTargetFolder(): Promise<{ targetFolder: URI; targetName: string; parentFolder: URI; alreadyExists: boolean }> {
		const baseDir = URI.file(join(this.environmentService.userDataPath, 'Custom'));
		const baseName = 'DefaultProject';

		await this.fileService.createFolder(baseDir);

		let candidateName = baseName;
		for (let i = 0; i < 100; i++) {
			const candidate = joinPath(baseDir, candidateName);
			const exists = await this.fileService.exists(candidate);
			if (!exists) {
				return { targetFolder: candidate, targetName: candidateName, parentFolder: baseDir, alreadyExists: false };
			}

			// If it already exists and looks like a git repo, reuse it.
			const gitDir = joinPath(candidate, '.git');
			if (await this.fileService.exists(gitDir)) {
				return { targetFolder: candidate, targetName: candidateName, parentFolder: baseDir, alreadyExists: true };
			}

			candidateName = `${baseName}-${i + 1}`;
		}

		// fall back to base dir with timestamp suffix
		const fallback = `${baseName}-${Date.now()}`;
		return { targetFolder: joinPath(baseDir, fallback), targetName: fallback, parentFolder: baseDir, alreadyExists: false };
	}

	private async waitForExists(folder: URI): Promise<boolean> {
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			if (await this.fileService.exists(folder)) {
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
		// Minimal quoting suitable for bash/zsh and cmd-ish shells: wrap in double quotes and escape internal quotes.
		return `"${arg.replaceAll('"', '\\"')}"`;
	}
}

registerSingleton(IDefaultProjectService, DefaultProjectService, InstantiationType.Delayed);


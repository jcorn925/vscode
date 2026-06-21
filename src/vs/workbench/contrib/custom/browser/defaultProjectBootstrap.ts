/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IModeService } from '../../../../../custom/mode/ModeService.js';
import { IDefaultProjectService } from '../../../../../custom/devserver/DefaultProjectService.js';

const DO_NOT_ASK_KEY = 'custom.defaultProject.doNotAskAgain';

export class DefaultProjectBootstrapContribution extends Disposable {
	static readonly ID = 'workbench.contrib.defaultProjectBootstrap';

	private didPromptForThisSession = false;
	private bootstrapStarted = false;

	constructor(
		@IModeService private readonly modeService: IModeService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDefaultProjectService private readonly defaultProjectService: IDefaultProjectService
	) {
		super();

		this._register(this.modeService.onDidChange(() => this.maybeBootstrap()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.maybeBootstrap()));

		this.maybeBootstrap();
	}

	private async maybeBootstrap(): Promise<void> {
		if (this.bootstrapStarted) {
			return;
		}

		if (!(await this.defaultProjectService.shouldBootstrapAtStartup())) {
			return;
		}

		const autoCreate = Boolean(this.configurationService.getValue<boolean>('custom.defaultProject.autoCreate') ?? true);
		const startupGuideHandlesAutoCreate =
			Boolean(this.configurationService.getValue<boolean>('custom.startupGuide.showOnIncomplete') ?? true)
			&& Boolean(this.configurationService.getValue<boolean>('custom.startupGuide.autoRun') ?? true);
		if (autoCreate && !startupGuideHandlesAutoCreate) {
			this.bootstrapStarted = true;
			await this.defaultProjectService.createAndOpenDefaultProject({ silent: true });
			return;
		}

		if (this.modeService.getMode() !== 'Code') {
			return;
		}

		this.maybePrompt();
	}

	private maybePrompt(): void {
		if (this.didPromptForThisSession) {
			return;
		}

		if (this.storageService.getBoolean(DO_NOT_ASK_KEY, StorageScope.PROFILE, false)) {
			return;
		}

		this.didPromptForThisSession = true;

		this.notificationService.prompt(
			Severity.Info,
			localize('custom.defaultProject.promptMessage', "No folder is open. Create and open your default project?"),
			[
				{
					label: localize('custom.defaultProject.create', "Create Default Project"),
					run: () => this.defaultProjectService.createAndOpenDefaultProject()
				},
				{
					label: localize('custom.defaultProject.notNow', "Not Now"),
					run: () => { /* noop */ }
				},
				{
					label: localize('custom.defaultProject.dontAskAgain', "Don't Ask Again"),
					run: () => this.storageService.store(DO_NOT_ASK_KEY, true, StorageScope.PROFILE, StorageTarget.USER)
				}
			]
		);
	}
}

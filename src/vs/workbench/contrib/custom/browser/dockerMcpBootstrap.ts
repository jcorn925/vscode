/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchMcpManagementService } from '../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { DockerAvailabilityStatus, IDockerAvailabilityService } from '../../../../../custom/docker/DockerAvailabilityService.js';

const MCP_DOCKER_SERVER_NAME = 'MCP_DOCKER';
const STORAGE_MISSING_DOCKER_NOTIFIED = 'custom.dockerMcp/missingDockerNotified';
const STORAGE_MISSING_MCP_TOOLKIT_NOTIFIED = 'custom.dockerMcp/missingMcpToolkitNotified';

export class DockerMcpBootstrapContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.dockerMcpBootstrap';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchMcpManagementService private readonly mcpManagementService: IWorkbenchMcpManagementService,
		@IDockerAvailabilityService private readonly dockerAvailabilityService: IDockerAvailabilityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		if (isWeb) {
			return;
		}
		void this.maybeInstallDockerMcp();
		this._register(this.dockerAvailabilityService.onDidChangeStatus(status => {
			if (status === DockerAvailabilityStatus.Available) {
				void this.maybeInstallDockerMcp();
			}
		}));
	}

	private isAutoInstallEnabled(): boolean {
		return Boolean(this.configurationService.getValue<boolean>('custom.dockerMcp.autoInstall') ?? true);
	}

	private getProfile(): string {
		const raw = this.configurationService.getValue<string>('custom.dockerMcp.profile');
		const profile = typeof raw === 'string' ? raw.trim() : '';
		return profile.length > 0 ? profile : 'default';
	}

	private async maybeInstallDockerMcp(): Promise<void> {
		if (!this.isAutoInstallEnabled()) {
			return;
		}

		try {
			const installed = await this.mcpManagementService.getInstalled();
			if (installed.some(s => s.name === MCP_DOCKER_SERVER_NAME)) {
				return;
			}

			const status = await this.dockerAvailabilityService.refresh();
			if (status === DockerAvailabilityStatus.Missing) {
				this.notifyMissingDockerOnce();
				return;
			}
			if (status === DockerAvailabilityStatus.McpToolkitMissing) {
				this.notifyMissingMcpToolkitOnce();
				return;
			}
			if (status !== DockerAvailabilityStatus.Available) {
				return;
			}

			const profile = this.getProfile();
			await this.mcpManagementService.install({
				name: MCP_DOCKER_SERVER_NAME,
				config: {
					type: McpServerType.LOCAL,
					command: 'docker',
					args: ['mcp', 'gateway', 'run', '--profile', profile],
				},
			});
		} catch {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'custom.dockerMcp.installFailed',
					'Could not install the Docker MCP server automatically. Enable Docker Desktop MCP Toolkit, then run "MCP: Add Server" or `docker mcp client connect vscode --profile {0} --global`.',
					this.getProfile(),
				),
			});
		}
	}

	private notifyMissingDockerOnce(): void {
		if (this.storageService.getBoolean(STORAGE_MISSING_DOCKER_NOTIFIED, StorageScope.APPLICATION, false)) {
			return;
		}
		this.storageService.store(STORAGE_MISSING_DOCKER_NOTIFIED, true, StorageScope.APPLICATION, StorageTarget.USER);
		this.notificationService.notify({
			severity: Severity.Warning,
			message: localize(
				'custom.dockerMcp.missingDocker',
				'Docker Desktop is required for Ix (`ix docker start`) and Docker MCP tools. Install Docker Desktop, start it, then reload this window.',
			),
		});
	}

	private notifyMissingMcpToolkitOnce(): void {
		if (this.storageService.getBoolean(STORAGE_MISSING_MCP_TOOLKIT_NOTIFIED, StorageScope.APPLICATION, false)) {
			return;
		}
		this.storageService.store(STORAGE_MISSING_MCP_TOOLKIT_NOTIFIED, true, StorageScope.APPLICATION, StorageTarget.USER);
		this.notificationService.notify({
			severity: Severity.Info,
			message: localize(
				'custom.dockerMcp.missingMcpToolkit',
				'Docker is installed, but the Docker MCP Toolkit CLI is unavailable. In Docker Desktop, open Settings → Beta features → enable Docker MCP Toolkit, then reload this window.',
			),
		});
	}
}

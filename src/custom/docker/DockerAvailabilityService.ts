/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable, DisposableStore } from '../../vs/base/common/lifecycle.js';
import { isWeb, isWindows } from '../../vs/base/common/platform.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';

export const enum DockerAvailabilityStatus {
	Unknown = 'unknown',
	Available = 'available',
	Missing = 'missing',
	McpToolkitMissing = 'mcpToolkitMissing',
}

export const DOCKER_DESKTOP_URL = 'https://www.docker.com/products/docker-desktop/';

export interface IDockerAvailabilityService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeStatus: Event<DockerAvailabilityStatus>;
	getStatus(): DockerAvailabilityStatus;
	refresh(): Promise<DockerAvailabilityStatus>;
}

export const IDockerAvailabilityService = createDecorator<IDockerAvailabilityService>('dockerAvailabilityService');

const REFRESH_INTERVAL_MS = 45_000;

export class DockerAvailabilityService extends Disposable implements IDockerAvailabilityService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<DockerAvailabilityStatus>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private status: DockerAvailabilityStatus = DockerAvailabilityStatus.Unknown;
	private refreshInFlight: Promise<DockerAvailabilityStatus> | undefined;

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super();
		if (isWeb) {
			return;
		}
		void this.refresh();
		const interval = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
		this._register({ dispose: () => clearInterval(interval) });
	}

	getStatus(): DockerAvailabilityStatus {
		return this.status;
	}

	async refresh(): Promise<DockerAvailabilityStatus> {
		if (isWeb) {
			return DockerAvailabilityStatus.Available;
		}
		if (this.refreshInFlight) {
			return this.refreshInFlight;
		}
		this.refreshInFlight = this.doRefresh().finally(() => {
			this.refreshInFlight = undefined;
		});
		return this.refreshInFlight;
	}

	private async doRefresh(): Promise<DockerAvailabilityStatus> {
		let next = DockerAvailabilityStatus.Missing;
		if (await this.probeCommand('docker', ['version', '--format', '{{.Server.Version}}'], 12_000)) {
			next = await this.probeCommand('docker', ['mcp', 'version'], 12_000)
				? DockerAvailabilityStatus.Available
				: DockerAvailabilityStatus.McpToolkitMissing;
		}
		if (next !== this.status) {
			this.status = next;
			this._onDidChangeStatus.fire(next);
		}
		return next;
	}

	private shellLaunchForCommand(commandLine: string): { executable: string; args: string[] } {
		if (isWindows) {
			return { executable: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
		}
		return { executable: '/bin/bash', args: ['-c', commandLine] };
	}

	private quoteShellArg(arg: string): string {
		if (isWindows) {
			if (/[\s"&<>|^]/.test(arg)) {
				return `"${arg.replace(/"/g, '\\"')}"`;
			}
			return arg;
		}
		return `'${arg.replace(/'/g, `'\\''`)}'`;
	}

	private async probeCommand(command: string, args: readonly string[], timeoutMs: number): Promise<boolean> {
		const commandLine = [command, ...args].map(a => this.quoteShellArg(a)).join(' ');
		const shell = this.shellLaunchForCommand(commandLine);
		const store = new DisposableStore();
		try {
			const instance = await this.terminalService.createTerminal({
				config: {
					...shell,
					name: 'Docker probe',
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			});
			store.add(instance);

			const exitCode = await new Promise<number>((resolve, reject) => {
				const handle = setTimeout(() => reject(new Error('timeout')), timeoutMs);
				store.add({ dispose: () => clearTimeout(handle) });
				store.add(instance.onExit(code => {
					clearTimeout(handle);
					resolve(typeof code === 'number' ? code : 1);
				}));
			});
			return exitCode === 0;
		} catch {
			return false;
		} finally {
			store.dispose();
		}
	}
}

registerSingleton(IDockerAvailabilityService, DockerAvailabilityService, InstantiationType.Delayed);

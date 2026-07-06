/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { isWindows } from '../../vs/base/common/platform.js';

export function parsePortFromLocalUrl(localUrl: string | undefined): number | undefined {
	if (!localUrl) {
		return undefined;
	}
	const match = /:(\d{2,5})(?:\/|$)/.exec(localUrl);
	if (!match) {
		return undefined;
	}
	const port = Number(match[1]);
	return Number.isFinite(port) ? port : undefined;
}

export function collectUniqueSurfacePorts(surfaces: readonly { localUrl?: string }[]): number[] {
	const ports = new Set<number>();
	for (const surface of surfaces) {
		const port = parsePortFromLocalUrl(surface.localUrl);
		if (port) {
			ports.add(port);
		}
	}
	return [...ports].sort((a, b) => a - b);
}

export async function killProcessListeningOnPort(port: number): Promise<boolean> {
	if (!Number.isFinite(port) || port <= 0 || port > 65535) {
		return false;
	}

	try {
		const pids = await listListeningProcessIds(port);
		if (!pids.length) {
			return false;
		}
		for (const pid of pids) {
			try {
				process.kill(pid);
			} catch {
				// Process may have already exited.
			}
		}
		return true;
	} catch {
		return false;
	}
}

export async function freeSurfacePorts(ports: readonly number[]): Promise<void> {
	const unique = [...new Set(ports.filter(port => Number.isFinite(port) && port > 0))];
	await Promise.all(unique.map(port => killProcessListeningOnPort(port)));
}

function listListeningProcessIds(port: number): Promise<number[]> {
	return new Promise((resolve, reject) => {
		const command = isWindows
			? `netstat -ano | findstr ":${port}"`
			: `lsof -nP -iTCP:${port} -sTCP:LISTEN -t`;
		exec(command, {}, (error, stdout) => {
			if (error && !stdout?.trim()) {
				reject(error);
				return;
			}
			const pids = isWindows
				? parseWindowsNetstatPids(stdout, port)
				: parseUnixLsofPids(stdout);
			resolve(pids);
		});
	});
}

function parseUnixLsofPids(stdout: string): number[] {
	return stdout
		.split(/\r?\n/)
		.map(line => Number.parseInt(line.trim(), 10))
		.filter(pid => Number.isFinite(pid) && pid > 0);
}

function parseWindowsNetstatPids(stdout: string, port: number): number[] {
	const portToken = `:${port}`;
	const pids = new Set<number>();
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.includes('LISTENING') || !line.includes(portToken)) {
			continue;
		}
		const parts = line.trim().split(/\s+/);
		const pid = Number.parseInt(parts[parts.length - 1] ?? '', 10);
		if (Number.isFinite(pid) && pid > 0) {
			pids.add(pid);
		}
	}
	return [...pids];
}

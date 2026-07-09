/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb } from '../../vs/base/common/platform.js';
import { IInstantiationService } from '../../vs/platform/instantiation/common/instantiation.js';
import { ILocalPtyService, type IPtyHostService } from '../../vs/platform/terminal/common/terminal.js';

function getPtyHostService(instantiationService: IInstantiationService): IPtyHostService | undefined {
	if (isWeb) {
		return undefined;
	}
	try {
		return instantiationService.invokeFunction(accessor => accessor.get(ILocalPtyService));
	} catch {
		return undefined;
	}
}

export async function killProcessListeningOnPort(port: number, instantiationService: IInstantiationService): Promise<boolean> {
	if (!Number.isFinite(port) || port <= 0 || port > 65535) {
		return false;
	}

	const ptyHostService = getPtyHostService(instantiationService);
	if (!ptyHostService) {
		return false;
	}

	try {
		await ptyHostService.freePortKillProcess(String(port));
		return true;
	} catch {
		return false;
	}
}

export async function freeSurfacePorts(ports: readonly number[], instantiationService: IInstantiationService): Promise<void> {
	const unique = [...new Set(ports.filter(port => Number.isFinite(port) && port > 0))];
	await Promise.all(unique.map(port => killProcessListeningOnPort(port, instantiationService)));
}

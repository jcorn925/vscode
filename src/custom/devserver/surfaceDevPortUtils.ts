/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

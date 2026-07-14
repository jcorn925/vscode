/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceSurface } from './ConsoleService.js';
import { normalizeIxText, type IxSubsystemRegion, uniqueStrings } from './surfaceIxMatch.js';

function normalizePath(path: string): string {
	return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function regionPaths(region: IxSubsystemRegion): string[] {
	return uniqueStrings([
		region.entryPath,
		...(region.memberFiles ?? []),
	].filter((path): path is string => Boolean(path)).map(normalizePath));
}

export function regionIsUnderSurface(region: IxSubsystemRegion, surfacePath: string, surfaceId: string): boolean {
	const normalizedSurfacePath = normalizePath(surfacePath);
	const paths = regionPaths(region);
	return paths.some(path =>
		path === normalizedSurfacePath
		|| path.startsWith(`${normalizedSurfacePath}/`)
		|| path.includes(`/${surfaceId}/`)
	);
}

/**
 * Union path-scoped Ix regions with declared surface.ixSubsystems matches, de-duplicated by regionId.
 */
export function scopeIxRegionsToSurface(
	regions: readonly IxSubsystemRegion[],
	surface: Pick<WorkspaceSurface, 'id' | 'name' | 'path' | 'capabilities' | 'entities' | 'ixSubsystems' | 'ix'>,
	surfacePath?: string,
): readonly IxSubsystemRegion[] {
	const resolvedPath = normalizePath(surfacePath ?? surface.path ?? `apps/${surface.id}`);
	const pathScoped = regions.filter(region => regionIsUnderSurface(region, resolvedPath, surface.id));
	const declaredValues = new Set([
		...surface.ixSubsystems,
		...(surface.ix?.subsystemIds ?? []),
		...(surface.ix?.subsystemLabels ?? []),
	].map(normalizeIxText).filter(Boolean));
	const declaredMatched = regions.filter(region =>
		declaredValues.has(normalizeIxText(region.regionId))
		|| declaredValues.has(normalizeIxText(region.name))
	);

	const byId = new Map<string, IxSubsystemRegion>();
	for (const region of [...pathScoped, ...declaredMatched]) {
		const key = region.regionId.toLowerCase();
		if (!byId.has(key)) {
			byId.set(key, region);
		}
	}
	return [...byId.values()];
}

export function resolveSurfacePathForIx(surface: Pick<WorkspaceSurface, 'id' | 'path'>): string {
	return normalizePath(surface.path ?? `apps/${surface.id}`);
}

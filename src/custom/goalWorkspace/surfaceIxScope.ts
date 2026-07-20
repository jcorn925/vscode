/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IxDiscoveredSubsystem, IxOverlay, WorkspaceSurface } from './ConsoleService.js';
import {
	normalizeIxText,
	surfaceMatchTokens,
	type IxSubsystemRegion,
	uniqueStrings,
} from './surfaceIxMatch.js';

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

/** Collapse separators so `cadre-support-bot` matches `Cadre Support Bot` / `Ui / Cadre-support-bot`. */
function compactIxKey(value: string): string {
	return normalizeIxText(value).replace(/[^a-z0-9]+/g, '');
}

function regionMatchesSurfaceTokens(
	region: IxSubsystemRegion,
	surface: Pick<WorkspaceSurface, 'id' | 'name' | 'path'>,
	surfaceTokens: readonly string[],
): boolean {
	const surfaceKeys = uniqueStrings([
		compactIxKey(surface.id),
		compactIxKey(surface.name),
		compactIxKey(surface.path ?? ''),
	].filter(key => key.length >= 6));
	const candidates = [
		compactIxKey(region.regionId),
		compactIxKey(region.name),
	].filter(Boolean);

	// Contiguous surface-id / path match so short leftovers like "Cadre Bot" stay out of
	// `cadre-support-bot` (token overlap alone is too loose).
	if (surfaceKeys.length) {
		return candidates.some(candidate =>
			surfaceKeys.some(key => candidate.includes(key) || key.includes(candidate))
		);
	}

	// Short surface ids: require every token to appear in the region name/id.
	if (surfaceTokens.length < 2) {
		return false;
	}
	const looseCandidates = [
		region.regionId,
		region.name,
	].map(normalizeIxText).filter(Boolean);
	return surfaceTokens.every(token =>
		looseCandidates.some(candidate => candidate.includes(token))
	);
}

/**
 * Union path-scoped Ix regions with declared surface.ixSubsystems matches, de-duplicated by regionId.
 * When path + declared yield nothing (common when Ix detailed listing omits member paths),
 * fall back to fuzzy name/id token matching against the surface.
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
	const declaredMatched = regions.filter(region => {
		const candidates = [
			region.regionId,
			region.name,
			region.entryPath ?? '',
			...(region.memberFiles ?? []),
		].map(normalizeIxText).filter(Boolean);
		return candidates.some(candidate => declaredValues.has(candidate));
	});

	const byId = new Map<string, IxSubsystemRegion>();
	const add = (matched: readonly IxSubsystemRegion[]): void => {
		for (const region of matched) {
			const key = region.regionId.toLowerCase();
			if (!byId.has(key)) {
				byId.set(key, region);
			}
		}
	};
	add(pathScoped);
	add(declaredMatched);

	if (byId.size === 0) {
		const surfaceTokens = surfaceMatchTokens(surface);
		add(regions.filter(region => regionMatchesSurfaceTokens(region, surface, surfaceTokens)));
	}

	return [...byId.values()];
}

export function resolveSurfacePathForIx(surface: Pick<WorkspaceSurface, 'id' | 'path'>): string {
	return normalizePath(surface.path ?? `apps/${surface.id}`);
}

/** Convert `.agent/ix-surface-map.json` discoveredSubsystems into Graph-panel regions. */
export function regionsFromIxOverlayDiscovered(
	discovered: readonly IxDiscoveredSubsystem[] | undefined,
): readonly IxSubsystemRegion[] {
	if (!discovered?.length) {
		return [];
	}
	return discovered
		.filter(item => Boolean(item.id?.trim() && item.label?.trim()))
		.map(item => ({
			regionId: item.id.trim(),
			name: item.label.trim(),
			entryPath: item.path?.trim() || undefined,
			fileCount: item.fileCount,
		}));
}

const IX_SOURCE_FILE_RE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|vue|svelte|css|scss|less|json|md)$/i;
const IX_WALK_SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.next',
	'dist',
	'out',
	'build',
	'coverage',
	'.turbo',
	'.cache',
	'__pycache__',
]);

/** True when Real Graph should walk the filesystem for member files under `entryPath`. */
export function shouldExpandIxRegionMembers(
	region: Pick<IxSubsystemRegion, 'entryPath' | 'memberFiles'>,
): boolean {
	if ((region.memberFiles?.filter(Boolean).length ?? 0) > 0) {
		return false;
	}
	const entry = region.entryPath?.trim();
	if (!entry) {
		return false;
	}
	// File-like entry paths are already usable as a single member.
	return !/\.[a-z0-9]+$/i.test(entry);
}

export function isIxSourceFilePath(relativePath: string): boolean {
	const base = relativePath.split(/[/\\]/).pop() ?? '';
	if (!base || base.startsWith('.')) {
		return false;
	}
	return IX_SOURCE_FILE_RE.test(base);
}

export function shouldSkipIxWalkDir(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..') {
		return true;
	}
	if (IX_WALK_SKIP_DIRS.has(trimmed)) {
		return true;
	}
	// Keep walking normal folders; skip dotdirs except those already listed.
	return trimmed.startsWith('.');
}

/** Merge live Ix regions with overlay discoveries (live wins on id collision). */
export function mergeIxSubsystemRegions(
	primary: readonly IxSubsystemRegion[],
	fallback: readonly IxSubsystemRegion[],
): readonly IxSubsystemRegion[] {
	const byId = new Map<string, IxSubsystemRegion>();
	for (const region of primary) {
		byId.set(region.regionId.toLowerCase(), region);
	}
	for (const region of fallback) {
		const key = region.regionId.toLowerCase();
		if (!byId.has(key)) {
			byId.set(key, region);
		}
	}
	return [...byId.values()];
}

/**
 * Fold overlay surface mapping into declared ixSubsystems so Graph scoping sees
 * `.agent/ix-surface-map.json` even when workspace.goal.json metadata is stale.
 */
export function enrichSurfaceWithIxOverlay(
	surface: Pick<WorkspaceSurface, 'id' | 'name' | 'path' | 'capabilities' | 'entities' | 'ixSubsystems' | 'ix'>,
	overlay: IxOverlay | undefined,
): Pick<WorkspaceSurface, 'id' | 'name' | 'path' | 'capabilities' | 'entities' | 'ixSubsystems' | 'ix'> {
	const entry = overlay?.surfaces.find(item => item.surfaceId === surface.id);
	if (!entry) {
		return surface;
	}
	const subsystemIds = uniqueStrings([...(surface.ix?.subsystemIds ?? []), ...entry.subsystemIds]);
	const subsystemLabels = uniqueStrings([...(surface.ix?.subsystemLabels ?? []), ...entry.subsystemLabels]);
	return {
		...surface,
		ixSubsystems: uniqueStrings([...surface.ixSubsystems, ...subsystemIds, ...subsystemLabels]),
		ix: {
			subsystemIds,
			subsystemLabels,
			tags: surface.ix?.tags ?? [],
			notes: surface.ix?.notes,
		},
	};
}

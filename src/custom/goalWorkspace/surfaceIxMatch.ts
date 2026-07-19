/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceSurface } from './ConsoleService.js';
import type { SurfaceSubsystemSpec } from './surfaceBlueprintTypes.js';

export interface IxSubsystemRegion {
	readonly regionId: string;
	readonly name: string;
	readonly entryPath?: string;
	readonly memberFiles?: readonly string[];
	readonly fileCount?: number;
}

export function normalizeIxText(value: string): string {
	return value.trim().toLowerCase().replace(/\\/g, '/');
}

export function uniqueStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = value.trim();
		const key = normalized.toLowerCase();
		if (!normalized || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

export function surfaceMatchTokens(
	surface: Pick<WorkspaceSurface, 'id' | 'name' | 'path' | 'capabilities' | 'entities'>,
): readonly string[] {
	return uniqueStrings([
		surface.id,
		surface.name,
		surface.path ?? '',
		...(surface.capabilities ?? []),
		...(surface.entities ?? []),
	].flatMap(value => normalizeIxText(value).split(/[^a-z0-9]+/i))
		.filter(token => token.length >= 3));
}

export function matchSurfaceToIxSubsystems(
	surface: WorkspaceSurface,
	subsystems: readonly IxSubsystemRegion[],
): { surfaceId: string; subsystemIds: string[]; subsystemLabels: string[]; matchReason: string } {
	const declaredMatches = new Set([
		...surface.ixSubsystems,
		...(surface.ix?.subsystemIds ?? []),
		...(surface.ix?.subsystemLabels ?? []),
	].map(normalizeIxText).filter(Boolean));
	const surfaceTokens = surfaceMatchTokens(surface);
	const matched: IxSubsystemRegion[] = [];
	let usedDeclared = false;

	for (const subsystem of subsystems) {
		const candidates = [
			subsystem.regionId,
			subsystem.name,
			subsystem.entryPath ?? '',
			...(subsystem.memberFiles ?? []),
		].map(normalizeIxText).filter(Boolean);

		if (candidates.some(candidate => declaredMatches.has(candidate))) {
			matched.push(subsystem);
			usedDeclared = true;
			continue;
		}

		if (surfaceTokens.length > 0 && candidates.some(candidate => surfaceTokens.some(token => candidate.includes(token)))) {
			matched.push(subsystem);
		}
	}

	return {
		surfaceId: surface.id,
		subsystemIds: uniqueStrings(matched.map(subsystem => subsystem.regionId)),
		subsystemLabels: uniqueStrings(matched.map(subsystem => subsystem.name)),
		matchReason: usedDeclared ? 'declared ix metadata' : 'heuristic name/path match',
	};
}

export function blueprintSubsystemMatchesIx(
	subsystem: SurfaceSubsystemSpec,
	regions: readonly IxSubsystemRegion[],
): boolean {
	const tokens = uniqueStrings([
		subsystem.label,
		subsystem.id,
		...subsystem.paths,
	].flatMap(value => normalizeIxText(value).split(/[^a-z0-9]+/i))
		.filter(token => token.length >= 3));

	if (tokens.length === 0) {
		return false;
	}

	for (const region of regions) {
		const candidates = [
			region.regionId,
			region.name,
			region.entryPath ?? '',
			...(region.memberFiles ?? []),
		].map(normalizeIxText).filter(Boolean);

		if (tokens.some(token => candidates.some(candidate => candidate.includes(token) || token.includes(candidate)))) {
			return true;
		}
	}
	return false;
}

export function toIxSubsystemRegions(
	subsystems: readonly {
		regionId: string;
		name: string;
		entryPath?: string;
		memberFiles?: readonly string[];
		fileCount?: number;
	}[],
): readonly IxSubsystemRegion[] {
	return subsystems.map(subsystem => ({
		regionId: subsystem.regionId,
		name: subsystem.name,
		entryPath: subsystem.entryPath,
		memberFiles: subsystem.memberFiles,
		fileCount: subsystem.fileCount,
	}));
}

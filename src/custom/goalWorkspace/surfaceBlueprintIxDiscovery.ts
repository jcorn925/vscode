/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { IIxIntegrationService } from '../ix/IxIntegrationService.js';
import { toIxSubsystemRegions, type IxSubsystemRegion } from './surfaceIxMatch.js';

export async function discoverIxSubsystemRegions(
	ix: IIxIntegrationService,
	workspaceFolder: URI,
): Promise<readonly IxSubsystemRegion[]> {
	await ix.ensureIxMappedIfEmpty(workspaceFolder);
	const res = await runSubsystemsListDetailed(ix, workspaceFolder);
	if (!res.ok) {
		return [];
	}
	return toIxSubsystemRegions(parseIxSubsystemRegions(res.value));
}

/** Prefer --all-items when supported; fall back if the CLI rejects the flag. */
async function runSubsystemsListDetailed(
	ix: IIxIntegrationService,
	workspaceFolder: URI,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
	const base = ['subsystems', '--list', '--detailed', '--sort', 'importance', '--format', 'json'] as const;
	const withAllItems = await ix.runJsonQuery([...base, '--all-items'], workspaceFolder, 90_000);
	if (withAllItems.ok) {
		return withAllItems;
	}
	if (/unknown|unrecognized|unexpected|invalid.*option|--all-items/i.test(withAllItems.error)) {
		return ix.runJsonQuery([...base], workspaceFolder, 90_000);
	}
	return withAllItems;
}

/** Exported for unit tests. */
export function parseIxSubsystemRegions(json: unknown): readonly {
	regionId: string;
	name: string;
	entryPath?: string;
	memberFiles?: readonly string[];
	fileCount?: number;
}[] {
	const regions = regionRecords(json);
	const out: {
		regionId: string;
		name: string;
		entryPath?: string;
		memberFiles?: readonly string[];
		fileCount?: number;
	}[] = [];
	for (const region of regions) {
		const name = textField(region.name) ?? textField(region.label) ?? textField(region.title);
		if (!name) {
			continue;
		}
		const regionId = textField(region.region_id) ?? textField(region.regionId) ?? textField(region.id) ?? name;
		const entryPath = textField(region.entry_path) ?? textField(region.entryPath) ?? textField(region.path);
		const memberFiles = parseMemberFilePaths(region);
		const fileCount = numberField(region.file_count) ?? numberField(region.fileCount);
		out.push({ regionId, name, entryPath, memberFiles, fileCount });
	}
	return out;
}

function regionRecords(json: unknown): Record<string, unknown>[] {
	if (Array.isArray(json)) {
		return json.filter((item): item is Record<string, unknown> => isRecord(item));
	}
	if (!isRecord(json)) {
		return [];
	}
	// Well-known wrappers from ix CLI / overlay snapshots.
	for (const key of ['scores', 'regions', 'subsystems', 'discoveredSubsystems', 'items', 'results', 'data']) {
		const value = json[key];
		if (Array.isArray(value)) {
			return value.filter((item): item is Record<string, unknown> => isRecord(item));
		}
	}
	// Last resort: any top-level array whose first element looks like a region.
	for (const value of Object.values(json)) {
		if (!Array.isArray(value) || value.length === 0) {
			continue;
		}
		const first = value[0];
		if (
			isRecord(first)
			&& (
				typeof first.region_id === 'string'
				|| typeof first.regionId === 'string'
				|| typeof first.id === 'string'
				|| typeof first.label === 'string'
				|| typeof first.label_kind === 'string'
			)
		) {
			return value.filter((item): item is Record<string, unknown> => isRecord(item));
		}
	}
	return [];
}

function parseMemberFilePaths(region: Record<string, unknown>): string[] | undefined {
	const raw = region.member_files ?? region.memberFiles ?? region.files;
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const paths = raw
		.map(item => (typeof item === 'string' ? item : isRecord(item) ? textField(item.path) ?? textField(item.file_path) : undefined))
		.filter((path): path is string => Boolean(path));
	return paths.length ? paths : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

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
	const res = await ix.runJsonQuery(
		['subsystems', '--list', '--detailed', '--sort', 'importance', '--format', 'json'],
		workspaceFolder,
		90_000,
	);
	if (!res.ok) {
		return [];
	}
	return toIxSubsystemRegions(parseIxSubsystemRegions(res.value));
}

function parseIxSubsystemRegions(json: unknown): readonly {
	regionId: string;
	name: string;
	entryPath?: string;
	memberFiles?: readonly string[];
}[] {
	const regions = regionRecords(json);
	const out: {
		regionId: string;
		name: string;
		entryPath?: string;
		memberFiles?: readonly string[];
	}[] = [];
	for (const region of regions) {
		const name = textField(region.name) ?? textField(region.label) ?? textField(region.title);
		if (!name) {
			continue;
		}
		const regionId = textField(region.region_id) ?? textField(region.regionId) ?? name;
		const entryPath = textField(region.entry_path) ?? textField(region.entryPath);
		const memberFiles = parseMemberFilePaths(region);
		out.push({ regionId, name, entryPath, memberFiles });
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
	for (const key of ['scores', 'regions', 'subsystems', 'items', 'results', 'data']) {
		const value = json[key];
		if (Array.isArray(value)) {
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

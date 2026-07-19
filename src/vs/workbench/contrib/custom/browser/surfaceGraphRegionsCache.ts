/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import type { IFileService } from '../../../../platform/files/common/files.js';
import type { SurfaceProposalTreeGraphRegion } from './surfaceProposalTreeCards.js';

export interface SurfaceGraphRegionsCacheDocument {
	readonly version: 1;
	readonly surfaceId: string;
	readonly updatedAt: string;
	readonly regions: readonly SurfaceProposalTreeGraphRegion[];
	readonly message?: string;
}

export function surfaceGraphRegionsCacheResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.graph-regions.json`);
}

export async function readSurfaceGraphRegionsCache(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
): Promise<SurfaceGraphRegionsCacheDocument | undefined> {
	const resource = surfaceGraphRegionsCacheResource(workspaceFolder, surfaceId);
	try {
		if (!(await fileService.exists(resource))) {
			return undefined;
		}
		const content = await fileService.readFile(resource);
		return parseSurfaceGraphRegionsCache(content.value.toString(), surfaceId);
	} catch {
		return undefined;
	}
}

export async function writeSurfaceGraphRegionsCache(
	fileService: IFileService,
	workspaceFolder: URI,
	doc: SurfaceGraphRegionsCacheDocument,
): Promise<void> {
	const resource = surfaceGraphRegionsCacheResource(workspaceFolder, doc.surfaceId);
	await fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(doc, null, '\t') + '\n'));
}

/** Exported for unit tests. */
export function parseSurfaceGraphRegionsCache(
	raw: string,
	fallbackSurfaceId?: string,
): SurfaceGraphRegionsCacheDocument | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	if (record.version !== 1) {
		return undefined;
	}
	const surfaceId = typeof record.surfaceId === 'string' && record.surfaceId.trim()
		? record.surfaceId.trim()
		: fallbackSurfaceId?.trim();
	if (!surfaceId) {
		return undefined;
	}
	const regionsRaw = Array.isArray(record.regions) ? record.regions : [];
	const regions: SurfaceProposalTreeGraphRegion[] = [];
	for (const item of regionsRaw) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			continue;
		}
		const region = item as Record<string, unknown>;
		const name = typeof region.name === 'string' ? region.name.trim() : '';
		if (!name) {
			continue;
		}
		const entryPath = typeof region.entryPath === 'string' ? region.entryPath.trim() : undefined;
		const memberFiles = Array.isArray(region.memberFiles)
			? region.memberFiles.filter((file): file is string => typeof file === 'string' && Boolean(file.trim())).map(file => file.trim())
			: undefined;
		const fileCount = typeof region.fileCount === 'number' && Number.isFinite(region.fileCount)
			? region.fileCount
			: undefined;
		regions.push({ name, entryPath, memberFiles, fileCount });
	}
	const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt.trim()
		? record.updatedAt.trim()
		: new Date(0).toISOString();
	const message = typeof record.message === 'string' && record.message.trim()
		? record.message.trim()
		: undefined;
	return { version: 1, surfaceId, updatedAt, regions, message };
}

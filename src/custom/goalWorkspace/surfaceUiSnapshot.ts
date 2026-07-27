/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { VSBuffer } from '../../vs/base/common/buffer.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';

/** Prefer deployed URL; fall back to local preview only when production is unset. */
export type SurfaceUiSnapshotKind = 'deployed' | 'local';

export interface SurfaceUiSnapshotSource {
	readonly url: string;
	readonly kind: SurfaceUiSnapshotKind;
}

export interface SurfaceUiSnapshotSidecar {
	readonly sourceUrl: string;
	readonly capturedAt: string;
	readonly kind: SurfaceUiSnapshotKind;
}

/** Skip re-capture when sidecar matches preferred URL and is newer than this. */
export const SURFACE_UI_SNAPSHOT_FRESH_MS = 24 * 60 * 60 * 1000;

const SNAPSHOT_IMAGE_NAME = 'ui-snapshot.jpg';
const SNAPSHOT_SIDECAR_NAME = 'ui-snapshot.json';

/** Sanitize surface id for a directory segment under `.agent/surfaces/`. */
export function sanitizeSurfaceUiSnapshotId(surfaceId: string): string {
	return surfaceId.trim().replace(/[^A-Za-z0-9._-]+/g, '-') || 'surface';
}

export function surfaceUiSnapshotDir(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', sanitizeSurfaceUiSnapshotId(surfaceId));
}

export function surfaceUiSnapshotImageResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(surfaceUiSnapshotDir(workspaceFolder, surfaceId), SNAPSHOT_IMAGE_NAME);
}

export function surfaceUiSnapshotSidecarResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(surfaceUiSnapshotDir(workspaceFolder, surfaceId), SNAPSHOT_SIDECAR_NAME);
}

/**
 * Normalize a URL for snapshot identity (strip Console cache-bust + trailing slash noise).
 */
export function normalizeSurfaceUiSnapshotUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		return '';
	}
	try {
		const parsed = new URL(trimmed);
		parsed.searchParams.delete('_vscodeUiReload');
		parsed.hash = '';
		let href = parsed.toString();
		if (href.endsWith('/') && parsed.pathname === '/') {
			// keep origin root as-is
		} else if (href.endsWith('/') && parsed.pathname.length > 1) {
			href = href.slice(0, -1);
		}
		return href;
	} catch {
		return trimmed.replace(/[?&]_vscodeUiReload=\d+/g, '').replace(/\/$/, '');
	}
}

export function surfaceUiSnapshotUrlsMatch(a: string, b: string): boolean {
	const left = normalizeSurfaceUiSnapshotUrl(a);
	const right = normalizeSurfaceUiSnapshotUrl(b);
	return Boolean(left && right && left === right);
}

/** Preferred card snapshot source: productionUrl wins over localUrl. */
export function preferredSurfaceUiSnapshotSource(input: {
	readonly productionUrl?: string;
	readonly localUrl?: string;
}): SurfaceUiSnapshotSource | undefined {
	const productionUrl = input.productionUrl?.trim();
	if (productionUrl) {
		return { url: productionUrl, kind: 'deployed' };
	}
	const localUrl = input.localUrl?.trim();
	if (localUrl) {
		return { url: localUrl, kind: 'local' };
	}
	return undefined;
}

export function parseSurfaceUiSnapshotSidecar(raw: string): SurfaceUiSnapshotSidecar | undefined {
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
	const sourceUrl = typeof record.sourceUrl === 'string' ? record.sourceUrl.trim() : '';
	const capturedAt = typeof record.capturedAt === 'string' ? record.capturedAt.trim() : '';
	const kind = record.kind === 'deployed' || record.kind === 'local' ? record.kind : undefined;
	if (!sourceUrl || !capturedAt || !kind) {
		return undefined;
	}
	return { sourceUrl, capturedAt, kind };
}

export function serializeSurfaceUiSnapshotSidecar(doc: SurfaceUiSnapshotSidecar): string {
	return `${JSON.stringify({
		sourceUrl: doc.sourceUrl,
		capturedAt: doc.capturedAt,
		kind: doc.kind,
	}, null, '\t')}\n`;
}

export function isSurfaceUiSnapshotSidecarFresh(
	sidecar: SurfaceUiSnapshotSidecar,
	preferredUrl: string,
	nowMs: number,
	freshMs: number = SURFACE_UI_SNAPSHOT_FRESH_MS,
): boolean {
	if (!surfaceUiSnapshotUrlsMatch(sidecar.sourceUrl, preferredUrl)) {
		return false;
	}
	const capturedMs = Date.parse(sidecar.capturedAt);
	if (!Number.isFinite(capturedMs)) {
		return false;
	}
	return nowMs - capturedMs < freshMs;
}

/** True when capture should run (no matching fresh sidecar). */
export function shouldCaptureSurfaceUiSnapshot(
	sidecar: SurfaceUiSnapshotSidecar | undefined,
	preferredUrl: string,
	nowMs: number,
	freshMs: number = SURFACE_UI_SNAPSHOT_FRESH_MS,
): boolean {
	if (!sidecar) {
		return true;
	}
	return !isSurfaceUiSnapshotSidecarFresh(sidecar, preferredUrl, nowMs, freshMs);
}

export async function readSurfaceUiSnapshotSidecar(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
): Promise<SurfaceUiSnapshotSidecar | undefined> {
	const resource = surfaceUiSnapshotSidecarResource(workspaceFolder, surfaceId);
	try {
		const content = await fileService.readFile(resource);
		return parseSurfaceUiSnapshotSidecar(content.value.toString());
	} catch {
		return undefined;
	}
}

/**
 * Valid cached snapshot for the preferred URL (sidecar match + image present).
 * Stale/mismatched sidecars are ignored (and optionally deleted by caller).
 */
export async function resolveSurfaceUiSnapshotForCard(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	preferredUrl: string,
): Promise<{ readonly image: URI; readonly sidecar: SurfaceUiSnapshotSidecar } | undefined> {
	const sidecar = await readSurfaceUiSnapshotSidecar(fileService, workspaceFolder, surfaceId);
	if (!sidecar || !surfaceUiSnapshotUrlsMatch(sidecar.sourceUrl, preferredUrl)) {
		return undefined;
	}
	const image = surfaceUiSnapshotImageResource(workspaceFolder, surfaceId);
	try {
		if (!(await fileService.exists(image))) {
			return undefined;
		}
	} catch {
		return undefined;
	}
	return { image, sidecar };
}

export async function writeSurfaceUiSnapshot(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	input: {
		readonly imageBytes: Uint8Array | VSBuffer;
		readonly sourceUrl: string;
		readonly kind: SurfaceUiSnapshotKind;
		readonly capturedAt?: string;
	},
): Promise<URI> {
	const dir = surfaceUiSnapshotDir(workspaceFolder, surfaceId);
	await fileService.createFolder(joinPath(workspaceFolder, '.agent'));
	await fileService.createFolder(joinPath(workspaceFolder, '.agent', 'surfaces'));
	await fileService.createFolder(dir);
	const image = surfaceUiSnapshotImageResource(workspaceFolder, surfaceId);
	const sidecar = surfaceUiSnapshotSidecarResource(workspaceFolder, surfaceId);
	const bytes = input.imageBytes instanceof VSBuffer
		? input.imageBytes
		: VSBuffer.wrap(input.imageBytes);
	await fileService.writeFile(image, bytes);
	await fileService.writeFile(sidecar, VSBuffer.fromString(serializeSurfaceUiSnapshotSidecar({
		sourceUrl: normalizeSurfaceUiSnapshotUrl(input.sourceUrl),
		capturedAt: input.capturedAt ?? new Date().toISOString(),
		kind: input.kind,
	})));
	return image;
}

export async function deleteSurfaceUiSnapshot(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
): Promise<void> {
	const image = surfaceUiSnapshotImageResource(workspaceFolder, surfaceId);
	const sidecar = surfaceUiSnapshotSidecarResource(workspaceFolder, surfaceId);
	for (const resource of [image, sidecar]) {
		try {
			if (await fileService.exists(resource)) {
				await fileService.del(resource);
			}
		} catch {
			// best-effort
		}
	}
}

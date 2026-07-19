/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';

/**
 * Durable operational blockers for a surface (env keys, manual readiness gaps).
 * Console probes `.env.example` → `.env.local`; Claude may append manual blockers.
 * Console owns Steps; do not invent `.workflow.json` completions from this file alone.
 */

export type SurfaceBlockerStatus = 'open' | 'resolved' | 'dismissed';
export type SurfaceBlockerKind = 'env' | 'manual';
export type SurfaceBlockerSource = 'console' | 'agent';

export interface SurfaceBlockerEnvProbe {
	readonly type: 'env_key';
	readonly examplePath: string;
	readonly envPath: string;
	readonly key: string;
}

export interface SurfaceBlocker {
	readonly id: string;
	readonly label: string;
	readonly kind: SurfaceBlockerKind;
	readonly status: SurfaceBlockerStatus;
	readonly source: SurfaceBlockerSource;
	readonly probe?: SurfaceBlockerEnvProbe;
	readonly detail?: string;
}

export interface SurfaceBlockersDocument {
	readonly surfaceId: string;
	readonly updatedAt: string;
	readonly blockers: readonly SurfaceBlocker[];
}

export interface SurfaceBlockerStepRef {
	readonly id: string;
	readonly label: string;
}

/** Stable Steps step id for a blocker entry. */
export function blockerStepId(blockerId: string): string {
	const id = blockerId.trim();
	return id.startsWith('blocker:') ? id : `blocker:${id}`;
}

export function isBlockerStepId(stepId: string | undefined): boolean {
	return Boolean(stepId?.trim().startsWith('blocker:'));
}

export function surfaceBlockersResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.blockers.json`);
}

export function parseSurfaceBlockersDocument(
	raw: string,
	fallbackSurfaceId?: string,
): SurfaceBlockersDocument | undefined {
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
	const surfaceId = typeof record.surfaceId === 'string' && record.surfaceId.trim()
		? record.surfaceId.trim()
		: fallbackSurfaceId?.trim();
	if (!surfaceId) {
		return undefined;
	}
	const blockersRaw = Array.isArray(record.blockers) ? record.blockers : [];
	const blockers: SurfaceBlocker[] = [];
	for (const item of blockersRaw) {
		const blocker = normalizeBlocker(item);
		if (blocker) {
			blockers.push(blocker);
		}
	}
	return {
		surfaceId,
		updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
		blockers,
	};
}

export function serializeSurfaceBlockersDocument(doc: SurfaceBlockersDocument): string {
	return `${JSON.stringify({
		surfaceId: doc.surfaceId,
		updatedAt: doc.updatedAt,
		blockers: doc.blockers.map(blocker => ({
			id: blocker.id,
			label: blocker.label,
			kind: blocker.kind,
			status: blocker.status,
			source: blocker.source,
			...(blocker.probe ? { probe: blocker.probe } : {}),
			...(blocker.detail ? { detail: blocker.detail } : {}),
		})),
	}, null, '\t')}\n`;
}

export function openBlockerStepRefs(doc: SurfaceBlockersDocument | undefined): readonly SurfaceBlockerStepRef[] {
	if (!doc) {
		return [];
	}
	return doc.blockers
		.filter(blocker => blocker.status === 'open')
		.map(blocker => ({
			id: blockerStepId(blocker.id),
			label: blocker.label,
		}));
}

/** Parse `KEY=` lines from `.env.example` (skip comments and blank lines). */
export function parseEnvExampleKeys(raw: string): readonly string[] {
	const keys: string[] = [];
	const seen = new Set<string>();
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
		if (!match) {
			continue;
		}
		const key = match[1]!;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		keys.push(key);
	}
	return keys;
}

/**
 * True when the env value looks set (non-empty, not a common placeholder).
 * Rejects empty, `sk-ant-...` ellipsis placeholders, and `your-*-here` patterns.
 */
export function isEnvValueConfigured(raw: string | undefined): boolean {
	if (raw === undefined) {
		return false;
	}
	const value = raw.trim();
	if (!value) {
		return false;
	}
	if (/^sk-ant-\.+$/i.test(value) || /^sk-ant-\.{3,}$/i.test(value)) {
		return false;
	}
	if (/^sk-ant-\.\.\./i.test(value)) {
		return false;
	}
	if (/your[-_].*[-_]here/i.test(value)) {
		return false;
	}
	if (/^(changeme|replace[-_]?me|todo|xxx|<.+>)$/i.test(value)) {
		return false;
	}
	// Literal placeholder from cadre .env.example
	if (value === 'sk-ant-...') {
		return false;
	}
	return true;
}

export function parseEnvFileMap(raw: string): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			continue;
		}
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"'))
			|| (value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		map.set(key, value);
	}
	return map;
}

export function envKeyBlockerId(key: string): string {
	return `env:${key.trim()}`;
}

/**
 * Merge Console env probes into an existing blockers document.
 * Upserts open console env blockers for missing keys; resolves when configured.
 */
export function mergeEnvKeyProbes(options: {
	readonly surfaceId: string;
	readonly surfacePath: string;
	readonly exampleRaw: string | undefined;
	readonly envLocalRaw: string | undefined;
	readonly envRaw: string | undefined;
	readonly existing?: SurfaceBlockersDocument;
}): SurfaceBlockersDocument {
	const surfacePath = options.surfacePath.replace(/\/+$/, '') || `apps/${options.surfaceId}`;
	const examplePath = `${surfacePath}/.env.example`;
	const envLocalPath = `${surfacePath}/.env.local`;
	const keys = options.exampleRaw !== undefined ? parseEnvExampleKeys(options.exampleRaw) : [];
	const envMap = new Map<string, string>();
	if (options.envLocalRaw !== undefined) {
		for (const [key, value] of parseEnvFileMap(options.envLocalRaw)) {
			envMap.set(key, value);
		}
	}
	if (options.envRaw !== undefined) {
		for (const [key, value] of parseEnvFileMap(options.envRaw)) {
			if (!envMap.has(key)) {
				envMap.set(key, value);
			}
		}
	}

	const byId = new Map<string, SurfaceBlocker>();
	for (const blocker of options.existing?.blockers ?? []) {
		byId.set(blocker.id, blocker);
	}

	const now = new Date().toISOString();
	for (const key of keys) {
		const id = envKeyBlockerId(key);
		const configured = isEnvValueConfigured(envMap.get(key));
		const prior = byId.get(id);
		if (prior?.status === 'dismissed') {
			continue;
		}
		const label = `Set ${key} in .env.local`;
		const probe: SurfaceBlockerEnvProbe = {
			type: 'env_key',
			examplePath,
			envPath: envLocalPath,
			key,
		};
		if (configured) {
			byId.set(id, {
				id,
				label: prior?.label ?? label,
				kind: 'env',
				status: 'resolved',
				source: prior?.source === 'agent' ? 'agent' : 'console',
				probe,
				detail: prior?.detail,
			});
		} else {
			byId.set(id, {
				id,
				label: prior?.label ?? label,
				kind: 'env',
				status: 'open',
				source: prior?.source === 'agent' ? 'agent' : 'console',
				probe,
				detail: prior?.detail ?? `${key} is listed in .env.example but not set in .env.local.`,
			});
		}
	}

	// Preserve non-env / agent blockers not covered by this probe pass.
	const blockers = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
	return {
		surfaceId: options.surfaceId,
		updatedAt: now,
		blockers,
	};
}

function normalizeBlocker(value: unknown): SurfaceBlocker | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id.trim() : '';
	const label = typeof record.label === 'string' ? record.label.trim() : '';
	if (!id || !label) {
		return undefined;
	}
	const kind: SurfaceBlockerKind = record.kind === 'env' || record.kind === 'manual' ? record.kind : 'manual';
	const status: SurfaceBlockerStatus = record.status === 'open' || record.status === 'resolved' || record.status === 'dismissed'
		? record.status
		: 'open';
	const source: SurfaceBlockerSource = record.source === 'console' || record.source === 'agent' ? record.source : 'agent';
	const probe = normalizeProbe(record.probe);
	return {
		id,
		label,
		kind,
		status,
		source,
		...(probe ? { probe } : {}),
		...(typeof record.detail === 'string' && record.detail.trim() ? { detail: record.detail.trim() } : {}),
	};
}

function normalizeProbe(value: unknown): SurfaceBlockerEnvProbe | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (record.type !== 'env_key') {
		return undefined;
	}
	const examplePath = typeof record.examplePath === 'string' ? record.examplePath.trim() : '';
	const envPath = typeof record.envPath === 'string' ? record.envPath.trim() : '';
	const key = typeof record.key === 'string' ? record.key.trim() : '';
	if (!examplePath || !envPath || !key) {
		return undefined;
	}
	return { type: 'env_key', examplePath, envPath, key };
}

async function readOptionalText(fileService: IFileService, resource: URI): Promise<string | undefined> {
	try {
		const content = await fileService.readFile(resource);
		return content.value.toString();
	} catch {
		return undefined;
	}
}

/** Load blockers.json, merge Console env probes from the surface app folder, optionally persist. */
export async function loadAndProbeSurfaceBlockers(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	surfacePath: string | undefined,
	options?: { readonly persist?: boolean },
): Promise<SurfaceBlockersDocument> {
	const id = surfaceId.trim();
	const appPath = (surfacePath?.trim() || `apps/${id}`).replace(/\/+$/, '');
	const blockersUri = surfaceBlockersResource(workspaceFolder, id);
	const exampleUri = joinPath(workspaceFolder, ...appPath.split('/').filter(Boolean), '.env.example');
	const envLocalUri = joinPath(workspaceFolder, ...appPath.split('/').filter(Boolean), '.env.local');
	const envUri = joinPath(workspaceFolder, ...appPath.split('/').filter(Boolean), '.env');

	const [existingRaw, exampleRaw, envLocalRaw, envRaw] = await Promise.all([
		readOptionalText(fileService, blockersUri),
		readOptionalText(fileService, exampleUri),
		readOptionalText(fileService, envLocalUri),
		readOptionalText(fileService, envUri),
	]);
	const existing = existingRaw ? parseSurfaceBlockersDocument(existingRaw, id) : undefined;
	const merged = mergeEnvKeyProbes({
		surfaceId: id,
		surfacePath: appPath,
		exampleRaw,
		envLocalRaw,
		envRaw,
		existing,
	});

	if (options?.persist !== false) {
		const shouldPersist = merged.blockers.length > 0 || Boolean(existing);
		if (shouldPersist) {
			const priorSerialized = existing ? serializeSurfaceBlockersDocument(existing) : undefined;
			const nextSerialized = serializeSurfaceBlockersDocument(merged);
			if (priorSerialized !== nextSerialized) {
				try {
					await fileService.createFolder(joinPath(workspaceFolder, '.agent', 'surfaces'));
					await fileService.writeFile(blockersUri, VSBuffer.fromString(nextSerialized));
				} catch {
					// Persist is best-effort.
				}
			}
		}
	}
	return merged;
}

/** Mark a blocker resolved by step id (`blocker:…` or raw id). */
export function resolveBlockerInDocument(
	doc: SurfaceBlockersDocument,
	stepOrBlockerId: string,
): SurfaceBlockersDocument {
	const raw = stepOrBlockerId.trim();
	const blockerId = raw.startsWith('blocker:') ? raw.slice('blocker:'.length) : raw;
	const blockers = doc.blockers.map(blocker => {
		if (blocker.id !== blockerId && blockerStepId(blocker.id) !== raw) {
			return blocker;
		}
		if (blocker.status === 'resolved' || blocker.status === 'dismissed') {
			return blocker;
		}
		return { ...blocker, status: 'resolved' as const };
	});
	return {
		surfaceId: doc.surfaceId,
		updatedAt: new Date().toISOString(),
		blockers,
	};
}

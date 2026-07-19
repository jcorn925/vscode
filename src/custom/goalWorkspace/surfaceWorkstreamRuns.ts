/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';

export type SurfaceWorkstreamRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SurfaceWorkstreamRunEntry {
	readonly key: string;
	readonly workstreamId: string;
	readonly mode: 'parallel' | 'serialize';
	readonly status: SurfaceWorkstreamRunStatus;
	readonly error?: string;
}

export interface SurfaceWorkstreamRunsDocument {
	readonly surfaceId: string;
	readonly stepId: string;
	readonly stepLabel: string;
	readonly keys: readonly SurfaceWorkstreamRunEntry[];
	readonly updatedAt: string;
}

export function surfaceWorkstreamRunsResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.workstream-runs.json`);
}

export function createRunningWorkstreamRuns(options: {
	readonly surfaceId: string;
	readonly stepId: string;
	readonly stepLabel: string;
	readonly entries: readonly Omit<SurfaceWorkstreamRunEntry, 'status' | 'error'>[];
}): SurfaceWorkstreamRunsDocument {
	return {
		surfaceId: options.surfaceId,
		stepId: options.stepId,
		stepLabel: options.stepLabel,
		updatedAt: new Date().toISOString(),
		keys: options.entries.map(entry => ({
			...entry,
			status: 'running' as const,
		})),
	};
}

export function parseSurfaceWorkstreamRuns(
	raw: string,
	fallbackSurfaceId?: string,
): SurfaceWorkstreamRunsDocument | undefined {
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
	const stepId = typeof record.stepId === 'string' ? record.stepId.trim() : '';
	const stepLabel = typeof record.stepLabel === 'string' ? record.stepLabel.trim() : stepId;
	if (!surfaceId || !stepId || !Array.isArray(record.keys)) {
		return undefined;
	}
	const keys: SurfaceWorkstreamRunEntry[] = [];
	for (const item of record.keys) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			continue;
		}
		const row = item as Record<string, unknown>;
		const key = typeof row.key === 'string' ? row.key.trim() : '';
		const workstreamId = typeof row.workstreamId === 'string' ? row.workstreamId.trim() : '';
		const mode = row.mode === 'serialize' ? 'serialize' : row.mode === 'parallel' ? 'parallel' : undefined;
		const status = normalizeRunStatus(row.status);
		if (!key || !workstreamId || !mode || !status) {
			continue;
		}
		keys.push({
			key,
			workstreamId,
			mode,
			status,
			error: typeof row.error === 'string' && row.error.trim() ? row.error.trim() : undefined,
		});
	}
	if (!keys.length) {
		return undefined;
	}
	return {
		surfaceId,
		stepId,
		stepLabel: stepLabel || stepId,
		keys,
		updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
	};
}

export function serializeSurfaceWorkstreamRuns(doc: SurfaceWorkstreamRunsDocument): string {
	return `${JSON.stringify({
		surfaceId: doc.surfaceId,
		stepId: doc.stepId,
		stepLabel: doc.stepLabel,
		updatedAt: doc.updatedAt,
		keys: doc.keys.map(entry => ({
			key: entry.key,
			workstreamId: entry.workstreamId,
			mode: entry.mode,
			status: entry.status,
			...(entry.error ? { error: entry.error } : {}),
		})),
	}, null, '\t')}\n`;
}

/** True when every tracked workstream key has completed. */
export function workstreamRunsAllCompleted(doc: SurfaceWorkstreamRunsDocument | undefined): boolean {
	if (!doc?.keys.length) {
		return false;
	}
	return doc.keys.every(entry => entry.status === 'completed');
}

/** True when any stream failed (and none still running). */
export function workstreamRunsFailed(doc: SurfaceWorkstreamRunsDocument | undefined): boolean {
	if (!doc?.keys.length) {
		return false;
	}
	const anyFailed = doc.keys.some(entry => entry.status === 'failed');
	const anyRunning = doc.keys.some(entry => entry.status === 'running' || entry.status === 'pending');
	return anyFailed && !anyRunning;
}

export function workstreamRunsInFlightKeys(doc: SurfaceWorkstreamRunsDocument | undefined): readonly string[] {
	if (!doc) {
		return [];
	}
	return doc.keys.filter(entry => entry.status === 'running' || entry.status === 'pending').map(entry => entry.key);
}

function normalizeRunStatus(value: unknown): SurfaceWorkstreamRunStatus | undefined {
	if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
		return value;
	}
	return undefined;
}

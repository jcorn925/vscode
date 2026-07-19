/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';

/**
 * Durable Claude↔Console handshake for generate-phase execution.
 * Console writes `running` when Next kicks a phase; Claude writes `completed` /
 * `failed` after the phase gate. Console owns `.workflow.json` completions.
 */

export type SurfacePhaseProgressStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface SurfacePhaseProgressDocument {
	readonly surfaceId: string;
	readonly stepId: string;
	readonly stepLabel: string;
	readonly status: SurfacePhaseProgressStatus;
	readonly updatedAt: string;
	readonly message?: string;
	readonly error?: string;
}

export function surfacePhaseProgressResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.phase-progress.json`);
}

export function parseSurfacePhaseProgress(
	raw: string,
	fallbackSurfaceId?: string,
): SurfacePhaseProgressDocument | undefined {
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
	const status = normalizeStatus(record.status);
	if (!status) {
		return undefined;
	}
	const surfaceId = typeof record.surfaceId === 'string' && record.surfaceId.trim()
		? record.surfaceId.trim()
		: fallbackSurfaceId?.trim();
	const stepId = typeof record.stepId === 'string' ? record.stepId.trim() : '';
	const stepLabel = typeof record.stepLabel === 'string' ? record.stepLabel.trim() : stepId;
	if (!surfaceId || !stepId) {
		return undefined;
	}
	return {
		surfaceId,
		stepId,
		stepLabel: stepLabel || stepId,
		status,
		updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
		message: typeof record.message === 'string' && record.message.trim() ? record.message.trim() : undefined,
		error: typeof record.error === 'string' && record.error.trim() ? record.error.trim() : undefined,
	};
}

export function serializeSurfacePhaseProgress(doc: SurfacePhaseProgressDocument): string {
	return `${JSON.stringify({
		surfaceId: doc.surfaceId,
		stepId: doc.stepId,
		stepLabel: doc.stepLabel,
		status: doc.status,
		updatedAt: doc.updatedAt,
		...(doc.message ? { message: doc.message } : {}),
		...(doc.error ? { error: doc.error } : {}),
	}, null, '\t')}\n`;
}

export function createRunningPhaseProgress(options: {
	readonly surfaceId: string;
	readonly stepId: string;
	readonly stepLabel: string;
	readonly message?: string;
}): SurfacePhaseProgressDocument {
	return {
		surfaceId: options.surfaceId,
		stepId: options.stepId,
		stepLabel: options.stepLabel,
		status: 'running',
		updatedAt: new Date().toISOString(),
		message: options.message,
	};
}

export function createIdlePhaseProgress(surfaceId: string, prior?: SurfacePhaseProgressDocument): SurfacePhaseProgressDocument {
	return {
		surfaceId,
		stepId: prior?.stepId ?? '',
		stepLabel: prior?.stepLabel ?? '',
		status: 'idle',
		updatedAt: new Date().toISOString(),
	};
}

/** Step id currently executing (Claude in flight). */
export function phaseInFlightStepIdFromProgress(doc: SurfacePhaseProgressDocument | undefined): string | undefined {
	if (!doc || doc.status !== 'running') {
		return undefined;
	}
	return doc.stepId.trim() || undefined;
}

/** Failed phase that should show Retry for the same step. */
export function failedPhaseStepIdFromProgress(doc: SurfacePhaseProgressDocument | undefined): string | undefined {
	if (!doc || doc.status !== 'failed') {
		return undefined;
	}
	return doc.stepId.trim() || undefined;
}

function normalizeStatus(value: unknown): SurfacePhaseProgressStatus | undefined {
	if (value === 'idle' || value === 'running' || value === 'completed' || value === 'failed') {
		return value;
	}
	return undefined;
}

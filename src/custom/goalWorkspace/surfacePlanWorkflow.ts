/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import type {
	SurfacePlanWorkflowStepState,
	SurfacePlanWorkflowStepStatus,
} from './surfacePlanWorkflowStatus.js';

export interface SurfacePlanWorkflowDocument {
	readonly surfaceId: string;
	readonly updatedAt: string;
	readonly currentStepId?: string;
	readonly steps: readonly SurfacePlanWorkflowStepState[];
}

/** Durable sequential plan-execution record for a surface. */
export function surfacePlanWorkflowResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.workflow.json`);
}

export function parseSurfacePlanWorkflowDocument(raw: string, fallbackSurfaceId?: string): SurfacePlanWorkflowDocument | undefined {
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
	const stepsRaw = Array.isArray(record.steps) ? record.steps : [];
	const steps: SurfacePlanWorkflowStepState[] = [];
	for (const item of stepsRaw) {
		const step = normalizeStep(item);
		if (step) {
			steps.push(step);
		}
	}
	return {
		surfaceId,
		updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
		currentStepId: typeof record.currentStepId === 'string' ? record.currentStepId : undefined,
		steps,
	};
}

export function serializeSurfacePlanWorkflowDocument(doc: SurfacePlanWorkflowDocument): string {
	return `${JSON.stringify({
		surfaceId: doc.surfaceId,
		updatedAt: doc.updatedAt,
		currentStepId: doc.currentStepId,
		steps: doc.steps.map(step => ({
			id: step.id,
			label: step.label,
			kind: step.kind,
			status: step.status,
			...(step.completedAt ? { completedAt: step.completedAt } : {}),
		})),
	}, null, '\t')}\n`;
}

export function completedStepIdsFromWorkflow(doc: SurfacePlanWorkflowDocument | undefined): string[] {
	if (!doc) {
		return [];
	}
	return doc.steps.filter(step => step.status === 'completed').map(step => step.id);
}

export function mergeWorkflowSteps(
	surfaceId: string,
	resolvedSteps: readonly SurfacePlanWorkflowStepState[],
	existing?: SurfacePlanWorkflowDocument,
): SurfacePlanWorkflowDocument {
	const existingById = new Map((existing?.steps ?? []).map(step => [step.id, step]));
	const now = new Date().toISOString();
	const steps = resolvedSteps.map(step => {
		const prior = existingById.get(step.id);
		const completedAt = step.status === 'completed'
			? (prior?.completedAt ?? (prior?.status === 'completed' ? prior.completedAt : now))
			: undefined;
		return {
			...step,
			completedAt,
		};
	});
	const current = steps.find(step => step.status === 'current');
	return {
		surfaceId,
		updatedAt: now,
		currentStepId: current?.id,
		steps,
	};
}

function normalizeStep(value: unknown): SurfacePlanWorkflowStepState | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id.trim() : '';
	const label = typeof record.label === 'string' ? record.label.trim() : '';
	if (!id || !label) {
		return undefined;
	}
	const kind = record.kind === 'stage' || record.kind === 'action' || record.kind === 'phase' || record.kind === 'blocker'
		? record.kind
		: 'stage';
	const status = normalizeStatus(record.status);
	return {
		id,
		label,
		kind,
		status,
		completedAt: typeof record.completedAt === 'string' ? record.completedAt : undefined,
	};
}

function normalizeStatus(value: unknown): SurfacePlanWorkflowStepStatus {
	if (value === 'pending' || value === 'current' || value === 'completed' || value === 'skipped') {
		return value;
	}
	return 'pending';
}

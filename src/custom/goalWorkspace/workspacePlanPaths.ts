/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';

export type WorkspaceSuggestedSurfacesStatus = 'draft' | 'confirmed';

export interface WorkspaceSuggestedSurface {
	readonly id: string;
	readonly name: string;
	readonly purpose: string;
	readonly primaryUsers: readonly string[];
	readonly keyCapabilities: readonly string[];
	readonly suggested: boolean;
	readonly selected: boolean;
	readonly dependsOn: readonly string[];
}

export interface WorkspaceSuggestedSurfaces {
	readonly status: WorkspaceSuggestedSurfacesStatus;
	readonly sourceBrief?: string;
	readonly surfaces: readonly WorkspaceSuggestedSurface[];
	readonly updatedAt?: string;
}

/** Narrative multi-surface workspace plan (Console home planning). */
export function workspacePlanResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, '.agent', 'workspace.plan.md');
}

/** Structured suggested surfaces for the Console UI. */
export function workspaceSuggestedSurfacesResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, '.agent', 'workspace.surfaces.suggested.json');
}

/** Attachments dropped on Console home for workspace planning (e.g. brief PDF). */
export function workspaceAttachmentsDir(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, '.agent', 'workspace', 'attachments');
}

export function parseWorkspaceSuggestedSurfaces(raw: string): WorkspaceSuggestedSurfaces | undefined {
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
	const status = record.status === 'draft' || record.status === 'confirmed' ? record.status : undefined;
	if (!status) {
		return undefined;
	}
	const surfacesRaw = Array.isArray(record.surfaces) ? record.surfaces : [];
	const surfaces: WorkspaceSuggestedSurface[] = [];
	for (const item of surfacesRaw) {
		const surface = normalizeSuggestedSurface(item);
		if (surface) {
			surfaces.push(surface);
		}
	}
	if (!surfaces.length) {
		return undefined;
	}
	return {
		status,
		sourceBrief: typeof record.sourceBrief === 'string' ? record.sourceBrief : undefined,
		surfaces,
		updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
	};
}

export function serializeWorkspaceSuggestedSurfaces(doc: WorkspaceSuggestedSurfaces): string {
	return `${JSON.stringify({
		status: doc.status,
		sourceBrief: doc.sourceBrief,
		updatedAt: doc.updatedAt ?? new Date().toISOString(),
		surfaces: doc.surfaces.map(surface => ({
			id: surface.id,
			name: surface.name,
			purpose: surface.purpose,
			primaryUsers: [...surface.primaryUsers],
			keyCapabilities: [...surface.keyCapabilities],
			suggested: surface.suggested,
			selected: surface.selected,
			dependsOn: [...surface.dependsOn],
		})),
	}, null, '\t')}\n`;
}

export function withSuggestedSurfaceSelection(
	doc: WorkspaceSuggestedSurfaces,
	surfaceId: string,
	selected: boolean,
): WorkspaceSuggestedSurfaces {
	return {
		...doc,
		updatedAt: new Date().toISOString(),
		surfaces: doc.surfaces.map(surface =>
			surface.id === surfaceId ? { ...surface, selected } : surface
		),
	};
}

export function withSuggestedSurfacesStatus(
	doc: WorkspaceSuggestedSurfaces,
	status: WorkspaceSuggestedSurfacesStatus,
): WorkspaceSuggestedSurfaces {
	return {
		...doc,
		status,
		updatedAt: new Date().toISOString(),
	};
}

export function selectedSuggestedSurfaces(doc: WorkspaceSuggestedSurfaces): readonly WorkspaceSuggestedSurface[] {
	return doc.surfaces.filter(surface => surface.selected);
}

function normalizeSuggestedSurface(value: unknown): WorkspaceSuggestedSurface | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id.trim() : '';
	const name = typeof record.name === 'string' ? record.name.trim() : '';
	if (!id || !name) {
		return undefined;
	}
	const suggested = record.suggested === true;
	const selected = typeof record.selected === 'boolean' ? record.selected : suggested;
	return {
		id,
		name,
		purpose: typeof record.purpose === 'string' ? record.purpose.trim() : '',
		primaryUsers: stringArray(record.primaryUsers),
		keyCapabilities: stringArray(record.keyCapabilities),
		suggested,
		selected,
		dependsOn: stringArray(record.dependsOn),
	};
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is string => typeof item === 'string' && !!item.trim())
		.map(item => item.trim());
}

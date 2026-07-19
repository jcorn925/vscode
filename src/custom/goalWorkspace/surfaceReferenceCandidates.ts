/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';

export type SurfaceReferenceCandidatesStatus = 'awaiting_selection' | 'confirmed' | 'done';

export interface SurfaceReferenceRepo {
	readonly owner: string;
	readonly repo: string;
	readonly url: string;
	readonly description?: string;
	/** Why this repo was chosen vs plan.md Research / surface intent. */
	readonly reason?: string;
	readonly stars?: number;
	readonly suggested: boolean;
	readonly selected: boolean;
}

export interface SurfaceReferenceCandidates {
	readonly status: SurfaceReferenceCandidatesStatus;
	readonly surfaceId: string;
	readonly repos: readonly SurfaceReferenceRepo[];
	readonly updatedAt?: string;
}

/** Written by Claude during Research; Plan UI lets the user toggle selection. */
export function surfaceReferenceCandidatesResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.reference-candidates.json`);
}

export function referenceRepoLabel(repo: Pick<SurfaceReferenceRepo, 'owner' | 'repo'>): string {
	return `${repo.owner}/${repo.repo}`;
}

export function parseSurfaceReferenceCandidates(raw: string, fallbackSurfaceId?: string): SurfaceReferenceCandidates | undefined {
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
	const surfaceId = typeof record.surfaceId === 'string' && record.surfaceId.trim()
		? record.surfaceId.trim()
		: (fallbackSurfaceId?.trim() || '');
	if (!status || !surfaceId) {
		return undefined;
	}
	const reposRaw = Array.isArray(record.repos) ? record.repos : [];
	const repos: SurfaceReferenceRepo[] = [];
	for (const item of reposRaw) {
		const repo = normalizeRepo(item);
		if (repo) {
			repos.push(repo);
		}
	}
	if (!repos.length) {
		return undefined;
	}
	return {
		status,
		surfaceId,
		repos,
		updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
	};
}

export function serializeSurfaceReferenceCandidates(doc: SurfaceReferenceCandidates): string {
	return `${JSON.stringify({
		status: doc.status,
		surfaceId: doc.surfaceId,
		updatedAt: doc.updatedAt ?? new Date().toISOString(),
		repos: doc.repos.map(repo => ({
			owner: repo.owner,
			repo: repo.repo,
			url: repo.url,
			description: repo.description,
			reason: repo.reason,
			stars: repo.stars,
			suggested: repo.suggested,
			selected: repo.selected,
		})),
	}, null, '\t')}\n`;
}

export function withRepoSelection(
	doc: SurfaceReferenceCandidates,
	owner: string,
	repo: string,
	selected: boolean,
): SurfaceReferenceCandidates {
	return {
		...doc,
		updatedAt: new Date().toISOString(),
		repos: doc.repos.map(item =>
			item.owner === owner && item.repo === repo
				? { ...item, selected }
				: item
		),
	};
}

export function withCandidatesStatus(
	doc: SurfaceReferenceCandidates,
	status: SurfaceReferenceCandidatesStatus,
): SurfaceReferenceCandidates {
	return {
		...doc,
		status,
		updatedAt: new Date().toISOString(),
	};
}

export function selectedReferenceRepos(doc: SurfaceReferenceCandidates): readonly SurfaceReferenceRepo[] {
	return doc.repos.filter(repo => repo.selected);
}

/**
 * Prefer structured `reason`, then `description`, then a matching Research-section
 * line from plan.md that mentions this repo.
 */
export function resolveReferenceRepoReason(
	repo: Pick<SurfaceReferenceRepo, 'owner' | 'repo' | 'reason' | 'description'>,
	planMarkdown?: string,
): string | undefined {
	const structured = repo.reason?.trim() || repo.description?.trim();
	if (structured) {
		return structured;
	}
	return extractPlanResearchNoteForRepo(planMarkdown, repo.owner, repo.repo);
}

/** Pull a Research-section bullet/line that cites this GitHub repo. */
export function extractPlanResearchNoteForRepo(
	planMarkdown: string | undefined,
	owner: string,
	repo: string,
): string | undefined {
	if (!planMarkdown?.trim()) {
		return undefined;
	}
	const label = `${owner}/${repo}`.toLowerCase();
	const repoOnly = repo.toLowerCase();
	const researchBody = extractPlanSectionBody(planMarkdown, /research/i);
	const haystack = researchBody || planMarkdown;
	const lines = haystack.split(/\r?\n/);
	for (const raw of lines) {
		const line = raw.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim();
		if (!line) {
			continue;
		}
		const lower = line.toLowerCase();
		if (lower.includes(label) || (lower.includes('github.com/') && lower.includes(repoOnly))) {
			return line;
		}
	}
	return undefined;
}

function extractPlanSectionBody(markdown: string, headingMatch: RegExp): string | undefined {
	const lines = markdown.split(/\r?\n/);
	let capturing = false;
	const body: string[] = [];
	for (const line of lines) {
		const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
		if (heading) {
			if (capturing) {
				break;
			}
			capturing = headingMatch.test(heading[2]!);
			continue;
		}
		if (capturing) {
			body.push(line);
		}
	}
	return body.length ? body.join('\n') : undefined;
}

function normalizeStatus(value: unknown): SurfaceReferenceCandidatesStatus | undefined {
	return value === 'awaiting_selection' || value === 'confirmed' || value === 'done'
		? value
		: undefined;
}

function normalizeRepo(value: unknown): SurfaceReferenceRepo | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const owner = typeof record.owner === 'string' ? record.owner.trim() : '';
	const repo = typeof record.repo === 'string' ? record.repo.trim() : '';
	if (!owner || !repo) {
		return undefined;
	}
	const url = typeof record.url === 'string' && record.url.trim()
		? record.url.trim()
		: `https://github.com/${owner}/${repo}`;
	const suggested = record.suggested === true;
	const selected = typeof record.selected === 'boolean' ? record.selected : suggested;
	const reason = typeof record.reason === 'string' && record.reason.trim()
		? record.reason.trim()
		: (typeof record.relevance === 'string' && record.relevance.trim()
			? record.relevance.trim()
			: (typeof record.why === 'string' && record.why.trim() ? record.why.trim() : undefined));
	return {
		owner,
		repo,
		url,
		description: typeof record.description === 'string' ? record.description : undefined,
		reason,
		stars: typeof record.stars === 'number' && Number.isFinite(record.stars) ? record.stars : undefined,
		suggested,
		selected,
	};
}

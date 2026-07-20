/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';

/** Preferred durable plan path for a surface (multi-surface safe). */
export function surfacePlanResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.plan.md`);
}

/** Final graph-proposal contract for a surface. */
export function surfaceGraphProposalResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'task-trees', `${surfaceId}.graph-proposal.json`);
}

/** Raw Ix draft written during planning Research (before Plan-lock adapt). */
export function surfaceGraphProposalDraftResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, '.agent', 'task-trees', `${surfaceId}.graph-proposal.draft.json`);
}

/**
 * Candidate plan.md locations for a surface, preferred first.
 * Root `plan.md` remains for early Claude sessions that wrote a workspace-level plan.
 */
export function surfacePlanCandidateResources(workspaceFolder: URI, surfaceId: string, surfaceAppPath?: string): URI[] {
	const id = surfaceId.trim();
	const candidates: URI[] = [surfacePlanResource(workspaceFolder, id)];
	const appPath = (surfaceAppPath ?? `apps/${id}`).replace(/^\/+|\/+$/g, '');
	if (appPath) {
		candidates.push(joinPath(workspaceFolder, ...appPath.split('/'), 'plan.md'));
	}
	candidates.push(joinPath(workspaceFolder, 'plan.md'));
	return candidates;
}

export async function resolveSurfacePlanResource(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	surfaceAppPath?: string,
): Promise<URI | undefined> {
	for (const candidate of surfacePlanCandidateResources(workspaceFolder, surfaceId, surfaceAppPath)) {
		try {
			await fileService.stat(candidate);
			return candidate;
		} catch {
			// try next
		}
	}
	return undefined;
}

/** Directory for ix compare_proposal snapshots (named + latest). */
export function graphCompareDir(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, '.ix-scaffold', 'graph-compare');
}

/** Workspace-global last-writer snapshot (unsafe across surfaces without ownership check). */
export function latestProposalCompareSnapshotResource(workspaceFolder: URI): URI {
	return joinPath(graphCompareDir(workspaceFolder), 'latest-proposal.json');
}

/** Mirror scripts/ix_graph_compare.py tree_id sanitization for snapshot filenames. */
export function sanitizeGraphCompareId(id: string): string {
	return id.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}

/** True when a graph-compare filename is a named snapshot for this surface (or tree). */
export function isProposalCompareNamedSnapshotForSurface(
	fileName: string,
	surfaceId: string,
	treeId?: string,
): boolean {
	const name = fileName.trim();
	if (!name.startsWith('proposal_') || !name.endsWith('.json') || name === 'latest-proposal.json') {
		return false;
	}
	const ids = new Set<string>();
	const surface = sanitizeGraphCompareId(surfaceId);
	if (surface) {
		ids.add(surface);
	}
	const tree = treeId?.trim() ? sanitizeGraphCompareId(treeId) : '';
	if (tree) {
		ids.add(tree);
	}
	for (const id of ids) {
		const prefix = `proposal_${id}_vs_`;
		if (name.startsWith(prefix) && name.length > prefix.length + '.json'.length) {
			return true;
		}
	}
	return false;
}

export interface ProposalCompareSnapshotOwnership {
	readonly proposal?: {
		readonly path?: string;
		readonly tree_id?: string;
	};
}

/**
 * True when the snapshot was produced for this surface's proposal.
 * Requires tree_id and/or path metadata — anonymous snapshots do not match.
 */
export function proposalCompareSnapshotBelongsToSurface(
	snapshot: ProposalCompareSnapshotOwnership,
	options: {
		readonly surfaceId: string;
		readonly treeId?: string;
		readonly proposalPath?: string;
	},
): boolean {
	const snapTree = snapshot.proposal?.tree_id?.trim() ?? '';
	const snapPath = (snapshot.proposal?.path?.trim() ?? '').replace(/\\/g, '/');
	if (!snapTree && !snapPath) {
		return false;
	}

	const ownerIds = [options.surfaceId, options.treeId]
		.map(id => id?.trim() ?? '')
		.filter(Boolean);
	if (snapTree && ownerIds.some(id => id === snapTree || sanitizeGraphCompareId(id) === sanitizeGraphCompareId(snapTree))) {
		return true;
	}

	if (!snapPath) {
		return false;
	}
	const proposalPath = (options.proposalPath?.trim() ?? '').replace(/\\/g, '/');
	if (proposalPath) {
		if (
			snapPath === proposalPath
			|| snapPath.endsWith(proposalPath)
			|| proposalPath.endsWith(snapPath)
		) {
			return true;
		}
	}
	for (const id of ownerIds) {
		const suffix = `/.agent/task-trees/${id}.graph-proposal.json`;
		const base = `${id}.graph-proposal.json`;
		if (snapPath.endsWith(suffix) || snapPath.endsWith(`/${base}`) || snapPath === base) {
			return true;
		}
	}
	return false;
}

/** Among named compare snapshots for this surface, pick the newest by mtime. */
export function pickNewestProposalCompareNamedSnapshot(
	children: readonly { readonly name: string; readonly resource: URI; readonly mtime?: number }[],
	surfaceId: string,
	treeId?: string,
): URI | undefined {
	const matches = children.filter(child =>
		isProposalCompareNamedSnapshotForSurface(child.name, surfaceId, treeId)
	);
	if (!matches.length) {
		return undefined;
	}
	matches.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
	return matches[0]?.resource;
}

/**
 * Prefer the newest `proposal_<surfaceId|treeId>_vs_*.json`, else `latest-proposal.json`
 * only when its proposal metadata belongs to this surface.
 */
export async function resolveProposalCompareSnapshotResource(
	fileService: IFileService,
	workspaceFolder: URI,
	options: {
		readonly surfaceId: string;
		readonly treeId?: string;
		readonly proposalResource?: URI;
	},
): Promise<URI | undefined> {
	const surfaceId = options.surfaceId.trim();
	if (!surfaceId) {
		return undefined;
	}
	const dir = graphCompareDir(workspaceFolder);
	try {
		const stat = await fileService.resolve(dir);
		const children = (stat.children ?? []).map(child => ({
			name: child.name,
			resource: child.resource,
			mtime: child.mtime,
		}));
		const named = pickNewestProposalCompareNamedSnapshot(children, surfaceId, options.treeId);
		if (named) {
			return named;
		}
	} catch {
		// Compare dir missing — try latest below.
	}

	const latest = latestProposalCompareSnapshotResource(workspaceFolder);
	try {
		if (!(await fileService.exists(latest))) {
			return undefined;
		}
		const content = await fileService.readFile(latest);
		const parsed = JSON.parse(content.value.toString()) as ProposalCompareSnapshotOwnership;
		if (proposalCompareSnapshotBelongsToSurface(parsed, {
			surfaceId,
			treeId: options.treeId,
			proposalPath: options.proposalResource?.path,
		})) {
			return latest;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

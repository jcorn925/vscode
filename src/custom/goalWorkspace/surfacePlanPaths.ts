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

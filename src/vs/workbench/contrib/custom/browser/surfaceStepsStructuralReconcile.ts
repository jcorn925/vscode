/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	GraphProposalDocument,
	GraphProposalEdgeDocument,
	ProposalCompareSnapshot,
} from './proposalGraphDiff/proposalGraphDiffTypes.js';
import { computeSurfaceProposalProgress } from './surfaceProposalProgress.js';

export interface SurfacePlanPhaseRef {
	readonly id: string;
}

/**
 * True when the latest compare snapshot is a full structural pass against
 * this surface's loaded proposal (node recall complete, no missing structural edges).
 * Evaluate against the open surface's proposal so a workspace-global snapshot
 * from another surface cannot advance the wrong Steps rail.
 */
export function isFullStructuralProposalPass(
	proposal: GraphProposalDocument,
	snapshot: ProposalCompareSnapshot | undefined,
): boolean {
	if (!snapshot?.passed) {
		return false;
	}
	const addNodes = proposal.add_nodes ?? [];
	if (addNodes.length === 0) {
		return false;
	}
	const progress = computeSurfaceProposalProgress(proposal, undefined, snapshot);
	if (!progress.hasCompare || progress.filesMatched !== progress.filesTotal) {
		return false;
	}
	const structuralMissing = new Set(snapshot.comparison?.edges?.structural?.missing_in_clone ?? []);
	for (const raw of proposal.add_edges ?? []) {
		const edge = resolveStructuralEdgeLabel(raw);
		if (edge && structuralMissing.has(edge)) {
			return false;
		}
	}
	return true;
}

/**
 * Generate-phase step ids still incomplete when the compare snapshot is a full
 * structural pass. Never includes Enable Preview or blockers.
 */
export function phaseIdsToCompleteFromStructuralPass(options: {
	readonly proposal: GraphProposalDocument | undefined;
	readonly snapshot: ProposalCompareSnapshot | undefined;
	readonly proposalPhases: readonly SurfacePlanPhaseRef[];
	readonly completedStepIds: ReadonlySet<string> | readonly string[];
}): string[] {
	if (!options.proposal || !isFullStructuralProposalPass(options.proposal, options.snapshot)) {
		return [];
	}
	const completed = toCompletedSet(options.completedStepIds);
	const ids: string[] = [];
	for (const phase of options.proposalPhases) {
		const id = phase.id.trim();
		if (id && !completed.has(id)) {
			ids.push(id);
		}
	}
	return ids;
}

function resolveStructuralEdgeLabel(raw: GraphProposalEdgeDocument): string | undefined {
	if (raw.confidence !== 'structural') {
		return undefined;
	}
	const src = (raw.src || raw.from || '').trim();
	const dst = (raw.dst || raw.to || '').trim();
	const predicate = (raw.predicate || raw.type || '').trim();
	if (!src || !dst || !predicate) {
		return undefined;
	}
	return `${src} --${predicate.toUpperCase()}--> ${dst}`;
}

function toCompletedSet(value: ReadonlySet<string> | readonly string[]): Set<string> {
	if (value instanceof Set) {
		return value;
	}
	return new Set(value);
}

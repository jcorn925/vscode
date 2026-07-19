/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProposalWorkstreamPartition } from './proposalGraphDiff/partitionProposalWorkstreams.js';
import type {
	GraphProposalDocument,
	GraphProposalEdgeDocument,
	ProposalCompareSnapshot,
} from './proposalGraphDiff/proposalGraphDiffTypes.js';

export interface SurfaceWorkstreamProgress {
	readonly id: string;
	readonly matchedNodes: number;
	readonly totalNodes: number;
}

/** Completion derived from a proposal-compare snapshot (or totals-only when absent). */
export interface SurfaceProposalProgress {
	readonly hasCompare: boolean;
	readonly filesMatched: number;
	readonly filesTotal: number;
	readonly relationshipsMatched: number;
	readonly relationshipsTotal: number;
	readonly workstreamsComplete: number;
	readonly workstreamsTotal: number;
	readonly byWorkstream: readonly SurfaceWorkstreamProgress[];
}

export function formatSurfaceProgressValue(matched: number, total: number, hasCompare: boolean): string {
	if (!hasCompare) {
		return String(total);
	}
	return `${matched}/${total}`;
}

function edgeLabel(src: string, predicate: string, dst: string): string {
	return `${src} --${predicate.toUpperCase()}--> ${dst}`;
}

function resolveEdgeEndpoints(raw: GraphProposalEdgeDocument): { src: string; dst: string; predicate: string; structural: boolean } | undefined {
	const src = (raw.src || raw.from || '').trim();
	const dst = (raw.dst || raw.to || '').trim();
	const predicate = (raw.predicate || raw.type || '').trim();
	if (!src || !dst || !predicate) {
		return undefined;
	}
	return {
		src,
		dst,
		predicate,
		structural: raw.confidence === 'structural',
	};
}

function matchedNodeSet(proposal: GraphProposalDocument, snapshot: ProposalCompareSnapshot): Set<string> {
	const addNodes = proposal.add_nodes ?? [];
	const missing = new Set(snapshot.comparison?.nodes?.missing_in_clone ?? []);
	const matchedFromSnap = snapshot.comparison?.nodes?.matched_in_clone;
	if (matchedFromSnap) {
		return new Set(matchedFromSnap.filter(id => addNodes.includes(id)));
	}
	return new Set(addNodes.filter(id => !missing.has(id)));
}

function countMatchedRelationships(proposal: GraphProposalDocument, snapshot: ProposalCompareSnapshot): { matched: number; total: number } {
	const structuralMissing = new Set(snapshot.comparison?.edges?.structural?.missing_in_clone ?? []);
	const structuralMatched = new Set(snapshot.comparison?.edges?.structural?.matched_in_clone ?? []);
	const speculativeMissing = new Set(snapshot.comparison?.edges?.speculative?.missing_in_clone ?? []);

	let matched = 0;
	let total = 0;
	for (const raw of proposal.add_edges ?? []) {
		const edge = resolveEdgeEndpoints(raw);
		if (!edge) {
			continue;
		}
		total += 1;
		const label = edgeLabel(edge.src, edge.predicate, edge.dst);
		if (edge.structural) {
			const isMatched = structuralMissing.has(label)
				? false
				: structuralMatched.size === 0 || structuralMatched.has(label);
			if (isMatched) {
				matched += 1;
			}
		} else if (!speculativeMissing.has(label)) {
			matched += 1;
		}
	}
	return { matched, total };
}

/**
 * Derives Files / Relationships / Workstreams completion from a proposal and
 * optional compare snapshot. Without a snapshot, matched counts are 0 and
 * {@link SurfaceProposalProgress.hasCompare} is false (cards show totals only).
 */
export function computeSurfaceProposalProgress(
	proposal: GraphProposalDocument,
	partition: ProposalWorkstreamPartition | undefined,
	snapshot: ProposalCompareSnapshot | undefined,
): SurfaceProposalProgress {
	const filesTotal = proposal.add_nodes?.length ?? 0;
	const relationshipsTotal = (proposal.add_edges ?? []).reduce((count, raw) => count + (resolveEdgeEndpoints(raw) ? 1 : 0), 0);
	const workstreams = partition?.workstreams ?? [];

	if (!snapshot) {
		return {
			hasCompare: false,
			filesMatched: 0,
			filesTotal,
			relationshipsMatched: 0,
			relationshipsTotal,
			workstreamsComplete: 0,
			workstreamsTotal: workstreams.length,
			byWorkstream: workstreams.map(stream => ({
				id: stream.id,
				matchedNodes: 0,
				totalNodes: stream.nodes.length,
			})),
		};
	}

	const matchedNodes = matchedNodeSet(proposal, snapshot);
	const relationships = countMatchedRelationships(proposal, snapshot);
	const byWorkstream = workstreams.map(stream => {
		const matchedInStream = stream.nodes.filter(id => matchedNodes.has(id)).length;
		return {
			id: stream.id,
			matchedNodes: matchedInStream,
			totalNodes: stream.nodes.length,
		};
	});
	const workstreamsComplete = byWorkstream.filter(stream => stream.totalNodes > 0 && stream.matchedNodes === stream.totalNodes).length;

	return {
		hasCompare: true,
		filesMatched: matchedNodes.size,
		filesTotal,
		relationshipsMatched: relationships.matched,
		relationshipsTotal: relationships.total,
		workstreamsComplete,
		workstreamsTotal: workstreams.length,
		byWorkstream,
	};
}

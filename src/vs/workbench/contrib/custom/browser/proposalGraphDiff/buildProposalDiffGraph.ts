/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	GraphProposalDocument,
	GraphProposalEdgeDocument,
	ProposalCompareSnapshot,
	ProposalDiffEdge,
	ProposalDiffGraph,
	ProposalDiffNode,
	ProposalDiffStatus,
} from './proposalGraphDiffTypes.js';

const EDGE_LABEL_RE = /^(.+?)\s+--([A-Z_]+)-->\s+(.+)$/;

export function displayLabelForCanonicalId(canonicalId: string): string {
	const kindSep = canonicalId.indexOf(':');
	if (kindSep <= 0) {
		return canonicalId;
	}
	const kind = canonicalId.slice(0, kindSep);
	const rest = canonicalId.slice(kindSep + 1);
	if (kind === 'file' || kind === 'module') {
		return rest;
	}
	const symbolSep = rest.indexOf('::');
	if (symbolSep > 0) {
		return `${rest.slice(symbolSep + 2)} (${rest.slice(0, symbolSep)})`;
	}
	return rest;
}

export function kindForCanonicalId(canonicalId: string): ProposalDiffNode['kind'] {
	const kind = canonicalId.split(':', 1)[0];
	if (kind === 'file' || kind === 'module') {
		return 'file';
	}
	if (kind === 'function' || kind === 'method' || kind === 'class') {
		return 'symbol';
	}
	return 'other';
}

function edgeLabel(src: string, predicate: string, dst: string): string {
	return `${src} --${predicate.toUpperCase()}--> ${dst}`;
}

function parseEdgeLabel(label: string): { src: string; predicate: string; dst: string } | undefined {
	const match = EDGE_LABEL_RE.exec(label);
	if (!match) {
		return undefined;
	}
	return { src: match[1], predicate: match[2], dst: match[3] };
}

function nodeId(canonicalId: string): string {
	// Cytoscape ids must be unique and avoid confusing selectors; keep readable.
	return canonicalId.replace(/[^A-Za-z0-9:_./+-]+/g, '_');
}

function edgeId(src: string, predicate: string, dst: string, confidence: string): string {
	return `e:${confidence}:${src}:${predicate}:${dst}`;
}

/**
 * Builds a status-colored graph from a proposal document + proposal-compare snapshot.
 * Pure: no I/O. Prefer snapshot `matched_in_clone` when present; otherwise derive
 * matched = proposed − missing.
 */
export function buildProposalDiffGraph(
	proposal: GraphProposalDocument,
	snapshot: ProposalCompareSnapshot,
): ProposalDiffGraph {
	const addNodes = [...(proposal.add_nodes ?? [])];
	const missingNodes = new Set(snapshot.comparison?.nodes?.missing_in_clone ?? []);
	const matchedFromSnap = snapshot.comparison?.nodes?.matched_in_clone;
	const matchedNodes = new Set(
		matchedFromSnap ?? addNodes.filter(id => !missingNodes.has(id)),
	);
	const removalNodes = [...(snapshot.comparison?.removals?.nodes_still_present ?? [])];

	const nodes: ProposalDiffNode[] = [];
	const seen = new Set<string>();

	for (const canonicalId of addNodes) {
		const id = nodeId(canonicalId);
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		const status: ProposalDiffStatus = missingNodes.has(canonicalId) ? 'missing' : matchedNodes.has(canonicalId) ? 'matched' : 'missing';
		nodes.push({
			id,
			label: displayLabelForCanonicalId(canonicalId),
			canonicalId,
			status,
			kind: kindForCanonicalId(canonicalId),
		});
	}

	for (const canonicalId of removalNodes) {
		const id = nodeId(canonicalId);
		if (seen.has(id)) {
			// Prefer removal status when a proposed node is also listed as still-present removal.
			const existing = nodes.find(n => n.id === id);
			if (existing) {
				nodes[nodes.indexOf(existing)] = { ...existing, status: 'removal_still_present' };
			}
			continue;
		}
		seen.add(id);
		nodes.push({
			id,
			label: displayLabelForCanonicalId(canonicalId),
			canonicalId,
			status: 'removal_still_present',
			kind: kindForCanonicalId(canonicalId),
		});
	}

	const structuralMissing = new Set(snapshot.comparison?.edges?.structural?.missing_in_clone ?? []);
	const structuralMatched = new Set(snapshot.comparison?.edges?.structural?.matched_in_clone ?? []);
	const speculativeMissing = new Set(snapshot.comparison?.edges?.speculative?.missing_in_clone ?? []);

	const edges: ProposalDiffEdge[] = [];
	const edgeSeen = new Set<string>();

	const addEdge = (
		src: string,
		predicate: string,
		dst: string,
		confidence: 'structural' | 'speculative',
		status: ProposalDiffStatus,
	) => {
		const id = edgeId(src, predicate, dst, confidence);
		if (edgeSeen.has(id)) {
			return;
		}
		edgeSeen.add(id);
		// Ensure endpoints exist so Cytoscape can draw the edge.
		for (const endpoint of [src, dst]) {
			const nid = nodeId(endpoint);
			if (!seen.has(nid)) {
				seen.add(nid);
				nodes.push({
					id: nid,
					label: displayLabelForCanonicalId(endpoint),
					canonicalId: endpoint,
					status: status === 'matched' ? 'matched' : status,
					kind: kindForCanonicalId(endpoint),
				});
			}
		}
		edges.push({
			id,
			from: nodeId(src),
			to: nodeId(dst),
			predicate: predicate.toUpperCase(),
			label: predicate.toUpperCase(),
			status,
			confidence,
		});
	};

	for (const raw of proposal.add_edges ?? []) {
		emitProposalEdge(raw, structuralMissing, structuralMatched, speculativeMissing, addEdge);
	}

	// Speculative missing listed only in the snapshot (no proposal edge body) still show as advisory.
	for (const label of speculativeMissing) {
		const parsed = parseEdgeLabel(label);
		if (!parsed) {
			continue;
		}
		addEdge(parsed.src, parsed.predicate, parsed.dst, 'speculative', 'speculative_missing');
	}

	const matchedCount = nodes.filter(n => n.status === 'matched').length;
	const missingCount = nodes.filter(n => n.status === 'missing').length;
	const removalCount = nodes.filter(n => n.status === 'removal_still_present').length;

	return {
		nodes: nodes.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)),
		edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
		summary: {
			passed: Boolean(snapshot.passed),
			nodeRecall: Number(snapshot.comparison?.nodes?.recall ?? 0),
			structuralEdgeRecall: Number(snapshot.comparison?.edges?.structural?.recall ?? 1),
			matchedNodes: matchedCount,
			missingNodes: missingCount,
			removalNodes: removalCount,
			treeId: snapshot.proposal?.tree_id ?? proposal.tree_id,
			proposalPath: snapshot.proposal?.path,
			cloneWorkspaceId: snapshot.clone?.workspace_id,
		},
	};
}

function emitProposalEdge(
	raw: GraphProposalEdgeDocument,
	structuralMissing: Set<string>,
	structuralMatched: Set<string>,
	speculativeMissing: Set<string>,
	addEdge: (
		src: string,
		predicate: string,
		dst: string,
		confidence: 'structural' | 'speculative',
		status: ProposalDiffStatus,
	) => void,
): void {
	if (!raw.src || !raw.dst || !raw.predicate) {
		return;
	}
	const confidence = raw.confidence === 'structural' ? 'structural' : 'speculative';
	const label = edgeLabel(raw.src, raw.predicate, raw.dst);
	if (confidence === 'structural') {
		// If snapshot omitted matched_in_clone for edges, treat non-missing as matched.
		const status: ProposalDiffStatus = structuralMissing.has(label)
			? 'missing'
			: structuralMatched.size === 0 || structuralMatched.has(label)
				? 'matched'
				: 'missing';
		addEdge(raw.src, raw.predicate, raw.dst, 'structural', status);
		return;
	}
	const status: ProposalDiffStatus = speculativeMissing.has(label) ? 'speculative_missing' : 'matched';
	addEdge(raw.src, raw.predicate, raw.dst, 'speculative', status);
}

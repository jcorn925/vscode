/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GraphProposalDocument, GraphProposalEdgeDocument } from './proposalGraphDiffTypes.js';

/**
 * Predicates that document/register soft links. Including them in undirected
 * connected-component partitioning collapses independent app clusters into one
 * (e.g. workspace.goal.json REGISTERS page.tsx). They are ignored for parallelism.
 */
export const SOFT_PARTITION_PREDICATES: ReadonlySet<string> = new Set([
	'REGISTERS',
	'DESCRIBES',
	'REFERENCES',
	'DOCUMENTS',
]);

export interface ProposalWorkstreamEdge {
	readonly src: string;
	readonly dst: string;
	readonly predicate: string;
	readonly confidence: 'structural' | 'speculative';
}

export interface ProposalWorkstream {
	readonly id: string;
	/** Human label derived from the longest common path prefix. */
	readonly label: string;
	readonly nodes: readonly string[];
	readonly edges: readonly ProposalWorkstreamEdge[];
	/**
	 * True when this stream does not share a `node_prefixes` hit with another
	 * stream (no shared-package coupling barrier).
	 */
	readonly parallelSafe: boolean;
	/** Prefixes this stream touches that at least one other stream also touches. */
	readonly sharedPrefixes: readonly string[];
}

export interface ProposalWorkstreamPartition {
	/**
	 * Parallelizable proposal-graph subsystems (structural CCs with no shared
	 * `node_prefixes` coupling). These are the product “workstreams.”
	 */
	readonly workstreams: readonly ProposalWorkstream[];
	/**
	 * Coupled clusters that share `node_prefixes` with another component —
	 * serialize (or assign one owner) before parallelizing.
	 */
	readonly serializeGroups: readonly ProposalWorkstream[];
	readonly ignoredPredicates: readonly string[];
	readonly structuralEdgeCount: number;
	readonly softEdgeCount: number;
	/** True when ≥2 parallel workstreams exist (worth spawning agents). */
	readonly canParallelize: boolean;
}

export interface PartitionProposalWorkstreamsOptions {
	/** Extra predicates to ignore beyond SOFT_PARTITION_PREDICATES. */
	readonly ignorePredicates?: readonly string[];
	/** When true, also drop speculative-confidence edges (default true). */
	readonly ignoreSpeculative?: boolean;
}

function normalizeEdge(raw: GraphProposalEdgeDocument): ProposalWorkstreamEdge | undefined {
	const src = (raw.src || raw.from || '').trim();
	const dst = (raw.dst || raw.to || '').trim();
	const predicate = (raw.predicate || raw.type || '').trim().toUpperCase();
	if (!src || !dst || !predicate) {
		return undefined;
	}
	return {
		src,
		dst,
		predicate,
		confidence: raw.confidence === 'speculative' ? 'speculative' : 'structural',
	};
}

function stripKind(canonicalId: string): string {
	const i = canonicalId.indexOf(':');
	return i >= 0 ? canonicalId.slice(i + 1) : canonicalId;
}

function find(parent: Map<string, string>, x: string): string {
	let cur = x;
	while (parent.get(cur) !== cur) {
		const p = parent.get(cur)!;
		parent.set(cur, parent.get(p)!);
		cur = p;
	}
	return cur;
}

function union(parent: Map<string, string>, a: string, b: string): void {
	const ra = find(parent, a);
	const rb = find(parent, b);
	if (ra !== rb) {
		parent.set(rb, ra);
	}
}

/** Longest common directory prefix of path strings (kind-stripped). */
export function commonPathPrefix(paths: readonly string[]): string {
	if (!paths.length) {
		return '';
	}
	const parts = paths.map(p => stripKind(p).split('/').filter(Boolean));
	const first = parts[0]!;
	let depth = first.length;
	for (let i = 1; i < parts.length; i++) {
		const other = parts[i]!;
		let j = 0;
		while (j < depth && j < other.length && other[j] === first[j]) {
			j++;
		}
		depth = j;
		if (depth === 0) {
			break;
		}
	}
	// Prefer a directory prefix, not a shared filename.
	if (paths.length > 1 && depth === first.length) {
		depth = Math.max(0, depth - 1);
	}
	return first.slice(0, depth).join('/');
}

function labelForComponent(nodes: readonly string[]): string {
	const prefix = commonPathPrefix(nodes);
	if (prefix) {
		return prefix;
	}
	if (nodes.length === 1) {
		return stripKind(nodes[0]!);
	}
	return `${nodes.length} files`;
}

function prefixesTouched(nodes: readonly string[], prefixes: readonly string[]): string[] {
	const paths = nodes.map(stripKind);
	return prefixes.filter(prefix => {
		const p = prefix.replace(/^\/+|\/+$/g, '');
		if (!p) {
			return false;
		}
		return paths.some(path => path === p || path.startsWith(`${p}/`));
	});
}

/**
 * Partition a graph proposal into parallelizable subsystems (workstreams) and
 * coupled serialize groups. Soft predicates (REGISTERS/DESCRIBES/…) and
 * speculative edges are ignored so documentation links do not collapse clusters.
 */
export function partitionProposalWorkstreams(
	proposal: GraphProposalDocument,
	options?: PartitionProposalWorkstreamsOptions,
): ProposalWorkstreamPartition {
	const ignorePredicates = new Set([
		...SOFT_PARTITION_PREDICATES,
		...(options?.ignorePredicates ?? []).map(p => p.toUpperCase()),
	]);
	const ignoreSpeculative = options?.ignoreSpeculative !== false;

	const nodes = [...(proposal.add_nodes ?? [])];
	const parent = new Map<string, string>();
	for (const n of nodes) {
		parent.set(n, n);
	}

	const structuralEdges: ProposalWorkstreamEdge[] = [];
	let softEdgeCount = 0;

	for (const raw of proposal.add_edges ?? []) {
		const edge = normalizeEdge(raw);
		if (!edge) {
			continue;
		}
		const soft = ignorePredicates.has(edge.predicate);
		const speculative = ignoreSpeculative && edge.confidence === 'speculative';
		if (soft || speculative) {
			softEdgeCount++;
			continue;
		}
		structuralEdges.push(edge);
		if (!parent.has(edge.src)) {
			parent.set(edge.src, edge.src);
		}
		if (!parent.has(edge.dst)) {
			parent.set(edge.dst, edge.dst);
		}
		union(parent, edge.src, edge.dst);
	}

	const buckets = new Map<string, string[]>();
	for (const n of nodes) {
		const root = find(parent, n);
		const list = buckets.get(root) ?? [];
		list.push(n);
		buckets.set(root, list);
	}

	const prefixes = [...(proposal.node_prefixes ?? [])];
	const componentEntries = [...buckets.values()]
		.map(list => [...list].sort((a, b) => a.localeCompare(b)))
		.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));

	const touchedByComponent = componentEntries.map(list => prefixesTouched(list, prefixes));
	const prefixOwners = new Map<string, number[]>();
	touchedByComponent.forEach((touched, index) => {
		for (const prefix of touched) {
			const owners = prefixOwners.get(prefix) ?? [];
			owners.push(index);
			prefixOwners.set(prefix, owners);
		}
	});

	const components: ProposalWorkstream[] = componentEntries.map((list, index) => {
		const nodeSet = new Set(list);
		const edges = structuralEdges.filter(e => nodeSet.has(e.src) && nodeSet.has(e.dst));
		const sharedPrefixes = touchedByComponent[index]!.filter(prefix => (prefixOwners.get(prefix)?.length ?? 0) > 1);
		return {
			id: `ws-${index + 1}`,
			label: labelForComponent(list),
			nodes: list,
			edges,
			parallelSafe: sharedPrefixes.length === 0,
			sharedPrefixes,
		};
	});

	const workstreams = components.filter(w => w.parallelSafe);
	const serializeGroups = components.filter(w => !w.parallelSafe);
	return {
		workstreams,
		serializeGroups,
		ignoredPredicates: [...ignorePredicates].sort(),
		structuralEdgeCount: structuralEdges.length,
		softEdgeCount,
		canParallelize: workstreams.length >= 2,
	};
}

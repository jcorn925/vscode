/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';
import type { SurfaceSubsystemSpec } from '../goalWorkspace/surfaceBlueprintTypes.js';
import type { AgentTaskNode, AgentTaskTree } from './agentTaskTreeTypes.js';

/**
 * A graph proposal is a *prediction* of the nodes and edges that should exist in the
 * ix graph (Agora/ArangoDB `ix_memory`) once a plan/task tree has been implemented.
 * Proposals are never written into the live graph — `ix map` / `ix watch` remain the
 * only writers. They are verified after implementation by
 * `scripts/ix_graph_compare.py --proposal`, which shares the same canonical node ID
 * form (`kind:relpath` for file/module, `kind:relpath::name` for symbols).
 */

export const AGENT_TASK_TREE_GRAPH_PROPOSAL_VERSION = 1 as const;

export const GRAPH_PROPOSAL_PATH_KINDS = ['file', 'module'] as const;
export const GRAPH_PROPOSAL_SYMBOL_KINDS = ['function', 'method', 'class'] as const;
export const GRAPH_PROPOSAL_PREDICATES = ['CALLS', 'IMPORTS', 'DEFINES', 'EXTENDS'] as const;

export type GraphProposalPredicate = typeof GRAPH_PROPOSAL_PREDICATES[number];

/**
 * `structural` entries follow deterministically from the plan and count toward hard
 * pass/fail thresholds; `speculative` entries (e.g. predicted CALLS edges) are
 * reported as advisory only.
 */
export type GraphProposalEdgeConfidence = 'structural' | 'speculative';

export interface AgentTaskTreeGraphProposalEdge {
	readonly src: string;
	readonly predicate: GraphProposalPredicate;
	readonly dst: string;
	readonly confidence: GraphProposalEdgeConfidence;
}

export interface AgentTaskTreeGraphProposal {
	readonly version: typeof AGENT_TASK_TREE_GRAPH_PROPOSAL_VERSION;
	readonly treeId: string;
	readonly surfaceId?: string;
	/** Workspace-relative path of the plan artifact this proposal was derived from. */
	readonly planRef: string;
	readonly createdAt: string;
	/** Path prefix canonical IDs are relative to; empty string means workspace root. */
	readonly root: string;
	readonly addNodes: readonly string[];
	readonly addEdges: readonly AgentTaskTreeGraphProposalEdge[];
	readonly removeNodes: readonly string[];
	readonly removeEdges: readonly AgentTaskTreeGraphProposalEdge[];
	/** "At least one node under this directory" expectations (advisory in compare). */
	readonly nodePrefixes: readonly string[];
}

/** Partial proposal payload an agent may return as chat response metadata. */
export interface AgentTaskTreeGraphProposalEnrichment {
	readonly addNodes: readonly string[];
	readonly addEdges: readonly AgentTaskTreeGraphProposalEdge[];
	readonly removeNodes: readonly string[];
	readonly removeEdges: readonly AgentTaskTreeGraphProposalEdge[];
	readonly nodePrefixes: readonly string[];
}

// --------------------------------------------------------------------------
// Canonical node ID validation
// --------------------------------------------------------------------------

const PATH_KIND_SET: ReadonlySet<string> = new Set(GRAPH_PROPOSAL_PATH_KINDS);
const SYMBOL_KIND_SET: ReadonlySet<string> = new Set(GRAPH_PROPOSAL_SYMBOL_KINDS);
const PREDICATE_SET: ReadonlySet<string> = new Set(GRAPH_PROPOSAL_PREDICATES);

function isValidProposalPath(path: string): boolean {
	return path.length > 0
		&& !path.startsWith('/')
		&& !path.endsWith('/')
		&& !/[\\\n\r\t]/.test(path)
		&& path.trim() === path;
}

/** True when `value` is a canonical graph node ID (`file:a/b.py`, `class:a/b.py::Task`). */
export function isCanonicalGraphNodeId(value: string): boolean {
	const kindSep = value.indexOf(':');
	if (kindSep <= 0) {
		return false;
	}
	const kind = value.slice(0, kindSep);
	const rest = value.slice(kindSep + 1);
	if (PATH_KIND_SET.has(kind)) {
		return isValidProposalPath(rest) && !rest.includes('::');
	}
	if (SYMBOL_KIND_SET.has(kind)) {
		const symbolSep = rest.indexOf('::');
		if (symbolSep <= 0) {
			return false;
		}
		const path = rest.slice(0, symbolSep);
		const name = rest.slice(symbolSep + 2);
		return isValidProposalPath(path) && !path.includes('::') && name.trim().length > 0 && name.trim() === name;
	}
	return false;
}

// --------------------------------------------------------------------------
// Parsing (snake_case JSON, matching the Python compare side)
// --------------------------------------------------------------------------

export function parseGraphProposalEdge(raw: unknown): AgentTaskTreeGraphProposalEdge | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const src = optionalString(raw.src);
	const dst = optionalString(raw.dst);
	const predicate = optionalString(raw.predicate);
	if (!src || !dst || !predicate || !PREDICATE_SET.has(predicate)) {
		return undefined;
	}
	if (!isCanonicalGraphNodeId(src) || !isCanonicalGraphNodeId(dst)) {
		return undefined;
	}
	const confidence = raw.confidence === 'structural' ? 'structural' : raw.confidence === 'speculative' || raw.confidence === undefined ? 'speculative' : undefined;
	if (!confidence) {
		return undefined;
	}
	return { src, predicate: predicate as GraphProposalPredicate, dst, confidence };
}

function parseNodeIdArray(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return uniqueSorted(raw.filter((item): item is string => typeof item === 'string' && isCanonicalGraphNodeId(item)));
}

function parseEdgeArray(raw: unknown): AgentTaskTreeGraphProposalEdge[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const edges: AgentTaskTreeGraphProposalEdge[] = [];
	for (const item of raw) {
		const edge = parseGraphProposalEdge(item);
		if (edge) {
			edges.push(edge);
		}
	}
	return dedupeEdges(edges);
}

function parsePrefixArray(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return uniqueSorted(raw
		.filter((item): item is string => typeof item === 'string')
		.map(normalizeProposalPath)
		.filter(isValidProposalPath));
}

export function parseGraphProposal(raw: unknown): AgentTaskTreeGraphProposal | undefined {
	if (!isRecord(raw) || raw.version !== AGENT_TASK_TREE_GRAPH_PROPOSAL_VERSION) {
		return undefined;
	}
	const treeId = optionalString(raw.tree_id);
	const planRef = optionalString(raw.plan_ref);
	const createdAt = optionalString(raw.created_at);
	if (!treeId || !planRef || !createdAt) {
		return undefined;
	}
	const root = typeof raw.root === 'string' ? normalizeProposalPath(raw.root) : undefined;
	if (root === undefined) {
		return undefined;
	}
	return {
		version: AGENT_TASK_TREE_GRAPH_PROPOSAL_VERSION,
		treeId,
		surfaceId: optionalString(raw.surface_id),
		planRef,
		createdAt,
		root,
		addNodes: parseNodeIdArray(raw.add_nodes),
		addEdges: parseEdgeArray(raw.add_edges),
		removeNodes: parseNodeIdArray(raw.remove_nodes),
		removeEdges: parseEdgeArray(raw.remove_edges),
		nodePrefixes: parsePrefixArray(raw.node_prefixes),
	};
}

/**
 * Parses an agent-provided enrichment payload (chat response metadata). Invalid
 * entries are dropped; edges default to `speculative` unless explicitly marked
 * structural. Returns undefined when nothing valid remains.
 */
export function parseGraphProposalEnrichment(raw: unknown): AgentTaskTreeGraphProposalEnrichment | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const enrichment: AgentTaskTreeGraphProposalEnrichment = {
		addNodes: parseNodeIdArray(raw.add_nodes),
		addEdges: parseEdgeArray(raw.add_edges),
		removeNodes: parseNodeIdArray(raw.remove_nodes),
		removeEdges: parseEdgeArray(raw.remove_edges),
		nodePrefixes: parsePrefixArray(raw.node_prefixes),
	};
	const empty = !enrichment.addNodes.length
		&& !enrichment.addEdges.length
		&& !enrichment.removeNodes.length
		&& !enrichment.removeEdges.length
		&& !enrichment.nodePrefixes.length;
	return empty ? undefined : enrichment;
}

// --------------------------------------------------------------------------
// Deterministic builder
// --------------------------------------------------------------------------

export interface BuildGraphProposalFromPlanOptions {
	readonly tree: AgentTaskTree;
	/** Blueprint subsystems, when the tree was generated from a surface blueprint/template. */
	readonly subsystems?: readonly SurfaceSubsystemSpec[];
	readonly planRef: string;
	readonly createdAt?: string;
}

/**
 * Derives an accurate structural proposal from the plan: paths with a file extension
 * become `file:` nodes, directory paths become `node_prefixes`. No edges are guessed —
 * blueprint subsystem specs do not declare import relationships, so structural edges
 * only enter via explicit agent enrichment.
 */
export function buildGraphProposalFromPlan(options: BuildGraphProposalFromPlanOptions): AgentTaskTreeGraphProposal {
	const paths = new Set<string>();
	for (const subsystem of options.subsystems ?? []) {
		for (const path of subsystem.paths) {
			addNormalized(paths, path);
		}
	}
	for (const leaf of flattenNodes(options.tree.roots)) {
		if (leaf.type !== 'leaf') {
			continue;
		}
		for (const path of leaf.expectedPaths ?? []) {
			addNormalized(paths, path);
		}
	}

	const addNodes: string[] = [];
	const nodePrefixes: string[] = [];
	for (const path of paths) {
		if (looksLikeFilePath(path)) {
			addNodes.push(`file:${path}`);
		} else {
			nodePrefixes.push(path);
		}
	}

	return {
		version: AGENT_TASK_TREE_GRAPH_PROPOSAL_VERSION,
		treeId: options.tree.id,
		surfaceId: options.tree.surfaceId,
		planRef: options.planRef,
		createdAt: options.createdAt ?? new Date().toISOString(),
		root: '',
		addNodes: uniqueSorted(addNodes),
		addEdges: [],
		removeNodes: [],
		removeEdges: [],
		nodePrefixes: uniqueSorted(nodePrefixes),
	};
}

/** Merges agent-provided entries into an existing proposal, deduplicating both sides. */
export function mergeGraphProposalEnrichment(
	base: AgentTaskTreeGraphProposal,
	enrichment: AgentTaskTreeGraphProposalEnrichment,
): AgentTaskTreeGraphProposal {
	return {
		...base,
		addNodes: uniqueSorted([...base.addNodes, ...enrichment.addNodes]),
		addEdges: dedupeEdges([...base.addEdges, ...enrichment.addEdges]),
		removeNodes: uniqueSorted([...base.removeNodes, ...enrichment.removeNodes]),
		removeEdges: dedupeEdges([...base.removeEdges, ...enrichment.removeEdges]),
		nodePrefixes: uniqueSorted([...base.nodePrefixes, ...enrichment.nodePrefixes]),
	};
}

// --------------------------------------------------------------------------
// Serialization + persistence
// --------------------------------------------------------------------------

function serializeEdge(edge: AgentTaskTreeGraphProposalEdge): Record<string, string> {
	return { src: edge.src, predicate: edge.predicate, dst: edge.dst, confidence: edge.confidence };
}

/** Serializes to the snake_case JSON document consumed by ix_graph_compare.py. */
export function serializeGraphProposal(proposal: AgentTaskTreeGraphProposal): string {
	const document: Record<string, unknown> = {
		version: proposal.version,
		tree_id: proposal.treeId,
		...(proposal.surfaceId ? { surface_id: proposal.surfaceId } : {}),
		plan_ref: proposal.planRef,
		created_at: proposal.createdAt,
		root: proposal.root,
		add_nodes: [...proposal.addNodes],
		add_edges: proposal.addEdges.map(serializeEdge),
		remove_nodes: [...proposal.removeNodes],
		remove_edges: proposal.removeEdges.map(serializeEdge),
		node_prefixes: [...proposal.nodePrefixes],
	};
	return `${JSON.stringify(document, null, '\t')}\n`;
}

export function graphProposalFileName(treeId: string): string {
	return `${treeId}.graph-proposal.json`;
}

export function graphProposalResource(taskTreesFolder: URI, treeId: string): URI {
	return joinPath(taskTreesFolder, graphProposalFileName(treeId));
}

export async function readGraphProposal(fileService: IFileService, resource: URI): Promise<AgentTaskTreeGraphProposal | undefined> {
	try {
		if (!(await fileService.exists(resource))) {
			return undefined;
		}
		return parseGraphProposal(JSON.parse((await fileService.readFile(resource)).value.toString()));
	} catch {
		return undefined;
	}
}

export async function writeGraphProposal(fileService: IFileService, taskTreesFolder: URI, proposal: AgentTaskTreeGraphProposal): Promise<URI> {
	const resource = graphProposalResource(taskTreesFolder, proposal.treeId);
	await fileService.createFolder(taskTreesFolder);
	await fileService.writeFile(resource, VSBuffer.fromString(serializeGraphProposal(proposal)));
	return resource;
}

/**
 * Merges agent enrichment into the persisted proposal for a tree, creating a minimal
 * proposal document when none exists yet.
 */
export async function mergeAndPersistGraphProposalEnrichment(
	fileService: IFileService,
	taskTreesFolder: URI,
	tree: { readonly id: string; readonly surfaceId?: string },
	planRef: string,
	enrichment: AgentTaskTreeGraphProposalEnrichment,
): Promise<AgentTaskTreeGraphProposal> {
	const existing = await readGraphProposal(fileService, graphProposalResource(taskTreesFolder, tree.id));
	const base: AgentTaskTreeGraphProposal = existing ?? {
		version: AGENT_TASK_TREE_GRAPH_PROPOSAL_VERSION,
		treeId: tree.id,
		surfaceId: tree.surfaceId,
		planRef,
		createdAt: new Date().toISOString(),
		root: '',
		addNodes: [],
		addEdges: [],
		removeNodes: [],
		removeEdges: [],
		nodePrefixes: [],
	};
	const merged = mergeGraphProposalEnrichment(base, enrichment);
	await writeGraphProposal(fileService, taskTreesFolder, merged);
	return merged;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Case-preserving path normalization. Deliberately NOT the lowercasing
 * `normalizePath` from agentTaskTreeIxValidation.ts: canonical graph node IDs must
 * match the case of `provenance.source_uri` in the live graph exactly.
 */
export function normalizeProposalPath(value: string): string {
	return value
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

function addNormalized(paths: Set<string>, value: string): void {
	const normalized = normalizeProposalPath(value);
	if (isValidProposalPath(normalized)) {
		paths.add(normalized);
	}
}

function looksLikeFilePath(path: string): boolean {
	return /\.[a-z0-9]+$/i.test(path);
}

function dedupeEdges(edges: readonly AgentTaskTreeGraphProposalEdge[]): AgentTaskTreeGraphProposalEdge[] {
	const byTriple = new Map<string, AgentTaskTreeGraphProposalEdge>();
	for (const edge of edges) {
		const key = `${edge.src}\u0000${edge.predicate}\u0000${edge.dst}`;
		const existing = byTriple.get(key);
		// Structural wins when the same triple appears with mixed confidence.
		if (!existing || (existing.confidence === 'speculative' && edge.confidence === 'structural')) {
			byTriple.set(key, edge);
		}
	}
	return [...byTriple.values()].sort((a, b) =>
		a.src.localeCompare(b.src) || a.predicate.localeCompare(b.predicate) || a.dst.localeCompare(b.dst));
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function flattenNodes(nodes: readonly AgentTaskNode[]): AgentTaskNode[] {
	const result: AgentTaskNode[] = [];
	for (const node of nodes) {
		result.push(node);
		if (node.children?.length) {
			result.push(...flattenNodes(node.children));
		}
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

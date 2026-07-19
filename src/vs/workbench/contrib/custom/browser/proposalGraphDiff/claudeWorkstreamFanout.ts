/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CLAUDE_SERIALIZE_WORKSTREAM_ID,
	claudeWorkstreamKey,
} from '../claudeTerminalKeys.js';
import type { ProposalWorkstream, ProposalWorkstreamPartition } from './partitionProposalWorkstreams.js';

export type ClaudeWorkstreamSpawnMode = 'parallel' | 'serialize';

export interface ClaudeWorkstreamSpawnSpec {
	readonly key: string;
	readonly workstreamId: string;
	readonly label: string;
	readonly mode: ClaudeWorkstreamSpawnMode;
	readonly nodes: readonly string[];
	readonly sharedPrefixes: readonly string[];
	/** Paths this stream must not edit (other streams + serialize prefixes). */
	readonly forbiddenNodes: readonly string[];
}

export interface ClaudeWorkstreamFanoutPlan {
	readonly canFanout: boolean;
	/** Serialize Claude first (coupled clusters), if any. */
	readonly serialize: ClaudeWorkstreamSpawnSpec | undefined;
	/** Parallel-safe workstream Claudes (spawn after serialize is started). */
	readonly parallel: readonly ClaudeWorkstreamSpawnSpec[];
	readonly allKeys: readonly string[];
}

function stripKind(canonicalId: string): string {
	const i = canonicalId.indexOf(':');
	return i >= 0 ? canonicalId.slice(i + 1) : canonicalId;
}

function uniquePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of paths) {
		const path = stripKind(raw).trim();
		if (!path || seen.has(path)) {
			continue;
		}
		seen.add(path);
		out.push(path);
	}
	return out;
}

function nodesFromStreams(streams: readonly ProposalWorkstream[]): string[] {
	return uniquePaths(streams.flatMap(stream => [...stream.nodes]));
}

/**
 * Build an ordered Claude spawn plan from a proposal partition.
 * When `canParallelize`, returns serialize (optional) then parallel specs.
 */
export function planClaudeWorkstreamFanout(
	surfaceId: string,
	partition: ProposalWorkstreamPartition,
): ClaudeWorkstreamFanoutPlan {
	if (!partition.canParallelize || partition.workstreams.length < 2) {
		return {
			canFanout: false,
			serialize: undefined,
			parallel: [],
			allKeys: [],
		};
	}

	const parallelNodes = nodesFromStreams(partition.workstreams);
	const serializeNodes = nodesFromStreams(partition.serializeGroups);
	const sharedPrefixes = uniquePaths(
		partition.serializeGroups.flatMap(stream => [...stream.sharedPrefixes]),
	);

	let serialize: ClaudeWorkstreamSpawnSpec | undefined;
	if (partition.serializeGroups.length) {
		serialize = {
			key: claudeWorkstreamKey(surfaceId, CLAUDE_SERIALIZE_WORKSTREAM_ID),
			workstreamId: CLAUDE_SERIALIZE_WORKSTREAM_ID,
			label: `Serialize · ${partition.serializeGroups.length} coupled`,
			mode: 'serialize',
			nodes: serializeNodes,
			sharedPrefixes,
			forbiddenNodes: parallelNodes,
		};
	}

	const parallel = partition.workstreams.map(stream => {
		const own = uniquePaths(stream.nodes);
		const siblingNodes = parallelNodes.filter(path => !own.includes(path));
		return {
			key: claudeWorkstreamKey(surfaceId, stream.id),
			workstreamId: stream.id,
			label: stream.label,
			mode: 'parallel' as const,
			nodes: own,
			sharedPrefixes: [...stream.sharedPrefixes],
			forbiddenNodes: uniquePaths([...siblingNodes, ...serializeNodes, ...sharedPrefixes]),
		};
	});

	const allKeys = [
		...(serialize ? [serialize.key] : []),
		...parallel.map(spec => spec.key),
	];

	return {
		canFanout: true,
		serialize,
		parallel,
		allKeys,
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Proposal-vs-generated graph model for the Ix Proposal Graph Diff Cytoscape panel.
 * Colors the *proposal universe* (matched / missing / removal still present), not the
 * full live clone graph — proposal compare is recall-oriented.
 */

export type ProposalDiffStatus =
	| 'matched'
	| 'missing'
	| 'removal_still_present'
	| 'speculative_missing';

export interface ProposalDiffNode {
	readonly id: string;
	readonly label: string;
	readonly canonicalId: string;
	readonly status: ProposalDiffStatus;
	readonly kind: 'file' | 'symbol' | 'other';
}

export interface ProposalDiffEdge {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly predicate: string;
	readonly label: string;
	readonly status: ProposalDiffStatus;
	readonly confidence: 'structural' | 'speculative';
}

export interface ProposalDiffGraph {
	readonly nodes: readonly ProposalDiffNode[];
	readonly edges: readonly ProposalDiffEdge[];
	readonly summary: ProposalDiffSummary;
}

export interface ProposalDiffSummary {
	readonly passed: boolean;
	readonly nodeRecall: number;
	readonly structuralEdgeRecall: number;
	readonly matchedNodes: number;
	readonly missingNodes: number;
	readonly removalNodes: number;
	readonly treeId?: string;
	readonly proposalPath?: string;
	readonly cloneWorkspaceId?: string;
}

/** Snake_case proposal document (from `.agent/task-trees/*.graph-proposal.json`). */
export interface GraphProposalDocument {
	readonly version?: number;
	readonly tree_id?: string;
	readonly add_nodes?: readonly string[];
	readonly add_edges?: readonly GraphProposalEdgeDocument[];
	readonly remove_nodes?: readonly string[];
	readonly remove_edges?: readonly GraphProposalEdgeDocument[];
}

export interface GraphProposalEdgeDocument {
	readonly src: string;
	readonly dst: string;
	readonly predicate: string;
	readonly confidence?: string;
}

/** Subset of the proposal-compare snapshot used by the visualizer. */
export interface ProposalCompareSnapshot {
	readonly passed?: boolean;
	readonly proposal?: {
		readonly path?: string;
		readonly tree_id?: string;
	};
	readonly clone?: {
		readonly workspace_id?: string;
	};
	readonly comparison?: {
		readonly nodes?: {
			readonly recall?: number;
			readonly matched_in_clone?: readonly string[];
			readonly missing_in_clone?: readonly string[];
		};
		readonly edges?: {
			readonly structural?: {
				readonly recall?: number;
				readonly matched_in_clone?: readonly string[];
				readonly missing_in_clone?: readonly string[];
			};
			readonly speculative?: {
				readonly recall?: number;
				readonly missing_in_clone?: readonly string[];
			};
		};
		readonly removals?: {
			readonly nodes_still_present?: readonly string[];
			readonly edges_still_present?: readonly string[];
		};
	};
}

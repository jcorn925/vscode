/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export type ProcessNoteId = string;

export type ProcessNoteLane =
	| 'Build'
	| 'Preview'
	| 'Bridge'
	| 'Host'
	| 'Chat';

export type ProcessGraphNodeKind =
	| 'topic'
	| 'file'
	| 'symbol'
	| 'event'
	| 'phase';

export interface ProcessGraphNode {
	readonly id: string;
	readonly label: string;
	readonly kind: ProcessGraphNodeKind;
	readonly lane?: ProcessNoteLane;
	readonly file?: URI;
	readonly startLine?: number;
	readonly endLine?: number;
	readonly citations?: readonly ProcessGraphCitation[];
}

export type ProcessGraphEdgeType =
	| 'calls'
	| 'imports'
	| 'postsMessage'
	| 'injectsScript'
	| 'readsAttribute'
	| 'opensEditor'
	| 'other';

export interface ProcessGraphEdge {
	readonly from: string;
	readonly to: string;
	readonly type: ProcessGraphEdgeType;
	readonly evidence?: string;
	readonly citations?: readonly ProcessGraphCitation[];
}

export interface ProcessGraphCitation {
	readonly source: 'ix';
	readonly command: string;
	readonly ref: string;
}

export interface ProcessNoteGraph {
	readonly nodes: readonly ProcessGraphNode[];
	readonly edges: readonly ProcessGraphEdge[];
}

export interface ProcessNoteMeta {
	readonly generatedAt: number;
	readonly gitHead?: string;
	readonly ixRevision?: string;
	/** Workspace folder this note was generated for (serialized URI). */
	readonly workspaceUri?: string;
	/** User question for custom-prompt recipes. */
	readonly userPrompt?: string;
	/** Routing: currently `custom-prompt`. */
	readonly recipeId?: string;
	/** Ix-backed subsystem and target bindings used to create/refresh this note. */
	readonly binding?: ProcessNoteBinding;
	/** Persisted generation log text (rendered in the Logs tab). */
	readonly generationLog?: string;
}

export interface ProcessNoteBinding {
	readonly prompt: string;
	readonly selection: readonly {
		readonly subsystemKey: string;
		readonly label: string;
		readonly labelKind?: string;
		readonly level?: number;
		readonly score: number;
		readonly selectedBy: 'model' | 'deterministic';
	}[];
	readonly resolvedTargets: readonly {
		readonly target: string;
		readonly kind?: string;
		readonly path?: string;
		readonly source: 'search' | 'locate' | 'text' | 'subsystem';
	}[];
	readonly fingerprints: {
		readonly subsystem: string;
		readonly resolvedTargets: string;
		readonly evidence: string;
	};
	readonly ix: {
		readonly mapRev?: string;
		readonly generatedAt: number;
	};
}

export type ProcessNoteSuggestionKind = 'system' | 'subsystem' | 'module';

export interface ProcessNoteSuggestionProbe {
	readonly ok: boolean;
	readonly resolvedTargets: number;
	readonly ranAt: number;
}

export interface ProcessNoteSuggestion {
	/** Stable suggestion id. */
	readonly id: string;
	/** Display label (from Ix region label). */
	readonly label: string;
	/** Stable subsystem binding key derived from Ix region fields. */
	readonly subsystemKey: string;
	readonly kind: ProcessNoteSuggestionKind;
	readonly confidence?: number;
	readonly files?: number;
	readonly crosscut?: number;
	readonly signals?: readonly string[];
	/** Ix region id from `ix subsystems --list --detailed`. */
	readonly regionId?: string;
	/** Preferred entry file for this subsystem (route/page/layout heuristic). */
	readonly entryPath?: string;
	/** First outbound import target outside member files. */
	readonly topDependencyPath?: string;
	/** Preformatted coupling counts line for cards. */
	readonly couplingSummary?: string;
	/** Inbound callers/importers summary when present. */
	readonly inboundSummary?: string;
	readonly healthScore?: number;
	readonly importsOutTotal?: number;
	readonly callsOutTotal?: number;
	readonly importsInTotal?: number;
	readonly callsInTotal?: number;
	/** Deterministic prompt templates users can pick/fill. */
	readonly promptTemplates: readonly string[];
	/** Optional validation probe summary (budgeted). */
	readonly probe?: ProcessNoteSuggestionProbe;
}

export interface ProcessNote {
	readonly id: ProcessNoteId;
	readonly title: string;
	readonly markdown: string;
	readonly graph: ProcessNoteGraph;
	readonly meta: ProcessNoteMeta;
}

export interface ProcessNotesFile {
	readonly version: 1;
	readonly notes: readonly ProcessNote[];
}

export interface ProcessTopicsFile {
	readonly version: 1;
	readonly generatedAt: number;
	readonly workspaceUri?: string;
	readonly mapRev?: string;
	readonly suggestions: readonly ProcessNoteSuggestion[];
}


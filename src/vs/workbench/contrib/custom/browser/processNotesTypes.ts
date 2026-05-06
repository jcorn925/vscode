/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export type ProcessNoteId = 'webview-selection' | string;

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
	/** Built-in routing: `webview-selection` | `custom-prompt`. */
	readonly recipeId?: string;
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


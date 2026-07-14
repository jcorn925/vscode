/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../vs/base/common/cancellation.js';

export type AgentTaskTreeStatus = 'draft' | 'active' | 'paused' | 'complete' | 'failed';
export type AgentTaskNodeStatus = 'pending' | 'in_progress' | 'blocked' | 'complete' | 'failed' | 'skipped';
export type AgentTaskNodeType = 'root' | 'branch' | 'leaf';

export interface AgentTaskImplementation {
	startedAt?: string;
	completedAt?: string;
	changedFiles?: string[];
	commandsRun?: string[];
	verification?: string;
	notes?: string;
	error?: string;
}

export interface AgentTaskTreeCursor {
	currentNodeId?: string;
	lastCompletedNodeId?: string;
}

export interface AgentTaskNode {
	readonly id: string;
	readonly parentId?: string;
	readonly title: string;
	readonly description?: string;
	readonly type: AgentTaskNodeType;
	status: AgentTaskNodeStatus;
	readonly order: number;
	children?: AgentTaskNode[];
	implementation?: AgentTaskImplementation;
	/** Blueprint subsystem id when this leaf maps to a surface subsystem. */
	readonly subsystemId?: string;
	/** Explicit paths Ix should expect for this leaf (preferred over scraping description). */
	readonly expectedPaths?: readonly string[];
	/** Human/agent checks that prove the leaf is done. */
	readonly acceptanceChecks?: readonly string[];
}

export interface AgentTaskTreeSurfaceMetadata {
	readonly surfaceId?: string;
	readonly surfaceName?: string;
	readonly templateId?: string;
}

export type AgentTaskTreeIxValidationStatus = 'passed' | 'gaps' | 'unavailable';
export type AgentTaskTreeIxValidationGapKind = 'missing_region' | 'missing_path' | 'thin_region' | 'unexpected_region';

export interface AgentTaskTreeIxValidationGap {
	readonly id: string;
	readonly kind: AgentTaskTreeIxValidationGapKind;
	readonly expectedId?: string;
	readonly expectedLabel: string;
	readonly expectedPaths: readonly string[];
	readonly matchedRegionId?: string;
	readonly matchedRegionLabel?: string;
	readonly message: string;
}

export interface AgentTaskTreeIxValidation {
	readonly status: AgentTaskTreeIxValidationStatus;
	readonly ranAt: string;
	readonly surfacePath: string;
	readonly command: string;
	readonly subsystemCount: number;
	readonly matchedCount: number;
	readonly gaps: readonly AgentTaskTreeIxValidationGap[];
}

export interface AgentTaskTree {
	readonly version: 1;
	readonly id: string;
	readonly prompt: string;
	readonly createdAt: string;
	updatedAt: string;
	status: AgentTaskTreeStatus;
	roots: AgentTaskNode[];
	cursor?: AgentTaskTreeCursor;
	readonly surfaceId?: string;
	readonly surfaceName?: string;
	readonly templateId?: string;
	readonly ixValidation?: AgentTaskTreeIxValidation;
	readonly ixValidationAttempts?: number;
}

export interface AgentTaskRunResult {
	readonly tree: AgentTaskTree;
	readonly task?: AgentTaskNode;
	readonly status: 'completed' | 'blocked' | 'failed' | 'paused' | 'complete';
}

export interface AgentTaskExecutionResult {
	readonly changedFiles?: readonly string[];
	readonly commandsRun?: readonly string[];
	readonly verification?: string;
	readonly notes?: string;
}

export interface AgentTaskExecutor {
	executeTask(tree: AgentTaskTree, task: AgentTaskNode, token: CancellationToken): Promise<AgentTaskExecutionResult>;
}

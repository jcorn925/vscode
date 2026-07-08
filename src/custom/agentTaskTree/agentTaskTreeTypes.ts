/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	executeTask(tree: AgentTaskTree, task: AgentTaskNode): Promise<AgentTaskExecutionResult>;
}


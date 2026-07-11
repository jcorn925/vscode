/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentTaskNode } from './agentTaskTreeTypes.js';

export function statusIcon(status: AgentTaskNode['status']): string {
	switch (status) {
		case 'complete': return '[x]';
		case 'in_progress': return '~';
		case 'blocked': return '!';
		case 'failed': return 'x';
		case 'skipped': return '>';
		case 'pending':
		default: return '-';
	}
}

/** Codicon class for rendering a task status glyph in workbench UI. */
export function statusIconClass(status: AgentTaskNode['status']): string {
	switch (status) {
		case 'complete': return 'codicon-pass-filled';
		case 'in_progress': return 'codicon-play-circle';
		case 'blocked': return 'codicon-warning';
		case 'failed': return 'codicon-error';
		case 'skipped': return 'codicon-debug-step-over';
		case 'pending':
		default: return 'codicon-circle-large-outline';
	}
}

export function statusIconQuickPick(status: AgentTaskNode['status']): string {
	switch (status) {
		case 'complete': return '$(pass)';
		case 'in_progress': return '$(sync~spin)';
		case 'blocked': return '$(warning)';
		case 'failed': return '$(error)';
		case 'skipped': return '$(debug-step-over)';
		case 'pending':
		default: return '$(circle-outline)';
	}
}

export function formatNodeDetail(node: AgentTaskNode): string | undefined {
	const details = [
		node.description,
		node.implementation?.changedFiles?.length ? `Changed: ${node.implementation.changedFiles.join(', ')}` : undefined,
		node.implementation?.commandsRun?.length ? `Commands: ${node.implementation.commandsRun.join(', ')}` : undefined,
		node.implementation?.verification ? `Verification: ${node.implementation.verification}` : undefined,
		node.implementation?.notes ? `Notes: ${node.implementation.notes}` : undefined,
		node.implementation?.error ? `Error: ${node.implementation.error}` : undefined,
	].filter((item): item is string => Boolean(item));
	return details.length ? details.join('  •  ') : undefined;
}

export function isRetryableLeaf(node: AgentTaskNode): boolean {
	return node.type === 'leaf' && (node.status === 'failed' || node.status === 'blocked' || node.status === 'in_progress');
}

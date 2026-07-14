/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../base/common/cancellation.js';
import { joinPath } from '../../../../base/common/resources.js';
import type { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import type { AgentTaskExecutionResult, AgentTaskExecutor, AgentTaskNode, AgentTaskTree } from '../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import { AgentTaskBlockedError, AgentTaskPausedError, taskTreeResource } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import { blueprintResource } from '../../../../../custom/goalWorkspace/surfaceBlueprintService.js';
import type { IChatRequestFileEntry } from '../../chat/common/attachments/chatVariableEntries.js';
import { ChatAgentLocation, ChatModeKind, ChatPermissionLevel } from '../../chat/common/constants.js';
import { ChatSendResult, IChatService, ResponseModelState } from '../../chat/common/chatService/chatService.js';
import { ModeShellChatSessionManager } from './modeShellChatSessions.js';

interface CustomAiTaskExecutionMetadata {
	readonly changedFiles?: readonly string[];
	readonly commandsRun?: readonly string[];
	readonly verification?: string;
	readonly notes?: string;
}

export class CustomAiAgentTaskExecutor implements AgentTaskExecutor {
	constructor(
		private readonly chatService: IChatService,
		private readonly chatSessionManager: ModeShellChatSessionManager,
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
	) { }

	async executeTask(tree: AgentTaskTree, task: AgentTaskNode, token: CancellationToken): Promise<AgentTaskExecutionResult> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			throw new AgentTaskBlockedError('Open a workspace before executing task-tree work.');
		}
		if (token.isCancellationRequested) {
			throw new AgentTaskPausedError();
		}

		const surfaceKey = tree.surfaceId ?? '__task_tree__';
		const sessionResource = this.chatSessionManager.getOrCreateUISurfaceSessionResource(surfaceKey);
		const sessionRef = await this.chatService.acquireOrLoadSession(
			sessionResource,
			ChatAgentLocation.Chat,
			token,
			'CustomAiAgentTaskExecutor#executeTask',
		);
		if (!sessionRef) {
			throw new AgentTaskBlockedError('Could not load the Custom AI conversation for this task tree.');
		}

		const cancellation = token.onCancellationRequested(() => {
			void this.chatService.cancelCurrentRequestForSession(sessionResource, 'taskTreePause');
		});
		try {
			const sendResult = await this.chatService.sendRequest(sessionResource, buildTaskPrompt(tree, task), {
				agentIdSilent: 'custom.ai',
				location: ChatAgentLocation.Chat,
				modeInfo: {
					kind: ChatModeKind.Agent,
					isBuiltin: true,
					modeInstructions: undefined,
					telemetryModeId: 'agent',
					applyCodeBlockSuggestionId: undefined,
					permissionLevel: ChatPermissionLevel.AutoApprove,
				},
				attachedContext: await this.buildAttachments(workspaceFolder, tree),
				isSystemInitiated: true,
				systemInitiatedLabel: `Running task: ${task.title}`,
				instructionContext: { modeKind: ChatModeKind.Agent },
			});
			const sent = await resolveSentResult(sendResult);
			const response = await sent.data.responseCreatedPromise;
			await sent.data.responseCompletePromise;

			if (token.isCancellationRequested || response.state === ResponseModelState.Cancelled || response.isCanceled) {
				throw new AgentTaskPausedError();
			}
			if (response.state === ResponseModelState.Failed || response.result?.errorDetails) {
				throw new Error(response.result?.errorDetails?.message ?? `Custom AI failed task "${task.title}".`);
			}

			const metadata = parseTaskExecutionMetadata(response.result?.metadata?.customAiTaskExecution);
			return {
				changedFiles: metadata?.changedFiles ?? [],
				commandsRun: metadata?.commandsRun ?? [],
				verification: metadata?.verification ?? buildFallbackVerification(task),
				notes: metadata?.notes ?? `Custom AI completed ${task.title}.`,
			};
		} finally {
			cancellation.dispose();
			sessionRef.dispose();
		}
	}

	private async buildAttachments(workspaceFolder: URI, tree: AgentTaskTree): Promise<IChatRequestFileEntry[]> {
		const candidates: Array<{ resource: URI; id: string; name: string }> = [
			{ resource: joinPath(workspaceFolder, 'workspace.goal.json'), id: 'task-tree:workspace.goal.json', name: 'workspace.goal.json' },
			{ resource: taskTreeResource(workspaceFolder, tree.id), id: `task-tree:${tree.id}`, name: `${tree.id}.json` },
		];
		if (tree.surfaceId) {
			candidates.push({
				resource: blueprintResource(workspaceFolder, tree.surfaceId),
				id: `task-tree:blueprint:${tree.surfaceId}`,
				name: `${tree.surfaceId}.blueprint.json`,
			});
		}

		const entries: IChatRequestFileEntry[] = [];
		for (const candidate of candidates) {
			if (!(await this.fileService.exists(candidate.resource))) {
				continue;
			}
			entries.push({
				kind: 'file',
				id: candidate.id,
				name: candidate.name,
				value: { uri: candidate.resource },
			});
		}
		return entries;
	}
}

function buildTaskPrompt(tree: AgentTaskTree, task: AgentTaskNode): string {
	const lines = [
		`Execute exactly one task-tree leaf for objective "${tree.prompt}".`,
		`Task ID: ${task.id}`,
		`Task: ${task.title}`,
		task.description ? `Implementation context: ${task.description}` : undefined,
		task.subsystemId ? `Blueprint subsystem: ${task.subsystemId}` : undefined,
		task.expectedPaths?.length ? `Required paths: ${task.expectedPaths.join(', ')}` : undefined,
		task.acceptanceChecks?.length ? `Acceptance checks:\n${task.acceptanceChecks.map(check => `- ${check}`).join('\n')}` : undefined,
		'Implement this leaf completely using tools. Do not execute later leaves and do not edit the task-tree JSON.',
		'Run the relevant verification for this leaf, then stop.',
	].filter((line): line is string => Boolean(line));
	return lines.join('\n\n');
}

async function resolveSentResult(result: Awaited<ReturnType<IChatService['sendRequest']>>) {
	let current = result;
	while (ChatSendResult.isQueued(current)) {
		current = await current.deferred;
	}
	if (ChatSendResult.isRejected(current)) {
		throw new AgentTaskBlockedError(`Custom AI task request was rejected: ${current.reason}`);
	}
	return current;
}

function parseTaskExecutionMetadata(value: unknown): CustomAiTaskExecutionMetadata | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		changedFiles: stringArray(record.changedFiles),
		commandsRun: stringArray(record.commandsRun),
		verification: typeof record.verification === 'string' ? record.verification : undefined,
		notes: typeof record.notes === 'string' ? record.notes : undefined,
	};
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function buildFallbackVerification(task: AgentTaskNode): string {
	return task.acceptanceChecks?.length
		? `Custom AI completed the request; post-run checks: ${task.acceptanceChecks.join('; ')}`
		: `Custom AI completed ${task.title}.`;
}

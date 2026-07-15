/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileService } from '../../../../../platform/files/common/files.js';
import type { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import type { AgentTaskTree } from '../../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import type { IChatService } from '../../../chat/common/chatService/chatService.js';
import { ResponseModelState } from '../../../chat/common/chatService/chatService.js';
import { CustomAiAgentTaskExecutor } from '../agentTaskTreeChatExecutor.js';
import type { ModeShellChatSessionManager } from '../modeShellChatSessions.js';

suite('CustomAiAgentTaskExecutor', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sends one compact system request and returns structured evidence', async () => {
		const workspace = URI.file('/workspace');
		const session = URI.parse('vscode-chat:/surface');
		let sentPrompt = '';
		let sentOptions: Parameters<IChatService['sendRequest']>[2] = undefined;
		const chatService = {
			acquireOrLoadSession: async () => ({ object: { sessionResource: session }, dispose() { } }),
			sendRequest: async (_resource: URI, prompt: string, options: Parameters<IChatService['sendRequest']>[2]) => {
				sentPrompt = prompt;
				sentOptions = options;
				return {
					kind: 'sent' as const,
					data: {
						agent: {} as never,
						responseCreatedPromise: Promise.resolve({
							state: ResponseModelState.Complete,
							isCanceled: false,
							result: {
								metadata: {
									customAiTaskExecution: {
										changedFiles: ['apps/booking/app/page.tsx'],
										commandsRun: ['editFile'],
										verification: 'route exists',
										notes: 'implemented booking route',
									},
								},
							},
						} as never),
						responseCompletePromise: Promise.resolve(),
					},
				};
			},
			cancelCurrentRequestForSession: async () => { },
		} as unknown as IChatService;
		const manager = {
			getOrCreateUISurfaceSessionResource: () => session,
		} as unknown as ModeShellChatSessionManager;
		const fileService = {
			exists: async () => false,
		} as unknown as IFileService;
		const workspaceService = {
			getWorkspace: () => ({ folders: [{ uri: workspace }] }),
		} as unknown as IWorkspaceContextService;
		const executor = new CustomAiAgentTaskExecutor(chatService, manager, fileService, workspaceService);
		const tree = createTree();

		const result = await executor.executeTask(tree, tree.roots[0].children![0], CancellationToken.None);
		const requestOptions = sentOptions as unknown as { agentIdSilent?: string; isSystemInitiated?: boolean };

		assert.ok(sentPrompt.includes('Execute exactly one task-tree leaf'));
		assert.ok(sentPrompt.includes('Required paths: apps/booking/app/page.tsx'));
		assert.strictEqual(requestOptions.agentIdSilent, 'custom.ai');
		assert.strictEqual(requestOptions.isSystemInitiated, true);
		assert.deepStrictEqual(result.changedFiles, ['apps/booking/app/page.tsx']);
		assert.strictEqual(result.verification, 'route exists');
	});

	test('persists customAiGraphProposal metadata as speculative proposal enrichment', async () => {
		const workspace = URI.file('/workspace');
		const session = URI.parse('vscode-chat:/surface');
		const chatService = {
			acquireOrLoadSession: async () => ({ object: { sessionResource: session }, dispose() { } }),
			sendRequest: async () => ({
				kind: 'sent' as const,
				data: {
					agent: {} as never,
					responseCreatedPromise: Promise.resolve({
						state: ResponseModelState.Complete,
						isCanceled: false,
						result: {
							metadata: {
								customAiTaskExecution: { changedFiles: [], commandsRun: ['editFile'], verification: 'done' },
								customAiGraphProposal: {
									add_nodes: ['function:apps/booking/app/page.tsx::BookingPage'],
									add_edges: [{
										src: 'function:apps/booking/app/page.tsx::BookingPage',
										predicate: 'CALLS',
										dst: 'function:packages/domain/index.ts::listSlots',
									}],
								},
							},
						},
					} as never),
					responseCompletePromise: Promise.resolve(),
				},
			}),
			cancelCurrentRequestForSession: async () => { },
		} as unknown as IChatService;
		const manager = {
			getOrCreateUISurfaceSessionResource: () => session,
		} as unknown as ModeShellChatSessionManager;
		const written = new Map<string, string>();
		const fileService = {
			exists: async () => false,
			createFolder: async () => undefined,
			writeFile: async (resource: URI, content: { toString(): string }) => {
				written.set(resource.path, content.toString());
			},
		} as unknown as IFileService;
		const workspaceService = {
			getWorkspace: () => ({ folders: [{ uri: workspace }] }),
		} as unknown as IWorkspaceContextService;
		const executor = new CustomAiAgentTaskExecutor(chatService, manager, fileService, workspaceService);
		const tree = createTree();

		await executor.executeTask(tree, tree.roots[0].children![0], CancellationToken.None);

		const proposalPath = '/workspace/.agent/task-trees/booking-tree.graph-proposal.json';
		assert.ok(written.has(proposalPath), 'graph proposal enrichment is persisted next to the tree');
		const proposal = JSON.parse(written.get(proposalPath)!);
		assert.strictEqual(proposal.tree_id, 'booking-tree');
		assert.deepStrictEqual(proposal.add_nodes, ['function:apps/booking/app/page.tsx::BookingPage']);
		assert.strictEqual(proposal.add_edges[0].confidence, 'speculative');
	});
});

function createTree(): AgentTaskTree {
	return {
		version: 1,
		id: 'booking-tree',
		prompt: 'Create Booking',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		status: 'active',
		surfaceId: 'booking',
		surfaceName: 'Booking',
		templateId: 'booking',
		roots: [{
			id: 'routes',
			title: 'Routes',
			type: 'root',
			status: 'pending',
			order: 1,
			children: [{
				id: 'booking-route',
				parentId: 'routes',
				title: 'Implement booking route',
				description: 'Build the booking route.',
				type: 'leaf',
				status: 'pending',
				order: 2,
				expectedPaths: ['apps/booking/app/page.tsx'],
				acceptanceChecks: ['Booking route renders'],
			}],
		}],
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileService } from '../../../../../platform/files/common/files.js';
import type { IWebviewService } from '../../../webview/browser/webview.js';
import type { IIxIntegrationService } from '../../../../../../custom/ix/IxIntegrationService.js';
import { SurfacePlanPanel } from '../surfacePlanPanel.js';

suite('surfacePlanPanel ownership', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stamps owning surface on Steps tracker and clears on clear()', async () => {
		const root = document.createElement('div');
		const fileService = {
			onDidFilesChange: new Emitter().event,
			watch: () => ({ dispose: () => { } }),
			exists: async () => false,
			readFile: async () => { throw new Error('missing'); },
			stat: async () => { throw new Error('missing'); },
			writeFile: async () => { },
			createFolder: async () => { },
		} as unknown as IFileService;
		const onMessage = new Emitter<{ message: unknown }>();
		const webview = {
			onMessage: onMessage.event,
			postMessage: async () => true,
			claim: () => { },
			layout: () => { },
			setHtml: () => { },
			mountTo: () => { },
			dispose: () => onMessage.dispose(),
		};
		const panel = new SurfacePlanPanel(
			root,
			fileService,
			{ createWebviewElement: () => webview } as unknown as IWebviewService,
			{
				onDidChangeState: new Emitter().event,
				getState: () => ({}),
			} as unknown as IIxIntegrationService,
		);

		await panel.load({
			surfaceId: 'cadre-support-bot',
			surfaceName: 'Cadre AI Support Chatbot',
			workspaceFolder: URI.file('/tmp/ws'),
			surface: {
				id: 'cadre-support-bot',
				name: 'Cadre AI Support Chatbot',
				capabilities: [],
				events: [],
				entities: [],
				ixSubsystems: [],
			},
		});

		const tracker = panel.statusTrackerElement;
		assert.strictEqual(tracker.dataset.surfaceId, 'cadre-support-bot');
		assert.ok(tracker.getAttribute('aria-label')?.includes('Cadre AI Support Chatbot'));
		assert.strictEqual(tracker.querySelector('.custom-mode-surface-plan-status-surface-chip'), null);

		panel.clear();
		assert.strictEqual(tracker.dataset.surfaceId, undefined);
		assert.strictEqual(tracker.querySelectorAll('.custom-mode-surface-plan-status-step').length, 0);

		panel.dispose();
	});

	test('paints on-disk proposal into the webview after ready (no Ix wait)', async () => {
		const root = document.createElement('div');
		const workspaceFolder = URI.file('/tmp/ws-eval');
		const surfaceId = 'chatbot-evaluation-harness';
		const planUri = URI.joinPath(workspaceFolder, '.agent', 'surfaces', `${surfaceId}.plan.md`);
		const proposalUri = URI.joinPath(workspaceFolder, '.agent', 'task-trees', `${surfaceId}.graph-proposal.json`);
		const proposal = {
			add_nodes: ['apps/eval/a.ts', 'apps/eval/b.ts'],
			add_edges: [{ src: 'apps/eval/a.ts', dst: 'apps/eval/b.ts', predicate: 'IMPORTS' }],
			phases: [{ id: 'phase-1', title: 'Scaffold' }],
		};
		const files = new Map<string, string>([
			[planUri.toString(), '# Plan\n\n## §0 Plan lock\n- [x] Locked\n'],
			[proposalUri.toString(), JSON.stringify(proposal)],
		]);
		const fileService = {
			onDidFilesChange: new Emitter().event,
			watch: () => ({ dispose: () => { } }),
			exists: async (resource: URI) => files.has(resource.toString()),
			readFile: async (resource: URI) => {
				const text = files.get(resource.toString());
				if (text === undefined) {
					throw new Error(`missing ${resource.path}`);
				}
				return { value: VSBuffer.fromString(text) };
			},
			stat: async (resource: URI) => {
				if (!files.has(resource.toString())) {
					throw new Error('missing');
				}
				return { isFile: true, isDirectory: false };
			},
			writeFile: async () => { },
			createFolder: async () => { },
		} as unknown as IFileService;

		const posted: unknown[] = [];
		const onMessage = new Emitter<{ message: unknown }>();
		const webview = {
			onMessage: onMessage.event,
			postMessage: async (message: unknown) => {
				posted.push(message);
				return true;
			},
			claim: () => { },
			layout: () => { },
			setHtml: () => { },
			mountTo: () => { },
			dispose: () => onMessage.dispose(),
		};
		const panel = new SurfacePlanPanel(
			root,
			fileService,
			{ createWebviewElement: () => webview } as unknown as IWebviewService,
			{
				onDidChangeState: new Emitter().event,
				getState: () => ({}),
				mapPath: async () => { },
				runSubsystems: async () => [],
			} as unknown as IIxIntegrationService,
		);

		await panel.load({
			surfaceId,
			surfaceName: 'Chatbot Evaluation Harness',
			workspaceFolder,
			surface: {
				id: surfaceId,
				name: 'Chatbot Evaluation Harness',
				path: `apps/${surfaceId}`,
				capabilities: [],
				events: [],
				entities: [],
				ixSubsystems: [],
			},
		});

		// Disk proposal is loaded into lastDocument, but webview posts wait for ready.
		assert.ok(!posted.some(message => (message as { type?: string }).type === 'surfaceProposalTree.setDocument'));

		onMessage.fire({ message: { type: 'surfaceProposalTree.ready' } });
		await Promise.resolve();

		const docs = posted.filter(message => (message as { type?: string }).type === 'surfaceProposalTree.setDocument') as Array<{
			type: string;
			proposal?: { add_nodes?: string[] };
		}>;
		assert.ok(docs.length >= 1, 'expected setDocument after ready');
		assert.ok(docs.some(doc => doc.proposal?.add_nodes?.length === 2), 'expected on-disk proposal in first paints');

		panel.dispose();
	});
});

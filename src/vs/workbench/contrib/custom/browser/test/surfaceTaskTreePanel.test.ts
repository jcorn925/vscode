/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { AgentTaskNode, AgentTaskTree } from '../../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import { SurfaceTaskTreePanel } from '../surfaceTaskTreePanel.js';

suite('surfaceTaskTreePanel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('renders nested nodes and progress summary', () => {
		const service = new TestAgentTaskTreeService();
		const root = document.createElement('div');
		const panel = new SurfaceTaskTreePanel(root, service);
		try {
			panel.render(createTree());
			assert.ok(root.textContent?.includes('Build feature'));
			assert.ok(root.textContent?.includes('50%'));
			assert.ok(root.querySelector('.custom-mode-surface-task-tree-node'));
		} finally {
			panel.dispose();
		}
	});

	test('footer controls invoke service methods', async () => {
		const service = new TestAgentTaskTreeService();
		const root = document.createElement('div');
		const panel = new SurfaceTaskTreePanel(root, service);
		try {
			panel.render(createTree());
			const buttons = root.querySelectorAll('.custom-mode-surface-task-tree-control') as NodeListOf<HTMLButtonElement>;
			assert.strictEqual(buttons.length, 5);
			buttons[1].click();
			await Promise.resolve();
			assert.strictEqual(service.continueCount, 1);
		} finally {
			panel.dispose();
		}
	});

	test('shows inline retry and skip controls for blocked leaves', () => {
		const service = new TestAgentTaskTreeService();
		const root = document.createElement('div');
		const panel = new SurfaceTaskTreePanel(root, service);
		try {
			const tree = createTree();
			tree.roots[0].children![0].status = 'blocked';
			tree.cursor = { currentNodeId: 'leaf-1' };
			panel.render(tree);
			const inlineActions = root.querySelectorAll('.custom-mode-surface-task-tree-inline-action');
			assert.strictEqual(inlineActions.length, 2);
		} finally {
			panel.dispose();
		}
	});
});

function createTree(): AgentTaskTree {
	return {
		version: 1,
		id: 'tree-1',
		prompt: 'Build feature',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		status: 'active',
		surfaceId: 'marketing',
		roots: [{
			id: 'root-1',
			title: 'Root',
			type: 'root',
			status: 'pending',
			order: 1,
			children: [
				{ id: 'leaf-1', parentId: 'root-1', title: 'First', type: 'leaf', status: 'complete', order: 1 },
				{ id: 'leaf-2', parentId: 'root-1', title: 'Second', type: 'leaf', status: 'pending', order: 2 },
			],
		}],
		cursor: {},
	};
}

class TestAgentTaskTreeService {
	declare readonly _serviceBrand: undefined;
	private readonly emitter = new Emitter<AgentTaskTree | undefined>();
	readonly onDidChangeTaskTree = this.emitter.event;
	continueCount = 0;

	findNextPendingLeaf(tree: AgentTaskTree): AgentTaskNode | undefined {
		return tree.roots.flatMap(root => root.children ?? []).find(node => node.status === 'pending');
	}

	async generateTaskTree(): Promise<AgentTaskTree> {
		return createTree();
	}

	async loadTaskTree(): Promise<AgentTaskTree | undefined> {
		return createTree();
	}

	async loadLatestResumableTaskTree(): Promise<AgentTaskTree | undefined> {
		return createTree();
	}

	async loadLatestTaskTreeForSurface(): Promise<AgentTaskTree | undefined> {
		return createTree();
	}

	async continueNextTask(): Promise<never> {
		this.continueCount++;
		throw new Error('not implemented');
	}

	async resumeTaskTree(): Promise<void> {
		return;
	}

	async pauseTaskTree(): Promise<void> {
		return;
	}

	async retryTask(): Promise<void> {
		return;
	}

	async skipTask(): Promise<void> {
		return;
	}

	async regenerateBranch(): Promise<void> {
		return;
	}
}

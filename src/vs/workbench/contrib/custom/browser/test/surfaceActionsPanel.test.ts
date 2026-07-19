/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SurfaceActionsPanel, type SurfaceCommonActionItem } from '../surfaceActionsPanel.js';
import type { SurfaceFeatureChecklistState, SurfaceWorkflowActionItem } from '../../../../../../custom/goalWorkspace/surfaceFeatureChecklistTypes.js';

suite('surfaceActionsPanel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shows empty state when there are no actions', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceActionsPanel(root, service);
		try {
			const empty = root.querySelector('.custom-mode-surface-actions-empty') as HTMLElement;
			const list = root.querySelector('.custom-mode-surface-actions-list') as HTMLElement;
			assert.ok(empty);
			assert.strictEqual(empty.classList.contains('hidden'), false);
			assert.strictEqual(list.classList.contains('hidden'), true);
			assert.strictEqual(empty.textContent, 'No workflow actions yet');
		} finally {
			panel.dispose();
		}
	});

	test('renders common Publish to GitHub action even without workflow actions', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const commonActions: SurfaceCommonActionItem[] = [{
			id: 'publish-to-github',
			label: 'Publish to GitHub',
			title: 'Create a GitHub repository and push this workspace',
		}];
		let clickedId: string | undefined;
		const panel = new SurfaceActionsPanel(root, service, undefined, commonActions, actionId => {
			clickedId = actionId;
		});
		try {
			const empty = root.querySelector('.custom-mode-surface-actions-empty') as HTMLElement;
			const buttons = Array.from(root.querySelectorAll('.custom-mode-surface-actions-action')) as HTMLButtonElement[];
			assert.strictEqual(empty.classList.contains('hidden'), true);
			assert.strictEqual(buttons.length, 1);
			assert.strictEqual(buttons[0].textContent, 'Publish to GitHub');
			assert.strictEqual(buttons[0].dataset.actionId, 'publish-to-github');
			buttons[0].click();
			assert.strictEqual(clickedId, 'publish-to-github');
		} finally {
			panel.dispose();
		}
	});

	test('renders common actions above workflow actions with section titles', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceActionsPanel(
			root,
			service,
			undefined,
			[{ id: 'publish-to-github', label: 'Publish to GitHub' }],
		);
		try {
			service.setState({
				...service.getState(),
				actions: [{
					workflowId: 'wf-1',
					surfaceId: 'home',
					workflowLabel: 'Home workflow',
					stepId: 'navigate-home',
					stepLabel: 'Open home',
				}],
			});
			const titles = Array.from(root.querySelectorAll('.custom-mode-surface-actions-section-title')).map(el => el.textContent);
			assert.deepStrictEqual(titles, ['Common', 'Workflow']);
			const buttons = Array.from(root.querySelectorAll('.custom-mode-surface-actions-action')) as HTMLButtonElement[];
			assert.strictEqual(buttons.length, 2);
			assert.strictEqual(buttons[0].textContent, 'Publish to GitHub');
			assert.strictEqual(buttons[1].textContent, 'home: Open home');
		} finally {
			panel.dispose();
		}
	});

	test('renders action buttons from service state', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceActionsPanel(root, service);
		try {
			service.setState({
				...service.getState(),
				actions: [
					{
						workflowId: 'wf-1',
						surfaceId: 'home',
						workflowLabel: 'Home workflow',
						stepId: 'navigate-home',
						stepLabel: 'Open home',
					},
					{
						workflowId: 'wf-1',
						surfaceId: 'home',
						workflowLabel: 'Home workflow',
						stepId: 'assert-title',
						stepLabel: 'Check title',
					},
				],
			});
			const buttons = Array.from(root.querySelectorAll('.custom-mode-surface-actions-action')) as HTMLButtonElement[];
			assert.strictEqual(buttons.length, 2);
			assert.strictEqual(buttons[0].textContent, 'home: Open home');
			assert.strictEqual(buttons[0].dataset.surfaceId, 'home');
			assert.strictEqual(buttons[0].dataset.stepId, 'navigate-home');
			assert.strictEqual(buttons[1].textContent, 'home: Check title');
			const empty = root.querySelector('.custom-mode-surface-actions-empty') as HTMLElement;
			assert.strictEqual(empty.classList.contains('hidden'), true);
		} finally {
			panel.dispose();
		}
	});

	test('invokes step callback when an action is clicked', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		let played: { surfaceId?: string; stepId?: string } | undefined;
		const panel = new SurfaceActionsPanel(root, service, (surfaceId, stepId) => {
			played = { surfaceId, stepId };
		});
		try {
			service.setState({
				...service.getState(),
				actions: [{
					workflowId: 'wf-1',
					surfaceId: 'billing',
					workflowLabel: 'Billing',
					stepId: 'click-pay',
					stepLabel: 'Pay',
				} satisfies SurfaceWorkflowActionItem],
			});
			const button = root.querySelector('.custom-mode-surface-actions-action') as HTMLButtonElement;
			button.click();
			assert.deepStrictEqual(played, { surfaceId: 'billing', stepId: 'click-pay' });
		} finally {
			panel.dispose();
		}
	});

	test('invokes play callback from header Play button', () => {
		let playCount = 0;
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceActionsPanel(root, service, () => {
			playCount++;
		});
		try {
			const playButton = root.querySelector('.custom-mode-surface-actions-play') as HTMLButtonElement;
			assert.ok(playButton);
			playButton.click();
			assert.strictEqual(playCount, 1);
		} finally {
			panel.dispose();
		}
	});

	test('disables toolbar buttons while refreshing', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceActionsPanel(root, service);
		try {
			service.setState({ ...service.getState(), isRefreshing: true });
			const playButton = root.querySelector('.custom-mode-surface-actions-play') as HTMLButtonElement;
			const refreshButton = root.querySelector('.custom-mode-surface-actions-refresh') as HTMLButtonElement;
			assert.strictEqual(playButton.disabled, true);
			assert.strictEqual(refreshButton.disabled, true);
		} finally {
			panel.dispose();
		}
	});
});

class TestChecklistService {
	declare readonly _serviceBrand: undefined;
	private readonly emitter = new Emitter<SurfaceFeatureChecklistState>();
	readonly onDidChangeState = this.emitter.event;
	private state: SurfaceFeatureChecklistState = {
		items: [],
		actions: [],
		readyCount: 0,
		totalCount: 0,
		isRefreshing: false,
	};

	getState(): SurfaceFeatureChecklistState {
		return this.state;
	}

	async refresh(): Promise<void> {
		return;
	}

	setState(next: SurfaceFeatureChecklistState): void {
		this.state = next;
		this.emitter.fire(this.state);
	}
}

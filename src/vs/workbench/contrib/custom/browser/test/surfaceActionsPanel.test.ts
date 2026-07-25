/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SurfaceActionsPanel } from '../surfaceActionsPanel.js';
import { createSurfaceExtensibilityRegistry, type ISurfaceContext } from '../surfaceExtensibilityRegistry.js';
import type { SurfaceFeatureChecklistState, SurfaceWorkflowActionItem } from '../../../../../../custom/goalWorkspace/surfaceFeatureChecklistTypes.js';

suite('surfaceActionsPanel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createPanel(options?: {
		onPlay?: (surfaceId?: string, stepId?: string) => void;
		context?: ISurfaceContext;
	}) {
		const service = new TestChecklistService();
		const registry = store.add(createSurfaceExtensibilityRegistry());
		const root = document.createElement('div');
		store.add(new SurfaceActionsPanel(root, service, options?.onPlay, registry, () => options?.context));
		return { service, registry, root };
	}

	function buttonLabels(root: HTMLElement): (string | null)[] {
		return Array.from(root.querySelectorAll('.custom-mode-surface-actions-action')).map(el => el.textContent);
	}

	function sectionTitles(root: HTMLElement): (string | null)[] {
		return Array.from(root.querySelectorAll('.custom-mode-surface-actions-section-title')).map(el => el.textContent);
	}

	test('shows empty state when there are no actions', () => {
		const { root } = createPanel();
		const empty = root.querySelector('.custom-mode-surface-actions-empty') as HTMLElement;
		const list = root.querySelector('.custom-mode-surface-actions-list') as HTMLElement;
		assert.deepStrictEqual(
			[empty.classList.contains('hidden'), list.classList.contains('hidden'), empty.textContent],
			[false, true, 'No workflow actions yet'],
		);
	});

	test('renders registered actions and runs them with the surface context', () => {
		const context: ISurfaceContext = { surfaceId: 'home' };
		const { registry, root } = createPanel({ context });
		const ran: (ISurfaceContext | undefined)[] = [];
		store.add(registry.registerAction({
			id: 'publish-to-github',
			label: 'Publish to GitHub',
			tooltip: 'Create a GitHub repository and push this workspace',
			run: ctx => { ran.push(ctx); },
		}));
		store.add(registry.registerAction({
			id: 'show-github',
			label: 'Show GitHub',
			run: () => { },
		}));
		const buttons = Array.from(root.querySelectorAll('.custom-mode-surface-actions-action')) as HTMLButtonElement[];
		buttons[0].click();
		assert.deepStrictEqual(
			[buttonLabels(root), sectionTitles(root), buttons[0].dataset.actionId, buttons[0].title, ran],
			[['Publish to GitHub', 'Show GitHub'], [], 'publish-to-github', 'Create a GitHub repository and push this workspace', [context]],
		);
	});

	test('orders actions by group with section titles when more than one section renders', () => {
		const { service, registry, root } = createPanel();
		store.add(registry.registerAction({ id: 'a', label: 'Alpha', run: () => { } }));
		store.add(registry.registerAction({ id: 'b', label: 'Beta', group: 'Deploys', run: () => { } }));
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
		assert.deepStrictEqual(
			[sectionTitles(root), buttonLabels(root)],
			[['Common', 'Deploys', 'Workflow'], ['Alpha', 'Beta', 'home: Open home']],
		);
	});

	test('filters registered actions through isApplicable with the current context', () => {
		const { registry, root } = createPanel({ context: { surfaceId: 'billing' } });
		store.add(registry.registerAction({ id: 'a', label: 'Everywhere', run: () => { } }));
		store.add(registry.registerAction({
			id: 'b',
			label: 'Home Only',
			isApplicable: ctx => ctx?.surfaceId === 'home',
			run: () => { },
		}));
		assert.deepStrictEqual(buttonLabels(root), ['Everywhere']);
	});

	test('re-renders when registrations change', () => {
		const { registry, root } = createPanel();
		const registration = store.add(registry.registerAction({ id: 'a', label: 'Alpha', run: () => { } }));
		const afterRegister = buttonLabels(root);
		registration.dispose();
		assert.deepStrictEqual(
			[afterRegister, buttonLabels(root)],
			[['Alpha'], []],
		);
	});

	test('renders workflow actions from service state and plays them on click', () => {
		let played: { surfaceId?: string; stepId?: string } | undefined;
		const { service, root } = createPanel({
			onPlay: (surfaceId, stepId) => { played = { surfaceId, stepId }; },
		});
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
		assert.deepStrictEqual(
			[buttonLabels(root), button.dataset.surfaceId, button.dataset.stepId, played],
			[['billing: Pay'], 'billing', 'click-pay', { surfaceId: 'billing', stepId: 'click-pay' }],
		);
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

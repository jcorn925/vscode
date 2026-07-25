/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ISurfaceFeatureChecklistService } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistService.js';
import type { SurfaceFeatureChecklistState, SurfaceWorkflowActionItem } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistTypes.js';
import { SURFACE_ACTION_GROUP_COMMON, type ISurfaceActionDescriptor, type ISurfaceContext, type ISurfaceExtensibilityRegistry } from './surfaceExtensibilityRegistry.js';

export class SurfaceActionsPanel extends Disposable {
	private readonly listEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private readonly actionListeners = this._register(new DisposableStore());

	constructor(
		private readonly root: HTMLElement,
		private readonly service: ISurfaceFeatureChecklistService,
		private readonly onPlay?: (surfaceId?: string, stepId?: string) => void,
		private readonly registry?: ISurfaceExtensibilityRegistry,
		private readonly surfaceContextProvider?: () => ISurfaceContext | undefined,
	) {
		super();

		this.emptyEl = $('div.custom-mode-surface-actions-empty', undefined, localize('surfaceActions.empty', 'No workflow actions yet'));
		this.listEl = $('div.custom-mode-surface-actions-list');
		this.root.appendChild($('div.custom-mode-surface-actions', undefined, this.emptyEl, this.listEl));

		this._register(this.service.onDidChangeState(state => this.render(state)));
		if (this.registry) {
			this._register(this.registry.onDidChange(() => this.render(this.service.getState())));
		}
		this._register(toDisposable(() => this.root.replaceChildren()));

		this.render(this.service.getState());
		void this.service.refresh();
	}

	private render(state: SurfaceFeatureChecklistState): void {
		this.renderActions(state.actions);
	}

	private renderActions(workflowActions: readonly SurfaceWorkflowActionItem[]): void {
		this.actionListeners.clear();
		this.listEl.replaceChildren();
		const context = this.surfaceContextProvider?.();
		const groups = this.groupRegistryActions(this.registry?.getActions(context) ?? []);
		const hasWorkflow = workflowActions.length > 0;
		if (!groups.length && !hasWorkflow) {
			this.emptyEl.classList.remove('hidden');
			this.listEl.classList.add('hidden');
			return;
		}
		this.emptyEl.classList.add('hidden');
		this.listEl.classList.remove('hidden');

		const showTitles = groups.length + (hasWorkflow ? 1 : 0) > 1;
		for (const group of groups) {
			if (showTitles) {
				this.listEl.appendChild($('div.custom-mode-surface-actions-section-title', undefined, group.title));
			}
			for (const action of group.actions) {
				const button = $('button.custom-mode-surface-actions-action', {
					type: 'button',
					title: action.tooltip ?? action.label,
					'data-action-id': action.id,
				}, action.label) as HTMLButtonElement;
				this.actionListeners.add(addDisposableListener(button, 'click', () => {
					void action.run(this.surfaceContextProvider?.());
				}));
				this.listEl.appendChild(button);
			}
		}

		if (hasWorkflow) {
			if (showTitles) {
				this.listEl.appendChild($('div.custom-mode-surface-actions-section-title', undefined, localize('surfaceActions.workflowTitle', 'Workflow')));
			}
			for (const action of workflowActions) {
				const button = $('button.custom-mode-surface-actions-action', {
					type: 'button',
					title: `${action.workflowLabel} • ${action.stepLabel}`,
					'data-surface-id': action.surfaceId,
					'data-step-id': action.stepId,
				}, `${action.surfaceId}: ${action.stepLabel}`) as HTMLButtonElement;
				this.actionListeners.add(addDisposableListener(button, 'click', () => this.onPlay?.(action.surfaceId, action.stepId)));
				this.listEl.appendChild(button);
			}
		}
	}

	/** Bucket registered actions into titled panel sections, preserving action order. */
	private groupRegistryActions(actions: readonly ISurfaceActionDescriptor[]): { title: string; actions: ISurfaceActionDescriptor[] }[] {
		const byGroup = new Map<string, ISurfaceActionDescriptor[]>();
		for (const action of actions) {
			const group = action.group ?? SURFACE_ACTION_GROUP_COMMON;
			let bucket = byGroup.get(group);
			if (!bucket) {
				bucket = [];
				byGroup.set(group, bucket);
			}
			bucket.push(action);
		}
		return [...byGroup].map(([group, groupActions]) => ({
			title: group === SURFACE_ACTION_GROUP_COMMON
				? localize('surfaceActions.commonTitle', 'Common')
				: group,
			actions: groupActions,
		}));
	}
}

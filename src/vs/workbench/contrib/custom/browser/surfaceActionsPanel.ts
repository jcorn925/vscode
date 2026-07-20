/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ISurfaceFeatureChecklistService } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistService.js';
import type { SurfaceFeatureChecklistState, SurfaceWorkflowActionItem } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistTypes.js';

export interface SurfaceCommonActionItem {
	readonly id: string;
	readonly label: string;
	readonly title?: string;
}

export class SurfaceActionsPanel extends Disposable {
	private readonly listEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private readonly actionListeners = this._register(new DisposableStore());
	private readonly commonActions: readonly SurfaceCommonActionItem[];

	constructor(
		private readonly root: HTMLElement,
		private readonly service: ISurfaceFeatureChecklistService,
		private readonly onPlay?: (surfaceId?: string, stepId?: string) => void,
		commonActions: readonly SurfaceCommonActionItem[] = [],
		private readonly onCommonAction?: (actionId: string) => void,
	) {
		super();
		this.commonActions = commonActions;

		this.emptyEl = $('div.custom-mode-surface-actions-empty', undefined, localize('surfaceActions.empty', 'No workflow actions yet'));
		this.listEl = $('div.custom-mode-surface-actions-list');
		this.root.appendChild($('div.custom-mode-surface-actions', undefined, this.emptyEl, this.listEl));

		this._register(this.service.onDidChangeState(state => this.render(state)));
		this._register(toDisposable(() => this.root.replaceChildren()));

		this.render(this.service.getState());
		void this.service.refresh();
	}

	private render(state: SurfaceFeatureChecklistState): void {
		this.renderActions(state.actions);
	}

	private renderActions(actions: readonly SurfaceWorkflowActionItem[]): void {
		this.actionListeners.clear();
		this.listEl.replaceChildren();
		const hasCommon = this.commonActions.length > 0;
		const hasWorkflow = actions.length > 0;
		if (!hasCommon && !hasWorkflow) {
			this.emptyEl.classList.remove('hidden');
			this.listEl.classList.add('hidden');
			return;
		}
		this.emptyEl.classList.add('hidden');
		this.listEl.classList.remove('hidden');

		if (hasCommon) {
			if (hasWorkflow) {
				this.listEl.appendChild($('div.custom-mode-surface-actions-section-title', undefined, localize('surfaceActions.commonTitle', 'Common')));
			}
			for (const action of this.commonActions) {
				const button = $('button.custom-mode-surface-actions-action', {
					type: 'button',
					title: action.title ?? action.label,
					'data-action-id': action.id,
				}, action.label) as HTMLButtonElement;
				this.actionListeners.add(addDisposableListener(button, 'click', () => this.onCommonAction?.(action.id)));
				this.listEl.appendChild(button);
			}
		}

		if (hasWorkflow) {
			if (hasCommon) {
				this.listEl.appendChild($('div.custom-mode-surface-actions-section-title', undefined, localize('surfaceActions.workflowTitle', 'Workflow')));
			}
			for (const action of actions) {
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
}

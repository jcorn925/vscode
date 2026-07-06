/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ISurfaceFeatureChecklistService } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistService.js';
import type { SurfaceFeatureCheckCategory, SurfaceFeatureCheckItem, SurfaceFeatureChecklistState, SurfaceFeatureCheckStatus, SurfaceWorkflowActionItem } from '../../../../../custom/goalWorkspace/surfaceFeatureChecklistTypes.js';

const CATEGORY_ORDER: readonly SurfaceFeatureCheckCategory[] = ['workspace', 'builder', 'blueprint', 'verification', 'agent'];

const CATEGORY_LABELS: Record<SurfaceFeatureCheckCategory, string> = {
	workspace: localize('surfaceFeatureChecklist.category.workspace', 'Workspace'),
	builder: localize('surfaceFeatureChecklist.category.builder', 'Guided builder'),
	blueprint: localize('surfaceFeatureChecklist.category.blueprint', 'Blueprint pipeline'),
	verification: localize('surfaceFeatureChecklist.category.verification', 'Verification'),
	agent: localize('surfaceFeatureChecklist.category.agent', 'Agent handoff'),
};

export class SurfaceFeatureChecklistPanel extends Disposable {
	private readonly summaryEl: HTMLElement;
	private readonly actionsEl: HTMLElement;
	private readonly listEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly playButton: HTMLButtonElement;
	private collapsed = false;

	constructor(
		private readonly root: HTMLElement,
		private readonly service: ISurfaceFeatureChecklistService,
		private readonly onPlay?: (surfaceId?: string, stepId?: string) => void,
	) {
		super();

		const header = $('div.custom-mode-surface-feature-checklist-header');
		const titleBlock = $('div.custom-mode-surface-feature-checklist-title-block', undefined,
			$('div.custom-mode-surface-feature-checklist-title', undefined, localize('surfaceFeatureChecklist.title', 'Surface features')),
			$('div.custom-mode-surface-feature-checklist-subtitle', undefined, localize('surfaceFeatureChecklist.subtitle', 'Platform and workspace readiness for surface creation.')),
		);
		this.summaryEl = $('div.custom-mode-surface-feature-checklist-summary');
		this.actionsEl = $('div.custom-mode-surface-feature-checklist-actions');
		const toggleButton = $('button.custom-mode-surface-feature-checklist-toggle', {
			type: 'button',
			'aria-label': localize('surfaceFeatureChecklist.collapse', 'Collapse checklist'),
			title: localize('surfaceFeatureChecklist.collapse', 'Collapse checklist'),
		}, '\u2212') as HTMLButtonElement;
		this.refreshButton = $('button.custom-mode-surface-feature-checklist-refresh', {
			type: 'button',
			title: localize('surfaceFeatureChecklist.refresh', 'Refresh'),
			'aria-label': localize('surfaceFeatureChecklist.refresh', 'Refresh'),
		}, localize('surfaceFeatureChecklist.refreshShort', 'Refresh')) as HTMLButtonElement;
		this.playButton = $('button.custom-mode-surface-feature-checklist-play', {
			type: 'button',
			title: localize('surfaceFeatureChecklist.play', 'Play'),
			'aria-label': localize('surfaceFeatureChecklist.play', 'Play'),
		}, localize('surfaceFeatureChecklist.playShort', 'Play')) as HTMLButtonElement;
		header.appendChild(titleBlock);
		header.appendChild($('div.custom-mode-surface-feature-checklist-header-actions', undefined, this.refreshButton, this.playButton, toggleButton));

		this.listEl = $('div.custom-mode-surface-feature-checklist-list');
		this.root.appendChild($('div.custom-mode-surface-feature-checklist', undefined, header, this.summaryEl, this.actionsEl, this.listEl));

		this._register(addDisposableListener(this.refreshButton, 'click', () => void this.service.refresh()));
		this._register(addDisposableListener(this.playButton, 'click', () => this.onPlay?.()));
		this._register(addDisposableListener(toggleButton, 'click', () => {
			this.collapsed = !this.collapsed;
			this.root.classList.toggle('custom-mode-surface-feature-checklist-collapsed', this.collapsed);
			toggleButton.textContent = this.collapsed ? '+' : '\u2212';
			const label = this.collapsed
				? localize('surfaceFeatureChecklist.expand', 'Expand checklist')
				: localize('surfaceFeatureChecklist.collapse', 'Collapse checklist');
			toggleButton.setAttribute('aria-label', label);
			toggleButton.title = label;
		}));
		this._register(this.service.onDidChangeState(state => this.render(state)));
		this._register(toDisposable(() => this.root.replaceChildren()));

		this.render(this.service.getState());
		void this.service.refresh();
	}

	private render(state: SurfaceFeatureChecklistState): void {
		this.refreshButton.disabled = state.isRefreshing;
		this.playButton.disabled = state.isRefreshing;
		this.summaryEl.textContent = localize(
			'surfaceFeatureChecklist.summary',
			'{0}/{1} checks passing',
			String(state.readyCount),
			String(state.totalCount),
		);
		this.renderActions(state.actions);

		this.listEl.replaceChildren();
		for (const category of CATEGORY_ORDER) {
			const items = state.items.filter(item => item.category === category);
			if (items.length === 0) {
				continue;
			}
			const section = $('section.custom-mode-surface-feature-checklist-section', { 'data-category': category },
				$('div.custom-mode-surface-feature-checklist-section-title', undefined, CATEGORY_LABELS[category]),
			);
			for (const item of items) {
				section.appendChild(this.renderItem(item));
			}
			this.listEl.appendChild(section);
		}
	}

	private renderActions(actions: readonly SurfaceWorkflowActionItem[]): void {
		this.actionsEl.replaceChildren();
		if (actions.length === 0) {
			this.actionsEl.classList.add('hidden');
			return;
		}
		this.actionsEl.classList.remove('hidden');
		const title = $('div.custom-mode-surface-feature-checklist-section-title', undefined, localize('surfaceFeatureChecklist.actionsTitle', 'Workflow actions'));
		this.actionsEl.appendChild(title);
		const list = $('div.custom-mode-surface-feature-checklist-actions-list');
		for (const action of actions) {
			const button = $('button.custom-mode-surface-feature-checklist-action', {
				type: 'button',
				title: `${action.workflowLabel} • ${action.stepLabel}`,
				'data-surface-id': action.surfaceId,
				'data-step-id': action.stepId,
			}, `${action.surfaceId}: ${action.stepLabel}`) as HTMLButtonElement;
			this._register(addDisposableListener(button, 'click', () => this.onPlay?.(action.surfaceId, action.stepId)));
			list.appendChild(button);
		}
		this.actionsEl.appendChild(list);
	}

	private renderItem(item: SurfaceFeatureCheckItem): HTMLElement {
		const row = $('div.custom-mode-surface-feature-checklist-item');
		row.classList.add(`custom-mode-surface-feature-checklist-item-${item.status}`);
		row.title = item.detail ? `${item.description}\n\n${item.detail}` : item.description;
		row.appendChild($('span.custom-mode-surface-feature-checklist-glyph', undefined, this.statusGlyph(item.status)));
		row.appendChild($('div.custom-mode-surface-feature-checklist-item-text', undefined,
			$('div.custom-mode-surface-feature-checklist-item-label', undefined, item.label),
			$('div.custom-mode-surface-feature-checklist-item-detail', undefined, item.detail || item.description),
		));
		return row;
	}

	private statusGlyph(status: SurfaceFeatureCheckStatus): string {
		switch (status) {
			case 'success': return '\u2713';
			case 'error': return '\u2717';
			case 'warning': return '!';
			case 'running': return '\u25D4';
			case 'skipped': return '\u2014';
			default: return '\u25CB';
		}
	}
}

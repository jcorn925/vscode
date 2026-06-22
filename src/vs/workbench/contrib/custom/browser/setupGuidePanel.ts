/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import type { SetupGuideController, SetupGuideState, SetupGuideStepSnapshot, SetupGuideStepStatus } from '../../../../../custom/setup/setupGuideTypes.js';

export interface SetupGuidePanelOptions {
	readonly title: string;
	readonly subtitle: string;
}

export class SetupGuidePanel extends Disposable {
	private readonly overlay: HTMLElement;
	private readonly dialog: HTMLElement;
	private readonly stepsContainer: HTMLElement;
	private readonly summaryEl: HTMLElement;
	private readonly autoFixButton: HTMLButtonElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly closeButton: HTMLButtonElement;
	private readonly dismissButton: HTMLButtonElement;
	private visible = false;
	private userDismissedSession = false;

	constructor(
		private readonly parent: HTMLElement,
		private readonly controller: SetupGuideController,
		options: SetupGuidePanelOptions,
	) {
		super();

		this.overlay = $('div.custom-mode-startup-guide-overlay.hidden');
		this.dialog = $('div.custom-mode-startup-guide-dialog');
		const header = $('div.custom-mode-startup-guide-header', undefined,
			$('div.custom-mode-startup-guide-title', undefined, options.title),
			$('div.custom-mode-startup-guide-subtitle', undefined, options.subtitle),
		);
		this.summaryEl = $('div.custom-mode-startup-guide-summary');
		this.stepsContainer = $('div.custom-mode-startup-guide-steps');
		const footer = $('div.custom-mode-startup-guide-footer');
		this.autoFixButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('setupGuide.runAutomatic', 'Run automatic fixes')) as HTMLButtonElement;
		this.refreshButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('setupGuide.refresh', 'Refresh')) as HTMLButtonElement;
		this.dismissButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('setupGuide.dismiss', "Don't show again")) as HTMLButtonElement;
		this.closeButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('setupGuide.close', 'Close')) as HTMLButtonElement;
		footer.appendChild(this.autoFixButton);
		footer.appendChild(this.refreshButton);
		footer.appendChild(this.dismissButton);
		footer.appendChild(this.closeButton);
		this.dialog.appendChild(header);
		this.dialog.appendChild(this.summaryEl);
		this.dialog.appendChild(this.stepsContainer);
		this.dialog.appendChild(footer);
		this.overlay.appendChild(this.dialog);
		this.parent.appendChild(this.overlay);

		this._register(addDisposableListener(this.overlay, 'click', e => {
			if (e.target === this.overlay) {
				this.hide();
			}
		}));
		this._register(addDisposableListener(this.stepsContainer, 'click', e => {
			const target = (e.target as HTMLElement | null)?.closest('[data-step-action]') as HTMLElement | null;
			if (!target) {
				return;
			}
			const action = target.getAttribute('data-step-action');
			if (!action) {
				return;
			}
			if (action.startsWith('extra:')) {
				void this.controller.runExtraAction?.(action.slice('extra:'.length));
				return;
			}
			void this.controller.runStepFix(action);
		}));
		this._register(addDisposableListener(this.autoFixButton, 'click', () => void this.controller.runAutomaticFixes()));
		this._register(addDisposableListener(this.refreshButton, 'click', () => void this.controller.refresh()));
		this._register(addDisposableListener(this.dismissButton, 'click', () => {
			this.controller.markDismissed();
			this.userDismissedSession = true;
			this.hide();
		}));
		this._register(addDisposableListener(this.closeButton, 'click', () => this.hide()));
		this._register(this.controller.onDidChangeState(state => this.onStateChanged(state)));
		this._register(toDisposable(() => this.overlay.remove()));

		this.render(this.controller.getState());
	}

	show(): void {
		if (isWeb || this.userDismissedSession) {
			return;
		}
		const wasVisible = this.visible;
		this.visible = true;
		this.overlay.classList.remove('hidden');
		// Only probe on first open; refresh() fires state → syncTabGuides → show() caused an OOM loop.
		if (!wasVisible) {
			void this.controller.refresh();
		}
	}

	hide(): void {
		this.visible = false;
		this.overlay.classList.add('hidden');
	}

	isVisible(): boolean {
		return this.visible;
	}

	syncForTab(active: boolean): void {
		if (!active) {
			this.hide();
			return;
		}
		if (this.controller.shouldShow() && !this.userDismissedSession) {
			this.show();
		} else {
			this.hide();
		}
	}

	private onStateChanged(state: SetupGuideState): void {
		this.render(state);
		if (this.visible && state.incompleteCount === 0) {
			this.hide();
		}
	}

	private render(state: SetupGuideState): void {
		this.updateControls(state);
		this.summaryEl.textContent = state.incompleteCount > 0
			? localize('setupGuide.summaryIncomplete', '{0} step(s) still need attention.', String(state.incompleteCount))
			: localize('setupGuide.summaryComplete', 'All steps look good.');
		this.stepsContainer.replaceChildren();
		for (const step of state.steps) {
			this.stepsContainer.appendChild(this.renderStep(step));
		}
	}

	private updateControls(state: SetupGuideState): void {
		const busy = state.isRefreshing || state.isAutoFixRunning;
		this.autoFixButton.disabled = busy;
		this.refreshButton.disabled = busy;
		this.autoFixButton.textContent = state.isAutoFixRunning
			? localize('setupGuide.runningAutomatic', 'Running automatic fixes…')
			: localize('setupGuide.runAutomatic', 'Run automatic fixes');
	}

	private renderStep(step: SetupGuideStepSnapshot): HTMLElement {
		const card = $('div.custom-mode-startup-guide-step');
		card.classList.add(`custom-mode-startup-guide-step-${step.status}`);
		const head = $('div.custom-mode-startup-guide-step-head', undefined,
			$('span.custom-mode-startup-guide-step-glyph', undefined, this.statusGlyph(step.status)),
			$('div.custom-mode-startup-guide-step-text', undefined,
				$('div.custom-mode-startup-guide-step-label', undefined, step.label),
				$('div.custom-mode-startup-guide-step-description', undefined, step.description),
			),
		);
		card.appendChild(head);
		if (step.detail) {
			card.appendChild($('div.custom-mode-startup-guide-step-detail', undefined, step.detail));
		}
		const actions = $('div.custom-mode-startup-guide-step-actions');
		if (step.canAutoFix && step.autoFixLabel && step.status !== 'success' && step.status !== 'skipped') {
			actions.appendChild($('button.custom-mode-process-ix-button', {
				type: 'button',
				'data-step-action': step.id,
			}, step.autoFixLabel));
		}
		for (const extra of step.extraActions ?? []) {
			actions.appendChild($('button.custom-mode-process-ix-button', {
				type: 'button',
				'data-step-action': `extra:${extra.id}`,
			}, extra.label));
		}
		if (step.manualHint) {
			const details = document.createElement('details');
			const summary = document.createElement('summary');
			summary.textContent = localize('setupGuide.manualInstructions', 'Manual instructions');
			const pre = document.createElement('pre');
			pre.className = 'custom-mode-startup-guide-step-manual';
			pre.textContent = step.manualHint;
			details.appendChild(summary);
			details.appendChild(pre);
			actions.appendChild(details);
		}
		if (actions.childElementCount > 0) {
			card.appendChild(actions);
		}
		return card;
	}

	private statusGlyph(status: SetupGuideStepStatus): string {
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

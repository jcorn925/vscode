/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IStartupGuideService, type StartupGuideState, type StartupGuideStepId, type StartupGuideStepSnapshot, type StartupGuideStepStatus } from '../../../../../custom/startup/StartupGuideService.js';

export class StartupGuidePanel extends Disposable {
	private readonly overlay: HTMLElement;
	private readonly dialog: HTMLElement;
	private readonly stepsContainer: HTMLElement;
	private readonly summaryEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly autoFixButton: HTMLButtonElement;
	private readonly closeButton: HTMLButtonElement;
	private readonly dismissButton: HTMLButtonElement;
	private visible = false;

	constructor(
		private readonly parent: HTMLElement,
		private readonly startupGuideService: IStartupGuideService,
	) {
		super();

		this.overlay = $('div.custom-mode-startup-guide-overlay.hidden');
		this.dialog = $('div.custom-mode-startup-guide-dialog');
		const header = $('div.custom-mode-startup-guide-header', undefined,
			$('div.custom-mode-startup-guide-title', undefined, localize('startupGuide.title', 'Startup setup')),
			$('div.custom-mode-startup-guide-subtitle', undefined, localize('startupGuide.subtitle', 'Complete these steps to use Process mode, Ix, and the default project.')),
		);
		this.summaryEl = $('div.custom-mode-startup-guide-summary');
		this.stepsContainer = $('div.custom-mode-startup-guide-steps');
		const footer = $('div.custom-mode-startup-guide-footer');
		this.autoFixButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('startupGuide.runAutomatic', 'Run automatic fixes')) as HTMLButtonElement;
		this.refreshButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('startupGuide.refresh', 'Refresh')) as HTMLButtonElement;
		this.dismissButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('startupGuide.dismiss', "Don't show again")) as HTMLButtonElement;
		this.closeButton = $('button.custom-mode-process-ix-button', { type: 'button' }, localize('startupGuide.close', 'Close')) as HTMLButtonElement;
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
			if (action === 'homebrew-terminal') {
				void this.startupGuideService.openHomebrewInstallTerminal();
				return;
			}
			if (action) {
				void this.startupGuideService.runStepFix(action as StartupGuideStepId);
			}
		}));
		this._register(addDisposableListener(this.autoFixButton, 'click', () => void this.startupGuideService.runAutomaticFixes()));
		this._register(addDisposableListener(this.refreshButton, 'click', () => void this.startupGuideService.refresh()));
		this._register(addDisposableListener(this.dismissButton, 'click', () => {
			this.startupGuideService.markDismissed();
			this.hide();
		}));
		this._register(addDisposableListener(this.closeButton, 'click', () => this.hide()));
		this._register(this.startupGuideService.onDidChangeState(state => this.render(state)));
		this._register(toDisposable(() => this.overlay.remove()));

		this.render(this.startupGuideService.getState());
	}

	show(): void {
		if (isWeb) {
			return;
		}
		this.visible = true;
		this.overlay.classList.remove('hidden');
		void this.startupGuideService.refresh();
	}

	hide(): void {
		this.visible = false;
		this.overlay.classList.add('hidden');
	}

	toggle(): void {
		if (this.visible) {
			this.hide();
		} else {
			this.show();
		}
	}

	isVisible(): boolean {
		return this.visible;
	}

	updateBadge(button: HTMLButtonElement): void {
		const incomplete = this.startupGuideService.getState().incompleteCount;
		button.classList.toggle('custom-mode-startup-guide-btn-attention', incomplete > 0);
		button.title = incomplete > 0
			? localize('startupGuide.openWithCount', 'Startup setup ({0} steps remaining)', String(incomplete))
			: localize('startupGuide.openComplete', 'Startup setup (complete)');
	}

	private render(state: StartupGuideState): void {
		this.updateControls(state);
		this.summaryEl.textContent = state.incompleteCount > 0
			? localize('startupGuide.summaryIncomplete', '{0} step(s) still need attention.', String(state.incompleteCount))
			: localize('startupGuide.summaryComplete', 'All startup steps look good.');
		this.stepsContainer.replaceChildren();
		for (const step of state.steps) {
			this.stepsContainer.appendChild(this.renderStep(step));
		}
	}

	private updateControls(state: StartupGuideState): void {
		const busy = state.isRefreshing || state.isAutoFixRunning;
		this.autoFixButton.disabled = busy;
		this.refreshButton.disabled = busy;
		this.autoFixButton.textContent = state.isAutoFixRunning
			? localize('startupGuide.runningAutomatic', 'Running automatic fixes…')
			: localize('startupGuide.runAutomatic', 'Run automatic fixes');
	}

	private renderStep(step: StartupGuideStepSnapshot): HTMLElement {
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
		if (step.id === 'homebrew' && step.status !== 'success' && step.status !== 'skipped') {
			actions.appendChild($('button.custom-mode-process-ix-button', {
				type: 'button',
				'data-step-action': 'homebrew-terminal',
			}, localize('startupGuide.homebrew.openTerminal', 'Open PATH + Ix install in Terminal')));
		}
		if (step.manualHint) {
			const details = document.createElement('details');
			const summary = document.createElement('summary');
			summary.textContent = localize('startupGuide.manualInstructions', 'Manual instructions');
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

	private statusGlyph(status: StartupGuideStepStatus): string {
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

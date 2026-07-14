/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { computeTaskTreeProgress, findRetryableLeaf, type IAgentTaskTreeService } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import type { AgentTaskNode, AgentTaskTree } from '../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import { formatNodeDetail, isRetryableLeaf, statusIconClass } from '../../../../../custom/agentTaskTree/surfaceTaskTreeUiHelpers.js';

/** Details longer than this are collapsed behind a "Show more" toggle (progressive disclosure). */
const DETAIL_COLLAPSE_THRESHOLD = 180;

export class SurfaceTaskTreePanel extends Disposable {
	private readonly headerEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly progressBarEl: HTMLElement;
	private readonly progressLabelEl: HTMLElement;
	private readonly treeEl: HTMLElement;
	private readonly controlsEl: HTMLElement;
	private readonly messageEl: HTMLElement;
	private readonly resumeButton: HTMLButtonElement;
	private readonly continueButton: HTMLButtonElement;
	private readonly runAllButton: HTMLButtonElement;
	private readonly pauseButton: HTMLButtonElement;
	private readonly retryButton: HTMLButtonElement;
	private readonly skipButton: HTMLButtonElement;
	private tree: AgentTaskTree | undefined;
	private busy = false;

	constructor(
		private readonly root: HTMLElement,
		private readonly service: IAgentTaskTreeService,
	) {
		super();

		this.headerEl = $('div.custom-mode-surface-task-tree-header');
		this.statusEl = $('div.custom-mode-surface-task-tree-status');
		const progressBlock = $('div.custom-mode-surface-task-tree-progress');
		this.progressBarEl = $('div.custom-mode-surface-task-tree-progress-bar');
		this.progressLabelEl = $('div.custom-mode-surface-task-tree-progress-label');
		progressBlock.appendChild(this.progressBarEl);
		progressBlock.appendChild(this.progressLabelEl);
		this.headerEl.appendChild(this.statusEl);
		this.headerEl.appendChild(progressBlock);

		this.treeEl = $('div.custom-mode-surface-task-tree-list');
		this.treeEl.setAttribute('role', 'tree');
		this.treeEl.setAttribute('aria-label', localize('surfaceTaskTree.treeLabel', 'Surface build plan tasks'));
		this.controlsEl = $('div.custom-mode-surface-task-tree-controls');
		this.continueButton = this.createControlButton(localize('surfaceTaskTree.continueNext', 'Continue Next'), true);
		this.runAllButton = this.createControlButton(localize('surfaceTaskTree.runAll', 'Run All'));
		this.resumeButton = this.createControlButton(localize('surfaceTaskTree.resume', 'Resume'));
		this.pauseButton = this.createControlButton(localize('surfaceTaskTree.pause', 'Pause'));
		this.retryButton = this.createControlButton(localize('surfaceTaskTree.retry', 'Retry'));
		this.skipButton = this.createControlButton(localize('surfaceTaskTree.skip', 'Skip'));
		this.controlsEl.appendChild(this.continueButton);
		this.controlsEl.appendChild(this.runAllButton);
		this.controlsEl.appendChild(this.resumeButton);
		this.controlsEl.appendChild(this.pauseButton);
		this.controlsEl.appendChild(this.retryButton);
		this.controlsEl.appendChild(this.skipButton);

		this.messageEl = $('div.custom-mode-surface-task-tree-message.hidden');
		this.messageEl.setAttribute('role', 'status');

		this.root.appendChild($('div.custom-mode-surface-task-tree', undefined, this.headerEl, this.treeEl, this.messageEl, this.controlsEl));

		this._register(addDisposableListener(this.resumeButton, 'click', () => void this.runControl(() => this.service.resumeTaskTree(this.requireTree().id))));
		this._register(addDisposableListener(this.continueButton, 'click', () => void this.runControl(async () => {
			await this.service.continueNextTask(this.requireTree().id);
		})));
		this._register(addDisposableListener(this.runAllButton, 'click', () => void this.runControl(async () => {
			await this.service.runAllTasks(this.requireTree().id);
		})));
		this._register(addDisposableListener(this.pauseButton, 'click', () => {
			if (this.busy) {
				void this.service.pauseTaskTree(this.requireTree().id);
				return;
			}
			void this.runControl(() => this.service.pauseTaskTree(this.requireTree().id));
		}));
		this._register(addDisposableListener(this.retryButton, 'click', () => void this.runRetryOrSkip('retry')));
		this._register(addDisposableListener(this.skipButton, 'click', () => void this.runRetryOrSkip('skip')));
		this._register(addDisposableListener(this.treeEl, 'click', event => {
			const target = event.target as HTMLElement | null;
			const button = target?.closest('button[data-task-action]') as HTMLButtonElement | null;
			if (!button || !this.tree || this.busy) {
				return;
			}
			const nodeId = button.getAttribute('data-node-id');
			const action = button.getAttribute('data-task-action');
			if (!nodeId || (action !== 'retry' && action !== 'skip')) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void this.runControl(async () => {
				if (action === 'retry') {
					await this.service.retryTask(this.tree!.id, nodeId);
				} else {
					await this.service.skipTask(this.tree!.id, nodeId, localize('surfaceTaskTree.skipLeafNote', 'Skipped from task tree view.'));
				}
			});
		}));
		this._register(toDisposable(() => this.root.replaceChildren()));
	}

	render(tree: AgentTaskTree | undefined): void {
		this.tree = tree;
		if (!tree) {
			this.statusEl.textContent = '';
			this.progressBarEl.style.width = '0%';
			this.progressLabelEl.textContent = '';
			this.treeEl.replaceChildren($('div.custom-mode-surface-task-tree-empty', undefined,
				localize('surfaceTaskTree.empty', 'No task tree for this surface yet.')));
			this.setControlsEnabled(false);
			return;
		}

		const progress = computeTaskTreeProgress(tree);
		this.statusEl.textContent = formatTreeStatusLabel(tree.status);
		this.statusEl.dataset.treeStatus = tree.status;
		this.progressBarEl.style.width = `${progress.percent}%`;
		this.progressLabelEl.textContent = localize(
			'surfaceTaskTree.progress',
			'{0}% complete ({1}/{2} tasks)',
			String(progress.percent),
			String(progress.completed),
			String(progress.total),
		);

		this.treeEl.replaceChildren();
		for (const root of tree.roots) {
			this.appendNode(root, 0, tree);
		}

		this.updateControlStates(tree);
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		if (this.tree) {
			this.updateControlStates(this.tree);
		}
	}

	private createControlButton(label: string, primary?: boolean): HTMLButtonElement {
		const className = primary
			? 'button.custom-mode-surface-task-tree-control.custom-mode-surface-task-tree-control-primary'
			: 'button.custom-mode-surface-task-tree-control';
		return $(className, { type: 'button' }, label) as HTMLButtonElement;
	}

	private appendNode(node: AgentTaskNode, depth: number, tree: AgentTaskTree): void {
		const isCurrent = tree.cursor?.currentNodeId === node.id;
		const icon = $(`span.custom-mode-surface-task-tree-node-icon.codicon.${statusIconClass(node.status)}`);
		icon.setAttribute('aria-hidden', 'true');
		icon.dataset.nodeStatus = node.status;
		const row = $('div.custom-mode-surface-task-tree-node', undefined,
			icon,
			$('span.custom-mode-surface-task-tree-node-title', undefined, node.title),
		);
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-label', `${node.title} (${node.status.replace(/_/g, ' ')})`);
		row.classList.toggle('custom-mode-surface-task-tree-node-current', isCurrent);
		row.classList.toggle(`custom-mode-surface-task-tree-node-${node.type}`, true);
		row.style.paddingLeft = `${depth * 16 + 8}px`;

		const detail = formatNodeDetail(node);
		if (detail) {
			row.appendChild(this.createDetailElement(detail));
		}

		if (node.type === 'leaf' && isRetryableLeaf(node)) {
			const inlineActions = $('div.custom-mode-surface-task-tree-node-actions');
			const retryBtn = $('button.custom-mode-surface-task-tree-inline-action', {
				type: 'button',
				'data-task-action': 'retry',
				'data-node-id': node.id,
				disabled: this.busy ? 'true' : undefined,
			}, localize('surfaceTaskTree.retryLeaf', 'Retry')) as HTMLButtonElement;
			const skipBtn = $('button.custom-mode-surface-task-tree-inline-action', {
				type: 'button',
				'data-task-action': 'skip',
				'data-node-id': node.id,
				disabled: this.busy ? 'true' : undefined,
			}, localize('surfaceTaskTree.skipLeaf', 'Skip')) as HTMLButtonElement;
			inlineActions.appendChild(retryBtn);
			inlineActions.appendChild(skipBtn);
			row.appendChild(inlineActions);
		}

		this.treeEl.appendChild(row);
		for (const child of node.children ?? []) {
			this.appendNode(child, depth + 1, tree);
		}
	}

	private createDetailElement(detail: string): HTMLElement {
		const container = $('div.custom-mode-surface-task-tree-node-detail');
		if (detail.length <= DETAIL_COLLAPSE_THRESHOLD) {
			container.textContent = detail;
			return container;
		}
		const text = $('span.custom-mode-surface-task-tree-node-detail-text', undefined, `${detail.slice(0, DETAIL_COLLAPSE_THRESHOLD).trimEnd()}…`);
		const toggle = $('button.custom-mode-surface-task-tree-detail-toggle', {
			type: 'button',
			'aria-expanded': 'false',
		}, localize('surfaceTaskTree.showMore', 'Show more')) as HTMLButtonElement;
		let expanded = false;
		this._register(addDisposableListener(toggle, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			expanded = !expanded;
			text.textContent = expanded ? detail : `${detail.slice(0, DETAIL_COLLAPSE_THRESHOLD).trimEnd()}…`;
			toggle.textContent = expanded
				? localize('surfaceTaskTree.showLess', 'Show less')
				: localize('surfaceTaskTree.showMore', 'Show more');
			toggle.setAttribute('aria-expanded', String(expanded));
		}));
		container.appendChild(text);
		container.appendChild(toggle);
		return container;
	}

	private updateControlStates(tree: AgentTaskTree): void {
		const retryable = findRetryableLeaf(tree);
		const hasPending = Boolean(this.service.findNextPendingLeaf(tree));
		this.resumeButton.disabled = this.busy || tree.status !== 'paused';
		this.continueButton.disabled = this.busy || (tree.status !== 'active' && tree.status !== 'paused') || !hasPending;
		this.runAllButton.disabled = this.busy || (tree.status !== 'active' && tree.status !== 'paused') || !hasPending;
		this.pauseButton.disabled = tree.status !== 'active';
		this.retryButton.disabled = this.busy || !retryable;
		this.skipButton.disabled = this.busy || !retryable;
	}

	private setControlsEnabled(enabled: boolean): void {
		for (const button of [this.resumeButton, this.continueButton, this.runAllButton, this.pauseButton, this.retryButton, this.skipButton]) {
			button.disabled = !enabled || this.busy;
		}
	}

	private requireTree(): AgentTaskTree {
		if (!this.tree) {
			throw new Error('No task tree is loaded.');
		}
		return this.tree;
	}

	private async runControl(action: () => Promise<void>): Promise<void> {
		if (this.busy) {
			return;
		}
		this.setBusy(true);
		this.setMessage(undefined);
		try {
			await action();
		} catch (error: unknown) {
			this.setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			this.setBusy(false);
		}
	}

	private setMessage(message: string | undefined): void {
		this.messageEl.textContent = message ?? '';
		this.messageEl.classList.toggle('hidden', !message);
	}

	private async runRetryOrSkip(mode: 'retry' | 'skip'): Promise<void> {
		const tree = this.tree;
		if (!tree || this.busy) {
			return;
		}
		const node = findRetryableLeaf(tree);
		if (!node) {
			return;
		}
		await this.runControl(async () => {
			if (mode === 'retry') {
				await this.service.retryTask(tree.id, node.id);
			} else {
				await this.service.skipTask(tree.id, node.id, localize('surfaceTaskTree.skipLeafNote', 'Skipped from task tree view.'));
			}
		});
	}
}

function formatTreeStatusLabel(status: AgentTaskTree['status']): string {
	switch (status) {
		case 'active': return localize('surfaceTaskTree.statusActive', 'Active');
		case 'paused': return localize('surfaceTaskTree.statusPaused', 'Paused');
		case 'complete': return localize('surfaceTaskTree.statusComplete', 'Complete');
		case 'failed': return localize('surfaceTaskTree.statusFailed', 'Failed');
		case 'draft':
		default: return localize('surfaceTaskTree.statusDraft', 'Draft');
	}
}

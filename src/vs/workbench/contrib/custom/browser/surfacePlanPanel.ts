/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode } from '../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { resolveSurfacePlanResource, surfacePlanResource } from '../../../../../custom/goalWorkspace/surfacePlanPaths.js';
import {
	parseSurfaceReferenceCandidates,
	referenceRepoLabel,
	selectedReferenceRepos,
	serializeSurfaceReferenceCandidates,
	surfaceReferenceCandidatesResource,
	withCandidatesStatus,
	withRepoSelection,
	type SurfaceReferenceCandidates,
	type SurfaceReferenceRepo,
} from '../../../../../custom/goalWorkspace/surfaceReferenceCandidates.js';

export interface SurfacePlanPanelLoadOptions {
	readonly surfaceId: string;
	readonly surfaceName?: string;
	readonly surfacePath?: string;
	readonly workspaceFolder: URI | undefined;
}

export interface SurfacePlanBuildRequest {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly intent: string;
}

export interface SurfacePlanReferenceSelectionConfirmed {
	readonly surfaceId: string;
	readonly selectedRepos: ReadonlyArray<{
		readonly owner: string;
		readonly repo: string;
		readonly url: string;
	}>;
}

export class SurfacePlanPanel extends Disposable {
	private readonly _onDidRequestBuild = this._register(new Emitter<SurfacePlanBuildRequest>());
	readonly onDidRequestBuild: Event<SurfacePlanBuildRequest> = this._onDidRequestBuild.event;

	private readonly _onDidConfirmReferenceSelection = this._register(new Emitter<SurfacePlanReferenceSelectionConfirmed>());
	readonly onDidConfirmReferenceSelection: Event<SurfacePlanReferenceSelectionConfirmed> = this._onDidConfirmReferenceSelection.event;

	private readonly titleEl: HTMLElement;
	private readonly pathEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly referencesEl: HTMLElement;
	private readonly bodyEl: HTMLElement;
	private readonly rendered = this._register(new MutableDisposable());
	private readonly watcher = this._register(new MutableDisposable());
	private readonly composeListeners = this._register(new MutableDisposable());
	private readonly referencesListeners = this._register(new MutableDisposable());
	private lastOptions: SurfacePlanPanelLoadOptions | undefined;
	private loadGeneration = 0;
	private candidates: SurfaceReferenceCandidates | undefined;
	private candidatesWriteInFlight = false;

	constructor(
		private readonly root: HTMLElement,
		private readonly fileService: IFileService,
	) {
		super();

		this.titleEl = $('div.custom-mode-surface-plan-title');
		this.pathEl = $('div.custom-mode-surface-plan-path');
		this.statusEl = $('div.custom-mode-surface-plan-status');
		this.refreshButton = $('button.custom-mode-surface-plan-refresh', {
			type: 'button',
		}, localize('surfacePlan.refresh', 'Refresh')) as HTMLButtonElement;
		const headerTop = $('div.custom-mode-surface-plan-header-top', undefined, this.titleEl, this.refreshButton);
		const header = $('div.custom-mode-surface-plan-header', undefined, headerTop, this.pathEl, this.statusEl);
		this.referencesEl = $('div.custom-mode-surface-plan-references.hidden');
		this.referencesEl.setAttribute('role', 'group');
		this.referencesEl.setAttribute('aria-label', localize('surfacePlan.referencesLabel', 'Reference repositories'));
		this.bodyEl = $('div.custom-mode-surface-plan-body');
		this.bodyEl.setAttribute('role', 'article');
		this.bodyEl.setAttribute('aria-label', localize('surfacePlan.bodyLabel', 'Surface plan'));
		this.root.appendChild($('div.custom-mode-surface-plan', undefined, header, this.referencesEl, this.bodyEl));

		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (this.lastOptions) {
				void this.load({ ...this.lastOptions });
			}
		}));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.renderEmpty(localize('surfacePlan.selectSurface', 'Select a surface to view its plan.md.'));
	}

	async load(options: SurfacePlanPanelLoadOptions): Promise<void> {
		this.lastOptions = options;
		const generation = ++this.loadGeneration;
		const { surfaceId, surfaceName, surfacePath, workspaceFolder } = options;
		this.titleEl.textContent = localize('surfacePlan.title', '{0} plan', surfaceName?.trim() || surfaceId);
		this.pathEl.textContent = '';
		this.statusEl.textContent = localize('surfacePlan.loading', 'Loading…');

		if (!workspaceFolder) {
			this.candidates = undefined;
			this.renderReferencesRow();
			this.renderEmpty(localize('surfacePlan.noWorkspace', 'Open a workspace folder to load plan.md.'));
			return;
		}

		this.watchPlanCandidates(workspaceFolder, surfaceId, surfacePath);
		await this.refreshReferenceCandidates(workspaceFolder, surfaceId, generation);
		if (generation !== this.loadGeneration) {
			return;
		}

		const resource = await resolveSurfacePlanResource(this.fileService, workspaceFolder, surfaceId, surfacePath);
		if (generation !== this.loadGeneration) {
			return;
		}

		if (!resource) {
			const expected = surfacePlanResource(workspaceFolder, surfaceId);
			this.pathEl.textContent = expected.path;
			this.statusEl.textContent = this.candidates?.status === 'awaiting_selection'
				? localize('surfacePlan.awaitingRepoSelection', 'Select reference repos')
				: localize('surfacePlan.awaitingPlan', 'No plan yet');
			this.renderBuildCompose(surfaceId, surfaceName?.trim() || surfaceId);
			return;
		}

		try {
			const content = await this.fileService.readFile(resource);
			if (generation !== this.loadGeneration) {
				return;
			}
			const text = content.value.toString();
			this.pathEl.textContent = resource.path;
			if (!text.trim()) {
				this.statusEl.textContent = this.candidates?.status === 'awaiting_selection'
					? localize('surfacePlan.awaitingRepoSelection', 'Select reference repos')
					: localize('surfacePlan.emptyPlan', 'Plan is empty');
				this.renderBuildCompose(surfaceId, surfaceName?.trim() || surfaceId);
				return;
			}
			this.statusEl.textContent = this.candidates?.status === 'awaiting_selection'
				? localize('surfacePlan.awaitingRepoSelection', 'Select reference repos')
				: localize('surfacePlan.ready', 'Plan loaded');
			this.renderMarkdown(text);
		} catch (error: unknown) {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.renderEmpty(localize(
				'surfacePlan.readFailed',
				'Could not read plan: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	private watchPlanCandidates(workspaceFolder: URI, surfaceId: string, surfacePath?: string): void {
		const store = new DisposableStore();
		this.watcher.value = store;
		try {
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent')));
			store.add(this.fileService.watch(joinPath(workspaceFolder, '.agent', 'surfaces')));
			store.add(this.fileService.watch(workspaceFolder));
			store.add(this.fileService.onDidFilesChange(e => {
				if (!this.lastOptions || this.lastOptions.surfaceId !== surfaceId || this.candidatesWriteInFlight) {
					return;
				}
				const candidatesUri = surfaceReferenceCandidatesResource(workspaceFolder, surfaceId);
				if (e.affects(candidatesUri)) {
					void this.refreshReferenceCandidates(workspaceFolder, surfaceId, this.loadGeneration);
					return;
				}
				const planCandidates = [
					surfacePlanResource(workspaceFolder, surfaceId),
					joinPath(workspaceFolder, 'plan.md'),
				];
				if (surfacePath) {
					planCandidates.push(joinPath(workspaceFolder, ...surfacePath.split('/').filter(Boolean), 'plan.md'));
				}
				if (planCandidates.some(uri => e.affects(uri))) {
					void this.load(this.lastOptions);
				}
			}));
		} catch {
			// Watching is best-effort.
		}
	}

	private async refreshReferenceCandidates(workspaceFolder: URI, surfaceId: string, generation: number): Promise<void> {
		const resource = surfaceReferenceCandidatesResource(workspaceFolder, surfaceId);
		try {
			const content = await this.fileService.readFile(resource);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.candidates = parseSurfaceReferenceCandidates(content.value.toString(), surfaceId);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.candidates = undefined;
		}
		this.renderReferencesRow();
	}

	private renderReferencesRow(): void {
		this.referencesListeners.clear();
		clearNode(this.referencesEl);
		const doc = this.candidates;
		if (!doc?.repos.length) {
			this.referencesEl.classList.add('hidden');
			return;
		}

		this.referencesEl.classList.remove('hidden');
		const store = new DisposableStore();
		this.referencesListeners.value = store;

		const awaiting = doc.status === 'awaiting_selection';
		const heading = $('div.custom-mode-surface-plan-references-heading', undefined,
			awaiting
				? localize('surfacePlan.referencesHeadingSelect', 'Found repos for Research context')
				: localize('surfacePlan.referencesHeading', 'Research context repos'));
		const hint = $('div.custom-mode-surface-plan-references-hint', undefined,
			awaiting
				? localize('surfacePlan.referencesHintSelect', 'Suggested repos are selected. Toggle any repo, then continue.')
				: localize('surfacePlan.referencesHintLocked', 'Claude will use the selected repos below.'));

		const chips = $('div.custom-mode-surface-plan-references-chips');
		for (const repo of doc.repos) {
			chips.appendChild(this.createRepoChip(repo, awaiting, store));
		}

		const children: HTMLElement[] = [heading, hint, chips];
		if (awaiting) {
			const confirm = $('button.custom-mode-surface-plan-references-confirm', {
				type: 'button',
			}, localize('surfacePlan.referencesConfirm', 'Use selected as context')) as HTMLButtonElement;
			confirm.disabled = selectedReferenceRepos(doc).length === 0;
			store.add(addDisposableListener(confirm, 'click', () => void this.confirmReferenceSelection()));
			children.push($('div.custom-mode-surface-plan-references-actions', undefined, confirm));
		}

		this.referencesEl.appendChild($('div.custom-mode-surface-plan-references-inner', undefined, ...children));
	}

	private createRepoChip(repo: SurfaceReferenceRepo, interactive: boolean, store: DisposableStore): HTMLElement {
		const label = referenceRepoLabel(repo);
		const chip = $('button.custom-mode-surface-plan-references-chip', {
			type: 'button',
			title: repo.description?.trim() || repo.url,
			'aria-pressed': repo.selected ? 'true' : 'false',
			'aria-label': localize('surfacePlan.referencesChipLabel', '{0}{1}', label, repo.suggested ? ' (suggested)' : ''),
		}) as HTMLButtonElement;
		chip.classList.toggle('selected', repo.selected);
		chip.classList.toggle('suggested', repo.suggested);
		chip.disabled = !interactive;

		const name = $('span.custom-mode-surface-plan-references-chip-name', undefined, label);
		chip.appendChild(name);
		if (repo.suggested) {
			chip.appendChild($('span.custom-mode-surface-plan-references-chip-badge', undefined,
				localize('surfacePlan.referencesSuggested', 'Suggested')));
		}
		if (typeof repo.stars === 'number') {
			chip.appendChild($('span.custom-mode-surface-plan-references-chip-meta', undefined,
				localize('surfacePlan.referencesStars', '{0}★', formatStars(repo.stars))));
		}

		if (interactive) {
			store.add(addDisposableListener(chip, 'click', () => {
				void this.toggleRepoSelection(repo.owner, repo.repo, !repo.selected);
			}));
		}
		return chip;
	}

	private async toggleRepoSelection(owner: string, repo: string, selected: boolean): Promise<void> {
		if (!this.candidates || this.candidates.status !== 'awaiting_selection' || !this.lastOptions?.workspaceFolder) {
			return;
		}
		const next = withRepoSelection(this.candidates, owner, repo, selected);
		await this.persistCandidates(next);
	}

	private async confirmReferenceSelection(): Promise<void> {
		if (!this.candidates || this.candidates.status !== 'awaiting_selection' || !this.lastOptions?.workspaceFolder) {
			return;
		}
		const selected = selectedReferenceRepos(this.candidates);
		if (!selected.length) {
			return;
		}
		const next = withCandidatesStatus(this.candidates, 'confirmed');
		await this.persistCandidates(next);
		this._onDidConfirmReferenceSelection.fire({
			surfaceId: next.surfaceId,
			selectedRepos: selected.map(item => ({
				owner: item.owner,
				repo: item.repo,
				url: item.url,
			})),
		});
	}

	private async persistCandidates(doc: SurfaceReferenceCandidates): Promise<void> {
		const workspaceFolder = this.lastOptions?.workspaceFolder;
		if (!workspaceFolder) {
			return;
		}
		this.candidates = doc;
		this.renderReferencesRow();
		const resource = surfaceReferenceCandidatesResource(workspaceFolder, doc.surfaceId);
		this.candidatesWriteInFlight = true;
		try {
			await this.fileService.writeFile(resource, VSBuffer.fromString(serializeSurfaceReferenceCandidates(doc)));
		} finally {
			this.candidatesWriteInFlight = false;
		}
	}

	private renderMarkdown(text: string): void {
		this.composeListeners.clear();
		this.rendered.clear();
		this.bodyEl.replaceChildren();
		const rendered = renderMarkdown(new MarkdownString(text, { supportThemeIcons: true, isTrusted: true }), {
			asyncRenderCallback: () => { /* layout handled by parent */ },
		});
		rendered.element.classList.add('custom-mode-surface-plan-markdown');
		this.bodyEl.appendChild(rendered.element);
		this.rendered.value = toDisposable(() => rendered.dispose());
	}

	private renderEmpty(message: string): void {
		this.composeListeners.clear();
		this.rendered.clear();
		this.statusEl.textContent = '';
		this.bodyEl.replaceChildren($('div.custom-mode-surface-plan-empty', undefined, message));
	}

	private renderBuildCompose(surfaceId: string, surfaceName: string): void {
		this.composeListeners.clear();
		this.rendered.clear();
		this.bodyEl.replaceChildren();

		const store = new DisposableStore();
		this.composeListeners.value = store;

		const heading = $('div.custom-mode-surface-plan-compose-heading', undefined,
			localize('surfacePlan.composeHeading', 'What do you want to Build?'));
		const hint = $('div.custom-mode-surface-plan-compose-hint', undefined,
			localize(
				'surfacePlan.composeHint',
				'Describe the surface for {0}. Claude Code will draft the plan and graph proposal — no app code yet.',
				surfaceName,
			));
		const input = $('textarea.custom-mode-surface-plan-compose-input', {
			rows: '4',
			placeholder: localize(
				'surfacePlan.composePlaceholder',
				'e.g. Patient support chat for a clinic — appointments, billing FAQs, escalate to a nurse…',
			),
		}) as HTMLTextAreaElement;
		input.setAttribute('aria-label', localize('surfacePlan.composeHeading', 'What do you want to Build?'));

		const submit = $('button.custom-mode-surface-plan-compose-submit', {
			type: 'button',
		}, localize('surfacePlan.composeSubmit', 'Ask Claude')) as HTMLButtonElement;

		const submitIntent = () => {
			const intent = input.value.trim();
			if (!intent) {
				input.focus();
				return;
			}
			submit.disabled = true;
			this._onDidRequestBuild.fire({ surfaceId, surfaceName, intent });
			// Re-enable after a beat so the user can refine and resend if needed.
			setTimeout(() => {
				if (!submit.isConnected) {
					return;
				}
				submit.disabled = false;
			}, 800);
		};

		store.add(addDisposableListener(submit, 'click', submitIntent));
		store.add(addDisposableListener(input, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				submitIntent();
			}
		}));

		const actions = $('div.custom-mode-surface-plan-compose-actions', undefined, submit);
		const form = $('div.custom-mode-surface-plan-compose', undefined, heading, hint, input, actions);
		this.bodyEl.appendChild(form);
		queueMicrotask(() => input.focus());
	}
}

function formatStars(stars: number): string {
	if (stars >= 1000) {
		const k = stars / 1000;
		return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
	}
	return String(Math.round(stars));
}

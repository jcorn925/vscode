/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { resolveSurfacePlanResource, surfacePlanResource } from '../../../../../custom/goalWorkspace/surfacePlanPaths.js';

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

export class SurfacePlanPanel extends Disposable {
	private readonly _onDidRequestBuild = this._register(new Emitter<SurfacePlanBuildRequest>());
	readonly onDidRequestBuild: Event<SurfacePlanBuildRequest> = this._onDidRequestBuild.event;

	private readonly titleEl: HTMLElement;
	private readonly pathEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly bodyEl: HTMLElement;
	private readonly rendered = this._register(new MutableDisposable());
	private readonly watcher = this._register(new MutableDisposable());
	private readonly composeListeners = this._register(new MutableDisposable());
	private lastOptions: SurfacePlanPanelLoadOptions | undefined;
	private loadGeneration = 0;

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
		this.bodyEl = $('div.custom-mode-surface-plan-body');
		this.bodyEl.setAttribute('role', 'article');
		this.bodyEl.setAttribute('aria-label', localize('surfacePlan.bodyLabel', 'Surface plan'));
		this.root.appendChild($('div.custom-mode-surface-plan', undefined, header, this.bodyEl));

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
			this.renderEmpty(localize('surfacePlan.noWorkspace', 'Open a workspace folder to load plan.md.'));
			return;
		}

		const resource = await resolveSurfacePlanResource(this.fileService, workspaceFolder, surfaceId, surfacePath);
		if (generation !== this.loadGeneration) {
			return;
		}

		this.watchPlanCandidates(workspaceFolder, surfaceId, surfacePath);

		if (!resource) {
			const expected = surfacePlanResource(workspaceFolder, surfaceId);
			this.pathEl.textContent = expected.path;
			this.statusEl.textContent = localize('surfacePlan.awaitingPlan', 'No plan yet');
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
				this.statusEl.textContent = localize('surfacePlan.emptyPlan', 'Plan is empty');
				this.renderBuildCompose(surfaceId, surfaceName?.trim() || surfaceId);
				return;
			}
			this.statusEl.textContent = localize('surfacePlan.ready', 'Plan loaded');
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
			store.add(this.fileService.watch(workspaceFolder));
			store.add(this.fileService.onDidFilesChange(e => {
				if (!this.lastOptions || this.lastOptions.surfaceId !== surfaceId) {
					return;
				}
				const candidates = [
					surfacePlanResource(workspaceFolder, surfaceId),
					joinPath(workspaceFolder, 'plan.md'),
				];
				if (surfacePath) {
					candidates.push(joinPath(workspaceFolder, ...surfacePath.split('/').filter(Boolean), 'plan.md'));
				}
				if (candidates.some(uri => e.affects(uri))) {
					void this.load(this.lastOptions);
				}
			}));
		} catch {
			// Watching is best-effort.
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

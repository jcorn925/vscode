/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';

export interface SurfaceClaudeMdPanelLoadOptions {
	readonly workspaceFolder: URI | undefined;
}

export class SurfaceClaudeMdPanel extends Disposable {
	private readonly titleEl: HTMLElement;
	private readonly pathEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly bodyEl: HTMLElement;
	private readonly rendered = this._register(new MutableDisposable());
	private readonly watcher = this._register(new MutableDisposable());
	private lastOptions: SurfaceClaudeMdPanelLoadOptions | undefined;
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
		}, localize('surfaceClaudeMd.refresh', 'Refresh')) as HTMLButtonElement;
		const headerTop = $('div.custom-mode-surface-plan-header-top', undefined, this.titleEl, this.refreshButton);
		const header = $('div.custom-mode-surface-plan-header', undefined, headerTop, this.pathEl, this.statusEl);
		this.bodyEl = $('div.custom-mode-surface-plan-body');
		this.bodyEl.setAttribute('role', 'article');
		this.bodyEl.setAttribute('aria-label', localize('surfaceClaudeMd.bodyLabel', 'CLAUDE.md'));
		this.root.appendChild($('div.custom-mode-surface-plan', undefined, header, this.bodyEl));

		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (this.lastOptions) {
				void this.load({ ...this.lastOptions });
			}
		}));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.titleEl.textContent = localize('surfaceClaudeMd.title', 'CLAUDE.md');
		this.renderEmpty(localize('surfaceClaudeMd.openWorkspace', 'Open a workspace folder to view CLAUDE.md.'));
	}

	async load(options: SurfaceClaudeMdPanelLoadOptions): Promise<void> {
		this.lastOptions = options;
		const generation = ++this.loadGeneration;
		const { workspaceFolder } = options;
		this.titleEl.textContent = localize('surfaceClaudeMd.title', 'CLAUDE.md');
		this.pathEl.textContent = '';
		this.statusEl.textContent = localize('surfaceClaudeMd.loading', 'Loading…');

		if (!workspaceFolder) {
			this.renderEmpty(localize('surfaceClaudeMd.openWorkspace', 'Open a workspace folder to view CLAUDE.md.'));
			return;
		}

		const resource = joinPath(workspaceFolder, 'CLAUDE.md');
		this.watchClaudeMd(workspaceFolder, resource);

		try {
			await this.fileService.stat(resource);
		} catch {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.pathEl.textContent = resource.path;
			this.renderEmpty(localize(
				'surfaceClaudeMd.missing',
				'No CLAUDE.md yet. Create a New Surface to seed process rules, or add CLAUDE.md at the workspace root.',
			));
			return;
		}

		try {
			const content = await this.fileService.readFile(resource);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.pathEl.textContent = resource.path;
			this.statusEl.textContent = localize('surfaceClaudeMd.ready', 'CLAUDE.md loaded');
			this.renderMarkdown(content.value.toString());
		} catch (error: unknown) {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.renderEmpty(localize(
				'surfaceClaudeMd.readFailed',
				'Could not read CLAUDE.md: {0}',
				String((error as Error)?.message ?? error),
			));
		}
	}

	private watchClaudeMd(workspaceFolder: URI, resource: URI): void {
		const store = new DisposableStore();
		this.watcher.value = store;
		try {
			store.add(this.fileService.watch(workspaceFolder));
			store.add(this.fileService.onDidFilesChange(e => {
				if (e.affects(resource) && this.lastOptions) {
					void this.load(this.lastOptions);
				}
			}));
		} catch {
			// Watching is best-effort.
		}
	}

	private renderMarkdown(text: string): void {
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
		this.rendered.clear();
		this.statusEl.textContent = '';
		this.bodyEl.replaceChildren($('div.custom-mode-surface-plan-empty', undefined, message));
	}
}

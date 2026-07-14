/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import type { WorkspaceSurface } from '../../../../../custom/goalWorkspace/ConsoleService.js';
import { discoverIxSubsystemRegions } from '../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import type { IxSubsystemRegion } from '../../../../../custom/goalWorkspace/surfaceIxMatch.js';
import { resolveSurfacePathForIx, scopeIxRegionsToSurface } from '../../../../../custom/goalWorkspace/surfaceIxScope.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';

export interface SurfaceIxSubsystemsPanelLoadOptions {
	readonly surface: WorkspaceSurface | undefined;
	readonly workspaceFolder: URI | undefined;
	readonly force?: boolean;
}

export class SurfaceIxSubsystemsPanel extends Disposable {
	private readonly headerEl: HTMLElement;
	private readonly titleEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly treeEl: HTMLElement;
	private readonly cache = new Map<string, readonly IxSubsystemRegion[]>();
	private lastOptions: SurfaceIxSubsystemsPanelLoadOptions | undefined;
	private loadGeneration = 0;

	constructor(
		private readonly root: HTMLElement,
		private readonly ixIntegrationService: IIxIntegrationService,
	) {
		super();

		this.headerEl = $('div.custom-mode-surface-ix-subsystems-header');
		this.titleEl = $('div.custom-mode-surface-ix-subsystems-title');
		this.statusEl = $('div.custom-mode-surface-ix-subsystems-status');
		this.refreshButton = $('button.custom-mode-surface-ix-subsystems-refresh', {
			type: 'button',
		}, localize('surfaceIxSubsystems.refresh', 'Refresh')) as HTMLButtonElement;
		const headerTop = $('div.custom-mode-surface-ix-subsystems-header-top', undefined, this.titleEl, this.refreshButton);
		this.headerEl.appendChild(headerTop);
		this.headerEl.appendChild(this.statusEl);

		this.treeEl = $('div.custom-mode-surface-ix-subsystems-list');
		this.treeEl.setAttribute('role', 'tree');
		this.treeEl.setAttribute('aria-label', localize('surfaceIxSubsystems.treeLabel', 'Ix subsystems for selected surface'));

		this.root.appendChild($('div.custom-mode-surface-ix-subsystems', undefined, this.headerEl, this.treeEl));

		this._register(addDisposableListener(this.refreshButton, 'click', () => {
			if (!this.lastOptions?.surface) {
				return;
			}
			void this.load({ ...this.lastOptions, force: true });
		}));
		this._register(toDisposable(() => this.root.replaceChildren()));
		this.renderEmpty(localize('surfaceIxSubsystems.noSurface', 'Select a surface to view Ix subsystems.'));
	}

	async load(options: SurfaceIxSubsystemsPanelLoadOptions): Promise<void> {
		const generation = ++this.loadGeneration;
		this.lastOptions = options;
		const { surface, workspaceFolder, force } = options;
		if (!surface) {
			this.cache.clear();
			this.setLoading(false);
			this.renderEmpty(localize('surfaceIxSubsystems.noSurface', 'Select a surface to view Ix subsystems.'));
			return;
		}
		if (!workspaceFolder) {
			this.setLoading(false);
			this.renderEmpty(localize('surfaceIxSubsystems.noWorkspace', 'Open a workspace folder to discover Ix subsystems.'));
			return;
		}

		const surfacePath = resolveSurfacePathForIx(surface);
		this.titleEl.textContent = `${surface.name} · ${surfacePath}`;

		if (!force && this.cache.has(surface.id)) {
			this.setLoading(false);
			this.renderRegions(this.cache.get(surface.id)!, surfacePath);
			return;
		}

		this.setLoading(true);
		this.statusEl.textContent = localize('surfaceIxSubsystems.loading', 'Discovering Ix subsystems…');
		this.treeEl.replaceChildren($('div.custom-mode-surface-ix-subsystems-empty', undefined,
			localize('surfaceIxSubsystems.loading', 'Discovering Ix subsystems…')));

		try {
			try {
				await this.ixIntegrationService.mapPath(workspaceFolder, surfacePath);
			} catch {
				// Mapping is best-effort; discovery may still return workspace-scoped regions.
			}
			if (generation !== this.loadGeneration) {
				return;
			}
			const regions = await discoverIxSubsystemRegions(this.ixIntegrationService, workspaceFolder);
			const scoped = scopeIxRegionsToSurface(regions, surface, surfacePath);
			this.cache.set(surface.id, scoped);
			if (generation === this.loadGeneration) {
				this.renderRegions(scoped, surfacePath);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.cache.delete(surface.id);
			if (generation === this.loadGeneration) {
				this.renderEmpty(localize(
					'surfaceIxSubsystems.failed',
					'Ix discovery failed: {0}',
					message,
				));
			}
		} finally {
			if (generation === this.loadGeneration) {
				this.setLoading(false);
			}
		}
	}

	clear(): void {
		this.loadGeneration++;
		this.lastOptions = undefined;
		this.cache.clear();
		this.renderEmpty(localize('surfaceIxSubsystems.noSurface', 'Select a surface to view Ix subsystems.'));
	}

	private setLoading(loading: boolean): void {
		this.refreshButton.disabled = loading;
	}

	private renderEmpty(message: string): void {
		this.titleEl.textContent = localize('surfaceIxSubsystems.titleFallback', 'Ix Subsystems');
		this.statusEl.textContent = '';
		this.treeEl.replaceChildren($('div.custom-mode-surface-ix-subsystems-empty', undefined, message));
	}

	private renderRegions(regions: readonly IxSubsystemRegion[], surfacePath: string): void {
		if (!regions.length) {
			this.statusEl.textContent = localize('surfaceIxSubsystems.noneFound', '0 subsystems under {0}', surfacePath);
			this.treeEl.replaceChildren($('div.custom-mode-surface-ix-subsystems-empty', undefined,
				localize(
					'surfaceIxSubsystems.emptyScoped',
					'No Ix subsystems matched this surface yet. Map the surface path or refresh after scaffold.',
				)));
			return;
		}

		const fileCount = regions.reduce((sum, region) => {
			const members = region.memberFiles?.length ?? (region.entryPath ? 1 : 0);
			return sum + (region.fileCount ?? members);
		}, 0);
		this.statusEl.textContent = localize(
			'surfaceIxSubsystems.summary',
			'{0} subsystems · {1} files',
			String(regions.length),
			String(fileCount),
		);

		this.treeEl.replaceChildren();
		for (const region of regions) {
			this.appendRegion(region);
		}
	}

	private appendRegion(region: IxSubsystemRegion): void {
		const meta = [
			region.fileCount !== undefined ? localize('surfaceIxSubsystems.fileCount', '{0} files', String(region.fileCount)) : undefined,
			region.entryPath,
		].filter(Boolean).join(' · ');
		const root = $('div.custom-mode-surface-ix-subsystems-node.custom-mode-surface-ix-subsystems-node-root', undefined,
			$('span.custom-mode-surface-ix-subsystems-node-icon.codicon.codicon-symbol-namespace'),
			$('span.custom-mode-surface-ix-subsystems-node-title', undefined, region.name),
		);
		root.setAttribute('role', 'treeitem');
		root.setAttribute('aria-label', region.name);
		if (meta) {
			root.appendChild($('div.custom-mode-surface-ix-subsystems-node-detail', undefined, meta));
		}
		this.treeEl.appendChild(root);

		const children = region.memberFiles?.length
			? [...region.memberFiles]
			: region.entryPath
				? [region.entryPath]
				: [];
		for (const filePath of children) {
			const child = $('div.custom-mode-surface-ix-subsystems-node.custom-mode-surface-ix-subsystems-node-file', undefined,
				$('span.custom-mode-surface-ix-subsystems-node-icon.codicon.codicon-file'),
				$('span.custom-mode-surface-ix-subsystems-node-title', undefined, filePath),
			);
			child.setAttribute('role', 'treeitem');
			child.style.paddingLeft = '24px';
			this.treeEl.appendChild(child);
		}
	}
}

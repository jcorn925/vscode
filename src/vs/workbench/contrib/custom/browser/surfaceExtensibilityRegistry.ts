/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Everything a registered surface view or action needs to know about the surface
 * it is shown for. Mirrors the payload the mode shell passes to its own panels.
 */
export interface ISurfaceContext {
	readonly surfaceId: string;
	readonly surfaceName?: string;
	readonly surfacePath?: string;
	readonly localUrl?: string;
	readonly taskTreeId?: string;
	readonly workspaceFolder?: URI;
}

/**
 * Renders the content of a registered surface view. Created lazily the first time
 * the view's rail card is activated; `load` re-fires whenever the selected surface
 * changes while the view is visible.
 */
export interface ISurfaceViewRenderer extends IDisposable {
	load(context: ISurfaceContext): void | Promise<void>;
}

/**
 * A content section for the surface main pane. Registered views appear as
 * `surfaceSection:{id}` cards in the rail alongside the built-in sections
 * (Plan, Rules, Preview, …) and own the main pane while selected.
 */
export interface ISurfaceViewDescriptor {
	/** Rail card id becomes `surfaceSection:${id}` — must not collide with built-in section ids. */
	readonly id: string;
	/** Localized rail card label. */
	readonly title: string;
	/** Rail card badge value; defaults to the shared "—" placeholder. */
	readonly railValue?: string;
	/** Sort order among registered views; registration order breaks ties. */
	readonly order?: number;
	/** Omit to show the view for every surface. */
	isApplicable?(context: ISurfaceContext): boolean;
	createRenderer(container: HTMLElement): ISurfaceViewRenderer;
}

/**
 * An entry in the surface Actions panel. Registered actions render as buttons
 * grouped by `group`, above the checklist-driven workflow actions.
 */
export interface ISurfaceActionDescriptor {
	readonly id: string;
	/** Localized button label. */
	readonly label: string;
	/** Localized hover tooltip; defaults to the label. */
	readonly tooltip?: string;
	/** Panel section the button renders under; defaults to the built-in Common group. */
	readonly group?: string;
	/** Sort order within the group; registration order breaks ties. */
	readonly order?: number;
	/** Omit to show the action even when no surface is selected. */
	isApplicable?(context: ISurfaceContext | undefined): boolean;
	run(context: ISurfaceContext | undefined): void | Promise<void>;
}

/** Group id registered actions fall into when they declare no `group` of their own. */
export const SURFACE_ACTION_GROUP_COMMON = 'common';

/**
 * Registration seam for surface views and actions. First-party contributions and
 * (later) manifest- or extension-driven contributions register here; the mode
 * shell and Actions panel render whatever is registered.
 */
export interface ISurfaceExtensibilityRegistry {
	/** Fired on register/deregister — consumers re-render from a full read. */
	readonly onDidChange: Event<void>;
	registerView(descriptor: ISurfaceViewDescriptor): IDisposable;
	registerAction(descriptor: ISurfaceActionDescriptor): IDisposable;
	/** Omit `context` to read every registered view without applicability filtering. */
	getViews(context?: ISurfaceContext): readonly ISurfaceViewDescriptor[];
	getActions(context: ISurfaceContext | undefined): readonly ISurfaceActionDescriptor[];
}

class SurfaceExtensibilityRegistryImpl extends Disposable implements ISurfaceExtensibilityRegistry {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly views = new Map<string, ISurfaceViewDescriptor>();
	private readonly actions = new Map<string, ISurfaceActionDescriptor>();

	registerView(descriptor: ISurfaceViewDescriptor): IDisposable {
		return this.registerInto(this.views, descriptor.id, descriptor, 'view');
	}

	registerAction(descriptor: ISurfaceActionDescriptor): IDisposable {
		return this.registerInto(this.actions, descriptor.id, descriptor, 'action');
	}

	getViews(context?: ISurfaceContext): readonly ISurfaceViewDescriptor[] {
		const views = [...this.views.values()];
		const applicable = context
			? views.filter(view => view.isApplicable?.(context) ?? true)
			: views;
		return sortByOrder(applicable);
	}

	getActions(context: ISurfaceContext | undefined): readonly ISurfaceActionDescriptor[] {
		return sortByOrder([...this.actions.values()].filter(action => action.isApplicable?.(context) ?? true));
	}

	private registerInto<T>(store: Map<string, T>, id: string, descriptor: T, kind: string): IDisposable {
		if (store.has(id)) {
			throw new Error(`Surface ${kind} '${id}' is already registered`);
		}
		store.set(id, descriptor);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (store.get(id) === descriptor) {
				store.delete(id);
				this._onDidChange.fire();
			}
		});
	}
}

function sortByOrder<T extends { readonly order?: number }>(descriptors: T[]): T[] {
	return descriptors.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Creates an isolated registry — for tests; production code uses {@link SurfaceExtensibilityRegistry}. */
export function createSurfaceExtensibilityRegistry(): ISurfaceExtensibilityRegistry & IDisposable {
	return new SurfaceExtensibilityRegistryImpl();
}

export const Extensions = {
	SurfaceExtensibility: 'babadaba.surfaceExtensibility',
};

export const SurfaceExtensibilityRegistry: ISurfaceExtensibilityRegistry = new SurfaceExtensibilityRegistryImpl();
Registry.add(Extensions.SurfaceExtensibility, SurfaceExtensibilityRegistry);

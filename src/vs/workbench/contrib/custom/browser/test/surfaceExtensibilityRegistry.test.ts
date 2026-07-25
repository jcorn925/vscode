/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createSurfaceExtensibilityRegistry, type ISurfaceContext, type ISurfaceViewRenderer } from '../surfaceExtensibilityRegistry.js';

suite('surfaceExtensibilityRegistry', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const renderer: ISurfaceViewRenderer = { load: () => { }, dispose: () => { } };

	function view(id: string, options?: { order?: number; isApplicable?: (context: ISurfaceContext) => boolean }) {
		return { id, title: id, ...options, createRenderer: () => renderer };
	}

	test('sorts by order then registration order and filters by applicability', () => {
		const registry = store.add(createSurfaceExtensibilityRegistry());
		store.add(registry.registerView(view('late', { order: 2 })));
		store.add(registry.registerView(view('early', { order: 1 })));
		store.add(registry.registerView(view('default-a')));
		store.add(registry.registerView(view('default-b')));
		store.add(registry.registerView(view('home-only', { order: 1, isApplicable: context => context.surfaceId === 'home' })));
		store.add(registry.registerAction({ id: 'b', label: 'b', order: 1, run: () => { } }));
		store.add(registry.registerAction({ id: 'a', label: 'a', run: () => { } }));
		store.add(registry.registerAction({ id: 'anywhere', label: 'anywhere', isApplicable: context => context === undefined, run: () => { } }));
		assert.deepStrictEqual(
			{
				viewsForHome: registry.getViews({ surfaceId: 'home' }).map(entry => entry.id),
				viewsForOther: registry.getViews({ surfaceId: 'other' }).map(entry => entry.id),
				allViews: registry.getViews().map(entry => entry.id),
				actionsNoContext: registry.getActions(undefined).map(entry => entry.id),
				actionsForHome: registry.getActions({ surfaceId: 'home' }).map(entry => entry.id),
			},
			{
				viewsForHome: ['default-a', 'default-b', 'early', 'home-only', 'late'],
				viewsForOther: ['default-a', 'default-b', 'early', 'late'],
				allViews: ['default-a', 'default-b', 'early', 'home-only', 'late'],
				actionsNoContext: ['a', 'anywhere', 'b'],
				actionsForHome: ['a', 'b'],
			},
		);
	});

	test('disposing a registration removes it and fires onDidChange', () => {
		const registry = store.add(createSurfaceExtensibilityRegistry());
		let changes = 0;
		store.add(registry.onDidChange(() => changes++));
		const registration = registry.registerView(view('a'));
		registration.dispose();
		registration.dispose();
		assert.deepStrictEqual(
			{ changes, views: registry.getViews().map(entry => entry.id) },
			{ changes: 2, views: [] },
		);
	});

	test('rejects duplicate ids per kind', () => {
		const registry = store.add(createSurfaceExtensibilityRegistry());
		store.add(registry.registerView(view('a')));
		store.add(registry.registerAction({ id: 'a', label: 'a', run: () => { } }));
		assert.throws(() => registry.registerView(view('a')));
		assert.throws(() => registry.registerAction({ id: 'a', label: 'a', run: () => { } }));
	});

});

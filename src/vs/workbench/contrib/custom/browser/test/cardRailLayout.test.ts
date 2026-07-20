/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	CARD_RAIL_DEFAULT_WIDTH,
	CARD_RAIL_MAX_WIDTH,
	CARD_RAIL_MIN_WIDTH,
	CARD_RAIL_STYLESHEET,
	cardRailItemsEqual,
	cardRailStructureEqual,
	clampCardRailWidth,
	createCardRailLayout,
} from '../cardRailLayout.js';

suite('cardRailLayout', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('renders 2-col card rail with content host and selection', () => {
		const selected: string[] = [];
		const content = document.createElement('div');
		content.textContent = 'body';
		const layout = createCardRailLayout({
			activeId: 'plan',
			cards: [
				{ id: 'plan', key: 'Plan', value: 'plan.md' },
				{ id: 'rules', key: 'Rules', value: 'CLAUDE.md' },
			],
			onSelect: id => selected.push(id),
			content,
		});

		assert.ok(layout.root.classList.contains('custom-mode-card-rail'));
		assert.strictEqual(layout.rail.querySelectorAll('button.custom-mode-card-rail-card').length, 2);
		assert.match(CARD_RAIL_STYLESHEET, /\.custom-mode-card-rail-cards\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
		assert.match(CARD_RAIL_STYLESHEET, /\.custom-mode-card-rail-assoc\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
		assert.ok(layout.rail.querySelector('button[data-card-id="plan"]')?.classList.contains('active'));
		assert.strictEqual(layout.contentHost.contains(content), true);

		const rules = layout.rail.querySelector('button[data-card-id="rules"]') as HTMLButtonElement;
		rules.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		assert.deepStrictEqual(selected, ['rules']);

		layout.setActiveId('rules');
		assert.ok(layout.rail.querySelector('button[data-card-id="rules"]')?.classList.contains('active'));
		assert.ok(!layout.rail.querySelector('button[data-card-id="plan"]')?.classList.contains('active'));

		layout.setActiveId('rules', ['plan']);
		assert.ok(layout.rail.querySelector('button[data-card-id="rules"]')?.classList.contains('active'));
		assert.ok(layout.rail.querySelector('button[data-card-id="plan"]')?.classList.contains('active'));

		layout.dispose();
	});

	test('href value opens via onOpenHref without selecting the card', () => {
		const selected: string[] = [];
		const opened: string[] = [];
		const layout = createCardRailLayout({
			activeId: 'preview',
			cards: [
				{ id: 'preview', key: 'Preview', value: 'localhost:3000', href: 'http://localhost:3000' },
				{ id: 'deployed', key: 'Deployed', value: 'cadre.vercel.app', href: 'https://cadre.vercel.app' },
			],
			onSelect: id => selected.push(id),
			onOpenHref: url => opened.push(url),
		});
		const link = layout.rail.querySelector(
			'button[data-card-id="deployed"] .custom-mode-card-rail-card-value.is-link',
		) as HTMLElement;
		assert.ok(link);
		assert.strictEqual(link.dataset.href, 'https://cadre.vercel.app');
		link.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		assert.deepStrictEqual(opened, ['https://cadre.vercel.app']);
		assert.deepStrictEqual(selected, []);
		layout.dispose();
	});

	test('revealLabel renders a labeled left-edge tab when collapsed', () => {
		const layout = createCardRailLayout({
			activeId: 'plan',
			cards: [{ id: 'plan', key: 'Plan', value: 'plan.md' }],
			onSelect: () => { },
			autoHideMs: 10,
			revealLabel: 'Console',
		});
		const reveal = layout.root.querySelector('.custom-mode-card-rail-reveal') as HTMLElement;
		assert.ok(reveal);
		assert.ok(reveal.classList.contains('has-label'));
		assert.strictEqual(reveal.textContent, 'Console');
		assert.strictEqual(reveal.getAttribute('aria-label'), 'Show Console');
		layout.dispose();
	});

	test('setCards is a no-op when items are unchanged', () => {
		const layout = createCardRailLayout({
			activeId: 'plan',
			cards: [{ id: 'plan', key: 'Plan', value: 'plan.md' }],
			onSelect: () => { },
		});
		const firstButton = layout.rail.querySelector('button.custom-mode-card-rail-card');
		layout.setCards([{ id: 'plan', key: 'Plan', value: 'plan.md' }]);
		assert.strictEqual(layout.rail.querySelector('button.custom-mode-card-rail-card'), firstButton);
		assert.ok(cardRailItemsEqual(
			[{ id: 'plan', key: 'Plan', value: 'plan.md' }],
			[{ id: 'plan', key: 'Plan', value: 'plan.md' }],
		));
		layout.dispose();
	});

	test('pendingAction renders a pulsing attention dot', () => {
		const layout = createCardRailLayout({
			activeId: 'surface:a',
			cards: [
				{ id: 'surface:a', key: 'Surface', value: 'Cadre', pendingAction: true },
				{ id: 'surface:b', key: 'Surface', value: 'Other' },
			],
			onSelect: () => { },
		});
		const pending = layout.rail.querySelector('button[data-card-id="surface:a"]');
		const idle = layout.rail.querySelector('button[data-card-id="surface:b"]');
		assert.ok(pending?.classList.contains('has-pending-action'));
		assert.ok(pending?.querySelector('.custom-mode-card-rail-card-pending-dot'));
		assert.ok(!idle?.classList.contains('has-pending-action'));
		assert.ok(!idle?.querySelector('.custom-mode-card-rail-card-pending-dot'));
		assert.ok(!cardRailItemsEqual(
			[{ id: 'surface:a', key: 'Surface', value: 'Cadre', pendingAction: true }],
			[{ id: 'surface:a', key: 'Surface', value: 'Cadre' }],
		));
		layout.dispose();
	});

	test('setCards patches values in place when structure is unchanged', () => {
		const layout = createCardRailLayout({
			activeId: 'surfaceSection:proposed',
			cards: [
				{ id: 'surface:a', key: 'Admin', value: '', progressPercent: 40 },
				{ id: 'surfaceSection:proposed', key: 'Proposed Graph', value: '—', assocGroup: 'surface:a' },
			],
			onSelect: () => { },
		});
		const before = layout.rail.querySelector('button[data-card-id="surfaceSection:proposed"]');
		assert.ok(before);
		layout.setCards([
			{ id: 'surface:a', key: 'Admin', value: '', progressPercent: 54 },
			{ id: 'surfaceSection:proposed', key: 'Proposed Graph', value: '67·20', assocGroup: 'surface:a' },
		]);
		const after = layout.rail.querySelector('button[data-card-id="surfaceSection:proposed"]');
		assert.strictEqual(after, before, 'button node must be preserved across value-only updates');
		assert.strictEqual(after?.querySelector('.custom-mode-card-rail-card-value')?.textContent, '67·20');
		assert.strictEqual(
			(layout.rail.querySelector('button[data-card-id="surface:a"] .custom-mode-card-rail-card-progress-bar') as HTMLElement | null)?.style.width,
			'54%',
		);
		assert.ok(cardRailStructureEqual(
			[{ id: 'surface:a', key: 'Admin', value: '' }],
			[{ id: 'surface:a', key: 'Admin', value: 'x' }],
		));
		assert.ok(!cardRailStructureEqual(
			[{ id: 'surface:a', key: 'Admin', value: '' }],
			[{ id: 'surface:b', key: 'Admin', value: '' }],
		));
		layout.dispose();
	});

	test('progressPercent renders a compact bar and percent label', () => {
		const layout = createCardRailLayout({
			activeId: 'surface:a',
			cards: [
				{ id: 'surface:a', key: 'Cadre Admin', value: '', progressPercent: 42 },
				{ id: 'surface:b', key: 'Cadre Bot', value: '', progressPercent: 100 },
			],
			onSelect: () => { },
		});
		const mid = layout.rail.querySelector('button[data-card-id="surface:a"]') as HTMLElement;
		const done = layout.rail.querySelector('button[data-card-id="surface:b"]') as HTMLElement;
		const midBar = mid.querySelector('.custom-mode-card-rail-card-progress-bar') as HTMLElement;
		const doneBar = done.querySelector('.custom-mode-card-rail-card-progress-bar') as HTMLElement;
		assert.ok(mid.querySelector('.custom-mode-card-rail-card-progress'));
		assert.strictEqual(mid.querySelector('.custom-mode-card-rail-card-progress-pct')?.textContent, '42%');
		assert.strictEqual(midBar.style.width, '42%');
		assert.ok(!midBar.classList.contains('is-complete'));
		assert.strictEqual(done.querySelector('.custom-mode-card-rail-card-progress-pct')?.textContent, '100%');
		assert.strictEqual(doneBar.style.width, '100%');
		assert.ok(doneBar.classList.contains('is-complete'));
		// Inline spans ignore width — stylesheet must force block so the fill paints.
		assert.match(CARD_RAIL_STYLESHEET, /\.custom-mode-card-rail-card-progress-bar\s*\{[^}]*display:\s*block/s);
		assert.ok(!cardRailItemsEqual(
			[{ id: 'surface:a', key: 'Cadre Admin', value: '', progressPercent: 42 }],
			[{ id: 'surface:a', key: 'Cadre Admin', value: '', progressPercent: 43 }],
		));
		layout.dispose();
	});

	test('groupLabel renders a section title above the group', () => {
		const layout = createCardRailLayout({
			activeId: 'describe',
			cards: [
				{ id: 'plan', key: 'Plan', value: 'workspace' },
				{
					id: 'describe',
					key: 'Describe',
					value: 'New app',
					groupLabel: 'New Surface',
				},
				{ id: 'import', key: 'Import', value: 'Repo' },
			],
			onSelect: () => { },
		});
		const label = layout.rail.querySelector('.custom-mode-card-rail-group-label');
		assert.ok(label);
		assert.strictEqual(label?.textContent, 'New Surface');
		layout.dispose();
	});

	test('assocGroup wraps associated section cards in an outline host', () => {
		const layout = createCardRailLayout({
			activeId: 'surfaceSection:plan',
			cards: [
				{ id: 'surface:a', key: 'Surface', value: 'Cadre' },
				{ id: 'surfaceSection:rules', key: 'Rules', value: 'CLAUDE.md', groupStart: true, assocGroup: 'surface:a' },
				{ id: 'surfaceSection:plan', key: 'Plan', value: 'plan.md', assocGroup: 'surface:a' },
			],
			onSelect: () => { },
		});
		const assoc = layout.rail.querySelector('.custom-mode-card-rail-assoc') as HTMLElement | null;
		assert.ok(assoc);
		assert.strictEqual(assoc?.dataset.assocGroup, 'surface:a');
		assert.strictEqual(assoc?.querySelectorAll('button.custom-mode-card-rail-card').length, 2);
		assert.ok(layout.rail.querySelector('button[data-card-id="surface:a"]'));
		assert.ok(!assoc?.contains(layout.rail.querySelector('button[data-card-id="surface:a"]')!));
		assert.ok(assoc?.querySelector('button[data-card-id="surfaceSection:plan"]')?.classList.contains('active'));
		layout.dispose();
	});

	test('assocGroup draws a stem from the parent card to the outlined group', async () => {
		const layout = createCardRailLayout({
			activeId: 'surfaceSection:plan',
			cards: [
				{ id: 'surface:a', key: 'Surface', value: 'Cadre' },
				{ id: 'surfaceSection:plan', key: 'Plan', value: 'plan.md', groupStart: true, assocGroup: 'surface:a' },
			],
			onSelect: () => { },
		});
		document.body.appendChild(layout.root);
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		const rect = (top: number, height: number, left: number, width: number): DOMRect => ({
			top,
			bottom: top + height,
			left,
			right: left + width,
			width,
			height,
			x: left,
			y: top,
			toJSON: () => ({}),
		});
		const owner = layout.rail.querySelector('button[data-card-id="surface:a"]') as HTMLElement;
		const assoc = layout.rail.querySelector('.custom-mode-card-rail-assoc') as HTMLElement;
		assert.ok(owner);
		assert.ok(assoc);
		layout.rail.getBoundingClientRect = () => rect(0, 200, 0, 220);
		owner.getBoundingClientRect = () => rect(8, 48, 16, 90);
		assoc.getBoundingClientRect = () => rect(80, 90, 16, 188);
		// Scroll handler re-runs connector layout against the mocked boxes.
		layout.rail.dispatchEvent(new Event('scroll'));
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		assert.ok(owner.classList.contains('assoc-owner'));
		assert.ok(layout.rail.querySelector('.custom-mode-card-rail-assoc-stem'));
		layout.dispose();
	});

	test('setLoading shows and hides a spinner row', () => {
		const layout = createCardRailLayout({
			activeId: 'plan',
			cards: [{ id: 'plan', key: 'Plan', value: 'plan.md' }],
			onSelect: () => { },
		});
		assert.strictEqual(layout.rail.querySelectorAll('.custom-mode-card-rail-loading').length, 0);
		layout.setLoading(true, 'Loading surface…');
		const loading = layout.rail.querySelector('.custom-mode-card-rail-loading');
		assert.ok(loading);
		assert.ok(loading?.textContent?.includes('Loading surface…'));
		assert.ok(loading?.querySelector('.codicon-loading.codicon-modifier-spin'));
		layout.setLoading(false);
		assert.strictEqual(layout.rail.querySelectorAll('.custom-mode-card-rail-loading').length, 0);
		layout.dispose();
	});

	test('setActiveId keeps parent and section selected together', () => {
		const layout = createCardRailLayout({
			activeId: 'consoleSection:workspacePlan',
			cards: [
				{ id: 'console', key: 'Console', value: 'home' },
				{ id: 'consoleSection:workspacePlan', key: 'Plan', value: 'workspace.plan' },
			],
			onSelect: () => { },
		});
		layout.setActiveId('consoleSection:workspacePlan', ['console']);
		assert.ok(layout.rail.querySelector('button[data-card-id="console"]')?.classList.contains('active'));
		assert.ok(layout.rail.querySelector('button[data-card-id="consoleSection:workspacePlan"]')?.classList.contains('active'));
		layout.setCards([
			{ id: 'console', key: 'Console', value: 'home' },
			{ id: 'consoleSection:workspacePlan', key: 'Plan', value: 'workspace.plan' },
			{ id: 'consoleSection:claudeMd', key: 'Rules', value: 'CLAUDE.md' },
		]);
		assert.ok(layout.rail.querySelector('button[data-card-id="console"]')?.classList.contains('active'));
		assert.ok(layout.rail.querySelector('button[data-card-id="consoleSection:workspacePlan"]')?.classList.contains('active'));
		layout.dispose();
	});

	test('sash resizes the card rail and notifies onWidthChange', () => {
		const widths: number[] = [];
		const layout = createCardRailLayout({
			activeId: 'plan',
			width: CARD_RAIL_DEFAULT_WIDTH,
			cards: [{ id: 'plan', key: 'Plan', value: 'plan.md' }],
			onSelect: () => { },
			onWidthChange: width => widths.push(width),
		});
		const sash = layout.root.querySelector('.custom-mode-card-rail-sash');
		assert.ok(sash);
		assert.strictEqual(layout.getWidth(), CARD_RAIL_DEFAULT_WIDTH);
		assert.strictEqual(layout.root.style.getPropertyValue('--custom-mode-card-rail-width'), `${CARD_RAIL_DEFAULT_WIDTH}px`);

		layout.setWidth(CARD_RAIL_MIN_WIDTH - 40);
		assert.strictEqual(layout.getWidth(), CARD_RAIL_MIN_WIDTH);
		assert.ok(layout.rail.classList.contains('narrow'));
		layout.setWidth(CARD_RAIL_MAX_WIDTH + 40);
		assert.strictEqual(layout.getWidth(), CARD_RAIL_MAX_WIDTH);
		assert.ok(!layout.rail.classList.contains('narrow'));
		assert.deepStrictEqual(clampCardRailWidth(12), CARD_RAIL_MIN_WIDTH);
		assert.ok(widths.includes(CARD_RAIL_MIN_WIDTH));
		assert.ok(widths.includes(CARD_RAIL_MAX_WIDTH));
		layout.dispose();
	});

	test('autoHideMs collapses after idle and reveals on left-edge pointermove', async () => {
		const layout = createCardRailLayout({
			cards: [{ id: 'plan', key: 'Plan', value: 'plan.md' }],
			onSelect: () => { },
			autoHideMs: 20,
		});
		assert.ok(layout.root.querySelector('.custom-mode-card-rail-reveal'));
		assert.ok(!layout.root.classList.contains('collapsed'));
		await new Promise<void>(resolve => setTimeout(resolve, 40));
		assert.ok(layout.root.classList.contains('collapsed'));
		layout.root.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 8, bubbles: true }));
		assert.ok(!layout.root.classList.contains('collapsed'));
		layout.rail.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
		await new Promise<void>(resolve => setTimeout(resolve, 40));
		assert.ok(layout.root.classList.contains('collapsed'));
		layout.rail.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
		assert.ok(!layout.root.classList.contains('collapsed'));
		layout.dispose();
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

/**
 * Shared left 2-col card rail + right content host — the single card column for the
 * Console workspace home and selected-surface views.
 *
 * DOM:
 * ```
 * .custom-mode-card-rail
 * ├── .custom-mode-card-rail-cards
 * │   └── button.custom-mode-card-rail-card[.active]
 * │       ├── span.custom-mode-card-rail-card-key
 * │       └── span.custom-mode-card-rail-card-value
 * ├── .custom-mode-card-rail-sash
 * └── .custom-mode-card-rail-content
 * ```
 */

export const CARD_RAIL_DEFAULT_WIDTH = 220;
export const CARD_RAIL_MIN_WIDTH = 160;
export const CARD_RAIL_MAX_WIDTH = 480;
/** Below this width the rail collapses to a single card column. */
export const CARD_RAIL_NARROW_WIDTH = 200;

export interface CardRailItem {
	readonly id: string;
	readonly key: string;
	readonly value: string;
	readonly title?: string;
	/** When true, render a full-width gap above this card to separate rail groups. */
	readonly groupStart?: boolean;
	/** Optional section title rendered above the group gap (implies a group break). */
	readonly groupLabel?: string;
	/** Human-actionable next Plan step pending — shows a pulsing attention dot. */
	readonly pendingAction?: boolean;
}

export interface CardRailLayoutOptions {
	readonly cards: readonly CardRailItem[];
	readonly activeId?: string;
	readonly onSelect: (id: string) => void;
	readonly content?: HTMLElement | readonly HTMLElement[];
	readonly ariaLabel?: string;
	readonly className?: string;
	/** Initial left-rail width in px (clamped). */
	readonly width?: number;
	/** Fired after a drag resize settles (or when width is set programmatically). */
	readonly onWidthChange?: (width: number) => void;
}

export interface CardRailLayout {
	readonly root: HTMLElement;
	readonly rail: HTMLElement;
	readonly contentHost: HTMLElement;
	setCards(cards: readonly CardRailItem[]): void;
	/**
	 * Highlight one or more cards. Use `alsoSelected` so an open surface stays selected
	 * while a section card (Rules / Plan / …) is the focused selection.
	 */
	setActiveId(id: string | undefined, alsoSelected?: readonly string[]): void;
	/** Show a full-width loading row under the cards (e.g. surface section cards still loading). */
	setLoading(loading: boolean, label?: string): void;
	setWidth(width: number): void;
	getWidth(): number;
	dispose(): void;
}

/** Workbench stylesheet fragment (prefix with `.monaco-workbench` when injecting). */
export const CARD_RAIL_STYLESHEET = `
.custom-mode-card-rail {
	display: flex;
	flex-direction: row;
	align-items: stretch;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	width: 100%;
	overflow: hidden;
}
.custom-mode-card-rail-cards {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	align-content: start;
	align-self: stretch;
	flex: 0 0 var(--custom-mode-card-rail-width, ${CARD_RAIL_DEFAULT_WIDTH}px);
	width: var(--custom-mode-card-rail-width, ${CARD_RAIL_DEFAULT_WIDTH}px);
	min-width: ${CARD_RAIL_MIN_WIDTH}px;
	max-width: min(${CARD_RAIL_MAX_WIDTH}px, 55vw);
	padding: 14px 16px;
	background: var(--vscode-sideBar-background);
	overflow-x: hidden;
	overflow-y: auto;
	box-sizing: border-box;
}
.custom-mode-card-rail-cards.narrow {
	grid-template-columns: 1fr;
}
.custom-mode-card-rail-sash {
	position: relative;
	flex: 0 0 5px;
	width: 5px;
	margin: 0;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: ew-resize;
	z-index: 2;
	touch-action: none;
}
.custom-mode-card-rail-sash::before {
	content: '';
	position: absolute;
	top: 0;
	bottom: 0;
	left: 2px;
	width: 1px;
	background: var(--vscode-widget-border, rgba(128, 128, 128, 0.24));
}
.custom-mode-card-rail-sash:hover::before,
.custom-mode-card-rail-sash:focus-visible::before,
.custom-mode-card-rail.resizing .custom-mode-card-rail-sash::before {
	left: 1px;
	width: 3px;
	background: var(--vscode-focusBorder, var(--vscode-sash-hoverBorder, #3794ff));
}
.custom-mode-card-rail-sash:focus-visible {
	outline: none;
}
.custom-mode-card-rail.resizing {
	cursor: ew-resize;
	user-select: none;
}
.custom-mode-card-rail.resizing .custom-mode-card-rail-content {
	pointer-events: none;
}
.custom-mode-card-rail-card {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	gap: 4px;
	height: auto;
	min-height: 56px;
	width: 100%;
	min-width: 0;
	overflow: hidden;
	padding: 10px 12px;
	border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.24)));
	border-radius: 7px;
	background: var(--vscode-editorWidget-background);
	color: var(--vscode-foreground);
	text-align: left;
	font: inherit;
	cursor: pointer;
}
.custom-mode-card-rail-card-pending-dot {
	position: absolute;
	top: 7px;
	right: 7px;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--vscode-textLink-foreground, var(--vscode-focusBorder, #3794ff));
	box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
	animation: custom-mode-card-rail-pending-pulse 1.6s ease-out infinite;
	pointer-events: none;
}
.custom-mode-card-rail-card.active .custom-mode-card-rail-card-pending-dot {
	background: var(--vscode-button-foreground, #fff);
	box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-button-foreground, #fff) 45%, transparent);
}
@keyframes custom-mode-card-rail-pending-pulse {
	0% {
		transform: scale(1);
		opacity: 1;
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent);
	}
	70% {
		transform: scale(1.15);
		opacity: 0.85;
		box-shadow: 0 0 0 6px transparent;
	}
	100% {
		transform: scale(1);
		opacity: 1;
		box-shadow: 0 0 0 0 transparent;
	}
}
.custom-mode-card-rail-card:hover:not(.active) {
	border-color: var(--vscode-focusBorder);
	background: var(--vscode-toolbar-hoverBackground);
}
.custom-mode-card-rail-card:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
.custom-mode-card-rail-card.active {
	background: var(--vscode-button-background);
	border-color: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
}
.custom-mode-card-rail-card-key {
	font: 700 10px/1.3 var(--vscode-font-family);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
}
.custom-mode-card-rail-card.active .custom-mode-card-rail-card-key {
	color: inherit;
	opacity: 0.85;
}
.custom-mode-card-rail-card-value {
	font-size: 12px;
	font-weight: 600;
	line-height: 1.25;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
}
.custom-mode-card-rail-content {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	overflow: auto;
}
.custom-mode-card-rail-group-gap {
	grid-column: 1 / -1;
	height: 0;
	margin: 10px 0 2px;
	border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.28));
	pointer-events: none;
}
.custom-mode-card-rail-group-label {
	grid-column: 1 / -1;
	margin: 12px 0 0;
	padding: 0 2px;
	font: 700 10px/1.3 var(--vscode-font-family);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
	pointer-events: none;
	user-select: none;
}
.custom-mode-card-rail-loading {
	grid-column: 1 / -1;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: 40px;
	padding: 8px 10px;
	border: 1px dashed var(--vscode-widget-border, rgba(128, 128, 128, 0.28));
	border-radius: 7px;
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.02em;
	pointer-events: none;
	user-select: none;
}
.custom-mode-card-rail-loading .codicon {
	font-size: 14px;
}
`;

export function clampCardRailWidth(width: number): number {
	if (!Number.isFinite(width)) {
		return CARD_RAIL_DEFAULT_WIDTH;
	}
	return Math.max(CARD_RAIL_MIN_WIDTH, Math.min(CARD_RAIL_MAX_WIDTH, Math.round(width)));
}

export function cardRailItemsEqual(a: readonly CardRailItem[], b: readonly CardRailItem[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		const left = a[i]!;
		const right = b[i]!;
		if (
			left.id !== right.id
			|| left.key !== right.key
			|| left.value !== right.value
			|| left.title !== right.title
			|| !!left.groupStart !== !!right.groupStart
			|| (left.groupLabel ?? '') !== (right.groupLabel ?? '')
			|| !!left.pendingAction !== !!right.pendingAction
		) {
			return false;
		}
	}
	return true;
}

export function createCardRailLayout(options: CardRailLayoutOptions): CardRailLayout {
	const listeners = new DisposableStore();
	const cardListeners = new DisposableStore();
	const dragListeners = new DisposableStore();
	listeners.add(cardListeners);
	listeners.add(dragListeners);
	let cards = [...options.cards];
	let activeIds = new Set<string>(options.activeId ? [options.activeId] : []);
	let loading = false;
	let loadingLabel = 'Loading…';
	let width = clampCardRailWidth(options.width ?? CARD_RAIL_DEFAULT_WIDTH);

	const rail = $('div.custom-mode-card-rail-cards', {
		role: 'tablist',
		'aria-label': options.ariaLabel ?? 'Views',
	});
	const sash = $('div.custom-mode-card-rail-sash', {
		role: 'separator',
		'aria-orientation': 'vertical',
		'aria-label': 'Resize card column',
		'aria-valuemin': String(CARD_RAIL_MIN_WIDTH),
		'aria-valuemax': String(CARD_RAIL_MAX_WIDTH),
		tabIndex: 0,
	});
	const contentHost = $('div.custom-mode-card-rail-content');
	if (options.content) {
		const nodes = Array.isArray(options.content) ? options.content : [options.content];
		for (const node of nodes) {
			contentHost.appendChild(node);
		}
	}
	const root = $('div.custom-mode-card-rail', undefined, rail, sash, contentHost);
	if (options.className) {
		root.classList.add(...options.className.split(/\s+/).filter(Boolean));
	}

	const applyWidth = (next: number, notify: boolean): void => {
		width = clampCardRailWidth(next);
		root.style.setProperty('--custom-mode-card-rail-width', `${width}px`);
		rail.classList.toggle('narrow', width < CARD_RAIL_NARROW_WIDTH);
		sash.setAttribute('aria-valuenow', String(width));
		if (notify) {
			options.onWidthChange?.(width);
		}
	};
	applyWidth(width, false);

	const selectedIdsEqual = (next: ReadonlySet<string>): boolean => {
		if (next.size !== activeIds.size) {
			return false;
		}
		for (const id of next) {
			if (!activeIds.has(id)) {
				return false;
			}
		}
		return true;
	};

	const applyActiveClasses = (): void => {
		for (const button of rail.querySelectorAll<HTMLButtonElement>('button.custom-mode-card-rail-card')) {
			const active = !!button.dataset.cardId && activeIds.has(button.dataset.cardId);
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', String(active));
		}
	};

	const renderRail = (): void => {
		cardListeners.clear();
		clearNode(rail);
		for (const card of cards) {
			if (card.groupLabel) {
				rail.appendChild($('div.custom-mode-card-rail-group-label', { 'aria-hidden': 'true' }, card.groupLabel));
			} else if (card.groupStart) {
				rail.appendChild($('div.custom-mode-card-rail-group-gap', { 'aria-hidden': 'true' }));
			}
			const active = activeIds.has(card.id);
			const button = $('button.custom-mode-card-rail-card', {
				type: 'button',
				role: 'tab',
				'aria-selected': String(active),
				title: card.title ?? `${card.key}: ${card.value}`,
				'data-card-id': card.id,
			},
				$('span.custom-mode-card-rail-card-key', undefined, card.key),
				$('span.custom-mode-card-rail-card-value', undefined, card.value),
			) as HTMLButtonElement;
			button.classList.toggle('active', active);
			if (card.pendingAction) {
				button.classList.add('has-pending-action');
				button.appendChild($('span.custom-mode-card-rail-card-pending-dot', {
					'aria-hidden': 'true',
				}));
			}
			// pointerdown fires before a re-render can cancel a click while survey updates thrash the tree.
			cardListeners.add(addDisposableListener(button, 'pointerdown', (event: PointerEvent) => {
				if (event.button !== 0) {
					return;
				}
				event.preventDefault();
				options.onSelect(card.id);
			}));
			rail.appendChild(button);
		}
		if (loading) {
			rail.appendChild($('div.custom-mode-card-rail-loading', {
				role: 'status',
				'aria-live': 'polite',
				'aria-busy': 'true',
			},
				$('span.codicon.codicon-loading.codicon-modifier-spin', { 'aria-hidden': 'true' }),
				$('span', undefined, loadingLabel),
			));
		}
	};

	const endResize = (): void => {
		dragListeners.clear();
		root.classList.remove('resizing');
		options.onWidthChange?.(width);
	};

	const startResize = (clientX: number): void => {
		const startX = clientX;
		const startWidth = width;
		root.classList.add('resizing');
		dragListeners.clear();
		const win = getWindow(root);
		dragListeners.add(addDisposableListener(win, 'pointermove', (event: PointerEvent) => {
			applyWidth(startWidth + (event.clientX - startX), false);
		}));
		dragListeners.add(addDisposableListener(win, 'pointerup', () => endResize()));
		dragListeners.add(addDisposableListener(win, 'pointercancel', () => endResize()));
	};

	listeners.add(addDisposableListener(sash, 'pointerdown', (event: PointerEvent) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		startResize(event.clientX);
	}));
	listeners.add(addDisposableListener(sash, 'keydown', (event: KeyboardEvent) => {
		const step = event.shiftKey ? 24 : 12;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			applyWidth(width - step, true);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			applyWidth(width + step, true);
		} else if (event.key === 'Home') {
			event.preventDefault();
			applyWidth(CARD_RAIL_MIN_WIDTH, true);
		} else if (event.key === 'End') {
			event.preventDefault();
			applyWidth(CARD_RAIL_MAX_WIDTH, true);
		}
	}));

	renderRail();

	return {
		root,
		rail,
		contentHost,
		setCards(next) {
			if (cardRailItemsEqual(cards, next)) {
				// Cards unchanged — still refresh active classes in case setActiveId ran first.
				applyActiveClasses();
				return;
			}
			cards = [...next];
			renderRail();
		},
		setActiveId(id, alsoSelected = []) {
			const next = new Set<string>();
			if (id) {
				next.add(id);
			}
			for (const extra of alsoSelected) {
				if (extra) {
					next.add(extra);
				}
			}
			if (selectedIdsEqual(next)) {
				applyActiveClasses();
				return;
			}
			activeIds = next;
			applyActiveClasses();
		},
		setLoading(next, label) {
			const nextLabel = label?.trim() || 'Loading…';
			if (loading === next && loadingLabel === nextLabel) {
				return;
			}
			loading = next;
			loadingLabel = nextLabel;
			renderRail();
		},
		setWidth(next) {
			applyWidth(next, true);
		},
		getWidth() {
			return width;
		},
		dispose() {
			listeners.dispose();
			root.remove();
		},
	};
}

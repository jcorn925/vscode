/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, clearNode, getWindow } from '../../../../base/browser/dom.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';

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
/** Shared idle delay for Console / Steps / Claude / AI chat auto-hide (exactly 750ms). */
export const CARD_RAIL_AUTO_HIDE_MS = 750;
/** Pointer distance from the panel's left edge that re-shows a collapsed rail. */
export const CARD_RAIL_REVEAL_EDGE_PX = 14;

export interface CardRailItem {
	readonly id: string;
	readonly key: string;
	readonly value: string;
	readonly title?: string;
	/** When true, render a full-width gap above this card to separate rail groups. */
	readonly groupStart?: boolean;
	/** Optional section title rendered above the group gap (implies a group break). */
	readonly groupLabel?: string;
	/**
	 * Consecutive cards sharing this id are wrapped in a blue association outline
	 * (e.g. Console sections, or a surface's Rules/Plan/… cards).
	 */
	readonly assocGroup?: string;
	/** Human-actionable next Plan step pending — shows a pulsing attention dot. */
	readonly pendingAction?: boolean;
	/** 0–100 completion for surface title cards (compact bar + percent). */
	readonly progressPercent?: number;
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
	/**
	 * When set, hide the card column after this many ms without hover, and show it
	 * again when the pointer enters the rail or the left edge of the panel.
	 */
	readonly autoHideMs?: number;
	/** Optional label on the collapsed left-edge reveal tab (e.g. "Console"). */
	readonly revealLabel?: string;
	/** Fired when auto-hide collapses or expands the card column. */
	readonly onCollapsedChange?: (collapsed: boolean) => void;
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
	/** Expand a collapsed auto-hide rail (e.g. left-edge hover over a full-bleed preview). */
	reveal(): void;
	/** True when the auto-hide card column is collapsed to the edge tab. */
	isCollapsed(): boolean;
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
	position: relative;
}
.custom-mode-card-rail-cards {
	position: relative;
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
	transition: flex-basis 160ms ease, width 160ms ease, min-width 160ms ease, max-width 160ms ease, padding 160ms ease, opacity 120ms ease;
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
	transition: flex-basis 160ms ease, width 160ms ease, opacity 120ms ease;
}
.custom-mode-card-rail-reveal {
	flex: 0 0 0;
	width: 0;
	min-width: 0;
	overflow: hidden;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: default;
	z-index: 3;
}
.custom-mode-card-rail.collapsed > .custom-mode-card-rail-cards {
	flex: 0 0 0 !important;
	width: 0 !important;
	min-width: 0 !important;
	max-width: 0 !important;
	padding-left: 0 !important;
	padding-right: 0 !important;
	opacity: 0;
	overflow: hidden;
	pointer-events: none;
	border: 0;
}
.custom-mode-card-rail.collapsed > .custom-mode-card-rail-sash {
	flex: 0 0 0 !important;
	width: 0 !important;
	opacity: 0;
	overflow: hidden;
	pointer-events: none;
}
.custom-mode-card-rail.collapsed > .custom-mode-card-rail-reveal {
	flex: 0 0 10px;
	width: 10px;
	cursor: e-resize;
}
.custom-mode-card-rail.collapsed > .custom-mode-card-rail-reveal:hover {
	background: color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 35%, transparent);
}
.custom-mode-card-rail.collapsed > .custom-mode-card-rail-reveal.has-label {
	position: absolute;
	left: 0;
	top: 50%;
	transform: translateY(-50%);
	flex: 0 0 auto !important;
	width: auto !important;
	min-width: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	writing-mode: vertical-rl;
	text-orientation: mixed;
	padding: 8px 3px;
	border: 1px solid var(--vscode-panel-border);
	border-left: none;
	border-radius: 0 5px 5px 0;
	background-color: var(--vscode-sideBar-background);
	color: var(--vscode-descriptionForeground, var(--vscode-foreground));
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.04em;
	cursor: pointer;
	box-shadow: 1px 0 4px rgba(0, 0, 0, 0.16);
	z-index: 25;
	opacity: 1;
	pointer-events: auto;
}
.custom-mode-card-rail.collapsed > .custom-mode-card-rail-reveal.has-label:hover {
	background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-sideBar-background));
	color: var(--vscode-foreground);
}
/* Labeled chip is absolutely positioned — keep content clear of it. */
.custom-mode-card-rail.collapsed:has(> .custom-mode-card-rail-reveal.has-label) > .custom-mode-card-rail-content {
	padding-left: 28px;
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
/* Name-only cards (no subtitle): render key as the primary label, not an uppercase eyebrow. */
.custom-mode-card-rail-card:not(:has(.custom-mode-card-rail-card-value)) .custom-mode-card-rail-card-key {
	font-size: 12px;
	font-weight: 600;
	line-height: 1.25;
	letter-spacing: normal;
	text-transform: none;
	color: inherit;
}
.custom-mode-card-rail-card.active:not(:has(.custom-mode-card-rail-card-value)) .custom-mode-card-rail-card-key {
	opacity: 1;
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
.custom-mode-card-rail-card-value:empty {
	display: none;
}
.custom-mode-card-rail-card-progress {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 8px;
	width: 100%;
	margin-top: 5px;
}
.custom-mode-card-rail-card-progress-track {
	display: block;
	flex: 1 1 auto;
	min-width: 0;
	height: 4px;
	border-radius: 999px;
	background: color-mix(in srgb, currentColor 16%, transparent);
	overflow: hidden;
}
.custom-mode-card-rail-card-progress-bar {
	/* Must be block — span defaults to inline, which ignores width/height. */
	display: block;
	height: 100%;
	min-height: 4px;
	border-radius: 999px;
	background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground, #3794ff));
	width: 0%;
	transition: width 160ms ease;
}
.custom-mode-card-rail-card.active .custom-mode-card-rail-card-progress-bar {
	background: color-mix(in srgb, currentColor 88%, transparent);
}
.custom-mode-card-rail-card-progress-bar.is-complete {
	background: var(--vscode-testing-iconPassed, #73c991);
}
.custom-mode-card-rail-card.active .custom-mode-card-rail-card-progress-bar.is-complete {
	background: color-mix(in srgb, currentColor 92%, transparent);
}
.custom-mode-card-rail-card-progress-pct {
	flex: 0 0 auto;
	min-width: 2.75em;
	text-align: right;
	font-size: 11px;
	font-weight: 650;
	font-variant-numeric: tabular-nums;
	letter-spacing: 0.01em;
	line-height: 1;
	color: var(--vscode-descriptionForeground);
}
.custom-mode-card-rail-card.active .custom-mode-card-rail-card-progress-pct {
	color: inherit;
	opacity: 0.92;
}
.custom-mode-card-rail-card-progress-pct.is-complete {
	color: var(--vscode-testing-iconPassed, #73c991);
	font-weight: 700;
}
.custom-mode-card-rail-card.active .custom-mode-card-rail-card-progress-pct.is-complete {
	color: inherit;
	opacity: 1;
}
/* Keep surface name as primary label even when a progress row is present. */
.custom-mode-card-rail-card:has(.custom-mode-card-rail-card-progress):not(:has(.custom-mode-card-rail-card-value)) .custom-mode-card-rail-card-key {
	font-size: 12px;
	font-weight: 600;
	line-height: 1.25;
	letter-spacing: normal;
	text-transform: none;
	color: inherit;
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
	letter-spacing: 0.02em;
	color: var(--vscode-descriptionForeground);
	pointer-events: none;
	user-select: none;
	overflow-wrap: anywhere;
	word-break: break-word;
}
.custom-mode-card-rail-assoc {
	grid-column: 1 / -1;
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	align-content: start;
	padding: 8px;
	margin: 2px 0 0;
	border: 1.5px solid var(--vscode-focusBorder, #3794ff);
	border-radius: 10px;
	background: color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 7%, transparent);
	box-sizing: border-box;
}
.custom-mode-card-rail-cards.narrow .custom-mode-card-rail-assoc {
	grid-template-columns: 1fr;
}
.custom-mode-card-rail-assoc-stem {
	position: absolute;
	width: 2px;
	margin-left: -1px;
	background: var(--vscode-focusBorder, #3794ff);
	pointer-events: none;
	z-index: 2;
}
.custom-mode-card-rail-card.assoc-owner {
	z-index: 3;
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
			|| (left.assocGroup ?? '') !== (right.assocGroup ?? '')
			|| !!left.pendingAction !== !!right.pendingAction
			|| (left.progressPercent ?? -1) !== (right.progressPercent ?? -1)
		) {
			return false;
		}
	}
	return true;
}

/** True when card identity/layout slots match — values may still differ (safe for in-place patch). */
export function cardRailStructureEqual(a: readonly CardRailItem[], b: readonly CardRailItem[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		const left = a[i]!;
		const right = b[i]!;
		if (
			left.id !== right.id
			|| !!left.groupStart !== !!right.groupStart
			|| (left.groupLabel ?? '') !== (right.groupLabel ?? '')
			|| (left.assocGroup ?? '') !== (right.assocGroup ?? '')
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
	const revealLabel = options.revealLabel?.trim() || '';
	const revealAria = revealLabel
		? `Show ${revealLabel}`
		: 'Show card column';
	const reveal = $('div.custom-mode-card-rail-reveal', {
		role: 'button',
		tabIndex: -1,
		'aria-label': revealAria,
		title: revealAria,
	});
	if (revealLabel) {
		reveal.classList.add('has-label');
		reveal.textContent = revealLabel;
	}
	const contentHost = $('div.custom-mode-card-rail-content');
	if (options.content) {
		const nodes = Array.isArray(options.content) ? options.content : [options.content];
		for (const node of nodes) {
			contentHost.appendChild(node);
		}
	}
	const root = $('div.custom-mode-card-rail', undefined, reveal, rail, sash, contentHost);
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

	/** Patch labels/progress without destroying buttons (avoids selection/pointer glitches). */
	const patchCardContents = (nextCards: readonly CardRailItem[]): boolean => {
		for (const card of nextCards) {
			const button = rail.querySelector<HTMLButtonElement>(
				`button.custom-mode-card-rail-card[data-card-id="${CSS.escape(card.id)}"]`,
			);
			if (!button) {
				return false;
			}
			const value = card.value.trim();
			const progressPercent = typeof card.progressPercent === 'number' && Number.isFinite(card.progressPercent)
				? Math.max(0, Math.min(100, Math.round(card.progressPercent)))
				: undefined;
			button.title = card.title ?? (value ? `${card.key}: ${value}` : card.key);

			const keyEl = button.querySelector('.custom-mode-card-rail-card-key');
			if (keyEl && keyEl.textContent !== card.key) {
				keyEl.textContent = card.key;
			}

			let valueEl = button.querySelector('.custom-mode-card-rail-card-value') as HTMLElement | null;
			if (value) {
				if (!valueEl) {
					valueEl = $('span.custom-mode-card-rail-card-value', undefined, value);
					const progressEl = button.querySelector('.custom-mode-card-rail-card-progress');
					if (progressEl) {
						button.insertBefore(valueEl, progressEl);
					} else {
						button.appendChild(valueEl);
					}
				} else if (valueEl.textContent !== value) {
					valueEl.textContent = value;
				}
			} else if (valueEl) {
				valueEl.remove();
			}

			let progressRoot = button.querySelector('.custom-mode-card-rail-card-progress') as HTMLElement | null;
			if (progressPercent !== undefined) {
				const complete = progressPercent >= 100;
				if (!progressRoot) {
					const bar = $('span.custom-mode-card-rail-card-progress-bar') as HTMLElement;
					bar.style.width = `${progressPercent}%`;
					bar.classList.toggle('is-complete', complete);
					const pct = $('span.custom-mode-card-rail-card-progress-pct', undefined, `${progressPercent}%`);
					pct.classList.toggle('is-complete', complete);
					progressRoot = $('span.custom-mode-card-rail-card-progress', {
						'aria-hidden': 'true',
					},
						$('span.custom-mode-card-rail-card-progress-track', undefined, bar),
						pct,
					);
					button.appendChild(progressRoot);
				} else {
					const bar = progressRoot.querySelector('.custom-mode-card-rail-card-progress-bar') as HTMLElement | null;
					const pct = progressRoot.querySelector('.custom-mode-card-rail-card-progress-pct') as HTMLElement | null;
					if (bar) {
						bar.style.width = `${progressPercent}%`;
						bar.classList.toggle('is-complete', complete);
					}
					if (pct) {
						pct.textContent = `${progressPercent}%`;
						pct.classList.toggle('is-complete', complete);
					}
				}
			} else if (progressRoot) {
				progressRoot.remove();
			}

			const pendingDot = button.querySelector('.custom-mode-card-rail-card-pending-dot');
			if (card.pendingAction) {
				button.classList.add('has-pending-action');
				if (!pendingDot) {
					button.appendChild($('span.custom-mode-card-rail-card-pending-dot', {
						'aria-hidden': 'true',
					}));
				}
			} else {
				button.classList.remove('has-pending-action');
				pendingDot?.remove();
			}
		}
		return true;
	};

	/** Draw a blue stem from each assoc-group parent card down to its outlined child group. */
	const layoutAssocConnectors = (): void => {
		for (const stem of rail.querySelectorAll('.custom-mode-card-rail-assoc-stem')) {
			stem.remove();
		}
		for (const button of rail.querySelectorAll('button.custom-mode-card-rail-card.assoc-owner')) {
			button.classList.remove('assoc-owner');
		}
		const railRect = rail.getBoundingClientRect();
		if (railRect.width <= 0 || railRect.height <= 0) {
			return;
		}
		for (const assoc of rail.querySelectorAll<HTMLElement>('.custom-mode-card-rail-assoc')) {
			const group = assoc.dataset.assocGroup?.trim();
			if (!group) {
				continue;
			}
			const owner = rail.querySelector<HTMLElement>(
				`button.custom-mode-card-rail-card[data-card-id="${CSS.escape(group)}"]`,
			);
			if (!owner) {
				continue;
			}
			owner.classList.add('assoc-owner');
			const ownerRect = owner.getBoundingClientRect();
			const assocRect = assoc.getBoundingClientRect();
			const x = ownerRect.left + ownerRect.width / 2 - railRect.left + rail.scrollLeft;
			const y1 = ownerRect.bottom - railRect.top + rail.scrollTop;
			const y2 = assocRect.top - railRect.top + rail.scrollTop;
			if (y2 <= y1 + 1) {
				continue;
			}
			const stem = $('div.custom-mode-card-rail-assoc-stem', { 'aria-hidden': 'true' });
			stem.style.left = `${x}px`;
			stem.style.top = `${y1}px`;
			stem.style.height = `${y2 - y1}px`;
			rail.appendChild(stem);
		}
	};

	const scheduleAssocConnectors = (): void => {
		const win = getWindow(rail);
		win.requestAnimationFrame(() => layoutAssocConnectors());
	};

	const renderRail = (): void => {
		cardListeners.clear();
		clearNode(rail);
		let assocHost: HTMLElement | undefined;
		let assocGroupId: string | undefined;
		const appendCard = (card: CardRailItem, host: HTMLElement): void => {
			const active = activeIds.has(card.id);
			const value = card.value.trim();
			const progressPercent = typeof card.progressPercent === 'number' && Number.isFinite(card.progressPercent)
				? Math.max(0, Math.min(100, Math.round(card.progressPercent)))
				: undefined;
			const button = $('button.custom-mode-card-rail-card', {
				type: 'button',
				role: 'tab',
				'aria-selected': String(active),
				title: card.title ?? (value ? `${card.key}: ${value}` : card.key),
				'data-card-id': card.id,
			},
				$('span.custom-mode-card-rail-card-key', undefined, card.key),
				...(value ? [$('span.custom-mode-card-rail-card-value', undefined, value)] : []),
			) as HTMLButtonElement;
			if (progressPercent !== undefined) {
				const complete = progressPercent >= 100;
				const bar = $('span.custom-mode-card-rail-card-progress-bar') as HTMLElement;
				bar.style.width = `${progressPercent}%`;
				bar.classList.toggle('is-complete', complete);
				const pct = $('span.custom-mode-card-rail-card-progress-pct', undefined, `${progressPercent}%`);
				pct.classList.toggle('is-complete', complete);
				button.appendChild($('span.custom-mode-card-rail-card-progress', {
					'aria-hidden': 'true',
				},
					$('span.custom-mode-card-rail-card-progress-track', undefined, bar),
					pct,
				));
			}
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
			host.appendChild(button);
		};
		for (const card of cards) {
			if (card.groupLabel) {
				assocHost = undefined;
				assocGroupId = undefined;
				rail.appendChild($('div.custom-mode-card-rail-group-label', {
					'aria-hidden': 'true',
					title: card.groupLabel,
				}, card.groupLabel));
			} else if (card.groupStart) {
				assocHost = undefined;
				assocGroupId = undefined;
				rail.appendChild($('div.custom-mode-card-rail-group-gap', { 'aria-hidden': 'true' }));
			}
			const nextAssoc = card.assocGroup?.trim() || undefined;
			if (nextAssoc) {
				if (nextAssoc !== assocGroupId || !assocHost) {
					assocGroupId = nextAssoc;
					assocHost = $('div.custom-mode-card-rail-assoc', {
						'data-assoc-group': nextAssoc,
						'aria-hidden': 'false',
					});
					rail.appendChild(assocHost);
				}
				appendCard(card, assocHost);
			} else {
				assocHost = undefined;
				assocGroupId = undefined;
				appendCard(card, rail);
			}
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
		scheduleAssocConnectors();
	};

	listeners.add(addDisposableListener(rail, 'scroll', () => scheduleAssocConnectors()));
	const assocResizeObserver = new ResizeObserver(() => scheduleAssocConnectors());
	assocResizeObserver.observe(rail);
	listeners.add(toDisposable(() => assocResizeObserver.disconnect()));

	let onResizeStart: (() => void) | undefined;
	let onResizeEnd: (() => void) | undefined;

	const endResize = (): void => {
		dragListeners.clear();
		root.classList.remove('resizing');
		options.onWidthChange?.(width);
		scheduleAssocConnectors();
		onResizeEnd?.();
	};

	const startResize = (clientX: number): void => {
		const startX = clientX;
		const startWidth = width;
		root.classList.add('resizing');
		onResizeStart?.();
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

	let revealCollapsedRail: (() => void) | undefined;
	let isRailCollapsed = (): boolean => false;
	const autoHideMs = typeof options.autoHideMs === 'number' && options.autoHideMs > 0
		? options.autoHideMs
		: undefined;
	if (autoHideMs !== undefined) {
		const win = getWindow(root);
		let collapsed = false;
		let hoveringCards = false;
		let hideTimer: number | undefined;
		isRailCollapsed = () => collapsed;

		const clearHideTimer = (): void => {
			if (hideTimer !== undefined) {
				win.clearTimeout(hideTimer);
				hideTimer = undefined;
			}
		};

		const setCollapsed = (next: boolean): void => {
			if (collapsed === next) {
				return;
			}
			collapsed = next;
			root.classList.toggle('collapsed', collapsed);
			reveal.tabIndex = collapsed ? 0 : -1;
			if (!collapsed) {
				scheduleAssocConnectors();
			}
			options.onCollapsedChange?.(collapsed);
		};

		const showCards = (): void => {
			clearHideTimer();
			setCollapsed(false);
		};
		revealCollapsedRail = showCards;

		const scheduleHide = (): void => {
			if (hoveringCards || root.classList.contains('resizing')) {
				return;
			}
			clearHideTimer();
			hideTimer = win.setTimeout(() => {
				hideTimer = undefined;
				if (!hoveringCards && !root.classList.contains('resizing')) {
					setCollapsed(true);
				}
			}, autoHideMs);
		};

		const onCardsEnter = (): void => {
			hoveringCards = true;
			showCards();
		};
		const onCardsLeave = (): void => {
			hoveringCards = false;
			scheduleHide();
		};

		listeners.add(addDisposableListener(rail, 'pointerenter', onCardsEnter));
		listeners.add(addDisposableListener(rail, 'pointerleave', onCardsLeave));
		listeners.add(addDisposableListener(sash, 'pointerenter', onCardsEnter));
		listeners.add(addDisposableListener(sash, 'pointerleave', onCardsLeave));
		listeners.add(addDisposableListener(reveal, 'pointerenter', onCardsEnter));
		listeners.add(addDisposableListener(reveal, 'pointerleave', onCardsLeave));
		listeners.add(addDisposableListener(reveal, 'focus', () => showCards()));
		listeners.add(addDisposableListener(root, 'pointermove', (event: PointerEvent) => {
			if (!collapsed) {
				return;
			}
			const rect = root.getBoundingClientRect();
			if (event.clientX - rect.left <= CARD_RAIL_REVEAL_EDGE_PX) {
				showCards();
			}
		}));
		onResizeStart = () => showCards();
		onResizeEnd = () => scheduleHide();
		listeners.add({
			dispose: () => {
				clearHideTimer();
				onResizeStart = undefined;
				onResizeEnd = undefined;
			},
		});
		// Start the idle hide clock once the rail is mounted.
		scheduleHide();
	}

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
			// Same structure (ids/groups): patch labels in place so pointerdown selection isn't destroyed.
			if (cardRailStructureEqual(cards, next) && patchCardContents(next)) {
				cards = [...next];
				applyActiveClasses();
				scheduleAssocConnectors();
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
		reveal() {
			revealCollapsedRail?.();
		},
		isCollapsed() {
			return isRailCollapsed();
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

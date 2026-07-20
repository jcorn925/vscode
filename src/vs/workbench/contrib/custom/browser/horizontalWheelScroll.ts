/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Sub-pixel remainder per scroller so macOS trackpad deltas still accumulate to motion. */
const scrollAccumulators = new WeakMap<HTMLElement, number>();

/**
 * Map a wheel/trackpad gesture onto a horizontally scrollable element.
 * Vertical two-finger scroll is treated as horizontal pan (common for step rails).
 * Returns true when the event was claimed (preventDefault), even if already at an edge.
 */
export function applyWheelToHorizontalScroll(el: HTMLElement, event: WheelEvent): boolean {
	const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
	if (maxScroll <= 0) {
		return false;
	}

	let deltaX = event.deltaX;
	let deltaY = event.deltaY;
	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
		deltaX *= 16;
		deltaY *= 16;
	} else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		const page = Math.max(120, el.clientWidth * 0.85);
		deltaX *= page;
		deltaY *= page;
	}

	// Prefer the dominant axis; shift always maps vertical → horizontal.
	let delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
	if (event.shiftKey) {
		delta = deltaY || deltaX;
	}
	if (!delta) {
		return false;
	}

	const pending = (scrollAccumulators.get(el) ?? 0) + delta;
	// Match VS Code scrollableElement: ignore sub-pixel until we have a whole pixel.
	const stepped = pending < 0 ? Math.ceil(pending) : Math.floor(pending);
	if (stepped === 0) {
		scrollAccumulators.set(el, pending);
		claimWheel(event);
		return true;
	}
	scrollAccumulators.set(el, pending - stepped);

	const next = Math.max(0, Math.min(maxScroll, el.scrollLeft + stepped));
	claimWheel(event);
	if (next !== el.scrollLeft) {
		el.scrollLeft = next;
	}
	return true;
}

function claimWheel(event: WheelEvent): void {
	if (!event.cancelable) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
}

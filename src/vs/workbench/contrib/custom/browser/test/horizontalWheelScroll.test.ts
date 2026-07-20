/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyWheelToHorizontalScroll } from '../horizontalWheelScroll.js';

function fakeWheel(partial: Partial<WheelEvent> & Pick<WheelEvent, 'deltaX' | 'deltaY'>): WheelEvent {
	let defaultPrevented = false;
	return {
		deltaX: partial.deltaX,
		deltaY: partial.deltaY,
		deltaMode: partial.deltaMode ?? WheelEvent.DOM_DELTA_PIXEL,
		shiftKey: partial.shiftKey ?? false,
		cancelable: true,
		get defaultPrevented() { return defaultPrevented; },
		preventDefault() { defaultPrevented = true; },
		stopPropagation() { /* noop */ },
	} as unknown as WheelEvent;
}

function fakeScroller(initialLeft = 0): HTMLElement {
	const el = document.createElement('div');
	let scrollLeft = initialLeft;
	Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 100 });
	Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => 400 });
	Object.defineProperty(el, 'scrollLeft', {
		configurable: true,
		get: () => scrollLeft,
		set: (value: number) => { scrollLeft = value; },
	});
	return el;
}

suite('horizontalWheelScroll', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps vertical trackpad delta onto scrollLeft', () => {
		const el = fakeScroller(0);
		const event = fakeWheel({ deltaX: 0, deltaY: 40 });
		assert.strictEqual(applyWheelToHorizontalScroll(el, event), true);
		assert.strictEqual(el.scrollLeft, 40);
		assert.strictEqual(event.defaultPrevented, true);
	});

	test('accumulates sub-pixel deltas before scrolling', () => {
		const el = fakeScroller(0);

		const first = fakeWheel({ deltaX: 0, deltaY: 0.4 });
		assert.strictEqual(applyWheelToHorizontalScroll(el, first), true);
		assert.strictEqual(el.scrollLeft, 0);
		assert.strictEqual(first.defaultPrevented, true);

		const second = fakeWheel({ deltaX: 0, deltaY: 0.4 });
		assert.strictEqual(applyWheelToHorizontalScroll(el, second), true);
		assert.strictEqual(el.scrollLeft, 0);

		const third = fakeWheel({ deltaX: 0, deltaY: 0.4 });
		assert.strictEqual(applyWheelToHorizontalScroll(el, third), true);
		assert.strictEqual(el.scrollLeft, 1);
	});

	test('claims gesture at scroll edge so parents cannot steal it', () => {
		const el = fakeScroller(300);
		const event = fakeWheel({ deltaX: 0, deltaY: 40 });
		assert.strictEqual(applyWheelToHorizontalScroll(el, event), true);
		assert.strictEqual(el.scrollLeft, 300);
		assert.strictEqual(event.defaultPrevented, true);
	});
});

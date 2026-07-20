/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	isRailHoverPreviewActive,
	isRailParentCardId,
	orderRailParentIdsWithInlineChildren,
	railParentRowEndIndex,
	resolveCommittedRailChildrenParent,
	resolveRailChildrenDisplayParent,
	surfaceIdFromRailParentId,
} from '../workspaceHomeRailHover.js';

suite('workspaceHomeRailHover', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('isRailParentCardId accepts console and surface parents only', () => {
		assert.ok(isRailParentCardId('console'));
		assert.ok(isRailParentCardId('surface:admin'));
		assert.ok(!isRailParentCardId('consoleSection:surfaces'));
		assert.ok(!isRailParentCardId('surfaceSection:plan'));
		assert.ok(!isRailParentCardId('code'));
	});

	test('committed parent is open surface, else expanded console', () => {
		assert.strictEqual(
			resolveCommittedRailChildrenParent({ openSurfaceId: 'a', consoleExpanded: true }),
			'surface:a',
		);
		assert.strictEqual(
			resolveCommittedRailChildrenParent({ consoleExpanded: true }),
			'console',
		);
		assert.strictEqual(
			resolveCommittedRailChildrenParent({ consoleExpanded: false }),
			undefined,
		);
	});

	test('hover surface B while A is open shows B as display parent (preview)', () => {
		const options = {
			hoveredRailParentId: 'surface:b',
			openSurfaceId: 'a',
			consoleExpanded: false,
		};
		assert.strictEqual(resolveRailChildrenDisplayParent(options), 'surface:b');
		assert.strictEqual(resolveCommittedRailChildrenParent(options), 'surface:a');
		assert.ok(isRailHoverPreviewActive(options));
		assert.strictEqual(surfaceIdFromRailParentId('surface:b'), 'b');
	});

	test('hover matching committed parent is not preview', () => {
		const options = {
			hoveredRailParentId: 'surface:a',
			openSurfaceId: 'a',
			consoleExpanded: false,
		};
		assert.strictEqual(resolveRailChildrenDisplayParent(options), 'surface:a');
		assert.ok(!isRailHoverPreviewActive(options));
	});

	test('hover console while surface open previews console children', () => {
		const options = {
			hoveredRailParentId: 'console',
			openSurfaceId: 'a',
			consoleExpanded: false,
		};
		assert.strictEqual(resolveRailChildrenDisplayParent(options), 'console');
		assert.ok(isRailHoverPreviewActive(options));
	});

	test('railParentRowEndIndex spans the 2-col row containing the parent', () => {
		assert.strictEqual(railParentRowEndIndex(0, 3, 2), 1);
		assert.strictEqual(railParentRowEndIndex(1, 3, 2), 1);
		assert.strictEqual(railParentRowEndIndex(2, 3, 2), 2);
		assert.strictEqual(railParentRowEndIndex(0, 3, 1), 0);
	});

	test('children insert after the display parent row; same-row neighbor stays above', () => {
		assert.deepStrictEqual(
			orderRailParentIdsWithInlineChildren({
				parentIds: ['surface:a', 'surface:b', 'surface:c'],
				displayParentId: 'surface:a',
				childIds: ['surfaceSection:plan', 'surfaceSection:preview'],
			}),
			[
				'surface:a',
				'surface:b',
				'surfaceSection:plan',
				'surfaceSection:preview',
				'surface:c',
			],
		);
		assert.deepStrictEqual(
			orderRailParentIdsWithInlineChildren({
				parentIds: ['surface:a', 'surface:b', 'surface:c'],
				displayParentId: 'surface:b',
				childIds: ['surfaceSection:plan'],
			}),
			['surface:a', 'surface:b', 'surfaceSection:plan', 'surface:c'],
		);
		assert.deepStrictEqual(
			orderRailParentIdsWithInlineChildren({
				parentIds: ['surface:a', 'surface:b', 'surface:c'],
				displayParentId: 'surface:c',
				childIds: ['surfaceSection:plan'],
			}),
			['surface:a', 'surface:b', 'surface:c', 'surfaceSection:plan'],
		);
		assert.deepStrictEqual(
			orderRailParentIdsWithInlineChildren({
				parentIds: ['surface:a', 'surface:b', 'surface:c'],
				displayParentId: 'surface:a',
				childIds: ['surfaceSection:plan'],
				columns: 1,
			}),
			['surface:a', 'surfaceSection:plan', 'surface:b', 'surface:c'],
		);
		assert.deepStrictEqual(
			orderRailParentIdsWithInlineChildren({
				parentIds: ['surface:a', 'surface:b'],
				displayParentId: 'surface:missing',
				childIds: ['surfaceSection:plan'],
			}),
			['surface:a', 'surface:b'],
		);
	});
});

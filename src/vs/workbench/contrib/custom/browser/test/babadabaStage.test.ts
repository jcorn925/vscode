/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { deriveBabadabaStageState, layoutBabadabaOrbit, type BabadabaStageState } from '../babadabaStage.js';

suite('babadabaStage', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives stage state across the build lifecycle', () => {
		const transitions: Array<[BabadabaStageState, boolean, boolean]> = [
			['idle', false, false],      // fresh workspace, nothing built
			['idle', true, false],       // build starts
			['building', true, false],   // still building
			['building', false, true],   // build finishes → celebrate once
			['complete', false, true],   // stays settled while all complete
			['complete', true, false],   // a new build starts again
			['idle', false, true],       // reload with all complete: no re-celebration
			['complete', false, false],  // a surface is added/reset: back to rest
		];
		assert.deepStrictEqual(
			transitions.map(([previous, building, allComplete]) => deriveBabadabaStageState(previous, building, allComplete)),
			['idle', 'building', 'building', 'complete', 'complete', 'building', 'idle', 'idle'],
		);
	});

	test('lays out orbit nodes front-first on the floor ellipse', () => {
		const points = layoutBabadabaOrbit(4, 1000, 208).map(p => ({
			x: Math.round(p.x),
			y: Math.round(p.y),
			depth: Math.round(p.depth * 100) / 100,
		}));
		// First node lands front-center (max depth); the walk continues around
		// the ellipse, bowing outward and lifting as it recedes behind the
		// character so back-arc chips clear the head.
		assert.deepStrictEqual(points, [
			{ x: 500, y: 156, depth: 1 },
			{ x: 133, y: 108, depth: 0.5 },
			{ x: 500, y: 61, depth: 0 },
			{ x: 868, y: 108, depth: 0.5 },
		]);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	DEV_SERVER_PROBE_MAX_DELAY_MS,
	nextProbeDelay,
	shouldProbeNearbyPorts,
} from '../devServerProbePolicy.js';

suite('devServerProbePolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('delay doubles per consecutive miss and caps', () => {
		assert.deepStrictEqual(
			[1, 2, 3, 4, 5, 6, 20].map(failures => nextProbeDelay(failures)),
			[2500, 5000, 10000, 20000, 30000, 30000, 30000],
		);
		assert.strictEqual(nextProbeDelay(0), 2500);
		assert.strictEqual(DEV_SERVER_PROBE_MAX_DELAY_MS, 30000);
	});

	test('nearby-port fan-out stops after repeated misses', () => {
		assert.deepStrictEqual(
			[0, 1, 2, 3, 4].map(failures => shouldProbeNearbyPorts(failures)),
			[true, true, true, false, false],
		);
	});
});

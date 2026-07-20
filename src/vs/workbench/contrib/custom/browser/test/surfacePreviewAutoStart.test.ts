/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { shouldAutoStartSurfacePreview } from '../../../../../../custom/goalWorkspace/surfacePreviewAutoStart.js';

suite('surfacePreviewAutoStart', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('starts only when Preview is selected, wired, and not already up', () => {
		assert.strictEqual(shouldAutoStartSurfacePreview({
			localUrl: 'http://localhost:3100',
			devCommand: 'npm run dev --prefix apps/bot -- --port 3100',
			previewSelected: true,
			reachable: false,
			alreadyStarted: false,
			alreadyStarting: false,
		}), true);

		assert.strictEqual(shouldAutoStartSurfacePreview({
			localUrl: 'http://localhost:3100',
			devCommand: 'npm run dev --prefix apps/bot -- --port 3100',
			previewSelected: false,
			reachable: false,
			alreadyStarted: false,
			alreadyStarting: false,
		}), false);

		assert.strictEqual(shouldAutoStartSurfacePreview({
			localUrl: 'http://localhost:3100',
			devCommand: 'npm run dev --prefix apps/bot -- --port 3100',
			previewSelected: true,
			reachable: true,
			alreadyStarted: false,
			alreadyStarting: false,
		}), false);

		assert.strictEqual(shouldAutoStartSurfacePreview({
			localUrl: 'http://localhost:3100',
			previewSelected: true,
			reachable: false,
			alreadyStarted: false,
			alreadyStarting: false,
		}), false);
	});
});

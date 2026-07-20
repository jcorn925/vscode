/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	CONSOLE_HOME_DEFAULT_SECTION,
	CONSOLE_HOME_SECTION_ORDER,
	exclusiveConsoleHomeOpenStates,
} from '../../../../../../custom/goalWorkspace/consoleHomeAccordion.js';

suite('consoleHomeAccordion', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('exclusiveConsoleHomeOpenStates opens only the focused section', () => {
		const states = exclusiveConsoleHomeOpenStates('surfaces');
		assert.strictEqual(states.get('surfaces'), true);
		for (const section of CONSOLE_HOME_SECTION_ORDER) {
			if (section !== 'surfaces') {
				assert.strictEqual(states.get(section), false, section);
			}
		}
	});

	test('CONSOLE_HOME_SECTION_ORDER puts Surfaces first as Workspace default', () => {
		assert.strictEqual(CONSOLE_HOME_DEFAULT_SECTION, 'surfaces');
		assert.deepStrictEqual([...CONSOLE_HOME_SECTION_ORDER], [
			'surfaces',
			'workspacePlan',
			'claudeMd',
			'howItWorks',
			'branding',
			'settings',
		]);
	});
});

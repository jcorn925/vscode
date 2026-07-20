/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConsoleHomeSection } from './consoleWorkflowStatus.js';

/** Console home content sections in rail / stack order. Surfaces is the Workspace default. */
export const CONSOLE_HOME_SECTION_ORDER: readonly ConsoleHomeSection[] = [
	'surfaces',
	'workspacePlan',
	'claudeMd',
	'howItWorks',
	'branding',
	'settings',
];

/** Default Console / Workspace section when opening home (not a surface). */
export const CONSOLE_HOME_DEFAULT_SECTION: ConsoleHomeSection = 'surfaces';

/**
 * Exclusive accordion open map — same rule as Surface proposal-tree `focusSection`:
 * only the focused section is open.
 */
export function exclusiveConsoleHomeOpenStates(
	focused: ConsoleHomeSection,
	sections: readonly ConsoleHomeSection[] = CONSOLE_HOME_SECTION_ORDER,
): ReadonlyMap<ConsoleHomeSection, boolean> {
	const map = new Map<ConsoleHomeSection, boolean>();
	for (const section of sections) {
		map.set(section, section === focused);
	}
	return map;
}

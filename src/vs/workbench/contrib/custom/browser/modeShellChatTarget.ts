/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatWidget } from '../../chat/browser/chat.js';

type ModeShellChatTargetGetter = () => IChatWidget | undefined;

let modeShellChatTargetGetter: ModeShellChatTargetGetter | undefined;

export function registerModeShellChatTarget(getter: ModeShellChatTargetGetter): void {
	modeShellChatTargetGetter = getter;
}

export function getModeShellPreferredChatWidget(): IChatWidget | undefined {
	return modeShellChatTargetGetter?.();
}

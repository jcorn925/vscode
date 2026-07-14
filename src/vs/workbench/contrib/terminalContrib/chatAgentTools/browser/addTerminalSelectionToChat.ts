/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize } from '../../../../../nls.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { getModeShellPreferredChatWidget } from '../../../custom/browser/modeShellChatTarget.js';
import { IChatWidget, IChatWidgetService } from '../../../chat/browser/chat.js';
import { IChatRequestVariableEntry } from '../../../chat/common/attachments/chatVariableEntries.js';

export function createTerminalSelectionAttachment(selection: string): IChatRequestVariableEntry {
	return {
		id: `terminal-selection-${Date.now()}`,
		kind: 'generic',
		name: localize('terminalSelection', 'Terminal Selection'),
		fullName: localize('terminalSelection', 'Terminal Selection'),
		value: selection,
		icon: Codicon.terminal
	};
}

export async function resolveChatWidgetForTerminalAttachment(
	accessor: ServicesAccessor,
	preferredWidget?: IChatWidget,
): Promise<IChatWidget | undefined> {
	if (preferredWidget) {
		return preferredWidget;
	}

	const modeShellWidget = getModeShellPreferredChatWidget();
	if (modeShellWidget) {
		return modeShellWidget;
	}

	const chatWidgetService = accessor.get(IChatWidgetService);
	return chatWidgetService.lastFocusedWidget ?? await chatWidgetService.revealWidget();
}

export async function addTerminalSelectionToChat(
	accessor: ServicesAccessor,
	selection: string,
	preferredWidget?: IChatWidget,
): Promise<boolean> {
	const chatView = await resolveChatWidgetForTerminalAttachment(accessor, preferredWidget);
	if (!chatView) {
		return false;
	}

	chatView.attachmentModel.addContext(createTerminalSelectionAttachment(selection));
	chatView.focusInput();
	return true;
}

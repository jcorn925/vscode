/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from '../../../../platform/product/common/product.js';

/** Display name for the configured default chat provider (e.g. product.json `defaultChatAgent`). */
export function getDefaultChatProviderName(): string {
	return product.defaultChatAgent?.provider?.default?.name ?? 'AI';
}

const LEGACY_DEFAULT_AGENT_USERNAMES = ['GitHub Copilot'];

/** Whether a chat message username belongs to the built-in default agent. */
export function isDefaultChatAgentUsername(username: string): boolean {
	return username === getDefaultChatProviderName() || LEGACY_DEFAULT_AGENT_USERNAMES.includes(username);
}

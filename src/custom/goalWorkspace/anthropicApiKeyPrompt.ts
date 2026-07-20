/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../vs/base/common/codicons.js';
import { ThemeIcon } from '../../vs/base/common/themables.js';
import { CancellationToken } from '../../vs/base/common/cancellation.js';
import { DisposableStore } from '../../vs/base/common/lifecycle.js';
import { URI } from '../../vs/base/common/uri.js';
import { localize } from '../../vs/nls.js';
import { IOpenerService } from '../../vs/platform/opener/common/opener.js';
import { IQuickInputService } from '../../vs/platform/quickinput/common/quickInput.js';
import { ANTHROPIC_API_KEYS_URL } from './anthropicApiKey.js';

export interface AnthropicApiKeyPromptOptions {
	/** When true, Enter with an empty value clears the stored key. */
	allowEmpty?: boolean;
}

export async function promptForAnthropicApiKey(
	quickInputService: IQuickInputService,
	openerService: IOpenerService,
	token: CancellationToken,
	options: AnthropicApiKeyPromptOptions = {},
): Promise<string | undefined> {
	const openHelpButton = {
		iconClass: ThemeIcon.asClassName(Codicon.linkExternal),
		tooltip: localize('goalWorkspace.anthropicKey.openHelp', 'Open Anthropic API keys page'),
	};

	return new Promise<string | undefined>((resolve) => {
		if (token.isCancellationRequested) {
			resolve(undefined);
			return;
		}

		const input = quickInputService.createInputBox();
		const disposables = new DisposableStore();
		disposables.add(input);

		input.title = localize('goalWorkspace.anthropicKey.title', 'Anthropic API key');
		input.prompt = localize(
			'goalWorkspace.anthropicKey.prompt',
			'Enter an Anthropic API key for Claude Code in this workspace. Get one at {0}. Stored only on this device; injected as ANTHROPIC_API_KEY into Claude terminals.',
			ANTHROPIC_API_KEYS_URL,
		);
		input.placeholder = localize('goalWorkspace.anthropicKey.placeholder', 'sk-ant-…');
		input.password = true;
		input.ignoreFocusOut = true;
		input.buttons = [openHelpButton];

		disposables.add(input.onDidTriggerButton(() => {
			void openerService.open(URI.parse(ANTHROPIC_API_KEYS_URL), { openExternal: true });
		}));
		disposables.add(input.onDidAccept(() => {
			const value = input.value;
			if (!options.allowEmpty && !value.trim()) {
				return;
			}
			resolve(options.allowEmpty ? value : value.trim());
			input.hide();
		}));
		disposables.add(token.onCancellationRequested(() => input.hide()));
		disposables.add(input.onDidHide(() => {
			resolve(undefined);
			disposables.dispose();
		}));
		input.show();
	});
}

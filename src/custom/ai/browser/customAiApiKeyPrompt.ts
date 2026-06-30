/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../vs/base/common/codicons.js';
import { ThemeIcon } from '../../../vs/base/common/themables.js';
import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { DisposableStore } from '../../../vs/base/common/lifecycle.js';
import { URI } from '../../../vs/base/common/uri.js';
import { localize } from '../../../vs/nls.js';
import { IOpenerService } from '../../../vs/platform/opener/common/opener.js';
import { IQuickInputService } from '../../../vs/platform/quickinput/common/quickInput.js';
import { getCustomAiApiKeyHelpUrl } from '../common/customAiConstants.js';

export interface CustomAiApiKeyPromptOptions {
	rejected?: boolean;
	baseUrl?: string;
	/** When true, Enter with an empty value is accepted (used by the Command Palette setter). */
	allowEmpty?: boolean;
}

export async function promptForCustomAiApiKey(
	quickInputService: IQuickInputService,
	openerService: IOpenerService,
	token: CancellationToken,
	options: CustomAiApiKeyPromptOptions = {},
): Promise<string | undefined> {
	const helpUrl = getCustomAiApiKeyHelpUrl(options.baseUrl ?? 'https://api.openai.com/v1');
	const openHelpButton = {
		iconClass: ThemeIcon.asClassName(Codicon.linkExternal),
		tooltip: localize('customAi.quickInput.openHelp', 'Open page to create an API key'),
	};

	return new Promise<string | undefined>((resolve) => {
		if (token.isCancellationRequested) {
			resolve(undefined);
			return;
		}

		const input = quickInputService.createInputBox();
		const disposables = new DisposableStore();
		disposables.add(input);

		input.title = localize('customAi.quickInput.title', 'Custom AI — API key');
		input.prompt = options.rejected
			? localize(
				'customAi.quickInput.promptRejected',
				'The stored API key was rejected by the server (401). Enter a valid OpenAI-compatible API key. Get one at {0}. It is stored only on this device.',
				helpUrl,
			)
			: localize(
				'customAi.quickInput.prompt',
				'Enter an OpenAI-compatible API key. Get one at {0}. It is stored only on this device.',
				helpUrl,
			);
		input.placeholder = localize('customAi.quickInput.placeholder', 'API key');
		input.password = true;
		input.ignoreFocusOut = true;
		input.buttons = [openHelpButton];

		disposables.add(input.onDidTriggerButton(() => {
			void openerService.open(URI.parse(helpUrl), { openExternal: true });
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

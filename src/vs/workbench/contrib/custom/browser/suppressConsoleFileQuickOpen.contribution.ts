/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IModeService } from '../../../../../custom/mode/ModeService.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Extensions as QuickAccessExtensions, IQuickAccessOptions, IQuickAccessRegistry } from '../../../../platform/quickinput/common/quickAccess.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/**
 * Console (UI / Process) should not open Go to File / Anything quick access.
 * Typing or Cmd/Ctrl+P while Claude or workstreams are focused was surfacing
 * the "file results" picker over the Console surface.
 *
 * Code mode keeps normal Quick Open behavior.
 */
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		// Hide the title-bar search launcher that opens file Quick Open on click.
		'window.commandCenter': false,
		// Let Cmd/Ctrl+P reach the Claude terminal shell instead of Quick Open.
		'terminal.integrated.commandsToSkipShell': [
			'-workbench.action.quickOpen',
			'-workbench.action.quickOpenPreviousEditor',
		],
	}
}]);

function isDefaultFileQuickAccess(value: string | undefined, contextKeyService: IContextKeyService): boolean {
	const registry = Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess);
	const provider = registry.getQuickAccessProvider(value ?? '', contextKeyService);
	// AnythingQuickAccessProvider registers with an empty prefix and is the default.
	return !!provider && provider.prefix === '';
}

class SuppressConsoleFileQuickOpenContribution extends Disposable {
	static readonly ID = 'workbench.contrib.suppressConsoleFileQuickOpen';

	constructor(
		@IQuickInputService quickInputService: IQuickInputService,
		@IModeService modeService: IModeService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		const quickAccess = quickInputService.quickAccess;
		const originalShow = quickAccess.show.bind(quickAccess);
		const originalPick = quickAccess.pick.bind(quickAccess);

		const shouldSuppress = (value: string | undefined): boolean => {
			if (modeService.getMode() === 'Code') {
				return false;
			}
			return isDefaultFileQuickAccess(value, contextKeyService);
		};

		quickAccess.show = (value?: string, options?: IQuickAccessOptions): void => {
			if (shouldSuppress(value)) {
				return;
			}
			originalShow(value, options);
		};

		quickAccess.pick = (value?: string, options?: IQuickAccessOptions) => {
			if (shouldSuppress(value)) {
				return Promise.resolve(undefined);
			}
			return originalPick(value, options);
		};
	}
}

registerWorkbenchContribution2(
	SuppressConsoleFileQuickOpenContribution.ID,
	SuppressConsoleFileQuickOpenContribution,
	WorkbenchPhase.AfterRestored,
);

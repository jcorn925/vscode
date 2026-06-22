/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../../../../custom/appLaunch/AppLaunchGuideService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'custom',
	title: localize('customConfigurationTitle', 'Custom'),
	type: 'object',
	properties: {
		'custom.appLaunchGuide.showOnIncomplete': {
			type: 'boolean',
			default: true,
			description: localize('custom.appLaunchGuide.showOnIncomplete', "When enabled, show the App Launch guide on the UI tab while localhost server setup steps are incomplete."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.appLaunchGuide.autoRun': {
			type: 'boolean',
			default: true,
			description: localize('custom.appLaunchGuide.autoRun', "When enabled, automatically run fixable App Launch steps (project recovery, dependency install, dev server start) when the guide opens on the UI tab."),
			scope: ConfigurationScope.APPLICATION
		},
	},
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'custom',
	title: localize('customConfigurationTitle', 'Custom'),
	type: 'object',
	properties: {
		'custom.startupGuide.showOnIncomplete': {
			type: 'boolean',
			default: true,
			description: localize('custom.startupGuide.showOnIncomplete', "When enabled, show the startup setup guide on launch while required steps are incomplete."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.startupGuide.autoRun': {
			type: 'boolean',
			default: true,
			description: localize('custom.startupGuide.autoRun', "When enabled, automatically run fixable startup steps (project recovery, Ix CLI install, Docker launch, Ix pipeline) when the guide opens."),
			scope: ConfigurationScope.APPLICATION
		},
	},
});

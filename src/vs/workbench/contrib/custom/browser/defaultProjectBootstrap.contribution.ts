/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { DefaultProjectBootstrapContribution } from './defaultProjectBootstrap.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'custom',
	title: localize('customConfigurationTitle', 'Custom'),
	type: 'object',
	properties: {
		'custom.defaultProject.repoUrl': {
			type: 'string',
			default: 'https://github.com/jcorn925/cracked.git',
			description: localize('custom.defaultProject.repoUrl', "Git repo URL to clone when creating the default project."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.defaultProject.branch': {
			type: 'string',
			default: '',
			description: localize('custom.defaultProject.branch', "Optional git branch, tag, or commit to checkout after cloning the default project."),
			scope: ConfigurationScope.APPLICATION
		}
	}
});

registerWorkbenchContribution2(DefaultProjectBootstrapContribution.ID, DefaultProjectBootstrapContribution, WorkbenchPhase.AfterRestored);


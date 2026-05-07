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
			default: 'https://github.com/jcorn925/videditor.git',
			description: localize('custom.defaultProject.repoUrl', "Git repo URL to clone when creating the default project."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.defaultProject.branch': {
			type: 'string',
			default: '',
			description: localize('custom.defaultProject.branch', "Optional git branch, tag, or commit to checkout after cloning the default project."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.nextComponentMapping.swcPluginWasmPath': {
			type: 'string',
			default: '',
			description: localize('custom.nextComponentMapping.swcPluginWasmPath', "Override path to the Next.js SWC plugin .wasm used for component mapping. If empty, VS Code will use the bundled default when available."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.ix.enabled': {
			type: 'boolean',
			default: true,
			description: localize('custom.ix.enabled', "When enabled, VS Code can run the Ix CLI (install, docker, map, watch) from the Mode Shell Process tab. Disabled automatically in web builds."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.ix.autoStart': {
			type: 'boolean',
			default: true,
			description: localize('custom.ix.autoStart', "When enabled and a folder workspace is open, automatically run `ix docker start`, `ix map` for each workspace root, then `ix watch` per root."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.ix.autoInstall': {
			type: 'boolean',
			default: true,
			description: localize('custom.ix.autoInstall', "If the `ix` command is missing, download and run the official install script from custom.ix.installScriptUrl. Remote install scripts execute third-party code; disable for locked-down environments."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.ix.installScriptUrl': {
			type: 'string',
			default: 'https://ix-infra.com/install.sh',
			description: localize('custom.ix.installScriptUrl', "URL passed to curl (desktop) or Invoke-WebRequest (Windows) when installing the Ix CLI."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.ix.cliPath': {
			type: 'string',
			default: '',
			description: localize('custom.ix.cliPath', "Optional absolute path to the `ix` executable. When set, automatic PATH detection and cached path are ignored."),
			scope: ConfigurationScope.APPLICATION
		},
		'custom.ix.preferredWorkspaceFolder': {
			type: 'string',
			default: '',
			description: localize('custom.ix.preferredWorkspaceFolder', "In a multi-root workspace, the Explorer folder **name**, **basename**, or filesystem path substring to use as the Process notes / Ix evidence root. When empty, the first workspace folder is used. This does not change `~/.ix/config.yaml`; it tells this editor which VS Code workspace root drives `cwd` when running `ix` for Process notes and suggestions."),
			scope: ConfigurationScope.WINDOW
		}
	}
});

registerWorkbenchContribution2(DefaultProjectBootstrapContribution.ID, DefaultProjectBootstrapContribution, WorkbenchPhase.AfterRestored);


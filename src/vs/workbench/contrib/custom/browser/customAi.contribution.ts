/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IChatAgentService } from '../../chat/common/participants/chatAgents.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import { ILanguageModelToolsService } from '../../chat/common/tools/languageModelToolsService.js';
import { CustomAiModelProvider } from '../../../../../custom/ai/browser/customAiModelProvider.js';
import { CustomAiChatAgent } from '../../../../../custom/ai/browser/customAiChatAgent.js';
import { CustomAiEditFileTool, CustomAiEditFileToolData } from '../../../../../custom/ai/browser/customAiEditFileTool.js';
import {
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD,
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS,
	CUSTOM_AI_OLLAMA_DOWNLOAD_URL,
	CUSTOM_AI_SECRET_OPENAI_API_KEY,
	CUSTOM_AI_VENDOR,
} from '../../../../../custom/ai/common/customAiConstants.js';

const CUSTOM_AI_SET_KEY_COMMAND = 'customAi.setOpenaiApiKey';

const vendorDescriptor = {
	vendor: CUSTOM_AI_VENDOR,
	displayName: localize('customAi.vendorDisplayName', 'Custom AI'),
	configuration: undefined,
	managementCommand: undefined,
	when: undefined,
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'customAi',
	title: localize('customAi.configurationTitle', 'Custom AI'),
	type: 'object',
	properties: {
		'custom.ai.enabled': {
			type: 'boolean',
			default: true,
			description: localize('custom.ai.enabled', 'Enable the built-in Custom AI chat participant and language models.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.provider': {
			type: 'string',
			enum: ['ollama', 'openaiCompatible', 'both'],
			default: 'both',
			description: localize('custom.ai.provider', 'Which Custom AI backends to expose in the model picker.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.defaultModelIdentifier': {
			type: 'string',
			default: '',
			description: localize('custom.ai.defaultModelIdentifier', 'Optional override for the language model id (e.g. customAi:ollama or customAi:openaiCompatible). When empty, the picker selection or provider default is used.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.ollama.baseUrl': {
			type: 'string',
			default: 'http://127.0.0.1:11434',
			description: localize('custom.ai.ollama.baseUrl', 'Base URL for the local Ollama server.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.ollama.model': {
			type: 'string',
			default: 'llama3.1',
			description: localize('custom.ai.ollama.model', 'Ollama model name passed to /api/chat.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.openaiCompatible.baseUrl': {
			type: 'string',
			default: 'https://api.openai.com/v1',
			description: localize('custom.ai.openaiCompatible.baseUrl', 'Base URL for an OpenAI-compatible Chat Completions API (include /v1 when required).'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.openaiCompatible.model': {
			type: 'string',
			default: 'gpt-4o-mini',
			description: localize('custom.ai.openaiCompatible.model', 'Model name sent to the OpenAI-compatible /chat/completions endpoint.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.tools.enabled': {
			type: 'boolean',
			default: true,
			description: localize('custom.ai.tools.enabled', 'When enabled, Custom AI registers built-in chat tools with the model (tool-calling).'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.edit.applyMode': {
			type: 'string',
			enum: ['review', 'direct'],
			default: 'review',
			enumDescriptions: [
				localize('custom.ai.edit.applyMode.review', 'Show a diff in the chat and require the user to accept the edit (only works in Edit or Agent mode; falls back to direct write otherwise).'),
				localize('custom.ai.edit.applyMode.direct', 'Apply Custom AI edits to disk immediately without a review step.'),
			],
			description: localize('custom.ai.edit.applyMode', 'How file edits from Custom AI are applied to the workspace.'),
			scope: ConfigurationScope.APPLICATION,
		},
		'custom.ai.systemPrompt': {
			type: 'string',
			default: 'You are a helpful coding assistant inside VS Code.',
			description: localize('custom.ai.systemPrompt', 'Optional system prompt prepended to each conversation.'),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CUSTOM_AI_SET_KEY_COMMAND,
			title: localize2('customAi.setOpenaiApiKey', 'Custom AI: Set OpenAI API Key'),
			category: Categories.Preferences,
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const secrets = accessor.get(ISecretStorageService);
		const log = accessor.get(ILogService);
		const input = await quickInput.input({ prompt: localize('customAi.enterApiKey', 'Enter OpenAI-compatible API key (stored locally in secret storage)') });
		if (input === undefined) {
			return;
		}
		try {
			await secrets.set(CUSTOM_AI_SECRET_OPENAI_API_KEY, input);
			log.info('[CustomAi] Stored OpenAI-compatible API key');
		} catch (e) {
			log.error('[CustomAi] Failed to store API key', e);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD,
			title: localize2('customAi.openOllamaDownload', 'Custom AI: Open Ollama Download Page'),
			category: Categories.Preferences,
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IOpenerService).open(URI.parse(CUSTOM_AI_OLLAMA_DOWNLOAD_URL), { openExternal: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS,
			title: localize2('customAi.openOllamaSettings', 'Custom AI: Open Ollama Settings'),
			category: Categories.Preferences,
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IPreferencesService).openSettings({ jsonEditor: false, query: '@id:custom.ai.ollama.baseUrl @id:custom.ai.ollama.model' });
	}
});

export class CustomAiContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.customAi';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILanguageModelsService private readonly _languageModels: ILanguageModelsService,
		@IChatAgentService private readonly _chatAgents: IChatAgentService,
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
	) {
		super();
		this._register(toDisposable(() => {
			this._languageModels.deltaLanguageModelChatProviderDescriptors([], [vendorDescriptor]);
		}));
		this._languageModels.deltaLanguageModelChatProviderDescriptors([vendorDescriptor], []);

		const provider = this._register(instantiationService.createInstance(CustomAiModelProvider));
		this._register(this._languageModels.registerLanguageModelProvider(CUSTOM_AI_VENDOR, provider));

		const editFileTool = instantiationService.createInstance(CustomAiEditFileTool);
		this._register(toolsService.registerTool(CustomAiEditFileToolData, editFileTool));

		const agentImpl = this._register(instantiationService.createInstance(CustomAiChatAgent));
		this._register(this._chatAgents.registerAgent('custom.ai', {
			id: 'custom.ai',
			name: 'custom',
			fullName: localize('customAi.agentFullName', 'Custom AI'),
			description: localize('customAi.agentDescription', 'Local and BYO-key chat using Ollama or an OpenAI-compatible API.'),
			when: 'config.custom.ai.enabled',
			extensionId: nullExtensionDescription.identifier,
			extensionVersion: nullExtensionDescription.version,
			extensionPublisherId: nullExtensionDescription.publisher,
			extensionDisplayName: localize('customAi.extensionDisplayName', 'Custom AI'),
			publisherDisplayName: localize('customAi.publisher', 'Custom'),
			isDefault: true,
			isCore: true,
			metadata: {},
			slashCommands: [],
			locations: [ChatAgentLocation.Chat],
			modes: [ChatModeKind.Ask, ChatModeKind.Agent, ChatModeKind.Edit],
			disambiguation: [],
		}));
		this._register(this._chatAgents.registerAgentImplementation('custom.ai', agentImpl));
	}
}

registerWorkbenchContribution2(CustomAiContribution.ID, CustomAiContribution, WorkbenchPhase.AfterRestored);

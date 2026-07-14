/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { AgentSandboxSettingId } from '../../../../../platform/sandbox/common/settings.js';
import { TerminalSettingId } from '../../../../../platform/terminal/common/terminal.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { registerWorkbenchContribution2, WorkbenchPhase, type IWorkbenchContribution } from '../../../../common/contributions.js';
import { IChatContextPickService, IChatContextValueItem } from '../../../chat/browser/attachments/chatContextPickService.js';
import { ChatContextKeys } from '../../../chat/common/actions/chatContextKeys.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { IChatWidget } from '../../../chat/browser/chat.js';
import { IChatRequestVariableEntry } from '../../../chat/common/attachments/chatVariableEntries.js';
import { IChatExecuteActionContext } from '../../../chat/browser/actions/chatExecuteActions.js';
import { CHAT_CATEGORY } from '../../../chat/browser/actions/chatActions.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { addTerminalSelectionToChat, createTerminalSelectionAttachment } from './addTerminalSelectionToChat.js';
import { ILanguageModelToolsService } from '../../../chat/common/tools/languageModelToolsService.js';
import { IToolResultCompressor } from '../../../chat/common/tools/toolResultCompressor.js';
import { sharedWhenClause } from '../../../terminal/browser/terminalActions.js';
import { TerminalContextMenuGroup } from '../../../terminal/browser/terminalMenus.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { TerminalChatAgentToolsCommandId } from '../common/terminal.chatAgentTools.js';
import { TerminalChatAgentToolsSettingId } from '../common/terminalChatAgentToolsConfiguration.js';
import { AgentNetworkDomainSettingId } from '../../../../../platform/networkFilter/common/settings.js';
import { AgentHostSandboxForwarder } from './agentHostSandboxForwarder.js';
import { GetTerminalLastCommandTool, GetTerminalLastCommandToolData } from './tools/getTerminalLastCommandTool.js';
import { KillTerminalTool, KillTerminalToolData } from './tools/killTerminalTool.js';
import { GetTerminalOutputTool, GetTerminalOutputToolData } from './tools/getTerminalOutputTool.js';
import { SendToTerminalTool, SendToTerminalToolData } from './tools/sendToTerminalTool.js';
import { GetTerminalSelectionTool, GetTerminalSelectionToolData } from './tools/getTerminalSelectionTool.js';
import { ConfirmTerminalCommandTool, ConfirmTerminalCommandToolData } from './tools/runInTerminalConfirmationTool.js';
import { RunInTerminalTool, createRunInTerminalToolData } from './tools/runInTerminalTool.js';
import { CreateAndRunTaskTool, CreateAndRunTaskToolData } from './tools/task/createAndRunTaskTool.js';
import { GetTaskOutputTool, GetTaskOutputToolData } from './tools/task/getTaskOutputTool.js';
import { RunTaskTool, RunTaskToolData } from './tools/task/runTaskTool.js';
import { registerTerminalCompressors } from './tools/terminalOutputCompressor.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { IWindowsMxcTerminalSandboxRuntime, WindowsMxcTerminalSandboxRuntime } from '../../../../../platform/sandbox/common/terminalSandboxMxcRuntime.js';
import { ITerminalSandboxService, TerminalSandboxService } from '../common/terminalSandboxService.js';
import { isNumber } from '../../../../../base/common/types.js';

// #region Services

registerSingleton(IWindowsMxcTerminalSandboxRuntime, WindowsMxcTerminalSandboxRuntime, InstantiationType.Delayed);
registerSingleton(ITerminalSandboxService, TerminalSandboxService, InstantiationType.Delayed);

// #endregion Services

class ShellIntegrationTimeoutMigrationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'terminal.shellIntegrationTimeoutMigration';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();
		const deprecated = configurationService.inspect<number>(TerminalChatAgentToolsSettingId.ShellIntegrationTimeout);
		const target = configurationService.inspect<number>(TerminalSettingId.ShellIntegrationTimeout);
		if (deprecated.userValue !== undefined && target.userValue === undefined && isNumber(deprecated.userValue)) {
			configurationService.updateValue(TerminalSettingId.ShellIntegrationTimeout, deprecated.userValue, ConfigurationTarget.USER);
		}
		if (deprecated.workspaceValue !== undefined && target.workspaceValue === undefined && isNumber(deprecated.workspaceValue)) {
			configurationService.updateValue(TerminalSettingId.ShellIntegrationTimeout, deprecated.workspaceValue, ConfigurationTarget.WORKSPACE);
		}
	}
}
registerWorkbenchContribution2(ShellIntegrationTimeoutMigrationContribution.ID, ShellIntegrationTimeoutMigrationContribution, WorkbenchPhase.Eventually);

class OutputLocationMigrationContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'terminal.outputLocationMigration';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();
		// Migrate legacy 'none' value to 'chat'
		const currentValue = configurationService.getValue<unknown>(TerminalChatAgentToolsSettingId.OutputLocation);
		if (currentValue === 'none') {
			configurationService.updateValue(TerminalChatAgentToolsSettingId.OutputLocation, 'chat');
		}
	}
}
registerWorkbenchContribution2(OutputLocationMigrationContribution.ID, OutputLocationMigrationContribution, WorkbenchPhase.Eventually);

export class ChatAgentToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'terminal.chatAgentTools';

	private readonly _runInTerminalToolRegistration = this._register(new MutableDisposable<DisposableStore>());
	private _runInTerminalToolRegistrationVersion = 0;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IToolResultCompressor toolResultCompressor: IToolResultCompressor,
	) {
		super();

		registerTerminalCompressors(toolResultCompressor);

		// #region Terminal

		const confirmTerminalCommandTool = _instantiationService.createInstance(ConfirmTerminalCommandTool);
		this._register(_toolsService.registerTool(ConfirmTerminalCommandToolData, confirmTerminalCommandTool));
		const getTerminalOutputTool = _instantiationService.createInstance(GetTerminalOutputTool);
		this._register(_toolsService.registerTool(GetTerminalOutputToolData, getTerminalOutputTool));
		this._register(_toolsService.executeToolSet.addTool(GetTerminalOutputToolData));

		const killTerminalTool = _instantiationService.createInstance(KillTerminalTool);
		this._register(_toolsService.registerTool(KillTerminalToolData, killTerminalTool));
		this._register(_toolsService.executeToolSet.addTool(KillTerminalToolData));

		const sendToTerminalTool = _instantiationService.createInstance(SendToTerminalTool);
		this._register(_toolsService.registerTool(SendToTerminalToolData, sendToTerminalTool));
		this._register(_toolsService.executeToolSet.addTool(SendToTerminalToolData));

		this._registerRunInTerminalTool();

		const getTerminalSelectionTool = _instantiationService.createInstance(GetTerminalSelectionTool);
		this._register(_toolsService.registerTool(GetTerminalSelectionToolData, getTerminalSelectionTool));

		const getTerminalLastCommandTool = _instantiationService.createInstance(GetTerminalLastCommandTool);
		this._register(_toolsService.registerTool(GetTerminalLastCommandToolData, getTerminalLastCommandTool));

		this._register(_toolsService.readToolSet.addTool(GetTerminalSelectionToolData));
		this._register(_toolsService.readToolSet.addTool(GetTerminalLastCommandToolData));

		// #endregion

		// #region Tasks

		const runTaskTool = _instantiationService.createInstance(RunTaskTool);
		this._register(_toolsService.registerTool(RunTaskToolData, runTaskTool));

		const getTaskOutputTool = _instantiationService.createInstance(GetTaskOutputTool);
		this._register(_toolsService.registerTool(GetTaskOutputToolData, getTaskOutputTool));

		const createAndRunTaskTool = _instantiationService.createInstance(CreateAndRunTaskTool);
		this._register(_toolsService.registerTool(CreateAndRunTaskToolData, createAndRunTaskTool));
		this._register(_toolsService.executeToolSet.addTool(RunTaskToolData));
		this._register(_toolsService.executeToolSet.addTool(CreateAndRunTaskToolData));
		this._register(_toolsService.readToolSet.addTool(GetTaskOutputToolData));

		// #endregion

		// Re-register run_in_terminal tool when sandbox-related settings change,
		// so the tool description and input schema stay in sync with the current
		// sandbox state.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(AgentSandboxSettingId.AgentSandboxEnabled) ||
				e.affectsConfiguration(AgentSandboxSettingId.AgentSandboxWindowsEnabled) ||
				e.affectsConfiguration(AgentSandboxSettingId.AgentSandboxAllowNetwork) ||
				e.affectsConfiguration(AgentSandboxSettingId.DeprecatedAgentSandboxEnabled) ||
				e.affectsConfiguration(AgentSandboxSettingId.AgentSandboxAllowUnsandboxedCommands) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.DeprecatedOldAllowedNetworkDomains) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.DeprecatedOldDeniedNetworkDomains) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.DeprecatedSandboxAllowedNetworkDomains) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.DeprecatedSandboxDeniedNetworkDomains) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.AgentSandboxLinuxFileSystem) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.DeprecatedAgentSandboxLinuxFileSystem) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.AgentSandboxMacFileSystem) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.DeprecatedAgentSandboxMacFileSystem) ||
				e.affectsConfiguration(TerminalChatAgentToolsSettingId.AgentSandboxWindowsFileSystem)
			) {
				this._registerRunInTerminalTool();
			}
		}));
	}

	private _runInTerminalTool: RunInTerminalTool | undefined;

	private _registerRunInTerminalTool(): void {
		const version = ++this._runInTerminalToolRegistrationVersion;
		this._instantiationService.invokeFunction(createRunInTerminalToolData).then(runInTerminalToolData => {
			if (this._store.isDisposed || version !== this._runInTerminalToolRegistrationVersion) {
				return;
			}
			if (!this._runInTerminalTool) {
				this._runInTerminalTool = this._register(this._instantiationService.createInstance(RunInTerminalTool));
			}
			// Dispose old registration first so registerToolData doesn't throw
			// "already registered" for the same tool ID.
			this._runInTerminalToolRegistration.value = undefined;
			const store = new DisposableStore();
			store.add(this._toolsService.registerToolData(runInTerminalToolData));
			store.add(this._toolsService.registerToolImplementation(runInTerminalToolData.id, this._runInTerminalTool));
			store.add(this._toolsService.executeToolSet.addTool(runInTerminalToolData));
			this._runInTerminalToolRegistration.value = store;
		});
	}
}
registerWorkbenchContribution2(ChatAgentToolsContribution.ID, ChatAgentToolsContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(AgentHostSandboxForwarder.ID, AgentHostSandboxForwarder, WorkbenchPhase.AfterRestored);

// #endregion Contributions

class TerminalSelectionContextValuePick implements IChatContextValueItem {
	readonly type = 'valuePick';
	readonly label = localize('terminalSelection', 'Terminal Selection');
	readonly icon = Codicon.terminal;
	readonly ordinal = 750;
	readonly commandId = TerminalChatAgentToolsCommandId.ChatAddTerminalSelection;

	constructor(@ITerminalService private readonly _terminalService: ITerminalService) { }

	isEnabled(_widget: IChatWidget): boolean {
		return !!this._terminalService.activeInstance?.selection;
	}

	async asAttachment(_widget: IChatWidget): Promise<IChatRequestVariableEntry | undefined> {
		const selection = this._terminalService.activeInstance?.selection;
		return selection ? createTerminalSelectionAttachment(selection) : undefined;
	}
}

class TerminalSelectionChatContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.terminalSelectionChatContext';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IChatContextPickService contextPickService: IChatContextPickService,
	) {
		super();
		this._register(contextPickService.registerChatContextItem(instantiationService.createInstance(TerminalSelectionContextValuePick)));
	}
}

registerWorkbenchContribution2(TerminalSelectionChatContextContribution.ID, TerminalSelectionChatContextContribution, WorkbenchPhase.AfterRestored);

class AttachTerminalSelectionToChatAction extends Action2 {
	constructor() {
		super({
			id: TerminalChatAgentToolsCommandId.ChatAddTerminalSelection,
			title: localize2('addTerminalSelection', 'Add Terminal Selection to Chat'),
			icon: Codicon.terminal,
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(ChatContextKeys.enabled, TerminalContextKeys.textSelected),
			menu: [{
				id: MenuId.TerminalInstanceContext,
				group: TerminalContextMenuGroup.Chat,
				order: 1,
				when: ContextKeyExpr.and(ChatContextKeys.enabled, TerminalContextKeys.textSelected, sharedWhenClause.terminalAvailable)
			}, {
				when: ContextKeyExpr.and(
					ChatContextKeys.inQuickChat.negate(),
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					TerminalContextKeys.textSelected,
					ContextKeyExpr.or(
						ChatContextKeys.lockedToCodingAgent.negate(),
						ChatContextKeys.agentSupportsAttachments
					)
				),
				id: MenuId.ChatInput,
				group: 'navigation',
				order: 0
			}],
		});
	}

	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const context = args[0] as IChatExecuteActionContext | undefined;
		const terminalService = accessor.get(ITerminalService);
		const selection = terminalService.activeInstance?.selection;
		if (!selection) {
			return;
		}
		await addTerminalSelectionToChat(accessor, selection, context?.widget);
	}
}

// #region Actions

registerAction2(AttachTerminalSelectionToChatAction);

// #endregion Actions

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { MarkdownString } from '../../../vs/base/common/htmlContent.js';
import { Disposable } from '../../../vs/base/common/lifecycle.js';
import { basename } from '../../../vs/base/common/resources.js';
import { URI } from '../../../vs/base/common/uri.js';
import { IConfigurationService } from '../../../vs/platform/configuration/common/configuration.js';
import { IFileService } from '../../../vs/platform/files/common/files.js';
import { ILogService } from '../../../vs/platform/log/common/log.js';
import { IOpenerService } from '../../../vs/platform/opener/common/opener.js';
import { IQuickInputService } from '../../../vs/platform/quickinput/common/quickInput.js';
import { IRequestService } from '../../../vs/platform/request/common/request.js';
import { ISecretStorageService } from '../../../vs/platform/secrets/common/secrets.js';
import { IRange, Range } from '../../../vs/editor/common/core/range.js';
import { Command, isLocation } from '../../../vs/editor/common/languages.js';
import { IModelService } from '../../../vs/editor/common/services/model.js';
import { IChatRequestVariableEntry } from '../../../vs/workbench/contrib/chat/common/attachments/chatVariableEntries.js';
import {
	ChatMessageRole,
	IChatMessage,
	IChatMessagePart,
	IChatResponseTextPart,
	IChatResponseToolUsePart,
	ILanguageModelsService,
} from '../../../vs/workbench/contrib/chat/common/languageModels.js';
import {
	CountTokensCallback,
	ILanguageModelToolsService,
	IToolResult,
	IToolResultTextPart,
} from '../../../vs/workbench/contrib/chat/common/tools/languageModelToolsService.js';
import {
	IChatAgentHistoryEntry,
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
} from '../../../vs/workbench/contrib/chat/common/participants/chatAgents.js';
import { ChatErrorLevel, IChatFollowup, IChatMarkdownContent, IChatProgress } from '../../../vs/workbench/contrib/chat/common/chatService/chatService.js';
import { IChatProgressHistoryResponseContent } from '../../../vs/workbench/contrib/chat/common/model/chatModel.js';
import { localize } from '../../../vs/nls.js';
import { promptForCustomAiApiKey } from './customAiApiKeyPrompt.js';
import {
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD,
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS,
	CUSTOM_AI_MODEL_OLLAMA,
	CUSTOM_AI_OLLAMA_DOWNLOAD_URL,
	CUSTOM_AI_SECRET_OPENAI_API_KEY,
	isCustomAiOpenAiCompatibleModelId,
	pickCustomAiOpenAiCompatibleModelId,
} from '../common/customAiConstants.js';
import { CustomAiInvalidApiKeyError, readAllStreamText, toolsToOpenAiFunctions } from './customAiModelProvider.js';
import { IGoalConsoleService, listGoalWorkspaceCrossAppWorkflows, type GoalWorkspaceContextFile, type GoalWorkspaceIxOverlay, type GoalWorkspaceState, type GoalSurface } from '../../goalWorkspace/GoalConsoleService.js';
import { SurfaceBuilderHandoffState } from '../../goalWorkspace/surfaceBuilderHandoffState.js';
import { CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_GUIDANCE, CUSTOM_AI_SURFACE_SCAFFOLD_GUIDANCE, CUSTOM_AI_SURFACE_SCAFFOLD_LINES } from '../common/customAiSurfaceScaffold.js';
import { ICustomAiChatTraceService, summarizeTraceMessages } from './customAiChatTrace.js';

const MAX_TOOL_ROUNDS = 15;
const ATTACHMENT_MAX_BYTES_PER_FILE = 64 * 1024;
const ATTACHMENT_MAX_BYTES_TOTAL = 256 * 1024;
const MAX_GOAL_CONTEXT_FILES = 8;
const MAX_GOAL_SURFACES = 12;
const MAX_IX_SUBSYSTEMS = 8;

export const CUSTOM_AI_PRODUCT_SYSTEM_PROMPT = [
	'You are Custom AI inside a goal-workspace IDE.',
	'The user is usually creating or editing a collection of related app surfaces that serve one business goal.',
	'Use the goal workspace as the product model: goal, surfaces, shared domain, events, workflows, analytics, durable memory, and Ix/code metadata.',
	'For business/product changes, first identify the affected surfaces and shared context, then make cohesive edits across the manifest, app files, shared packages, and agent memory as needed.',
	'When creating a new surface, finalize `.agent/surfaces/<surface-id>.blueprint.json` before scaffolding, then register it in workspace.goal.json, scaffold app files, call `verifySurfaceBlueprint`, and connect shared workflows/entities/events.',
	CUSTOM_AI_SURFACE_SCAFFOLD_GUIDANCE,
	CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_GUIDANCE,
	'Ask one focused question only when a missing business decision would materially change the implementation.'
].join('\n');

export const CUSTOM_AI_EDIT_TOOL_SYSTEM_PROMPT = [
	'You have a function-calling tool named `editFile` that modifies or creates files in the user\'s workspace.',
	'When the user asks you to change, write, refactor, fix, or create code and the needed context is clear, call `editFile` with the new file contents.',
	'For goal-workspace changes, plan affected surfaces and shared context before editing, then include all needed manifest, app, shared workflow/domain/event, memory, and Ix metadata updates.',
	'Do not tell the user to make changes manually if you can call the tool.',
	'When proposing an edit, return the full updated file in the `code` argument and use the workspace-relative path in `uri`.'
].join(' ');

function isFailedToFetchError(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	const m = err.message;
	return err.name === 'TypeError' && (m === 'Failed to fetch' || m.includes('Failed to fetch'));
}

function isMissingOpenAiKeyMessage(message: string): boolean {
	return message.includes('OpenAI-compatible API key is not set');
}

function formatCustomAiChatError(
	err: unknown,
	modelId: string,
	ollamaBase: string,
	openAiBase: string,
	ollamaModel: string,
): string {
	const raw = err instanceof Error ? err.message : String(err);
	if (isMissingOpenAiKeyMessage(raw)) {
		return localize(
			'customAi.error.missingApiKey',
			'No API key stored for the OpenAI-compatible backend. Send your message again to be prompted for a key, or run **Custom AI: Set OpenAI API Key** from the Command Palette.',
		);
	}
	if (!isFailedToFetchError(err)) {
		return raw;
	}
	if (modelId === CUSTOM_AI_MODEL_OLLAMA) {
		return localize(
			'customAi.error.ollamaUnreachable',
			'Could not reach Ollama at **{0}**. Install from {1}, start Ollama, then try again. If it is already installed, check **custom.ai.ollama.baseUrl** or use **Custom AI: Open Ollama Settings**. Model in settings: `{2}`.',
			ollamaBase,
			CUSTOM_AI_OLLAMA_DOWNLOAD_URL,
			ollamaModel,
		);
	}
	if (isCustomAiOpenAiCompatibleModelId(modelId)) {
		return localize(
			'customAi.error.openAiCompatibleUnreachable',
			'Could not reach the OpenAI-compatible API at {0} (connection failed).\n\n- Check **custom.ai.openaiCompatible.baseUrl**, VPN, and corporate proxy\n- Run **Custom AI: Set OpenAI API Key** if you have not stored a key',
			openAiBase,
		);
	}
	return localize('customAi.error.networkGeneric', 'Network request failed ({0}). Check your model backend URL and connectivity.', raw);
}

export function buildCustomAiGoalWorkspaceContextBlock(state: GoalWorkspaceState): string | undefined {
	if (state.status === 'no-workspace') {
		return undefined;
	}

	if (state.status === 'missing') {
		return [
			'Goal workspace context:',
			'- A workspace is open, but workspace.goal.json is missing.',
			'- If the user is starting a business goal workspace, create workspace.goal.json before scaffolding surfaces.'
		].join('\n');
	}

	if (state.status === 'invalid') {
		const diagnostics = state.diagnostics.slice(0, 6).map(diagnostic => `  - ${diagnostic.path}: ${diagnostic.message}`);
		return [
			'Goal workspace context:',
			'- workspace.goal.json is present but invalid.',
			...diagnostics,
			'- Fix the manifest before relying on surface metadata.'
		].join('\n');
	}

	const workspace = state.workspace;
	if (!workspace) {
		return undefined;
	}

	const lines: string[] = [
		'Goal workspace context:',
		`- Goal: ${workspace.goal.name} (${workspace.goal.id})`,
		...(workspace.goal.description ? [`- Description: ${workspace.goal.description}`] : []),
		...(workspace.goal.northStarMetric ? [`- North-star metric: ${workspace.goal.northStarMetric}`] : []),
		`- Surfaces: ${workspace.surfaces.length ? workspace.surfaces.slice(0, MAX_GOAL_SURFACES).map(formatSurfaceSummary).join('; ') : 'none registered yet'}`,
	];

	const sharedEntries = Object.entries(workspace.shared).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0);
	if (sharedEntries.length) {
		lines.push(`- Shared paths: ${sharedEntries.map(([key, value]) => `${key}=${value}`).join(', ')}`);
	}

	const contextFiles = [
		...state.context.globalFiles,
		...state.context.surfaceFiles
	].slice(0, MAX_GOAL_CONTEXT_FILES);
	if (contextFiles.length) {
		lines.push('- Durable memory/context:');
		for (const file of contextFiles) {
			lines.push(`  - ${formatContextFile(file)}`);
		}
	}

	if (state.ix.overlay) {
		lines.push(...formatGoalWorkspaceIxContextLines(state.ix.overlay));
	}

	lines.push('- For new or changed surfaces, keep workspace.goal.json, app files, shared workflows/domain/events, durable memory, and Ix metadata coherent.');
	lines.push(`- Surface scaffold default: ${CUSTOM_AI_SURFACE_SCAFFOLD_LINES[0]}`);
	return lines.join('\n');
}

function formatSurfaceSummary(surface: GoalSurface): string {
	const parts = [`${surface.name} (${surface.id})`];
	if (surface.path) {
		parts.push(`path=${surface.path}`);
	}
	if (surface.purpose) {
		parts.push(`purpose=${surface.purpose}`);
	}
	if (surface.capabilities.length) {
		parts.push(`capabilities=${surface.capabilities.join(',')}`);
	}
	if (surface.events.length) {
		parts.push(`events=${surface.events.join(',')}`);
	}
	if (surface.entities.length) {
		parts.push(`entities=${surface.entities.join(',')}`);
	}
	if (surface.ixSubsystems.length) {
		parts.push(`ix=${surface.ixSubsystems.join(',')}`);
	}
	return parts.join(' ');
}

function formatContextFile(file: GoalWorkspaceContextFile): string {
	return `${file.relativePath} (${file.kind}): ${file.summary}`;
}

export function formatGoalWorkspaceIxContextLines(overlay: GoalWorkspaceIxOverlay): string[] {
	const lines: string[] = ['- Ix overlay:'];
	if (overlay.generatedAt) {
		lines.push(`  - generatedAt: ${overlay.generatedAt}`);
	}
	if (overlay.command) {
		lines.push(`  - command: ${overlay.command}`);
	}
	if (overlay.discoveredSubsystems.length) {
		lines.push('  - Discovered subsystems:');
		for (const subsystem of overlay.discoveredSubsystems.slice(0, MAX_IX_SUBSYSTEMS)) {
			const pathSuffix = subsystem.path ? ` path=${subsystem.path}` : '';
			lines.push(`    - ${subsystem.label} (${subsystem.id})${pathSuffix}`);
		}
	}
	if (overlay.surfaces.length) {
		lines.push('  - Surface mappings:');
		for (const mapping of overlay.surfaces.slice(0, MAX_GOAL_SURFACES)) {
			const labels = mapping.subsystemLabels.join(', ');
			const reason = mapping.matchReason ? ` — ${mapping.matchReason}` : '';
			lines.push(`    - ${mapping.surfaceId} -> ${labels}${reason}`);
		}
	}
	return lines;
}

export function buildCustomAiWorkflowToolHint(state: GoalWorkspaceState): string | undefined {
	if (state.status !== 'loaded') {
		return undefined;
	}
	const workflows = listGoalWorkspaceCrossAppWorkflows();
	if (!workflows.length) {
		return undefined;
	}
	const catalog = workflows.map(workflow => `${workflow.id} (${workflow.label})`).join(', ');
	return [
		'Before multi-surface business changes, call `planCrossAppWorkflow` with a known workflow id when one applies.',
		`Known workflows: ${catalog}.`
	].join(' ');
}

export function buildCustomAiSurfaceHandoffContextBlock(): string | undefined {
	const handoff = SurfaceBuilderHandoffState.getActive();
	if (!handoff || handoff.kind !== 'surface') {
		return undefined;
	}
	return [
		'Surface builder handoff:',
		`- Phase: ${handoff.phase}`,
		`- Surface: ${handoff.surfaceName} (${handoff.surfaceId})`,
		`- Template: ${handoff.templateId}`,
		handoff.blueprintResource ? `- Blueprint: ${handoff.blueprintResource}` : undefined,
		handoff.phase === 'blueprint'
			? '- Edit the blueprint JSON only. Do not scaffold app files yet.'
			: undefined,
		handoff.phase === 'scaffold'
			? '- Scaffold every blueprint subsystem, update workspace.goal.json, then call verifySurfaceBlueprint.'
			: undefined,
		handoff.phase === 'repair'
			? '- Fix only the reported blueprint gaps, then call verifySurfaceBlueprint again.'
			: undefined,
	].filter((line): line is string => Boolean(line)).join('\n');
}

export interface CustomAiSystemMessageOptions {
	readonly customSystemPrompt?: string;
	readonly toolsEnabled: boolean;
	readonly goalWorkspaceState: GoalWorkspaceState;
}

export function buildCustomAiSystemMessageParts(options: CustomAiSystemMessageOptions): string[] {
	const parts: string[] = [CUSTOM_AI_PRODUCT_SYSTEM_PROMPT];
	const goalWorkspaceContext = buildCustomAiGoalWorkspaceContextBlock(options.goalWorkspaceState);
	if (goalWorkspaceContext) {
		parts.push(goalWorkspaceContext);
	}
	const workflowHint = buildCustomAiWorkflowToolHint(options.goalWorkspaceState);
	if (workflowHint) {
		parts.push(workflowHint);
	}
	const handoffContext = buildCustomAiSurfaceHandoffContextBlock();
	if (handoffContext) {
		parts.push(handoffContext);
	}
	if (options.customSystemPrompt?.trim()) {
		parts.push(options.customSystemPrompt.trim());
	}
	if (options.toolsEnabled) {
		parts.push(CUSTOM_AI_EDIT_TOOL_SYSTEM_PROMPT);
	}
	return parts;
}

export class CustomAiChatAgent extends Disposable implements IChatAgentImplementation {

	constructor(
		@ILanguageModelsService private readonly _languageModels: ILanguageModelsService,
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ISecretStorageService private readonly _secretStorage: ISecretStorageService,
		@IQuickInputService private readonly _quickInput: IQuickInputService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IRequestService private readonly _requestService: IRequestService,
		@IFileService private readonly _fileService: IFileService,
		@IModelService private readonly _modelService: IModelService,
		@IGoalConsoleService private readonly _goalConsoleService: IGoalConsoleService,
		@ICustomAiChatTraceService private readonly _traceService: ICustomAiChatTraceService,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		return this._invokeInternal(request, progress, history, token, false);
	}

	private async _invokeInternal(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken, retryAfterKeyUpdate: boolean): Promise<IChatAgentResult> {
		const emit = (p: IChatProgress) => progress([p]);
		let modelId = '';
		let trace: ReturnType<ICustomAiChatTraceService['createRun']> | undefined;
		try {
			if (!this._configurationService.getValue<boolean>('custom.ai.enabled')) {
				emit({ kind: 'markdownContent', content: new MarkdownString('Enable **custom.ai.enabled** in settings to use Custom AI.', false) } satisfies IChatMarkdownContent);
				return {};
			}

			modelId = this._resolveModelId(request);
			trace = this._traceService.createRun({
				requestId: request.requestId,
				sessionResource: request.sessionResource,
				modelId,
			});
			trace.event('chat.model.resolved', {
				modelId,
				userSelectedModelId: request.userSelectedModelId,
				goalWorkspace: summarizeGoalWorkspaceForTrace(this._goalConsoleService.getState()),
				retryAfterKeyUpdate,
			});
			const metadata = this._languageModels.lookupLanguageModel(modelId);
			if (!metadata) {
				trace.fail(new Error(`Unknown model ${modelId}`), { phase: 'model.lookup' });
				emit({ kind: 'markdownContent', content: new MarkdownString(`Unknown model **${modelId}**. Pick a Custom AI model in the chat model picker.`, false) } satisfies IChatMarkdownContent);
				return {};
			}

			if (isCustomAiOpenAiCompatibleModelId(modelId)) {
				const keyOk = await this._ensureOpenAiApiKey(token);
				if (!keyOk) {
					trace.cancel({ phase: 'apiKey' });
					return {
						errorDetails: {
							message: localize(
								'customAi.error.apiKeyRequired',
								'An OpenAI-compatible API key is required. You canceled or left the key empty — try sending again to enter a key, or use **Custom AI: Set OpenAI API Key** from the Command Palette.',
							),
						},
					};
				}
			}

			if (modelId === CUSTOM_AI_MODEL_OLLAMA) {
				const ollamaBase = (this._configurationService.getValue<string>('custom.ai.ollama.baseUrl') ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
				const ollamaModel = this._configurationService.getValue<string>('custom.ai.ollama.model') ?? 'llama3.1';
				const ollamaReady = await this._checkOllamaReady(ollamaBase, ollamaModel, token);
				if (!ollamaReady.ok) {
					trace.fail(new Error(`Ollama preflight failed: ${ollamaReady.reason}`), {
						phase: 'ollama.preflight',
						ollamaBase,
						ollamaModel,
						reason: ollamaReady.reason,
					});
					const message = ollamaReady.reason === 'missingModel'
						? localize(
							'customAi.error.ollamaMissingModel',
							'Ollama is running, but model **{0}** is not installed yet. In a terminal run `ollama pull {0}`, then send your message again.',
							ollamaModel,
						)
						: localize(
							'customAi.error.ollamaOffline',
							'**Ollama is not reachable** at {0}. Use the buttons below, or install from {1} and start the Ollama app (or run `ollama serve`).',
							ollamaBase,
							CUSTOM_AI_OLLAMA_DOWNLOAD_URL,
						);
					this._logService.warn('[CustomAi] Ollama preflight failed', ollamaReady.reason);
					const primary: Command = {
						id: CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD,
						title: localize('customAi.command.installOllama', 'Install Ollama'),
						tooltip: localize('customAi.command.installOllama.tooltip', 'Open the Ollama download page in your browser'),
					};
					const secondary: Command = {
						id: CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS,
						title: localize('customAi.command.ollamaSettings', 'Ollama connection settings'),
						tooltip: localize('customAi.command.ollamaSettings.tooltip', 'Open settings for base URL and model name'),
					};
					emit({ kind: 'command', command: primary, additionalCommands: [secondary] });
					return {
						errorDetails: {
							message,
							isExpectedError: true,
							level: ChatErrorLevel.Warning,
						},
					};
				}
			}

			const messages = await this._buildMessages(request, history, token);
			trace.event('chat.context.assembled', {
				...summarizeTraceMessages(messages),
				historyEntries: history.length,
				goalWorkspace: summarizeGoalWorkspaceForTrace(this._goalConsoleService.getState()),
			});
			const countTokens: CountTokensCallback = async (input, t) => this._languageModels.computeTokenLength(modelId, input, t);
			let totalTextChunks = 0;
			let totalResponseChars = 0;
			let totalToolUses = 0;

			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				if (token.isCancellationRequested) {
					trace.cancel({ phase: 'beforeRound', round });
					return {};
				}

				const toolsEnabled = this._configurationService.getValue<boolean>('custom.ai.tools.enabled') !== false;
				const tools = toolsEnabled ? this._buildTools(metadata, request) : [];
				trace.event('chat.model.request.started', {
					round,
					toolsEnabled,
					toolCount: tools.length,
					messageSummary: summarizeTraceMessages(messages),
				});

				const lmResponse = await this._languageModels.sendChatRequest(
					modelId,
					undefined,
					messages,
					{ tools: tools.length ? tools : undefined },
					token,
				);

				const assistantParts: IChatMessagePart[] = [];
				let roundTextChunks = 0;
				let roundResponseChars = 0;
				let roundToolUses = 0;
				for await (const part of lmResponse.stream) {
					if (token.isCancellationRequested) {
						trace.cancel({ phase: 'stream', round });
						return {};
					}
					const parts = Array.isArray(part) ? part : [part];
					for (const p of parts) {
						if (p.type === 'text') {
							const t = p as IChatResponseTextPart;
							if (t.value) {
								roundTextChunks++;
								totalTextChunks++;
								roundResponseChars += t.value.length;
								totalResponseChars += t.value.length;
								trace.event('chat.response.chunk', {
									round,
									chunkChars: t.value.length,
									roundTextChunks,
									totalTextChunks,
									totalResponseChars,
								});
								emit({ kind: 'markdownContent', content: new MarkdownString(t.value, false) } satisfies IChatMarkdownContent);
								assistantParts.push({ type: 'text', value: t.value });
								// Yield so the workbench can paint incremental markdown (tight loops otherwise batch visually).
								await Promise.resolve();
							}
						} else if (p.type === 'tool_use') {
							const tu = p as IChatResponseToolUsePart;
							roundToolUses++;
							totalToolUses++;
							trace.event('chat.tool_call.detected', {
								round,
								toolName: tu.name,
								toolCallId: tu.toolCallId,
								parameters: summarizeToolParameters(tu.parameters),
							});
							assistantParts.push(tu);
						}
					}
				}
				await lmResponse.result;
				trace.event('chat.model.request.completed', {
					round,
					roundTextChunks,
					roundResponseChars,
					roundToolUses,
					assistantPartCount: assistantParts.length,
				});

				if (!assistantParts.length) {
					trace.event('chat.response.empty', { round });
					break;
				}

				messages.push({ role: ChatMessageRole.Assistant, content: assistantParts });

				const toolUses = assistantParts.filter((p): p is IChatResponseToolUsePart => p.type === 'tool_use');
				if (!toolUses.length) {
					trace.event('chat.tool_round.none', { round });
					break;
				}

				for (const tu of toolUses) {
					const toolData = this._toolsService.getToolByName(tu.name) ?? this._toolsService.getTool(tu.name);
					const toolId = toolData?.id ?? tu.name;
					this._toolsService.beginToolCall({
						toolCallId: tu.toolCallId,
						toolId,
						chatRequestId: request.requestId,
						sessionResource: request.sessionResource,
						force: true,
					});
					let toolResult: IToolResult;
					const toolStartedAt = Date.now();
					trace.event('chat.tool_call.started', {
						round,
						toolName: tu.name,
						toolId,
						toolCallId: tu.toolCallId,
						parameters: summarizeToolParameters(tu.parameters),
					});
					try {
						toolResult = await this._toolsService.invokeTool({
							callId: tu.toolCallId,
							toolId,
							parameters: typeof tu.parameters === 'object' && tu.parameters ? tu.parameters as Record<string, unknown> : {},
							context: { sessionResource: request.sessionResource },
							chatRequestId: request.requestId,
							chatStreamToolCallId: tu.toolCallId,
						}, countTokens, token);
						trace.event('chat.tool_call.completed', {
							round,
							toolName: tu.name,
							toolId,
							toolCallId: tu.toolCallId,
							durationMs: Date.now() - toolStartedAt,
							error: Boolean(toolResult.toolResultError),
							resultTextChars: toolResultTextCharLength(toolResult),
						});
					} catch (err) {
						this._logService.error('[CustomAi] Tool invocation failed', err);
						trace.event('chat.tool_call.failed', {
							round,
							toolName: tu.name,
							toolId,
							toolCallId: tu.toolCallId,
							durationMs: Date.now() - toolStartedAt,
							error: err instanceof Error ? err.message : String(err),
						});
						toolResult = {
							content: [{ kind: 'text', value: String(err) } satisfies IToolResultTextPart],
							toolResultError: true,
						};
					}
					messages.push({
						role: ChatMessageRole.User,
						content: [{ type: 'tool_result', toolCallId: tu.toolCallId, value: toolResultToChatParts(toolResult) }],
					});
				}
			}

			trace.complete({
				totalTextChunks,
				totalResponseChars,
				totalToolUses,
				finalMessageSummary: summarizeTraceMessages(messages),
			});
			return {};
		} catch (err) {
			trace?.fail(err, { phase: 'catch' });
			if (isCustomAiOpenAiCompatibleModelId(modelId) && err instanceof CustomAiInvalidApiKeyError && !retryAfterKeyUpdate) {
				this._logService.warn('[CustomAi] OpenAI-compatible API key rejected by server', err);
				try {
					await this._secretStorage.delete(CUSTOM_AI_SECRET_OPENAI_API_KEY);
				} catch (deleteErr) {
					this._logService.warn('[CustomAi] Failed to clear rejected API key', deleteErr);
				}
				const keyOk = await this._ensureOpenAiApiKey(token, { rejected: true });
				if (keyOk) {
					return this._invokeInternal(request, progress, history, token, true);
				}
				return {
					errorDetails: {
						message: localize(
							'customAi.error.apiKeyRejected',
							'The stored OpenAI-compatible API key was rejected by the server. You canceled or left the replacement key empty — send your message again to enter a valid key, or run **Custom AI: Set OpenAI API Key** from the Command Palette.',
						),
						isExpectedError: true,
						level: ChatErrorLevel.Warning,
					},
				};
			}

			const ollamaBase = (this._configurationService.getValue<string>('custom.ai.ollama.baseUrl') ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
			const openAiBase = (this._configurationService.getValue<string>('custom.ai.openaiCompatible.baseUrl') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
			const ollamaModel = this._configurationService.getValue<string>('custom.ai.ollama.model') ?? 'llama3.1';
			const display = formatCustomAiChatError(err, modelId, ollamaBase, openAiBase, ollamaModel);

			const benign = isFailedToFetchError(err) || isMissingOpenAiKeyMessage(err instanceof Error ? err.message : String(err));
			if (benign) {
				this._logService.warn('[CustomAi] Chat request failed', err);
			} else {
				this._logService.error('[CustomAi] Chat agent failed', err);
			}
			// Only use errorDetails for the user-visible message. Do not also emit a
			// warning progress part — the list renderer would show the same text twice
			// (warning strip + errorDetails strip).
			return { errorDetails: { message: display } };
		}
	}

	async provideFollowups(_request: IChatAgentRequest, _result: IChatAgentResult, _history: IChatAgentHistoryEntry[], _token: CancellationToken): Promise<IChatFollowup[]> {
		const handoff = SurfaceBuilderHandoffState.getActive();
		if (handoff?.kind === 'surface') {
			const surfaceName = handoff.surfaceName ?? handoff.title;
			if (handoff.phase === 'blueprint') {
				return [
					{
						kind: 'reply',
						agentId: 'custom.ai',
						title: localize('customAi.followup.finalizeBlueprintTitle', 'Finalize blueprint'),
						message: localize(
							'customAi.followup.finalizeBlueprintMessage',
							'Finalize the blueprint for {0} in `.agent/surfaces/{1}.blueprint.json`, then register the surface metadata in workspace.goal.json. Do not scaffold app files yet.',
							surfaceName,
							handoff.surfaceId,
						),
					},
					{
						kind: 'reply',
						agentId: 'custom.ai',
						title: localize('customAi.followup.surfaceScaffoldTitle', 'Scaffold this surface'),
						message: localize(
							'customAi.followup.surfaceScaffoldBlueprintMessage',
							'The blueprint for {0} is ready. Scaffold the surface, implement every subsystem, then call verifySurfaceBlueprint.',
							surfaceName,
						),
					},
				];
			}
			if (handoff.phase === 'scaffold' || handoff.phase === 'verify') {
				return [
					{
						kind: 'reply',
						agentId: 'custom.ai',
						title: localize('customAi.followup.verifySurfaceTitle', 'Verify surface'),
						message: localize(
							'customAi.followup.verifySurfaceMessage',
							'Call verifySurfaceBlueprint for {0} and fix any reported gaps.',
							handoff.surfaceId,
						),
					},
				];
			}
			return [
				{
					kind: 'reply',
					agentId: 'custom.ai',
					title: localize('customAi.followup.repairSurfaceTitle', 'Repair surface gaps'),
					message: localize(
						'customAi.followup.repairSurfaceMessage',
						'Fix the reported blueprint gaps for {0}, then call verifySurfaceBlueprint again.',
						surfaceName,
					),
				},
			];
		}

		const state = this._goalConsoleService.getState();
		if (state.status === 'loaded' && state.workspace) {
			const firstSurface = state.workspace.surfaces[0];
			return [
				{
					kind: 'reply',
					agentId: 'custom.ai',
					title: localize('customAi.followup.crossAppImpactTitle', 'Analyze cross-app impact'),
					message: localize('customAi.followup.crossAppImpactMessage', 'Identify the affected surfaces, shared workflows, memory updates, and validation steps for my next business change.')
				},
				{
					kind: 'reply',
					agentId: 'custom.ai',
					title: firstSurface
						? localize('customAi.followup.explainSurfaceTitle', 'Explain first surface')
						: localize('customAi.followup.createSurfaceTitle', 'Create first surface'),
					message: firstSurface
						? localize('customAi.followup.explainSurfaceMessage', 'Explain what the {0} surface does, which files own it, and how it connects to the rest of the goal workspace.', firstSurface.name)
						: localize('customAi.followup.createSurfaceMessage', 'Create the first surface for this goal workspace. Register it in workspace.goal.json, scaffold a Next.js app with SWC data-vscode-src mapping, and update shared memory and Ix metadata.')
				}
			];
		}

		if (state.status === 'missing') {
			return [{
				kind: 'reply',
				agentId: 'custom.ai',
				title: localize('customAi.followup.createGoalWorkspaceTitle', 'Create goal workspace'),
				message: localize('customAi.followup.createGoalWorkspaceMessage', 'Create workspace.goal.json for this business goal, then propose the first surfaces and shared context files.')
			}];
		}

		return [{
			kind: 'reply',
			agentId: 'custom.ai',
			title: localize('customAi.followup.describeGoalTitle', 'Describe business goal'),
			message: localize('customAi.followup.describeGoalMessage', 'Help me turn this project into a goal workspace with surfaces, shared workflows, durable memory, and Ix metadata.')
		}];
	}

	private async _checkOllamaReady(base: string, configuredModel: string, token: CancellationToken): Promise<{ ok: true } | { ok: false; reason: 'offline' | 'missingModel' }> {
		try {
			const ctx = await this._requestService.request({
				type: 'GET',
				url: `${base}/api/tags`,
				callSite: 'customAi.ollama.ping',
			}, token);
			const status = ctx.res.statusCode ?? 0;
			const body = await readAllStreamText(ctx.stream, token);
			if (status < 200 || status >= 300) {
				return { ok: false, reason: 'offline' };
			}
			let json: { models?: { name: string }[] };
			try {
				json = JSON.parse(body) as { models?: { name: string }[] };
			} catch {
				return { ok: false, reason: 'offline' };
			}
			const names = (json.models ?? []).map(m => m.name);
			if (this._ollamaTagsIncludeModel(names, configuredModel)) {
				return { ok: true };
			}
			return { ok: false, reason: 'missingModel' };
		} catch {
			return { ok: false, reason: 'offline' };
		}
	}

	private _ollamaTagsIncludeModel(tags: string[], configured: string): boolean {
		if (tags.includes(configured)) {
			return true;
		}
		const stem = configured.split(':')[0];
		for (const t of tags) {
			if (t === stem || t.startsWith(stem + ':')) {
				return true;
			}
		}
		return false;
	}

	/** Prompt for API key when missing or rejected; returns false if user cancels or submits empty. */
	private async _ensureOpenAiApiKey(token: CancellationToken, options?: { rejected?: boolean }): Promise<boolean> {
		if (!options?.rejected) {
			const existing = await this._secretStorage.get(CUSTOM_AI_SECRET_OPENAI_API_KEY);
			if (existing?.trim()) {
				return true;
			}
		}
		const openAiBase = (this._configurationService.getValue<string>('custom.ai.openaiCompatible.baseUrl') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
		const key = await promptForCustomAiApiKey(this._quickInput, this._openerService, token, {
			rejected: options?.rejected,
			baseUrl: openAiBase,
		});
		if (key === undefined || !key.trim()) {
			return false;
		}
		await this._secretStorage.set(CUSTOM_AI_SECRET_OPENAI_API_KEY, key.trim());
		this._logService.info('[CustomAi] Stored OpenAI-compatible API key from chat flow');
		return true;
	}

	private _resolveModelId(request: IChatAgentRequest): string {
		const override = this._configurationService.getValue<string>('custom.ai.defaultModelIdentifier');
		if (override) {
			return override;
		}
		if (request.userSelectedModelId && request.userSelectedModelId.startsWith('customAi:')) {
			return request.userSelectedModelId;
		}
		const mode = this._configurationService.getValue<string>('custom.ai.provider') ?? 'both';
		if (mode === 'openaiCompatible') {
			const configured = this._configurationService.getValue<string>('custom.ai.openaiCompatible.model') ?? 'gpt-4o-mini';
			return pickCustomAiOpenAiCompatibleModelId(this._languageModels.getLanguageModelIds(), configured);
		}
		return CUSTOM_AI_MODEL_OLLAMA;
	}

	private _buildTools(metadata: NonNullable<ReturnType<ILanguageModelsService['lookupLanguageModel']>>, request: IChatAgentRequest) {
		// Some built-in tools (e.g. the internal edit tool) are registered with empty
		// `modelDescription` / no `inputSchema` because the upstream chat routes them through
		// a non-tool-calling channel. Exposing those to a vanilla OpenAI/Ollama backend just
		// confuses the model — drop them.
		const rawTools = Array.from(this._toolsService.getTools(metadata)).filter(t => {
			const description = (t.modelDescription ?? '').trim();
			const schema = t.inputSchema as { type?: string; properties?: unknown } | undefined;
			const hasSchema = !!schema && schema.type === 'object' && schema.properties && Object.keys(schema.properties as Record<string, unknown>).length > 0;
			return description.length > 0 || hasSchema;
		});
		const defs = toolsToOpenAiFunctions(rawTools);
		const selected = request.userSelectedTools;
		if (!selected) {
			return defs;
		}
		return defs.filter(d => selected[d.function.name] !== false);
	}

	private async _buildMessages(request: IChatAgentRequest, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatMessage[]> {
		const messages: IChatMessage[] = [];
		const system = this._configurationService.getValue<string>('custom.ai.systemPrompt');
		const systemParts = buildCustomAiSystemMessageParts({
			customSystemPrompt: system,
			toolsEnabled: this._configurationService.getValue<boolean>('custom.ai.tools.enabled') !== false,
			goalWorkspaceState: this._goalConsoleService.getState(),
		});
		if (systemParts.length) {
			messages.push({ role: ChatMessageRole.System, content: [{ type: 'text', value: systemParts.join('\n\n') }] });
		}
		// Track total bytes across the whole conversation so we never blow up context with attachments.
		const budget: AttachmentBudget = { remaining: ATTACHMENT_MAX_BYTES_TOTAL };
		for (const h of history) {
			if (token.isCancellationRequested) {
				return messages;
			}
			const userText = await this._composeUserMessage(h.request.message, h.request.variables?.variables, budget, token);
			if (userText.trim()) {
				messages.push({ role: ChatMessageRole.User, content: [{ type: 'text', value: userText }] });
			}
			const assistantText = historyContentToText(h.response);
			if (assistantText.trim()) {
				messages.push({ role: ChatMessageRole.Assistant, content: [{ type: 'text', value: assistantText }] });
			}
		}
		const currentText = await this._composeUserMessage(request.message, request.variables?.variables, budget, token);
		messages.push({ role: ChatMessageRole.User, content: [{ type: 'text', value: currentText }] });
		return messages;
	}

	private async _composeUserMessage(
		message: string | undefined,
		variables: readonly IChatRequestVariableEntry[] | undefined,
		budget: AttachmentBudget,
		token: CancellationToken,
	): Promise<string> {
		const prefix = await this._renderAttachments(variables, budget, token);
		const userText = message ?? '';
		if (!prefix) {
			return userText;
		}
		if (!userText.trim()) {
			return prefix;
		}
		return `${prefix}\n\n${userText}`;
	}

	private async _renderAttachments(
		variables: readonly IChatRequestVariableEntry[] | undefined,
		budget: AttachmentBudget,
		token: CancellationToken,
	): Promise<string> {
		if (!variables || !variables.length) {
			return '';
		}
		const blocks: string[] = [];
		for (const entry of variables) {
			if (token.isCancellationRequested || budget.remaining <= 0) {
				break;
			}
			const block = await this._renderAttachment(entry, budget, token);
			if (block) {
				blocks.push(block);
			}
		}
		return blocks.join('\n\n');
	}

	private async _renderAttachment(
		entry: IChatRequestVariableEntry,
		budget: AttachmentBudget,
		token: CancellationToken,
	): Promise<string | undefined> {
		switch (entry.kind) {
			case 'file':
			case 'directory':
			case 'promptFile':
			case 'sessionReference': {
				const uri = IChatRequestVariableEntry.toUri(entry);
				if (!uri) {
					return undefined;
				}
				if (entry.kind === 'directory') {
					return this._renderDirectory(uri, budget, token);
				}
				return this._renderFile(uri, undefined, entry.name ?? basename(uri), 'Attached file', budget, token);
			}
			case 'implicit': {
				const value: unknown = entry.value;
				let uri: URI | undefined;
				let range: IRange | undefined;
				if (URI.isUri(value)) {
					uri = value;
				} else if (isLocation(value)) {
					uri = value.uri;
					range = value.range;
				} else if (value && URI.isUri((value as { uri?: URI }).uri)) {
					uri = (value as { uri: URI }).uri;
				} else if (URI.isUri(entry.uri)) {
					uri = entry.uri;
				}
				if (!uri) {
					return undefined;
				}
				const label = entry.isSelection ? 'Attached selection' : 'Attached file (current editor)';
				return this._renderFile(uri, range, entry.name ?? basename(uri), label, budget, token);
			}
			case 'symbol': {
				const loc = entry.value;
				if (!loc?.uri) {
					return undefined;
				}
				return this._renderFile(loc.uri, loc.range, entry.name ?? basename(loc.uri), 'Attached symbol', budget, token);
			}
			case 'paste': {
				const lang = entry.language || extToLang(entry.fileName) || '';
				const origin = entry.copiedFrom?.uri ? ` from ${shortUri(entry.copiedFrom.uri)}` : entry.fileName ? ` from ${entry.fileName}` : '';
				return this._renderFenced(`Attached pasted code${origin}`, lang, entry.code, budget);
			}
			case 'string':
			case 'promptText':
			case 'workspace':
			case 'command':
			case 'debugVariable': {
				const value = typeof entry.value === 'string' ? entry.value : undefined;
				if (!value) {
					return undefined;
				}
				return this._renderFenced(`Attached ${entry.kind}: ${entry.name ?? entry.id}`, '', value, budget);
			}
			case 'terminalCommand': {
				const parts: string[] = [];
				if (entry.command) {
					parts.push(`$ ${entry.command}`);
				}
				if (entry.output) {
					parts.push(entry.output);
				}
				if (typeof entry.exitCode === 'number') {
					parts.push(`(exit ${entry.exitCode})`);
				}
				if (!parts.length) {
					return undefined;
				}
				return this._renderFenced('Attached terminal command', 'bash', parts.join('\n'), budget);
			}
			case 'diagnostic': {
				const where = entry.filterUri ? shortUri(entry.filterUri) : 'workspace';
				const msg = entry.problemMessage ?? 'See workspace problems.';
				return `[Attached diagnostic in ${where}] ${msg}`;
			}
			case 'image':
			case 'tool':
			case 'toolset':
			case 'notebookOutput':
			case 'element':
			case 'generic':
			case 'scmHistoryItem':
			case 'scmHistoryItemChange':
			case 'scmHistoryItemChangeRange':
			case 'agentFeedback':
			case 'debugEvents':
			case 'browserView':
				// Not represented as text for now; tool-using flows handle these elsewhere.
				return undefined;
		}
	}

	private async _renderDirectory(uri: URI, budget: AttachmentBudget, _token: CancellationToken): Promise<string | undefined> {
		try {
			const stat = await this._fileService.resolve(uri, { resolveMetadata: false });
			const children = (stat.children ?? []).slice(0, 200).map(c => `${c.isDirectory ? 'd' : 'f'} ${c.name}`).join('\n');
			if (!children) {
				return undefined;
			}
			return this._renderFenced(`Attached directory listing: ${shortUri(uri)}`, '', children, budget);
		} catch (err) {
			this._logService.warn('[CustomAi] Failed to list directory attachment', uri.toString(), err);
			return undefined;
		}
	}

	private async _renderFile(
		uri: URI,
		range: IRange | undefined,
		displayName: string,
		labelPrefix: string,
		budget: AttachmentBudget,
		token: CancellationToken,
	): Promise<string | undefined> {
		const text = await this._readUriText(uri, range, token);
		if (text === undefined) {
			return undefined;
		}
		const rangeSuffix = range ? ` (lines ${range.startLineNumber}-${range.endLineNumber})` : '';
		const label = `${labelPrefix}: ${displayName}${rangeSuffix}`;
		const lang = extToLang(uri.path);
		return this._renderFenced(label, lang, text, budget);
	}

	private _renderFenced(label: string, lang: string, body: string, budget: AttachmentBudget): string | undefined {
		if (budget.remaining <= 0) {
			return undefined;
		}
		let truncated = false;
		let payload = body;
		const approxBytes = payload.length;
		const cap = Math.min(ATTACHMENT_MAX_BYTES_PER_FILE, Math.max(0, budget.remaining));
		if (approxBytes > cap) {
			payload = payload.slice(0, cap);
			truncated = true;
		}
		budget.remaining -= payload.length;
		const fence = '```';
		const tag = lang ? lang : '';
		const trailer = truncated ? '\n// …truncated by Custom AI attachment budget' : '';
		return `[${label}]\n${fence}${tag}\n${payload}${trailer}\n${fence}`;
	}

	private async _readUriText(uri: URI, range: IRange | undefined, token: CancellationToken): Promise<string | undefined> {
		const model = this._modelService.getModel(uri);
		if (model && !model.isDisposed()) {
			try {
				if (range) {
					const r = Range.lift(range);
					return model.getValueInRange(r);
				}
				return model.getValue();
			} catch (err) {
				this._logService.warn('[CustomAi] Failed reading buffer attachment', uri.toString(), err);
			}
		}
		try {
			const content = await this._fileService.readFile(uri, { limits: { size: ATTACHMENT_MAX_BYTES_PER_FILE } }, token);
			const text = content.value.toString();
			if (range) {
				return sliceLines(text, range);
			}
			return text;
		} catch (err) {
			this._logService.warn('[CustomAi] Failed reading file attachment', uri.toString(), err);
			return undefined;
		}
	}
}

interface AttachmentBudget {
	remaining: number;
}

function sliceLines(text: string, range: IRange): string {
	const lines = text.split(/\r?\n/);
	const start = Math.max(0, range.startLineNumber - 1);
	const end = Math.min(lines.length, range.endLineNumber);
	if (end <= start) {
		return '';
	}
	return lines.slice(start, end).join('\n');
}

function shortUri(uri: URI): string {
	if (uri.scheme === 'file') {
		return uri.fsPath;
	}
	return uri.toString();
}

function extToLang(pathOrName: string): string {
	const ext = (pathOrName.includes('.') ? pathOrName.slice(pathOrName.lastIndexOf('.') + 1) : '').toLowerCase();
	switch (ext) {
		case 'ts': return 'ts';
		case 'tsx': return 'tsx';
		case 'js': return 'js';
		case 'jsx': return 'jsx';
		case 'mjs':
		case 'cjs': return 'js';
		case 'py': return 'python';
		case 'rs': return 'rust';
		case 'go': return 'go';
		case 'java': return 'java';
		case 'rb': return 'ruby';
		case 'php': return 'php';
		case 'cs': return 'csharp';
		case 'cpp':
		case 'cc':
		case 'cxx':
		case 'hpp':
		case 'h': return 'cpp';
		case 'c': return 'c';
		case 'kt':
		case 'kts': return 'kotlin';
		case 'swift': return 'swift';
		case 'json':
		case 'jsonc': return 'json';
		case 'yaml':
		case 'yml': return 'yaml';
		case 'toml': return 'toml';
		case 'md':
		case 'markdown': return 'md';
		case 'css': return 'css';
		case 'scss': return 'scss';
		case 'html':
		case 'htm': return 'html';
		case 'sh':
		case 'bash':
		case 'zsh': return 'bash';
		case 'sql': return 'sql';
		default: return '';
	}
}

function historyContentToText(response: ReadonlyArray<IChatProgressHistoryResponseContent | import('../../../vs/workbench/contrib/chat/common/chatService/chatService.js').IChatTaskDto>): string {
	const chunks: string[] = [];
	for (const part of response) {
		if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
			chunks.push(part.content.value);
		}
	}
	return chunks.join('');
}

function summarizeGoalWorkspaceForTrace(state: GoalWorkspaceState): Record<string, unknown> {
	const workspace = state.workspace;
	return {
		status: state.status,
		workspaceFolder: state.workspaceFolder ? basename(state.workspaceFolder) : undefined,
		goalId: workspace?.goal.id,
		goalName: workspace?.goal.name,
		northStarMetric: workspace?.goal.northStarMetric,
		surfaceCount: workspace?.surfaces.length ?? 0,
		surfaceIds: workspace?.surfaces.slice(0, MAX_GOAL_SURFACES).map(surface => surface.id) ?? [],
		sharedKeys: workspace ? Object.entries(workspace.shared).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key]) => key) : [],
		contextFileCount: state.context.globalFiles.length + state.context.surfaceFiles.length,
		ixOverlay: Boolean(state.ix.overlay),
		diagnosticCount: state.diagnostics.length,
	};
}

function summarizeToolParameters(parameters: unknown): Record<string, unknown> | undefined {
	if (!parameters || typeof parameters !== 'object') {
		return undefined;
	}
	const record = parameters as Record<string, unknown>;
	const summary: Record<string, unknown> = {
		keys: Object.keys(record).sort(),
	};
	if (typeof record.uri === 'string') {
		summary.uri = record.uri;
	}
	if (typeof record.path === 'string') {
		summary.path = record.path;
	}
	if (typeof record.code === 'string') {
		summary.codeChars = record.code.length;
	}
	if (typeof record.explanation === 'string') {
		summary.explanationChars = record.explanation.length;
	}
	return summary;
}

function toolResultTextCharLength(result: IToolResult): number {
	let total = 0;
	for (const part of result.content) {
		if (part.kind === 'text') {
			total += part.value.length;
		}
	}
	return total;
}

function toolResultToChatParts(result: IToolResult): IChatResponseTextPart[] {
	return result.content.map(p => {
		if (p.kind === 'text') {
			return { type: 'text', value: p.value } satisfies IChatResponseTextPart;
		}
		return { type: 'text', value: `[${p.kind} data omitted]` } satisfies IChatResponseTextPart;
	});
}

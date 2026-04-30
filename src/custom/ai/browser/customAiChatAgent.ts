/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { MarkdownString } from '../../../vs/base/common/htmlContent.js';
import { Disposable } from '../../../vs/base/common/lifecycle.js';
import { IConfigurationService } from '../../../vs/platform/configuration/common/configuration.js';
import { ILogService } from '../../../vs/platform/log/common/log.js';
import { IQuickInputService } from '../../../vs/platform/quickinput/common/quickInput.js';
import { IRequestService } from '../../../vs/platform/request/common/request.js';
import { ISecretStorageService } from '../../../vs/platform/secrets/common/secrets.js';
import { Command } from '../../../vs/editor/common/languages.js';
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
import {
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD,
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS,
	CUSTOM_AI_MODEL_OLLAMA,
	CUSTOM_AI_MODEL_OPENAI,
	CUSTOM_AI_OLLAMA_DOWNLOAD_URL,
	CUSTOM_AI_SECRET_OPENAI_API_KEY,
} from '../common/customAiConstants.js';
import { readAllStreamText, toolsToOpenAiFunctions } from './customAiModelProvider.js';

const MAX_TOOL_ROUNDS = 15;

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
	if (modelId === CUSTOM_AI_MODEL_OPENAI) {
		return localize(
			'customAi.error.openAiCompatibleUnreachable',
			'Could not reach the OpenAI-compatible API at {0} (connection failed).\n\n- Check **custom.ai.openaiCompatible.baseUrl**, VPN, and corporate proxy\n- Run **Custom AI: Set OpenAI API Key** if you have not stored a key',
			openAiBase,
		);
	}
	return localize('customAi.error.networkGeneric', 'Network request failed ({0}). Check your model backend URL and connectivity.', raw);
}

export class CustomAiChatAgent extends Disposable implements IChatAgentImplementation {

	constructor(
		@ILanguageModelsService private readonly _languageModels: ILanguageModelsService,
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ISecretStorageService private readonly _secretStorage: ISecretStorageService,
		@IQuickInputService private readonly _quickInput: IQuickInputService,
		@IRequestService private readonly _requestService: IRequestService,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		const emit = (p: IChatProgress) => progress([p]);
		let modelId = '';
		try {
			if (!this._configurationService.getValue<boolean>('custom.ai.enabled')) {
				emit({ kind: 'markdownContent', content: new MarkdownString('Enable **custom.ai.enabled** in settings to use Custom AI.', false) } satisfies IChatMarkdownContent);
				return {};
			}

			modelId = this._resolveModelId(request);
			const metadata = this._languageModels.lookupLanguageModel(modelId);
			if (!metadata) {
				emit({ kind: 'markdownContent', content: new MarkdownString(`Unknown model **${modelId}**. Pick a Custom AI model in the chat model picker.`, false) } satisfies IChatMarkdownContent);
				return {};
			}

			if (modelId === CUSTOM_AI_MODEL_OPENAI) {
				const keyOk = await this._ensureOpenAiApiKey(token);
				if (!keyOk) {
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

			const messages = this._buildMessages(request, history);
			const countTokens: CountTokensCallback = async (input, t) => this._languageModels.computeTokenLength(modelId, input, t);

			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				if (token.isCancellationRequested) {
					return {};
				}

				const toolsEnabled = this._configurationService.getValue<boolean>('custom.ai.tools.enabled') !== false;
				const tools = toolsEnabled ? this._buildTools(metadata, request) : [];

				const lmResponse = await this._languageModels.sendChatRequest(
					modelId,
					undefined,
					messages,
					{ tools: tools.length ? tools : undefined },
					token,
				);

				const assistantParts: IChatMessagePart[] = [];
				for await (const part of lmResponse.stream) {
					if (token.isCancellationRequested) {
						return {};
					}
					const parts = Array.isArray(part) ? part : [part];
					for (const p of parts) {
						if (p.type === 'text') {
							const t = p as IChatResponseTextPart;
							if (t.value) {
								emit({ kind: 'markdownContent', content: new MarkdownString(t.value, false) } satisfies IChatMarkdownContent);
								assistantParts.push({ type: 'text', value: t.value });
								// Yield so the workbench can paint incremental markdown (tight loops otherwise batch visually).
								await Promise.resolve();
							}
						} else if (p.type === 'tool_use') {
							const tu = p as IChatResponseToolUsePart;
							assistantParts.push(tu);
						}
					}
				}
				await lmResponse.result;

				if (!assistantParts.length) {
					break;
				}

				messages.push({ role: ChatMessageRole.Assistant, content: assistantParts });

				const toolUses = assistantParts.filter((p): p is IChatResponseToolUsePart => p.type === 'tool_use');
				if (!toolUses.length) {
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
					try {
						toolResult = await this._toolsService.invokeTool({
							callId: tu.toolCallId,
							toolId,
							parameters: typeof tu.parameters === 'object' && tu.parameters ? tu.parameters as Record<string, unknown> : {},
							context: { sessionResource: request.sessionResource },
							chatRequestId: request.requestId,
							chatStreamToolCallId: tu.toolCallId,
						}, countTokens, token);
					} catch (err) {
						this._logService.error('[CustomAi] Tool invocation failed', err);
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

			return {};
		} catch (err) {
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
		return [];
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

	/** Prompt for API key when missing; returns false if user cancels or submits empty. */
	private async _ensureOpenAiApiKey(token: CancellationToken): Promise<boolean> {
		const existing = await this._secretStorage.get(CUSTOM_AI_SECRET_OPENAI_API_KEY);
		if (existing?.trim()) {
			return true;
		}
		const key = await this._quickInput.input({
			title: localize('customAi.quickInput.title', 'Custom AI — API key'),
			prompt: localize('customAi.quickInput.prompt', 'Enter an OpenAI-compatible API key. It is stored only on this device (same as the Command Palette command).'),
			placeHolder: localize('customAi.quickInput.placeholder', 'API key'),
			password: true,
			ignoreFocusLost: true,
		}, token);
		if (token.isCancellationRequested) {
			return false;
		}
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
			return CUSTOM_AI_MODEL_OPENAI;
		}
		return CUSTOM_AI_MODEL_OLLAMA;
	}

	private _buildTools(metadata: NonNullable<ReturnType<ILanguageModelsService['lookupLanguageModel']>>, request: IChatAgentRequest) {
		const defs = toolsToOpenAiFunctions(this._toolsService.getTools(metadata));
		const selected = request.userSelectedTools;
		if (!selected) {
			return defs;
		}
		return defs.filter(d => selected[d.function.name] !== false);
	}

	private _buildMessages(request: IChatAgentRequest, history: IChatAgentHistoryEntry[]): IChatMessage[] {
		const messages: IChatMessage[] = [];
		const system = this._configurationService.getValue<string>('custom.ai.systemPrompt');
		if (system?.trim()) {
			messages.push({ role: ChatMessageRole.System, content: [{ type: 'text', value: system }] });
		}
		for (const h of history) {
			if (h.request.message?.trim()) {
				messages.push({ role: ChatMessageRole.User, content: [{ type: 'text', value: h.request.message }] });
			}
			const assistantText = historyContentToText(h.response);
			if (assistantText.trim()) {
				messages.push({ role: ChatMessageRole.Assistant, content: [{ type: 'text', value: assistantText }] });
			}
		}
		messages.push({ role: ChatMessageRole.User, content: [{ type: 'text', value: request.message }] });
		return messages;
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

function toolResultToChatParts(result: IToolResult): IChatResponseTextPart[] {
	return result.content.map(p => {
		if (p.kind === 'text') {
			return { type: 'text', value: p.value } satisfies IChatResponseTextPart;
		}
		return { type: 'text', value: `[${p.kind} data omitted]` } satisfies IChatResponseTextPart;
	});
}

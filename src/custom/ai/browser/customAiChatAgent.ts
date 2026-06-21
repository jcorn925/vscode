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
import {
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD,
	CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS,
	CUSTOM_AI_MODEL_OLLAMA,
	CUSTOM_AI_MODEL_OPENAI,
	CUSTOM_AI_OLLAMA_DOWNLOAD_URL,
	CUSTOM_AI_SECRET_OPENAI_API_KEY,
} from '../common/customAiConstants.js';
import { CustomAiInvalidApiKeyError, readAllStreamText, toolsToOpenAiFunctions } from './customAiModelProvider.js';

const MAX_TOOL_ROUNDS = 15;
const ATTACHMENT_MAX_BYTES_PER_FILE = 64 * 1024;
const ATTACHMENT_MAX_BYTES_TOTAL = 256 * 1024;

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
		@IFileService private readonly _fileService: IFileService,
		@IModelService private readonly _modelService: IModelService,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		return this._invokeInternal(request, progress, history, token, false);
	}

	private async _invokeInternal(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken, retryAfterKeyUpdate: boolean): Promise<IChatAgentResult> {
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

			const messages = await this._buildMessages(request, history, token);
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
			if (modelId === CUSTOM_AI_MODEL_OPENAI && err instanceof CustomAiInvalidApiKeyError && !retryAfterKeyUpdate) {
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

	/** Prompt for API key when missing or rejected; returns false if user cancels or submits empty. */
	private async _ensureOpenAiApiKey(token: CancellationToken, options?: { rejected?: boolean }): Promise<boolean> {
		if (!options?.rejected) {
			const existing = await this._secretStorage.get(CUSTOM_AI_SECRET_OPENAI_API_KEY);
			if (existing?.trim()) {
				return true;
			}
		}
		const key = await this._quickInput.input({
			title: localize('customAi.quickInput.title', 'Custom AI — API key'),
			prompt: options?.rejected
				? localize('customAi.quickInput.promptRejected', 'The stored API key was rejected by the server (401). Enter a valid OpenAI-compatible API key. It is stored only on this device.')
				: localize('customAi.quickInput.prompt', 'Enter an OpenAI-compatible API key. It is stored only on this device (same as the Command Palette command).'),
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
		const systemParts: string[] = [];
		if (system?.trim()) {
			systemParts.push(system);
		}
		if (this._configurationService.getValue<boolean>('custom.ai.tools.enabled') !== false) {
			systemParts.push(
				'You have a function-calling tool named `editFile` that modifies or creates files in the user\'s workspace. ' +
				'When the user asks you to change, write, refactor, fix, or create code, you MUST call `editFile` with the new file contents. ' +
				'Never tell the user to make changes manually if you can call the tool. ' +
				'When proposing an edit, return the full updated file in the `code` argument and use the workspace-relative path in `uri`.'
			);
		}
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

function toolResultToChatParts(result: IToolResult): IChatResponseTextPart[] {
	return result.content.map(p => {
		if (p.kind === 'text') {
			return { type: 'text', value: p.value } satisfies IChatResponseTextPart;
		}
		return { type: 'text', value: `[${p.kind} data omitted]` } satisfies IChatResponseTextPart;
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableSource } from '../../../vs/base/common/async.js';
import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { Emitter } from '../../../vs/base/common/event.js';
import { Disposable } from '../../../vs/base/common/lifecycle.js';
import { listenStream } from '../../../vs/base/common/stream.js';
import { ExtensionIdentifier } from '../../../vs/platform/extensions/common/extensions.js';
import { ILogService } from '../../../vs/platform/log/common/log.js';
import { IRequestService } from '../../../vs/platform/request/common/request.js';
import { ISecretStorageService } from '../../../vs/platform/secrets/common/secrets.js';
import { IConfigurationService } from '../../../vs/platform/configuration/common/configuration.js';
import { nullExtensionDescription } from '../../../vs/workbench/services/extensions/common/extensions.js';
import {
	ChatMessageRole,
	IChatMessage,
	IChatMessagePart,
	IChatMessageTextPart,
	IChatResponsePart,
	IChatResponseTextPart,
	IChatResponseToolUsePart,
	ILanguageModelChatInfoOptions,
	ILanguageModelChatMetadataAndIdentifier,
	ILanguageModelChatProvider,
	ILanguageModelChatRequestOptions,
	ILanguageModelChatResponse,
} from '../../../vs/workbench/contrib/chat/common/languageModels.js';
import { IToolData } from '../../../vs/workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { ChatAgentLocation } from '../../../vs/workbench/contrib/chat/common/constants.js';
import {
	CUSTOM_AI_MODEL_OLLAMA,
	CUSTOM_AI_SECRET_OPENAI_API_KEY,
	CUSTOM_AI_VENDOR,
	customAiOpenAiCompatibleIdentifier,
	isCustomAiOpenAiCompatibleModelId,
	parseCustomAiOpenAiApiModelId,
} from '../common/customAiConstants.js';

type OpenAiModelListEntry = {
	id: string;
	name?: string;
	supported_parameters?: string[];
	supported_endpoints?: string[];
	architecture?: { input_modalities?: string[] };
	top_provider?: { context_length?: number };
};

type OpenAiApiEndpoint = 'chat-completions' | 'responses';

const OPENAI_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const OPENAI_COMPATIBLE_DEFAULT_MODELS = [
	'gpt-4o-mini',
	'gpt-4.1',
	'gpt-4.1-mini',
	'gpt-4o',
	'o3-mini',
] as const;

type OpenAiCompatibleTool = {
	type: 'function';
	function: {
		name: string;
		description: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		parameters: any;
	};
};

/** Thrown when the OpenAI-compatible backend rejects the stored API key (401/403). */
export class CustomAiInvalidApiKeyError extends Error {
	readonly kind = 'CustomAiInvalidApiKeyError';
	constructor(statusCode: number, body: string) {
		super(`OpenAI-compatible request failed (${statusCode}): ${body.slice(0, 500)}`);
		this.name = 'CustomAiInvalidApiKeyError';
	}
}

function isInvalidApiKeyResponse(statusCode: number, body: string): boolean {
	if (statusCode !== 401 && statusCode !== 403) {
		return false;
	}
	const lower = body.toLowerCase();
	return lower.includes('invalid_api_key')
		|| lower.includes('incorrect api key')
		|| lower.includes('invalid api key');
}

function isResponsesApiRequiredError(statusCode: number, body: string): boolean {
	return statusCode === 404 && body.includes('v1/responses');
}

function inferOpenAiApiEndpointFromModelId(modelId: string): OpenAiApiEndpoint {
	const id = modelId.toLowerCase();
	if (/^(gpt-5(\.|$|-)|o[0-9](-|\.)|chatgpt-)/.test(id) || id.includes('codex')) {
		return 'responses';
	}
	return 'chat-completions';
}

function resolveOpenAiApiEndpoint(modelId: string, supportedEndpoints?: readonly string[]): OpenAiApiEndpoint {
	if (supportedEndpoints?.length) {
		const supportsChat = supportedEndpoints.some(endpoint => endpoint.includes('chat/completions'));
		const supportsResponses = supportedEndpoints.some(endpoint => endpoint.includes('/responses'));
		if (supportsResponses && !supportsChat) {
			return 'responses';
		}
		if (supportsChat) {
			return 'chat-completions';
		}
	}
	return inferOpenAiApiEndpointFromModelId(modelId);
}

/** Normalize OpenAI-style `delta.content` (string, array of parts, or null) to plain text. */
function openAiDeltaContentToText(delta: { content?: unknown } | undefined): string | undefined {
	const c = delta?.content;
	if (typeof c === 'string' && c.length) {
		return c;
	}
	if (!Array.isArray(c) || !c.length) {
		return undefined;
	}
	let out = '';
	for (const part of c) {
		if (!part || typeof part !== 'object') {
			continue;
		}
		const p = part as { type?: string; text?: string | { value?: string } };
		if (p.type !== 'text') {
			continue;
		}
		if (typeof p.text === 'string') {
			out += p.text;
		} else if (p.text && typeof p.text === 'object' && typeof p.text.value === 'string') {
			out += p.text.value;
		}
	}
	return out.length ? out : undefined;
}

export class CustomAiModelProvider extends Disposable implements ILanguageModelChatProvider {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;
	private _openAiModelsCache: { cacheKey: string; fetchedAt: number; models: ILanguageModelChatMetadataAndIdentifier[] } | undefined;
	private readonly _openAiEndpointByModelId = new Map<string, OpenAiApiEndpoint>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IRequestService private readonly _requestService: IRequestService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('custom.ai')) {
				this._clearOpenAiModelDiscoveryCache();
				this._onDidChange.fire();
			}
		}));
		this._register(this._secretStorageService.onDidChangeSecret(key => {
			if (key === CUSTOM_AI_SECRET_OPENAI_API_KEY) {
				this._clearOpenAiModelDiscoveryCache();
				this._onDidChange.fire();
			}
		}));
	}

	async provideLanguageModelChatInfo(options: ILanguageModelChatInfoOptions, token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		const out: ILanguageModelChatMetadataAndIdentifier[] = [];
		const providerMode = this._configurationService.getValue<string>('custom.ai.provider') ?? 'both';

		if (providerMode === 'ollama' || providerMode === 'both') {
			out.push(this._ollamaModelEntry());
		}
		if (providerMode === 'openaiCompatible' || providerMode === 'both') {
			out.push(...await this._discoverOpenAiCompatibleModels(options, token));
		}

		return out;
	}

	private _ollamaModelEntry(): ILanguageModelChatMetadataAndIdentifier {
		const ollamaModel = this._configurationService.getValue<string>('custom.ai.ollama.model') ?? 'llama3.1';
		return {
			identifier: CUSTOM_AI_MODEL_OLLAMA,
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: `Ollama (${ollamaModel})`,
				id: ollamaModel,
				vendor: CUSTOM_AI_VENDOR,
				version: '1.0',
				family: 'ollama',
				maxInputTokens: 128000,
				maxOutputTokens: 8192,
				isDefaultForLocation: {},
				isUserSelectable: true,
				capabilities: { vision: false, toolCalling: true, agentMode: true },
			},
		};
	}

	private _clearOpenAiModelDiscoveryCache(): void {
		this._openAiModelsCache = undefined;
		this._openAiEndpointByModelId.clear();
	}

	private _rememberOpenAiEndpoint(apiModelId: string, endpoint: OpenAiApiEndpoint): void {
		this._openAiEndpointByModelId.set(apiModelId, endpoint);
	}

	private _resolveOpenAiEndpoint(apiModelId: string): OpenAiApiEndpoint {
		return this._openAiEndpointByModelId.get(apiModelId) ?? inferOpenAiApiEndpointFromModelId(apiModelId);
	}

	private _openAiFallbackEntry(apiModel: string, options?: { readonly isDefault?: boolean }): ILanguageModelChatMetadataAndIdentifier {
		this._rememberOpenAiEndpoint(apiModel, resolveOpenAiApiEndpoint(apiModel));
		return {
			identifier: customAiOpenAiCompatibleIdentifier(apiModel),
			metadata: {
				extension: nullExtensionDescription.identifier,
				name: apiModel,
				id: apiModel,
				vendor: CUSTOM_AI_VENDOR,
				version: '1.0',
				family: 'openai-compatible',
				maxInputTokens: 128000,
				maxOutputTokens: 8192,
				isDefaultForLocation: options?.isDefault ? { [ChatAgentLocation.Chat]: true } : {},
				isUserSelectable: true,
				capabilities: { vision: false, toolCalling: true, agentMode: true },
			},
		};
	}

	private _openAiConfiguredCatalog(configuredModel: string): ILanguageModelChatMetadataAndIdentifier[] {
		const ids = [configuredModel, ...OPENAI_COMPATIBLE_DEFAULT_MODELS].filter((id, index, all) => id && all.indexOf(id) === index);
		return ids.map(id => this._openAiFallbackEntry(id, { isDefault: id === configuredModel }));
	}

	private _mergeOpenAiModelCatalog(configuredModel: string, discovered: ILanguageModelChatMetadataAndIdentifier[]): ILanguageModelChatMetadataAndIdentifier[] {
		const byId = new Map<string, ILanguageModelChatMetadataAndIdentifier>();
		for (const entry of this._openAiConfiguredCatalog(configuredModel)) {
			byId.set(entry.metadata.id, entry);
		}
		for (const entry of discovered) {
			byId.set(entry.metadata.id, entry);
		}
		return Array.from(byId.values()).sort((a, b) => {
			const aDefault = a.metadata.isDefaultForLocation[ChatAgentLocation.Chat] ? 0 : 1;
			const bDefault = b.metadata.isDefaultForLocation[ChatAgentLocation.Chat] ? 0 : 1;
			if (aDefault !== bDefault) {
				return aDefault - bDefault;
			}
			return a.metadata.name.localeCompare(b.metadata.name);
		});
	}

	private async _discoverOpenAiCompatibleModels(options: ILanguageModelChatInfoOptions, token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		const configuredModel = this._configurationService.getValue<string>('custom.ai.openaiCompatible.model') ?? 'gpt-4o-mini';
		const baseUrl = this._openAiBase();
		const apiKey = await this._secretStorageService.get(CUSTOM_AI_SECRET_OPENAI_API_KEY) ?? '';
		const cacheKey = `${baseUrl}|${apiKey ? 'key' : 'no-key'}`;

		if (this._openAiModelsCache && this._openAiModelsCache.cacheKey === cacheKey && Date.now() - this._openAiModelsCache.fetchedAt < OPENAI_MODELS_CACHE_TTL_MS) {
			return this._openAiModelsCache.models;
		}

		if (!apiKey) {
			const fallback = this._openAiConfiguredCatalog(configuredModel);
			this._openAiModelsCache = { cacheKey, fetchedAt: Date.now(), models: fallback };
			return fallback;
		}

		try {
			const entries = await this._fetchOpenAiModelList(baseUrl, apiKey, token);
			const models = this._mergeOpenAiModelCatalog(configuredModel, this._mapOpenAiModelEntries(entries, configuredModel, baseUrl));
			if (!models.length) {
				const fallback = this._openAiConfiguredCatalog(configuredModel);
				this._openAiModelsCache = { cacheKey, fetchedAt: Date.now(), models: fallback };
				return fallback;
			}
			this._openAiModelsCache = { cacheKey, fetchedAt: Date.now(), models };
			return models;
		} catch (err) {
			this._logService.warn('[CustomAi] Failed to discover OpenAI-compatible models; using configured fallback', err);
			const fallback = this._openAiConfiguredCatalog(configuredModel);
			this._openAiModelsCache = { cacheKey, fetchedAt: Date.now(), models: fallback };
			return fallback;
		}
	}

	private _modelsDiscoveryUrl(baseUrl: string): string {
		if (baseUrl.includes('openrouter.ai')) {
			return `${baseUrl}/models?supported_parameters=tools`;
		}
		return `${baseUrl}/models`;
	}

	private async _fetchOpenAiModelList(baseUrl: string, apiKey: string, token: CancellationToken): Promise<OpenAiModelListEntry[]> {
		const ctx = await this._requestService.request({
			type: 'GET',
			url: this._modelsDiscoveryUrl(baseUrl),
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			callSite: 'customAi.openai.models',
		}, token);
		if (ctx.res.statusCode && (ctx.res.statusCode < 200 || ctx.res.statusCode >= 300)) {
			const errText = await readAllStreamText(ctx.stream, token);
			throw new Error(`Models list failed (${ctx.res.statusCode}): ${errText.slice(0, 500)}`);
		}
		const text = await readAllStreamText(ctx.stream, token);
		const json = JSON.parse(text) as { data?: OpenAiModelListEntry[]; models?: OpenAiModelListEntry[] };
		const models = json.data ?? json.models;
		if (!Array.isArray(models)) {
			throw new Error('Invalid models list response format');
		}
		return models;
	}

	private _mapOpenAiModelEntries(entries: OpenAiModelListEntry[], configuredModel: string, baseUrl: string): ILanguageModelChatMetadataAndIdentifier[] {
		const isOpenRouter = baseUrl.includes('openrouter.ai');
		const filtered = entries.filter(entry => {
			if (!entry?.id) {
				return false;
			}
			if (isOpenRouter) {
				return (entry.supported_parameters ?? []).includes('tools');
			}
			return this._isLikelyChatModelId(entry.id);
		});

		const seen = new Set<string>();
		const out: ILanguageModelChatMetadataAndIdentifier[] = [];
		for (const entry of filtered) {
			if (seen.has(entry.id)) {
				continue;
			}
			seen.add(entry.id);
			this._rememberOpenAiEndpoint(entry.id, resolveOpenAiApiEndpoint(entry.id, entry.supported_endpoints));
			const capabilities = this._resolveOpenAiModelCapabilities(entry, isOpenRouter);
			if (!capabilities.toolCalling) {
				continue;
			}
			const displayName = entry.name?.trim() || entry.id;
			out.push({
				identifier: customAiOpenAiCompatibleIdentifier(entry.id),
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: displayName,
					id: entry.id,
					vendor: CUSTOM_AI_VENDOR,
					version: '1.0',
					family: 'openai-compatible',
					maxInputTokens: capabilities.maxInputTokens,
					maxOutputTokens: capabilities.maxOutputTokens,
					isDefaultForLocation: entry.id === configuredModel ? { [ChatAgentLocation.Chat]: true } : {},
					isUserSelectable: true,
					capabilities: {
						vision: capabilities.vision,
						toolCalling: true,
						agentMode: true,
					},
				},
			});
		}

		if (!seen.has(configuredModel)) {
			this._rememberOpenAiEndpoint(configuredModel, resolveOpenAiApiEndpoint(configuredModel));
			out.unshift({
				identifier: customAiOpenAiCompatibleIdentifier(configuredModel),
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: configuredModel,
					id: configuredModel,
					vendor: CUSTOM_AI_VENDOR,
					version: '1.0',
					family: 'openai-compatible',
					maxInputTokens: 128000,
					maxOutputTokens: 8192,
					isDefaultForLocation: { [ChatAgentLocation.Chat]: true },
					isUserSelectable: true,
					capabilities: { vision: false, toolCalling: true, agentMode: true },
				},
			});
		}

		out.sort((a, b) => {
			const aDefault = a.metadata.isDefaultForLocation[ChatAgentLocation.Chat] ? 0 : 1;
			const bDefault = b.metadata.isDefaultForLocation[ChatAgentLocation.Chat] ? 0 : 1;
			if (aDefault !== bDefault) {
				return aDefault - bDefault;
			}
			return a.metadata.name.localeCompare(b.metadata.name);
		});

		return out;
	}

	private _isLikelyChatModelId(modelId: string): boolean {
		const id = modelId.toLowerCase();
		if (id.includes('embed') || id.includes('whisper') || id.includes('tts') || id.includes('transcribe') || id.includes('realtime') || id.includes('audio') || id.includes('dall-e') || id.includes('moderation') || id.includes('search')) {
			return false;
		}
		return /^(gpt-|o[0-9]|chatgpt-)/.test(id);
	}

	private _resolveOpenAiModelCapabilities(entry: OpenAiModelListEntry, isOpenRouter: boolean): { vision: boolean; toolCalling: boolean; maxInputTokens: number; maxOutputTokens: number } {
		if (isOpenRouter) {
			const contextLength = entry.top_provider?.context_length ?? 128000;
			return {
				vision: entry.architecture?.input_modalities?.includes('image') ?? false,
				toolCalling: (entry.supported_parameters ?? []).includes('tools'),
				maxInputTokens: Math.max(8192, contextLength - 16000),
				maxOutputTokens: 16000,
			};
		}
		return {
			vision: /vision|gpt-4o|gpt-4\.1|gpt-5/i.test(entry.id),
			toolCalling: true,
			maxInputTokens: 128000,
			maxOutputTokens: 8192,
		};
	}

	async sendChatRequest(modelId: string, messages: IChatMessage[], _from: ExtensionIdentifier | undefined, options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		if (modelId === CUSTOM_AI_MODEL_OLLAMA) {
			return this._ollamaChat(messages, options, token);
		}
		if (isCustomAiOpenAiCompatibleModelId(modelId)) {
			const apiModel = parseCustomAiOpenAiApiModelId(modelId)
				?? this._configurationService.getValue<string>('custom.ai.openaiCompatible.model')
				?? 'gpt-4o-mini';
			return this._openAiCompatibleChat(messages, options, token, apiModel);
		}
		throw new Error(`Unknown Custom AI model: ${modelId}`);
	}

	async provideTokenCount(_modelId: string, message: string | IChatMessage, _token: CancellationToken): Promise<number> {
		const s = typeof message === 'string' ? message : JSON.stringify(message);
		return Math.max(1, Math.ceil(s.length / 4));
	}

	private _ollamaBase(): string {
		const raw = this._configurationService.getValue<string>('custom.ai.ollama.baseUrl') ?? 'http://127.0.0.1:11434';
		return raw.replace(/\/$/, '');
	}

	private _openAiBase(): string {
		const raw = this._configurationService.getValue<string>('custom.ai.openaiCompatible.baseUrl') ?? 'https://api.openai.com/v1';
		return raw.replace(/\/$/, '');
	}

	private async _openAiCompatibleChat(messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken, model: string): Promise<ILanguageModelChatResponse> {
		const apiKey = await this._secretStorageService.get(CUSTOM_AI_SECRET_OPENAI_API_KEY) ?? '';
		if (!apiKey) {
			throw new Error('OpenAI-compatible API key is not set. Use the Command Palette: "Custom AI: Set OpenAI API Key".');
		}

		const endpoint = this._resolveOpenAiEndpoint(model);
		if (endpoint === 'responses') {
			return this._sendOpenAiResponsesRequest(apiKey, messages, options, token, model);
		}

		try {
			return await this._sendOpenAiChatCompletionsRequest(apiKey, messages, options, token, model);
		} catch (err) {
			const errText = err instanceof Error ? err.message : String(err);
			const statusMatch = /request failed \((\d+)\):/.exec(errText);
			const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
			if (isResponsesApiRequiredError(statusCode, errText)) {
				this._logService.info(`[CustomAi] Model ${model} requires /responses; retrying`);
				this._rememberOpenAiEndpoint(model, 'responses');
				return this._sendOpenAiResponsesRequest(apiKey, messages, options, token, model);
			}
			throw err;
		}
	}

	private async _sendOpenAiChatCompletionsRequest(apiKey: string, messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken, model: string): Promise<ILanguageModelChatResponse> {
		const url = `${this._openAiBase()}/chat/completions`;
		const openAiMessages = toOpenAiMessages(messages);
		const tools = options.tools as OpenAiCompatibleTool[] | undefined;
		const body = JSON.stringify({
			model,
			messages: openAiMessages,
			stream: true,
			...(tools?.length ? { tools } : {}),
		});
		const ctx = await this._requestService.request({
			type: 'POST',
			url,
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			data: body,
			callSite: 'customAi.openai',
		}, token);
		if (ctx.res.statusCode && (ctx.res.statusCode < 200 || ctx.res.statusCode >= 300)) {
			const errText = await readAllStreamText(ctx.stream, token);
			if (isInvalidApiKeyResponse(ctx.res.statusCode, errText)) {
				throw new CustomAiInvalidApiKeyError(ctx.res.statusCode, errText);
			}
			throw new Error(`OpenAI-compatible request failed (${ctx.res.statusCode}): ${errText.slice(0, 500)}`);
		}
		return this._streamOpenAiSse(ctx.stream, token);
	}

	private async _sendOpenAiResponsesRequest(apiKey: string, messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken, model: string): Promise<ILanguageModelChatResponse> {
		const url = `${this._openAiBase()}/responses`;
		const tools = options.tools as OpenAiCompatibleTool[] | undefined;
		const body = JSON.stringify(toResponsesRequestBody(model, messages, tools));
		const ctx = await this._requestService.request({
			type: 'POST',
			url,
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			data: body,
			callSite: 'customAi.openai.responses',
		}, token);
		if (ctx.res.statusCode && (ctx.res.statusCode < 200 || ctx.res.statusCode >= 300)) {
			const errText = await readAllStreamText(ctx.stream, token);
			if (isInvalidApiKeyResponse(ctx.res.statusCode, errText)) {
				throw new CustomAiInvalidApiKeyError(ctx.res.statusCode, errText);
			}
			throw new Error(`OpenAI-compatible request failed (${ctx.res.statusCode}): ${errText.slice(0, 500)}`);
		}
		return this._streamOpenAiResponsesSse(ctx.stream, token);
	}

	private async _ollamaChat(messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const model = this._configurationService.getValue<string>('custom.ai.ollama.model') ?? 'llama3.1';
		const url = `${this._ollamaBase()}/api/chat`;
		const ollamaMessages = toOllamaMessages(messages);
		const tools = options.tools as OpenAiCompatibleTool[] | undefined;
		const body = JSON.stringify({
			model,
			messages: ollamaMessages,
			stream: true,
			...(tools?.length ? { tools } : {}),
		});
		const ctx = await this._requestService.request({
			type: 'POST',
			url,
			headers: { 'Content-Type': 'application/json' },
			data: body,
			callSite: 'customAi.ollama',
		}, token);
		if (ctx.res.statusCode && (ctx.res.statusCode < 200 || ctx.res.statusCode >= 300)) {
			const errText = await readAllStreamText(ctx.stream, token);
			throw new Error(`Ollama request failed (${ctx.res.statusCode}): ${errText.slice(0, 500)}`);
		}
		return this._streamOllamaNdjson(ctx.stream, token);
	}

	private _streamOpenAiSse(stream: import('../../../vs/base/common/buffer.js').VSBufferReadableStream, token: CancellationToken): ILanguageModelChatResponse {
		const source = new AsyncIterableSource<IChatResponsePart | IChatResponsePart[]>();
		const result = (async () => {
			let buffer = '';
			const toolCallAccum = new Map<number, { id?: string; name?: string; arguments: string }>();
			await new Promise<void>((resolve, reject) => {
				listenStream(stream, {
					onData: chunk => {
						buffer += chunk.toString();
						let idx: number;
						while ((idx = buffer.indexOf('\n')) >= 0) {
							const line = buffer.slice(0, idx).trimEnd();
							buffer = buffer.slice(idx + 1);
							if (!line.startsWith('data:')) {
								continue;
							}
							const payload = line.slice(5).trim();
							if (payload === '[DONE]') {
								continue;
							}
							try {
								const json = JSON.parse(payload);
								const choice = json.choices?.[0];
								const delta = choice?.delta;
								const textDelta = openAiDeltaContentToText(delta);
								if (textDelta) {
									source.emitOne({ type: 'text', value: textDelta } satisfies IChatResponseTextPart);
								}
								if (delta?.tool_calls) {
									for (const tc of delta.tool_calls) {
										const i = tc.index ?? 0;
										let acc = toolCallAccum.get(i);
										if (!acc) {
											acc = { arguments: '' };
											toolCallAccum.set(i, acc);
										}
										if (tc.id) {
											acc.id = tc.id;
										}
										if (tc.function?.name) {
											acc.name = tc.function.name;
										}
										if (tc.function?.arguments) {
											acc.arguments += tc.function.arguments;
										}
									}
								}
							} catch (e) {
								this._logService.warn('[CustomAi] Failed to parse SSE chunk', e);
							}
						}
					},
					onEnd: () => {
						const tail = buffer.trim();
						if (tail.startsWith('data:')) {
							const payload = tail.slice(5).trim();
							if (payload && payload !== '[DONE]') {
								try {
									const json = JSON.parse(payload);
									const delta = json.choices?.[0]?.delta;
									const tailText = openAiDeltaContentToText(delta);
									if (tailText) {
										source.emitOne({ type: 'text', value: tailText } satisfies IChatResponseTextPart);
									}
									if (delta?.tool_calls) {
										for (const tc of delta.tool_calls) {
											const i = tc.index ?? 0;
											let acc = toolCallAccum.get(i);
											if (!acc) {
												acc = { arguments: '' };
												toolCallAccum.set(i, acc);
											}
											if (tc.id) {
												acc.id = tc.id;
											}
											if (tc.function?.name) {
												acc.name = tc.function.name;
											}
											if (tc.function?.arguments) {
												acc.arguments += tc.function.arguments;
											}
										}
									}
								} catch { /* ignore */ }
							}
						}
						for (const [, acc] of toolCallAccum) {
							if (acc.name && acc.id) {
								let params: Record<string, unknown> = {};
								try {
									params = acc.arguments ? JSON.parse(acc.arguments) : {};
								} catch {
									params = { raw: acc.arguments };
								}
								source.emitOne({ type: 'tool_use', name: acc.name, toolCallId: acc.id, parameters: params } satisfies IChatResponseToolUsePart);
							}
						}
						resolve();
					},
					onError: err => reject(err),
				}, token);
			});
			source.resolve();
		})().catch(err => {
			this._logService.error('[CustomAi] OpenAI stream failed', err);
			source.reject(err);
		});
		return { stream: source.asyncIterable, result };
	}

	private _streamOpenAiResponsesSse(stream: import('../../../vs/base/common/buffer.js').VSBufferReadableStream, token: CancellationToken): ILanguageModelChatResponse {
		const source = new AsyncIterableSource<IChatResponsePart | IChatResponsePart[]>();
		const result = (async () => {
			let buffer = '';
			const toolCallAccum = new Map<number, { id?: string; name?: string; arguments: string }>();
			const emitFunctionCall = (callId: string, name: string, args: string) => {
				let params: Record<string, unknown> = {};
				try {
					params = args ? JSON.parse(args) : {};
				} catch {
					params = { raw: args };
				}
				source.emitOne({ type: 'tool_use', name, toolCallId: callId, parameters: params } satisfies IChatResponseToolUsePart);
			};
			const handleResponsesChunk = (json: Record<string, unknown>) => {
				const type = json.type;
				if (type === 'response.output_text.delta' && typeof json.delta === 'string' && json.delta) {
					source.emitOne({ type: 'text', value: json.delta } satisfies IChatResponseTextPart);
					return;
				}
				if (type === 'response.output_item.added') {
					const item = json.item as { type?: string; name?: string; call_id?: string } | undefined;
					if (item?.type === 'function_call' && item.call_id && item.name) {
						const outputIndex = typeof json.output_index === 'number' ? json.output_index : 0;
						toolCallAccum.set(outputIndex, { id: item.call_id, name: item.name, arguments: '' });
					}
					return;
				}
				if (type === 'response.function_call_arguments.delta') {
					const outputIndex = typeof json.output_index === 'number' ? json.output_index : 0;
					const acc = toolCallAccum.get(outputIndex);
					if (acc && typeof json.delta === 'string') {
						acc.arguments += json.delta;
					}
					return;
				}
				if (type === 'response.output_item.done') {
					const item = json.item as { type?: string; name?: string; call_id?: string; arguments?: string } | undefined;
					if (item?.type === 'function_call' && item.call_id && item.name) {
						emitFunctionCall(item.call_id, item.name, item.arguments ?? '');
						const outputIndex = typeof json.output_index === 'number' ? json.output_index : 0;
						toolCallAccum.delete(outputIndex);
					}
				}
			};
			await new Promise<void>((resolve, reject) => {
				listenStream(stream, {
					onData: chunk => {
						buffer += chunk.toString();
						let idx: number;
						while ((idx = buffer.indexOf('\n')) >= 0) {
							const line = buffer.slice(0, idx).trimEnd();
							buffer = buffer.slice(idx + 1);
							if (!line.startsWith('data:')) {
								continue;
							}
							const payload = line.slice(5).trim();
							if (!payload || payload === '[DONE]') {
								continue;
							}
							try {
								handleResponsesChunk(JSON.parse(payload) as Record<string, unknown>);
							} catch (e) {
								this._logService.warn('[CustomAi] Failed to parse Responses SSE chunk', e);
							}
						}
					},
					onEnd: () => {
						const tail = buffer.trim();
						if (tail.startsWith('data:')) {
							const payload = tail.slice(5).trim();
							if (payload && payload !== '[DONE]') {
								try {
									handleResponsesChunk(JSON.parse(payload) as Record<string, unknown>);
								} catch { /* ignore */ }
							}
						}
						for (const [, acc] of toolCallAccum) {
							if (acc.name && acc.id) {
								emitFunctionCall(acc.id, acc.name, acc.arguments);
							}
						}
						resolve();
					},
					onError: err => reject(err),
				}, token);
			});
			source.resolve();
		})().catch(err => {
			this._logService.error('[CustomAi] OpenAI Responses stream failed', err);
			source.reject(err);
		});
		return { stream: source.asyncIterable, result };
	}

	private _streamOllamaNdjson(stream: import('../../../vs/base/common/buffer.js').VSBufferReadableStream, token: CancellationToken): ILanguageModelChatResponse {
		const source = new AsyncIterableSource<IChatResponsePart | IChatResponsePart[]>();
		const result = (async () => {
			let buffer = '';
			let lastOllamaContent = '';
			await new Promise<void>((resolve, reject) => {
				listenStream(stream, {
					onData: chunk => {
						buffer += chunk.toString();
						let nl: number;
						while ((nl = buffer.indexOf('\n')) >= 0) {
							const line = buffer.slice(0, nl).trim();
							buffer = buffer.slice(nl + 1);
							if (!line) {
								continue;
							}
							try {
								const json = JSON.parse(line);
								const content = json.message?.content;
								if (typeof content === 'string' && content.length > 0) {
									let delta: string;
									if (content.length >= lastOllamaContent.length && content.startsWith(lastOllamaContent)) {
										delta = content.slice(lastOllamaContent.length);
										lastOllamaContent = content;
									} else {
										// Some gateways send only the new fragment per line instead of a growing prefix.
										delta = content;
										lastOllamaContent += content;
									}
									if (delta) {
										source.emitOne({ type: 'text', value: delta } satisfies IChatResponseTextPart);
									}
								}
								if (json.message?.tool_calls) {
									for (const tc of json.message.tool_calls) {
										const fn = tc.function;
										if (fn?.name && tc.id) {
											let params: Record<string, unknown> = {};
											try {
												params = fn.arguments ? JSON.parse(fn.arguments) : {};
											} catch {
												params = { raw: fn.arguments };
											}
											source.emitOne({ type: 'tool_use', name: fn.name, toolCallId: tc.id, parameters: params } satisfies IChatResponseToolUsePart);
										}
									}
								}
							} catch (e) {
								this._logService.warn('[CustomAi] Failed to parse Ollama chunk', e);
							}
						}
					},
					onEnd: () => {
						const rest = buffer.trim();
						if (rest) {
							try {
								const json = JSON.parse(rest);
								const content = json.message?.content;
								if (typeof content === 'string' && content.length > 0) {
									let delta: string;
									if (content.length >= lastOllamaContent.length && content.startsWith(lastOllamaContent)) {
										delta = content.slice(lastOllamaContent.length);
										lastOllamaContent = content;
									} else {
										delta = content;
										lastOllamaContent += content;
									}
									if (delta) {
										source.emitOne({ type: 'text', value: delta } satisfies IChatResponseTextPart);
									}
								}
							} catch { /* ignore trailing partial */ }
						}
						resolve();
					},
					onError: err => reject(err),
				}, token);
			});
			source.resolve();
		})().catch(err => {
			this._logService.error('[CustomAi] Ollama stream failed', err);
			source.reject(err);
		});
		return { stream: source.asyncIterable, result };
	}
}

export async function readAllStreamText(stream: import('../../../vs/base/common/buffer.js').VSBufferReadableStream, token: CancellationToken): Promise<string> {
	let out = '';
	await new Promise<void>((resolve, reject) => {
		listenStream(stream, {
			onData: c => { out += c.toString(); },
			onEnd: () => resolve(),
			onError: e => reject(e),
		}, token);
	});
	return out;
}

/** Maps contributed tools to OpenAI/Ollama "tools" array shape used in our HTTP bodies. */
export function toolsToOpenAiFunctions(tools: Iterable<IToolData>): OpenAiCompatibleTool[] {
	const out: OpenAiCompatibleTool[] = [];
	for (const tool of tools) {
		const name = tool.toolReferenceName ?? tool.id;
		const parameters = tool.inputSchema && typeof tool.inputSchema === 'object' && (tool.inputSchema as { type?: string }).type === 'object'
			? tool.inputSchema
			: { type: 'object', properties: {} };
		out.push({
			type: 'function',
			function: {
				name,
				description: tool.modelDescription,
				parameters,
			},
		});
	}
	return out;
}

function toResponsesRequestBody(model: string, messages: IChatMessage[], tools?: OpenAiCompatibleTool[]): Record<string, unknown> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const input: any[] = [];
	let instructions: string | undefined;

	for (const m of messages) {
		if (m.role === ChatMessageRole.System) {
			const sys = flattenText(m.content);
			instructions = instructions ? `${instructions}\n\n${sys}` : sys;
			continue;
		}
		if (m.role === ChatMessageRole.User) {
			const { text, toolResults } = splitUserContent(m.content);
			for (const tr of toolResults) {
				input.push({ type: 'function_call_output', call_id: tr.toolCallId, output: flattenToolResult(tr.value) });
			}
			if (text) {
				input.push({ role: 'user', content: [{ type: 'input_text', text }] });
			}
			continue;
		}
		if (m.role === ChatMessageRole.Assistant) {
			const text = flattenText(m.content.filter(isTextMessagePart));
			const toolCalls = m.content.filter((p): p is IChatResponseToolUsePart => p.type === 'tool_use');
			if (text) {
				input.push({
					type: 'message',
					role: 'assistant',
					content: [{ type: 'output_text', text }],
				});
			}
			for (const tc of toolCalls) {
				input.push({
					type: 'function_call',
					name: tc.name,
					arguments: JSON.stringify(tc.parameters ?? {}),
					call_id: tc.toolCallId,
				});
			}
		}
	}

	return {
		model,
		stream: true,
		store: false,
		input,
		...(instructions ? { instructions } : {}),
		...(tools?.length ? {
			tools: tools.map(tool => ({
				type: 'function',
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters ?? { type: 'object', properties: {} },
				strict: false,
			})),
		} : {}),
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOpenAiMessages(messages: IChatMessage[]): any[] {
	const out: any[] = [];
	for (const m of messages) {
		if (m.role === ChatMessageRole.System) {
			out.push({ role: 'system', content: flattenText(m.content) });
			continue;
		}
		if (m.role === ChatMessageRole.User) {
			const { text, toolResults } = splitUserContent(m.content);
			if (toolResults.length) {
				for (const tr of toolResults) {
					out.push({ role: 'tool', tool_call_id: tr.toolCallId, content: flattenToolResult(tr.value) });
				}
			}
			if (text) {
				out.push({ role: 'user', content: text });
			}
			continue;
		}
		if (m.role === ChatMessageRole.Assistant) {
			const text = flattenText(m.content.filter(isTextMessagePart));
			const toolCalls = m.content.filter((p): p is IChatResponseToolUsePart => p.type === 'tool_use');
			if (toolCalls.length) {
				out.push({
					role: 'assistant',
					content: text || null,
					tool_calls: toolCalls.map(tc => ({
						id: tc.toolCallId,
						type: 'function',
						function: { name: tc.name, arguments: JSON.stringify(tc.parameters ?? {}) },
					})),
				});
			} else if (text) {
				out.push({ role: 'assistant', content: text });
			}
		}
	}
	return out;
}

function toOllamaMessages(messages: IChatMessage[]): { role: string; content?: string; tool_calls?: unknown[] }[] {
	// Ollama chat API uses similar message shapes; tool results as role "tool"
	return toOpenAiMessages(messages);
}

function isTextMessagePart(p: IChatMessagePart): p is IChatMessageTextPart | IChatResponseTextPart {
	return p.type === 'text';
}

function flattenText(parts: readonly IChatMessagePart[]): string {
	return parts.filter(isTextMessagePart).map(p => p.value).join('');
}

function splitUserContent(parts: IChatMessage['content']): { text: string; toolResults: { toolCallId: string; value: IChatMessage['content'] }[] } {
	const textParts: string[] = [];
	const toolResults: { toolCallId: string; value: IChatMessage['content'] }[] = [];
	for (const p of parts) {
		if (p.type === 'text') {
			textParts.push(p.value);
		} else if (p.type === 'tool_result') {
			toolResults.push({ toolCallId: p.toolCallId, value: p.value as IChatMessage['content'] });
		}
	}
	return { text: textParts.join(''), toolResults };
}

function flattenToolResult(parts: IChatMessage['content']): string {
	const texts: string[] = [];
	for (const p of parts) {
		if (p.type === 'text') {
			texts.push((p as IChatResponseTextPart).value);
		}
	}
	return texts.join('\n') || '(empty tool result)';
}

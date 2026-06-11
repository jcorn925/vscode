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
import { CUSTOM_AI_MODEL_OLLAMA, CUSTOM_AI_MODEL_OPENAI, CUSTOM_AI_SECRET_OPENAI_API_KEY, CUSTOM_AI_VENDOR } from '../common/customAiConstants.js';

type OpenAiCompatibleTool = {
	type: 'function';
	function: {
		name: string;
		description: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		parameters: any;
	};
};

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

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IRequestService private readonly _requestService: IRequestService,
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('custom.ai')) {
				this._onDidChange.fire();
			}
		}));
	}

	async provideLanguageModelChatInfo(_options: ILanguageModelChatInfoOptions, _token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		const out: ILanguageModelChatMetadataAndIdentifier[] = [];
		const providerMode = this._configurationService.getValue<string>('custom.ai.provider') ?? 'both';

		const pushOllama = () => {
			const ollamaModel = this._configurationService.getValue<string>('custom.ai.ollama.model') ?? 'llama3.1';
			out.push({
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
			});
		};

		const pushOpenAi = () => {
			const apiModel = this._configurationService.getValue<string>('custom.ai.openaiCompatible.model') ?? 'gpt-4o-mini';
			out.push({
				identifier: CUSTOM_AI_MODEL_OPENAI,
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: `OpenAI-compatible (${apiModel})`,
					id: apiModel,
					vendor: CUSTOM_AI_VENDOR,
					version: '1.0',
					family: 'openai-compatible',
					maxInputTokens: 128000,
					maxOutputTokens: 8192,
					isDefaultForLocation: {},
					isUserSelectable: true,
					capabilities: { vision: false, toolCalling: true, agentMode: true },
				},
			});
		};

		if (providerMode === 'ollama') {
			pushOllama();
		} else if (providerMode === 'openaiCompatible') {
			pushOpenAi();
		} else {
			pushOllama();
			pushOpenAi();
		}

		return out;
	}

	async sendChatRequest(modelId: string, messages: IChatMessage[], _from: ExtensionIdentifier | undefined, options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		if (modelId === CUSTOM_AI_MODEL_OLLAMA) {
			return this._ollamaChat(messages, options, token);
		}
		if (modelId === CUSTOM_AI_MODEL_OPENAI) {
			return this._openAiCompatibleChat(messages, options, token);
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

	private async _openAiCompatibleChat(messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const apiKey = await this._secretStorageService.get(CUSTOM_AI_SECRET_OPENAI_API_KEY) ?? '';
		if (!apiKey) {
			throw new Error('OpenAI-compatible API key is not set. Use the Command Palette: "Custom AI: Set OpenAI API Key".');
		}
		const model = this._configurationService.getValue<string>('custom.ai.openaiCompatible.model') ?? 'gpt-4o-mini';
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
			throw new Error(`OpenAI-compatible request failed (${ctx.res.statusCode}): ${errText.slice(0, 500)}`);
		}
		return this._streamOpenAiSse(ctx.stream, token);
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

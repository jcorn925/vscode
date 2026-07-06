/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../vs/base/common/buffer.js';
import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { generateUuid } from '../../../vs/base/common/uuid.js';
import { dirname, joinPath } from '../../../vs/base/common/resources.js';
import { URI } from '../../../vs/base/common/uri.js';
import { IConfigurationService } from '../../../vs/platform/configuration/common/configuration.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../vs/platform/files/common/files.js';
import { createDecorator } from '../../../vs/platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../vs/platform/log/common/log.js';
import { IRequestService, isSuccess } from '../../../vs/platform/request/common/request.js';
import { IWorkspaceContextService } from '../../../vs/platform/workspace/common/workspace.js';
import { AGENT_CONTEXT_FOLDER } from '../../goalWorkspace/ConsoleService.js';

export const CUSTOM_AI_OBSERVABILITY_FOLDER = 'observability';
export const CUSTOM_AI_CHAT_TRACE_FILE = 'custom-ai-chat.jsonl';

const SECRET_VALUE_PATTERNS = {
	apiKeys: /sk-[A-Za-z0-9_-]{16,}/g,
	apiKeyAssignments: /(api[_-]?key["'\s:=]+)([A-Za-z0-9._-]{12,})/gi,
	bearerTokens: /(authorization["'\s:=]+bearer\s+)([A-Za-z0-9._-]{12,})/gi,
} as const;

export const ICustomAiChatTraceService = createDecorator<ICustomAiChatTraceService>('customAiChatTraceService');

export interface ICustomAiChatTraceService {
	readonly _serviceBrand: undefined;
	createRun(input: CustomAiChatTraceRunInput): CustomAiChatTraceRun;
	traceEditEvent(type: string, payload?: Record<string, unknown>): void;
}

export interface CustomAiChatTraceRunInput {
	readonly requestId?: string;
	readonly sessionResource?: URI;
	readonly modelId?: string;
}

export interface CustomAiChatTraceRun {
	event(type: string, payload?: Record<string, unknown>): void;
	complete(payload?: Record<string, unknown>): void;
	fail(error: unknown, payload?: Record<string, unknown>): void;
	cancel(payload?: Record<string, unknown>): void;
}

export class CustomAiChatTraceService implements ICustomAiChatTraceService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IRequestService private readonly requestService: IRequestService,
	) { }

	createRun(input: CustomAiChatTraceRunInput): CustomAiChatTraceRun {
		return new CustomAiChatTraceRunImpl(this, {
			runId: createTraceRunId(),
			requestId: input.requestId,
			sessionResource: input.sessionResource?.toString(),
			modelId: input.modelId,
		});
	}

	traceEditEvent(type: string, payload?: Record<string, unknown>): void {
		this.writeEvent(type, payload);
	}

	writeEvent(type: string, payload?: Record<string, unknown>, run?: Record<string, unknown>): void {
		if (this.configurationService.getValue<boolean>('custom.ai.observability.enabled') === false) {
			return;
		}
		const event = sanitizeTraceValue({
			timestamp: new Date().toISOString(),
			type,
			...run,
			...payload,
		}, this.includeContent());

		const encoded = `${JSON.stringify(event)}\n`;
		this.logService.info('[CustomAiTrace]', encoded.trim());
		this.exportLangfuseEvent(event);

		const traceResource = this.getTraceResource();
		if (!traceResource) {
			return;
		}

		void this.appendTrace(traceResource, encoded).catch(err => {
			this.logService.warn('[CustomAiTrace] Failed to append trace event', err);
		});
	}

	private includeContent(): boolean {
		return this.configurationService.getValue<boolean>('custom.ai.observability.includeContent') === true;
	}

	private getTraceResource(): URI | undefined {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		return joinPath(folder.uri, AGENT_CONTEXT_FOLDER, CUSTOM_AI_OBSERVABILITY_FOLDER, CUSTOM_AI_CHAT_TRACE_FILE);
	}

	private async appendTrace(resource: URI, encoded: string): Promise<void> {
		await this.fileService.createFolder(dirname(resource));
		try {
			await this.fileService.writeFile(resource, VSBuffer.fromString(encoded), { append: true });
		} catch (err) {
			if (err instanceof FileOperationError && err.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await this.fileService.createFile(resource, VSBuffer.fromString(encoded), { overwrite: true });
				return;
			}
			throw err;
		}
	}

	private exportLangfuseEvent(event: unknown): void {
		const request = buildLangfuseIngestionRequest(event, this.getLangfuseOptions());
		if (!request) {
			return;
		}
		void this.requestService.request({
			type: 'POST',
			url: `${request.baseUrl}/api/public/ingestion`,
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Basic ${request.authorization}`,
			},
			data: JSON.stringify(request.body),
			timeout: 10_000,
			callSite: 'customAi.langfuse.ingestion',
		}, CancellationToken.None).then(context => {
			if (!isSuccess(context) && context.res.statusCode !== 207) {
				this.logService.warn('[CustomAiTrace] Langfuse ingestion failed', context.res.statusCode);
			}
		}, err => {
			this.logService.warn('[CustomAiTrace] Langfuse ingestion request failed', err);
		});
	}

	private getLangfuseOptions(): LangfuseTraceOptions {
		return {
			enabled: this.configurationService.getValue<boolean>('custom.ai.observability.langfuse.enabled') === true,
			baseUrl: getConfiguredString('custom.ai.observability.langfuse.baseUrl', this.configurationService) || readEnv('LANGFUSE_BASE_URL') || readEnv('LANGFUSE_HOST') || 'http://localhost:3000',
			publicKey: readEnv('LANGFUSE_PUBLIC_KEY'),
			secretKey: readEnv('LANGFUSE_SECRET_KEY'),
			environment: getConfiguredString('custom.ai.observability.langfuse.environment', this.configurationService) || readEnv('LANGFUSE_TRACING_ENVIRONMENT') || 'local',
			release: readEnv('VSCODE_GIT_COMMIT') || readEnv('GITHUB_SHA'),
		};
	}
}

class CustomAiChatTraceRunImpl implements CustomAiChatTraceRun {
	private readonly startedAt = Date.now();
	private completed = false;

	constructor(
		private readonly service: CustomAiChatTraceService,
		private readonly run: Record<string, unknown>,
	) {
		this.event('chat.request.started');
	}

	event(type: string, payload?: Record<string, unknown>): void {
		if (this.completed && type !== 'chat.request.completed' && type !== 'chat.request.failed' && type !== 'chat.request.cancelled') {
			return;
		}
		this.service.writeEvent(type, {
			elapsedMs: Date.now() - this.startedAt,
			...payload,
		}, this.run);
	}

	complete(payload?: Record<string, unknown>): void {
		if (this.completed) {
			return;
		}
		this.completed = true;
		this.event('chat.request.completed', payload);
	}

	fail(error: unknown, payload?: Record<string, unknown>): void {
		if (this.completed) {
			return;
		}
		this.completed = true;
		this.event('chat.request.failed', {
			error: errorToTraceMessage(error),
			...payload,
		});
	}

	cancel(payload?: Record<string, unknown>): void {
		if (this.completed) {
			return;
		}
		this.completed = true;
		this.event('chat.request.cancelled', payload);
	}
}

export function summarizeTraceMessages(messages: readonly { role: unknown; content: readonly { type?: string; value?: unknown }[] }[]): Record<string, unknown> {
	let textChars = 0;
	let toolUseCount = 0;
	let toolResultCount = 0;
	for (const message of messages) {
		for (const part of message.content) {
			if (typeof part.value === 'string') {
				textChars += part.value.length;
			}
			if (part.type === 'tool_use') {
				toolUseCount++;
			}
			if (part.type === 'tool_result') {
				toolResultCount++;
			}
		}
	}
	return {
		messageCount: messages.length,
		textChars,
		toolUseCount,
		toolResultCount,
	};
}

export function summarizeTraceText(value: string | undefined, includeContent: boolean, maxChars = 2048): Record<string, unknown> {
	const text = value ?? '';
	const summary: Record<string, unknown> = {
		chars: text.length,
	};
	if (includeContent && text) {
		summary.snippet = sanitizeTraceString(text.slice(0, maxChars));
		summary.truncated = text.length > maxChars;
	}
	return summary;
}

export function sanitizeTraceValue(value: unknown, includeContent = false): unknown {
	if (value === undefined) {
		return undefined;
	}
	if (value === null || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'string') {
		return includeContent ? sanitizeTraceString(value) : summarizeString(value);
	}
	if (URI.isUri(value)) {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map(item => sanitizeTraceValue(item, includeContent)).filter(item => item !== undefined);
	}
	if (typeof value === 'object') {
		const output: Record<string, unknown> = {};
		for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
			if (raw === undefined) {
				continue;
			}
			const lower = key.toLowerCase();
			if (lower.includes('key') || lower.includes('token') || lower.includes('authorization') || lower.includes('secret')) {
				output[key] = '[redacted]';
				continue;
			}
			output[key] = sanitizeTraceValue(raw, includeContent);
		}
		return output;
	}
	return String(value);
}

function summarizeString(value: string): string | number {
	if (value.length <= 512 && !looksLikeContent(value)) {
		return sanitizeTraceString(value);
	}
	return value.length;
}

function looksLikeContent(value: string): boolean {
	return value.includes('\n') || value.length > 512;
}

function sanitizeTraceString(value: string): string {
	return value
		.replace(SECRET_VALUE_PATTERNS.apiKeys, '[redacted]')
		.replace(SECRET_VALUE_PATTERNS.apiKeyAssignments, '$1[redacted]')
		.replace(SECRET_VALUE_PATTERNS.bearerTokens, '$1[redacted]');
}

function errorToTraceMessage(error: unknown): string {
	return sanitizeTraceString(error instanceof Error ? error.message : String(error));
}

export interface LangfuseTraceOptions {
	enabled: boolean;
	baseUrl: string;
	publicKey?: string;
	secretKey?: string;
	environment: string;
	release?: string;
}

export interface LangfuseIngestionRequest {
	baseUrl: string;
	authorization: string;
	body: {
		batch: unknown[];
		metadata: Record<string, unknown>;
	};
}

export function buildLangfuseIngestionRequest(event: unknown, options: LangfuseTraceOptions): LangfuseIngestionRequest | undefined {
	if (!options.enabled || !options.publicKey || !options.secretKey) {
		return undefined;
	}
	if (!event || typeof event !== 'object') {
		return undefined;
	}
	const traceEvent = event as Record<string, unknown>;
	const traceId = typeof traceEvent.runId === 'string' && traceEvent.runId ? traceEvent.runId : undefined;
	const type = typeof traceEvent.type === 'string' && traceEvent.type ? traceEvent.type : 'custom-ai.event';
	const timestamp = typeof traceEvent.timestamp === 'string' && traceEvent.timestamp ? traceEvent.timestamp : new Date().toISOString();
	const baseUrl = options.baseUrl.replace(/\/+$/, '');
	const sessionId = selectSessionId(traceEvent);
	const modelTag = typeof traceEvent.modelId === 'string' && traceEvent.modelId ? `model:${traceEvent.modelId}` : undefined;
	const tags = ['goal-workspace', 'custom-ai', modelTag].filter((value): value is string => Boolean(value));

	const batch: unknown[] = [];
	if (traceId && type === 'chat.request.started') {
		batch.push({
			id: generateUuid(),
			type: 'trace-create',
			timestamp,
			body: {
				id: traceId,
				timestamp,
				name: 'goal-workspace.custom-ai.chat',
				sessionId,
				release: options.release,
				environment: options.environment,
				tags,
				metadata: traceEvent,
			},
		});
	}

	if (traceId && type === 'chat.context.assembled') {
		batch.push({
			id: generateUuid(),
			type: 'trace-create',
			timestamp,
			body: {
				id: traceId,
				input: normalizeTracePayload(traceEvent.messageSummary),
				environment: options.environment,
			},
		});
	}

	if (traceId && (type === 'chat.request.completed' || type === 'chat.request.failed' || type === 'chat.request.cancelled')) {
		batch.push({
			id: generateUuid(),
			type: 'trace-create',
			timestamp,
			body: {
				id: traceId,
				output: normalizeTracePayload(traceEvent.finalMessageSummary),
				environment: options.environment,
				metadata: {
					outcome: type,
				},
			},
		});
	}

	if (traceId && type === 'chat.model.request.completed') {
		const round = typeof traceEvent.round === 'number' ? traceEvent.round : 0;
		batch.push({
			id: generateUuid(),
			type: 'generation-create',
			timestamp,
			body: {
				id: createObservationId(traceId, 'generation', String(round)),
				traceId,
				name: 'chat.model.request',
				startTime: pickIsoTime(traceEvent.startedAt, timestamp),
				endTime: timestamp,
				model: typeof traceEvent.modelId === 'string' ? traceEvent.modelId : undefined,
				input: normalizeTracePayload(traceEvent.messageSummary),
				output: {
					roundTextChunks: toFiniteNumber(traceEvent.roundTextChunks),
					roundResponseChars: toFiniteNumber(traceEvent.roundResponseChars),
					roundToolUses: toFiniteNumber(traceEvent.roundToolUses),
				},
				metadata: {
					round,
					durationMs: toFiniteNumber(traceEvent.durationMs),
				},
				environment: options.environment,
			},
		});
	}

	const toolObservationType = mapToolTraceEventToObservationType(type);
	if (traceId && toolObservationType) {
		const toolCallId = typeof traceEvent.toolCallId === 'string' && traceEvent.toolCallId ? traceEvent.toolCallId : undefined;
		if (toolCallId) {
			const isStart = toolObservationType === 'span-create';
			batch.push({
				id: generateUuid(),
				type: toolObservationType,
				timestamp,
				body: {
					id: createObservationId(traceId, 'tool', toolCallId),
					traceId,
					name: typeof traceEvent.toolName === 'string' ? traceEvent.toolName : 'tool-call',
					startTime: isStart ? timestamp : undefined,
					endTime: isStart ? undefined : timestamp,
					input: isStart ? normalizeTracePayload(traceEvent.parameters) : undefined,
					output: isStart ? undefined : {
						error: traceEvent.error === true,
						resultTextChars: toFiniteNumber(traceEvent.resultTextChars),
					},
					statusMessage: typeof traceEvent.error === 'string' ? traceEvent.error : undefined,
					metadata: {
						toolId: traceEvent.toolId,
						durationMs: toFiniteNumber(traceEvent.durationMs),
					},
					environment: options.environment,
				},
			});
		}
	}

	batch.push({
		id: generateUuid(),
		type: 'event-create',
		timestamp,
		body: {
			id: generateUuid(),
			traceId,
			name: type,
			startTime: timestamp,
			environment: options.environment,
			metadata: traceEvent,
			level: isTraceErrorEvent(type) ? 'ERROR' : 'DEFAULT',
			statusMessage: typeof traceEvent.error === 'string' ? traceEvent.error : undefined,
		},
	});

	const score = traceEventToScore(traceEvent);
	if (traceId && score) {
		batch.push({
			id: generateUuid(),
			type: 'score-create',
			timestamp,
			body: {
				traceId,
				name: score.name,
				value: score.value,
				dataType: 'BOOLEAN',
				environment: options.environment,
				comment: score.comment,
				metadata: traceEvent,
			},
		});
	}

	return {
		baseUrl,
		authorization: encodeBase64(VSBuffer.fromString(`${options.publicKey}:${options.secretKey}`)),
		body: {
			batch,
			metadata: {
				source: 'goalconsole-custom-ai',
				sdk: 'custom-ai-chat-trace',
			},
		},
	};
}

function mapToolTraceEventToObservationType(type: string): 'span-create' | 'span-update' | undefined {
	if (type === 'chat.tool_call.started') {
		return 'span-create';
	}
	if (type === 'chat.tool_call.completed' || type === 'chat.tool_call.failed') {
		return 'span-update';
	}
	return undefined;
}

function createObservationId(traceId: string, kind: string, suffix: string): string {
	const normalizedSuffix = suffix.replace(/[^A-Za-z0-9._-]/g, '_');
	return `${traceId}.${kind}.${normalizedSuffix}`;
}

function selectSessionId(event: Record<string, unknown>): string | undefined {
	if (typeof event.sessionResource === 'string' && event.sessionResource) {
		return event.sessionResource;
	}
	if (typeof event.requestId === 'string' && event.requestId) {
		return event.requestId;
	}
	return undefined;
}

function pickIsoTime(value: unknown, fallback: string): string {
	return typeof value === 'string' && value ? value : fallback;
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeTracePayload(value: unknown): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}
	const normalized: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (entry === undefined) {
			continue;
		}
		normalized[key] = entry;
	}
	return Object.keys(normalized).length ? normalized : undefined;
}

function traceEventToScore(event: Record<string, unknown>): { name: string; value: 0 | 1; comment?: string } | undefined {
	if (event.type === 'chat.request.completed') {
		return { name: 'custom-ai.chat.completed', value: 1 };
	}
	if (event.type === 'chat.request.failed' || event.type === 'chat.request.cancelled') {
		return { name: 'custom-ai.chat.completed', value: 0, comment: typeof event.error === 'string' ? event.error : undefined };
	}
	if (event.type === 'verify_surface_blueprint.completed') {
		return { name: 'surface-blueprint.verified', value: event.passed === true ? 1 : 0 };
	}
	return undefined;
}

function isTraceErrorEvent(type: string): boolean {
	return type.endsWith('.failed') || type.endsWith('.cancelled');
}

function readEnv(name: string): string | undefined {
	const globalWithProcess = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
	const value = globalWithProcess.process?.env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getConfiguredString(key: string, configurationService: IConfigurationService): string | undefined {
	const value = configurationService.getValue<string>(key);
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function createTraceRunId(): string {
	return `custom-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../vs/base/common/buffer.js';
import { dirname, joinPath } from '../../../vs/base/common/resources.js';
import { URI } from '../../../vs/base/common/uri.js';
import { IConfigurationService } from '../../../vs/platform/configuration/common/configuration.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../vs/platform/files/common/files.js';
import { createDecorator } from '../../../vs/platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../vs/platform/log/common/log.js';
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

function createTraceRunId(): string {
	return `custom-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

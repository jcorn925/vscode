/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { VSBuffer } from '../../../vs/base/common/buffer.js';
import { isAbsolute } from '../../../vs/base/common/path.js';
import { joinPath } from '../../../vs/base/common/resources.js';
import { URI } from '../../../vs/base/common/uri.js';
import { TextEdit } from '../../../vs/editor/common/languages.js';
import { IConfigurationService } from '../../../vs/platform/configuration/common/configuration.js';
import { IFileService, FileOperationError, FileOperationResult } from '../../../vs/platform/files/common/files.js';
import { ILogService } from '../../../vs/platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../vs/platform/workspace/common/workspace.js';
import { ICodeMapperService } from '../../../vs/workbench/contrib/chat/common/editing/chatCodeMapperService.js';
import { IChatService } from '../../../vs/workbench/contrib/chat/common/chatService/chatService.js';
import { ChatModel } from '../../../vs/workbench/contrib/chat/common/model/chatModel.js';
import {
	CountTokensCallback,
	IPreparedToolInvocation,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolInvocationPreparationContext,
	IToolResult,
	ToolDataSource,
	ToolInvocationPresentation,
	ToolProgress,
} from '../../../vs/workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { CUSTOM_AI_EDIT_FILE_TOOL_ID, CUSTOM_AI_EDIT_FILE_TOOL_NAME } from '../common/customAiConstants.js';
import { ICustomAiChatTraceService } from './customAiChatTrace.js';

export const CustomAiEditFileToolData: IToolData = {
	id: CUSTOM_AI_EDIT_FILE_TOOL_ID,
	toolReferenceName: CUSTOM_AI_EDIT_FILE_TOOL_NAME,
	displayName: 'Edit file',
	modelDescription: [
		'Modify an existing file or create a new file in the workspace.',
		'',
		'Use this tool when the user asks you to change, write, refactor, fix, or create code and the required context is clear.',
		'For goal-workspace changes, plan affected surfaces and shared context first, then call this tool for the needed manifest, app, shared workflow/domain/event, memory, and Ix metadata files.',
		'Do NOT respond with instructions for the user to make the change themselves when you can make the edit safely.',
		'',
		'Arguments:',
		'  uri         (string, required) Workspace-relative path (e.g. "src/components/Button.tsx") or absolute file URI / path.',
		'  code        (string, required) The complete new contents for the file. Provide the entire file, not a partial diff.',
		'  explanation (string, optional) One-sentence rationale shown to the human reviewer.',
		'',
		'If the file does not exist it will be created (including any missing parent directories).',
		'When editing workspace.goal.json, write this schema exactly:',
		'  { "goal": { "id": "...", "name": "...", "description": "...", "northStarMetric": "..." }, "surfaces": [{ "id": "...", "name": "...", "type": "web-app", "path": "apps/<surface>", "description": "...", "devCommand": "npm --prefix apps/<surface> run dev", "localUrl": "http://localhost:<port>", "capabilities": [], "events": [], "entities": [], "ixSubsystems": [] }], "shared": { "domain": "packages/domain", "events": "packages/events", "workflows": "workflows" } }',
		'Never put surfaces inside goal, never encode surfaces as an object map, and never replace arrays like capabilities/events/entities with objects.',
		'Invalid workspace.goal.json writes are rejected before they reach disk.',
		'By default, edits are written directly so goal-workspace scaffolding creates usable files; configure review mode when human accept/reject is required.',
	].join('\n'),
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	inputSchema: {
		type: 'object',
		properties: {
			uri: {
				type: 'string',
				description: 'Workspace-relative path (preferred) or absolute file URI/path.',
			},
			code: {
				type: 'string',
				description: 'The complete new contents for the file.',
			},
			explanation: {
				type: 'string',
				description: 'One-sentence rationale shown to the human reviewer.',
			},
		},
		required: ['uri', 'code'],
	},
};

interface EditFileToolParams {
	uri: string;
	code: string;
	explanation?: string;
}

type ApplyMode = 'review' | 'direct';

export class CustomAiEditFileTool implements IToolImpl {

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IChatService private readonly _chatService: IChatService,
		@ICodeMapperService private readonly _codeMapperService: ICodeMapperService,
		@ILogService private readonly _logService: ILogService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ICustomAiChatTraceService private readonly _traceService: ICustomAiChatTraceService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		return { presentation: ToolInvocationPresentation.Hidden };
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as Partial<EditFileToolParams>;
		const rawUri = typeof params.uri === 'string' ? params.uri.trim() : '';
		const code = typeof params.code === 'string' ? params.code : undefined;
		const explanation = typeof params.explanation === 'string' ? params.explanation : undefined;
		if (!rawUri) {
			this._traceService.traceEditEvent('edit_file.failed', { reason: 'missingUri' });
			return errorResult('Missing required argument: uri');
		}
		if (code === undefined) {
			this._traceService.traceEditEvent('edit_file.failed', { reason: 'missingCode', uri: rawUri });
			return errorResult('Missing required argument: code');
		}

		const uri = this._resolveUri(rawUri);
		if (!uri) {
			this._traceService.traceEditEvent('edit_file.failed', { reason: 'unresolvedUri', uri: rawUri });
			return errorResult(`Could not resolve "${rawUri}" to a workspace file. Pass an absolute path or workspace-relative path.`);
		}

		const manifestValidationError = validateCustomAiWorkspaceGoalEdit(uri, code);
		if (manifestValidationError) {
			this._traceService.traceEditEvent('edit_file.failed', {
				reason: 'invalidWorkspaceGoalManifest',
				uri: uri.toString(),
				error: manifestValidationError,
			});
			return errorResult(`Refusing to write invalid workspace.goal.json: ${manifestValidationError}`);
		}

		const mode = this._resolveMode();
		const startedAt = Date.now();
		this._traceService.traceEditEvent('edit_file.started', {
			uri: uri.toString(),
			mode,
			codeChars: code.length,
			hasExplanation: Boolean(explanation?.trim()),
			chatRequestId: invocation.chatRequestId,
			modelId: invocation.modelId,
		});

		try {
			if (mode === 'direct') {
				await this._applyDirect(uri, code);
				this._traceService.traceEditEvent('edit_file.direct_write', {
					uri: uri.toString(),
					mode,
					durationMs: Date.now() - startedAt,
					fallback: false,
				});
				return successResult(`Wrote ${uri.fsPath}. (apply mode: direct — no review UI)`);
			}
			const reviewed = await this._applyReview(uri, code, explanation, invocation, token);
			if (reviewed === 'noEditingSession') {
				this._logService.warn('[CustomAi] editFile: no active editing session; falling back to direct write.');
				this._traceService.traceEditEvent('edit_file.review_unavailable', {
					uri: uri.toString(),
					mode,
					durationMs: Date.now() - startedAt,
				});
				await this._applyDirect(uri, code);
				this._traceService.traceEditEvent('edit_file.direct_write', {
					uri: uri.toString(),
					mode,
					durationMs: Date.now() - startedAt,
					fallback: true,
				});
				return successResult(`Wrote ${uri.fsPath}. (no editing session — switch chat to Edit or Agent mode for the diff/accept UI)`);
			}
			this._traceService.traceEditEvent('edit_file.review_proposed', {
				uri: uri.toString(),
				mode,
				durationMs: Date.now() - startedAt,
			});
			return successResult(`Proposed edit to ${uri.fsPath}. The user can review and accept/reject the change in the chat. (apply mode: review)`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._logService.error('[CustomAi] editFile failed', uri.toString(), err);
			this._traceService.traceEditEvent('edit_file.failed', {
				uri: uri.toString(),
				mode,
				durationMs: Date.now() - startedAt,
				error: msg,
			});
			return errorResult(`Failed to edit ${uri.fsPath}: ${msg}`);
		}
	}

	private _resolveMode(): ApplyMode {
		const raw = this._configurationService.getValue<string>('custom.ai.edit.applyMode');
		return raw === 'direct' ? 'direct' : 'review';
	}

	private _resolveUri(input: string): URI | undefined {
		const trimmed = input.replace(/^["']|["']$/g, '');
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
			try {
				return URI.parse(trimmed);
			} catch {
				return undefined;
			}
		}
		if (isAbsolute(trimmed)) {
			return URI.file(trimmed);
		}
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (!folders.length) {
			return undefined;
		}
		// Prefer the first matching folder; absent that, anchor to folders[0].
		for (const f of folders) {
			if (trimmed.startsWith(f.name + '/')) {
				return joinPath(f.uri, trimmed.slice(f.name.length + 1));
			}
		}
		return joinPath(folders[0].uri, trimmed);
	}

	private async _applyDirect(uri: URI, code: string): Promise<void> {
		try {
			await this._fileService.writeFile(uri, VSBuffer.fromString(code));
		} catch (err) {
			if (err instanceof FileOperationError && err.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await this._fileService.createFile(uri, VSBuffer.fromString(code), { overwrite: true });
				return;
			}
			throw err;
		}
	}

	private async _applyReview(
		uri: URI,
		code: string,
		explanation: string | undefined,
		invocation: IToolInvocation,
		token: CancellationToken,
	): Promise<'ok' | 'noEditingSession'> {
		const sessionResource = invocation.context?.sessionResource;
		if (!sessionResource) {
			return 'noEditingSession';
		}
		const session = this._chatService.getSession(sessionResource);
		if (!session) {
			return 'noEditingSession';
		}
		const model = session as ChatModel;
		const editingSession = model.editingSession;
		if (!editingSession) {
			return 'noEditingSession';
		}
		const request = model.getRequests().at(-1);
		if (!request) {
			return 'noEditingSession';
		}

		// Surface the proposed change in the response stream so the chat list renders the diff chip.
		model.acceptResponseProgress(request, { kind: 'textEdit', uri, edits: [] });

		const result = await this._codeMapperService.mapCode({
			codeBlocks: [{ code, resource: uri, markdownBeforeBlock: explanation }],
			location: 'tool',
			chatRequestId: invocation.chatRequestId,
			chatRequestModel: invocation.modelId,
			chatSessionResource: sessionResource,
		}, {
			textEdit: (target: URI, edits: TextEdit[]) => {
				model.acceptResponseProgress(request, { kind: 'textEdit', uri: target, edits });
			},
			notebookEdit: () => {
				// Notebook edits are intentionally not supported in this minimal tool.
			},
		}, token);

		model.acceptResponseProgress(request, { kind: 'textEdit', uri, edits: [], done: true });

		if (result?.errorMessage) {
			throw new Error(result.errorMessage);
		}
		return 'ok';
	}
}

function errorResult(message: string): IToolResult {
	return { content: [{ kind: 'text', value: message }], toolResultError: true };
}

function successResult(message: string): IToolResult {
	return { content: [{ kind: 'text', value: message }] };
}

export function validateCustomAiWorkspaceGoalEdit(uri: URI, code: string): string | undefined {
	if (!uri.path.endsWith('/workspace.goal.json')) {
		return undefined;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(code);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return `manifest must be valid JSON (${message})`;
	}

	if (!isRecord(raw)) {
		return 'manifest root must be an object with top-level goal and surfaces fields';
	}
	if (!isRecord(raw.goal)) {
		return 'top-level "goal" must be an object, not a string or array';
	}
	if (!isNonEmptyString(raw.goal.id)) {
		return 'goal.id must be a non-empty string';
	}
	if (!isNonEmptyString(raw.goal.name)) {
		return 'goal.name must be a non-empty string';
	}
	if (!Array.isArray(raw.surfaces)) {
		return 'top-level "surfaces" must be an array; do not nest surfaces under goal or encode them as an object';
	}

	for (let i = 0; i < raw.surfaces.length; i++) {
		const surface = raw.surfaces[i];
		if (!isRecord(surface)) {
			return `surfaces[${i}] must be an object`;
		}
		for (const field of ['id', 'name', 'type', 'path'] as const) {
			if (!isNonEmptyString(surface[field])) {
				return `surfaces[${i}].${field} must be a non-empty string`;
			}
		}
		for (const field of ['capabilities', 'events', 'entities'] as const) {
			if (surface[field] !== undefined && !Array.isArray(surface[field])) {
				return `surfaces[${i}].${field} must be an array when present`;
			}
		}
		const ixValue = surface.ixSubsystems ?? surface.ix;
		if (ixValue !== undefined && !Array.isArray(ixValue) && !isRecord(ixValue)) {
			return `surfaces[${i}].ixSubsystems or ix must be an array or object when present`;
		}
	}

	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

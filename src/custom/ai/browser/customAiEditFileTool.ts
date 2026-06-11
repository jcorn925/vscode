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

export const CustomAiEditFileToolData: IToolData = {
	id: CUSTOM_AI_EDIT_FILE_TOOL_ID,
	toolReferenceName: CUSTOM_AI_EDIT_FILE_TOOL_NAME,
	displayName: 'Edit file',
	modelDescription: [
		'Modify an existing file or create a new file in the workspace.',
		'',
		'Use this tool any time the user asks you to change, write, refactor, fix, or create code.',
		'Do NOT respond with instructions for the user to make the change themselves — call this tool instead.',
		'',
		'Arguments:',
		'  uri         (string, required) Workspace-relative path (e.g. "src/components/Button.tsx") or absolute file URI / path.',
		'  code        (string, required) The complete new contents for the file. Provide the entire file, not a partial diff.',
		'  explanation (string, optional) One-sentence rationale shown to the human reviewer.',
		'',
		'If the file does not exist it will be created (including any missing parent directories).',
		'By default, edits are applied to disk immediately. Do not ask the user to accept or confirm the change.',
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
			return errorResult('Missing required argument: uri');
		}
		if (code === undefined) {
			return errorResult('Missing required argument: code');
		}

		const uri = this._resolveUri(rawUri);
		if (!uri) {
			return errorResult(`Could not resolve "${rawUri}" to a workspace file. Pass an absolute path or workspace-relative path.`);
		}

		const mode = this._resolveMode();

		try {
			if (mode === 'direct') {
				await this._applyDirect(uri, code);
				return successResult(`Wrote ${uri.fsPath}. (apply mode: direct — no review UI)`);
			}
			const reviewed = await this._applyReview(uri, code, explanation, invocation, token);
			if (reviewed === 'noEditingSession') {
				this._logService.warn('[CustomAi] editFile: no active editing session; falling back to direct write.');
				await this._applyDirect(uri, code);
				return successResult(`Wrote ${uri.fsPath}. (no editing session — switch chat to Edit or Agent mode for the diff/accept UI)`);
			}
			return successResult(`Proposed edit to ${uri.fsPath}. The user can review and accept/reject the change in the chat. (apply mode: review)`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._logService.error('[CustomAi] editFile failed', uri.toString(), err);
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

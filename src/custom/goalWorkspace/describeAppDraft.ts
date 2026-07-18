/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { basename, isEqualOrParent, joinPath, relativePath } from '../../vs/base/common/resources.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { AGENT_CONTEXT_FOLDER } from './ConsoleService.js';

export const DESCRIBE_APP_DRAFT_FILE = 'describe-app.draft.json';
export const DESCRIBE_APP_DRAFT_ATTACHMENTS_FOLDER = 'describe-app-draft';

export type DescribeAppAttachmentKind = 'image' | 'file';

/**
 * Path-only attachment reference. Prefer the original filesystem location;
 * stage under `.agent/surfaces/describe-app-draft/attachments/` only when the
 * browser File has no native path (e.g. pasted blob).
 */
export interface DescribeAppAttachmentRef {
	readonly id: string;
	readonly kind: DescribeAppAttachmentKind;
	readonly name: string;
	readonly mimeType: string;
	/** Absolute filesystem path when known. */
	readonly fsPath?: string;
	/** Workspace-relative path when the file lives inside the workspace (or was staged). */
	readonly workspacePath?: string;
}

export interface DescribeAppDraft {
	readonly version: 1;
	readonly surfaceName: string;
	readonly intent: string;
	readonly attachments: readonly DescribeAppAttachmentRef[];
	readonly savedAt?: string;
}

export function describeAppDraftResource(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, 'surfaces', DESCRIBE_APP_DRAFT_FILE);
}

export function describeAppDraftAttachmentsDir(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, 'surfaces', DESCRIBE_APP_DRAFT_ATTACHMENTS_FOLDER, 'attachments');
}

export function attachmentRefDisplayPath(attachment: DescribeAppAttachmentRef): string {
	return attachment.workspacePath
		?? attachment.fsPath
		?? attachment.name;
}

export function attachmentRefResource(workspaceFolder: URI, attachment: DescribeAppAttachmentRef): URI | undefined {
	if (attachment.workspacePath) {
		return joinPath(workspaceFolder, attachment.workspacePath);
	}
	if (attachment.fsPath) {
		return URI.file(attachment.fsPath);
	}
	return undefined;
}

export function toWorkspaceOrFsPaths(
	workspaceFolder: URI,
	absoluteFsPath: string,
): { fsPath: string; workspacePath?: string } {
	const resource = URI.file(absoluteFsPath);
	if (isEqualOrParent(resource, workspaceFolder)) {
		const rel = relativePath(workspaceFolder, resource);
		if (rel) {
			return { fsPath: absoluteFsPath, workspacePath: rel };
		}
	}
	return { fsPath: absoluteFsPath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAttachment(raw: unknown): DescribeAppAttachmentRef | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const id = typeof raw.id === 'string' ? raw.id : undefined;
	const name = typeof raw.name === 'string' ? raw.name : undefined;
	const kind = raw.kind === 'image' || raw.kind === 'file' ? raw.kind : undefined;
	if (!id || !name || !kind) {
		return undefined;
	}
	const fsPath = typeof raw.fsPath === 'string' && raw.fsPath.trim() ? raw.fsPath.trim() : undefined;
	const workspacePath = typeof raw.workspacePath === 'string' && raw.workspacePath.trim() ? raw.workspacePath.trim().replace(/\\/g, '/') : undefined;
	if (!fsPath && !workspacePath) {
		return undefined;
	}
	return {
		id,
		kind,
		name,
		mimeType: typeof raw.mimeType === 'string' && raw.mimeType.trim() ? raw.mimeType.trim() : 'application/octet-stream',
		fsPath,
		workspacePath,
	};
}

export function parseDescribeAppDraft(raw: string): DescribeAppDraft | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed) || parsed.version !== 1) {
			return undefined;
		}
		const attachmentsRaw = Array.isArray(parsed.attachments) ? parsed.attachments : [];
		const attachments: DescribeAppAttachmentRef[] = [];
		for (const item of attachmentsRaw) {
			const attachment = parseAttachment(item);
			if (attachment) {
				attachments.push(attachment);
			}
		}
		return {
			version: 1,
			surfaceName: typeof parsed.surfaceName === 'string' ? parsed.surfaceName : '',
			intent: typeof parsed.intent === 'string' ? parsed.intent : '',
			attachments,
			savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : undefined,
		};
	} catch {
		return undefined;
	}
}

export async function loadDescribeAppDraft(
	fileService: IFileService,
	workspaceFolder: URI | undefined,
): Promise<DescribeAppDraft | undefined> {
	if (!workspaceFolder) {
		return undefined;
	}
	try {
		const content = await fileService.readFile(describeAppDraftResource(workspaceFolder));
		return parseDescribeAppDraft(content.value.toString());
	} catch {
		return undefined;
	}
}

export async function saveDescribeAppDraft(
	fileService: IFileService,
	workspaceFolder: URI | undefined,
	draft: Omit<DescribeAppDraft, 'version' | 'savedAt'> & { savedAt?: string },
): Promise<DescribeAppDraft | undefined> {
	if (!workspaceFolder) {
		return undefined;
	}
	const payload: DescribeAppDraft = {
		version: 1,
		surfaceName: draft.surfaceName,
		intent: draft.intent,
		attachments: draft.attachments,
		savedAt: draft.savedAt ?? new Date().toISOString(),
	};
	await fileService.createFolder(joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, 'surfaces'));
	await fileService.writeFile(
		describeAppDraftResource(workspaceFolder),
		VSBuffer.fromString(JSON.stringify(payload, null, 2)),
	);
	return payload;
}

export async function clearDescribeAppDraft(
	fileService: IFileService,
	workspaceFolder: URI | undefined,
): Promise<void> {
	if (!workspaceFolder) {
		return;
	}
	try {
		await fileService.del(describeAppDraftResource(workspaceFolder));
	} catch {
		// missing draft is fine
	}
}

/**
 * Persist a File that has no native path into the draft attachments folder once,
 * returning a workspace-relative reference (no long-lived in-memory bytes).
 */
export async function stageDescribeAppAttachment(
	fileService: IFileService,
	workspaceFolder: URI,
	file: File,
	kind: DescribeAppAttachmentKind,
): Promise<DescribeAppAttachmentRef> {
	const attachDir = describeAppDraftAttachmentsDir(workspaceFolder);
	await fileService.createFolder(attachDir);
	const safeName = uniqueStagedFileName(file.name);
	const resource = joinPath(attachDir, safeName);
	const bytes = new Uint8Array(await file.arrayBuffer());
	await fileService.writeFile(resource, VSBuffer.wrap(bytes));
	const workspacePath = relativePath(workspaceFolder, resource) ?? `.agent/surfaces/${DESCRIBE_APP_DRAFT_ATTACHMENTS_FOLDER}/attachments/${safeName}`;
	return {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		kind,
		name: file.name || basename(resource),
		mimeType: file.type || 'application/octet-stream',
		fsPath: resource.scheme === 'file' ? resource.fsPath : undefined,
		workspacePath,
	};
}

function uniqueStagedFileName(name: string): string {
	const cleaned = name.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '') || 'attachment';
	const stamp = Date.now().toString(36);
	const dot = cleaned.lastIndexOf('.');
	if (dot > 0) {
		return `${cleaned.slice(0, dot)}-${stamp}${cleaned.slice(dot)}`;
	}
	return `${cleaned}-${stamp}`;
}

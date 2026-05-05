/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import type { ProcessNote, ProcessNotesFile } from './processNotesTypes.js';

const DEFAULT_NOTES_FILE = '.vscode/process-notes.json';

export class ProcessNotesStore extends Disposable {
	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	getNotesResource(): URI | undefined {
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!folder) {
			return undefined;
		}
		return URI.joinPath(folder, DEFAULT_NOTES_FILE);
	}

	async load(): Promise<ProcessNotesFile | undefined> {
		const resource = this.getNotesResource();
		if (!resource) {
			return undefined;
		}
		try {
			const buf = await this.fileService.readFile(resource);
			const json = JSON.parse(buf.value.toString()) as ProcessNotesFile;
			if (!json || json.version !== 1 || !Array.isArray(json.notes)) {
				return undefined;
			}
			return json;
		} catch {
			return undefined;
		}
	}

	async save(file: ProcessNotesFile): Promise<void> {
		const resource = this.getNotesResource();
		if (!resource) {
			throw new Error('No workspace folder');
		}
		// Ensure .vscode exists
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (folder) {
			await this.fileService.createFolder(URI.joinPath(folder, '.vscode'));
		}
		await this.fileService.writeFile(resource, VSBuffer.fromString(JSON.stringify(file, null, 2) + '\n'));
	}

	async upsertNote(note: ProcessNote): Promise<ProcessNotesFile> {
		const existing = await this.load();
		const current: ProcessNotesFile = existing ?? { version: 1, notes: [] };
		const notes = [...current.notes.filter(n => n.id !== note.id), note];
		const next: ProcessNotesFile = { version: 1, notes };
		await this.save(next);
		return next;
	}
}


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import {
	attachmentRefDisplayPath,
	describeAppDraftResource,
	loadDescribeAppDraft,
	parseDescribeAppDraft,
	saveDescribeAppDraft,
	toWorkspaceOrFsPaths,
} from '../../../../../../custom/goalWorkspace/describeAppDraft.js';

suite('describeAppDraft', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');

	test('parseDescribeAppDraft keeps path refs only', () => {
		const draft = parseDescribeAppDraft(JSON.stringify({
			version: 1,
			surfaceName: 'Cadre',
			intent: 'Build a bot',
			attachments: [
				{ id: '1', kind: 'image', name: 'shot.png', mimeType: 'image/png', workspacePath: 'docs/shot.png' },
				{ id: '2', kind: 'file', name: 'brief.pdf', mimeType: 'application/pdf', fsPath: '/tmp/brief.pdf' },
				{ id: 'bad', kind: 'file', name: 'no-path.txt', mimeType: 'text/plain' },
			],
		}));
		assert.ok(draft);
		assert.strictEqual(draft.attachments.length, 2);
		assert.strictEqual(attachmentRefDisplayPath(draft.attachments[0]!), 'docs/shot.png');
		assert.strictEqual(attachmentRefDisplayPath(draft.attachments[1]!), '/tmp/brief.pdf');
	});

	test('toWorkspaceOrFsPaths prefers workspace-relative when inside root', () => {
		const inside = toWorkspaceOrFsPaths(workspaceFolder, '/workspace/docs/a.png');
		assert.strictEqual(inside.workspacePath, 'docs/a.png');
		const outside = toWorkspaceOrFsPaths(workspaceFolder, '/tmp/a.png');
		assert.strictEqual(outside.workspacePath, undefined);
		assert.strictEqual(outside.fsPath, '/tmp/a.png');
	});

	test('save and load round-trip', async () => {
		const fileService = new TestDraftFileService();
		await saveDescribeAppDraft(fileService as unknown as IFileService, workspaceFolder, {
			surfaceName: 'Cadre',
			intent: 'Hello',
			attachments: [{
				id: '1',
				kind: 'file',
				name: 'notes.md',
				mimeType: 'text/markdown',
				workspacePath: 'notes.md',
			}],
		});
		const loaded = await loadDescribeAppDraft(fileService as unknown as IFileService, workspaceFolder);
		assert.ok(loaded);
		assert.strictEqual(loaded.surfaceName, 'Cadre');
		assert.strictEqual(loaded.attachments[0]?.workspacePath, 'notes.md');
		assert.ok(fileService.has(describeAppDraftResource(workspaceFolder)));
	});
});

class TestDraftFileService {
	private readonly files = new Map<string, string>();

	has(resource: URI): boolean {
		return this.files.has(resource.toString());
	}

	async createFolder(): Promise<void> { }

	async readFile(resource: URI): Promise<IFileContent> {
		const value = this.files.get(resource.toString());
		if (value === undefined) {
			throw new Error('missing');
		}
		return { value: VSBuffer.fromString(value) } as IFileContent;
	}

	async writeFile(resource: URI, content: VSBuffer): Promise<void> {
		this.files.set(resource.toString(), content.toString());
	}

	async del(resource: URI): Promise<void> {
		this.files.delete(resource.toString());
	}
}

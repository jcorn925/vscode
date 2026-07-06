/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileContent, IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { readWorkflowCatalog, upsertWorkflowSpec, workflowCatalogResource } from '../../../../../../custom/goalWorkspace/workflowCatalogService.js';

suite('workflowCatalogService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('writes and reads catalog specs', async () => {
		const fileService = new TestFileService();
		const workspaceFolder = URI.file('/workspace');
		const resource = workflowCatalogResource(workspaceFolder, 'workflows');

		await upsertWorkflowSpec(fileService as unknown as IFileService, resource, {
			id: 'booking-intake',
			label: 'Booking intake flow',
			scope: 'surface',
			surfaceId: 'booking',
			source: 'template:booking',
			steps: [
				{ id: 'ensure-server', type: 'ensureServer' },
				{ id: 'open-packages', type: 'navigate', route: '/packages' },
			],
			events: ['booking.started'],
			ixBindings: [{ stepId: 'open-packages', subsystemLabel: 'Booking UI' }],
		});

		const catalog = await readWorkflowCatalog(fileService as unknown as IFileService, resource);
		assert.ok(catalog);
		assert.strictEqual(catalog?.workflows.length, 1);
		assert.strictEqual(catalog?.workflows[0]?.id, 'booking-intake');
		assert.strictEqual(catalog?.workflows[0]?.steps[1]?.route, '/packages');
	});

	test('ignores malformed workflow definitions', async () => {
		const fileService = new TestFileService();
		const workspaceFolder = URI.file('/workspace');
		const resource = workflowCatalogResource(workspaceFolder, 'workflows');
		fileService.setFile(resource, JSON.stringify({
			version: 1,
			workflows: [{ id: 'broken' }]
		}));
		const catalog = await readWorkflowCatalog(fileService as unknown as IFileService, resource);
		assert.ok(catalog);
		assert.strictEqual(catalog?.workflows.length, 0);
	});
});

class TestFileService {
	private readonly files = new Map<string, string>();

	setFile(resource: URI, content: string): void {
		this.files.set(resource.toString(), content);
	}

	async exists(resource: URI): Promise<boolean> {
		return this.files.has(resource.toString());
	}

	async readFile(resource: URI): Promise<IFileContent> {
		const content = this.files.get(resource.toString());
		if (content === undefined) {
			throw new Error(`File not found: ${resource.toString()}`);
		}
		return {
			resource,
			name: resource.path.split('/').pop() ?? 'file',
			mtime: 0,
			ctime: 0,
			etag: 'test',
			size: content.length,
			readonly: false,
			locked: false,
			executable: false,
			value: VSBuffer.fromString(content),
		};
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		this.files.set(joinPath(resource, '.folder').toString(), '');
		return this.resolve(resource);
	}

	async writeFile(resource: URI, content: VSBuffer): Promise<IFileStat> {
		this.files.set(resource.toString(), content.toString());
		return this.resolve(resource);
	}

	async resolve(resource: URI): Promise<IFileStat> {
		const content = this.files.get(resource.toString());
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
			isDirectory: content === undefined,
			isFile: content !== undefined,
			isSymbolicLink: false,
			readonly: false,
			locked: false,
			children: [],
			mtime: 0,
			ctime: 0,
			size: content?.length ?? 0,
			etag: 'test',
		};
	}
}

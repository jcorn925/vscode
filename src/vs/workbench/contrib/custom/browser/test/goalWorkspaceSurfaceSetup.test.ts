/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { WORKSPACE_MANIFEST } from '../../../../../../custom/goalWorkspace/ConsoleService.js';
import {
	deleteGoalWorkspaceSurface,
	upsertImportedGoalWorkspaceSurface,
} from '../../../../../../custom/goalWorkspace/goalWorkspaceSurfaceSetup.js';
import {
	surfaceGraphProposalDraftResource,
	surfaceGraphProposalResource,
	surfacePlanResource,
} from '../../../../../../custom/goalWorkspace/surfacePlanPaths.js';

suite('goalWorkspaceSurfaceSetup', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');
	const manifest = joinPath(workspaceFolder, WORKSPACE_MANIFEST);

	test('adds imported surface to manifest', async () => {
		const fileService = new TestSurfaceSetupFileService();
		fileService.setFile(manifest, JSON.stringify({
			goal: { id: 'goal', name: 'Goal' },
			surfaces: [],
			shared: {},
		}));

		const imported = await upsertImportedGoalWorkspaceSurface(fileService as unknown as IFileService, workspaceFolder, {
			surfaceId: 'customer-portal',
			surfaceName: 'Customer Portal',
			relativePath: 'apps/customer-portal',
			devCommand: 'npm --prefix apps/customer-portal run dev',
			localUrl: 'http://localhost:3001',
		});

		assert.strictEqual(imported, true);
		const raw = JSON.parse(fileService.getFile(manifest));
		assert.strictEqual(raw.surfaces.length, 1);
		assert.deepStrictEqual(raw.surfaces[0], {
			id: 'customer-portal',
			name: 'Customer Portal',
			type: 'web-app',
			path: 'apps/customer-portal',
			purpose: 'Imported app surface for Customer Portal.',
			capabilities: [],
			events: [],
			entities: [],
			ixSubsystems: [],
			devCommand: 'npm --prefix apps/customer-portal run dev',
			localUrl: 'http://localhost:3001',
		});
	});

	test('updates matching imported surface without deleting existing metadata', async () => {
		const fileService = new TestSurfaceSetupFileService();
		fileService.setFile(manifest, JSON.stringify({
			goal: { id: 'goal', name: 'Goal' },
			surfaces: [{
				id: 'customer-portal',
				name: 'Old Portal',
				type: 'mobile-app',
				path: 'apps/old',
				devCommand: 'npm run old',
				localUrl: 'http://localhost:3009',
				purpose: 'Existing purpose.',
				capabilities: ['accounts'],
				events: ['account.updated'],
				entities: ['Account'],
				ixSubsystems: ['Accounts UI'],
				customField: true,
			}],
			shared: {},
		}));

		const imported = await upsertImportedGoalWorkspaceSurface(fileService as unknown as IFileService, workspaceFolder, {
			surfaceId: 'customer-portal',
			surfaceName: 'Customer Portal',
			relativePath: 'apps/customer-portal',
		});

		assert.strictEqual(imported, true);
		const raw = JSON.parse(fileService.getFile(manifest));
		assert.strictEqual(raw.surfaces.length, 1);
		assert.strictEqual(raw.surfaces[0].name, 'Customer Portal');
		assert.strictEqual(raw.surfaces[0].type, 'mobile-app');
		assert.strictEqual(raw.surfaces[0].path, 'apps/customer-portal');
		assert.strictEqual(raw.surfaces[0].devCommand, 'npm run old');
		assert.strictEqual(raw.surfaces[0].localUrl, 'http://localhost:3009');
		assert.strictEqual(raw.surfaces[0].purpose, 'Existing purpose.');
		assert.deepStrictEqual(raw.surfaces[0].capabilities, ['accounts']);
		assert.deepStrictEqual(raw.surfaces[0].events, ['account.updated']);
		assert.deepStrictEqual(raw.surfaces[0].entities, ['Account']);
		assert.deepStrictEqual(raw.surfaces[0].ixSubsystems, ['Accounts UI']);
		assert.strictEqual(raw.surfaces[0].customField, true);
	});

	test('deleteGoalWorkspaceSurface removes manifest entry and plan/proposal artifacts', async () => {
		const fileService = new TestSurfaceSetupFileService();
		fileService.setFile(manifest, JSON.stringify({
			goal: { id: 'goal', name: 'Goal' },
			surfaces: [{
				id: 'cadre-bot',
				name: 'Cadre bot',
				type: 'web-app',
				path: 'apps/cadre-bot',
				purpose: 'Planning surface.',
				capabilities: [],
				events: [],
				entities: [],
				ixSubsystems: [],
			}],
			shared: {},
		}));
		const plan = surfacePlanResource(workspaceFolder, 'cadre-bot');
		const proposal = surfaceGraphProposalResource(workspaceFolder, 'cadre-bot');
		const draft = surfaceGraphProposalDraftResource(workspaceFolder, 'cadre-bot');
		const appIndex = joinPath(workspaceFolder, 'apps', 'cadre-bot', 'package.json');
		fileService.setFile(plan, '# plan');
		fileService.setFile(proposal, '{}');
		fileService.setFile(draft, '{}');
		fileService.setFile(appIndex, '{}');

		const deleted = await deleteGoalWorkspaceSurface(fileService as unknown as IFileService, workspaceFolder, 'cadre-bot');
		assert.strictEqual(deleted, true);
		const raw = JSON.parse(fileService.getFile(manifest));
		assert.deepStrictEqual(raw.surfaces, []);
		assert.strictEqual(fileService.hasFile(plan), false);
		assert.strictEqual(fileService.hasFile(proposal), false);
		assert.strictEqual(fileService.hasFile(draft), false);
		assert.strictEqual(fileService.hasFile(appIndex), false);
	});

	test('rejects invalid workspace-relative paths without writing manifest', async () => {
		const fileService = new TestSurfaceSetupFileService();
		const original = JSON.stringify({
			goal: { id: 'goal', name: 'Goal' },
			surfaces: [],
			shared: {},
		});
		fileService.setFile(manifest, original);

		const imported = await upsertImportedGoalWorkspaceSurface(fileService as unknown as IFileService, workspaceFolder, {
			surfaceId: 'external',
			surfaceName: 'External',
			relativePath: '/Users/me/external',
		});

		assert.strictEqual(imported, false);
		assert.strictEqual(fileService.getFile(manifest), original);

		const traversal = await upsertImportedGoalWorkspaceSurface(fileService as unknown as IFileService, workspaceFolder, {
			surfaceId: 'traversal',
			surfaceName: 'Traversal',
			relativePath: '../external',
		});

		assert.strictEqual(traversal, false);
		assert.strictEqual(fileService.getFile(manifest), original);
	});
});

class TestSurfaceSetupFileService {
	declare readonly _serviceBrand: undefined;
	private readonly files = new Map<string, string>();

	setFile(uri: URI, content: string): void {
		this.files.set(uri.toString(), content);
	}

	getFile(uri: URI): string {
		const value = this.files.get(uri.toString());
		assert.notStrictEqual(value, undefined);
		return value!;
	}

	hasFile(uri: URI): boolean {
		return this.files.has(uri.toString());
	}

	async readFile(resource: URI): Promise<IFileContent> {
		const value = this.files.get(resource.toString());
		if (value === undefined) {
			throw new Error(`Missing file ${resource.toString()}`);
		}
		return { value: VSBuffer.fromString(value) } as IFileContent;
	}

	async writeFile(resource: URI, buffer: VSBuffer): Promise<void> {
		this.files.set(resource.toString(), buffer.toString());
	}

	async del(resource: URI, options?: { recursive?: boolean }): Promise<void> {
		const key = resource.toString();
		if (this.files.has(key)) {
			this.files.delete(key);
			return;
		}
		if (options?.recursive) {
			const prefix = key.endsWith('/') ? key : `${key}/`;
			for (const candidate of [...this.files.keys()]) {
				if (candidate === key || candidate.startsWith(prefix)) {
					this.files.delete(candidate);
				}
			}
			return;
		}
		throw new Error(`Missing file ${key}`);
	}
}

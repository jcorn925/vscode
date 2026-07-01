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
import { GOAL_WORKSPACE_MANIFEST } from '../../../../../../custom/goalWorkspace/GoalConsoleService.js';
import { blueprintResource, instantiateBlueprintFromTemplate, readBlueprint, writeBlueprint } from '../../../../../../custom/goalWorkspace/surfaceBlueprintService.js';
import { listSurfaceTemplateIds, loadSurfaceTemplate } from '../../../../../../custom/goalWorkspace/surfaceBlueprintTemplateRegistry.js';
import { blueprintSubsystemMatchesIx, matchSurfaceToIxSubsystems } from '../../../../../../custom/goalWorkspace/surfaceIxMatch.js';
import { verifySurfaceBlueprint } from '../../../../../../custom/goalWorkspace/surfaceBlueprintVerify.js';

suite('surfaceBlueprintVerify', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const workspaceFolder = URI.file('/workspace');

	test('loads every starter template id', () => {
		for (const templateId of listSurfaceTemplateIds()) {
			assert.ok(loadSurfaceTemplate(templateId), `missing template ${templateId}`);
		}
	});

	test('reports missing blueprint', async () => {
		const fileService = new TestBlueprintFileService();
		const result = await verifySurfaceBlueprint({
			fileService: fileService as unknown as IFileService,
			workspaceFolder,
			surfaceId: 'booking',
		});
		assert.strictEqual(result.passed, false);
		assert.ok(result.gaps.some(gap => gap.kind === 'missing_blueprint'));
	});

	test('reports missing subsystem paths', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST), createManifest('booking', 'Booking', {
			capabilities: [...blueprint.manifest.capabilities],
			events: [...blueprint.manifest.events],
			entities: [...blueprint.manifest.entities],
			ixSubsystems: [...blueprint.manifest.ixSubsystems],
		}));
		fileService.setFile(joinPath(workspaceFolder, 'apps/booking/package.json'), '{}');
		fileService.setFile(joinPath(workspaceFolder, 'apps/booking/next.config.ts'), 'export default {}');

		const result = await verifySurfaceBlueprint({
			fileService: fileService as unknown as IFileService,
			workspaceFolder,
			surfaceId: 'booking',
		});
		assert.strictEqual(result.passed, false);
		assert.ok(result.gaps.some(gap => gap.kind === 'missing_path'));
	});

	test('passes when blueprint paths and manifest exist', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST), createManifest('booking', 'Booking', {
			capabilities: [...blueprint.manifest.capabilities],
			events: [...blueprint.manifest.events],
			entities: [...blueprint.manifest.entities],
			ixSubsystems: [...blueprint.manifest.ixSubsystems],
		}));
		fileService.setFile(joinPath(workspaceFolder, 'apps/booking/package.json'), '{}');
		fileService.setFile(joinPath(workspaceFolder, 'apps/booking/next.config.ts'), 'export default {}');
		for (const subsystem of blueprint.subsystems) {
			for (const path of subsystem.paths) {
				fileService.setFile(joinPath(workspaceFolder, ...path.split('/')), '// file');
			}
		}

		const result = await verifySurfaceBlueprint({
			fileService: fileService as unknown as IFileService,
			workspaceFolder,
			surfaceId: 'booking',
		});
		assert.strictEqual(result.passed, true, JSON.stringify(result.gaps));
	});

	test('persists verified status when persistStatus is true', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST), createManifest('booking', 'Booking', {
			capabilities: [...blueprint.manifest.capabilities],
			events: [...blueprint.manifest.events],
			entities: [...blueprint.manifest.entities],
			ixSubsystems: [...blueprint.manifest.ixSubsystems],
		}));
		fileService.setFile(joinPath(workspaceFolder, 'apps/booking/package.json'), '{}');
		fileService.setFile(joinPath(workspaceFolder, 'apps/booking/next.config.ts'), 'export default {}');
		for (const subsystem of blueprint.subsystems) {
			for (const path of subsystem.paths) {
				fileService.setFile(joinPath(workspaceFolder, ...path.split('/')), '// file');
			}
		}

		const result = await verifySurfaceBlueprint({
			fileService: fileService as unknown as IFileService,
			workspaceFolder,
			surfaceId: 'booking',
			persistStatus: true,
		});
		assert.strictEqual(result.passed, true);

		const persisted = await readBlueprint(fileService as unknown as IFileService, blueprintResource(workspaceFolder, 'booking'));
		assert.strictEqual(persisted?.status, 'verified');
		assert.ok(persisted?.verifiedAt);
	});

	test('matchSurfaceToIxSubsystems uses declared metadata', () => {
		const match = matchSurfaceToIxSubsystems({
			id: 'booking',
			name: 'Booking',
			capabilities: [],
			events: [],
			entities: [],
			ixSubsystems: ['Package Selection UI'],
		}, [{
			regionId: 'ix-package-selection',
			name: 'Package Selection UI',
			entryPath: 'apps/booking/app/packages/page.tsx',
		}]);
		assert.deepStrictEqual(match.subsystemLabels, ['Package Selection UI']);
	});

	test('blueprintSubsystemMatchesIx matches label tokens', () => {
		const subsystem = loadSurfaceTemplate('booking')!.requiredSubsystems[0];
		assert.strictEqual(blueprintSubsystemMatchesIx(subsystem, [{
			regionId: 'ix-packages',
			name: 'Package Selection UI',
			entryPath: 'apps/booking/app/packages/page.tsx',
		}]), true);
	});
});

class TestBlueprintFileService {
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
			throw new Error('File not found');
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

	async resolve(resource: URI): Promise<IFileStat> {
		const content = this.files.get(resource.toString());
		return {
			resource,
			name: resource.path.split('/').pop() ?? 'file',
			isDirectory: false,
			isFile: true,
			isSymbolicLink: false,
			readonly: false,
			locked: false,
			children: content !== undefined ? [] : undefined,
			mtime: 0,
			ctime: 0,
			size: content?.length ?? 0,
			etag: 'test',
		};
	}

	async createFolder(): Promise<IFileStat> {
		return {
			resource: URI.file('/'),
			name: '',
			isDirectory: true,
			isFile: false,
			isSymbolicLink: false,
			readonly: false,
			locked: false,
			children: [],
			mtime: 0,
			ctime: 0,
			size: 0,
			etag: 'test',
		};
	}

	async writeFile(resource: URI, content: VSBuffer): Promise<IFileStat> {
		this.setFile(resource, content.toString());
		return this.resolve(resource);
	}
}

function createManifest(surfaceId: string, surfaceName: string, extraSurfaceFields: Record<string, unknown> = {}): string {
	return JSON.stringify({
		goal: {
			id: 'personal-training-business',
			name: 'Online Personal Training Business',
		},
		surfaces: [{
			id: surfaceId,
			name: surfaceName,
			type: 'web-app',
			path: `apps/${surfaceId}`,
			localUrl: 'http://localhost:3001',
			devCommand: `npm run dev --workspace apps/${surfaceId}`,
			purpose: 'Support the goal workspace',
			...extraSurfaceFields,
		}],
	});
}

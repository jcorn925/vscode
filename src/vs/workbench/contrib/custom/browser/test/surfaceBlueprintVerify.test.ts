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
import { WORKSPACE_MANIFEST } from '../../../../../../custom/goalWorkspace/ConsoleService.js';
import { blueprintResource, instantiateBlueprintFromTemplate, readBlueprint, writeBlueprint } from '../../../../../../custom/goalWorkspace/surfaceBlueprintService.js';
import { scaffoldSurfaceFromBlueprint } from '../../../../../../custom/goalWorkspace/surfaceBlueprintScaffold.js';
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
		fileService.setFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST), createManifest('booking', 'Booking', {
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

	test('fails when blueprint paths exist but implementation is only placeholders', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST), createManifest('booking', 'Booking', {
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
		assert.strictEqual(result.passed, false);
		assert.ok(result.gaps.some(gap => gap.kind === 'thin_implementation'));
		assert.ok(result.gaps.some(gap => gap.kind === 'missing_workflow_signal' || gap.kind === 'missing_business_terms'));
	});

	test('persists verified status when persistStatus is true', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST), createManifest('booking', 'Booking', {
			capabilities: [...blueprint.manifest.capabilities],
			events: [...blueprint.manifest.events],
			entities: [...blueprint.manifest.entities],
			ixSubsystems: [...blueprint.manifest.ixSubsystems],
		}));
		await scaffoldSurfaceFromBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);

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

	for (const [templateId, surfaceName] of [
		['marketing', 'Marketing Site'],
		['booking', 'Booking'],
		['client-portal', 'Client Portal'],
		['trainer-admin', 'Trainer Admin'],
	] as const) {
		test(`scaffolds product-useful ${surfaceName}`, async () => {
			const fileService = new TestBlueprintFileService();
			const template = loadSurfaceTemplate(templateId)!;
			const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: templateId, surfaceName });
			await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
			fileService.setFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST), JSON.stringify({
				goal: {
					id: 'personal-training-business',
					name: 'Online Personal Training Business',
				},
				surfaces: [],
			}));

			await scaffoldSurfaceFromBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);

			const result = await verifySurfaceBlueprint({
				fileService: fileService as unknown as IFileService,
				workspaceFolder,
				surfaceId: templateId,
			});
			assert.strictEqual(result.passed, true, JSON.stringify(result.gaps));
		});
	}

	test('scaffolds a runnable baseline from a persisted blueprint', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST), JSON.stringify({
			goal: {
				id: 'personal-training-business',
				name: 'Online Personal Training Business',
			},
			surfaces: [],
		}));

		const scaffold = await scaffoldSurfaceFromBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		assert.strictEqual(scaffold.appPath, 'apps/booking');
		assert.ok(scaffold.createdFiles.includes('apps/booking/package.json'));
		assert.ok(scaffold.createdFiles.includes('apps/booking/app/packages/page.tsx'));
		const manifest = JSON.parse((await fileService.readFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST))).value.toString());
		assert.strictEqual(manifest.surfaces[0].devCommand, 'npm --prefix apps/booking run dev');

		const result = await verifySurfaceBlueprint({
			fileService: fileService as unknown as IFileService,
			workspaceFolder,
			surfaceId: 'booking',
			persistStatus: true,
		});
		assert.strictEqual(result.passed, true, JSON.stringify(result.gaps));
		const persisted = await readBlueprint(fileService as unknown as IFileService, blueprintResource(workspaceFolder, 'booking'));
		assert.strictEqual(persisted?.status, 'verified');
	});

	test('scaffold repairs legacy root-shaped manifest before verification', async () => {
		const fileService = new TestBlueprintFileService();
		const template = loadSurfaceTemplate('booking')!;
		const blueprint = instantiateBlueprintFromTemplate(template, { surfaceId: 'booking', surfaceName: 'Booking' });
		await writeBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);
		fileService.setFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST), JSON.stringify({
			id: 'personal-training-business',
			name: 'Online Personal Training Business',
			description: 'Acquire clients and run coaching operations across workspace surfaces.',
			northStarMetric: 'active_paid_clients',
			branding: {
				primaryColor: '#0EA5E9',
				secondaryColor: '#22C55E',
				accentColor: '#F97316',
				logoLight: '/brand/logo-light.svg',
			},
			surfaces: [],
		}));

		await scaffoldSurfaceFromBlueprint(fileService as unknown as IFileService, workspaceFolder, blueprint);

		const manifest = JSON.parse((await fileService.readFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST))).value.toString());
		assert.strictEqual(manifest.goal.id, 'personal-training-business');
		assert.strictEqual(manifest.goal.northStarMetric, 'active_paid_clients');
		assert.strictEqual(manifest.id, undefined);
		assert.strictEqual(manifest.brand.primaryColor, '#0EA5E9');
		assert.strictEqual(manifest.surfaces[0].id, 'booking');

		const result = await verifySurfaceBlueprint({
			fileService: fileService as unknown as IFileService,
			workspaceFolder,
			surfaceId: 'booking',
		});
		assert.strictEqual(result.passed, true, JSON.stringify(result.gaps));
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
	private readonly dirs = new Set<string>();

	setFile(resource: URI, content: string): void {
		this.addParentDirs(resource);
		this.files.set(resource.toString(), content);
	}

	async exists(resource: URI): Promise<boolean> {
		return this.files.has(resource.toString()) || this.dirs.has(resource.toString());
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
		if (this.dirs.has(resource.toString())) {
			const prefix = resource.toString().replace(/\/$/, '') + '/';
			const children = [...this.files.keys(), ...this.dirs.keys()]
				.filter(key => key.startsWith(prefix) && key !== resource.toString())
				.map(key => URI.parse(key));
			return {
				resource,
				name: resource.path.split('/').pop() ?? 'folder',
				isDirectory: true,
				isFile: false,
				isSymbolicLink: false,
				readonly: false,
				locked: false,
				children: children.map(child => ({
					resource: child,
					name: child.path.split('/').pop() ?? 'child',
					isDirectory: this.dirs.has(child.toString()),
					isFile: this.files.has(child.toString()),
					isSymbolicLink: false,
					readonly: false,
					locked: false,
					children: undefined,
					mtime: 0,
					ctime: 0,
					size: 0,
					etag: 'test',
				})),
				mtime: 0,
				ctime: 0,
				size: 0,
				etag: 'test',
			};
		}
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

	async createFolder(resource: URI): Promise<IFileStat> {
		this.addParentDirs(resource);
		this.dirs.add(resource.toString());
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
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

	private addParentDirs(resource: URI): void {
		const parts = resource.path.split('/').filter(Boolean);
		let current = '';
		for (let i = 0; i < parts.length - 1; i++) {
			current += `/${parts[i]}`;
			this.dirs.add(resource.with({ path: current }).toString());
		}
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

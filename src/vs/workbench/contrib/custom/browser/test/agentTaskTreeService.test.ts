/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileContent, IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import type { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import type { AgentTaskExecutor, AgentTaskTree } from '../../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import {
	AgentTaskBlockedError,
	AgentTaskTreeService,
	findNextPendingLeaf,
	findRegenerableNodes,
	findRetryableLeaf,
	parseTaskTree,
	taskTreeResource,
} from '../../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import type { IIxIntegrationService } from '../../../../../../custom/ix/IxIntegrationService.js';

suite('agentTaskTreeService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('schema validation rejects malformed trees', () => {
		assert.strictEqual(parseTaskTree({ version: 1, roots: [] }), undefined);
		assert.strictEqual(parseTaskTree({ version: 2, id: 'x' }), undefined);
	});

	test('generates and persists a task tree immediately', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);

		try {
			const tree = await service.generateTaskTree('Build a durable task-tree loop');

			assert.strictEqual(tree.status, 'active');
			assert.ok(tree.roots.length > 0);
			assert.ok(await fileService.exists(taskTreeResource(workspaceFolder, tree.id)));
		} finally {
			service.dispose();
		}
	});

	test('next-leaf selection respects order and skips completed leaves', () => {
		const tree = createTree();
		tree.roots[0].children![0].status = 'complete';

		assert.strictEqual(findNextPendingLeaf(tree)?.id, 'leaf-2');
	});

	test('continueNextTask persists in_progress before executor and complete after success', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const tree = createTree();
		await fileService.writeTree(tree);
		const statusesSeen: string[] = [];
		service.setExecutorForTesting({
			executeTask: async (_tree, task) => {
				const persisted = await service.loadTaskTree(tree.id);
				statusesSeen.push(persisted?.cursor?.currentNodeId ?? '');
				statusesSeen.push(findNodeStatus(persisted!, task.id));
				return {
					changedFiles: ['src/example.ts'],
					commandsRun: ['npm test'],
					verification: 'passed',
					notes: 'implemented',
				};
			},
		});

		try {
			const result = await service.continueNextTask(tree.id);

			assert.strictEqual(result.status, 'completed');
			assert.deepStrictEqual(statusesSeen, ['leaf-1', 'in_progress']);
			const persisted = await service.loadTaskTree(tree.id);
			const node = findNode(persisted!, 'leaf-1');
			assert.strictEqual(node?.status, 'complete');
			assert.deepStrictEqual(node?.implementation?.changedFiles, ['src/example.ts']);
			assert.strictEqual(persisted?.cursor?.lastCompletedNodeId, 'leaf-1');
		} finally {
			service.dispose();
		}
	});

	test('blocked task preserves completed siblings', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const tree = createTree();
		tree.roots[0].children![0].status = 'complete';
		await fileService.writeTree(tree);
		service.setExecutorForTesting(blockingExecutor('missing decision'));

		try {
			const result = await service.continueNextTask(tree.id);

			assert.strictEqual(result.status, 'blocked');
			const persisted = await service.loadTaskTree(tree.id);
			assert.strictEqual(findNode(persisted!, 'leaf-1')?.status, 'complete');
			assert.strictEqual(findNode(persisted!, 'leaf-2')?.status, 'blocked');
			assert.strictEqual(persisted?.roots[0].status, 'blocked');
		} finally {
			service.dispose();
		}
	});

	test('generated trees include workstream roots and ordered leaf tasks', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);

		try {
			const tree = await service.generateTaskTree('Build a persistent task-tree agent loop');
			assert.ok(tree.roots.length >= 5);
			assert.ok(tree.roots.some(root => root.title === 'Agent Loop'));
			const leaves = tree.roots.flatMap(root => root.children ?? []);
			assert.ok(leaves.every(leaf => leaf.type === 'leaf'));
			assert.ok(leaves.every((leaf, index, all) => index === 0 || leaf.order > all[index - 1].order));
		} finally {
			service.dispose();
		}
	});

	test('findRetryableLeaf prefers cursor and falls back to failed leaf', () => {
		const tree = createTree();
		tree.cursor = { currentNodeId: 'leaf-2' };
		tree.roots[0].children![1].status = 'failed';

		assert.strictEqual(findRetryableLeaf(tree)?.id, 'leaf-2');

		tree.cursor = {};
		assert.strictEqual(findRetryableLeaf(tree)?.id, 'leaf-2');
	});

	test('findRegenerableNodes returns roots with children', () => {
		const tree = createTree();
		const nodes = findRegenerableNodes(tree);
		assert.strictEqual(nodes.length, 1);
		assert.strictEqual(nodes[0].id, 'root-1');
	});

	test('parses optional surface metadata and remains backward compatible', () => {
		const withSurface = parseTaskTree({
			version: 1,
			id: 'tree-surface',
			prompt: 'Build surface',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
			status: 'active',
			surfaceId: 'marketing',
			surfaceName: 'Marketing Site',
			templateId: 'marketing',
			roots: [{
				id: 'root-1',
				title: 'Root',
				type: 'root',
				status: 'pending',
				order: 1,
				children: [{
					id: 'leaf-1',
					parentId: 'root-1',
					title: 'First',
					type: 'leaf',
					status: 'pending',
					order: 1,
				}],
			}],
		});
		assert.strictEqual(withSurface?.surfaceId, 'marketing');
		assert.strictEqual(withSurface?.surfaceName, 'Marketing Site');
		assert.strictEqual(withSurface?.templateId, 'marketing');

		const legacy = parseTaskTree({
			version: 1,
			id: 'tree-legacy',
			prompt: 'Legacy',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			status: 'active',
			roots: [{
				id: 'root-1',
				title: 'Root',
				type: 'root',
				status: 'pending',
				order: 1,
				children: [{
					id: 'leaf-1',
					parentId: 'root-1',
					title: 'First',
					type: 'leaf',
					status: 'pending',
					order: 1,
				}],
			}],
		});
		assert.strictEqual(legacy?.surfaceId, undefined);
	});

	test('generateTaskTree persists optional surface metadata', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		try {
			const tree = await service.generateTaskTree('Build marketing surface', {
				surfaceId: 'marketing',
				surfaceName: 'Marketing Site',
				templateId: 'marketing',
			});
			assert.strictEqual(tree.surfaceId, 'marketing');
			assert.deepStrictEqual(tree.roots.map(root => root.title), [
				'Surface Scaffold',
				'Routes and UI',
				'APIs and Shared',
				'Acceptance and Verification',
			]);
			const campaignLeaf = tree.roots
				.flatMap(root => root.children ?? [])
				.find(node => node.subsystemId === 'hero' || node.title.includes('Marketing Hero'));
			assert.ok(campaignLeaf);
			assert.ok((campaignLeaf!.expectedPaths?.length ?? 0) > 0);
			const persisted = await service.loadTaskTree(tree.id);
			assert.strictEqual(persisted?.surfaceName, 'Marketing Site');
			assert.strictEqual(persisted?.templateId, 'marketing');
			assert.ok((persisted?.roots.flatMap(root => root.children ?? []).find(node => node.id === campaignLeaf!.id)?.expectedPaths?.length ?? 0) > 0);
		} finally {
			service.dispose();
		}
	});

	test('generateSurfaceCoreBuildPlanTree uses template when blueprint is absent', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		try {
			const tree = await service.generateSurfaceCoreBuildPlanTree('Core implementation build plan for Ads Manager', {
				surfaceId: 'ads-manager',
				surfaceName: 'Ads Manager',
				templateId: 'ads-manager',
			});
			assert.strictEqual(tree.templateId, 'ads-manager');
			assert.ok(tree.roots.some(root => root.title === 'Routes and UI'));
			assert.ok(tree.roots.some(root => root.title === 'Acceptance and Verification'));
			assert.ok(!tree.roots.some(root => root.title === 'Feature Planning'));
			assert.ok(!tree.roots.some(root => root.title === 'Agent Loop'));
		} finally {
			service.dispose();
		}
	});

	test('default executor scaffolds a surface task tree leaf from template', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		try {
			const tree = await service.generateSurfaceCoreBuildPlanTree('Core implementation build plan for Content Scheduler', {
				surfaceId: 'content-scheduler',
				surfaceName: 'Content Scheduler',
				templateId: 'content-scheduler',
			});

			const result = await service.continueNextTask(tree.id);

			assert.strictEqual(result.status, 'completed');
			assert.strictEqual(result.task?.title, 'Scaffold app shell');
			assert.ok(await fileService.exists(joinPath(workspaceFolder, 'apps/content-scheduler/package.json')));
			assert.ok(await fileService.exists(joinPath(workspaceFolder, 'apps/content-scheduler/app/layout.tsx')));
			assert.ok(await fileService.exists(joinPath(workspaceFolder, 'workspace.goal.json')));
			assert.ok(await fileService.exists(joinPath(workspaceFolder, '.agent/surfaces/content-scheduler.blueprint.json')));
			assert.ok(result.task?.implementation?.changedFiles?.some(path => path === 'apps/content-scheduler/package.json'));
			assert.ok(result.task?.implementation?.verification?.includes('apps/content-scheduler/package.json'));
		} finally {
			service.dispose();
		}
	});

	test('loadLatestTaskTreeForSurface returns newest matching tree and ignores others', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const marketingOld = {
			...createTree(),
			id: 'marketing-old',
			surfaceId: 'marketing',
			status: 'complete' as const,
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		const marketingNew = {
			...createTree(),
			id: 'marketing-new',
			surfaceId: 'marketing',
			status: 'active' as const,
			updatedAt: '2026-01-03T00:00:00.000Z',
		};
		const bookingTree = {
			...createTree(),
			id: 'booking-tree',
			surfaceId: 'booking',
			status: 'active' as const,
			updatedAt: '2026-01-04T00:00:00.000Z',
		};
		const globalTree = {
			...createTree(),
			id: 'global-tree',
			status: 'active' as const,
			updatedAt: '2026-01-05T00:00:00.000Z',
		};
		await fileService.writeTree(marketingOld);
		await fileService.writeTree(marketingNew);
		await fileService.writeTree(bookingTree);
		await fileService.writeTree(globalTree);

		try {
			const latestMarketing = await service.loadLatestTaskTreeForSurface('marketing');
			assert.strictEqual(latestMarketing?.id, 'marketing-new');
			const latestBooking = await service.loadLatestTaskTreeForSurface('booking');
			assert.strictEqual(latestBooking?.id, 'booking-tree');
			const missing = await service.loadLatestTaskTreeForSurface('analytics');
			assert.strictEqual(missing, undefined);
		} finally {
			service.dispose();
		}
	});

	test('retry and skip update only the target leaf', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const tree = createTree();
		tree.roots[0].children![0].status = 'complete';
		tree.roots[0].children![1].status = 'failed';
		await fileService.writeTree(tree);

		try {
			await service.retryTask(tree.id, 'leaf-2');
			let persisted = await service.loadTaskTree(tree.id);
			assert.strictEqual(findNode(persisted!, 'leaf-1')?.status, 'complete');
			assert.strictEqual(findNode(persisted!, 'leaf-2')?.status, 'pending');

			await service.skipTask(tree.id, 'leaf-2', 'not needed');
			persisted = await service.loadTaskTree(tree.id);
			assert.strictEqual(findNode(persisted!, 'leaf-2')?.status, 'skipped');
			assert.strictEqual(findNode(persisted!, 'leaf-2')?.implementation?.notes, 'not needed');
			assert.strictEqual(persisted?.roots[0].status, 'complete');
		} finally {
			service.dispose();
		}
	});

	test('surface Ix validation passes when discovered subsystem matches blueprint shape', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const tree = createSurfaceTree();
		await fileService.writeTree(tree);
		await writeSurfaceValidationFixture(fileService, [
			'apps/marketing/app/page.tsx',
			'apps/marketing/app/offers/page.tsx',
		]);

		try {
			const validation = await service.validateSurfaceTaskTreeShape('marketing', {
				command: 'ix subsystems --list --detailed --sort importance --format json',
				ixSubsystems: [{
					regionId: 'ix-marketing-home',
					name: 'Marketing Home Route',
					entryPath: 'apps/marketing/app/page.tsx',
					memberFiles: ['apps/marketing/app/page.tsx'],
					fileCount: 1,
				}, {
					regionId: 'ix-marketing-offers',
					name: 'Marketing Offers Route',
					entryPath: 'apps/marketing/app/offers/page.tsx',
					memberFiles: ['apps/marketing/app/offers/page.tsx'],
					fileCount: 1,
				}],
			});

			assert.strictEqual(validation.status, 'passed');
			assert.strictEqual(validation.gaps.length, 0);
			const persisted = await service.loadTaskTree(tree.id);
			assert.strictEqual(persisted?.ixValidation?.status, 'passed');
			assert.strictEqual(persisted?.roots.some(root => root.title === 'Ix Validation Repair'), false);
		} finally {
			service.dispose();
		}
	});

	test('surface Ix validation appends repair leaves for generated shape gaps', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const tree = createSurfaceTree();
		tree.roots[0].children![0].status = 'complete';
		await fileService.writeTree(tree);
		await writeSurfaceValidationFixture(fileService, [
			'apps/marketing/app/page.tsx',
			'apps/marketing/app/offers/page.tsx',
		]);

		try {
			const validation = await service.validateSurfaceTaskTreeShape('marketing', {
				command: 'ix subsystems --list --detailed --sort importance --format json',
				ixSubsystems: [{
					regionId: 'ix-marketing-home',
					name: 'Marketing Home Route',
					entryPath: 'apps/marketing/app/page.tsx',
					memberFiles: ['apps/marketing/app/page.tsx'],
					fileCount: 1,
				}],
			});

			assert.strictEqual(validation.status, 'gaps');
			assert.ok(validation.gaps.some(gap => gap.kind === 'missing_region' && gap.expectedLabel === 'Marketing Offers Route'));
			const persisted = await service.loadTaskTree(tree.id);
			assert.strictEqual(findNode(persisted!, 'leaf-1')?.status, 'complete');
			const repairRoot = persisted?.roots.find(root => root.title === 'Ix Validation Repair');
			assert.ok(repairRoot);
			assert.ok(repairRoot.children?.some(child => child.status === 'pending' && /Marketing Offers Route/.test(child.title)));
			assert.strictEqual(persisted?.status, 'active');

			await service.validateSurfaceTaskTreeShape('marketing', {
				command: 'ix subsystems --list --detailed --sort importance --format json',
				ixSubsystems: [],
			});
			const rerun = await service.loadTaskTree(tree.id);
			assert.strictEqual(rerun?.roots.filter(root => root.title === 'Ix Validation Repair').length, 1);
		} finally {
			service.dispose();
		}
	});

	test('surface Ix validation maps surface path before discovering subsystems when Ix service is supplied', async () => {
		const fileService = new TestFileService();
		const service = new AgentTaskTreeService(fileService as unknown as IFileService, workspaceService() as unknown as IWorkspaceContextService);
		const tree = createSurfaceTree();
		await fileService.writeTree(tree);
		await writeSurfaceValidationFixture(fileService, [
			'apps/marketing/app/page.tsx',
			'apps/marketing/app/offers/page.tsx',
		]);
		const calls: string[] = [];
		const ix = {
			mapPath: async (_cwd: URI, relativePath: string) => {
				calls.push(`map:${relativePath}`);
				return { ok: true, raw: '', command: `ix map --all-items ${relativePath}` };
			},
			ensureIxMappedIfEmpty: async () => ({ statsPreview: '', ranMap: false, statsOk: true }),
			runJsonQuery: async (args: readonly string[]) => {
				calls.push(args.join(' '));
				return {
					ok: true,
					raw: '{}',
					value: {
						subsystems: [{
							id: 'ix-marketing-home',
							label: 'Marketing Home Route',
							path: 'apps/marketing/app/page.tsx',
							files: ['apps/marketing/app/page.tsx'],
							fileCount: 1,
						}, {
							id: 'ix-marketing-offers',
							label: 'Marketing Offers Route',
							path: 'apps/marketing/app/offers/page.tsx',
							files: ['apps/marketing/app/offers/page.tsx'],
							fileCount: 1,
						}],
					},
				};
			},
		} as unknown as IIxIntegrationService;

		try {
			const validation = await service.validateSurfaceTaskTreeShape('marketing', { ixIntegrationService: ix });

			assert.strictEqual(validation.status, 'passed');
			assert.deepStrictEqual(calls, [
				'map:apps/marketing',
				'subsystems --list --detailed --sort importance --format json',
			]);
		} finally {
			service.dispose();
		}
	});
});

const workspaceFolder = URI.file('/workspace');

function workspaceService(): Partial<IWorkspaceContextService> {
	return {
		getWorkspace: () => ({
			id: 'test',
			folders: [{ uri: workspaceFolder, name: 'workspace', index: 0 }],
		}) as never,
	};
}

function createTree(): AgentTaskTree {
	return {
		version: 1,
		id: 'tree-1',
		prompt: 'Build feature',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		status: 'active',
		roots: [{
			id: 'root-1',
			title: 'Root',
			type: 'root',
			status: 'pending',
			order: 1,
			children: [
				{ id: 'leaf-1', parentId: 'root-1', title: 'First', type: 'leaf', status: 'pending', order: 1 },
				{ id: 'leaf-2', parentId: 'root-1', title: 'Second', type: 'leaf', status: 'pending', order: 2 },
			],
		}],
		cursor: {},
	};
}

function createSurfaceTree(): AgentTaskTree {
	return {
		...createTree(),
		id: 'marketing-tree',
		prompt: 'Build marketing surface',
		surfaceId: 'marketing',
		surfaceName: 'Marketing Site',
		templateId: 'marketing',
		roots: [{
			id: 'root-1',
			title: 'Root',
			type: 'root',
			status: 'pending',
			order: 1,
			children: [
				{ id: 'leaf-1', parentId: 'root-1', title: 'Build home route', description: 'Implement apps/marketing/app/page.tsx.', type: 'leaf', status: 'pending', order: 1 },
			],
		}],
	};
}

async function writeSurfaceValidationFixture(fileService: TestFileService, files: readonly string[]): Promise<void> {
	await fileService.writeFile(joinPath(workspaceFolder, 'workspace.goal.json'), VSBuffer.fromString(JSON.stringify({
		goal: { id: 'personal-training-business', name: 'Online Personal Training Business' },
		surfaces: [{
			id: 'marketing',
			name: 'Marketing Site',
			path: 'apps/marketing',
			capabilities: ['Lead generation'],
			events: [],
			entities: [],
			ixSubsystems: [],
		}],
	})));
	await fileService.writeFile(joinPath(workspaceFolder, '.agent/surfaces/marketing.blueprint.json'), VSBuffer.fromString(JSON.stringify({
		version: 1,
		surfaceId: 'marketing',
		surfaceName: 'Marketing Site',
		templateId: 'marketing',
		status: 'scaffolded',
		createdAt: '2026-01-01T00:00:00.000Z',
		subsystems: [
			{ id: 'home-route', label: 'Marketing Home Route', kind: 'route', paths: ['apps/marketing/app/page.tsx'], minFiles: 1 },
			{ id: 'offers-route', label: 'Marketing Offers Route', kind: 'route', paths: ['apps/marketing/app/offers/page.tsx'], minFiles: 1 },
		],
		manifest: {
			capabilities: ['Lead generation'],
			events: [],
			entities: [],
			ixSubsystems: [],
		},
		acceptance: {
			requiredRoutes: ['/'],
			requiredWorkflows: ['marketing'],
			requiredUiSignals: ['marketing'],
			requiredBusinessTerms: ['marketing'],
			minimumFiles: 1,
			minimumTotalLines: 1,
			minimumInteractiveControls: 0,
		},
	})));
	for (const file of files) {
		await fileService.writeFile(joinPath(workspaceFolder, file), VSBuffer.fromString('// generated'));
	}
}

function blockingExecutor(message: string): AgentTaskExecutor {
	return {
		executeTask: async () => {
			throw new AgentTaskBlockedError(message);
		},
	};
}

function findNode(tree: AgentTaskTree, nodeId: string): AgentTaskTree['roots'][number] | undefined {
	const stack = [...tree.roots];
	while (stack.length) {
		const node = stack.shift()!;
		if (node.id === nodeId) {
			return node;
		}
		stack.push(...(node.children ?? []));
	}
	return undefined;
}

function findNodeStatus(tree: AgentTaskTree, nodeId: string): string {
	return findNode(tree, nodeId)?.status ?? '';
}

class TestFileService {
	private readonly files = new Map<string, string>();
	private readonly dirs = new Set<string>([workspaceFolder.toString()]);

	async writeTree(tree: AgentTaskTree): Promise<void> {
		const resource = taskTreeResource(workspaceFolder, tree.id);
		await this.createFolder(URI.file('/workspace/.agent/task-trees'));
		await this.writeFile(resource, VSBuffer.fromString(`${JSON.stringify(tree, null, '\t')}\n`));
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
		return {
			resource,
			name: resource.path.split('/').pop() ?? 'file',
			isDirectory: false,
			isFile: true,
			isSymbolicLink: false,
			readonly: false,
			locked: false,
			children: [],
			mtime: 0,
			ctime: 0,
			size: this.files.get(resource.toString())?.length ?? 0,
			etag: 'test',
		};
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		this.addParentDirs(resource);
		this.dirs.add(resource.toString());
		return this.resolve(resource);
	}

	async writeFile(resource: URI, content: VSBuffer): Promise<IFileStat> {
		this.addParentDirs(resource);
		this.files.set(resource.toString(), content.toString());
		return this.resolve(resource);
	}

	private addParentDirs(resource: URI): void {
		const parts = resource.path.split('/').filter(Boolean);
		let current = '';
		for (let i = 0; i < parts.length - 1; i++) {
			current += `/${parts[i]}`;
			this.dirs.add(URI.file(current).toString());
		}
	}
}

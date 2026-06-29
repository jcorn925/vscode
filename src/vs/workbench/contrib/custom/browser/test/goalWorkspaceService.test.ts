/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileChangesEvent, FileChangeType, IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { mock, TestContextService } from '../../../../test/common/workbenchTestServices.js';
import {
	createMissingGoalWorkspaceState,
	GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER,
	GOAL_WORKSPACE_MANIFEST,
	GoalWorkspaceService,
	parseGoalWorkspaceManifest,
	parseGoalWorkspaceManifestText,
} from '../../../../../../custom/goalWorkspace/GoalWorkspaceService.js';

suite('GoalWorkspaceService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');
	const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);

	test('parses goal workspace manifest and normalizes surface metadata', () => {
		const state = parseGoalWorkspaceManifestText(JSON.stringify({
			goal: {
				id: 'personal-training-business',
				name: 'Online Personal Training Business',
				description: 'Acquire clients and run coaching operations.',
				northStarMetric: 'active_paid_clients'
			},
			surfaces: [
				{
					id: 'booking',
					name: 'Booking',
					type: 'web-app',
					path: 'apps/booking',
					localUrl: 'http://localhost:3001',
					devCommand: 'npm run dev --workspace apps/booking',
					purpose: 'Let leads book intro calls and training sessions',
					capabilities: ['booking'],
					events: ['booking.started', 'booking.completed'],
					entities: ['Lead', 'Booking'],
					ixSubsystems: ['booking-ui']
				}
			],
			shared: {
				domain: 'packages/domain',
				events: 'packages/events',
				ui: 'packages/ui',
				auth: 'packages/auth',
				workflows: 'workflows'
			}
		}), workspaceFolder, manifestResource);

		assert.strictEqual(state.status, 'loaded');
		assert.deepStrictEqual(state.diagnostics, []);
		assert.ok(state.workspace);
		assert.strictEqual(state.workspace.goal.id, 'personal-training-business');
		assert.strictEqual(state.workspace.goal.northStarMetric, 'active_paid_clients');
		assert.strictEqual(state.workspace.shared.domain, 'packages/domain');
		assert.strictEqual(state.workspace.surfaces.length, 1);
		assert.deepStrictEqual(state.workspace.surfaces[0], {
			id: 'booking',
			name: 'Booking',
			type: 'web-app',
			path: 'apps/booking',
			devCommand: 'npm run dev --workspace apps/booking',
			localUrl: 'http://localhost:3001',
			purpose: 'Let leads book intro calls and training sessions',
			capabilities: ['booking'],
			events: ['booking.started', 'booking.completed'],
			entities: ['Lead', 'Booking'],
			ixSubsystems: ['booking-ui']
		});
	});

	test('returns missing fallback state without diagnostics', () => {
		const state = createMissingGoalWorkspaceState(workspaceFolder, manifestResource);
		assert.strictEqual(state.status, 'missing');
		assert.strictEqual(state.workspaceFolder?.toString(), workspaceFolder.toString());
		assert.strictEqual(state.manifestResource?.toString(), manifestResource.toString());
		assert.strictEqual(state.workspace, undefined);
		assert.deepStrictEqual(state.diagnostics, []);
	});

	test('reports invalid JSON as diagnostics', () => {
		const state = parseGoalWorkspaceManifestText('{ nope', workspaceFolder, manifestResource);
		assert.strictEqual(state.status, 'invalid');
		assert.strictEqual(state.workspace, undefined);
		assert.strictEqual(state.diagnostics.length, 1);
		assert.strictEqual(state.diagnostics[0]!.path, '$');
		assert.match(state.diagnostics[0]!.message, /Invalid JSON/);
	});

	test('reports schema validation diagnostics', () => {
		const state = parseGoalWorkspaceManifest({
			goal: { id: '', name: 42 },
			surfaces: [
				{ id: 'booking', name: 'Booking', capabilities: ['booking', ''] },
				{ id: 'booking', name: 'Duplicate Booking' },
				{ id: 'analytics', events: 'analytics.viewed' }
			],
			shared: []
		}, workspaceFolder, manifestResource);

		assert.strictEqual(state.status, 'invalid');
		assert.strictEqual(state.workspace, undefined);
		assert.deepStrictEqual(state.diagnostics.map(d => d.path), [
			'$.goal.id',
			'$.goal.name',
			'$.surfaces[0].capabilities[1]',
			'$.surfaces[1].id',
			'$.surfaces[2].name',
			'$.shared'
		]);
	});

	test('service exposes goal and normalized surfaces', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createManifest('booking', 'Booking'));
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();

		assert.strictEqual(service.getState().status, 'loaded');
		assert.strictEqual(service.getGoal()?.id, 'personal-training-business');
		assert.strictEqual(service.getGoalWorkspace()?.goal.name, 'Online Personal Training Business');
		assert.strictEqual(service.getSurfaces().length, 1);
		assert.strictEqual(service.getSurface('booking')?.localUrl, 'http://localhost:3001');
		assert.strictEqual(service.getSurface('missing'), undefined);
	});

	test('service returns empty registry when manifest is absent', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource);
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();

		assert.strictEqual(service.getState().status, 'missing');
		assert.strictEqual(service.getGoal(), undefined);
		assert.deepStrictEqual(service.getSurfaces(), []);
		assert.strictEqual(service.getSurface('booking'), undefined);
	});

	test('service refreshes surfaces when manifest changes', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createManifest('booking', 'Booking'));
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();
		assert.strictEqual(service.getSurface('booking')?.name, 'Booking');

		const changed = Event.toPromise(service.onDidChangeGoalWorkspace);
		fileService.content = createManifest('analytics', 'Analytics');
		fileService.fireManifestChange(FileChangeType.UPDATED);
		await changed;

		assert.strictEqual(service.getSurface('booking'), undefined);
		assert.strictEqual(service.getSurface('analytics')?.name, 'Analytics');
	});

	test('service discovers global and per-surface agent context files', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createManifest('booking', 'Booking'));
		fileService.setFile(agentContextResource(workspaceFolder, 'workspace.md'), '# Workspace Context\nShared goal context.');
		fileService.setFile(agentContextResource(workspaceFolder, 'domain.md'), 'Domain model and vocabulary.');
		fileService.setFile(agentContextResource(workspaceFolder, 'apps/booking.md'), '# Booking Surface\nLead booking behavior.');
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();

		const context = service.getContext();
		assert.strictEqual(context.root?.toString(), joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER).toString());
		assert.deepStrictEqual(context.globalFiles.map(file => file.relativePath), [
			'.agent/workspace.md',
			'.agent/domain.md'
		]);
		assert.deepStrictEqual(context.globalFiles.map(file => file.summary), [
			'Workspace Context',
			'Domain model and vocabulary.'
		]);
		assert.deepStrictEqual(context.surfaceFiles.map(file => file.relativePath), ['.agent/apps/booking.md']);

		const surfaceContext = service.getSurfaceContext('booking');
		assert.ok(surfaceContext);
		assert.strictEqual(surfaceContext.surfaceName, 'Booking');
		assert.deepStrictEqual(surfaceContext.files.map(file => file.summary), ['Booking Surface']);
		assert.match(surfaceContext.summary, /\.agent\/workspace\.md: Workspace Context/);
		assert.match(surfaceContext.summary, /\.agent\/apps\/booking\.md: Booking Surface/);
	});

	test('service refreshes context when agent context files change', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createManifest('booking', 'Booking'));
		const bookingContextResource = agentContextResource(workspaceFolder, 'apps/booking.md');
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();
		assert.strictEqual(service.getSurfaceContext('booking')?.files.length, 0);

		const changed = Event.toPromise(service.onDidChangeGoalWorkspace);
		fileService.setFile(bookingContextResource, '# Booking Context');
		fileService.fireFileChange(bookingContextResource, FileChangeType.ADDED);
		await changed;

		assert.deepStrictEqual(service.getSurfaceContext('booking')?.files.map(file => file.summary), ['Booking Context']);
	});
});

class TestGoalWorkspaceFileService extends mock<IFileService>() {
	private readonly _onDidFilesChange = new Emitter<FileChangesEvent>();
	override readonly onDidFilesChange = this._onDidFilesChange.event;
	private readonly files = new Map<string, string>();

	constructor(
		private readonly manifestResource: URI,
		content?: string
	) {
		super();
		if (content !== undefined) {
			this.setFile(manifestResource, content);
		}
	}

	get content(): string | undefined {
		return this.files.get(this.manifestResource.toString());
	}

	set content(value: string | undefined) {
		if (value === undefined) {
			this.files.delete(this.manifestResource.toString());
			return;
		}
		this.setFile(this.manifestResource, value);
	}

	setFile(resource: URI, content: string): void {
		this.files.set(resource.toString(), content);
	}

	override async exists(resource: URI): Promise<boolean> {
		return this.files.has(resource.toString());
	}

	override async readFile(resource: URI): Promise<IFileContent> {
		const content = this.files.get(resource.toString());
		if (content === undefined) {
			throw new Error('File not found');
		}

		return {
			resource,
			name: resource.path.split('/').pop() ?? GOAL_WORKSPACE_MANIFEST,
			mtime: 0,
			ctime: 0,
			etag: 'test',
			size: content.length,
			readonly: false,
			locked: false,
			executable: false,
			value: VSBuffer.fromString(content)
		};
	}

	fireManifestChange(type: FileChangeType): void {
		this.fireFileChange(this.manifestResource, type);
	}

	fireFileChange(resource: URI, type: FileChangeType): void {
		this._onDidFilesChange.fire(new FileChangesEvent([{ resource, type }], false));
	}
}

function createManifest(surfaceId: string, surfaceName: string): string {
	return JSON.stringify({
		goal: {
			id: 'personal-training-business',
			name: 'Online Personal Training Business',
			northStarMetric: 'active_paid_clients'
		},
		surfaces: [
			{
				id: surfaceId,
				name: surfaceName,
				type: 'web-app',
				path: `apps/${surfaceId}`,
				localUrl: 'http://localhost:3001',
				devCommand: `npm run dev --workspace apps/${surfaceId}`,
				purpose: 'Support the goal workspace'
			}
		]
	});
}

function agentContextResource(workspaceFolder: URI, relativePath: string): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, ...relativePath.split('/'));
}

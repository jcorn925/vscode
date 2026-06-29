/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { isEqual, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileChangesEvent, FileChangeType, IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { mock, TestContextService } from '../../../../test/common/workbenchTestServices.js';
import {
	createMissingGoalWorkspaceState,
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
});

class TestGoalWorkspaceFileService extends mock<IFileService>() {
	private readonly _onDidFilesChange = new Emitter<FileChangesEvent>();
	override readonly onDidFilesChange = this._onDidFilesChange.event;

	constructor(
		private readonly manifestResource: URI,
		public content?: string
	) {
		super();
	}

	override async exists(resource: URI): Promise<boolean> {
		return this.content !== undefined && isEqual(resource, this.manifestResource);
	}

	override async readFile(resource: URI): Promise<IFileContent> {
		if (this.content === undefined || !isEqual(resource, this.manifestResource)) {
			throw new Error('File not found');
		}

		return {
			resource,
			name: GOAL_WORKSPACE_MANIFEST,
			mtime: 0,
			ctime: 0,
			etag: 'test',
			size: this.content.length,
			readonly: false,
			locked: false,
			executable: false,
			value: VSBuffer.fromString(this.content)
		};
	}

	fireManifestChange(type: FileChangeType): void {
		this._onDidFilesChange.fire(new FileChangesEvent([{ resource: this.manifestResource, type }], false));
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

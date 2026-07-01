/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileContent, IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { CustomAiVerifySurfaceBlueprintTool } from '../../../../../../custom/ai/browser/customAiVerifySurfaceBlueprintTool.js';
import { GOAL_WORKSPACE_MANIFEST, createMissingGoalWorkspaceState, IGoalConsoleService } from '../../../../../../custom/goalWorkspace/GoalConsoleService.js';
import { instantiateBlueprintFromTemplate, writeBlueprint } from '../../../../../../custom/goalWorkspace/surfaceBlueprintService.js';
import { loadSurfaceTemplate } from '../../../../../../custom/goalWorkspace/surfaceBlueprintTemplateRegistry.js';
import { IIxIntegrationService } from '../../../../../../custom/ix/IxIntegrationService.js';

suite('CustomAiVerifySurfaceBlueprintTool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');

	function createGoalConsoleService(): IGoalConsoleService {
		const state = createMissingGoalWorkspaceState(workspaceFolder, joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST));
		return {
			_serviceBrand: undefined,
			onDidChangeGoalWorkspace: () => ({ dispose: () => { } }),
			onDidChangeState: () => ({ dispose: () => { } }),
			getState: () => state,
			getGoal: () => undefined,
			getGoalWorkspace: () => undefined,
			getSurfaces: () => [],
			getSurface: (id: string) => ({ id, name: id, capabilities: [], events: [], entities: [], ixSubsystems: [] }),
			getContext: () => state.context,
			getSurfaceContext: () => undefined,
			getIx: () => state.ix,
			getSurfaceIxOverlay: () => undefined,
			getAffectedSurfacesForIxSubsystem: () => [],
			getCrossAppWorkflow: () => undefined,
			buildCrossAppWorkflowPlan: () => undefined,
			refresh: async () => state,
		};
	}

	function createIxService(): IIxIntegrationService {
		return {
			_serviceBrand: undefined,
			onDidChangeState: () => ({ dispose: () => { } }),
			getState: () => ({
				phase: 'idle',
				lastCommand: undefined,
				lastError: undefined,
				lastOutput: '',
				pipelineGeneration: 0,
				pipelineSteps: [],
			}),
			restart: async () => { },
			installOrResolve: async () => { },
			openDocs: async () => { },
			runJsonQuery: async () => ({ ok: true, value: { regions: [] }, raw: '{}' }),
			prepareForDiscovery: async () => true,
			ensureIxBackendReady: async () => true,
			ensureIxMappedIfEmpty: async () => ({ statsPreview: '', ranMap: false, statsOk: true }),
		} as IIxIntegrationService;
	}

	test('returns error when surfaceId is missing', async () => {
		const tool = new CustomAiVerifySurfaceBlueprintTool(
			new TestBlueprintFileService() as unknown as IFileService,
			new TestContextService(),
			createGoalConsoleService(),
			createIxService(),
		);
		const result = await tool.invoke({
			callId: 'test',
			toolId: 'customAi_verifySurfaceBlueprint',
			parameters: {},
			context: { sessionResource: URI.parse('test://session') },
		}, async () => 0, { report: () => { } }, CancellationToken.None);

		const text = result.content.map(part => part.kind === 'text' ? part.value : '').join('');
		assert.match(text, /surfaceId is required/);
	});

	test('returns gap report for missing blueprint', async () => {
		const fileService = new TestBlueprintFileService();
		const workspaceContextService = new TestContextService();
		workspaceContextService.setWorkspace({ folders: [{ uri: workspaceFolder, name: 'workspace', index: 0 }] });
		const tool = new CustomAiVerifySurfaceBlueprintTool(
			fileService as unknown as IFileService,
			workspaceContextService,
			createGoalConsoleService(),
			createIxService(),
		);
		const result = await tool.invoke({
			callId: 'test',
			toolId: 'customAi_verifySurfaceBlueprint',
			parameters: { surfaceId: 'booking' },
			context: { sessionResource: URI.parse('test://session') },
		}, async () => 0, { report: () => { } }, CancellationToken.None);

		const text = result.content.map(part => part.kind === 'text' ? part.value : '').join('');
		assert.match(text, /FAILED/);
		assert.match(text, /missing_blueprint/);
	});

	test('returns passed report when blueprint and scaffold exist', async () => {
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

		const workspaceContextService = new TestContextService();
		workspaceContextService.setWorkspace({ folders: [{ uri: workspaceFolder, name: 'workspace', index: 0 }] });
		const tool = new CustomAiVerifySurfaceBlueprintTool(
			fileService as unknown as IFileService,
			workspaceContextService,
			createGoalConsoleService(),
			createIxService(),
		);
		const result = await tool.invoke({
			callId: 'test',
			toolId: 'customAi_verifySurfaceBlueprint',
			parameters: { surfaceId: 'booking' },
			context: { sessionResource: URI.parse('test://session') },
		}, async () => 0, { report: () => { } }, CancellationToken.None);

		const text = result.content.map(part => part.kind === 'text' ? part.value : '').join('');
		assert.match(text, /PASSED/);
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

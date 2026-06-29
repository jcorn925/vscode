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
	ADD_TRAINING_PACKAGE_WORKFLOW_ID,
	buildCrossAppWorkflowPlan,
	createMissingGoalWorkspaceState,
	formatCrossAppWorkflowPlanMarkdown,
	getGoalWorkspaceCrossAppWorkflow,
	GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER,
	GOAL_WORKSPACE_IX_OVERLAY_FILE,
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
					ixSubsystems: ['legacy-booking-ui'],
					ix: {
						subsystems: ['Booking UI'],
						subsystemIds: ['ix-booking-ui'],
						tags: ['frontend'],
						notes: 'Maps the booking product surface to Ix frontend regions.'
					}
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
			ixSubsystems: ['legacy-booking-ui', 'Booking UI'],
			ix: {
				subsystemIds: ['ix-booking-ui'],
				subsystemLabels: ['Booking UI'],
				tags: ['frontend'],
				notes: 'Maps the booking product surface to Ix frontend regions.'
			}
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
				{ id: 'booking', name: 'Booking', capabilities: ['booking', ''], ix: { subsystemIds: ['ok'], tags: [42] } },
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
			'$.surfaces[0].ix.tags[0]',
			'$.surfaces[0].capabilities[1]',
			'$.surfaces[1].id',
			'$.surfaces[2].name',
			'$.shared'
		]);
	});

	test('rejects unsafe workspace paths', () => {
		const state = parseGoalWorkspaceManifest({
			goal: { id: 'personal-training-business', name: 'Online Personal Training Business' },
			surfaces: [
				{ id: 'absolute', name: 'Absolute', path: '/tmp/app' },
				{ id: 'traversal', name: 'Traversal', path: '../outside' },
				{ id: 'uri', name: 'Uri', path: 'file:///workspace/apps/uri' },
				{ id: 'windows', name: 'Windows', path: 'C:\\workspace\\apps\\windows' }
			],
			shared: {
				domain: 'packages/domain',
				events: '../events'
			}
		}, workspaceFolder, manifestResource);

		assert.strictEqual(state.status, 'invalid');
		assert.deepStrictEqual(state.diagnostics.map(d => d.path), [
			'$.surfaces[0].path',
			'$.surfaces[1].path',
			'$.surfaces[2].path',
			'$.surfaces[3].path',
			'$.shared.events'
		]);
	});

	test('validates local preview urls', () => {
		const valid = parseGoalWorkspaceManifest({
			goal: { id: 'personal-training-business', name: 'Online Personal Training Business' },
			surfaces: [
				{ id: 'booking', name: 'Booking', localUrl: 'http://localhost:3001' },
				{ id: 'analytics', name: 'Analytics', localUrl: 'https://127.0.0.1:4443/dashboard' }
			]
		}, workspaceFolder, manifestResource);

		assert.strictEqual(valid.status, 'loaded');
		assert.deepStrictEqual(valid.workspace?.surfaces.map(surface => surface.localUrl), [
			'http://localhost:3001',
			'https://127.0.0.1:4443/dashboard'
		]);

		const invalid = parseGoalWorkspaceManifest({
			goal: { id: 'personal-training-business', name: 'Online Personal Training Business' },
			surfaces: [
				{ id: 'external', name: 'External', localUrl: 'https://example.com' },
				{ id: 'ftp', name: 'Ftp', localUrl: 'ftp://localhost/app' },
				{ id: 'bad', name: 'Bad', localUrl: 'not a url' }
			]
		}, workspaceFolder, manifestResource);

		assert.strictEqual(invalid.status, 'invalid');
		assert.deepStrictEqual(invalid.diagnostics.map(d => d.path), [
			'$.surfaces[0].localUrl',
			'$.surfaces[1].localUrl',
			'$.surfaces[2].localUrl'
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

	test('service returns no-workspace state without workspace folders', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createManifest('booking', 'Booking'));
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace()), fileService));

		await service.refresh();

		assert.strictEqual(service.getState().status, 'no-workspace');
		assert.strictEqual(service.getState().workspaceFolder, undefined);
		assert.strictEqual(service.getState().manifestResource, undefined);
		assert.strictEqual(service.getGoal(), undefined);
		assert.deepStrictEqual(service.getSurfaces(), []);
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

	test('service reads Ix surface overlay and resolves affected surfaces', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createManifest('booking', 'Booking', {
			ix: {
				subsystems: ['Declared Booking Subsystem'],
				subsystemIds: ['declared-booking']
			}
		}));
		fileService.setFile(agentContextResource(workspaceFolder, GOAL_WORKSPACE_IX_OVERLAY_FILE), JSON.stringify({
			generatedAt: '2026-06-29T00:00:00.000Z',
			command: 'ix subsystems --list --detailed --sort importance --format json',
			discoveredSubsystems: [
				{ id: 'ix-booking', label: 'Booking UI', kind: 'subsystem', path: 'apps/booking/page.tsx', fileCount: 4 }
			],
			surfaces: [
				{ surfaceId: 'booking', subsystemIds: ['ix-booking'], subsystemLabels: ['Booking UI'], matchReason: 'heuristic name/path match' }
			]
		}));
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();

		assert.strictEqual(service.getIx().overlay?.generatedAt, '2026-06-29T00:00:00.000Z');
		assert.strictEqual(service.getIx().overlay?.discoveredSubsystems[0]?.label, 'Booking UI');
		assert.deepStrictEqual(service.getSurfaceIxOverlay('booking')?.subsystemLabels, ['Booking UI']);
		assert.deepStrictEqual(service.getAffectedSurfacesForIxSubsystem('Booking UI').map(surface => surface.id), ['booking']);
		assert.deepStrictEqual(service.getAffectedSurfacesForIxSubsystem('declared-booking').map(surface => surface.id), ['booking']);
	});

	test('builds add-training-package cross-app workflow plan from surface capabilities', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource, createPersonalTrainingManifest());
		fileService.setFile(agentContextResource(workspaceFolder, 'workspace.md'), '# Workspace Context\nRun an online personal training business.');
		fileService.setFile(agentContextResource(workspaceFolder, 'domain.md'), '# Domain Context\nTrainingPackage, Lead, Booking, SubscriptionPlan, Campaign.');
		fileService.setFile(agentContextResource(workspaceFolder, 'events.md'), '# Event Context\nbooking.started and subscription.started carry packageId.');
		fileService.setFile(agentContextResource(workspaceFolder, 'decisions.md'), '# Decisions\nUse draft status until billing provider IDs exist.');
		fileService.setFile(agentContextResource(workspaceFolder, 'apps/booking.md'), '# Booking Surface\nOwns package selection and intro-call scheduling.');
		fileService.setFile(agentContextResource(workspaceFolder, 'apps/analytics.md'), '# Analytics Surface\nSegments conversion and revenue by packageId.');
		fileService.setFile(agentContextResource(workspaceFolder, GOAL_WORKSPACE_IX_OVERLAY_FILE), JSON.stringify({
			generatedAt: '2026-06-29T00:00:00.000Z',
			command: 'ix subsystems --list --detailed --sort importance --format json',
			discoveredSubsystems: [
				{ id: 'ix-booking', label: 'Booking Package Selection', kind: 'subsystem', path: 'apps/booking', fileCount: 3 }
			],
			surfaces: [
				{ surfaceId: 'booking', subsystemIds: ['ix-booking'], subsystemLabels: ['Booking Package Selection'], matchReason: 'heuristic name/path match' }
			]
		}));
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();
		const plan = service.buildCrossAppWorkflowPlan(ADD_TRAINING_PACKAGE_WORKFLOW_ID);

		assert.ok(plan);
		assert.deepStrictEqual(plan.context.affectedSurfaces.map(surface => surface.surfaceId), [
			'marketing',
			'booking',
			'subscriptions',
			'admin',
			'analytics',
			'content'
		]);
		assert.strictEqual(plan.context.packageDraft.id, 'strength-reset-8-week');
		assert.strictEqual(plan.context.sharedContext.domainFiles[0], 'packages/domain');
		assert.match(plan.context.affectedSurfaces.find(surface => surface.surfaceId === 'booking')?.contextSummary ?? '', /Booking Surface/);
		assert.deepStrictEqual(plan.context.affectedSurfaces.find(surface => surface.surfaceId === 'booking')?.ixSubsystemLabels, ['Booking Package Selection']);
		assert.match(plan.steps.find(step => step.surfaceId === 'marketing')?.details.join('\n') ?? '', /booking\?package=strength-reset-8-week/);
		assert.match(formatCrossAppWorkflowPlanMarkdown(plan), /## Affected Surfaces/);
	});

	test('returns no cross-app plan when goal workspace is missing', async () => {
		const fileService = new TestGoalWorkspaceFileService(manifestResource);
		const service = disposables.add(new GoalWorkspaceService(new TestContextService(testWorkspace(workspaceFolder)), fileService));

		await service.refresh();

		assert.strictEqual(service.buildCrossAppWorkflowPlan(ADD_TRAINING_PACKAGE_WORKFLOW_ID), undefined);
	});

	test('pure plan builder supports package draft overrides', () => {
		const state = parseGoalWorkspaceManifestText(createPersonalTrainingManifest(), workspaceFolder, manifestResource);
		const workflow = getGoalWorkspaceCrossAppWorkflow(ADD_TRAINING_PACKAGE_WORKFLOW_ID);
		assert.ok(workflow);

		const plan = buildCrossAppWorkflowPlan(state, workflow, {
			id: 'mobility-reset-8-week',
			name: '8-Week Mobility Reset',
			priceCents: 39900
		});

		assert.ok(plan);
		assert.strictEqual(plan.context.packageDraft.id, 'mobility-reset-8-week');
		assert.strictEqual(plan.context.packageDraft.name, '8-Week Mobility Reset');
		assert.match(plan.steps.find(step => step.surfaceId === 'content')?.details.join('\n') ?? '', /mobility-reset-8-week/);
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

function createManifest(surfaceId: string, surfaceName: string, extraSurfaceFields: Record<string, unknown> = {}): string {
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
				purpose: 'Support the goal workspace',
				...extraSurfaceFields
			}
		]
	});
}

function createPersonalTrainingManifest(): string {
	return JSON.stringify({
		goal: {
			id: 'personal-training-business',
			name: 'Online Personal Training Business',
			northStarMetric: 'active_paid_clients'
		},
		surfaces: [
			{
				id: 'marketing',
				name: 'Marketing',
				path: 'apps/marketing',
				purpose: 'Convert visitors into leads by presenting offers and calls to action.',
				capabilities: ['display-offers', 'lead-capture']
			},
			{
				id: 'booking',
				name: 'Booking',
				path: 'apps/booking',
				purpose: 'Let leads select a package and schedule intro sessions.',
				capabilities: ['package-selection', 'schedule-session']
			},
			{
				id: 'subscriptions',
				name: 'Subscriptions',
				path: 'apps/subscriptions',
				purpose: 'Manage package billing, renewals, cancellations, and subscription state.',
				capabilities: ['billing-plans', 'subscription-management']
			},
			{
				id: 'admin',
				name: 'Admin',
				path: 'apps/admin',
				purpose: 'Let the trainer manage clients, packages, sessions, and operations.',
				capabilities: ['package-management', 'client-management']
			},
			{
				id: 'analytics',
				name: 'Analytics',
				path: 'apps/analytics',
				purpose: 'Track conversion, revenue, retention, and campaign performance.',
				capabilities: ['package-analytics', 'conversion', 'revenue']
			},
			{
				id: 'content',
				name: 'Content',
				path: 'apps/content',
				purpose: 'Plan and schedule content that promotes offers and campaigns.',
				capabilities: ['campaigns', 'social-posts']
			}
		],
		shared: {
			domain: 'packages/domain',
			events: 'packages/events',
			workflows: 'workflows'
		}
	});
}

function agentContextResource(workspaceFolder: URI, relativePath: string): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, ...relativePath.split('/'));
}

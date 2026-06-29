/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { FileChangeType, IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';

export const GOAL_WORKSPACE_MANIFEST = 'workspace.goal.json';
export const GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER = '.agent';
export const GOAL_WORKSPACE_IX_OVERLAY_FILE = 'ix-surface-map.json';

const GLOBAL_AGENT_CONTEXT_FILES = [
	{ id: 'workspace', relativePath: 'workspace.md' },
	{ id: 'domain', relativePath: 'domain.md' },
	{ id: 'events', relativePath: 'events.md' },
	{ id: 'decisions', relativePath: 'decisions.md' },
] as const;

export interface GoalWorkspaceGoal {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly northStarMetric?: string;
}

export interface GoalWorkspaceSurface {
	readonly id: string;
	readonly name: string;
	readonly type?: string;
	readonly path?: string;
	readonly devCommand?: string;
	readonly localUrl?: string;
	readonly purpose?: string;
	readonly capabilities: readonly string[];
	readonly events: readonly string[];
	readonly entities: readonly string[];
	readonly ixSubsystems: readonly string[];
	readonly ix?: GoalSurfaceIxMetadata;
}

export type GoalSurface = GoalWorkspaceSurface;

export interface GoalSurfaceIxMetadata {
	readonly subsystemIds: readonly string[];
	readonly subsystemLabels: readonly string[];
	readonly tags: readonly string[];
	readonly notes?: string;
}

export interface GoalWorkspaceShared {
	readonly domain?: string;
	readonly events?: string;
	readonly ui?: string;
	readonly auth?: string;
	readonly workflows?: string;
}

export type GoalWorkspaceContextFileKind = 'workspace' | 'domain' | 'events' | 'decisions' | 'surface';

export interface GoalWorkspaceContextFile {
	readonly id: string;
	readonly kind: GoalWorkspaceContextFileKind;
	readonly resource: URI;
	readonly relativePath: string;
	readonly summary: string;
}

export interface GoalSurfaceContextSummary {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly files: readonly GoalWorkspaceContextFile[];
	readonly summary: string;
}

export interface GoalWorkspaceContext {
	readonly root: URI | undefined;
	readonly globalFiles: readonly GoalWorkspaceContextFile[];
	readonly surfaceFiles: readonly GoalWorkspaceContextFile[];
	readonly surfaceSummaries: readonly GoalSurfaceContextSummary[];
}

export interface GoalWorkspaceIxDiscoveredSubsystem {
	readonly id: string;
	readonly label: string;
	readonly kind?: string;
	readonly path?: string;
	readonly fileCount?: number;
}

export interface GoalWorkspaceIxSurfaceOverlay {
	readonly surfaceId: string;
	readonly subsystemIds: readonly string[];
	readonly subsystemLabels: readonly string[];
	readonly matchReason?: string;
}

export interface GoalWorkspaceIxOverlay {
	readonly resource: URI;
	readonly generatedAt: string | undefined;
	readonly command: string | undefined;
	readonly discoveredSubsystems: readonly GoalWorkspaceIxDiscoveredSubsystem[];
	readonly surfaces: readonly GoalWorkspaceIxSurfaceOverlay[];
}

export interface GoalWorkspaceIxState {
	readonly root: URI | undefined;
	readonly overlayResource: URI | undefined;
	readonly overlay: GoalWorkspaceIxOverlay | undefined;
}

export interface GoalWorkspaceCrossAppWorkflow {
	readonly id: string;
	readonly label: string;
	readonly taskKinds: readonly string[];
	readonly requiredFields: readonly string[];
	readonly affectedCapabilities: readonly string[];
	readonly fallbackSurfaceIds: readonly string[];
}

export interface GoalWorkspaceTrainingPackageDraft {
	readonly id: string;
	readonly name: string;
	readonly durationWeeks: number;
	readonly priceCents: number;
	readonly billingModel: 'one_time' | 'monthly';
	readonly status: 'draft' | 'active';
	readonly description: string;
	readonly features: readonly string[];
}

export interface GoalWorkspaceSurfaceImpact {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly path?: string;
	readonly purpose?: string;
	readonly reason: string;
	readonly matchedCapabilities: readonly string[];
	readonly contextSummary?: string;
	readonly ixSubsystemIds: readonly string[];
	readonly ixSubsystemLabels: readonly string[];
}

export interface GoalWorkspaceSharedContextBundle {
	readonly domainFiles: readonly string[];
	readonly eventFiles: readonly string[];
	readonly workflowFiles: readonly string[];
	readonly globalContextFiles: readonly string[];
}

export interface GoalWorkspaceCrossAppContextBundle {
	readonly taskKind: string;
	readonly goalId?: string;
	readonly goalName?: string;
	readonly packageDraft: GoalWorkspaceTrainingPackageDraft;
	readonly affectedSurfaces: readonly GoalWorkspaceSurfaceImpact[];
	readonly sharedContext: GoalWorkspaceSharedContextBundle;
	readonly priorDecisions: readonly string[];
	readonly ixCommand?: string;
}

export interface GoalWorkspaceCrossAppPlanStep {
	readonly surfaceId: string;
	readonly title: string;
	readonly details: readonly string[];
}

export interface GoalWorkspaceCrossAppPlan {
	readonly workflow: GoalWorkspaceCrossAppWorkflow;
	readonly context: GoalWorkspaceCrossAppContextBundle;
	readonly steps: readonly GoalWorkspaceCrossAppPlanStep[];
	readonly unknowns: readonly string[];
	readonly validation: readonly GoalWorkspaceCrossAppPlanStep[];
	readonly memoryUpdates: readonly string[];
}

export interface GoalWorkspace {
	readonly workspaceFolder: URI;
	readonly manifestResource: URI;
	readonly goal: GoalWorkspaceGoal;
	readonly surfaces: readonly GoalWorkspaceSurface[];
	readonly shared: GoalWorkspaceShared;
}

export interface GoalWorkspaceDiagnostic {
	readonly path: string;
	readonly message: string;
}

export type GoalWorkspaceManifestStatus = 'no-workspace' | 'missing' | 'loaded' | 'invalid';

export interface GoalWorkspaceState {
	readonly status: GoalWorkspaceManifestStatus;
	readonly workspaceFolder: URI | undefined;
	readonly manifestResource: URI | undefined;
	readonly workspace: GoalWorkspace | undefined;
	readonly context: GoalWorkspaceContext;
	readonly ix: GoalWorkspaceIxState;
	readonly diagnostics: readonly GoalWorkspaceDiagnostic[];
}

export interface IGoalWorkspaceService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeGoalWorkspace: Event<void>;
	readonly onDidChangeState: Event<GoalWorkspaceState>;

	getState(): GoalWorkspaceState;
	getGoal(): GoalWorkspaceGoal | undefined;
	getGoalWorkspace(): GoalWorkspace | undefined;
	getSurfaces(): readonly GoalSurface[];
	getSurface(id: string): GoalSurface | undefined;
	getContext(): GoalWorkspaceContext;
	getSurfaceContext(surfaceId: string): GoalSurfaceContextSummary | undefined;
	getIx(): GoalWorkspaceIxState;
	getSurfaceIxOverlay(surfaceId: string): GoalWorkspaceIxSurfaceOverlay | undefined;
	getAffectedSurfacesForIxSubsystem(subsystem: string): readonly GoalSurface[];
	getCrossAppWorkflow(id: string): GoalWorkspaceCrossAppWorkflow | undefined;
	buildCrossAppWorkflowPlan(id: string, packageDraft?: Partial<GoalWorkspaceTrainingPackageDraft>): GoalWorkspaceCrossAppPlan | undefined;
	refresh(): Promise<GoalWorkspaceState>;
}

export const IGoalWorkspaceService = createDecorator<IGoalWorkspaceService>('goalWorkspaceService');

const EMPTY_SHARED: GoalWorkspaceShared = {};
const EMPTY_CONTEXT: GoalWorkspaceContext = {
	root: undefined,
	globalFiles: [],
	surfaceFiles: [],
	surfaceSummaries: []
};
const EMPTY_IX: GoalWorkspaceIxState = {
	root: undefined,
	overlayResource: undefined,
	overlay: undefined
};

export const ADD_TRAINING_PACKAGE_WORKFLOW_ID = 'add-training-package';

const ADD_TRAINING_PACKAGE_WORKFLOW: GoalWorkspaceCrossAppWorkflow = {
	id: ADD_TRAINING_PACKAGE_WORKFLOW_ID,
	label: 'Add Training Package',
	taskKinds: ['create-package', 'add-offer', 'add-training-program'],
	requiredFields: ['name', 'durationWeeks', 'priceCents', 'billingModel', 'description', 'features', 'status'],
	affectedCapabilities: ['display-offers', 'package-selection', 'billing-plans', 'package-management', 'package-analytics', 'campaigns'],
	fallbackSurfaceIds: ['marketing', 'booking', 'subscriptions', 'admin', 'analytics', 'content']
};

const CROSS_APP_WORKFLOWS: readonly GoalWorkspaceCrossAppWorkflow[] = [
	ADD_TRAINING_PACKAGE_WORKFLOW
];

export function getGoalWorkspaceCrossAppWorkflow(id: string): GoalWorkspaceCrossAppWorkflow | undefined {
	return CROSS_APP_WORKFLOWS.find(workflow => workflow.id === id);
}

export class GoalWorkspaceService extends Disposable implements IGoalWorkspaceService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeGoalWorkspace = this._register(new Emitter<void>());
	readonly onDidChangeGoalWorkspace = this._onDidChangeGoalWorkspace.event;

	private readonly _onDidChangeState = this._register(new Emitter<GoalWorkspaceState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private state: GoalWorkspaceState = createNoWorkspaceGoalWorkspaceState();

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.refresh()));
		this._register(this.fileService.onDidFilesChange(e => {
			const manifestResource = this.state.manifestResource;
			const agentContextRoot = this.state.workspaceFolder ? joinPath(this.state.workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER) : undefined;
			if (manifestResource && e.contains(manifestResource, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
				void this.refresh();
				return;
			}
			if (agentContextRoot && e.affects(agentContextRoot, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
				void this.refresh();
			}
		}));
		void this.refresh();
	}

	getState(): GoalWorkspaceState {
		return this.state;
	}

	getGoal(): GoalWorkspaceGoal | undefined {
		return this.state.workspace?.goal;
	}

	getGoalWorkspace(): GoalWorkspace | undefined {
		return this.state.workspace;
	}

	getSurfaces(): readonly GoalSurface[] {
		return this.state.workspace?.surfaces ?? [];
	}

	getSurface(id: string): GoalSurface | undefined {
		return this.getSurfaces().find(surface => surface.id === id);
	}

	getContext(): GoalWorkspaceContext {
		return this.state.context;
	}

	getSurfaceContext(surfaceId: string): GoalSurfaceContextSummary | undefined {
		return this.state.context.surfaceSummaries.find(summary => summary.surfaceId === surfaceId);
	}

	getIx(): GoalWorkspaceIxState {
		return this.state.ix;
	}

	getSurfaceIxOverlay(surfaceId: string): GoalWorkspaceIxSurfaceOverlay | undefined {
		return this.state.ix.overlay?.surfaces.find(surface => surface.surfaceId === surfaceId);
	}

	getAffectedSurfacesForIxSubsystem(subsystem: string): readonly GoalSurface[] {
		const normalized = normalizeIxMatchText(subsystem);
		if (!normalized) {
			return [];
		}
		return this.getSurfaces().filter(surface => {
			const declaredMatches = [
				...surface.ixSubsystems,
				...(surface.ix?.subsystemIds ?? []),
				...(surface.ix?.subsystemLabels ?? []),
				...(surface.ix?.tags ?? []),
			].some(value => normalizeIxMatchText(value) === normalized);
			if (declaredMatches) {
				return true;
			}

			const overlay = this.getSurfaceIxOverlay(surface.id);
			return [
				...(overlay?.subsystemIds ?? []),
				...(overlay?.subsystemLabels ?? []),
			].some(value => normalizeIxMatchText(value) === normalized);
		});
	}

	getCrossAppWorkflow(id: string): GoalWorkspaceCrossAppWorkflow | undefined {
		return getGoalWorkspaceCrossAppWorkflow(id);
	}

	buildCrossAppWorkflowPlan(id: string, packageDraft: Partial<GoalWorkspaceTrainingPackageDraft> = {}): GoalWorkspaceCrossAppPlan | undefined {
		const workflow = this.getCrossAppWorkflow(id);
		if (!workflow || this.state.status !== 'loaded') {
			return undefined;
		}
		return buildCrossAppWorkflowPlan(this.state, workflow, packageDraft);
	}

	async refresh(): Promise<GoalWorkspaceState> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			return this.setState(createNoWorkspaceGoalWorkspaceState());
		}

		const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);
		const context = await this.readAgentContext(workspaceFolder, []);
		const ix = await this.readIxOverlay(workspaceFolder);
		if (!(await this.fileService.exists(manifestResource))) {
			return this.setState(createMissingGoalWorkspaceState(workspaceFolder, manifestResource, context, ix));
		}

		try {
			const content = (await this.fileService.readFile(manifestResource)).value.toString();
			const parsed = parseGoalWorkspaceManifestText(content, workspaceFolder, manifestResource);
			const parsedContext = await this.readAgentContext(workspaceFolder, parsed.workspace?.surfaces ?? []);
			const parsedIx = await this.readIxOverlay(workspaceFolder);
			return this.setState(withIxOverlay(withAgentContext(parsed, parsedContext), parsedIx));
		} catch (e: unknown) {
			return this.setState({
				status: 'invalid',
				workspaceFolder,
				manifestResource,
				workspace: undefined,
				context,
				ix,
				diagnostics: [{ path: '$', message: `Failed to read ${GOAL_WORKSPACE_MANIFEST}: ${String((e as Error)?.message ?? e)}` }]
			});
		}
	}

	private async readAgentContext(workspaceFolder: URI, surfaces: readonly GoalSurface[]): Promise<GoalWorkspaceContext> {
		return discoverGoalWorkspaceContext(this.fileService, workspaceFolder, surfaces);
	}

	private async readIxOverlay(workspaceFolder: URI): Promise<GoalWorkspaceIxState> {
		return discoverGoalWorkspaceIxOverlay(this.fileService, workspaceFolder);
	}

	private setState(state: GoalWorkspaceState): GoalWorkspaceState {
		this.state = state;
		this._onDidChangeGoalWorkspace.fire();
		this._onDidChangeState.fire(this.state);
		return this.state;
	}
}

export function createNoWorkspaceGoalWorkspaceState(): GoalWorkspaceState {
	return {
		status: 'no-workspace',
		workspaceFolder: undefined,
		manifestResource: undefined,
		workspace: undefined,
		context: EMPTY_CONTEXT,
		ix: EMPTY_IX,
		diagnostics: []
	};
}

export function createMissingGoalWorkspaceState(workspaceFolder: URI, manifestResource: URI, context: GoalWorkspaceContext = createEmptyAgentContext(workspaceFolder), ix: GoalWorkspaceIxState = createEmptyIxState(workspaceFolder)): GoalWorkspaceState {
	return {
		status: 'missing',
		workspaceFolder,
		manifestResource,
		workspace: undefined,
		context,
		ix,
		diagnostics: []
	};
}

export function parseGoalWorkspaceManifestText(text: string, workspaceFolder: URI, manifestResource: URI): GoalWorkspaceState {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e: unknown) {
		return {
			status: 'invalid',
			workspaceFolder,
			manifestResource,
			workspace: undefined,
			context: createEmptyAgentContext(workspaceFolder),
			ix: createEmptyIxState(workspaceFolder),
			diagnostics: [{ path: '$', message: `Invalid JSON: ${String((e as Error)?.message ?? e)}` }]
		};
	}

	return parseGoalWorkspaceManifest(raw, workspaceFolder, manifestResource);
}

export function parseGoalWorkspaceManifest(raw: unknown, workspaceFolder: URI, manifestResource: URI): GoalWorkspaceState {
	const diagnostics: GoalWorkspaceDiagnostic[] = [];
	if (!isRecord(raw)) {
		return invalidState(workspaceFolder, manifestResource, [{ path: '$', message: 'Manifest must be an object.' }]);
	}

	const goalRaw = raw.goal;
	if (!isRecord(goalRaw)) {
		return invalidState(workspaceFolder, manifestResource, [{ path: '$.goal', message: 'Goal must be an object.' }]);
	}

	const goal: GoalWorkspaceGoal = {
		id: requiredString(goalRaw, 'id', '$.goal.id', diagnostics),
		name: requiredString(goalRaw, 'name', '$.goal.name', diagnostics),
		description: optionalString(goalRaw, 'description', '$.goal.description', diagnostics),
		northStarMetric: optionalString(goalRaw, 'northStarMetric', '$.goal.northStarMetric', diagnostics)
	};

	const surfacesRaw = raw.surfaces;
	const surfaces: GoalWorkspaceSurface[] = [];
	if (surfacesRaw === undefined) {
		diagnostics.push({ path: '$.surfaces', message: 'Surfaces must be an array.' });
	} else if (!Array.isArray(surfacesRaw)) {
		diagnostics.push({ path: '$.surfaces', message: 'Surfaces must be an array.' });
	} else {
		const seenSurfaceIds = new Set<string>();
		for (let i = 0; i < surfacesRaw.length; i++) {
			const surface = parseSurface(surfacesRaw[i], i, diagnostics);
			if (!surface) {
				continue;
			}
			if (seenSurfaceIds.has(surface.id)) {
				diagnostics.push({ path: `$.surfaces[${i}].id`, message: `Duplicate surface id "${surface.id}".` });
				continue;
			}
			seenSurfaceIds.add(surface.id);
			surfaces.push(surface);
		}
	}

	const shared = parseShared(raw.shared, diagnostics);
	if (diagnostics.length > 0) {
		return invalidState(workspaceFolder, manifestResource, diagnostics);
	}

	return {
		status: 'loaded',
		workspaceFolder,
		manifestResource,
		workspace: {
			workspaceFolder,
			manifestResource,
			goal,
			surfaces,
			shared
		},
		context: createEmptyAgentContext(workspaceFolder),
		ix: createEmptyIxState(workspaceFolder),
		diagnostics: []
	};
}

export async function discoverGoalWorkspaceContext(fileService: IFileService, workspaceFolder: URI, surfaces: readonly GoalSurface[]): Promise<GoalWorkspaceContext> {
	const root = joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER);
	const globalFiles: GoalWorkspaceContextFile[] = [];
	const surfaceFiles: GoalWorkspaceContextFile[] = [];

	for (const file of GLOBAL_AGENT_CONTEXT_FILES) {
		const contextFile = await readAgentContextFile(fileService, root, file.relativePath, file.id, file.id);
		if (contextFile) {
			globalFiles.push(contextFile);
		}
	}

	for (const surface of surfaces) {
		const relativePath = `apps/${surface.id}.md`;
		const contextFile = await readAgentContextFile(fileService, root, relativePath, surface.id, 'surface');
		if (contextFile) {
			surfaceFiles.push(contextFile);
		}
	}

	return {
		root,
		globalFiles,
		surfaceFiles,
		surfaceSummaries: surfaces.map(surface => createSurfaceContextSummary(surface, globalFiles, surfaceFiles.filter(file => file.id === surface.id)))
	};
}

function createEmptyAgentContext(workspaceFolder: URI | undefined): GoalWorkspaceContext {
	return {
		root: workspaceFolder ? joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER) : undefined,
		globalFiles: [],
		surfaceFiles: [],
		surfaceSummaries: []
	};
}

function withAgentContext(state: GoalWorkspaceState, context: GoalWorkspaceContext): GoalWorkspaceState {
	return { ...state, context };
}

export async function discoverGoalWorkspaceIxOverlay(fileService: IFileService, workspaceFolder: URI): Promise<GoalWorkspaceIxState> {
	const root = joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER);
	const overlayResource = joinPath(root, GOAL_WORKSPACE_IX_OVERLAY_FILE);
	if (!(await safeExists(fileService, overlayResource))) {
		return createEmptyIxState(workspaceFolder);
	}

	try {
		const raw = JSON.parse((await fileService.readFile(overlayResource)).value.toString());
		const overlay = parseGoalWorkspaceIxOverlay(raw, overlayResource);
		return {
			root,
			overlayResource,
			overlay
		};
	} catch {
		return createEmptyIxState(workspaceFolder);
	}
}

function createEmptyIxState(workspaceFolder: URI | undefined): GoalWorkspaceIxState {
	const root = workspaceFolder ? joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER) : undefined;
	return {
		root,
		overlayResource: root ? joinPath(root, GOAL_WORKSPACE_IX_OVERLAY_FILE) : undefined,
		overlay: undefined
	};
}

function withIxOverlay(state: GoalWorkspaceState, ix: GoalWorkspaceIxState): GoalWorkspaceState {
	return { ...state, ix };
}

export function createDefaultEightWeekTrainingPackageDraft(overrides: Partial<GoalWorkspaceTrainingPackageDraft> = {}): GoalWorkspaceTrainingPackageDraft {
	return {
		id: overrides.id ?? 'strength-reset-8-week',
		name: overrides.name ?? '8-Week Strength Reset',
		durationWeeks: overrides.durationWeeks ?? 8,
		priceCents: overrides.priceCents ?? 49900,
		billingModel: overrides.billingModel ?? 'one_time',
		status: overrides.status ?? 'draft',
		description: overrides.description ?? 'An 8-week training program for clients who want structured strength training, weekly accountability, and measurable progress.',
		features: overrides.features ?? [
			'Personalized training plan',
			'Weekly check-ins',
			'Progress tracking',
			'Optional intro consultation'
		]
	};
}

export function buildCrossAppWorkflowPlan(state: GoalWorkspaceState, workflow: GoalWorkspaceCrossAppWorkflow, packageDraftOverrides: Partial<GoalWorkspaceTrainingPackageDraft> = {}): GoalWorkspaceCrossAppPlan | undefined {
	if (state.status !== 'loaded' || !state.workspace) {
		return undefined;
	}

	const packageDraft = createDefaultEightWeekTrainingPackageDraft(packageDraftOverrides);
	const affectedSurfaces = resolveAffectedSurfaces(state, workflow);
	const sharedContext = buildSharedContextBundle(state);
	const priorDecisions = state.context.globalFiles
		.filter(file => file.kind === 'decisions')
		.map(file => `${file.relativePath}: ${file.summary}`);
	const context: GoalWorkspaceCrossAppContextBundle = {
		taskKind: 'create-package',
		goalId: state.workspace.goal.id,
		goalName: state.workspace.goal.name,
		packageDraft,
		affectedSurfaces,
		sharedContext,
		priorDecisions,
		ixCommand: state.ix.overlay?.command
	};

	return {
		workflow,
		context,
		steps: buildAddTrainingPackageSteps(packageDraft, affectedSurfaces),
		unknowns: [
			'External billing provider plan IDs are not inferred by this workflow. Create package billing metadata as draft/manual unless provider IDs already exist.',
			'Real ad/social publishing remains out of scope; content changes should create launch drafts only.',
			'Surface adapters should prefer central package/domain config over duplicated per-app constants.'
		],
		validation: buildAddTrainingPackageValidation(packageDraft, affectedSurfaces),
		memoryUpdates: [
			'.agent/decisions.md: record package id, price, status, affected surfaces, and billing-provider caveat.',
			'.agent/apps/booking.md: record package preselection route and package-selection ownership.',
			'.agent/apps/analytics.md: record packageId segmentation expectations.',
			'.agent/apps/content.md: record launch campaign draft ownership.'
		]
	};
}

export function formatCrossAppWorkflowPlanMarkdown(plan: GoalWorkspaceCrossAppPlan): string {
	const dollars = `$${(plan.context.packageDraft.priceCents / 100).toFixed(0)}`;
	const lines: string[] = [
		`# ${plan.workflow.label}`,
		'',
		`Goal: ${plan.context.goalName ?? '(unknown goal)'}`,
		`Workflow: \`${plan.workflow.id}\``,
		'',
		'## Package Draft',
		'',
		`- id: \`${plan.context.packageDraft.id}\``,
		`- name: ${plan.context.packageDraft.name}`,
		`- duration: ${plan.context.packageDraft.durationWeeks} weeks`,
		`- price: ${dollars}`,
		`- billing model: ${plan.context.packageDraft.billingModel}`,
		`- status: ${plan.context.packageDraft.status}`,
		`- description: ${plan.context.packageDraft.description}`,
		'- features:',
		...plan.context.packageDraft.features.map(feature => `  - ${feature}`),
		'',
		'## Affected Surfaces',
		'',
		...plan.context.affectedSurfaces.flatMap(surface => [
			`### ${surface.surfaceName} (\`${surface.surfaceId}\`)`,
			'',
			`Reason: ${surface.reason}`,
			...(surface.path ? [`Path: \`${surface.path}\``] : []),
			...(surface.matchedCapabilities.length ? [`Matched capabilities: ${surface.matchedCapabilities.map(capability => `\`${capability}\``).join(', ')}`] : []),
			...(surface.ixSubsystemLabels.length ? [`Ix subsystems: ${surface.ixSubsystemLabels.map(label => `\`${label}\``).join(', ')}`] : []),
			...(surface.contextSummary ? [`Context: ${surface.contextSummary}`] : []),
			''
		]),
		'## Cross-App Plan',
		'',
		...plan.steps.flatMap(step => [
			`### ${step.title}`,
			'',
			...step.details.map(detail => `- ${detail}`),
			''
		]),
		'## Validation',
		'',
		...plan.validation.flatMap(step => [
			`### ${step.title}`,
			'',
			...step.details.map(detail => `- ${detail}`),
			''
		]),
		'## Memory Updates',
		'',
		...plan.memoryUpdates.map(update => `- ${update}`),
		'',
		'## Unknowns',
		'',
		...plan.unknowns.map(unknown => `- ${unknown}`),
		'',
		'## Shared Context',
		'',
		`- domain files: ${plan.context.sharedContext.domainFiles.length ? plan.context.sharedContext.domainFiles.map(file => `\`${file}\``).join(', ') : '(none discovered)'}`,
		`- event files: ${plan.context.sharedContext.eventFiles.length ? plan.context.sharedContext.eventFiles.map(file => `\`${file}\``).join(', ') : '(none discovered)'}`,
		`- workflow files: ${plan.context.sharedContext.workflowFiles.length ? plan.context.sharedContext.workflowFiles.map(file => `\`${file}\``).join(', ') : '(none discovered)'}`,
		`- global context: ${plan.context.sharedContext.globalContextFiles.length ? plan.context.sharedContext.globalContextFiles.map(file => `\`${file}\``).join(', ') : '(none discovered)'}`,
		...(plan.context.ixCommand ? ['', `Ix command: \`${plan.context.ixCommand}\``] : [])
	];
	return `${lines.join('\n')}\n`;
}

function resolveAffectedSurfaces(state: GoalWorkspaceState, workflow: GoalWorkspaceCrossAppWorkflow): readonly GoalWorkspaceSurfaceImpact[] {
	const surfaces = state.workspace?.surfaces ?? [];
	const affected = new Map<string, GoalWorkspaceSurfaceImpact>();
	for (const surface of surfaces) {
		const matchedCapabilities = surface.capabilities.filter(capability => workflow.affectedCapabilities.some(required => normalizeCapability(required) === normalizeCapability(capability)));
		const isFallbackSurface = workflow.fallbackSurfaceIds.some(id => normalizeCapability(id) === normalizeCapability(surface.id));
		if (!matchedCapabilities.length && !isFallbackSurface) {
			continue;
		}

		const overlay = state.ix.overlay?.surfaces.find(item => item.surfaceId === surface.id);
		const contextSummary = state.context.surfaceSummaries.find(summary => summary.surfaceId === surface.id)?.summary;
		affected.set(surface.id, {
			surfaceId: surface.id,
			surfaceName: surface.name,
			path: surface.path,
			purpose: surface.purpose,
			reason: surfaceImpactReason(surface, matchedCapabilities),
			matchedCapabilities,
			contextSummary: contextSummary || undefined,
			ixSubsystemIds: uniqueStrings([...(surface.ix?.subsystemIds ?? []), ...(overlay?.subsystemIds ?? [])]),
			ixSubsystemLabels: uniqueStrings([...(surface.ix?.subsystemLabels ?? []), ...surface.ixSubsystems, ...(overlay?.subsystemLabels ?? [])])
		});
	}

	return workflow.fallbackSurfaceIds
		.map(id => affected.get(id))
		.filter((impact): impact is GoalWorkspaceSurfaceImpact => Boolean(impact))
		.concat(Array.from(affected.values()).filter(impact => !workflow.fallbackSurfaceIds.includes(impact.surfaceId)));
}

function buildSharedContextBundle(state: GoalWorkspaceState): GoalWorkspaceSharedContextBundle {
	const shared = state.workspace?.shared ?? EMPTY_SHARED;
	const sharedPaths = [shared.domain, shared.events, shared.workflows].filter((path): path is string => Boolean(path));
	return {
		domainFiles: uniqueStrings([
			...(shared.domain ? [shared.domain] : []),
			...state.context.globalFiles.filter(file => file.kind === 'domain').map(file => file.relativePath)
		]),
		eventFiles: uniqueStrings([
			...(shared.events ? [shared.events] : []),
			...state.context.globalFiles.filter(file => file.kind === 'events').map(file => file.relativePath)
		]),
		workflowFiles: uniqueStrings([
			...(shared.workflows ? [shared.workflows] : []),
			...sharedPaths.filter(path => path.toLowerCase().includes('workflow'))
		]),
		globalContextFiles: state.context.globalFiles.map(file => file.relativePath)
	};
}

function buildAddTrainingPackageSteps(packageDraft: GoalWorkspaceTrainingPackageDraft, affectedSurfaces: readonly GoalWorkspaceSurfaceImpact[]): readonly GoalWorkspaceCrossAppPlanStep[] {
	const steps: GoalWorkspaceCrossAppPlanStep[] = [{
		surfaceId: 'shared-domain',
		title: 'Shared Domain',
		details: [
			`Add \`${packageDraft.id}\` to the central training package/offer definition.`,
			'Include duration, price, billing model, status, description, and feature list.',
			'Use this central definition from surfaces instead of duplicating package constants.'
		]
	}];
	for (const surface of affectedSurfaces) {
		steps.push({
			surfaceId: surface.surfaceId,
			title: surface.surfaceName,
			details: addTrainingPackageSurfacePlanDetails(surface.surfaceId, packageDraft)
		});
	}
	return steps;
}

function buildAddTrainingPackageValidation(packageDraft: GoalWorkspaceTrainingPackageDraft, affectedSurfaces: readonly GoalWorkspaceSurfaceImpact[]): readonly GoalWorkspaceCrossAppPlanStep[] {
	return affectedSurfaces.map(surface => ({
		surfaceId: surface.surfaceId,
		title: `${surface.surfaceName} Validation`,
		details: addTrainingPackageSurfaceValidationDetails(surface.surfaceId, packageDraft)
	}));
}

function addTrainingPackageSurfacePlanDetails(surfaceId: string, packageDraft: GoalWorkspaceTrainingPackageDraft): readonly string[] {
	switch (surfaceId) {
		case 'marketing':
			return [
				`Add a public or draft offer card for ${packageDraft.name}.`,
				`Point the CTA to \`/booking?package=${packageDraft.id}\`.`
			];
		case 'booking':
			return [
				'Add the package to the package selector.',
				`Support preselection with \`?package=${packageDraft.id}\`.`,
				'Ensure booking creation includes packageId.'
			];
		case 'subscriptions':
			return [
				'Add billing plan metadata for the package.',
				'Use draft/manual provider metadata when no live provider plan ID exists.'
			];
		case 'admin':
			return [
				'Expose the package in package management.',
				'Add package filters for client lists or enrollment views.'
			];
		case 'analytics':
			return [
				'Add packageId as a funnel/revenue segment dimension.',
				'Render the package in dashboards even before metrics exist.'
			];
		case 'content':
			return [
				'Create launch campaign drafts for social and email.',
				`Use the booking CTA \`/booking?package=${packageDraft.id}\`.`
			];
		default:
			return ['Review this surface for package-related capability changes.'];
	}
}

function addTrainingPackageSurfaceValidationDetails(surfaceId: string, packageDraft: GoalWorkspaceTrainingPackageDraft): readonly string[] {
	switch (surfaceId) {
		case 'marketing':
			return [`Preview contains "${packageDraft.name}".`, `CTA contains \`package=${packageDraft.id}\`.`];
		case 'booking':
			return [`Package selector contains "${packageDraft.name}".`, `URL preselection works for \`package=${packageDraft.id}\`.`];
		case 'subscriptions':
			return [`Billing metadata exists for \`${packageDraft.id}\`.`, 'Draft/manual provider status is explicit when provider IDs are absent.'];
		case 'admin':
			return [`Package list/filter contains "${packageDraft.name}".`];
		case 'analytics':
			return [`Package segment list contains \`${packageDraft.id}\`.`];
		case 'content':
			return [`Launch campaign drafts reference "${packageDraft.name}".`, `Draft CTAs contain \`package=${packageDraft.id}\`.`];
		default:
			return [`Surface references \`${packageDraft.id}\` only where relevant.`];
	}
}

function surfaceImpactReason(surface: GoalSurface, matchedCapabilities: readonly string[]): string {
	const id = surface.id.toLowerCase();
	if (id === 'marketing') {
		return 'Public offer/pricing pages need to show the new package and route visitors into booking.';
	}
	if (id === 'booking') {
		return 'Leads need to select the package before scheduling an intro call or training session.';
	}
	if (id === 'subscriptions') {
		return 'The package needs billing/subscription metadata before it can be sold or tracked.';
	}
	if (id === 'admin') {
		return 'The trainer needs operational visibility for clients enrolled in this package.';
	}
	if (id === 'analytics') {
		return 'Conversion, revenue, and retention dashboards need package-level segmentation.';
	}
	if (id === 'content') {
		return 'Launch content and campaign drafts should promote the new offer.';
	}
	if (matchedCapabilities.length) {
		return `Surface matches package workflow capabilities: ${matchedCapabilities.join(', ')}.`;
	}
	return surface.purpose ? `Surface purpose may be affected: ${surface.purpose}` : 'Surface is part of the workflow fallback set.';
}

function normalizeCapability(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function parseGoalWorkspaceIxOverlay(raw: unknown, resource: URI): GoalWorkspaceIxOverlay | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	return {
		resource,
		generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
		command: typeof raw.command === 'string' ? raw.command : undefined,
		discoveredSubsystems: parseIxDiscoveredSubsystems(raw.discoveredSubsystems),
		surfaces: parseIxSurfaceOverlays(raw.surfaces)
	};
}

function parseIxDiscoveredSubsystems(raw: unknown): readonly GoalWorkspaceIxDiscoveredSubsystem[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: GoalWorkspaceIxDiscoveredSubsystem[] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const id = optionalStringValue(item.id);
		const label = optionalStringValue(item.label);
		if (!id || !label) {
			continue;
		}
		const fileCount = typeof item.fileCount === 'number' && Number.isFinite(item.fileCount) ? item.fileCount : undefined;
		result.push({
			id,
			label,
			kind: optionalStringValue(item.kind),
			path: optionalStringValue(item.path),
			fileCount
		});
	}
	return result;
}

function parseIxSurfaceOverlays(raw: unknown): readonly GoalWorkspaceIxSurfaceOverlay[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: GoalWorkspaceIxSurfaceOverlay[] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const surfaceId = optionalStringValue(item.surfaceId);
		if (!surfaceId) {
			continue;
		}
		result.push({
			surfaceId,
			subsystemIds: stringArrayValue(item.subsystemIds),
			subsystemLabels: stringArrayValue(item.subsystemLabels),
			matchReason: optionalStringValue(item.matchReason)
		});
	}
	return result;
}

async function readAgentContextFile(fileService: IFileService, root: URI, relativePath: string, id: string, kind: GoalWorkspaceContextFileKind): Promise<GoalWorkspaceContextFile | undefined> {
	const resource = joinPath(root, ...relativePath.split('/'));
	if (!(await safeExists(fileService, resource))) {
		return undefined;
	}

	try {
		const content = (await fileService.readFile(resource)).value.toString();
		return {
			id,
			kind,
			resource,
			relativePath: `${GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER}/${relativePath}`,
			summary: summarizeAgentContextMarkdown(content)
		};
	} catch {
		return undefined;
	}
}

function createSurfaceContextSummary(surface: GoalSurface, globalFiles: readonly GoalWorkspaceContextFile[], surfaceFiles: readonly GoalWorkspaceContextFile[]): GoalSurfaceContextSummary {
	const parts = [...globalFiles, ...surfaceFiles]
		.map(file => `${file.relativePath}: ${file.summary}`)
		.filter(part => part.trim().length > 0);

	return {
		surfaceId: surface.id,
		surfaceName: surface.name,
		files: surfaceFiles,
		summary: parts.join('\n')
	};
}

function summarizeAgentContextMarkdown(content: string): string {
	const lines = content.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0);

	const heading = lines.find(line => line.startsWith('#'))?.replace(/^#+\s*/, '').trim();
	if (heading) {
		return heading;
	}

	const firstContentLine = lines.find(line => !line.startsWith('<!--'));
	if (!firstContentLine) {
		return '';
	}

	return firstContentLine.length > 160 ? `${firstContentLine.slice(0, 157)}...` : firstContentLine;
}

function parseSurface(raw: unknown, index: number, diagnostics: GoalWorkspaceDiagnostic[]): GoalWorkspaceSurface | undefined {
	const basePath = `$.surfaces[${index}]`;
	if (!isRecord(raw)) {
		diagnostics.push({ path: basePath, message: 'Surface must be an object.' });
		return undefined;
	}

	const id = requiredString(raw, 'id', `${basePath}.id`, diagnostics);
	const name = requiredString(raw, 'name', `${basePath}.name`, diagnostics);
	if (!id || !name) {
		return undefined;
	}
	const ix = parseSurfaceIxMetadata(raw.ix, `${basePath}.ix`, diagnostics);
	const legacyIxSubsystems = optionalStringArray(raw, 'ixSubsystems', `${basePath}.ixSubsystems`, diagnostics);

	return {
		id,
		name,
		type: optionalString(raw, 'type', `${basePath}.type`, diagnostics),
		path: optionalString(raw, 'path', `${basePath}.path`, diagnostics),
		devCommand: optionalString(raw, 'devCommand', `${basePath}.devCommand`, diagnostics),
		localUrl: optionalString(raw, 'localUrl', `${basePath}.localUrl`, diagnostics),
		purpose: optionalString(raw, 'purpose', `${basePath}.purpose`, diagnostics),
		capabilities: optionalStringArray(raw, 'capabilities', `${basePath}.capabilities`, diagnostics),
		events: optionalStringArray(raw, 'events', `${basePath}.events`, diagnostics),
		entities: optionalStringArray(raw, 'entities', `${basePath}.entities`, diagnostics),
		ixSubsystems: uniqueStrings([...legacyIxSubsystems, ...(ix?.subsystemLabels ?? [])]),
		ix
	};
}

function parseSurfaceIxMetadata(raw: unknown, path: string, diagnostics: GoalWorkspaceDiagnostic[]): GoalSurfaceIxMetadata | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!isRecord(raw)) {
		diagnostics.push({ path, message: 'Ix metadata must be an object.' });
		return undefined;
	}

	const subsystemLabels = uniqueStrings([
		...optionalStringArray(raw, 'subsystems', `${path}.subsystems`, diagnostics),
		...optionalStringArray(raw, 'subsystemLabels', `${path}.subsystemLabels`, diagnostics),
	]);
	const subsystemIds = optionalStringArray(raw, 'subsystemIds', `${path}.subsystemIds`, diagnostics);
	const tags = optionalStringArray(raw, 'tags', `${path}.tags`, diagnostics);
	const notes = optionalString(raw, 'notes', `${path}.notes`, diagnostics);
	return {
		subsystemIds,
		subsystemLabels,
		tags,
		notes
	};
}

function parseShared(raw: unknown, diagnostics: GoalWorkspaceDiagnostic[]): GoalWorkspaceShared {
	if (raw === undefined) {
		return EMPTY_SHARED;
	}
	if (!isRecord(raw)) {
		diagnostics.push({ path: '$.shared', message: 'Shared must be an object.' });
		return EMPTY_SHARED;
	}
	return {
		domain: optionalString(raw, 'domain', '$.shared.domain', diagnostics),
		events: optionalString(raw, 'events', '$.shared.events', diagnostics),
		ui: optionalString(raw, 'ui', '$.shared.ui', diagnostics),
		auth: optionalString(raw, 'auth', '$.shared.auth', diagnostics),
		workflows: optionalString(raw, 'workflows', '$.shared.workflows', diagnostics)
	};
}

function invalidState(workspaceFolder: URI, manifestResource: URI, diagnostics: readonly GoalWorkspaceDiagnostic[]): GoalWorkspaceState {
	return {
		status: 'invalid',
		workspaceFolder,
		manifestResource,
		workspace: undefined,
		context: createEmptyAgentContext(workspaceFolder),
		ix: createEmptyIxState(workspaceFolder),
		diagnostics
	};
}

function requiredString(raw: Record<string, unknown>, key: string, path: string, diagnostics: GoalWorkspaceDiagnostic[]): string {
	const value = raw[key];
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}
	diagnostics.push({ path, message: 'Expected a non-empty string.' });
	return '';
}

function optionalString(raw: Record<string, unknown>, key: string, path: string, diagnostics: GoalWorkspaceDiagnostic[]): string | undefined {
	const value = raw[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	diagnostics.push({ path, message: 'Expected a string.' });
	return undefined;
}

function optionalStringArray(raw: Record<string, unknown>, key: string, path: string, diagnostics: GoalWorkspaceDiagnostic[]): readonly string[] {
	const value = raw[key];
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		diagnostics.push({ path, message: 'Expected an array of strings.' });
		return [];
	}

	const result: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		if (typeof item === 'string' && item.trim().length > 0) {
			result.push(item.trim());
		} else {
			diagnostics.push({ path: `${path}[${i}]`, message: 'Expected a non-empty string.' });
		}
	}
	return result;
}

function optionalStringValue(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function stringArrayValue(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return uniqueStrings(value.map(optionalStringValue).filter((item): item is string => Boolean(item)));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		const key = trimmed.toLowerCase();
		if (!trimmed || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

function normalizeIxMatchText(value: string): string {
	return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeExists(fileService: IFileService, resource: URI): Promise<boolean> {
	try {
		return await fileService.exists(resource);
	} catch {
		return false;
	}
}

registerSingleton(IGoalWorkspaceService, GoalWorkspaceService, InstantiationType.Delayed);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService, WorkbenchState } from '../../vs/platform/workspace/common/workspace.js';
import { localize } from '../../vs/nls.js';
import { ILanguageModelToolsService } from '../../vs/workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_ID } from '../ai/common/customAiConstants.js';
import { CUSTOM_AI_PRODUCT_SYSTEM_PROMPT } from '../ai/browser/customAiChatAgent.js';
import { IIxIntegrationService } from '../ix/IxIntegrationService.js';
import { AGENT_CONTEXT_FOLDER, IConsoleService, WORKSPACE_MANIFEST } from './ConsoleService.js';
import { hasBrandConfigured } from './goalWorkspaceSurfaceSetup.js';
import { SurfaceBuilderHandoffState } from './surfaceBuilderHandoffState.js';
import { SurfaceBlueprintOrchestrator } from './surfaceBlueprintOrchestrator.js';
import { blueprintResource, readBlueprint } from './surfaceBlueprintService.js';
import { listSurfaceTemplateIds, loadSurfaceTemplate } from './surfaceBlueprintTemplateRegistry.js';
import { IWorkflowCatalogService } from './workflowCatalogService.js';
import type {
	SurfaceFeatureCheckItem,
	SurfaceWorkflowActionItem,
	SurfaceFeatureChecklistState,
	SurfaceFeatureCheckStatus,
} from './surfaceFeatureChecklistTypes.js';

export interface ISurfaceFeatureChecklistService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<SurfaceFeatureChecklistState>;
	getState(): SurfaceFeatureChecklistState;
	refresh(): Promise<void>;
}

export const ISurfaceFeatureChecklistService = createDecorator<ISurfaceFeatureChecklistService>('surfaceFeatureChecklistService');

interface CheckMutable {
	readonly id: string;
	readonly category: SurfaceFeatureCheckItem['category'];
	readonly label: string;
	readonly description: string;
	status: SurfaceFeatureCheckStatus;
	detail: string;
}

export class SurfaceFeatureChecklistService extends Disposable implements ISurfaceFeatureChecklistService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<SurfaceFeatureChecklistState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private readonly checks: CheckMutable[];
	private isRefreshing = false;
	private refreshInFlight: Promise<void> | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IConsoleService private readonly consoleService: IConsoleService,
		@IIxIntegrationService private readonly ixIntegrationService: IIxIntegrationService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IWorkflowCatalogService private readonly workflowCatalogService: IWorkflowCatalogService,
	) {
		super();
		this.checks = this.buildChecks();

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.scheduleRefresh()));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => void this.scheduleRefresh()));
		this._register(this.consoleService.onDidChangeWorkspace(() => void this.scheduleRefresh()));
		this._register(this.consoleService.onDidChangeState(() => void this.scheduleRefresh()));
		this._register(this.ixIntegrationService.onDidChangeState(() => void this.scheduleRefresh()));
		this._register(this.workflowCatalogService.onDidChangeCatalog(() => void this.scheduleRefresh()));

		void this.refresh();
	}

	getState(): SurfaceFeatureChecklistState {
		return this.snapshot();
	}

	async refresh(): Promise<void> {
		if (this.refreshInFlight) {
			return this.refreshInFlight;
		}
		this.isRefreshing = true;
		this.fireState();
		this.refreshInFlight = this.doRefresh().finally(() => {
			this.isRefreshing = false;
			this.refreshInFlight = undefined;
			this.fireState();
		});
		return this.refreshInFlight;
	}

	private scheduleRefresh(): void {
		void this.refresh();
	}

	private buildChecks(): CheckMutable[] {
		return [
			{
				id: 'workspace-open',
				category: 'workspace',
				label: localize('surfaceFeatureChecklist.workspaceOpen.label', 'Project folder'),
				description: localize('surfaceFeatureChecklist.workspaceOpen.description', 'A workspace folder must be open to create surfaces.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'workspace-manifest',
				category: 'workspace',
				label: localize('surfaceFeatureChecklist.workspaceManifest.label', 'workspace.goal.json'),
				description: localize('surfaceFeatureChecklist.workspaceManifest.description', 'The goal workspace manifest loads business, brand, and surface metadata.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'goal-form',
				category: 'builder',
				label: localize('surfaceFeatureChecklist.goalForm.label', 'Business goal'),
				description: localize('surfaceFeatureChecklist.goalForm.description', 'The guided builder saves a business name and description.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'brand-setup',
				category: 'builder',
				label: localize('surfaceFeatureChecklist.brandSetup.label', 'Brand setup'),
				description: localize('surfaceFeatureChecklist.brandSetup.description', 'Brand colors or logos are configured in workspace.goal.json.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'starter-surface-grid',
				category: 'builder',
				label: localize('surfaceFeatureChecklist.starterGrid.label', 'Starter surface cards'),
				description: localize('surfaceFeatureChecklist.starterGrid.description', 'Eight starter surfaces are available in the guided builder grid.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'blueprint-templates',
				category: 'blueprint',
				label: localize('surfaceFeatureChecklist.blueprintTemplates.label', 'Blueprint templates'),
				description: localize('surfaceFeatureChecklist.blueprintTemplates.description', 'Subsystem blueprint templates cover every starter surface plus custom.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'blueprint-persist',
				category: 'blueprint',
				label: localize('surfaceFeatureChecklist.blueprintPersist.label', 'Persisted blueprints'),
				description: localize('surfaceFeatureChecklist.blueprintPersist.description', 'Surface blueprints are written to .agent/surfaces/<id>.blueprint.json.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'manifest-surfaces',
				category: 'blueprint',
				label: localize('surfaceFeatureChecklist.manifestSurfaces.label', 'Manifest surfaces'),
				description: localize('surfaceFeatureChecklist.manifestSurfaces.description', 'Created surfaces are registered in workspace.goal.json.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'surface-scaffolds',
				category: 'blueprint',
				label: localize('surfaceFeatureChecklist.surfaceScaffolds.label', 'Surface app scaffolds'),
				description: localize('surfaceFeatureChecklist.surfaceScaffolds.description', 'Registered surfaces have app folders with package.json.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'blueprint-verifier',
				category: 'verification',
				label: localize('surfaceFeatureChecklist.blueprintVerifier.label', 'Blueprint verifier'),
				description: localize('surfaceFeatureChecklist.blueprintVerifier.description', 'Deterministic verification checks subsystem paths, manifest fields, and acceptance criteria.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'verify-ai-tool',
				category: 'verification',
				label: localize('surfaceFeatureChecklist.verifyAiTool.label', 'verifySurfaceBlueprint tool'),
				description: localize('surfaceFeatureChecklist.verifyAiTool.description', 'Custom AI can call verifySurfaceBlueprint during scaffold and repair.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'ix-backed-verify',
				category: 'verification',
				label: localize('surfaceFeatureChecklist.ixBackedVerify.label', 'Ix-backed verification'),
				description: localize('surfaceFeatureChecklist.ixBackedVerify.description', 'Ix discovery can enrich blueprint verification with code-map matches.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'verified-surfaces',
				category: 'verification',
				label: localize('surfaceFeatureChecklist.verifiedSurfaces.label', 'Verified surfaces'),
				description: localize('surfaceFeatureChecklist.verifiedSurfaces.description', 'Surfaces pass the blueprint acceptance contract (status verified).'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'agent-blueprint-prompt',
				category: 'agent',
				label: localize('surfaceFeatureChecklist.agentPrompt.label', 'Agent blueprint workflow'),
				description: localize('surfaceFeatureChecklist.agentPrompt.description', 'Custom AI system prompt enforces blueprint-first surface creation and verification.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'surface-handoff',
				category: 'agent',
				label: localize('surfaceFeatureChecklist.surfaceHandoff.label', 'Surface handoff'),
				description: localize('surfaceFeatureChecklist.surfaceHandoff.description', 'Starter clicks open scaffold handoff with workspace.goal.json attached to chat.'),
				status: 'pending',
				detail: '',
			},
			{
				id: 'auto-repair-handoff',
				category: 'agent',
				label: localize('surfaceFeatureChecklist.autoRepair.label', 'Auto-repair handoff'),
				description: localize('surfaceFeatureChecklist.autoRepair.description', 'Failed verification injects a repair prompt into the Console chat column.'),
				status: 'pending',
				detail: '',
			},
		];
	}

	private async doRefresh(): Promise<void> {
		await this.probeWorkspaceOpen();
		await this.probeWorkspaceManifest();
		await this.probeGoalForm();
		await this.probeBrandSetup();
		this.probeStarterSurfaceGrid();
		this.probeBlueprintTemplates();
		await this.probeBlueprintPersist();
		await this.probeManifestSurfaces();
		await this.probeSurfaceScaffolds();
		this.probeBlueprintVerifier();
		this.probeVerifyAiTool();
		this.probeIxBackedVerify();
		await this.probeVerifiedSurfaces();
		this.probeAgentBlueprintPrompt();
		this.probeSurfaceHandoff();
		this.probeAutoRepairHandoff();
	}

	private probeWorkspaceOpen(): Promise<void> {
		const step = this.findCheck('workspace-open')!;
		const state = this.workspaceContextService.getWorkbenchState();
		if (state === WorkbenchState.EMPTY) {
			step.status = 'error';
			step.detail = localize('surfaceFeatureChecklist.workspaceOpen.empty', 'No folder is open.');
			return Promise.resolve();
		}
		const folder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		step.status = 'success';
		step.detail = folder?.fsPath ?? localize('surfaceFeatureChecklist.workspaceOpen.open', 'Workspace folder is open.');
		return Promise.resolve();
	}

	private async probeWorkspaceManifest(): Promise<void> {
		const step = this.findCheck('workspace-manifest')!;
		const workspaceStep = this.findCheck('workspace-open');
		if (workspaceStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('surfaceFeatureChecklist.workspaceManifest.waitWorkspace', 'Open a workspace folder first.');
			return;
		}
		const state = this.consoleService.getState();
		if (state.status === 'loaded') {
			step.status = 'success';
			step.detail = WORKSPACE_MANIFEST;
			return;
		}
		if (state.status === 'missing') {
			step.status = 'warning';
			step.detail = localize('surfaceFeatureChecklist.workspaceManifest.missing', '{0} is not present yet.', WORKSPACE_MANIFEST);
			return;
		}
		step.status = 'error';
		step.detail = state.diagnostics[0]?.message
			?? localize('surfaceFeatureChecklist.workspaceManifest.invalid', 'workspace.goal.json could not be loaded.');
	}

	private probeGoalForm(): Promise<void> {
		const step = this.findCheck('goal-form')!;
		const manifestStep = this.findCheck('workspace-manifest');
		if (manifestStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('surfaceFeatureChecklist.goalForm.waitManifest', 'Load workspace.goal.json first.');
			return Promise.resolve();
		}
		const goal = this.consoleService.getGoal();
		if (goal?.name?.trim()) {
			step.status = 'success';
			step.detail = goal.name.trim();
			return Promise.resolve();
		}
		step.status = 'warning';
		step.detail = localize('surfaceFeatureChecklist.goalForm.missing', 'Enter a business name in the guided builder.');
		return Promise.resolve();
	}

	private probeBrandSetup(): Promise<void> {
		const step = this.findCheck('brand-setup')!;
		const manifestStep = this.findCheck('workspace-manifest');
		if (manifestStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('surfaceFeatureChecklist.brandSetup.waitManifest', 'Load workspace.goal.json first.');
			return Promise.resolve();
		}
		const brand = this.consoleService.getWorkspace()?.brand;
		if (hasBrandConfigured(brand)) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.brandSetup.configured', 'Brand colors or logos are configured.');
			return Promise.resolve();
		}
		step.status = 'warning';
		step.detail = localize('surfaceFeatureChecklist.brandSetup.missing', 'Add brand colors or upload logos in the Brand section.');
		return Promise.resolve();
	}

	private probeStarterSurfaceGrid(): void {
		const step = this.findCheck('starter-surface-grid')!;
		const starterTemplateCount = listSurfaceTemplateIds().filter(id => id !== 'custom').length;
		if (starterTemplateCount >= 8) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.starterGrid.ready', '{0} starter templates available.', String(starterTemplateCount));
			return;
		}
		step.status = 'error';
		step.detail = localize('surfaceFeatureChecklist.starterGrid.missing', 'Expected 8 starter templates; found {0}.', String(starterTemplateCount));
	}

	private probeBlueprintTemplates(): void {
		const step = this.findCheck('blueprint-templates')!;
		const templateIds = listSurfaceTemplateIds();
		const missing = templateIds.filter(id => !loadSurfaceTemplate(id));
		if (missing.length === 0) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.blueprintTemplates.ready', '{0} templates registered.', String(templateIds.length));
			return;
		}
		step.status = 'error';
		step.detail = localize('surfaceFeatureChecklist.blueprintTemplates.missing', 'Missing templates: {0}', missing.join(', '));
	}

	private async probeBlueprintPersist(): Promise<void> {
		const step = this.findCheck('blueprint-persist')!;
		const workspaceStep = this.findCheck('workspace-open');
		if (workspaceStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('surfaceFeatureChecklist.blueprintPersist.waitWorkspace', 'Open a workspace folder first.');
			return;
		}
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			step.status = 'pending';
			step.detail = '';
			return;
		}

		const handoff = SurfaceBuilderHandoffState.getActive();
		if (handoff?.blueprintResource) {
			const exists = await this.fileService.exists(URI.file(handoff.blueprintResource));
			if (exists) {
				step.status = 'success';
				step.detail = localize('surfaceFeatureChecklist.blueprintPersist.active', 'Active handoff blueprint: {0}', handoff.surfaceId);
				return;
			}
		}

		const surfacesFolder = joinPath(workspaceFolder, AGENT_CONTEXT_FOLDER, 'surfaces');
		try {
			const stat = await this.fileService.resolve(surfacesFolder);
			const blueprintFiles = stat.children?.filter(child => child.name.endsWith('.blueprint.json')) ?? [];
			if (blueprintFiles.length > 0) {
				step.status = 'success';
				step.detail = localize('surfaceFeatureChecklist.blueprintPersist.count', '{0} blueprint file(s) in .agent/surfaces/.', String(blueprintFiles.length));
				return;
			}
		} catch {
			// folder missing
		}

		step.status = 'warning';
		step.detail = localize('surfaceFeatureChecklist.blueprintPersist.none', 'No blueprint files yet. Click a starter surface to create one.');
	}

	private async probeManifestSurfaces(): Promise<void> {
		const step = this.findCheck('manifest-surfaces')!;
		const manifestStep = this.findCheck('workspace-manifest');
		if (manifestStep?.status !== 'success') {
			step.status = 'pending';
			step.detail = localize('surfaceFeatureChecklist.manifestSurfaces.waitManifest', 'Load workspace.goal.json first.');
			return;
		}
		const surfaces = this.consoleService.getSurfaces();
		if (surfaces.length === 0) {
			step.status = 'warning';
			step.detail = localize('surfaceFeatureChecklist.manifestSurfaces.none', 'No surfaces registered yet.');
			return;
		}
		step.status = 'success';
		step.detail = localize('surfaceFeatureChecklist.manifestSurfaces.count', '{0} surface(s) registered.', String(surfaces.length));
	}

	private async probeSurfaceScaffolds(): Promise<void> {
		const step = this.findCheck('surface-scaffolds')!;
		const manifestStep = this.findCheck('manifest-surfaces');
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const surfaces = this.consoleService.getSurfaces();
		if (manifestStep?.status !== 'success' || !workspaceFolder || surfaces.length === 0) {
			step.status = surfaces.length === 0 ? 'pending' : 'warning';
			step.detail = surfaces.length === 0
				? localize('surfaceFeatureChecklist.surfaceScaffolds.waitSurfaces', 'Create a surface first.')
				: localize('surfaceFeatureChecklist.surfaceScaffolds.none', 'No app scaffolds found yet.');
			return;
		}

		let scaffolded = 0;
		for (const surface of surfaces) {
			const appPath = surface.path ?? `apps/${surface.id}`;
			if (await this.fileService.exists(joinPath(workspaceFolder, appPath, 'package.json'))) {
				scaffolded++;
			}
		}
		if (scaffolded === surfaces.length) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.surfaceScaffolds.all', 'All {0} surface(s) have app scaffolds.', String(surfaces.length));
			return;
		}
		if (scaffolded > 0) {
			step.status = 'warning';
			step.detail = localize('surfaceFeatureChecklist.surfaceScaffolds.partial', '{0}/{1} surfaces have app scaffolds.', String(scaffolded), String(surfaces.length));
			return;
		}
		step.status = 'error';
		step.detail = localize('surfaceFeatureChecklist.surfaceScaffolds.missing', 'No surface app folders found under apps/.');
	}

	private probeBlueprintVerifier(): void {
		const step = this.findCheck('blueprint-verifier')!;
		step.status = 'success';
		step.detail = localize('surfaceFeatureChecklist.blueprintVerifier.ready', 'verifySurfaceBlueprint is available.');
	}

	private probeVerifyAiTool(): void {
		const step = this.findCheck('verify-ai-tool')!;
		const registered = [...this.toolsService.getTools(undefined)].some(tool => tool.id === CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_ID);
		if (registered) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.verifyAiTool.ready', 'Tool {0} is registered.', CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_ID);
			return;
		}
		step.status = 'error';
		step.detail = localize('surfaceFeatureChecklist.verifyAiTool.missing', 'Custom AI verifySurfaceBlueprint tool is not registered.');
	}

	private probeIxBackedVerify(): void {
		const step = this.findCheck('ix-backed-verify')!;
		const ixState = this.ixIntegrationService.getState();
		if (ixState.phase === 'watching' || ixState.phase === 'mapping') {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.ixBackedVerify.active', 'Ix pipeline is active ({0}).', ixState.phase);
			return;
		}
		if (ixState.phase === 'installing' || ixState.phase === 'docker') {
			step.status = 'running';
			step.detail = localize('surfaceFeatureChecklist.ixBackedVerify.starting', 'Ix pipeline is starting ({0})…', ixState.phase);
			return;
		}
		if (ixState.phase === 'error') {
			step.status = 'warning';
			step.detail = ixState.lastError ?? localize('surfaceFeatureChecklist.ixBackedVerify.error', 'Ix pipeline reported an error.');
			return;
		}
		step.status = 'warning';
		step.detail = localize('surfaceFeatureChecklist.ixBackedVerify.idle', 'Ix is idle — verification can still run without discovery matches.');
	}

	private async probeVerifiedSurfaces(): Promise<void> {
		const step = this.findCheck('verified-surfaces')!;
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		const surfaces = this.consoleService.getSurfaces();
		if (!workspaceFolder || surfaces.length === 0) {
			step.status = 'pending';
			step.detail = localize('surfaceFeatureChecklist.verifiedSurfaces.waitSurfaces', 'Create and scaffold a surface first.');
			return;
		}

		let verified = 0;
		let failed = 0;
		for (const surface of surfaces) {
			const blueprint = await readBlueprint(this.fileService, blueprintResource(workspaceFolder, surface.id));
			if (blueprint?.status === 'verified') {
				verified++;
			} else if (blueprint?.status === 'failed') {
				failed++;
			}
		}

		if (verified === surfaces.length) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.verifiedSurfaces.all', 'All {0} surface(s) are verified.', String(surfaces.length));
			return;
		}
		if (verified > 0) {
			step.status = 'warning';
			step.detail = localize('surfaceFeatureChecklist.verifiedSurfaces.partial', '{0}/{1} surfaces verified.', String(verified), String(surfaces.length));
			return;
		}
		if (failed > 0) {
			step.status = 'error';
			step.detail = localize('surfaceFeatureChecklist.verifiedSurfaces.failed', '{0} surface(s) failed verification.', String(failed));
			return;
		}
		step.status = 'warning';
		step.detail = localize('surfaceFeatureChecklist.verifiedSurfaces.none', 'No surfaces have passed verification yet.');
	}

	private probeAgentBlueprintPrompt(): void {
		const step = this.findCheck('agent-blueprint-prompt')!;
		const mentionsBlueprint = CUSTOM_AI_PRODUCT_SYSTEM_PROMPT.includes('.agent/surfaces/');
		const mentionsVerify = CUSTOM_AI_PRODUCT_SYSTEM_PROMPT.includes('verifySurfaceBlueprint');
		if (mentionsBlueprint && mentionsVerify) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.agentPrompt.ready', 'System prompt references blueprint files and verifySurfaceBlueprint.');
			return;
		}
		step.status = 'error';
		step.detail = localize('surfaceFeatureChecklist.agentPrompt.missing', 'Custom AI product prompt is missing blueprint workflow guidance.');
	}

	private probeSurfaceHandoff(): void {
		const step = this.findCheck('surface-handoff')!;
		const handoff = SurfaceBuilderHandoffState.getActive();
		if (handoff) {
			step.status = handoff.phase === 'verify' ? 'success' : 'running';
			step.detail = localize(
				'surfaceFeatureChecklist.surfaceHandoff.active',
				'Active handoff for {0} ({1} phase).',
				handoff.surfaceName,
				handoff.phase,
			);
			return;
		}
		step.status = 'warning';
		step.detail = localize('surfaceFeatureChecklist.surfaceHandoff.idle', 'No active surface handoff. Click a starter card to begin.');
	}

	private probeAutoRepairHandoff(): void {
		const step = this.findCheck('auto-repair-handoff')!;
		if (SurfaceBlueprintOrchestrator.hasRepairHandlers()) {
			step.status = 'success';
			step.detail = localize('surfaceFeatureChecklist.autoRepair.ready', 'Repair handlers are wired to Console chat.');
			return;
		}
		step.status = 'error';
		step.detail = localize('surfaceFeatureChecklist.autoRepair.missing', 'Auto-repair handlers are not registered.');
	}

	private findCheck(id: string): CheckMutable | undefined {
		return this.checks.find(check => check.id === id);
	}

	private snapshot(): SurfaceFeatureChecklistState {
		const items: SurfaceFeatureCheckItem[] = this.checks.map(check => ({
			id: check.id,
			category: check.category,
			label: check.label,
			description: check.description,
			status: check.status,
			detail: check.detail,
		}));
		const readyCount = items.filter(item => item.status === 'success' || item.status === 'skipped').length;
		return {
			items,
			actions: this.collectWorkflowActions(),
			readyCount,
			totalCount: items.length,
			isRefreshing: this.isRefreshing,
		};
	}

	private collectWorkflowActions(): readonly SurfaceWorkflowActionItem[] {
		const surfaces = this.consoleService.getSurfaces();
		const knownSurfaces = new Set(surfaces.map(surface => surface.id));
		return this.workflowCatalogService.listWorkflows()
			.filter(workflow => workflow.scope === 'surface' && knownSurfaces.has(workflow.surfaceId))
			.flatMap(workflow => workflow.steps
				.filter(step => step.type !== 'ensureServer')
				.map(step => ({
					workflowId: workflow.id,
					surfaceId: workflow.surfaceId,
					workflowLabel: workflow.label,
					stepId: step.id,
					stepLabel: step.target?.text ?? step.target?.ariaLabel ?? step.route ?? step.id,
				})));
	}

	private fireState(): void {
		this._onDidChangeState.fire(this.snapshot());
	}
}

registerSingleton(ISurfaceFeatureChecklistService, SurfaceFeatureChecklistService, InstantiationType.Delayed);

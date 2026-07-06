/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { createBlueprintFromTemplateId } from './surfaceBlueprintService.js';
import { scaffoldSurfaceFromBlueprint, type ScaffoldSurfaceFromBlueprintResult } from './surfaceBlueprintScaffold.js';
import { type SurfaceBlueprintVerificationResult, type SurfaceBlueprint } from './surfaceBlueprintTypes.js';
import { listSurfaceTemplateIds } from './surfaceBlueprintTemplateRegistry.js';
import { verifySurfaceBlueprint } from './surfaceBlueprintVerify.js';

export const MAX_LANGGRAPH_SURFACE_REPAIR_RETRIES = 2;

export interface SurfaceCreationLangGraphTraceEvent {
	(type: string, payload?: Record<string, unknown>): void;
}

interface SurfaceCreationServices {
	createBlueprintFromTemplateId: typeof createBlueprintFromTemplateId;
	scaffoldSurfaceFromBlueprint: typeof scaffoldSurfaceFromBlueprint;
	verifySurfaceBlueprint: typeof verifySurfaceBlueprint;
	repairSurface: (input: {
		readonly fileService: IFileService;
		readonly workspaceFolder: URI;
		readonly blueprint: SurfaceBlueprint;
		readonly lastVerification: SurfaceBlueprintVerificationResult;
		readonly attempt: number;
	}) => Promise<ScaffoldSurfaceFromBlueprintResult>;
}

export interface SurfaceCreationLangGraphOrchestratorOptions {
	readonly fileService: IFileService;
	readonly workspaceFolder: URI;
	readonly traceEvent?: SurfaceCreationLangGraphTraceEvent;
	readonly maxRepairRetries?: number;
	readonly services?: Partial<SurfaceCreationServices>;
}

export interface SurfaceCreationLangGraphResult {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly businessGoal: string;
	readonly templateId: string;
	readonly blueprint: SurfaceBlueprint;
	readonly blueprintResource: URI;
	readonly scaffoldResult: ScaffoldSurfaceFromBlueprintResult;
	readonly verification: SurfaceBlueprintVerificationResult;
	readonly repairAttempts: number;
	readonly passed: boolean;
}

interface SurfaceCreationGraphStateValue {
	readonly surfaceId: string;
	readonly businessGoal: string;
	readonly templateId: string;
	readonly surfaceName: string;
	readonly blueprint?: SurfaceBlueprint;
	readonly blueprintResource?: URI;
	readonly scaffoldResult?: ScaffoldSurfaceFromBlueprintResult;
	readonly verification?: SurfaceBlueprintVerificationResult;
	readonly repairAttempts: number;
	readonly manifestUpdated: boolean;
	readonly sharedArtifactsGenerated: boolean;
}

export class SurfaceCreationLangGraphOrchestrator {
	private readonly maxRepairRetries: number;
	private readonly services: SurfaceCreationServices;

	constructor(private readonly options: SurfaceCreationLangGraphOrchestratorOptions) {
		this.maxRepairRetries = Math.max(0, Math.min(options.maxRepairRetries ?? MAX_LANGGRAPH_SURFACE_REPAIR_RETRIES, 2));
		this.services = {
			createBlueprintFromTemplateId,
			scaffoldSurfaceFromBlueprint,
			verifySurfaceBlueprint,
			repairSurface: async ({ fileService, workspaceFolder, blueprint }) => scaffoldSurfaceFromBlueprint(fileService, workspaceFolder, blueprint),
			...options.services,
		};
	}

	async createSurface(surfaceId: string, businessGoal: string): Promise<SurfaceCreationLangGraphResult> {
		const normalizedSurfaceId = surfaceId.trim();
		const normalizedBusinessGoal = businessGoal.trim();
		if (!normalizedSurfaceId) {
			throw new Error('surfaceId is required');
		}
		const templateId = selectTemplateId(normalizedSurfaceId, normalizedBusinessGoal);
		const surfaceName = titleCaseFromSurfaceId(normalizedSurfaceId);
		const startedAt = Date.now();
		this.trace('surface_creation_langgraph.started', {
			surfaceId: normalizedSurfaceId,
			templateId,
			businessGoal: normalizedBusinessGoal,
			maxRepairRetries: this.maxRepairRetries,
			orchestrator: 'langgraph',
		});
		try {
			const finalState = await this.runWorkflow({
				surfaceId: normalizedSurfaceId,
				businessGoal: normalizedBusinessGoal,
				templateId,
				surfaceName,
				repairAttempts: 0,
				manifestUpdated: false,
				sharedArtifactsGenerated: false,
			});
			const result = this.readFinalResult(finalState);
			this.trace('surface_creation_langgraph.completed', {
				surfaceId: result.surfaceId,
				templateId: result.templateId,
				passed: result.passed,
				repairAttempts: result.repairAttempts,
				gapCount: result.verification.gaps.length,
				elapsedMs: Date.now() - startedAt,
				orchestrator: 'langgraph',
			});
			return result;
		} catch (error: unknown) {
			this.trace('surface_creation_langgraph.failed', {
				surfaceId: normalizedSurfaceId,
				templateId,
				error: String((error as Error)?.message ?? error),
				elapsedMs: Date.now() - startedAt,
				orchestrator: 'langgraph',
			});
			throw error;
		}
	}

	private async runWorkflow(initialState: SurfaceCreationGraphStateValue): Promise<SurfaceCreationGraphStateValue> {
		let state = initialState;
		state = { ...state, ...await this.generateBlueprint(state) };
		state = { ...state, ...await this.scaffoldFiles(state) };
		state = { ...state, ...await this.updateManifest(state) };
		state = { ...state, ...await this.generateSharedArtifacts(state) };
		state = { ...state, ...await this.verifySurface(state, 'initial') };

		if (!state.verification?.passed && this.maxRepairRetries >= 1) {
			state = { ...state, ...await this.repairSurface(state, 1) };
			state = { ...state, ...await this.verifySurface(state, 'after-repair-1') };
		}

		if (!state.verification?.passed && this.maxRepairRetries >= 2) {
			state = { ...state, ...await this.repairSurface(state, 2) };
			state = { ...state, ...await this.verifySurface(state, 'after-repair-2') };
		}

		return state;
	}

	private async generateBlueprint(state: SurfaceCreationGraphStateValue): Promise<Partial<SurfaceCreationGraphStateValue>> {
		const result = await this.services.createBlueprintFromTemplateId(
			this.options.fileService,
			this.options.workspaceFolder,
			state.templateId,
			{
				surfaceId: state.surfaceId,
				surfaceName: state.surfaceName,
			},
		);
		if (!result) {
			throw new Error(`No surface blueprint template found for ${state.templateId}`);
		}
		this.trace('surface_creation_langgraph.node.completed', {
			surfaceId: state.surfaceId,
			node: 'generateBlueprint',
			templateId: state.templateId,
			blueprintResource: result.resource,
		});
		return {
			blueprint: result.blueprint,
			blueprintResource: result.resource,
		};
	}

	private async scaffoldFiles(state: SurfaceCreationGraphStateValue): Promise<Partial<SurfaceCreationGraphStateValue>> {
		const blueprint = requireBlueprint(state);
		const scaffoldResult = await this.services.scaffoldSurfaceFromBlueprint(this.options.fileService, this.options.workspaceFolder, blueprint);
		this.trace('surface_creation_langgraph.node.completed', {
			surfaceId: state.surfaceId,
			node: 'scaffoldFiles',
			createdFiles: scaffoldResult.createdFiles.length,
		});
		return { scaffoldResult };
	}

	private async updateManifest(state: SurfaceCreationGraphStateValue): Promise<Partial<SurfaceCreationGraphStateValue>> {
		const createdFiles = state.scaffoldResult?.createdFiles ?? [];
		const manifestTouched = createdFiles.includes('workspace.goal.json');
		this.trace('surface_creation_langgraph.node.completed', {
			surfaceId: state.surfaceId,
			node: 'updateManifest',
			manifestTouched,
		});
		return { manifestUpdated: manifestTouched };
	}

	private async generateSharedArtifacts(state: SurfaceCreationGraphStateValue): Promise<Partial<SurfaceCreationGraphStateValue>> {
		const createdFiles = state.scaffoldResult?.createdFiles ?? [];
		const generated = createdFiles.some(path =>
			path.startsWith('packages/domain/')
			|| path.startsWith('packages/events/')
			|| path.startsWith('workflows/')
			|| path.startsWith('.agent/workspace-memory')
		);
		this.trace('surface_creation_langgraph.node.completed', {
			surfaceId: state.surfaceId,
			node: 'generateSharedArtifacts',
			generated,
		});
		return { sharedArtifactsGenerated: generated };
	}

	private async verifySurface(
		state: SurfaceCreationGraphStateValue,
		phase: 'initial' | 'after-repair-1' | 'after-repair-2',
	): Promise<Partial<SurfaceCreationGraphStateValue>> {
		if (phase !== 'initial' && state.verification?.passed) {
			return {};
		}
		const verification = await this.services.verifySurfaceBlueprint({
			fileService: this.options.fileService,
			workspaceFolder: this.options.workspaceFolder,
			surfaceId: state.surfaceId,
			persistStatus: true,
		});
		this.trace('surface_creation_langgraph.node.completed', {
			surfaceId: state.surfaceId,
			node: 'verifySurfaceBlueprint',
			phase,
			passed: verification.passed,
			gapCount: verification.gaps.length,
		});
		return { verification };
	}

	private async repairSurface(state: SurfaceCreationGraphStateValue, attempt: number): Promise<Partial<SurfaceCreationGraphStateValue>> {
		if (attempt > this.maxRepairRetries || state.verification?.passed) {
			return {};
		}
		const blueprint = requireBlueprint(state);
		const verification = state.verification;
		if (!verification) {
			return {};
		}
		const scaffoldResult = await this.services.repairSurface({
			fileService: this.options.fileService,
			workspaceFolder: this.options.workspaceFolder,
			blueprint,
			lastVerification: verification,
			attempt,
		});
		this.trace('surface_creation_langgraph.repair.attempted', {
			surfaceId: state.surfaceId,
			attempt,
			gapCount: verification.gaps.length,
			createdFiles: scaffoldResult.createdFiles.length,
		});
		return {
			repairAttempts: attempt,
			scaffoldResult,
		};
	}

	private readFinalResult(state: SurfaceCreationGraphStateValue): SurfaceCreationLangGraphResult {
		const blueprint = requireBlueprint(state);
		const blueprintResource = state.blueprintResource;
		if (!blueprintResource) {
			throw new Error('Surface blueprint resource is missing after workflow execution.');
		}
		const scaffoldResult = state.scaffoldResult;
		if (!scaffoldResult) {
			throw new Error('Surface scaffold result is missing after workflow execution.');
		}
		const verification = state.verification;
		if (!verification) {
			throw new Error('Surface verification result is missing after workflow execution.');
		}
		return {
			surfaceId: state.surfaceId,
			surfaceName: state.surfaceName,
			businessGoal: state.businessGoal,
			templateId: state.templateId,
			blueprint,
			blueprintResource,
			scaffoldResult,
			verification,
			repairAttempts: state.repairAttempts ?? 0,
			passed: verification.passed,
		};
	}

	private trace(type: string, payload?: Record<string, unknown>): void {
		this.options.traceEvent?.(type, payload);
	}
}

function requireBlueprint(state: SurfaceCreationGraphStateValue): SurfaceBlueprint {
	if (!state.blueprint) {
		throw new Error('Surface blueprint is missing before scaffold/repair execution.');
	}
	return state.blueprint;
}

function selectTemplateId(surfaceId: string, businessGoal: string): string {
	const knownTemplates = listSurfaceTemplateIds();
	if (knownTemplates.includes(surfaceId as (typeof knownTemplates)[number])) {
		return surfaceId;
	}
	const goal = businessGoal.toLowerCase();
	if (goal.includes('booking') || goal.includes('schedule') || goal.includes('checkout')) {
		return 'booking';
	}
	if (goal.includes('marketing') || goal.includes('lead') || goal.includes('campaign')) {
		return 'marketing';
	}
	if (goal.includes('client') || goal.includes('portal') || goal.includes('progress')) {
		return 'client-portal';
	}
	if (goal.includes('trainer') || goal.includes('coach') || goal.includes('roster')) {
		return 'trainer-admin';
	}
	if (goal.includes('analytics') || goal.includes('funnel') || goal.includes('metric')) {
		return 'analytics';
	}
	return 'custom';
}

function titleCaseFromSurfaceId(surfaceId: string): string {
	return surfaceId
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map(token => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
		.join(' ') || 'Surface';
}

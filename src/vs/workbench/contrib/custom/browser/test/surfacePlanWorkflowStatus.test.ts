/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	DEPLOYED_STEP_ID,
	ENABLE_PREVIEW_STEP_ID,
	VERIFY_GRAPH_STEP_ID,
	buildSurfacePlanWorkflowSteps,
	inferSurfacePlanWorkflowStage,
	isSurfaceDeployedWired,
	isSurfacePlanLocked,
	isSurfacePreviewWired,
	markSurfacePlanLocked,
	resolveSurfacePlanWorkflowStatus,
	resolvePreferredCompleteSurfaceSectionId,
	resolveSurfaceSectionIdForStep,
	shouldPreferPreviewSurfaceSection,
	shouldPromoteCompleteSurfaceSectionOnTransition,
	summarizeSurfacePlanWorkflowProgress,
} from '../../../../../../custom/goalWorkspace/surfacePlanWorkflowStatus.js';
import {
	completedStepIdsFromWorkflow,
	mergeWorkflowSteps,
	parseSurfacePlanWorkflowDocument,
	serializeSurfacePlanWorkflowDocument,
	surfacePlanWorkflowResource,
} from '../../../../../../custom/goalWorkspace/surfacePlanWorkflow.js';
import { URI } from '../../../../../base/common/uri.js';

suite('surfacePlanWorkflowStatus', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('starts at intent with no artifacts', () => {
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: false,
			hasCandidates: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
		}), 'intent');
	});

	test('moves to research_survey when provisional plan exists', () => {
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasCandidates: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
		}), 'research_survey');
	});

	test('awaits repo selection when candidates await confirmation', () => {
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'awaiting_selection',
			hasDraftProposal: false,
			hasFinalProposal: false,
		}), 'awaiting_repo_selection');
	});

	test('maps confirmed/done/draft to research_map', () => {
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'confirmed',
			hasDraftProposal: false,
			hasFinalProposal: false,
		}), 'research_map');
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'done',
			hasDraftProposal: true,
			hasFinalProposal: false,
		}), 'research_map');
	});

	test('research_map exposes Continue research next action', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'done',
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		assert.strictEqual(status.stageId, 'research_map');
		assert.deepStrictEqual(status.nextAction, {
			id: 'continue_research',
			label: 'Continue research',
			stepId: 'research_map',
		});
	});

	test('research_survey exposes Continue survey next action', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasCandidates: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		assert.strictEqual(status.stageId, 'research_survey');
		assert.deepStrictEqual(status.nextAction, {
			id: 'continue_research',
			label: 'Continue survey',
			stepId: 'research_survey',
		});
	});

	test('plan_ready when final proposal and plan exist', () => {
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'done',
			hasDraftProposal: true,
			hasFinalProposal: true,
		}), 'plan_ready');
	});

	test('plan_locked / building after lock', () => {
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
		}), 'plan_locked');
		assert.strictEqual(inferSurfacePlanWorkflowStage({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan'],
		}), 'building');
	});

	test('resolveSurfacePlanWorkflowStatus fills previous current next and action', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'awaiting_selection',
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		assert.strictEqual(status.stageId, 'awaiting_repo_selection');
		assert.strictEqual(status.previous, 'Claude surveying reference repos');
		assert.strictEqual(status.current, 'Select research context repos');
		assert.strictEqual(status.next, 'Confirm repos');
		assert.deepStrictEqual(status.nextAction, {
			id: 'confirm_repos',
			label: 'Confirm repos',
			stepId: 'awaiting_repo_selection',
		});
	});

	test('plan_ready next action locks and builds', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'done',
			hasDraftProposal: true,
			hasFinalProposal: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Phase 1 — Scaffold + shell' },
				{ id: 'phase-2', title: 'Phase 2 — Chat core' },
			],
		});
		assert.strictEqual(status.stageId, 'plan_ready');
		assert.strictEqual(status.nextAction?.id, 'lock_plan');
		assert.strictEqual(status.next, 'Lock & build');
		const stepIds = status.steps.map(step => step.id);
		assert.ok(stepIds.includes('lock_plan'));
		assert.ok(stepIds.includes('phase-1'));
		assert.ok(stepIds.includes('phase-2'));
		assert.ok(stepIds.includes(VERIFY_GRAPH_STEP_ID));
		assert.ok(stepIds.includes(ENABLE_PREVIEW_STEP_ID));
		assert.ok(stepIds.includes(DEPLOYED_STEP_ID));
		assert.ok(stepIds.indexOf(VERIFY_GRAPH_STEP_ID) < stepIds.indexOf(ENABLE_PREVIEW_STEP_ID));
		assert.ok(stepIds.indexOf(ENABLE_PREVIEW_STEP_ID) < stepIds.indexOf(DEPLOYED_STEP_ID));
	});

	test('building next action is first pending phase', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Phase 1 — Scaffold + shell' },
				{ id: 'phase-2', title: 'Phase 2 — Chat core' },
			],
			completedStepIds: ['lock_plan'],
		});
		assert.strictEqual(status.stageId, 'building');
		assert.deepStrictEqual(status.nextAction, {
			id: 'run_next_phase',
			label: 'Phase 1 — Scaffold + shell',
			stepId: 'phase-1',
		});
	});

	test('building advances to Code Graph after all phases, before Enable Preview', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Phase 1 — Scaffold + shell' },
				{ id: 'phase-2', title: 'Phase 2 — Chat core' },
			],
			completedStepIds: ['lock_plan', 'phase-1', 'phase-2'],
		});
		assert.strictEqual(status.stageId, 'building');
		assert.strictEqual(status.steps.find(step => step.id === VERIFY_GRAPH_STEP_ID)?.status, 'current');
		assert.strictEqual(status.steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID)?.status, 'pending');
		assert.deepStrictEqual(status.nextAction, {
			id: 'run_next_phase',
			label: 'Code Graph',
			stepId: VERIFY_GRAPH_STEP_ID,
		});
	});

	test('building advances to Enable Preview after Code Graph', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Phase 1 — Scaffold + shell' },
				{ id: 'phase-2', title: 'Phase 2 — Chat core' },
			],
			completedStepIds: ['lock_plan', 'phase-1', 'phase-2', VERIFY_GRAPH_STEP_ID],
		});
		assert.strictEqual(status.stageId, 'building');
		assert.strictEqual(status.steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID)?.status, 'current');
		assert.deepStrictEqual(status.nextAction, {
			id: 'run_next_phase',
			label: 'Enable Preview',
			stepId: ENABLE_PREVIEW_STEP_ID,
		});
	});

	test('wired preview does not mark Enable Preview DONE ahead of pending phases or Code Graph', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Scaffold + deploy skeleton' },
				{ id: 'phase-2', title: 'Streaming chat core' },
				{ id: 'phase-3', title: 'Knowledge base + escalation' },
			],
			completedStepIds: ['lock_plan', 'phase-1'],
			previewEnabled: true,
		});
		assert.strictEqual(status.stageId, 'building');
		assert.strictEqual(status.steps.find(step => step.id === 'phase-2')?.status, 'current');
		assert.strictEqual(status.steps.find(step => step.id === VERIFY_GRAPH_STEP_ID)?.status, 'pending');
		assert.strictEqual(status.steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID)?.status, 'pending');
		assert.deepStrictEqual(status.nextAction, {
			id: 'run_next_phase',
			label: 'Streaming chat core',
			stepId: 'phase-2',
		});

		const afterPhases = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Scaffold + deploy skeleton' },
				{ id: 'phase-2', title: 'Streaming chat core' },
				{ id: 'phase-3', title: 'Knowledge base + escalation' },
			],
			completedStepIds: ['lock_plan', 'phase-1', 'phase-2', 'phase-3'],
			previewEnabled: true,
		});
		assert.strictEqual(afterPhases.steps.find(step => step.id === VERIFY_GRAPH_STEP_ID)?.status, 'current');
		assert.strictEqual(afterPhases.steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID)?.status, 'pending');
	});

	test('complete requires Code Graph, Enable Preview, then Deployed', () => {
		const incomplete = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1'],
		});
		assert.strictEqual(incomplete.stageId, 'building');

		const awaitingDeploy = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID, ENABLE_PREVIEW_STEP_ID],
		});
		assert.strictEqual(awaitingDeploy.stageId, 'building');
		assert.strictEqual(awaitingDeploy.steps.find(step => step.id === DEPLOYED_STEP_ID)?.status, 'current');
		assert.deepStrictEqual(awaitingDeploy.nextAction, {
			id: 'run_next_phase',
			label: 'Deployed',
			stepId: DEPLOYED_STEP_ID,
		});

		const viaStep = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID, ENABLE_PREVIEW_STEP_ID, DEPLOYED_STEP_ID],
		});
		assert.strictEqual(viaStep.stageId, 'complete');

		const viaManifest = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID],
			previewEnabled: true,
			deployedEnabled: true,
		});
		assert.strictEqual(viaManifest.stageId, 'complete');
		assert.strictEqual(viaManifest.steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID)?.status, 'completed');
		assert.strictEqual(viaManifest.steps.find(step => step.id === DEPLOYED_STEP_ID)?.status, 'completed');
	});

	test('open blockers appear after Enable Preview, before Deployed, and block complete', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID, ENABLE_PREVIEW_STEP_ID],
			previewEnabled: true,
			openBlockers: [{
				id: 'blocker:env:ANTHROPIC_API_KEY',
				label: 'Set ANTHROPIC_API_KEY in .env.local',
			}],
		});
		assert.strictEqual(status.stageId, 'building');
		assert.strictEqual(status.steps.find(step => step.id === 'blocker:env:ANTHROPIC_API_KEY')?.status, 'current');
		assert.strictEqual(status.steps.find(step => step.id === DEPLOYED_STEP_ID)?.status, 'pending');
		assert.deepStrictEqual(status.nextAction, {
			id: 'run_next_phase',
			label: 'Set ANTHROPIC_API_KEY in .env.local',
			stepId: 'blocker:env:ANTHROPIC_API_KEY',
		});

		const cleared = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID, ENABLE_PREVIEW_STEP_ID],
			previewEnabled: true,
			openBlockers: [],
		});
		assert.strictEqual(cleared.stageId, 'building');
		assert.strictEqual(cleared.steps.find(step => step.id === DEPLOYED_STEP_ID)?.status, 'current');
	});

	test('isSurfacePreviewWired requires both localUrl and devCommand', () => {
		assert.strictEqual(isSurfacePreviewWired(undefined), false);
		assert.strictEqual(isSurfacePreviewWired({ localUrl: 'http://localhost:3001' }), false);
		assert.strictEqual(isSurfacePreviewWired({
			localUrl: 'http://localhost:3001',
			devCommand: 'npm run dev --prefix apps/bot -- --port 3001',
		}), true);
	});

	test('isSurfaceDeployedWired requires productionUrl', () => {
		assert.strictEqual(isSurfaceDeployedWired(undefined), false);
		assert.strictEqual(isSurfaceDeployedWired({ productionUrl: '   ' }), false);
		assert.strictEqual(isSurfaceDeployedWired({
			productionUrl: 'https://cadre-bot.vercel.app',
		}), true);
	});

	test('building suppresses Next while a phase is in flight', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Phase 1 — Scaffold + shell' },
				{ id: 'phase-2', title: 'Phase 2 — Chat core' },
			],
			completedStepIds: ['lock_plan'],
			phaseInFlightStepId: 'phase-1',
		});
		assert.strictEqual(status.stageId, 'building');
		assert.strictEqual(status.nextAction, undefined);
	});

	test('building failed phase exposes Retry for the same step', () => {
		const status = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [
				{ id: 'phase-1', title: 'Phase 1 — Scaffold + shell' },
				{ id: 'phase-2', title: 'Phase 2 — Chat core' },
			],
			completedStepIds: ['lock_plan'],
			failedPhaseStepId: 'phase-1',
		});
		assert.deepStrictEqual(status.nextAction, {
			id: 'run_next_phase',
			label: 'Phase 1 — Scaffold + shell',
			stepId: 'phase-1',
		});
	});

	test('isSurfacePlanLocked and markSurfacePlanLocked', () => {
		const unlocked = '## §0 Plan lock\n- [ ] Locked\n\n## Intent\nBuild it.\n';
		assert.strictEqual(isSurfacePlanLocked(unlocked), false);
		const locked = markSurfacePlanLocked(unlocked);
		assert.strictEqual(isSurfacePlanLocked(locked), true);
		assert.ok(locked.includes('- [x] Locked'));
		assert.strictEqual(markSurfacePlanLocked(locked), locked);
	});

	test('confirm_surface gates the flow until the surface is in the manifest', () => {
		const unconfirmed = resolveSurfacePlanWorkflowStatus({
			surfaceConfirmed: false,
			hasPlanContent: false,
			hasCandidates: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		const confirmed = resolveSurfacePlanWorkflowStatus({
			surfaceConfirmed: true,
			hasPlanContent: false,
			hasCandidates: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		assert.deepStrictEqual({
			unconfirmedStage: unconfirmed.stageId,
			unconfirmedStep: unconfirmed.steps.find(step => step.id === 'confirm_surface')?.status,
			unconfirmedAction: unconfirmed.nextAction,
			confirmedStage: confirmed.stageId,
			confirmedStep: confirmed.steps.find(step => step.id === 'confirm_surface')?.status,
		}, {
			unconfirmedStage: 'confirm_surface',
			unconfirmedStep: 'current',
			unconfirmedAction: undefined,
			confirmedStage: 'intent',
			confirmedStep: 'completed',
		});
	});

	test('buildSurfacePlanWorkflowSteps marks prior stages completed', () => {
		const steps = buildSurfacePlanWorkflowSteps({
			hasPlanContent: true,
			hasCandidates: true,
			candidatesStatus: 'awaiting_selection',
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		assert.strictEqual(steps.find(step => step.id === 'intent')?.status, 'completed');
		assert.strictEqual(steps.find(step => step.id === 'awaiting_repo_selection')?.status, 'current');
		assert.strictEqual(steps.find(step => step.id === 'lock_plan')?.status, 'pending');
	});
});

suite('resolveSurfaceSectionIdForStep', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const sections = ['rules', 'plan', 'context', 'description', 'proposed', 'graph', 'phases', 'workstreams', 'preview', 'deployed'] as const;

	test('maps planning stages to description / proposed / plan / context', () => {
		assert.strictEqual(resolveSurfaceSectionIdForStep({ id: 'lock_plan', kind: 'action' }, sections), 'proposed');
		assert.strictEqual(resolveSurfaceSectionIdForStep({ id: 'intent', kind: 'stage' }, sections), 'description');
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'confirm_surface', kind: 'stage' }, sections),
			'description',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'intent', kind: 'stage' }, ['proposed', 'plan']),
			'proposed',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'awaiting_repo_selection', kind: 'stage' }, sections),
			'context',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'research_map', kind: 'stage' }, sections),
			'context',
		);
	});

	test('maps generate phases / workstreams to Build phases card', () => {
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'phase-streaming', kind: 'phase' }, sections),
			'phases',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'phase-generate', kind: 'action' }, sections),
			'phases',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'ws-16', kind: 'action' }, sections),
			'phases',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'phase-streaming', kind: 'phase' }, ['plan']),
			'plan',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'phase-streaming', kind: 'phase' }, ['workstreams', 'proposed']),
			'workstreams',
		);
	});

	test('maps verify_graph to graph, enable_preview to preview, deployed to deployed card', () => {
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: VERIFY_GRAPH_STEP_ID, kind: 'action' }, sections),
			'graph',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: ENABLE_PREVIEW_STEP_ID, kind: 'action' }, sections),
			'preview',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: DEPLOYED_STEP_ID, kind: 'action' }, sections),
			'deployed',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: DEPLOYED_STEP_ID, kind: 'action' }, ['preview', 'plan']),
			'preview',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'blocker:missing-env', kind: 'blocker' }, sections),
			'preview',
		);
	});

	test('summarizeSurfacePlanWorkflowProgress reports completion and in-flight labels', () => {
		const early = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: false,
			hasCandidates: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
		});
		const earlyProgress = summarizeSurfacePlanWorkflowProgress(early);
		assert.ok(earlyProgress.total > 0);
		assert.strictEqual(earlyProgress.complete, false);
		assert.strictEqual(earlyProgress.label, 'Start planning');

		const building = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasCandidates: true,
			hasDraftProposal: true,
			hasFinalProposal: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan'],
			phaseInFlightStepId: 'phase-1',
		});
		const running = summarizeSurfacePlanWorkflowProgress(building, { inProgressLabel: 'Phase 1' });
		assert.strictEqual(running.inProgress, true);
		assert.strictEqual(running.label, 'Phase 1');
		assert.ok(running.percent < 100);

		const done = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasCandidates: true,
			hasDraftProposal: true,
			hasFinalProposal: true,
			planLocked: true,
			previewEnabled: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID, ENABLE_PREVIEW_STEP_ID, DEPLOYED_STEP_ID],
			deployedEnabled: true,
		});
		const complete = summarizeSurfacePlanWorkflowProgress(done);
		assert.strictEqual(complete.complete, true);
		assert.strictEqual(complete.percent, 100);
		assert.strictEqual(complete.label, 'Complete');
		assert.strictEqual(shouldPreferPreviewSurfaceSection(complete), true);
		assert.strictEqual(shouldPreferPreviewSurfaceSection(running), false);
		assert.strictEqual(shouldPreferPreviewSurfaceSection(earlyProgress), false);
		assert.strictEqual(shouldPreferPreviewSurfaceSection({
			complete: true,
			percent: 100,
			inProgress: true,
		}), false);
		assert.strictEqual(resolvePreferredCompleteSurfaceSectionId({
			progress: complete,
			availableSectionIds: ['preview', 'deployed', 'plan'],
			deployedWired: true,
		}), 'deployed');
		assert.strictEqual(resolvePreferredCompleteSurfaceSectionId({
			progress: complete,
			availableSectionIds: ['preview', 'deployed', 'plan'],
			deployedWired: false,
		}), 'preview');
		assert.strictEqual(resolvePreferredCompleteSurfaceSectionId({
			progress: complete,
			availableSectionIds: ['deployed', 'plan'],
			deployedWired: true,
		}), 'deployed');
		assert.strictEqual(resolvePreferredCompleteSurfaceSectionId({
			progress: running,
			availableSectionIds: ['preview', 'deployed'],
			deployedWired: true,
		}), undefined);
		assert.strictEqual(shouldPromoteCompleteSurfaceSectionOnTransition(undefined, true), false);
		assert.strictEqual(shouldPromoteCompleteSurfaceSectionOnTransition(false, true), true);
		assert.strictEqual(shouldPromoteCompleteSurfaceSectionOnTransition(true, true), false);
		assert.strictEqual(shouldPromoteCompleteSurfaceSectionOnTransition(false, false), false);
		assert.strictEqual(shouldPromoteCompleteSurfaceSectionOnTransition(true, false), false);
	});
});

suite('surfacePlanWorkflow', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('workflow resource path', () => {
		assert.ok(surfacePlanWorkflowResource(URI.file('/tmp/ws'), 'cadre-bot').path.endsWith('/.agent/surfaces/cadre-bot.workflow.json'));
	});

	test('round-trip serialize and merge completed ids', () => {
		const resolved = buildSurfacePlanWorkflowSteps({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan'],
		});
		const doc = mergeWorkflowSteps('cadre-bot', resolved);
		const again = parseSurfacePlanWorkflowDocument(serializeSurfacePlanWorkflowDocument(doc), 'cadre-bot')!;
		assert.strictEqual(again.surfaceId, 'cadre-bot');
		assert.ok(completedStepIdsFromWorkflow(again).includes('lock_plan'));
		assert.ok(again.steps.some(step => step.id === 'phase-1'));
	});

	test('mergeWorkflowSteps does not demote completed steps from incomplete signals', () => {
		const existing = mergeWorkflowSteps('cadre-admin-console', resolveSurfacePlanWorkflowStatus({
			surfaceConfirmed: true,
			hasPlanContent: true,
			hasDraftProposal: true,
			hasFinalProposal: true,
			hasCandidates: true,
			planLocked: true,
			previewEnabled: true,
			proposalPhases: [{ id: 'P1', title: 'Phase 1' }],
			completedStepIds: [
				'confirm_surface',
				'intent',
				'research_survey',
				'awaiting_repo_selection',
				'research_map',
				'plan_ready',
				'lock_plan',
				'P1',
				'verify_graph',
				'enable_preview',
				'deployed',
			],
		}).steps);
		assert.strictEqual(
			summarizeSurfacePlanWorkflowProgress(resolveSurfacePlanWorkflowStatus({
				surfaceConfirmed: true,
				hasPlanContent: true,
				hasDraftProposal: true,
				hasFinalProposal: true,
				hasCandidates: true,
				planLocked: true,
				previewEnabled: true,
				proposalPhases: [{ id: 'P1', title: 'Phase 1' }],
				completedStepIds: completedStepIdsFromWorkflow(existing),
			})).percent,
			100,
		);

		// Mid-load empty signals would otherwise rewrite Steps to "Start planning".
		const midLoad = resolveSurfacePlanWorkflowStatus({
			surfaceConfirmed: true,
			hasPlanContent: false,
			hasDraftProposal: false,
			hasFinalProposal: false,
			hasCandidates: false,
			planLocked: false,
			proposalPhases: [],
			completedStepIds: [],
		}).steps;
		const merged = mergeWorkflowSteps('cadre-admin-console', midLoad, existing);
		assert.ok(completedStepIdsFromWorkflow(merged).includes('intent'));
		assert.ok(completedStepIdsFromWorkflow(merged).includes('enable_preview'));
		assert.strictEqual(merged.steps.find(step => step.id === 'intent')?.status, 'completed');
	});
});

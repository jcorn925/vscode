/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	ENABLE_PREVIEW_STEP_ID,
	VERIFY_GRAPH_STEP_ID,
	buildSurfacePlanWorkflowSteps,
	inferSurfacePlanWorkflowStage,
	isSurfacePlanLocked,
	isSurfacePreviewWired,
	markSurfacePlanLocked,
	resolveSurfacePlanWorkflowStatus,
	resolveSurfaceSectionIdForStep,
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
		assert.ok(stepIds.indexOf(VERIFY_GRAPH_STEP_ID) < stepIds.indexOf(ENABLE_PREVIEW_STEP_ID));
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

	test('complete requires Code Graph then Enable Preview (or wired preview after Graph)', () => {
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

		const viaStep = resolveSurfacePlanWorkflowStatus({
			hasPlanContent: true,
			hasFinalProposal: true,
			hasDraftProposal: true,
			hasCandidates: true,
			planLocked: true,
			proposalPhases: [{ id: 'phase-1', title: 'Phase 1' }],
			completedStepIds: ['lock_plan', 'phase-1', VERIFY_GRAPH_STEP_ID, ENABLE_PREVIEW_STEP_ID],
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
		});
		assert.strictEqual(viaManifest.stageId, 'complete');
		assert.strictEqual(viaManifest.steps.find(step => step.id === ENABLE_PREVIEW_STEP_ID)?.status, 'completed');
	});

	test('open blockers appear after Enable Preview and block complete', () => {
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
		assert.strictEqual(cleared.stageId, 'complete');
	});

	test('isSurfacePreviewWired requires both localUrl and devCommand', () => {
		assert.strictEqual(isSurfacePreviewWired(undefined), false);
		assert.strictEqual(isSurfacePreviewWired({ localUrl: 'http://localhost:3001' }), false);
		assert.strictEqual(isSurfacePreviewWired({
			localUrl: 'http://localhost:3001',
			devCommand: 'npm run dev --prefix apps/bot -- --port 3001',
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

	const sections = ['rules', 'plan', 'context', 'graph', 'phases', 'files', 'architecture', 'preview'] as const;

	test('maps planning stages to plan / context', () => {
		assert.strictEqual(resolveSurfaceSectionIdForStep({ id: 'lock_plan', kind: 'action' }, sections), 'plan');
		assert.strictEqual(resolveSurfaceSectionIdForStep({ id: 'intent', kind: 'stage' }, sections), 'plan');
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'awaiting_repo_selection', kind: 'stage' }, sections),
			'context',
		);
	});

	test('maps phases to Graph card with fallbacks', () => {
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'phase-streaming', kind: 'phase' }, sections),
			'graph',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'phase-streaming', kind: 'phase' }, ['files', 'plan']),
			'files',
		);
	});

	test('maps verify_graph to graph and enable_preview/blockers to preview', () => {
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: VERIFY_GRAPH_STEP_ID, kind: 'action' }, sections),
			'graph',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: ENABLE_PREVIEW_STEP_ID, kind: 'action' }, sections),
			'preview',
		);
		assert.strictEqual(
			resolveSurfaceSectionIdForStep({ id: 'blocker:missing-env', kind: 'blocker' }, sections),
			'preview',
		);
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
});

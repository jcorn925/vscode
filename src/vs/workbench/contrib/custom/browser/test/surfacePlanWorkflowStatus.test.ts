/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildSurfacePlanWorkflowSteps,
	inferSurfacePlanWorkflowStage,
	isSurfacePlanLocked,
	markSurfacePlanLocked,
	resolveSurfacePlanWorkflowStatus,
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

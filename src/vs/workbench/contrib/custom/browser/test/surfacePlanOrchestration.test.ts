/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildClaudeDispatchNotification,
	buildSurfacePlanOrchestrationPrompt,
	DISPATCH_CLAUDE_PREFIX,
	parseDispatchClaudeMarker,
	shouldExecuteClaudeAfterOrchestration,
	shouldOrchestratePlanAction,
} from '../../../../../../custom/goalWorkspace/surfacePlanOrchestration.js';

suite('surfacePlanOrchestration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shouldOrchestratePlanAction covers Plan Steps hybrid actions', () => {
		assert.strictEqual(shouldOrchestratePlanAction('start_planning'), true);
		assert.strictEqual(shouldOrchestratePlanAction('lock_plan'), true);
		assert.strictEqual(shouldOrchestratePlanAction('run_next_phase'), true);
		assert.strictEqual(shouldOrchestratePlanAction('confirm_repos'), false);
	});

	test('parseDispatchClaudeMarker reads last valid line', () => {
		const text = [
			'Claude will implement the knowledge phase next.',
			'',
			`${DISPATCH_CLAUDE_PREFIX} run_next_phase:phase-knowledge`,
		].join('\n');
		assert.deepStrictEqual(parseDispatchClaudeMarker(text), {
			actionId: 'run_next_phase',
			targetId: 'phase-knowledge',
		});
	});

	test('parseDispatchClaudeMarker prefers the last marker when multiple exist', () => {
		const text = [
			`${DISPATCH_CLAUDE_PREFIX} lock_plan:lock_plan`,
			'updating…',
			`${DISPATCH_CLAUDE_PREFIX} run_next_phase:enable_preview`,
		].join('\n');
		assert.deepStrictEqual(parseDispatchClaudeMarker(text), {
			actionId: 'run_next_phase',
			targetId: 'enable_preview',
		});
	});

	test('parseDispatchClaudeMarker returns undefined for missing or malformed markers', () => {
		assert.strictEqual(parseDispatchClaudeMarker(undefined), undefined);
		assert.strictEqual(parseDispatchClaudeMarker(''), undefined);
		assert.strictEqual(parseDispatchClaudeMarker('Ready to proceed.'), undefined);
		assert.strictEqual(parseDispatchClaudeMarker('DISPATCH_CLAUDE: bogus:x'), undefined);
		assert.strictEqual(parseDispatchClaudeMarker('DISPATCH_CLAUDE: run_next_phase'), undefined);
	});

	test('shouldExecuteClaudeAfterOrchestration falls back when marker missing', () => {
		assert.strictEqual(shouldExecuteClaudeAfterOrchestration('run_next_phase', undefined), true);
		assert.strictEqual(
			shouldExecuteClaudeAfterOrchestration('run_next_phase', {
				actionId: 'run_next_phase',
				targetId: 'phase-a',
			}),
			true,
		);
		assert.strictEqual(
			shouldExecuteClaudeAfterOrchestration('lock_plan', {
				actionId: 'run_next_phase',
				targetId: 'phase-a',
			}),
			false,
		);
	});

	test('buildSurfacePlanOrchestrationPrompt includes expected DISPATCH line', () => {
		const prompt = buildSurfacePlanOrchestrationPrompt({
			surfaceId: 'cadre-support-bot',
			surfaceName: 'Support Bot',
			actionId: 'run_next_phase',
			stepId: 'phase-knowledge',
			stepLabel: 'Knowledge base',
		});
		assert.ok(prompt.includes('Plan Steps orchestration brief'));
		assert.ok(prompt.includes('cadre-support-bot'));
		assert.ok(prompt.includes(`${DISPATCH_CLAUDE_PREFIX} run_next_phase:phase-knowledge`));
		assert.ok(prompt.includes('Do not edit `.workflow.json`'));
	});

	test('buildClaudeDispatchNotification distinguishes fallback', () => {
		assert.ok(buildClaudeDispatchNotification('Knowledge', false).includes('dispatched'));
		assert.ok(buildClaudeDispatchNotification('Knowledge', true).includes('skipped'));
	});

	test('buildClaudeDispatchNotification uses Claude-direct copy', () => {
		assert.strictEqual(
			buildClaudeDispatchNotification('Knowledge', true, { claudeDirect: true }),
			'Sent step to Claude: Knowledge',
		);
		assert.strictEqual(
			buildClaudeDispatchNotification('Knowledge', false, { claudeDirect: true }),
			'Sent step to Claude: Knowledge',
		);
	});
});

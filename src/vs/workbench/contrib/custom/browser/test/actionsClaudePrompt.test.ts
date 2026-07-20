/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { WorkflowRunResult } from '../../../../../../custom/goalWorkspace/workflowCatalogTypes.js';
import {
	formatActionsCommonErrorPrompt,
	formatActionsCommonOutcomePrompt,
	formatActionsWorkflowErrorPrompt,
	formatActionsWorkflowOutcomePrompt,
} from '../actionsClaudePrompt.js';

suite('actionsClaudePrompt', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('formatActionsWorkflowOutcomePrompt failure includes failed steps and asks for a fix', () => {
		const result: WorkflowRunResult = {
			workflowId: 'support-bot-autoplay',
			surfaceId: 'cadre-support-bot',
			ok: false,
			ixChecked: true,
			steps: [
				{ stepId: 'ensure-server', ok: true, detail: 'ok' },
				{ stepId: 'navigate-1', ok: false, detail: 'Timed out waiting for /admin' },
			],
			verificationReport: 'missing-route: /admin',
		};
		const prompt = formatActionsWorkflowOutcomePrompt({
			surfaceName: 'Cadre AI Support Chatbot',
			surfaceId: 'cadre-support-bot',
			workflowId: 'support-bot-autoplay',
			workflowLabel: 'Support bot workflow',
			result,
			focusStepId: 'navigate-1',
		});
		assert.ok(prompt.includes('Cadre AI Support Chatbot'));
		assert.ok(prompt.includes('Outcome: failure'));
		assert.ok(prompt.includes('Focused action step: navigate-1'));
		assert.ok(prompt.includes('- navigate-1: Timed out waiting for /admin'));
		assert.ok(prompt.includes('missing-route: /admin'));
		assert.ok(prompt.includes('Diagnose the failure'));
		assert.ok(!prompt.includes('ensure-server'));
	});

	test('formatActionsWorkflowOutcomePrompt success asks to verify', () => {
		const result: WorkflowRunResult = {
			workflowId: 'support-bot-autoplay',
			surfaceId: 'cadre-support-bot',
			ok: true,
			ixChecked: true,
			steps: [
				{ stepId: 'ensure-server', ok: true, detail: 'ok' },
				{ stepId: 'navigate-1', ok: true, detail: 'ok' },
			],
		};
		const prompt = formatActionsWorkflowOutcomePrompt({
			surfaceName: 'Cadre AI Support Chatbot',
			surfaceId: 'cadre-support-bot',
			workflowId: 'support-bot-autoplay',
			workflowLabel: 'Support bot workflow',
			result,
		});
		assert.ok(prompt.includes('Cadre AI Support Chatbot'));
		assert.ok(prompt.includes('support-bot-autoplay'));
		assert.ok(prompt.includes('Outcome: success'));
		assert.ok(prompt.includes('Steps: ensure-server:ok, navigate-1:ok'));
		assert.ok(prompt.includes('Verify the workflow result'));
		assert.ok(!prompt.includes('Diagnose the failure'));
	});

	test('formatActionsCommonOutcomePrompt success includes action id and verify language', () => {
		const prompt = formatActionsCommonOutcomePrompt({
			actionId: 'publish-to-vercel',
			actionLabel: 'Publish to Vercel',
			ok: true,
			detail: 'Started production Vercel deploy for Cadre Inbound Admin Console.',
			surfaceId: 'cadre-inbound-admin',
			surfaceName: 'Cadre Inbound Admin Console',
		});
		assert.ok(prompt.includes('publish-to-vercel'));
		assert.ok(prompt.includes('Publish to Vercel'));
		assert.ok(prompt.includes('Outcome: success'));
		assert.ok(prompt.includes('Cadre Inbound Admin Console'));
		assert.ok(prompt.includes('Verify the result'));
	});

	test('formatActionsCommonOutcomePrompt failure includes action id and error', () => {
		const prompt = formatActionsCommonOutcomePrompt({
			actionId: 'publish-to-github',
			actionLabel: 'Publish to GitHub',
			ok: false,
			detail: 'Authentication failed',
		});
		assert.ok(prompt.includes('publish-to-github'));
		assert.ok(prompt.includes('Publish to GitHub'));
		assert.ok(prompt.includes('Outcome: failure'));
		assert.ok(prompt.includes('Authentication failed'));
		assert.ok(prompt.includes('Diagnose the failure'));
	});

	test('legacy formatActionsCommonErrorPrompt still includes action id and error', () => {
		const prompt = formatActionsCommonErrorPrompt(
			'publish-to-github',
			'Publish to GitHub',
			'Authentication failed',
		);
		assert.ok(prompt.includes('publish-to-github'));
		assert.ok(prompt.includes('Publish to GitHub'));
		assert.ok(prompt.includes('Authentication failed'));
	});

	test('legacy formatActionsWorkflowErrorPrompt delegates to outcome formatter', () => {
		const result: WorkflowRunResult = {
			workflowId: 'wf',
			surfaceId: 's1',
			ok: false,
			ixChecked: false,
			steps: [{ stepId: 'step-a', ok: false, detail: 'boom' }],
		};
		const prompt = formatActionsWorkflowErrorPrompt({
			surfaceName: 'Surf',
			surfaceId: 's1',
			workflowId: 'wf',
			result,
		});
		assert.ok(prompt.includes('Outcome: failure'));
		assert.ok(prompt.includes('- step-a: boom'));
	});
});

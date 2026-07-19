/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { WorkflowRunResult } from '../../../../../../custom/goalWorkspace/workflowCatalogTypes.js';
import {
	formatActionsCommonErrorPrompt,
	formatActionsWorkflowErrorPrompt,
} from '../actionsClaudePrompt.js';

suite('actionsClaudePrompt', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('formatActionsWorkflowErrorPrompt includes failed steps and asks for a fix', () => {
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
		const prompt = formatActionsWorkflowErrorPrompt({
			surfaceName: 'Cadre AI Support Chatbot',
			surfaceId: 'cadre-support-bot',
			workflowId: 'support-bot-autoplay',
			workflowLabel: 'Support bot workflow',
			result,
			focusStepId: 'navigate-1',
		});
		assert.ok(prompt.includes('Cadre AI Support Chatbot'));
		assert.ok(prompt.includes('Focused action step: navigate-1'));
		assert.ok(prompt.includes('- navigate-1: Timed out waiting for /admin'));
		assert.ok(prompt.includes('missing-route: /admin'));
		assert.ok(prompt.includes('Diagnose the failure'));
		assert.ok(!prompt.includes('ensure-server'));
	});

	test('formatActionsCommonErrorPrompt includes action id and error', () => {
		const prompt = formatActionsCommonErrorPrompt(
			'publish-to-github',
			'Publish to GitHub',
			'Authentication failed',
		);
		assert.ok(prompt.includes('publish-to-github'));
		assert.ok(prompt.includes('Publish to GitHub'));
		assert.ok(prompt.includes('Authentication failed'));
	});
});

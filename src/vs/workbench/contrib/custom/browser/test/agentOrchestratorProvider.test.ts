/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	AGENT_ORCHESTRATOR_PROVIDER_STORAGE_KEY,
	parseAgentOrchestratorProvider,
	resolveOrchestratorModelId,
	shouldRunCustomAiPlanOrchestration,
} from '../../../../../../custom/goalWorkspace/agentOrchestratorProvider.js';
import {
	CUSTOM_AI_MODEL_OLLAMA,
	customAiOpenAiCompatibleIdentifier,
} from '../../../../../../custom/ai/common/customAiConstants.js';

suite('agentOrchestratorProvider', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('storage key is workspace-scoped modeShell key', () => {
		assert.strictEqual(AGENT_ORCHESTRATOR_PROVIDER_STORAGE_KEY, 'modeShell.agentOrchestratorProvider');
	});

	test('parseAgentOrchestratorProvider accepts known ids only', () => {
		assert.strictEqual(parseAgentOrchestratorProvider('claude'), 'claude');
		assert.strictEqual(parseAgentOrchestratorProvider('openaiCompatible'), 'openaiCompatible');
		assert.strictEqual(parseAgentOrchestratorProvider('ollama'), 'ollama');
		assert.strictEqual(parseAgentOrchestratorProvider(undefined), undefined);
		assert.strictEqual(parseAgentOrchestratorProvider(''), undefined);
		assert.strictEqual(parseAgentOrchestratorProvider('both'), undefined);
	});

	test('resolveOrchestratorModelId maps providers to Custom AI model ids', () => {
		assert.strictEqual(resolveOrchestratorModelId(undefined), undefined);
		assert.strictEqual(resolveOrchestratorModelId('claude'), undefined);
		assert.strictEqual(resolveOrchestratorModelId('ollama'), CUSTOM_AI_MODEL_OLLAMA);
		assert.strictEqual(
			resolveOrchestratorModelId('openaiCompatible', 'gpt-4o'),
			customAiOpenAiCompatibleIdentifier('gpt-4o'),
		);
		assert.strictEqual(
			resolveOrchestratorModelId('openaiCompatible'),
			customAiOpenAiCompatibleIdentifier('gpt-4o-mini'),
		);
	});

	test('shouldRunCustomAiPlanOrchestration only for Custom AI backends', () => {
		assert.strictEqual(shouldRunCustomAiPlanOrchestration(undefined), false);
		assert.strictEqual(shouldRunCustomAiPlanOrchestration('claude'), false);
		assert.strictEqual(shouldRunCustomAiPlanOrchestration('openaiCompatible'), true);
		assert.strictEqual(shouldRunCustomAiPlanOrchestration('ollama'), true);
	});
});

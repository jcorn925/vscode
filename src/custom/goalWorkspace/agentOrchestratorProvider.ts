/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Workspace-level Agent Orchestrator LLM choice for Plan Steps / workspace planning.
 * Stored via IStorageService (WORKSPACE scope); not part of workspace.goal.json.
 */

import {
	CUSTOM_AI_MODEL_OLLAMA,
	customAiOpenAiCompatibleIdentifier,
} from '../ai/common/customAiConstants.js';

export type AgentOrchestratorProviderId = 'claude' | 'openaiCompatible' | 'ollama';

export const AGENT_ORCHESTRATOR_PROVIDER_STORAGE_KEY = 'modeShell.agentOrchestratorProvider';

export const AGENT_ORCHESTRATOR_PROVIDER_IDS: readonly AgentOrchestratorProviderId[] = [
	'claude',
	'openaiCompatible',
	'ollama',
];

export function isAgentOrchestratorProviderId(value: string | undefined | null): value is AgentOrchestratorProviderId {
	return value === 'claude' || value === 'openaiCompatible' || value === 'ollama';
}

export function parseAgentOrchestratorProvider(value: string | undefined | null): AgentOrchestratorProviderId | undefined {
	return isAgentOrchestratorProviderId(value) ? value : undefined;
}

/**
 * Custom AI model id for silent orchestration turns.
 * Claude returns undefined (skip Custom AI; go straight to Claude coding).
 */
export function resolveOrchestratorModelId(
	provider: AgentOrchestratorProviderId | undefined,
	configuredOpenAiModel: string = 'gpt-4o-mini',
): string | undefined {
	if (!provider || provider === 'claude') {
		return undefined;
	}
	if (provider === 'ollama') {
		return CUSTOM_AI_MODEL_OLLAMA;
	}
	return customAiOpenAiCompatibleIdentifier(configuredOpenAiModel || 'gpt-4o-mini');
}

/** True when Plan Steps should run a Custom AI narrate+DISPATCH turn before Claude. */
export function shouldRunCustomAiPlanOrchestration(
	provider: AgentOrchestratorProviderId | undefined,
): boolean {
	return provider === 'openaiCompatible' || provider === 'ollama';
}

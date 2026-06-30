/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const CUSTOM_AI_VENDOR = 'customAi';

/** Internal language model identifiers returned by {@link CustomAiModelProvider}. */
export const CUSTOM_AI_MODEL_OLLAMA = `${CUSTOM_AI_VENDOR}:ollama`;
/** Legacy single-model identifier; still accepted when discovery is unavailable. */
export const CUSTOM_AI_MODEL_OPENAI = `${CUSTOM_AI_VENDOR}:openaiCompatible`;
/** Prefix for per-model OpenAI-compatible identifiers (`customAi:openaiCompatible:<apiModelId>`). */
export const CUSTOM_AI_MODEL_OPENAI_PREFIX = `${CUSTOM_AI_MODEL_OPENAI}:`;

export function isCustomAiOpenAiCompatibleModelId(modelId: string): boolean {
	return modelId === CUSTOM_AI_MODEL_OPENAI || modelId.startsWith(CUSTOM_AI_MODEL_OPENAI_PREFIX);
}

export function customAiOpenAiCompatibleIdentifier(apiModelId: string): string {
	return `${CUSTOM_AI_MODEL_OPENAI_PREFIX}${encodeURIComponent(apiModelId)}`;
}

/** Returns the API model id for a Custom AI OpenAI-compatible identifier, or `undefined` for the legacy id. */
export function parseCustomAiOpenAiApiModelId(modelIdentifier: string): string | undefined {
	if (modelIdentifier === CUSTOM_AI_MODEL_OPENAI) {
		return undefined;
	}
	if (modelIdentifier.startsWith(CUSTOM_AI_MODEL_OPENAI_PREFIX)) {
		return decodeURIComponent(modelIdentifier.slice(CUSTOM_AI_MODEL_OPENAI_PREFIX.length));
	}
	return undefined;
}

export function pickCustomAiOpenAiCompatibleModelId(availableIds: readonly string[], configuredApiModel: string): string {
	const preferred = customAiOpenAiCompatibleIdentifier(configuredApiModel);
	if (availableIds.includes(preferred)) {
		return preferred;
	}
	if (availableIds.includes(CUSTOM_AI_MODEL_OPENAI)) {
		return CUSTOM_AI_MODEL_OPENAI;
	}
	return availableIds.find(id => isCustomAiOpenAiCompatibleModelId(id)) ?? CUSTOM_AI_MODEL_OPENAI;
}

/** Secret storage key for BYO OpenAI-compatible API key. */
export const CUSTOM_AI_SECRET_OPENAI_API_KEY = 'custom-ai.openai-api-key';

/** Official Ollama install page (used by setup helpers). */
export const CUSTOM_AI_OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

/** Default OpenAI API keys page (matches default `custom.ai.openaiCompatible.baseUrl`). */
export const CUSTOM_AI_OPENAI_API_KEYS_URL = 'https://platform.openai.com/api-keys';

export const CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD = 'customAi.openOllamaDownload';
export const CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS = 'customAi.openOllamaSettings';
export const CUSTOM_AI_COMMAND_OPEN_API_KEY_HELP = 'customAi.openApiKeyHelp';

/** Resolves a "create API key" page for the configured OpenAI-compatible base URL. */
export function getCustomAiApiKeyHelpUrl(baseUrl: string): string {
	const normalized = baseUrl.toLowerCase();
	if (normalized.includes('openrouter.ai')) {
		return 'https://openrouter.ai/keys';
	}
	if (normalized.includes('together.xyz') || normalized.includes('together.ai')) {
		return 'https://api.together.xyz/settings/api-keys';
	}
	if (normalized.includes('groq.com')) {
		return 'https://console.groq.com/keys';
	}
	if (normalized.includes('mistral.ai')) {
		return 'https://console.mistral.ai/api-keys/';
	}
	return CUSTOM_AI_OPENAI_API_KEYS_URL;
}

/** Tool id for the Custom AI file editor tool. */
export const CUSTOM_AI_EDIT_FILE_TOOL_ID = 'customAi_editFile';
/** Reference name used by the model (function `name` in OpenAI tool-calling). */
export const CUSTOM_AI_EDIT_FILE_TOOL_NAME = 'editFile';

/** Tool id for the Custom AI cross-app workflow planner. */
export const CUSTOM_AI_PLAN_WORKFLOW_TOOL_ID = 'customAi_planCrossAppWorkflow';
/** Reference name used by the model (function `name` in OpenAI tool-calling). */
export const CUSTOM_AI_PLAN_WORKFLOW_TOOL_NAME = 'planCrossAppWorkflow';

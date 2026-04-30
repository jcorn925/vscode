/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const CUSTOM_AI_VENDOR = 'customAi';

/** Internal language model identifiers returned by {@link CustomAiModelProvider}. */
export const CUSTOM_AI_MODEL_OLLAMA = `${CUSTOM_AI_VENDOR}:ollama`;
export const CUSTOM_AI_MODEL_OPENAI = `${CUSTOM_AI_VENDOR}:openaiCompatible`;

/** Secret storage key for BYO OpenAI-compatible API key. */
export const CUSTOM_AI_SECRET_OPENAI_API_KEY = 'custom-ai.openai-api-key';

/** Official Ollama install page (used by setup helpers). */
export const CUSTOM_AI_OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

export const CUSTOM_AI_COMMAND_OPEN_OLLAMA_DOWNLOAD = 'customAi.openOllamaDownload';
export const CUSTOM_AI_COMMAND_OPEN_OLLAMA_SETTINGS = 'customAi.openOllamaSettings';

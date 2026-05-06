/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { ChatMessageRole, type IChatMessage, type ILanguageModelsService } from '../../chat/common/languageModels.js';
import { CUSTOM_AI_MODEL_OLLAMA, CUSTOM_AI_MODEL_OPENAI } from '../../../../../custom/ai/common/customAiConstants.js';
import type { ProcessNoteGraph } from './processNotesTypes.js';
import type { CustomPromptEvidencePack } from './processNotesCustomEvidence.js';
import type { WebviewSelectionEvidencePack } from './processNotesIxEvidence.js';

export type ProcessNotesSynthesisResult = {
	readonly markdown: string;
	readonly graph: ProcessNoteGraph;
	/** Exact system instruction sent to the language model (for saved provenance). */
	readonly systemPrompt: string;
	/** Exact user message sent to the language model (for saved provenance). */
	readonly userPrompt: string;
	readonly modelId?: string;
};

type ParsedSynthesisBody = Pick<ProcessNotesSynthesisResult, 'markdown' | 'graph'>;

function tryParseSynthesisJson(text: string, fallbackGraph: ProcessNoteGraph): ParsedSynthesisBody {
	const trimmed = text.trim();
	const tryOne = (s: string): ParsedSynthesisBody | undefined => {
		try {
			const parsed = JSON.parse(s) as ParsedSynthesisBody;
			if (parsed && typeof parsed.markdown === 'string' && parsed.graph) {
				return parsed;
			}
		} catch {
			// ignore
		}
		return undefined;
	};
	let r = tryOne(trimmed);
	if (r) {
		return r;
	}
	const fence = /```(?:json)?\s*([\s\S]*?)```/;
	const m = trimmed.match(fence);
	if (m) {
		r = tryOne(m[1].trim());
		if (r) {
			return r;
		}
	}
	return {
		markdown: localize('customMode.processNotes.badJson', 'Failed to synthesize note (model did not return JSON). Raw output:\n\n{0}', text.slice(0, 6000)),
		graph: fallbackGraph,
	};
}

function pickModelId(languageModels: ILanguageModelsService): string | undefined {
	const ids = languageModels.getLanguageModelIds();
	// Prefer the custom provider models when available.
	if (ids.includes(CUSTOM_AI_MODEL_OPENAI)) {
		return CUSTOM_AI_MODEL_OPENAI;
	}
	if (ids.includes(CUSTOM_AI_MODEL_OLLAMA)) {
		return CUSTOM_AI_MODEL_OLLAMA;
	}
	return ids[0];
}

export async function synthesizeWebviewSelectionNote(
	languageModels: ILanguageModelsService,
	evidence: WebviewSelectionEvidencePack,
	token: CancellationToken,
): Promise<ProcessNotesSynthesisResult> {
	const system = localize(
		'customMode.processNotes.systemPrompt',
		[
			'You are generating a saved engineering note for a VS Code fork.',
			'You MUST only use facts from the provided evidence pack.',
			'Output MUST be valid JSON with keys: markdown (string), graph (object with nodes/edges).',
			'Graph nodes must include: id, label, kind, lane (optional).',
			'Graph edges must include: from, to, type (string).',
		].join('\n')
	);

	const user = [
		`Topic: "How does selecting components on the webview work?"`,
		'',
		'Evidence pack (JSON):',
		JSON.stringify({ anchors: evidence.anchors, raw: evidence.raw }, null, 2),
		'',
		'Existing draft graph JSON (you may refine labels/lanes but keep ids stable):',
		JSON.stringify(evidence.graph, null, 2),
	].join('\n');

	const modelId = pickModelId(languageModels);
	if (!modelId) {
		const body = localize('customMode.processNotes.noModel', 'No language model is available. Configure a Custom AI model in the chat model picker.');
		return {
			markdown: body,
			graph: evidence.graph,
			systemPrompt: system,
			userPrompt: user,
			modelId: undefined,
		};
	}

	const messages: IChatMessage[] = [
		{ role: ChatMessageRole.System, content: [{ type: 'text', value: system }] },
		{ role: ChatMessageRole.User, content: [{ type: 'text', value: user }] },
	];

	const resp = await languageModels.sendChatRequest(modelId, undefined, messages, {}, token);
	let text = '';
	for await (const part of resp.stream) {
		const parts = Array.isArray(part) ? part : [part];
		for (const p of parts) {
			if (p.type === 'text') {
				text += (p.value ?? '');
			}
		}
	}
	await resp.result;

	const body = tryParseSynthesisJson(text, evidence.graph);
	return { ...body, systemPrompt: system, userPrompt: user, modelId };
}

export async function synthesizeCustomPromptNote(
	languageModels: ILanguageModelsService,
	evidence: CustomPromptEvidencePack,
	token: CancellationToken,
): Promise<ProcessNotesSynthesisResult> {
	const system = localize(
		'customMode.processNotes.systemPromptWorkspace',
		[
			'You are generating a saved engineering note for the open workspace.',
			'You MUST only use facts from the provided evidence pack.',
			'Output MUST be valid JSON with keys: markdown (string), graph (object with nodes/edges).',
			'Graph nodes must include: id, label, kind, lane (optional). Prefer file/symbol nodes with stable ids.',
			'Graph edges must include: from, to, type (string).',
		].join('\n')
	);

	const user = [
		`User question: ${JSON.stringify(evidence.userPrompt)}`,
		'',
		'Evidence pack (JSON):',
		JSON.stringify({ anchors: evidence.anchors, raw: evidence.raw }, null, 2),
		'',
		'Existing draft graph JSON (refine labels/lanes; keep workspace and userQuery node ids if possible):',
		JSON.stringify(evidence.graph, null, 2),
	].join('\n');

	const modelId = pickModelId(languageModels);
	if (!modelId) {
		const body = localize('customMode.processNotes.noModel', 'No language model is available. Configure a Custom AI model in the chat model picker.');
		return {
			markdown: body,
			graph: evidence.graph,
			systemPrompt: system,
			userPrompt: user,
			modelId: undefined,
		};
	}

	const messages: IChatMessage[] = [
		{ role: ChatMessageRole.System, content: [{ type: 'text', value: system }] },
		{ role: ChatMessageRole.User, content: [{ type: 'text', value: user }] },
	];

	const resp = await languageModels.sendChatRequest(modelId, undefined, messages, {}, token);
	let text = '';
	for await (const part of resp.stream) {
		const parts = Array.isArray(part) ? part : [part];
		for (const p of parts) {
			if (p.type === 'text') {
				text += (p.value ?? '');
			}
		}
	}
	await resp.result;

	const body = tryParseSynthesisJson(text, evidence.graph);
	return { ...body, systemPrompt: system, userPrompt: user, modelId };
}


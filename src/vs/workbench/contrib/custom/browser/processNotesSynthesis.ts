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

export interface ProcessCandidateForSelection {
	readonly id: string;
	readonly label: string;
	readonly labelKind?: string;
	readonly level?: number;
	readonly score: number;
	readonly keywords: readonly string[];
}

export interface ProcessCandidateSelectionResult {
	readonly candidateIds: readonly string[];
	readonly keywords: readonly string[];
	readonly reason: string;
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly modelId?: string;
	readonly selectedBy: 'model' | 'deterministic';
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIxErrorPayload(json: unknown): boolean {
	// Most evidence errors are recorded as `{ error, exitCode, raw }`.
	return isRecord(json) && typeof json.error === 'string';
}

function isDeepEvidenceLabel(label: string): boolean {
	return /^ix (?:explain|overview|subsystems) /i.test(label);
}

function pickDeepEvidence(raw: readonly { readonly label: string; readonly json: unknown }[]): { label: string; json: unknown }[] {
	return raw.filter(r => isDeepEvidenceLabel(r.label) && !isIxErrorPayload(r.json));
}

function pickResolutionEvidence(raw: readonly { readonly label: string; readonly json: unknown }[]): { label: string; json: unknown }[] {
	return raw.filter(r => /^ix (?:search|locate|text) /i.test(r.label) && !isIxErrorPayload(r.json));
}

export async function selectProcessCandidatesFromIxMap(
	languageModels: ILanguageModelsService,
	userQuestion: string,
	candidates: readonly ProcessCandidateForSelection[],
	fallbackKeywords: readonly string[],
	fallbackReason: string,
	token: CancellationToken,
): Promise<ProcessCandidateSelectionResult> {
	const capped = candidates.slice(0, 20);
	const system = localize(
		'customMode.processNotes.candidateSelector.system',
		[
			'You select process-note candidates from a fixed list extracted from Ix subsystem/map output.',
			'You MUST NOT invent candidate labels or ids.',
			'Return valid JSON only with keys: candidateIds (string array), keywords (string array), reason (string).',
			'candidateIds MUST be ids from the provided candidates list.',
			'Select at most 5 candidateIds. Use keywords for fallback ix text/search queries.',
		].join('\n')
	);
	const user = [
		`User question: ${JSON.stringify(userQuestion)}`,
		'',
		'Deterministically ranked candidates from Ix output:',
		JSON.stringify(capped, null, 2),
		'',
		'Fallback keywords:',
		JSON.stringify(fallbackKeywords, null, 2),
	].join('\n');

	const modelId = pickModelId(languageModels);
	if (!modelId) {
		return {
			candidateIds: capped.slice(0, 5).map(c => c.id),
			keywords: fallbackKeywords.slice(0, 8),
			reason: fallbackReason,
			systemPrompt: system,
			userPrompt: user,
			modelId: undefined,
			selectedBy: 'deterministic',
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

	try {
		const normalized = extractJsonPayload(text);
		const parsed = JSON.parse(normalized) as { candidateIds?: unknown; keywords?: unknown; reason?: unknown };
		const validIds = new Set(capped.map(c => c.id));
		const candidateIds = Array.isArray(parsed.candidateIds)
			? parsed.candidateIds.filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5)
			: [];
		const keywords = Array.isArray(parsed.keywords)
			? parsed.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).slice(0, 8)
			: fallbackKeywords.slice(0, 8);
		return {
			candidateIds: candidateIds.length ? candidateIds : capped.slice(0, 5).map(c => c.id),
			keywords: keywords.length ? keywords : fallbackKeywords.slice(0, 8),
			reason: typeof parsed.reason === 'string' ? parsed.reason : fallbackReason,
			systemPrompt: system,
			userPrompt: user,
			modelId,
			selectedBy: candidateIds.length ? 'model' : 'deterministic',
		};
	} catch {
		return {
			candidateIds: capped.slice(0, 5).map(c => c.id),
			keywords: fallbackKeywords.slice(0, 8),
			reason: `${fallbackReason}\n\nCandidate selector model did not return JSON. Raw output:\n${text.slice(0, 2000)}`,
			systemPrompt: system,
			userPrompt: user,
			modelId,
			selectedBy: 'deterministic',
		};
	}
}

function extractJsonPayload(text: string): string {
	const trimmed = text.trim();
	// Common model behavior: wrap JSON in markdown fences.
	if (trimmed.startsWith('```')) {
		const lines = trimmed.split(/\r?\n/);
		const fenceEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '```');
		if (fenceEnd > 0) {
			return lines.slice(1, fenceEnd).join('\n').trim();
		}
	}

	// Another common behavior: preface with prose; try to recover the first JSON object/array.
	const firstBrace = trimmed.search(/[\[{]/);
	if (firstBrace > 0) {
		return trimmed.slice(firstBrace).trim();
	}
	return trimmed;
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
			'',
			'CRITICAL OUTPUT CONTRACT:',
			'- The markdown MUST primarily answer the USER QUESTION (the user process), not describe the retrieval pipeline.',
			'- The markdown MUST include these sections in this order:',
			'  1) "## Answer" (explain how the user-described process works in THIS repo, citing concrete files/symbols/endpoints when present)',
			'  2) "## Evidence anchors" (bullet list of the most important resolved targets and where they came from)',
			'  3) A short collapsible section for pipeline/debugging, using <details><summary>How we found it</summary> ... </details>',
			'- If there is insufficient resolved evidence (no resolved targets and no successful explain/overview), you MUST say so in "## Answer" and propose the next best Ix commands to run (do not hallucinate implementation details).',
		].join('\n')
	);

	const deepEvidence = pickDeepEvidence(evidence.raw);
	const resolutionEvidence = pickResolutionEvidence(evidence.raw);
	const hasResolvedTargets = (evidence.binding?.resolvedTargets?.length ?? 0) > 0;
	const hasDeep = deepEvidence.length > 0;

	const user = [
		`User question: ${JSON.stringify(evidence.userPrompt)}`,
		'',
		'IMPORTANT: Your answer must describe the user process in this repo, not the retrieval pipeline.',
		'',
		'Resolved targets (these are the strongest anchors; prefer them):',
		JSON.stringify(evidence.binding?.resolvedTargets ?? [], null, 2),
		'',
		'Deep evidence (ix explain/overview), when available:',
		JSON.stringify(deepEvidence, null, 2),
		'',
		'Resolution evidence (ix search/locate/text), when available:',
		JSON.stringify(resolutionEvidence, null, 2),
		'',
		`Evidence completeness: resolvedTargets=${String(hasResolvedTargets)} deepEvidence=${String(hasDeep)}`,
		'',
		'Debug/provenance (do NOT summarize as the main answer):',
		JSON.stringify({
			commandPhases: evidence.commandPhases,
			selection: {
				selectedBy: evidence.selection.selectedBy,
				candidateIds: evidence.selection.candidateIds,
				keywords: evidence.selection.keywords,
				reason: evidence.selection.reason,
			},
		}, null, 2),
		'',
		'Full evidence pack (JSON, for reference):',
		JSON.stringify({ anchors: evidence.anchors, raw: evidence.raw, binding: evidence.binding }, null, 2),
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


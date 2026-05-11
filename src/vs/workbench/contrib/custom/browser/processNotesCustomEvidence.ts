/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import type { ProcessGraphCitation, ProcessGraphEdge, ProcessGraphNode, ProcessNoteBinding, ProcessNoteGraph } from './processNotesTypes.js';
import type { ProcessCandidateForSelection, ProcessCandidateSelectionResult } from './processNotesSynthesis.js';
import { runIxSubsystemExplainWithDisambiguation } from './ixSubsystemExplain.js';

export interface CustomPromptEvidencePack {
	readonly userPrompt: string;
	readonly anchors: readonly ProcessGraphNode[];
	readonly graph: ProcessNoteGraph;
	readonly citations: readonly ProcessGraphCitation[];
	readonly raw: readonly { readonly label: string; readonly json: unknown }[];
	readonly commandPhases: readonly { readonly phase: string; readonly labels: readonly string[] }[];
	readonly selection: ProcessCandidateSelectionResult;
	readonly binding: ProcessNoteBinding;
}

type IxEvidencePhase = 'discovery' | 'selection' | 'resolution' | 'deepening' | 'context';

export interface ProcessNotesGenerationProgressEvent {
	readonly phase: IxEvidencePhase | 'synthesis';
	readonly label: string;
	readonly status: 'start' | 'success' | 'error' | 'info';
	readonly detail?: string;
}

interface IxEvidenceCommandResult {
	readonly phase: IxEvidencePhase;
	readonly label: string;
	readonly args: readonly string[];
	readonly ok: boolean;
	readonly json: unknown;
	readonly error?: string;
	readonly ref: string;
}

interface NormalizedIxRegion extends ProcessCandidateForSelection {
	readonly raw: unknown;
	readonly parentLabel?: string;
	readonly files?: number;
	readonly confidence?: number;
	readonly signals?: readonly string[];
}

interface ResolvedIxTarget {
	readonly target: string;
	readonly kind?: string;
	readonly path?: string;
	readonly source: 'search' | 'locate' | 'text' | 'subsystem';
	readonly score: number;
}

function isLowSignalResolutionTerm(term: string): boolean {
	const t = term.trim();
	if (!t) {
		return true;
	}
	// Avoid running ix locate/explain on junk like "R".
	if (t.length < 3) {
		return true;
	}
	// Pure numbers and single symbols are usually noise in process questions.
	if (/^[0-9]+$/.test(t)) {
		return true;
	}
	return false;
}

function isDeepenCandidate(_t: ResolvedIxTarget): boolean {
	// Subsystem regions use `ix subsystems --target … --explain` (not `ix explain <label>`).
	// Search/locate/file paths use entity-oriented explain/overview in the deepening loop.
	return true;
}

function subsystemRegionOnly(t: ResolvedIxTarget): boolean {
	return t.source === 'subsystem' && !t.path;
}

function ixCitation(command: string, ref: string): ProcessGraphCitation {
	return { source: 'ix', command, ref };
}

async function runEvidenceCommand(
	phase: IxEvidencePhase,
	label: string,
	ix: IIxIntegrationService,
	args: readonly string[],
	cwd: URI,
	timeoutMs: number,
	raw: Array<{ label: string; json: unknown }>,
	citations: ProcessGraphCitation[],
	ref: string,
	results: IxEvidenceCommandResult[],
): Promise<IxEvidenceCommandResult> {
	const res = await ix.runJsonQuery(args, cwd, timeoutMs);
	let result: IxEvidenceCommandResult;
	if (res.ok) {
		raw.push({ label, json: res.value });
		citations.push(ixCitation(label, ref));
		result = { phase, label, args, ok: true, json: res.value, ref };
	} else {
		const json = { error: res.error, exitCode: res.exitCode, raw: res.raw };
		raw.push({ label, json });
		result = { phase, label, args, ok: false, json, error: res.error, ref };
	}
	results.push(result);
	return result;
}

function stableHash(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}

function splitWords(text: string): string[] {
	const withCamel = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
	return withCamel
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter(Boolean);
}

const STOP_WORDS = new Set([
	'a', 'about', 'an', 'and', 'code', 'does', 'flow', 'for', 'how', 'in', 'is', 'of', 'process', 'system', 'the', 'this', 'to', 'what', 'where', 'work', 'works',
]);

const ALIASES: Readonly<Record<string, readonly string[]>> = {
	ai: ['chat', 'agent', 'model', 'language'],
	auth: ['authentication', 'login', 'signin'],
	build: ['compile', 'bundle', 'swc'],
	compile: ['build', 'bundle', 'swc'],
	shell: ['terminal'],
	terminal: ['shell'],
	ui: ['webview', 'browser', 'frontend'],
	video: ['videos'],
	videos: ['video'],
	webview: ['ui', 'browser', 'frontend'],
};

function expandTokens(tokens: readonly string[]): string[] {
	const out = new Set(tokens);
	for (const t of tokens) {
		for (const a of ALIASES[t] ?? []) {
			out.add(a);
		}
	}
	return [...out];
}

function questionTokens(prompt: string): string[] {
	return expandTokens(splitWords(prompt).filter(t => !STOP_WORDS.has(t)));
}

function extractPromptPhrases(prompt: string): string[] {
	const phrases = new Set<string>();
	for (const m of prompt.matchAll(/"([^"]{2,80})"/g)) {
		phrases.add(m[1]);
	}
	for (const m of prompt.matchAll(/\b[\w./-]+\.(?:ts|tsx|js|jsx)\b/g)) {
		phrases.add(m[0]);
	}
	for (const m of prompt.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*|[a-z0-9]+){1,}\b/g)) {
		phrases.add(m[0]);
	}
	return [...phrases];
}

function trigrams(text: string): Set<string> {
	const normalized = splitWords(text).join('');
	const grams = new Set<string>();
	for (let i = 0; i <= normalized.length - 3; i++) {
		grams.add(normalized.slice(i, i + 3));
	}
	return grams;
}

function trigramSimilarity(a: string, b: string): number {
	const ga = trigrams(a);
	const gb = trigrams(b);
	if (!ga.size || !gb.size) {
		return 0;
	}
	let hit = 0;
	for (const g of ga) {
		if (gb.has(g)) {
			hit++;
		}
	}
	return hit / Math.max(ga.size, gb.size);
}

function weightedOverlap(promptTokens: readonly string[], labelTokens: readonly string[]): number {
	if (!promptTokens.length || !labelTokens.length) {
		return 0;
	}
	const label = new Set(labelTokens);
	let hits = 0;
	for (const t of promptTokens) {
		if (label.has(t)) {
			hits++;
		}
	}
	return hits / Math.sqrt(promptTokens.length * labelTokens.length);
}

function orderedNgram(promptTokens: readonly string[], labelTokens: readonly string[]): number {
	if (!promptTokens.length || !labelTokens.length) {
		return 0;
	}
	let idx = 0;
	let hits = 0;
	for (const t of promptTokens) {
		const found = labelTokens.indexOf(t, idx);
		if (found >= 0) {
			hits++;
			idx = found + 1;
		}
	}
	return hits / promptTokens.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function collectRegions(value: unknown, out: NormalizedIxRegion[], parentLabel?: string, level = 0): void {
	if (Array.isArray(value)) {
		for (const v of value) {
			collectRegions(v, out, parentLabel, level);
		}
		return;
	}
	if (!isRecord(value)) {
		return;
	}

	const label = textField(value.label) ?? textField(value.name) ?? textField(value.title);
	const kind = textField(value.label_kind) ?? textField(value.kind) ?? textField(value.type);
	const explicitLevel = numberField(value.level) ?? level;
	const files = numberField(value.files) ?? numberField(value.file_count) ?? numberField(value.count);
	const confidence = numberField(value.confidence) ?? numberField(value.clarity) ?? numberField(value.score);
	const signals = Array.isArray(value.signals) ? value.signals.filter((s): s is string => typeof s === 'string') : undefined;
	if (label) {
		const text = [label, kind, parentLabel, ...(signals ?? [])].filter(Boolean).join(' ');
		out.push({
			id: `cand_${out.length + 1}`,
			label,
			labelKind: kind,
			level: explicitLevel,
			score: 0,
			keywords: splitWords(text),
			raw: value,
			parentLabel,
			files,
			confidence,
			signals,
		});
	}

	for (const key of ['children', 'items', 'modules', 'subsystems', 'systems', 'regions', 'branches']) {
		if (key in value) {
			collectRegions(value[key], out, label ?? parentLabel, explicitLevel + 1);
		}
	}
}

function scoreRegions(prompt: string, regions: readonly NormalizedIxRegion[]): { candidates: NormalizedIxRegion[]; keywords: string[]; reason: string } {
	const tokens = questionTokens(prompt);
	const phrases = extractPromptPhrases(prompt);
	const promptLower = prompt.toLowerCase();
	const scored = regions.map(r => {
		const labelLower = r.label.toLowerCase();
		const labelTokens = expandTokens(splitWords([r.label, r.parentLabel, r.labelKind, ...(r.signals ?? [])].filter(Boolean).join(' ')));
		const exactPhrase = promptLower.includes(labelLower) ? 1 : 0;
		const phraseHit = phrases.some(p => labelLower.includes(p.toLowerCase()) || p.toLowerCase().includes(labelLower)) ? 1 : 0;
		const ordered = orderedNgram(tokens, labelTokens);
		const overlap = weightedOverlap(tokens, labelTokens);
		const fuzzy = Math.max(...[r.label, ...phrases].map(p => trigramSimilarity(prompt, p === r.label ? r.label : `${r.label} ${p}`)), 0);
		const confidence = (r.confidence ?? 0) > 1 ? (r.confidence ?? 0) / 100 : (r.confidence ?? 0);
		const specificity = r.labelKind === 'module' || r.level !== undefined && r.level >= 2 ? 0.25 : 0;
		const broadPenalty = (r.files ?? 0) > 1000 && tokens.length > 1 ? -0.5 : 0;
		return {
			...r,
			score: 8 * exactPhrase + 4 * phraseHit + 5 * ordered + 3 * overlap + 2 * fuzzy + 0.5 * confidence + specificity + broadPenalty,
			keywords: labelTokens,
		};
	});

	const deduped: NormalizedIxRegion[] = [];
	const seen = new Set<string>();
	for (const c of scored.sort((a, b) => b.score - a.score)) {
		const key = c.label.toLowerCase().replace(/\s+/g, ' ').trim();
		if (!seen.has(key) && c.score >= 0.6) {
			seen.add(key);
			deduped.push(c);
		}
		if (deduped.length >= 20) {
			break;
		}
	}
	return {
		candidates: deduped,
		keywords: tokens.slice(0, 8),
		reason: deduped.length
			? `Deterministic extraction scored ${regions.length} Ix regions; top match was "${deduped[0].label}" (${deduped[0].score.toFixed(2)}).`
			: `Deterministic extraction found no Ix region above threshold from ${regions.length} regions.`,
	};
}

function commandPhases(results: readonly IxEvidenceCommandResult[]): { phase: string; labels: string[] }[] {
	const phases: IxEvidencePhase[] = ['discovery', 'selection', 'resolution', 'deepening', 'context'];
	return phases
		.map(phase => ({ phase, labels: results.filter(r => r.phase === phase).map(r => r.label) }))
		.filter(p => p.labels.length);
}

function firstJsonResult(results: readonly IxEvidenceCommandResult[], labelPrefix: string): unknown | undefined {
	return results.find(r => r.ok && r.label.startsWith(labelPrefix))?.json;
}

function summarizeCommandResults(results: readonly IxEvidenceCommandResult[]): string {
	return results.map(r => `${r.ok ? 'ok' : 'error'} ${r.label}`).join('\n');
}

function extractTargets(json: unknown, source: ResolvedIxTarget['source'], fallback: string, baseScore: number): ResolvedIxTarget[] {
	const targets: ResolvedIxTarget[] = [];
	const visit = (v: unknown): void => {
		if (Array.isArray(v)) {
			for (const item of v.slice(0, 10)) {
				visit(item);
			}
			return;
		}
		if (!isRecord(v)) {
			return;
		}
		const target = textField(v.name) ?? textField(v.label) ?? textField(v.symbol) ?? textField(v.entity) ?? textField(v.path);
		if (target) {
			targets.push({
				target,
				kind: textField(v.kind) ?? textField(v.type),
				path: textField(v.path) ?? textField(v.file),
				source,
				score: baseScore,
			});
		}
		for (const key of ['results', 'matches', 'items', 'entities', 'candidates']) {
			if (key in v) {
				visit(v[key]);
			}
		}
	};
	visit(json);
	// Never fabricate "resolved targets" from the fallback term for locate/search.
	// Those commands either resolve concrete graph entities/paths or they didn't.
	if (!targets.length && source === 'text' && fallback.trim().length) {
		targets.push({ target: fallback, source, score: baseScore * 0.5 });
	}
	return targets.slice(0, 3);
}

function uniqueTargets(targets: readonly ResolvedIxTarget[]): ResolvedIxTarget[] {
	const seen = new Set<string>();
	const out: ResolvedIxTarget[] = [];
	for (const t of [...targets].sort((a, b) => b.score - a.score)) {
		const key = `${t.source}|${t.target}|${t.kind ?? ''}|${t.path ?? ''}`;
		if (!seen.has(key)) {
			seen.add(key);
			out.push(t);
		}
	}
	return out;
}

/** Pull repo-relative path hints embedded in `ix subsystems` region JSON (interfaces, paths, children, etc.). */
function collectPathHintsFromSubsystemRaw(raw: unknown, depth = 0, seen = new Set<string>()): string[] {
	const out: string[] = [];
	if (depth > 12) {
		return out;
	}
	const maybePath = (s: string) => {
		const t = s.trim();
		if (t.length < 4 || seen.has(t)) {
			return;
		}
		// Heuristic: looks like a source path (not a bare subsystem name).
		if ((/[\\/][^\\/]+\.[a-z0-9]{1,8}$/i.test(t) || /^[@.\w][\w./@-]+\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt)$/i.test(t)) && /[\\/]/.test(t)) {
			seen.add(t);
			out.push(t);
		}
	};

	if (typeof raw === 'string') {
		maybePath(raw);
		return out;
	}
	if (!raw || typeof raw !== 'object') {
		return out;
	}
	if (Array.isArray(raw)) {
		for (const item of raw.slice(0, 80)) {
			out.push(...collectPathHintsFromSubsystemRaw(item, depth + 1, seen));
		}
		return out.slice(0, 16);
	}
	const o = raw as Record<string, unknown>;
	for (const key of ['path', 'file', 'rel_path', 'relpath', 'paths', 'roots', 'files', 'interfaces', 'members', 'children']) {
		if (!(key in o)) {
			continue;
		}
		const v = o[key];
		if (typeof v === 'string') {
			maybePath(v);
		} else if (Array.isArray(v)) {
			for (const item of v.slice(0, 40)) {
				if (typeof item === 'string') {
					maybePath(item);
				} else {
					out.push(...collectPathHintsFromSubsystemRaw(item, depth + 1, seen));
				}
			}
		} else if (v && typeof v === 'object') {
			out.push(...collectPathHintsFromSubsystemRaw(v, depth + 1, seen));
		}
	}
	if (depth < 5) {
		for (const v of Object.values(o).slice(0, 48)) {
			if (v && typeof v === 'object') {
				out.push(...collectPathHintsFromSubsystemRaw(v, depth + 1, seen));
			}
		}
	}
	return out.slice(0, 16);
}

function makeBinding(
	userPrompt: string,
	selection: ProcessCandidateSelectionResult,
	selectedRegions: readonly NormalizedIxRegion[],
	resolvedTargets: readonly ResolvedIxTarget[],
	results: readonly IxEvidenceCommandResult[],
): ProcessNoteBinding {
	const selectedBy = selection.selectedBy;
	const subsystemFingerprint = stableHash(JSON.stringify(selectedRegions.map(r => ({ label: r.label, kind: r.labelKind, level: r.level, parent: r.parentLabel, score: r.score }))));
	const targetFingerprint = stableHash(JSON.stringify(resolvedTargets));
	const evidenceFingerprint = stableHash(JSON.stringify(results.map(r => ({ label: r.label, ok: r.ok, ref: r.ref }))));
	return {
		prompt: userPrompt,
		selection: selectedRegions.map(r => ({
			subsystemKey: stableHash(`${r.labelKind ?? ''}|${r.level ?? ''}|${r.parentLabel ?? ''}|${r.label}|${r.files ?? ''}`),
			label: r.label,
			labelKind: r.labelKind,
			level: r.level,
			score: r.score,
			selectedBy,
		})),
		resolvedTargets: resolvedTargets.map(t => ({ target: t.target, kind: t.kind, path: t.path, source: t.source })),
		fingerprints: {
			subsystem: subsystemFingerprint,
			resolvedTargets: targetFingerprint,
			evidence: evidenceFingerprint,
		},
		ix: {
			generatedAt: Date.now(),
		},
	};
}

export type SelectProcessCandidates = (
	userQuestion: string,
	candidates: readonly ProcessCandidateForSelection[],
	fallbackKeywords: readonly string[],
	fallbackReason: string,
) => Promise<ProcessCandidateSelectionResult>;

/**
 * Workspace-scoped evidence: discovers Ix subsystems/map, resolves likely targets, and deepens with explain/overview.
 */
export async function buildCustomPromptEvidencePack(
	ix: IIxIntegrationService,
	cwd: URI,
	userPrompt: string,
	selectProcessCandidates: SelectProcessCandidates,
	onProgress?: (e: ProcessNotesGenerationProgressEvent) => void,
): Promise<CustomPromptEvidencePack> {
	const raw: Array<{ label: string; json: unknown }> = [];
	const citations: ProcessGraphCitation[] = [];
	const results: IxEvidenceCommandResult[] = [];
	let commandBudget = 20;

	const run = async (phase: IxEvidencePhase, label: string, args: readonly string[], timeoutMs: number, ref: string): Promise<IxEvidenceCommandResult | undefined> => {
		if (commandBudget <= 0) {
			return undefined;
		}
		commandBudget--;
		onProgress?.({ phase, label, status: 'start' });
		const r = await runEvidenceCommand(phase, label, ix, args, cwd, timeoutMs, raw, citations, ref, results);
		onProgress?.({ phase, label, status: r.ok ? 'success' : 'error', detail: r.ok ? undefined : r.error });
		return r;
	};

	const queryLabel = userPrompt.trim().slice(0, 160) || localize('customMode.processNotes.custom.emptyPrompt', '(empty prompt)');

	const nodes: ProcessGraphNode[] = [
		{
			id: 'workspace',
			label: localize('customMode.processNotes.custom.node.workspace', 'Workspace'),
			kind: 'phase',
			lane: 'Host',
			file: cwd,
			startLine: 1,
			endLine: 1,
		},
		{
			id: 'userQuery',
			label: localize('customMode.processNotes.custom.node.query', 'Question: {0}', queryLabel),
			kind: 'event',
			lane: 'Bridge',
		},
	];

	const edges: ProcessGraphEdge[] = [
		{
			from: 'workspace',
			to: 'userQuery',
			type: 'other',
			evidence: localize('customMode.processNotes.custom.edge.scope', 'Process question scoped to open workspace'),
		},
	];

	onProgress?.({ phase: 'discovery', label: 'Starting discovery', status: 'info' });
	onProgress?.({ phase: 'discovery', label: localize('customMode.processNotes.ixStats', 'ix stats'), status: 'start' });
	const hydrate = await ix.ensureIxMappedIfEmpty(cwd);
	const statsHeadline = hydrate.statsPreview.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
	onProgress?.({
		phase: 'discovery',
		label: localize('customMode.processNotes.ixStats', 'ix stats'),
		status: 'success',
		detail: statsHeadline,
	});
	if (hydrate.ranMap) {
		onProgress?.({
			phase: 'discovery',
			label: localize('customMode.processNotes.ixMapHydrate', 'ix map --all-items . (graph was empty)'),
			status: 'info',
		});
	}

	// 1) Prefer rich subsystem view first: importance-ranked, all items.
	// Do not pass "." here: `ix subsystems --format json .` switches to the scoped
	// target/children JSON shape, while the global command returns the regions list.
	// (Result is read out of `results` below, not kept locally.)
	await run(
		'discovery',
		'ix subsystems --sort importance --all-items --format json',
		['subsystems', '--sort', 'importance', '--all-items', '--format', 'json'],
		90_000,
		'subsystems',
	);

	let regions: NormalizedIxRegion[] = [];
	for (const discovery of results.filter(r => r.phase === 'discovery' && r.ok)) {
		collectRegions(discovery.json, regions);
	}

	// 2) Fall back to ix map only if subsystem discovery could not provide any regions.
	if (!regions.length) {
		await run('discovery', 'ix map --format json .', ['map', '--format', 'json', '.'], 90_000, 'map');
		regions = [];
		for (const discovery of results.filter(r => r.phase === 'discovery' && r.ok)) {
			collectRegions(discovery.json, regions);
		}
	}

	if (!regions.length) {
		await run('discovery', 'ix inventory --format json', ['inventory', '--format', 'json'], 90_000, 'inventory');
		const inventory = firstJsonResult(results, 'ix inventory');
		if (inventory) {
			collectRegions(inventory, regions);
		}
	}

	const deterministic = scoreRegions(userPrompt, regions);
	onProgress?.({ phase: 'selection', label: 'Selecting candidates', status: 'start' });
	const selection = await selectProcessCandidates(
		userPrompt,
		deterministic.candidates.map(c => ({ id: c.id, label: c.label, labelKind: c.labelKind, level: c.level, score: c.score, keywords: c.keywords })),
		deterministic.keywords,
		deterministic.reason,
	);
	onProgress?.({ phase: 'selection', label: 'Selecting candidates', status: 'success', detail: selection.reason });
	raw.push({
		label: 'process.candidate-selection',
		json: {
			selectedBy: selection.selectedBy,
			candidateIds: selection.candidateIds,
			keywords: selection.keywords,
			reason: selection.reason,
		},
	});
	results.push({
		phase: 'selection',
		label: 'process.candidate-selection',
		args: [],
		ok: true,
		json: selection,
		ref: 'candidate-selection',
	});

	const candidateById = new Map(deterministic.candidates.map(c => [c.id, c]));
	const selectedRegions = selection.candidateIds.map(id => candidateById.get(id)).filter((r): r is NormalizedIxRegion => Boolean(r)).slice(0, 5);

	const resolved: ResolvedIxTarget[] = [];
	onProgress?.({ phase: 'resolution', label: 'Resolving targets', status: 'start' });

	if (selectedRegions.length) {
		// Forced selection from a system/subsystem card — these labels (e.g. "Channels", "Ast",
		// "Graphify Out") are architectural region names, not graph entity names. `ix search` /
		// `ix locate` operate on real entities (files, symbols, functions) and reliably return
		// nothing for region labels, so we'd just be paying for two doomed CLI calls per term and
		// falling through to the subsystem-region path anyway. Skip straight to that path.
		onProgress?.({
			phase: 'resolution',
			label: 'Subsystem region resolution',
			status: 'info',
			detail: localize(
				'customMode.processNotes.subsystemPath',
				'Selected from card: skipping ix search/locate (those operate on graph entities, not region labels) and using subsystem labels + path hints from ix subsystems JSON.',
			),
		});
		for (const r of selectedRegions.slice(0, 3)) {
			resolved.push({
				target: r.label,
				kind: r.labelKind ?? 'region',
				source: 'subsystem',
				score: 12,
			});
			for (const p of collectPathHintsFromSubsystemRaw(r.raw)) {
				resolved.push({
					target: p,
					kind: 'file',
					path: p,
					source: 'subsystem',
					score: 8,
				});
			}
		}
	} else {
		// Free-form prompt with no card selection — keywords from the user's prompt are real-ish
		// search terms, so the entity-level CLIs are useful here.
		for (const term of selection.keywords.slice(0, 3)) {
			if (isLowSignalResolutionTerm(term)) {
				continue;
			}
			const search = await run('resolution', `ix search ${term} --format json`, ['search', term, '--format', 'json'], 30_000, term);
			if (search?.ok) {
				resolved.push(...extractTargets(search.json, 'search', term, 3));
			}
			const locate = await run('resolution', `ix locate ${term} --format json`, ['locate', term, '--format', 'json'], 30_000, term);
			if (locate?.ok) {
				resolved.push(...extractTargets(locate.json, 'locate', term, 4));
			}
		}
		if (!resolved.length) {
			for (const kw of selection.keywords.slice(0, 3)) {
				if (isLowSignalResolutionTerm(kw)) {
					continue;
				}
				const text = await run('resolution', `ix text ${kw} --format json`, ['text', kw, '--format', 'json'], 30_000, kw);
				if (text?.ok) {
					resolved.push(...extractTargets(text.json, 'text', kw, 1.5));
				}
			}
		}
	}
	onProgress?.({
		phase: 'resolution',
		label: 'Resolving targets',
		status: 'success',
		detail: `resolved=${resolved.length}`,
	});

	const targets = uniqueTargets(resolved).filter(isDeepenCandidate).slice(0, 2);
	if (!targets.length) {
		onProgress?.({ phase: 'deepening', label: 'Deepening evidence', status: 'info', detail: 'No resolved Ix entities; skipping ix explain/overview.' });
	} else {
		onProgress?.({ phase: 'deepening', label: 'Deepening evidence', status: 'start', detail: targets.map(t => t.target).join(', ') });
	}
	for (const target of targets) {
		const subsystemRegionOnly = target.source === 'subsystem' && !target.path;
		if (subsystemRegionOnly) {
			if (commandBudget <= 0) {
				break;
			}
			commandBudget--;
			onProgress?.({ phase: 'deepening', label: `ix subsystems ${target.target} --explain`, status: 'start' });
			const res = await runIxSubsystemExplainWithDisambiguation(ix, cwd, target.target, target.kind, 90_000);
			onProgress?.({
				phase: 'deepening',
				label: `ix subsystems ${target.target} --explain`,
				status: res.ok ? 'success' : 'error',
				detail: res.ok ? undefined : res.error,
			});
			const logLabel = `ix subsystems ${target.target} --explain --format json`;
			if (res.ok) {
				raw.push({ label: logLabel, json: res.value });
				citations.push(ixCitation(logLabel, target.target));
				results.push({ phase: 'deepening', label: logLabel, args: [], ok: true, json: res.value, ref: target.target });
			} else {
				const json = { error: res.error, exitCode: res.exitCode, raw: res.raw };
				raw.push({ label: logLabel, json });
				results.push({ phase: 'deepening', label: logLabel, args: [], ok: false, json, error: res.error, ref: target.target });
			}
			continue;
		}
		const explainTarget = target.path ?? target.target;
		await run('deepening', `ix explain ${explainTarget} --format json`, ['explain', explainTarget, '--format', 'json'], 60_000, explainTarget);
		await run('deepening', `ix overview ${explainTarget} --format json`, ['overview', explainTarget, '--format', 'json'], 60_000, explainTarget);
	}
	if (targets.length) {
		onProgress?.({ phase: 'deepening', label: 'Deepening evidence', status: 'success' });
	}

	const state = ix.getState();
	const pipelineSlice = state.pipelineSteps
		.filter(s => s.kind === 'workspace' || /map/i.test(s.label) || /map/i.test(s.id))
		.slice(0, 12)
		.map(s => ({
			id: s.id,
			label: s.label,
			status: s.status,
			command: s.command,
			outputTail: s.outputTail.slice(0, 8000),
		}));
	if (pipelineSlice.length) {
		raw.push({ label: 'ix.pipeline.snapshot(map-related)', json: pipelineSlice });
		citations.push(ixCitation('ix.pipeline.snapshot', 'workspace-map-steps'));
		results.push({ phase: 'context', label: 'ix.pipeline.snapshot(map-related)', args: [], ok: true, json: pipelineSlice, ref: 'workspace-map-steps' });
	}
	if (state.lastOutput && state.lastOutput.length < 12000) {
		raw.push({ label: 'ix.state.lastOutput', json: state.lastOutput });
		results.push({ phase: 'context', label: 'ix.state.lastOutput', args: [], ok: true, json: state.lastOutput, ref: 'last-output' });
	}

	const selectedNodes = selectedRegions.slice(0, 5).map((r, i): ProcessGraphNode => ({
		id: `subsystem:${i}`,
		label: r.label,
		kind: 'phase',
		lane: 'Build',
		citations: [ixCitation('ix subsystems --format json', r.label)],
	}));
	const targetNodes = targets.map((t, i): ProcessGraphNode => ({
		id: `target:${i}`,
		label: t.target,
		kind: subsystemRegionOnly(t) ? 'phase' : t.kind === 'file' || t.path ? 'file' : 'symbol',
		lane: 'Host',
		citations: [
			subsystemRegionOnly(t)
				? ixCitation(`ix subsystems --target ${t.target} --explain --format json`, t.target)
				: ixCitation(`ix ${t.source} ${t.target} --format json`, t.target),
		],
	}));
	nodes.push(...selectedNodes, ...targetNodes);
	for (const n of selectedNodes) {
		edges.push({ from: 'userQuery', to: n.id, type: 'other', evidence: selection.reason });
	}
	for (const n of targetNodes) {
		edges.push({ from: selectedNodes[0]?.id ?? 'userQuery', to: n.id, type: 'other', evidence: localize('customMode.processNotes.custom.edge.resolvedTarget', 'Resolved Ix target for explain/overview') });
	}

	raw.push({
		label: 'process.evidence-summary',
		json: {
			commands: summarizeCommandResults(results),
			selectedRegions: selectedRegions.map(r => ({ id: r.id, label: r.label, score: r.score, labelKind: r.labelKind, level: r.level })),
			resolvedTargets: targets,
		},
	});

	return {
		userPrompt,
		anchors: nodes,
		graph: { nodes, edges },
		citations,
		raw,
		commandPhases: commandPhases(results),
		selection,
		binding: makeBinding(userPrompt, selection, selectedRegions, targets, results),
	};
}

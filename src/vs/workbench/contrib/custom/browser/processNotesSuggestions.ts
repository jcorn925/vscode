/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProcessNoteSuggestion, ProcessNoteSuggestionKind, ProcessTopicsFile } from './processNotesTypes.js';

function stableHash(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countLikelyTargets(json: unknown): number {
	let count = 0;
	const visit = (v: unknown): void => {
		if (count >= 40) {
			return;
		}
		if (Array.isArray(v)) {
			for (const item of v) {
				visit(item);
			}
			return;
		}
		if (!isRecord(v)) {
			return;
		}
		if (typeof v.path === 'string' || typeof v.name === 'string' || typeof v.symbol === 'string' || typeof v.entity === 'string' || typeof v.label === 'string') {
			count++;
		}
		for (const key of ['results', 'matches', 'items', 'entities', 'candidates']) {
			if (key in v) {
				visit(v[key]);
			}
		}
	};
	visit(json);
	return count;
}

function splitWords(text: string): string[] {
	const withCamel = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
	return withCamel
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter(Boolean);
}

const PROCESS_HINT_TOKENS = new Set([
	'generate', 'scrape', 'download', 'upload', 'import', 'export', 'ingest', 'fetch',
	'build', 'compile', 'bundle', 'watch', 'map', 'sync', 'refresh', 'resolve', 'install', 'start',
	'pipeline', 'workflow', 'queue', 'scheduler', 'job', 'task', 'runner', 'worker',
	'route', 'routes', 'api', 'server', 'cli', 'dashboard', 'modal', 'webview', 'panel',
]);

function looksLikeTestLabel(label: string): boolean {
	return /^test\b/i.test(label) || /\btest\b/i.test(label);
}

function kindFromLabelKind(labelKind: string | undefined): ProcessNoteSuggestionKind {
	switch ((labelKind ?? '').toLowerCase()) {
		case 'system': return 'system';
		case 'subsystem': return 'subsystem';
		default: return 'module';
	}
}

function confidence01(confidence: unknown): number | undefined {
	if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
		return undefined;
	}
	return confidence > 1 ? confidence / 100 : confidence;
}

function numberField(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textField(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
}

type NormalizedRegion = {
	label: string;
	labelKind?: string;
	level?: number;
	parentLabel?: string;
	files?: number;
	confidence?: number;
	crosscut?: number;
	signals?: readonly string[];
};

function collectRegions(value: unknown, out: NormalizedRegion[], parentLabel?: string, level = 0): void {
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
	const labelKind = textField(value.label_kind) ?? textField(value.kind) ?? textField(value.type);
	const explicitLevel = numberField(value.level) ?? level;
	const files = numberField(value.files) ?? numberField(value.file_count) ?? numberField(value.count);
	const confidence = confidence01(value.confidence) ?? confidence01(value.clarity) ?? confidence01(value.score);
	const crosscut = numberField(value.crosscut) ?? numberField(value.cross_cut);
	const signals = Array.isArray(value.signals) ? value.signals.filter((s): s is string => typeof s === 'string') : undefined;

	if (label) {
		out.push({ label, labelKind, level: explicitLevel, parentLabel, files, confidence, crosscut, signals });
	}
	for (const key of ['children', 'items', 'modules', 'subsystems', 'systems', 'regions', 'branches']) {
		if (key in value) {
			collectRegions(value[key], out, label ?? parentLabel, explicitLevel + 1);
		}
	}
}

function processHintScore(label: string, parentLabel?: string): number {
	const tokens = new Set(splitWords([label, parentLabel].filter(Boolean).join(' ')));
	let hits = 0;
	for (const t of tokens) {
		if (PROCESS_HINT_TOKENS.has(t)) {
			hits++;
		}
	}
	return hits;
}

export function computeProcessSuggestionsFromIxDiscovery(
	input: {
		readonly workspaceUri?: string;
		readonly mapRev?: string;
		readonly discoveryJsons: readonly unknown[];
		readonly generatedAt: number;
	},
): ProcessTopicsFile {
	const regions: NormalizedRegion[] = [];
	for (const j of input.discoveryJsons) {
		collectRegions(j, regions);
	}

	const scored = regions.map(r => {
		const hint = processHintScore(r.label, r.parentLabel);
		const conf = r.confidence ?? 0;
		const signals = r.signals?.length ?? 0;
		const specificity = r.level !== undefined && r.level >= 2 ? 0.25 : 0;
		const broadPenalty = (r.files ?? 0) > 1500 ? -0.5 : 0;
		const testPenalty = looksLikeTestLabel(r.label) ? -1.0 : 0;
		const crosscutPenalty = (r.crosscut ?? 0) >= 0.2 ? -0.25 : 0;
		const score = 1.25 * hint + 0.75 * conf + 0.15 * signals + specificity + broadPenalty + testPenalty + crosscutPenalty;
		return { region: r, score, hint };
	}).filter(x => x.score > 0.4);

	scored.sort((a, b) => b.score - a.score);

	const seen = new Set<string>();
	const suggestions: ProcessNoteSuggestion[] = [];
	for (const s of scored) {
		const label = s.region.label;
		const key = label.toLowerCase().replace(/\s+/g, ' ').trim();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);

		const kind = kindFromLabelKind(s.region.labelKind);
		const subsystemKey = stableHash(`${s.region.labelKind ?? ''}|${s.region.level ?? ''}|${s.region.parentLabel ?? ''}|${label}|${s.region.files ?? ''}`);
		const templates = [
			`How does ${label} work?`,
			`What is the ${label} pipeline?`,
			`How does ${label} run end-to-end (UI → API → core logic)?`,
		];
		const id = stableHash(`${subsystemKey}|${label}|t0`);
		suggestions.push({
			id,
			label,
			subsystemKey,
			kind,
			confidence: s.region.confidence,
			files: s.region.files,
			crosscut: s.region.crosscut,
			signals: s.region.signals,
			promptTemplates: templates,
		});
		if (suggestions.length >= 36) {
			break;
		}
	}

	return {
		version: 1,
		generatedAt: input.generatedAt,
		workspaceUri: input.workspaceUri,
		mapRev: input.mapRev,
		suggestions,
	};
}

export function applyProbeResults(
	topics: ProcessTopicsFile,
	probes: readonly { readonly label: string; readonly ok: boolean; readonly json?: unknown; readonly ranAt: number }[],
): ProcessTopicsFile {
	const byLabel = new Map(probes.map(p => [p.label, p]));
	const suggestions = topics.suggestions.map(s => {
		const p = byLabel.get(s.label);
		if (!p) {
			return s;
		}
		const resolvedTargets = p.ok && p.json !== undefined ? countLikelyTargets(p.json) : 0;
		return {
			...s,
			probe: {
				ok: p.ok && resolvedTargets > 0,
				resolvedTargets,
				ranAt: p.ranAt,
			}
		};
	});
	return { ...topics, suggestions };
}


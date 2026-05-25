/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import type { ProcessNoteSuggestionKind } from './processNotesTypes.js';

/** Regions below this confidence get a "low confidence" chip in the UI. */
export const LOW_CONFIDENCE_THRESHOLD = 0.15;

export interface SubsystemFingerprint {
	readonly regionId: string;
	readonly name: string;
	readonly labelKind: ProcessNoteSuggestionKind;
	readonly level: number;
	readonly fileCount: number;
	readonly importsOutTotal: number;
	readonly callsOutTotal: number;
	readonly importsInTotal: number;
	readonly callsInTotal: number;
	readonly healthScore?: number;
	readonly confidence?: number;
	readonly entryPath?: string;
	readonly topDependencyPath?: string;
	readonly inboundSummary?: string;
	readonly couplingSummary: string;
	readonly prompt: string;
}

export interface BuildIxSubsystemsDetailedDiscoveryArgsOptions {
	readonly edgeCap?: number;
	readonly memberFileCap?: number;
	readonly limit?: number;
	readonly offset?: number;
	readonly regions?: readonly string[];
}

const ENTRY_ROUTE_RE = /(^|\/)app\/api\/.+\/route\.(ts|tsx)$/i;
const ENTRY_PAGE_RE = /(^|\/)app\/.+\/page\.(tsx|jsx)$/i;
const ENTRY_LAYOUT_RE = /(^|\/)app\/.+\/layout\.(tsx|jsx)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function kindFromLabelKind(labelKind: string | undefined): ProcessNoteSuggestionKind {
	switch ((labelKind ?? '').toLowerCase()) {
		case 'system': return 'system';
		case 'subsystem': return 'subsystem';
		default: return 'module';
	}
}

function memberPaths(region: Record<string, unknown>): Set<string> {
	const out = new Set<string>();
	const members = region.member_files;
	if (!Array.isArray(members)) {
		return out;
	}
	for (const m of members) {
		if (!isRecord(m)) {
			continue;
		}
		const p = textField(m.path);
		if (p) {
			out.add(normalizePath(p));
		}
	}
	return out;
}

function totalField(region: Record<string, unknown>, totalKey: string, arrayKey: string): number {
	const total = numberField(region[totalKey]);
	if (total !== undefined) {
		return total;
	}
	const arr = region[arrayKey];
	return Array.isArray(arr) ? arr.length : 0;
}

function isSelfEdge(srcPath: string | undefined, dstPath: string | undefined): boolean {
	if (!srcPath || !dstPath) {
		return false;
	}
	return normalizePath(srcPath) === normalizePath(dstPath);
}

export function pickEntryPath(region: Record<string, unknown>): string | undefined {
	const members = region.member_files;
	if (!Array.isArray(members) || !members.length) {
		return undefined;
	}
	const paths: string[] = [];
	for (const m of members) {
		if (isRecord(m)) {
			const p = textField(m.path);
			if (p) {
				paths.push(normalizePath(p));
			}
		}
	}
	if (!paths.length) {
		return undefined;
	}
	for (const p of paths) {
		if (ENTRY_ROUTE_RE.test(p)) {
			return p;
		}
	}
	for (const p of paths) {
		if (ENTRY_PAGE_RE.test(p)) {
			return p;
		}
	}
	for (const p of paths) {
		if (ENTRY_LAYOUT_RE.test(p)) {
			return p;
		}
	}
	return paths[0];
}

export function pickTopExternalDependency(region: Record<string, unknown>): string | undefined {
	const members = memberPaths(region);
	const imports = region.imports_out;
	if (!Array.isArray(imports)) {
		return undefined;
	}
	for (const edge of imports) {
		if (!isRecord(edge)) {
			continue;
		}
		const srcPath = textField(edge.src_path);
		const dstPath = textField(edge.dst_path);
		if (!dstPath || isSelfEdge(srcPath, dstPath)) {
			continue;
		}
		const normalizedDst = normalizePath(dstPath);
		if (!members.has(normalizedDst)) {
			return normalizedDst;
		}
	}
	return undefined;
}

export function formatInboundSummary(callsInTotal: number, importsInTotal: number): string | undefined {
	const parts: string[] = [];
	if (callsInTotal > 0) {
		parts.push(callsInTotal === 1 ? '1 caller' : `${callsInTotal} callers`);
	}
	if (importsInTotal > 0) {
		parts.push(importsInTotal === 1 ? '1 importer' : `${importsInTotal} importers`);
	}
	return parts.length ? parts.join(' · ') : undefined;
}

export function formatCouplingSummary(fileCount: number, importsOutTotal: number, callsOutTotal: number): string {
	const filesLabel = fileCount === 1 ? '1 file' : `${fileCount} files`;
	return `${filesLabel} · ${importsOutTotal} imports out · ${callsOutTotal} calls`;
}

export function buildStructureAwarePrompt(
	name: string,
	kind: ProcessNoteSuggestionKind,
	entryPath: string | undefined,
	topDependencyPath: string | undefined,
	importsOutTotal: number,
	callsOutTotal: number,
	importsInTotal: number,
	callsInTotal: number,
): string {
	if (callsOutTotal > 0 && entryPath) {
		return `Trace calls from ${entryPath} across outbound call edges in "${name}".`;
	}
	if (importsOutTotal > 0 && entryPath && topDependencyPath) {
		return `Trace imports from ${entryPath} through ${topDependencyPath} in the "${name}" ${kind}.`;
	}
	if ((importsInTotal + callsInTotal) > 0) {
		return `Who depends on "${name}" and how?`;
	}
	return `Explain the "${name}" ${kind} end-to-end.`;
}

function regionRecords(json: unknown): Record<string, unknown>[] {
	// Accept a bare array at the top level (some ix subcommands return that shape).
	if (Array.isArray(json)) {
		return json.filter((r): r is Record<string, unknown> => isRecord(r));
	}
	if (!isRecord(json)) {
		return [];
	}
	// Different ix subcommands/versions wrap region records under different keys.
	// Probe the well-known ones in priority order and accept the first array we find.
	const candidates: ReadonlyArray<unknown> = [
		json.scores,
		json.regions,
		json.subsystems,
		json.items,
		json.results,
		json.data,
	];
	for (const c of candidates) {
		if (Array.isArray(c)) {
			return c.filter((r): r is Record<string, unknown> => isRecord(r));
		}
	}
	// Last resort: collect any top-level array property whose first element looks
	// like a region record (has a region_id or label_kind). Avoids needing to
	// hand-maintain a wrapper-key list as ix evolves.
	for (const value of Object.values(json)) {
		if (!Array.isArray(value) || value.length === 0) {
			continue;
		}
		const first = value[0];
		if (isRecord(first) && (typeof first.region_id === 'string' || typeof first.label_kind === 'string')) {
			return value.filter((r): r is Record<string, unknown> => isRecord(r));
		}
	}
	return [];
}

export function parseSubsystemFingerprints(json: unknown): SubsystemFingerprint[] {
	const out: SubsystemFingerprint[] = [];
	for (const region of regionRecords(json)) {
		const name = textField(region.name) ?? textField(region.label) ?? textField(region.title);
		if (!name) {
			continue;
		}
		const regionId = textField(region.region_id) ?? textField(region.regionId) ?? name;
		const labelKind = kindFromLabelKind(textField(region.label_kind) ?? textField(region.kind) ?? textField(region.type));
		const level = numberField(region.level) ?? (labelKind === 'system' ? 3 : labelKind === 'subsystem' ? 2 : 1);
		const fileCount = numberField(region.file_count) ?? numberField(region.files) ?? numberField(region.count) ?? 0;
		const importsOutTotal = totalField(region, 'imports_out_total', 'imports_out');
		const callsOutTotal = totalField(region, 'calls_out_total', 'calls_out');
		const importsInTotal = totalField(region, 'imports_in_total', 'imports_in');
		const callsInTotal = totalField(region, 'calls_in_total', 'calls_in');
		const healthScore = numberField(region.health_score);
		const confidenceRaw = numberField(region.confidence) ?? numberField(region.clarity) ?? numberField(region.score);
		const confidence = confidenceRaw !== undefined && confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw;
		const entryPath = pickEntryPath(region);
		const topDependencyPath = pickTopExternalDependency(region);
		const inboundSummary = formatInboundSummary(callsInTotal, importsInTotal);
		const couplingSummary = formatCouplingSummary(fileCount, importsOutTotal, callsOutTotal);
		const prompt = buildStructureAwarePrompt(
			name,
			labelKind,
			entryPath,
			topDependencyPath,
			importsOutTotal,
			callsOutTotal,
			importsInTotal,
			callsInTotal,
		);
		out.push({
			regionId,
			name,
			labelKind,
			level,
			fileCount,
			importsOutTotal,
			callsOutTotal,
			importsInTotal,
			callsInTotal,
			healthScore,
			confidence,
			entryPath,
			topDependencyPath,
			inboundSummary,
			couplingSummary,
			prompt,
		});
	}
	return out;
}

export function buildIxSubsystemsDetailedDiscoveryArgs(options: BuildIxSubsystemsDetailedDiscoveryArgsOptions = {}): string[] {
	const args: string[] = ['subsystems', '--list', '--detailed', '--sort', 'importance', '--format', 'json'];
	if (options.edgeCap !== undefined) {
		args.push('--edge-cap', String(options.edgeCap));
	}
	if (options.memberFileCap !== undefined) {
		args.push('--member-file-cap', String(options.memberFileCap));
	}
	if (options.limit !== undefined) {
		args.push('--limit', String(options.limit));
	}
	if (options.offset !== undefined) {
		args.push('--offset', String(options.offset));
	}
	if (options.regions?.length) {
		args.push('--regions', options.regions.join(','));
	}
	return args;
}

export const IX_SUBSYSTEMS_DETAILED_DISCOVERY_MINIMAL_ARGS: readonly string[] = [
	'subsystems', '--list', '--detailed', '--sort', 'importance', '--format', 'json', '--all-items',
];

export function isIxUnknownOptionError(error: string | undefined): boolean {
	return Boolean(error && /unknown option/i.test(error));
}

export function isIxUnknownOptionFailure(error: string | undefined, raw?: string): boolean {
	return isIxUnknownOptionError(error) || isIxUnknownOptionError(raw);
}

export function isIxBackendUnreachableError(error: string | undefined, raw?: string): boolean {
	const text = `${error ?? ''}\n${raw ?? ''}`;
	return /fetch failed|ECONNREFUSED|connection refused|connect ECONNREFUSED/i.test(text);
}

export function formatIxDiscoveryFailureHint(error: string | undefined, raw?: string): string | undefined {
	if (!isIxBackendUnreachableError(error, raw)) {
		return undefined;
	}
	return 'Ix backend is not reachable (port 8090). Run `ix docker start` and fix any port conflicts, then reload.';
}

export function ixSubsystemsDetailedDiscoveryArgsAfterUnknownOption(
	failedArgs: readonly string[],
): readonly string[] {
	const minimal = [...IX_SUBSYSTEMS_DETAILED_DISCOVERY_MINIMAL_ARGS];
	const optionalFlags = new Set(['--edge-cap', '--member-file-cap', '--limit', '--offset', '--regions']);
	const stripped: string[] = [];
	for (let i = 0; i < failedArgs.length; i++) {
		const arg = failedArgs[i]!;
		if (optionalFlags.has(arg)) {
			if (arg === '--regions' || arg === '--edge-cap' || arg === '--member-file-cap' || arg === '--limit' || arg === '--offset') {
				i++;
			}
			continue;
		}
		stripped.push(arg);
	}
	if (stripped.length >= 5 && stripped[0] === 'subsystems' && stripped.includes('--list') && stripped.includes('--detailed')) {
		return stripped.includes('--all-items') ? stripped : [...stripped, '--all-items'];
	}
	return minimal;
}

export async function runSubsystemsDetailedDiscovery(
	ix: IIxIntegrationService,
	cwd: URI,
	timeoutMs: number,
	options: BuildIxSubsystemsDetailedDiscoveryArgsOptions = { edgeCap: 8, memberFileCap: 12 },
): Promise<{ ok: true; value: unknown; args: readonly string[] } | { ok: false; error: string; raw: string; args: readonly string[] }> {
	let args = buildIxSubsystemsDetailedDiscoveryArgs(options);
	let res = await ix.runJsonQuery(args, cwd, timeoutMs);
	while (!res.ok && isIxUnknownOptionFailure(res.error, res.raw)) {
		args = [...ixSubsystemsDetailedDiscoveryArgsAfterUnknownOption(args)];
		res = await ix.runJsonQuery(args, cwd, timeoutMs);
	}
	if (res.ok) {
		return { ok: true, value: res.value, args };
	}
	return { ok: false, error: res.error, raw: res.raw, args };
}

export function formatIxSubsystemsDetailedDiscoveryCommand(args: readonly string[]): string {
	return `ix ${args.join(' ')}`;
}

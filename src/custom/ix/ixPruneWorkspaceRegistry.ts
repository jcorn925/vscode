/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Options for scripts/ix_prune_workspace_registry.py */
export interface IxPruneWorkspaceRegistryOptions {
	readonly apply?: boolean;
	readonly alsoMtimes?: boolean;
	readonly configPath?: string;
}

export interface IxPruneWorkspaceRegistryReasonCount {
	readonly reason: string;
	readonly count: number;
}

export interface IxPruneWorkspaceRegistrySummary {
	readonly before: number;
	readonly keep: number;
	readonly remove: number;
	readonly byReason: readonly IxPruneWorkspaceRegistryReasonCount[];
	readonly orphanMtimes?: number;
}

/** CLI argv after the script path (no python interpreter). */
export function buildIxPruneWorkspaceRegistryArgs(options?: IxPruneWorkspaceRegistryOptions): string[] {
	const args: string[] = [];
	if (options?.configPath?.trim()) {
		args.push('--config', options.configPath.trim());
	}
	if (options?.apply) {
		args.push('--apply');
	}
	if (options?.alsoMtimes) {
		args.push('--also-mtimes');
	}
	return args;
}

/** Parse dry-run / apply stdout from ix_prune_workspace_registry.py. */
export function parseIxPruneWorkspaceRegistrySummary(output: string): IxPruneWorkspaceRegistrySummary | undefined {
	const before = matchInt(output, /^before:\s*(\d+)\s*$/m);
	const keep = matchInt(output, /^keep:\s*(\d+)\s*$/m);
	const remove = matchInt(output, /^remove:\s*(\d+)\s*$/m);
	if (before === undefined || keep === undefined || remove === undefined) {
		return undefined;
	}
	const byReason: IxPruneWorkspaceRegistryReasonCount[] = [];
	for (const match of output.matchAll(/^\s+-\s+(.+):\s*(\d+)\s*$/gm)) {
		const reason = match[1]?.trim();
		const count = Number(match[2]);
		if (reason && Number.isFinite(count)) {
			byReason.push({ reason, count });
		}
	}
	const orphanMtimes = matchInt(output, /^orphan ingest_mtimes_\*\.json:\s*(\d+)\s*$/m);
	return {
		before,
		keep,
		remove,
		byReason,
		...(orphanMtimes !== undefined ? { orphanMtimes } : {}),
	};
}

export function formatIxPruneWorkspaceRegistryDetail(summary: IxPruneWorkspaceRegistrySummary): string {
	const lines = [
		`Current registrations: ${summary.before}`,
		`Keep: ${summary.keep}`,
		`Remove: ${summary.remove}`,
	];
	for (const row of summary.byReason) {
		lines.push(`• ${row.reason}: ${row.count}`);
	}
	if (summary.orphanMtimes !== undefined) {
		lines.push(`Orphan ingest_mtimes caches: ${summary.orphanMtimes}`);
	}
	return lines.join('\n');
}

function matchInt(text: string, pattern: RegExp): number | undefined {
	const match = text.match(pattern);
	if (!match?.[1]) {
		return undefined;
	}
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

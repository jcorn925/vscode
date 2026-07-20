/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { basename, joinPath } from '../../vs/base/common/resources.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';
import { workspacePlanAnalysisResource } from './workspacePlanPaths.js';

/** Max archived reports kept under `.agent/workspace/plan-analysis/`. */
export const WORKSPACE_PLAN_ANALYSIS_HISTORY_MAX = 20;

export interface WorkspacePlanAnalysisRun {
	readonly resource: URI;
	/** Archive filename stamp (`YYYYMMDD-HHMMSS`), undefined for the live report. */
	readonly stamp: string | undefined;
	readonly isLive: boolean;
	readonly mtimeMs: number;
	readonly heading: string | undefined;
	readonly label: string;
}

/** History directory for archived Kickoff analysis reports. */
export function workspacePlanAnalysisHistoryDir(workspaceFolder: URI): URI {
	return joinPath(workspaceFolder, '.agent', 'workspace', 'plan-analysis');
}

/** UTC stamp used as the archive filename stem (`YYYYMMDD-HHMMSS`). */
export function formatWorkspacePlanAnalysisArchiveStamp(date: Date = new Date()): string {
	const y = date.getUTCFullYear();
	const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	const h = String(date.getUTCHours()).padStart(2, '0');
	const mi = String(date.getUTCMinutes()).padStart(2, '0');
	const s = String(date.getUTCSeconds()).padStart(2, '0');
	return `${y}${mo}${d}-${h}${mi}${s}`;
}

export function workspacePlanAnalysisArchiveResource(workspaceFolder: URI, stamp: string): URI {
	return joinPath(workspacePlanAnalysisHistoryDir(workspaceFolder), `${stamp}.md`);
}

/** Parse `YYYYMMDD-HHMMSS` (optional `.md`) into a UTC Date. */
export function parseWorkspacePlanAnalysisArchiveStamp(fileName: string): Date | undefined {
	const stem = fileName.replace(/\.md$/i, '').trim();
	const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/.exec(stem);
	if (!match) {
		return undefined;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const ms = Date.UTC(year, month - 1, day, hour, minute, second);
	if (!Number.isFinite(ms)) {
		return undefined;
	}
	const date = new Date(ms);
	// Reject overflow (e.g. month 13) by round-tripping components.
	if (
		date.getUTCFullYear() !== year
		|| date.getUTCMonth() + 1 !== month
		|| date.getUTCDate() !== day
	) {
		return undefined;
	}
	return date;
}

/** First ATX heading (`# …`) in markdown, trimmed. */
export function firstMarkdownHeading(raw: string): string | undefined {
	for (const line of raw.split(/\r?\n/)) {
		const match = /^#\s+(.+?)\s*$/.exec(line);
		if (match?.[1]) {
			const heading = match[1].trim();
			if (heading) {
				return heading;
			}
		}
	}
	return undefined;
}

export function formatWorkspacePlanAnalysisRunLabel(options: {
	readonly isLive: boolean;
	readonly stamp?: string;
	readonly heading?: string;
	readonly mtimeMs?: number;
}): string {
	const when = options.isLive
		? 'Latest'
		: formatArchiveStampLabel(options.stamp, options.mtimeMs);
	const heading = options.heading?.trim();
	return heading ? `${when} — ${heading}` : when;
}

function formatArchiveStampLabel(stamp: string | undefined, mtimeMs: number | undefined): string {
	const fromStamp = stamp ? parseWorkspacePlanAnalysisArchiveStamp(stamp) : undefined;
	const date = fromStamp ?? (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) ? new Date(mtimeMs) : undefined);
	if (!date) {
		return stamp?.trim() || 'Analysis';
	}
	return date.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

/**
 * Given archive filenames (newest-first preferred but not required), return names to delete
 * so at most `max` remain.
 */
export function pruneWorkspacePlanAnalysisHistoryNames(
	fileNames: readonly string[],
	max: number = WORKSPACE_PLAN_ANALYSIS_HISTORY_MAX,
): string[] {
	const archives = fileNames
		.filter(name => /\.md$/i.test(name) && parseWorkspacePlanAnalysisArchiveStamp(name))
		.slice()
		.sort((a, b) => b.localeCompare(a)); // YYYYMMDD-HHMMSS sorts newest-first
	if (archives.length <= max) {
		return [];
	}
	return archives.slice(max);
}

/** Newest-first: live first, then by mtime/stamp. */
export function compareWorkspacePlanAnalysisRuns(
	a: WorkspacePlanAnalysisRun,
	b: WorkspacePlanAnalysisRun,
): number {
	if (a.isLive !== b.isLive) {
		return a.isLive ? -1 : 1;
	}
	if (b.mtimeMs !== a.mtimeMs) {
		return b.mtimeMs - a.mtimeMs;
	}
	return (b.stamp ?? '').localeCompare(a.stamp ?? '');
}

/**
 * Copy the live report into the history dir (if present). Does not delete the live file.
 * Returns the archive URI, or undefined when there was nothing to archive.
 */
export async function archiveWorkspacePlanAnalysis(
	fileService: IFileService,
	workspaceFolder: URI,
	now: Date = new Date(),
): Promise<URI | undefined> {
	const live = workspacePlanAnalysisResource(workspaceFolder);
	if (!(await fileService.exists(live))) {
		return undefined;
	}
	const historyDir = workspacePlanAnalysisHistoryDir(workspaceFolder);
	await fileService.createFolder(historyDir);
	const baseStamp = formatWorkspacePlanAnalysisArchiveStamp(now);
	let stamp = baseStamp;
	let target = workspacePlanAnalysisArchiveResource(workspaceFolder, stamp);
	let suffix = 1;
	while (await fileService.exists(target)) {
		stamp = `${baseStamp}-${suffix++}`;
		target = workspacePlanAnalysisArchiveResource(workspaceFolder, stamp);
	}
	await fileService.copy(live, target, false);
	await pruneWorkspacePlanAnalysisHistory(fileService, workspaceFolder);
	return target;
}

async function pruneWorkspacePlanAnalysisHistory(
	fileService: IFileService,
	workspaceFolder: URI,
): Promise<void> {
	const historyDir = workspacePlanAnalysisHistoryDir(workspaceFolder);
	try {
		if (!(await fileService.exists(historyDir))) {
			return;
		}
		const stat = await fileService.resolve(historyDir);
		const names = (stat.children ?? []).map(child => child.name);
		const toDelete = pruneWorkspacePlanAnalysisHistoryNames(names);
		await Promise.all(toDelete.map(async name => {
			try {
				await fileService.del(joinPath(historyDir, name));
			} catch {
				// best-effort prune
			}
		}));
	} catch {
		// best-effort prune
	}
}

/** Live report (if any) + archived runs, newest-first. */
export async function listWorkspacePlanAnalysisRuns(
	fileService: IFileService,
	workspaceFolder: URI,
): Promise<WorkspacePlanAnalysisRun[]> {
	const runs: WorkspacePlanAnalysisRun[] = [];
	const live = workspacePlanAnalysisResource(workspaceFolder);
	try {
		if (await fileService.exists(live)) {
			const [stat, content] = await Promise.all([
				fileService.stat(live),
				fileService.readFile(live).catch(() => undefined),
			]);
			const heading = content ? firstMarkdownHeading(content.value.toString()) : undefined;
			runs.push({
				resource: live,
				stamp: undefined,
				isLive: true,
				mtimeMs: stat.mtime,
				heading,
				label: formatWorkspacePlanAnalysisRunLabel({ isLive: true, heading, mtimeMs: stat.mtime }),
			});
		}
	} catch {
		// skip live
	}

	const historyDir = workspacePlanAnalysisHistoryDir(workspaceFolder);
	try {
		if (await fileService.exists(historyDir)) {
			const stat = await fileService.resolve(historyDir);
			for (const child of stat.children ?? []) {
				if (!child.isFile || !/\.md$/i.test(child.name)) {
					continue;
				}
				const stamp = basename(child.resource).replace(/\.md$/i, '');
				if (!parseWorkspacePlanAnalysisArchiveStamp(stamp)) {
					continue;
				}
				let heading: string | undefined;
				try {
					const content = await fileService.readFile(child.resource);
					heading = firstMarkdownHeading(content.value.toString());
				} catch {
					// ignore heading
				}
				const fromStamp = parseWorkspacePlanAnalysisArchiveStamp(stamp)?.getTime();
				const mtimeMs = typeof child.mtime === 'number' && Number.isFinite(child.mtime)
					? child.mtime
					: (fromStamp ?? 0);
				runs.push({
					resource: child.resource,
					stamp,
					isLive: false,
					mtimeMs,
					heading,
					label: formatWorkspacePlanAnalysisRunLabel({ isLive: false, stamp, heading, mtimeMs }),
				});
			}
		}
	} catch {
		// skip history
	}

	runs.sort(compareWorkspacePlanAnalysisRuns);
	return runs;
}

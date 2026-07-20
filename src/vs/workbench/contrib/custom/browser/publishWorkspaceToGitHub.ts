/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Match extensions/github publish sanitization for repo names. */
export function sanitizeGitHubRepositoryName(value: string): string {
	return value.trim().replace(/[^a-z0-9_.]/ig, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Default GitHub repo name for Publish to GitHub.
 * Prefer the workspace goal name; fall back to the folder basename.
 */
export function defaultGitHubRepositoryName(options: {
	readonly workspaceName?: string;
	readonly folderBasename?: string;
}): string {
	const fromWorkspace = sanitizeGitHubRepositoryName(options.workspaceName ?? '');
	if (fromWorkspace) {
		return fromWorkspace;
	}
	const fromFolder = sanitizeGitHubRepositoryName(options.folderBasename ?? '');
	return fromFolder || 'workspace';
}

/**
 * Build a bash one-liner that creates a GitHub repo from the cwd via `gh`,
 * initializing git when needed. Used when vscode.github is disabled (e.g. code.sh)
 * and there is no existing GitHub `origin` remote.
 */
export function buildGhPublishWorkspaceCommand(repoName: string, visibility: 'private' | 'public'): string {
	const name = sanitizeGitHubRepositoryName(repoName);
	if (!name) {
		throw new Error('Repository name is empty after sanitization.');
	}
	// Name is restricted to [A-Za-z0-9_.-] — safe unquoted in bash.
	const visibilityFlag = visibility === 'private' ? '--private' : '--public';
	return [
		'(git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init)',
		`&& gh repo create ${name} --source=. ${visibilityFlag} --remote=origin --push`,
	].join(' ');
}

/**
 * Push the current branch to an existing `origin` remote (no `gh repo create`).
 * Used when Publish to GitHub runs against a workspace already linked to GitHub.
 */
export function buildGitPushOriginCommand(): string {
	return [
		'git rev-parse --is-inside-work-tree >/dev/null 2>&1',
		'&& git push -u origin HEAD',
	].join(' ');
}

/** True when `origin` already points at a GitHub repository (create would be wrong). */
export function hasGitHubOriginRemote(configText: string | undefined): boolean {
	if (!configText?.trim()) {
		return false;
	}
	const remoteUrl = originRemoteUrlFromGitConfig(configText);
	return Boolean(remoteUrl && githubBrowseUrlFromRemote(remoteUrl));
}

export function isGithubPublishCommandMissingError(error: unknown): boolean {
	const message = String((error as Error)?.message ?? error).toLowerCase();
	return message.includes('github.publish') && message.includes('not found');
}

/** Read the `origin` remote URL from a `.git/config` file body. */
export function originRemoteUrlFromGitConfig(configText: string): string | undefined {
	const lines = configText.split(/\r?\n/);
	let inOrigin = false;
	for (const line of lines) {
		const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
		if (section) {
			inOrigin = /^remote\s+"origin"$/i.test(section[1].trim());
			continue;
		}
		if (!inOrigin) {
			continue;
		}
		const url = /^\s*url\s*=\s*(.+?)\s*$/i.exec(line);
		if (url?.[1]) {
			return url[1].trim();
		}
	}
	return undefined;
}

/** Convert a git remote URL into an https://github.com/... browse URL. */
export function githubBrowseUrlFromRemote(remoteUrl: string): string | undefined {
	const trimmed = remoteUrl.trim();
	if (!trimmed) {
		return undefined;
	}
	const scp = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
	if (scp) {
		return `https://github.com/${scp[1]}/${scp[2].replace(/\.git$/i, '')}`;
	}
	const ssh = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
	if (ssh) {
		return `https://github.com/${ssh[1]}/${ssh[2].replace(/\.git$/i, '')}`;
	}
	const https = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/(.+?)(?:\.git)?(?:\/|$)/i.exec(trimmed);
	if (https) {
		return `https://github.com/${https[1]}/${https[2].replace(/\.git$/i, '')}`;
	}
	return undefined;
}

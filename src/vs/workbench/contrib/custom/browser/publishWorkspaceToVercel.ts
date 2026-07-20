/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Resolve a production browse URL from a Vercel `.vercel/project.json` body.
 * Newer CLIs store `projectName`; older ones only have ids.
 */
export function vercelProductionUrlFromProjectJson(raw: string): string | undefined {
	try {
		const parsed = JSON.parse(raw) as { projectName?: unknown };
		const name = typeof parsed.projectName === 'string' ? parsed.projectName.trim() : '';
		if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
			return undefined;
		}
		return `https://${name}.vercel.app`;
	} catch {
		return undefined;
	}
}

/**
 * Bash one-liner: find the latest production deployment URL via `vercel ls` and open it.
 * Used when project.json has no projectName.
 */
export function buildOpenVercelDeploymentCommand(): string {
	return [
		`url=$(npx --yes vercel@latest ls 2>/dev/null | grep -Eo 'https://[^[:space:]]+' | grep vercel.app | head -1)`,
		'if [ -n "$url" ]; then',
		'  if command -v open >/dev/null 2>&1; then open "$url"',
		'  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"',
		'  else echo "$url"; fi',
		'else',
		'  echo "No Vercel deployment URL found. Publish to Vercel first, then try again."',
		'  npx --yes vercel@latest ls || true',
		'fi',
	].join('; ');
}

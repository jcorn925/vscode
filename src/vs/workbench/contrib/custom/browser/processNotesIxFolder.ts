/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import type { URI } from '../../../../base/common/uri.js';
import type { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import type { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/**
 * Workspace folder URI used as the Ix CWD / evidence root for Process notes.
 * Mirrors `IIxIntegrationService.runJsonQuery`'s fallback (first folder) unless
 * `custom.ix.preferredWorkspaceFolder` selects another multi-root folder.
 */
export function resolveIxEvidenceWorkspaceFolderUri(
	workspaceContextService: IWorkspaceContextService,
	configurationService: IConfigurationService,
): URI | undefined {
	const folders = workspaceContextService.getWorkspace().folders;
	if (!folders.length) {
		return undefined;
	}
	const prefRaw = String(configurationService.getValue<string>('custom.ix.preferredWorkspaceFolder') ?? '').trim();
	if (!prefRaw) {
		return folders[0]!.uri;
	}
	const norm = prefRaw.replace(/\\/g, '/').trim().toLowerCase();
	for (const f of folders) {
		if (f.name === prefRaw) {
			return f.uri;
		}
		const base = basename(f.uri)?.toLowerCase();
		if (base === norm) {
			return f.uri;
		}
		const fp = f.uri.fsPath.replace(/\\/g, '/').toLowerCase();
		const normNoTrail = norm.replace(/\/+$/, '');
		const fpNoTrail = fp.replace(/\/+$/, '');
		if (fp === norm || fpNoTrail === normNoTrail || fp.endsWith('/' + normNoTrail)) {
			return f.uri;
		}
	}
	return folders[0]!.uri;
}

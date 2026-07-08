/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentTaskTree } from './agentTaskTreeTypes.js';
import { treeHasActiveWork } from './agentTaskTreeService.js';

export type SurfaceMainView = 'taskTree' | 'preview';

export function shouldShowSurfaceMainViewToggle(options: {
	readonly selectedSurfaceId: string | undefined;
	readonly addSurfaceId: string;
	readonly contextGatheringOpen: boolean;
}): boolean {
	if (!options.selectedSurfaceId || options.selectedSurfaceId === options.addSurfaceId) {
		return false;
	}
	if (options.contextGatheringOpen && options.selectedSurfaceId === options.addSurfaceId) {
		return false;
	}
	return true;
}

export function resolveDefaultSurfaceMainView(tree: AgentTaskTree | undefined, previewReachable: boolean): SurfaceMainView {
	if (!tree) {
		return 'taskTree';
	}
	if (treeHasActiveWork(tree)) {
		return 'taskTree';
	}
	if (tree.status === 'complete' && previewReachable) {
		return 'preview';
	}
	return 'taskTree';
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentTaskTree } from './agentTaskTreeTypes.js';
import { treeHasActiveWork } from './agentTaskTreeService.js';

export type SurfaceMainView = 'plan' | 'claudeMd' | 'taskTree' | 'preview' | 'ixSubsystems';

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

export function resolveDefaultSurfaceMainView(
	tree: AgentTaskTree | undefined,
	previewReachable: boolean,
	hasPlan = false,
): SurfaceMainView {
	if (!tree && hasPlan) {
		return 'plan';
	}
	if (!tree) {
		return hasPlan ? 'plan' : 'taskTree';
	}
	if (treeHasActiveWork(tree)) {
		return 'taskTree';
	}
	if (tree.status === 'complete' && previewReachable) {
		return 'preview';
	}
	if (hasPlan && tree.status !== 'complete') {
		return 'plan';
	}
	return 'taskTree';
}

export function isSurfaceMainView(value: string | undefined): value is SurfaceMainView {
	return value === 'plan' || value === 'claudeMd' || value === 'taskTree' || value === 'preview' || value === 'ixSubsystems';
}

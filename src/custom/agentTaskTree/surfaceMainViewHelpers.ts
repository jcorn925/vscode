/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentTaskTree } from './agentTaskTreeTypes.js';

/** `taskTree` is retained only for storage migration; it is coerced to `plan`. */
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
	_hasPlan = false,
): SurfaceMainView {
	if (tree?.status === 'complete' && previewReachable) {
		return 'preview';
	}
	return 'plan';
}

/** Maps legacy stored `taskTree` (Proposed Code Graph) onto Plan. */
export function normalizeSurfaceMainView(value: string | undefined): SurfaceMainView | undefined {
	if (value === 'taskTree') {
		return 'plan';
	}
	if (isSurfaceMainView(value)) {
		return value;
	}
	return undefined;
}

export function isSurfaceMainView(value: string | undefined): value is SurfaceMainView {
	return value === 'plan' || value === 'claudeMd' || value === 'taskTree' || value === 'preview' || value === 'ixSubsystems';
}

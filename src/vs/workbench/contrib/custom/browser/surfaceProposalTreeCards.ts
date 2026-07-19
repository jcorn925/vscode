/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** One section card for the host-owned shared card rail (see cardRailLayout.ts). */
export interface SurfaceProposalTreeCardItem {
	readonly id: string;
	readonly key: string;
	readonly value: string;
}

export interface SurfaceProposalTreeGraphRegion {
	readonly name: string;
	readonly entryPath?: string;
	readonly memberFiles?: readonly string[];
	readonly fileCount?: number;
}

/** Placeholder value used when a surface section has no content yet. */
export const SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE = '—';

/**
 * Host-side section cards shown immediately on surface open — before plan/Ix load finishes.
 * Webview republish later upgrades values (and may add Repo Context / Workstreams).
 */
export function staticSurfaceProposalTreeCards(options?: {
	readonly localUrl?: string;
	readonly proposedValue?: string;
	readonly graphValue?: string;
	readonly planValue?: string;
	readonly rulesValue?: string;
}): SurfaceProposalTreeCardItem[] {
	return orderSurfaceProposalTreeCards([
		{
			id: 'proposed',
			key: 'Proposed Graph',
			value: options?.proposedValue?.trim() || SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		},
		{
			id: 'graph',
			key: 'Real Graph',
			value: options?.graphValue?.trim() || SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		},
		{
			id: 'preview',
			key: 'Preview',
			value: options?.localUrl?.trim() ? 'URL' : SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		},
		{
			id: 'plan',
			key: 'Plan',
			value: options?.planValue?.trim() || SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		},
		{
			id: 'rules',
			key: 'Rules',
			value: options?.rulesValue?.trim() || SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE,
		},
	]);
}

/** Rough Real Graph card badge from cached Ix member files (edges filled in after proposal load). */
export function surfaceGraphRegionsCardValue(regions: readonly SurfaceProposalTreeGraphRegion[]): string {
	const files = new Set<string>();
	for (const region of regions) {
		for (const file of region.memberFiles ?? []) {
			if (file) {
				files.add(file);
			}
		}
		if (region.entryPath && /\.[a-z0-9]+$/i.test(region.entryPath)) {
			files.add(region.entryPath);
		}
	}
	return files.size ? `${files.size}·0` : SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE;
}

/**
 * Section cards keep declaration order. Dynamic rail reordering is owned by Mode Shell
 * (surfaces by most recent associated plan-step activity) — Rules/Plan are not pinned.
 */
export function orderSurfaceProposalTreeCards(
	cards: readonly SurfaceProposalTreeCardItem[],
): SurfaceProposalTreeCardItem[] {
	return [...cards];
}

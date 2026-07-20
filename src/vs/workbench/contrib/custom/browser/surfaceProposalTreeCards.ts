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
 * True when rail badges still look like {@link staticSurfaceProposalTreeCards} placeholders.
 * Loaded path hardcodes Rules → CLAUDE.md; static paint leaves "—".
 */
export function surfaceRailCardsLookLikePlaceholders(
	cards: readonly { readonly id: string; readonly value: string }[],
): boolean {
	if (!cards.length) {
		return true;
	}
	const rules = cards.find(card => card.id === 'rules' || card.id === 'surfaceSection:rules');
	return !rules || rules.value.trim() === SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE;
}

/**
 * Canonical Canvas rail + Workspace section order.
 * Build / graph views first; docs trail. Preferred step card (or Preview when
 * the surface is 100% complete) may still pin to front.
 */
export const SURFACE_PROPOSAL_TREE_SECTION_ORDER = [
	'phases',
	'proposed',
	'graph',
	'preview',
	'deployed',
	'description',
	'context',
	'plan',
	'rules',
	'removals',
] as const;

/** Build-rail sections we may auto-replace with Preview once the surface is complete. */
export const SURFACE_RAIL_BUILD_SECTION_IDS = new Set([
	'phases',
	'proposed',
	'graph',
	'workstreams',
]);

const SECTION_ORDER_INDEX = new Map<string, number>(
	SURFACE_PROPOSAL_TREE_SECTION_ORDER.map((id, index) => [id, index]),
);

/**
 * Host-side section cards shown immediately on surface open — before plan/Ix load finishes.
 * Webview republish later upgrades values (and may add Repo Context / Build phases).
 */
/** Short rail badge for the Description card (full text lives in the section body). */
export function surfaceDescriptionCardValue(purpose?: string): string {
	const trimmed = purpose?.trim();
	if (!trimmed) {
		return SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE;
	}
	const firstLine = trimmed.split(/\r?\n/, 1)[0]!.trim();
	if (firstLine.length <= 28) {
		return firstLine;
	}
	return `${firstLine.slice(0, 27).trimEnd()}…`;
}

/** Compact host/path badge for Preview / Deployed cards (full URL opens on click). */
export function surfaceUrlCardValue(url?: string, maxLen = 28): string {
	const trimmed = url?.trim();
	if (!trimmed) {
		return SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE;
	}
	let display = trimmed.replace(/^https?:\/\//i, '');
	if (display.endsWith('/') && display.length > 1) {
		display = display.slice(0, -1);
	}
	if (display.length <= maxLen) {
		return display;
	}
	return `${display.slice(0, maxLen - 1).trimEnd()}…`;
}

export function staticSurfaceProposalTreeCards(options?: {
	readonly localUrl?: string;
	readonly productionUrl?: string;
	readonly purposeValue?: string;
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
			value: surfaceUrlCardValue(options?.localUrl),
		},
		{
			id: 'deployed',
			key: 'Deployed',
			value: surfaceUrlCardValue(options?.productionUrl),
		},
		{
			id: 'description',
			key: 'Description',
			value: surfaceDescriptionCardValue(options?.purposeValue),
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

/** Proposed Graph badge from proposal add_nodes / add_edges (host-side; no webview round-trip). */
export function surfaceProposedGraphCardValue(options: {
	readonly nodeCount?: number;
	readonly edgeCount?: number;
}): string {
	const nodes = Math.max(0, options.nodeCount ?? 0);
	const edges = Math.max(0, options.edgeCount ?? 0);
	if (!nodes && !edges) {
		return SURFACE_PROPOSAL_TREE_CARD_INCOMPLETE_VALUE;
	}
	return `${nodes}·${edges}`;
}

/**
 * Host-side rail cards from plan/proposal document fields.
 * Used so Preview-focused surfaces still upgrade past static "—" placeholders when the
 * tree webview is hidden and may not post `surfaceProposalTree.cards` back.
 */
export function surfaceProposalTreeCardsFromDocument(options: {
	readonly localUrl?: string;
	readonly productionUrl?: string;
	readonly purposeValue?: string;
	readonly planMarkdown?: string;
	readonly claudeMdMarkdown?: string;
	readonly proposedNodeCount?: number;
	readonly proposedEdgeCount?: number;
	readonly graphRegions?: readonly SurfaceProposalTreeGraphRegion[];
	readonly phasesCardValue?: string;
	readonly contextCardValue?: string;
}): SurfaceProposalTreeCardItem[] {
	const cards: SurfaceProposalTreeCardItem[] = [
		...staticSurfaceProposalTreeCards({
			localUrl: options.localUrl,
			productionUrl: options.productionUrl,
			purposeValue: options.purposeValue,
			proposedValue: surfaceProposedGraphCardValue({
				nodeCount: options.proposedNodeCount,
				edgeCount: options.proposedEdgeCount,
			}),
			graphValue: surfaceGraphRegionsCardValue(options.graphRegions ?? []),
			planValue: options.planMarkdown?.trim() ? 'plan.md' : undefined,
			// Match webview rail: Rules badge is CLAUDE.md once the document has been published.
			rulesValue: 'CLAUDE.md',
		}),
	];
	const phases = options.phasesCardValue?.trim();
	if (phases) {
		cards.push({ id: 'phases', key: 'Build phases', value: phases });
	}
	const context = options.contextCardValue?.trim();
	if (context) {
		cards.push({ id: 'context', key: 'Repo Context', value: context });
	}
	return orderSurfaceProposalTreeCards(cards);
}

function sectionOrderRank(id: string): number {
	return SECTION_ORDER_INDEX.get(id) ?? SURFACE_PROPOSAL_TREE_SECTION_ORDER.length;
}

/**
 * Order section cards for the surface rail (and keep Workspace sections in sync).
 * Sorts by {@link SURFACE_PROPOSAL_TREE_SECTION_ORDER}, then pins `preferredSectionId` to the front.
 */
export function orderSurfaceProposalTreeCards(
	cards: readonly SurfaceProposalTreeCardItem[],
	preferredSectionId?: string,
): SurfaceProposalTreeCardItem[] {
	const copy = [...cards].sort((a, b) => {
		const rank = sectionOrderRank(a.id) - sectionOrderRank(b.id);
		if (rank !== 0) {
			return rank;
		}
		return 0;
	});
	const preferred = preferredSectionId?.trim();
	if (!preferred) {
		return copy;
	}
	const index = copy.findIndex(card => card.id === preferred);
	if (index <= 0) {
		return copy;
	}
	const [card] = copy.splice(index, 1);
	return [card!, ...copy];
}

/** Sort section DOM nodes into the same order as Canvas rail cards. */
export function orderSurfaceProposalTreeSectionIds(
	sectionIds: readonly string[],
	preferredSectionId?: string,
): string[] {
	return orderSurfaceProposalTreeCards(
		sectionIds.map(id => ({ id, key: id, value: '' })),
		preferredSectionId,
	).map(card => card.id);
}

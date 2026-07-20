/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Parent whose child section cards are shown in the Console rail. */
export type RailChildrenDisplayParent = 'console' | `surface:${string}`;

export function isRailParentCardId(id: string): id is RailChildrenDisplayParent {
	return id === 'console' || id.startsWith('surface:');
}

/** Committed expand parent (selection), ignoring hover. */
export function resolveCommittedRailChildrenParent(options: {
	readonly openSurfaceId?: string;
	readonly consoleExpanded: boolean;
}): RailChildrenDisplayParent | undefined {
	if (options.openSurfaceId) {
		return `surface:${options.openSurfaceId}`;
	}
	if (options.consoleExpanded) {
		return 'console';
	}
	return undefined;
}

/**
 * Which parent's children to list: hover preview wins when set, else committed expand.
 * Does not imply selection / content-pane changes.
 */
export function resolveRailChildrenDisplayParent(options: {
	readonly hoveredRailParentId?: string;
	readonly openSurfaceId?: string;
	readonly consoleExpanded: boolean;
}): RailChildrenDisplayParent | undefined {
	const hovered = options.hoveredRailParentId?.trim();
	if (hovered && isRailParentCardId(hovered)) {
		return hovered;
	}
	return resolveCommittedRailChildrenParent(options);
}

/** True when the rail is showing another parent's children than the committed expand. */
export function isRailHoverPreviewActive(options: {
	readonly hoveredRailParentId?: string;
	readonly openSurfaceId?: string;
	readonly consoleExpanded: boolean;
}): boolean {
	const hovered = options.hoveredRailParentId?.trim();
	if (!hovered || !isRailParentCardId(hovered)) {
		return false;
	}
	const committed = resolveCommittedRailChildrenParent(options);
	return hovered !== committed;
}

export function surfaceIdFromRailParentId(parentId: string): string | undefined {
	if (!parentId.startsWith('surface:')) {
		return undefined;
	}
	const id = parentId.slice('surface:'.length).trim();
	return id || undefined;
}

/** Last parent index in the same grid row as `parentIndex` (0-based). */
export function railParentRowEndIndex(parentIndex: number, parentCount: number, columns = 2): number {
	if (parentCount <= 0 || parentIndex < 0) {
		return -1;
	}
	const cols = Math.max(1, Math.floor(columns));
	const index = Math.min(parentIndex, parentCount - 1);
	const rowStart = Math.floor(index / cols) * cols;
	return Math.min(parentCount - 1, rowStart + cols - 1);
}

/**
 * Build parent + optional child ids in rail order: keep the display parent's
 * grid row intact, insert children right after that row, then remaining parents.
 */
export function orderRailParentIdsWithInlineChildren(options: {
	readonly parentIds: readonly string[];
	readonly displayParentId?: string;
	readonly childIds?: readonly string[];
	readonly columns?: number;
}): string[] {
	const display = options.displayParentId?.trim();
	if (!display || !options.childIds?.length) {
		return [...options.parentIds];
	}
	const parentIndex = options.parentIds.indexOf(display);
	if (parentIndex < 0) {
		return [...options.parentIds];
	}
	const rowEnd = railParentRowEndIndex(parentIndex, options.parentIds.length, options.columns ?? 2);
	const out = [...options.parentIds];
	out.splice(rowEnd + 1, 0, ...options.childIds);
	return out;
}

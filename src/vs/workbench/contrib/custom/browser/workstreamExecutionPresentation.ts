/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Presentation helpers for nested workstream execution under Build phases.
 * Keeps badge/summary copy honest relative to Settings + inflight fan-out.
 */

export type WorkstreamParallelBadgeKind = 'cluster' | 'parallel-ready' | 'parallel';

export interface WorkstreamExecutionPresentation {
	readonly badgeKind: WorkstreamParallelBadgeKind;
	readonly badgeLabel: string;
	readonly badgeClass: string;
	readonly summaryLine: string;
	readonly noteLine?: string;
	/** Open the nested execution details by default. */
	readonly openByDefault: boolean;
}

export function resolveWorkstreamExecutionPresentation(options: {
	readonly parallelEnabled: boolean;
	readonly workstreamsInflight: boolean;
	readonly parallelStreamCount: number;
	readonly canParallelize: boolean;
	readonly hideRunWorkstreamsButton: boolean;
}): WorkstreamExecutionPresentation {
	const {
		parallelEnabled,
		workstreamsInflight,
		parallelStreamCount,
		canParallelize,
		hideRunWorkstreamsButton,
	} = options;

	if (workstreamsInflight && parallelEnabled) {
		return {
			badgeKind: 'parallel',
			badgeLabel: 'parallel',
			badgeClass: 'badge-parallel',
			summaryLine: `Running ${parallelStreamCount} Claude workstream(s)`,
			noteLine: hideRunWorkstreamsButton
				? 'Steps Next spawned these for the current generate phase. Structural clusters only; soft links ignored.'
				: 'Structural clusters only; soft links (REGISTERS/DESCRIBES) ignored. Coupled clusters serialize first.',
			openByDefault: true,
		};
	}

	if (parallelEnabled && canParallelize) {
		return {
			badgeKind: 'parallel-ready',
			badgeLabel: 'parallel-ready',
			badgeClass: 'badge-parallel-ready',
			summaryLine: `${parallelStreamCount} subsystems can fan out on Next`,
			noteLine: hideRunWorkstreamsButton
				? 'Steps Next on the current generate phase spawns these automatically. Structural clusters only; soft links ignored.'
				: 'Structural clusters only; soft links (REGISTERS/DESCRIBES) ignored. Coupled clusters serialize first.',
			openByDefault: true,
		};
	}

	if (parallelEnabled && !canParallelize) {
		return {
			badgeKind: 'cluster',
			badgeLabel: 'cluster',
			badgeClass: 'badge-cluster',
			summaryLine: parallelStreamCount <= 1
				? 'Single subsystem — run as one agent stream.'
				: 'Coupled clusters must serialize before fan-out.',
			noteLine: hideRunWorkstreamsButton
				? 'Steps Next runs one Claude until clusters are parallel-safe.'
				: 'Need ≥2 parallel-safe workstreams (no shared node_prefixes) to fan out.',
			openByDefault: true,
		};
	}

	// Parallel setting off — show ownership clusters, not fake PARALLEL.
	return {
		badgeKind: 'cluster',
		badgeLabel: 'cluster',
		badgeClass: 'badge-cluster',
		summaryLine: canParallelize
			? `${parallelStreamCount} subsystems planned — Next runs one Claude for this surface`
			: (parallelStreamCount === 1
				? 'Single subsystem — run as one agent stream.'
				: 'File clusters planned — Next runs one Claude for this surface'),
		noteLine: hideRunWorkstreamsButton
			? 'Enable Parallel Claude workstreams in Workspace Settings to fan out.'
			: 'Planning still shows clusters; execution is sequential unless enabled in Workspace Settings.',
		openByDefault: false,
	};
}

/**
 * Phase index (1-based) for subtitle/highlight, or undefined when none should be current
 * (e.g. verify_graph / enable_preview).
 */
export function resolveCurrentPhaseIndex(
	phases: readonly { readonly id?: string }[],
	currentStepId: string | undefined,
): number | undefined {
	if (!phases.length) {
		return undefined;
	}
	const stepId = currentStepId?.trim();
	if (!stepId) {
		return undefined;
	}
	const byId = phases.findIndex(phase => (phase.id || '').trim() === stepId);
	if (byId >= 0) {
		return byId + 1;
	}
	// Unmatched generate / workstream step ids → first phase until a better match exists.
	if (/^phase/i.test(stepId) || /workstream|serialize|ws-\d+/i.test(stepId)) {
		return 1;
	}
	return undefined;
}

/** Per-phase row status shown on Build phases (workflow + failed overlay). */
export type PhaseRowStatus = 'pending' | 'current' | 'completed' | 'skipped' | 'failed';

export interface PhaseStatusEntry {
	readonly id: string;
	readonly status: PhaseRowStatus;
}

/**
 * Resolve display status for a build-phase row.
 * Prefers explicit workflow/progress statuses; falls back to currentPhaseIndex only.
 */
export function resolvePhaseRowStatus(
	phaseId: string | undefined,
	index: number,
	phaseStatuses: readonly PhaseStatusEntry[] | undefined,
	currentPhaseIndex: number | undefined,
): PhaseRowStatus | undefined {
	const id = phaseId?.trim();
	if (phaseStatuses?.length && id) {
		const found = phaseStatuses.find(entry => entry.id === id);
		if (found) {
			return found.status;
		}
	}
	if (currentPhaseIndex !== undefined && currentPhaseIndex === index + 1) {
		return 'current';
	}
	return undefined;
}

/** Section badge `completed/total` for Build phases. */
export function formatPhaseProgressBadge(
	phaseCount: number,
	phaseStatuses: readonly PhaseStatusEntry[] | undefined,
): string | undefined {
	if (phaseCount <= 0) {
		return undefined;
	}
	const completed = phaseStatuses?.filter(entry => entry.status === 'completed').length ?? 0;
	return `${completed}/${phaseCount}`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import type { ConsoleWorkflowSignals } from '../../../../../custom/goalWorkspace/consoleWorkflowStatus.js';
import type { BabadabaNodeState } from './babadabaStage.js';

/**
 * Click action for a hub / Steps spoke. modeShell binds these to navigation
 * (open surface plan, Console section, production URL, etc.).
 */
export type BabadabaHubActionId =
	| 'open_surface'
	| 'open_ix'
	| 'open_docker'
	| 'open_github'
	| 'open_vercel';

/** Pure node snapshot shared by the Babadaba canvas orbit and Steps children. */
export interface BabadabaHubNode {
	readonly id: string;
	readonly label: string;
	readonly state: BabadabaNodeState;
	readonly progress?: number;
	readonly detail?: string;
	readonly actionId?: BabadabaHubActionId;
	/** For `open_surface` / `open_vercel` targets. */
	readonly targetId?: string;
	readonly href?: string;
}

export interface BabadabaHubSurfaceInput {
	readonly id: string;
	readonly name: string;
	readonly productionUrl?: string;
	readonly ixSubsystems: readonly string[];
	readonly hasIxMeta?: boolean;
}

export interface BabadabaHubSurfaceProgress {
	readonly complete?: boolean;
	readonly inProgress?: boolean;
	readonly percent?: number;
	readonly label?: string;
}

export interface BabadabaHubGraphInput {
	readonly signals: Pick<
		ConsoleWorkflowSignals,
		'dockerReady' | 'kickoffInFlight' | 'sessionActive'
	>;
	readonly surfaces: readonly BabadabaHubSurfaceInput[];
	readonly surfaceProgressById: ReadonlyMap<string, BabadabaHubSurfaceProgress>;
	readonly startedSurfaceIds: ReadonlySet<string>;
	/** `undefined` while the `.git` probe is still in flight — GitHub spoke omitted. */
	readonly workspaceHasGitRepo: boolean | undefined;
}

export interface BabadabaHubGraph {
	readonly nodes: readonly BabadabaHubNode[];
	readonly surfaceCount: number;
	readonly completeCount: number;
}

/**
 * Build the workspace-manager spoke list: one node per surface, then Ix, Docker,
 * GitHub (when known), and Vercel. Order matches the canvas orbit (surfaces first).
 */
export function buildBabadabaHubGraph(input: BabadabaHubGraphInput): BabadabaHubGraph {
	const { signals, surfaces, surfaceProgressById, startedSurfaceIds, workspaceHasGitRepo } = input;
	const surfaceCount = surfaces.length;
	let completeCount = 0;
	for (const progress of surfaceProgressById.values()) {
		if (progress.complete) {
			completeCount++;
		}
	}

	const nodes: BabadabaHubNode[] = surfaces.map(surface => {
		const progress = surfaceProgressById.get(surface.id);
		return {
			id: `surface:${surface.id}`,
			label: surface.name,
			state: startedSurfaceIds.has(surface.id)
				? 'active' as const
				: progress?.inProgress ? 'building' as const : 'idle' as const,
			progress: progress?.percent,
			detail: progress?.label,
			actionId: 'open_surface' as const,
			targetId: surface.id,
		};
	});

	const ixMapped = surfaces.some(surface => surface.ixSubsystems.length > 0 || surface.hasIxMeta);
	nodes.push({
		id: 'integration:ix',
		label: 'Ix graph',
		state: signals.kickoffInFlight || signals.sessionActive ? 'building' : ixMapped ? 'active' : 'idle',
		detail: signals.kickoffInFlight || signals.sessionActive
			? localize('babadabaNode.ixMapping', "Mapping subsystems from reference repos")
			: ixMapped
				? localize('babadabaNode.ixMapped', "Subsystem graph mapped")
				: localize('babadabaNode.ixIdle', "No graph mapping yet"),
		actionId: 'open_ix',
	});

	nodes.push({
		id: 'integration:docker',
		label: 'Docker',
		state: signals.dockerReady === false ? 'attention' : 'active',
		detail: signals.dockerReady === false
			? localize('babadabaNode.dockerBlocked', "Start Docker Desktop (with MCP Toolkit) to continue")
			: localize('babadabaNode.dockerReady', "Docker ready"),
		actionId: 'open_docker',
	});

	if (workspaceHasGitRepo !== undefined) {
		nodes.push({
			id: 'integration:github',
			label: 'GitHub',
			state: workspaceHasGitRepo ? 'active' : 'idle',
			detail: workspaceHasGitRepo
				? localize('babadabaNode.gitRepo', "Workspace is a Git repository")
				: localize('babadabaNode.gitNone', "No Git repository yet"),
			actionId: 'open_github',
		});
	}

	const deployed = surfaces.filter(surface => surface.productionUrl?.trim());
	const firstDeployUrl = deployed[0]?.productionUrl?.trim();
	nodes.push({
		id: 'integration:vercel',
		label: 'Vercel',
		state: deployed.length ? 'active' : 'idle',
		detail: deployed.length
			? localize('babadabaNode.vercelDeployed', "{0} of {1} surfaces deployed", deployed.length, surfaceCount)
			: localize('babadabaNode.vercelNone', "No production deploys yet"),
		actionId: firstDeployUrl ? 'open_vercel' : undefined,
		href: firstDeployUrl,
	});

	return { nodes, surfaceCount, completeCount };
}

/** True when any spoke should pulse Steps attention (building or blocked). */
export function babadabaHubHasAttention(nodes: readonly BabadabaHubNode[]): boolean {
	return nodes.some(node => node.state === 'building' || node.state === 'attention');
}

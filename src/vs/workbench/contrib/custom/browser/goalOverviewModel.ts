/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import type { WorkspaceGoal, WorkspaceSurface } from '../../../../../custom/goalWorkspace/ConsoleService.js';

/**
 * View model for the workspace-home landing overview. Built from the goal
 * manifest fields; the free-form description is split into a short lede plus
 * collapsed detail paragraphs so the landing reads as a summary, not a wall.
 */
export interface GoalOverviewModel {
	readonly title: string;
	/** First paragraph of the goal description, shown prominently. */
	readonly lede?: string;
	/** Remaining description paragraphs, shown behind a disclosure. */
	readonly detailParagraphs: readonly string[];
	readonly facts: readonly GoalOverviewFact[];
	readonly ctas: readonly GoalOverviewCta[];
}

export interface GoalOverviewFact {
	readonly label: string;
	readonly value: string;
}

export interface GoalOverviewCta {
	readonly kind: 'openDeployed' | 'openPreview' | 'showConsole';
	readonly label: string;
	/** Surface backing the action (absent for workspace-level actions). */
	readonly surfaceId?: string;
	/** URL backing the action, surfaced as hover detail. */
	readonly url?: string;
}

/** Split a free-form description into trimmed paragraphs on blank lines. */
export function splitGoalDescriptionParagraphs(description: string | undefined): string[] {
	if (!description) {
		return [];
	}
	return description
		.split(/\n\s*\n/)
		.map(paragraph => paragraph.trim())
		.filter(paragraph => paragraph.length > 0);
}

export function buildGoalOverviewModel(goal: WorkspaceGoal | undefined, surfaces: readonly WorkspaceSurface[]): GoalOverviewModel {
	const title = goal?.name
		? localize('customMode.goalOverviewTitle', 'Goal: {0}', goal.name)
		: localize('customMode.goalOverviewFallbackTitle', 'Goal Workspace');
	const paragraphs = splitGoalDescriptionParagraphs(goal?.description);

	const facts: GoalOverviewFact[] = [];
	if (goal?.northStarMetric) {
		facts.push({
			label: localize('customMode.goalOverviewNorthStarLabel', 'North-star metric'),
			value: goal.northStarMetric,
		});
	}
	if (surfaces.length > 0) {
		facts.push({
			label: localize('customMode.goalOverviewSurfacesLabel', '{0} surface(s)', surfaces.length),
			value: surfaces.map(surface => surface.name).join(', '),
		});
		const deployed = surfaces.filter(surface => surface.productionUrl).length;
		if (deployed > 0) {
			facts.push({
				label: localize('customMode.goalOverviewDeployedLabel', 'Deployed'),
				value: `${deployed}/${surfaces.length}`,
			});
		}
	}

	const ctas: GoalOverviewCta[] = [];
	const deployedSurface = surfaces.find(surface => surface.productionUrl);
	if (deployedSurface) {
		ctas.push({
			kind: 'openDeployed',
			label: localize('customMode.goalOverviewOpenDeployed', 'Open Deployed'),
			surfaceId: deployedSurface.id,
			url: deployedSurface.productionUrl,
		});
	}
	const previewSurface = surfaces.find(surface => surface.localUrl);
	if (previewSurface) {
		ctas.push({
			kind: 'openPreview',
			label: localize('customMode.goalOverviewOpenPreview', 'Open Preview'),
			surfaceId: previewSurface.id,
			url: previewSurface.localUrl,
		});
	}
	if (surfaces.length > 0) {
		ctas.push({
			kind: 'showConsole',
			label: localize('customMode.goalOverviewBrowseSurfaces', 'Browse Surfaces'),
		});
	}

	return { title, lede: paragraphs[0], detailParagraphs: paragraphs.slice(1), facts, ctas };
}

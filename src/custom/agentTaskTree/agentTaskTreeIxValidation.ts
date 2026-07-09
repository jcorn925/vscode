/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import type { IFileService } from '../../vs/platform/files/common/files.js';
import { WORKSPACE_MANIFEST } from '../goalWorkspace/ConsoleService.js';
import { blueprintResource, readBlueprint } from '../goalWorkspace/surfaceBlueprintService.js';
import type { IxSubsystemRegion } from '../goalWorkspace/surfaceIxMatch.js';
import type { SurfaceBlueprint, SurfaceSubsystemSpec } from '../goalWorkspace/surfaceBlueprintTypes.js';
import type { AgentTaskNode, AgentTaskTree, AgentTaskTreeIxValidation, AgentTaskTreeIxValidationGap } from './agentTaskTreeTypes.js';

export interface BuildAgentTaskTreeIxValidationOptions {
	readonly fileService: IFileService;
	readonly workspaceFolder: URI;
	readonly tree: AgentTaskTree;
	readonly surfaceId: string;
	readonly ixSubsystems: readonly IxSubsystemRegion[];
	readonly command: string;
}

interface ExpectedShape {
	readonly id: string;
	readonly label: string;
	readonly paths: readonly string[];
	readonly minFiles: number;
}

export async function buildAgentTaskTreeIxValidation(options: BuildAgentTaskTreeIxValidationOptions): Promise<AgentTaskTreeIxValidation> {
	const surfacePath = await readSurfacePath(options.fileService, options.workspaceFolder, options.surfaceId);
	const scopedRegions = options.ixSubsystems.filter(region => regionIsUnderSurface(region, surfacePath, options.surfaceId));
	const blueprint = await readBlueprint(options.fileService, blueprintResource(options.workspaceFolder, options.surfaceId));
	const expectedShapes = expectedShapesFromBlueprint(blueprint);
	const taskPathExpectations = expectedShapesFromTaskTree(options.tree, surfacePath);
	const allExpected = mergeExpectedShapes([...expectedShapes, ...taskPathExpectations]);
	const matchedRegionIds = new Set<string>();
	const gaps: AgentTaskTreeIxValidationGap[] = [];

	if (options.ixSubsystems.length === 0) {
		return {
			status: 'unavailable',
			ranAt: new Date().toISOString(),
			surfacePath,
			command: options.command,
			subsystemCount: 0,
			matchedCount: 0,
			gaps: [{
				id: `${options.surfaceId}-ix-unavailable`,
				kind: 'missing_region',
				expectedId: options.surfaceId,
				expectedLabel: options.surfaceId,
				expectedPaths: [surfacePath],
				message: 'Ix subsystem discovery returned no subsystem regions for comparison.',
			}],
		};
	}

	for (const expected of allExpected) {
		const pathsExist = await expectedPathsExist(options.fileService, options.workspaceFolder, expected.paths);
		if (!pathsExist) {
			gaps.push({
				id: stableGapId(options.surfaceId, expected.id, 'missing_path'),
				kind: 'missing_path',
				expectedId: expected.id,
				expectedLabel: expected.label,
				expectedPaths: expected.paths,
				message: `Expected generated files for "${expected.label}" were not found at: ${expected.paths.join(', ')}`,
			});
			continue;
		}

		const matchedRegion = scopedRegions.find(region => regionMatchesExpected(region, expected));
		if (!matchedRegion) {
			const closest = closestRegion(scopedRegions, expected);
			gaps.push({
				id: stableGapId(options.surfaceId, expected.id, 'missing_region'),
				kind: 'missing_region',
				expectedId: expected.id,
				expectedLabel: expected.label,
				expectedPaths: expected.paths,
				matchedRegionId: closest?.regionId,
				matchedRegionLabel: closest?.name,
				message: `Ix found no surface subsystem matching "${expected.label}".`,
			});
			continue;
		}

		matchedRegionIds.add(matchedRegion.regionId);
		if (matchedRegion.fileCount !== undefined && matchedRegion.fileCount < expected.minFiles) {
			gaps.push({
				id: stableGapId(options.surfaceId, expected.id, 'thin_region'),
				kind: 'thin_region',
				expectedId: expected.id,
				expectedLabel: expected.label,
				expectedPaths: expected.paths,
				matchedRegionId: matchedRegion.regionId,
				matchedRegionLabel: matchedRegion.name,
				message: `Ix matched "${expected.label}" to "${matchedRegion.name}", but the region has ${matchedRegion.fileCount} files; expected at least ${expected.minFiles}.`,
			});
		}
	}

	for (const region of scopedRegions) {
		if (matchedRegionIds.has(region.regionId)) {
			continue;
		}
		const paths = regionPaths(region);
		gaps.push({
			id: stableGapId(options.surfaceId, region.regionId, 'unexpected_region'),
			kind: 'unexpected_region',
			expectedLabel: region.name,
			expectedPaths: paths.length ? paths : [surfacePath],
			matchedRegionId: region.regionId,
			matchedRegionLabel: region.name,
			message: `Ix found generated surface subsystem "${region.name}" that was not represented in the initial task tree or blueprint.`,
		});
	}

	return {
		status: gaps.length ? 'gaps' : 'passed',
		ranAt: new Date().toISOString(),
		surfacePath,
		command: options.command,
		subsystemCount: scopedRegions.length,
		matchedCount: matchedRegionIds.size,
		gaps,
	};
}

export const IX_VALIDATION_REPAIR_ROOT_ID = 'ix-validation-repair';

export function appendIxValidationRepairLeaves(tree: AgentTaskTree, validation: AgentTaskTreeIxValidation): AgentTaskTree {
	const rootsWithoutPriorRepair = tree.roots.filter(root => root.id !== IX_VALIDATION_REPAIR_ROOT_ID);
	if (!validation.gaps.length) {
		return { ...tree, roots: rootsWithoutPriorRepair, ixValidation: validation };
	}
	const maxOrder = Math.max(0, ...flattenNodes(rootsWithoutPriorRepair).map(node => node.order));
	const root: AgentTaskNode = {
		id: IX_VALIDATION_REPAIR_ROOT_ID,
		title: 'Ix Validation Repair',
		description: `Repair generated surface shape gaps from ${validation.command}.`,
		type: 'root',
		status: 'pending',
		order: maxOrder + 1,
		children: validation.gaps.map((gap, index) => ({
			id: `ix-repair-${gap.id}`,
			parentId: IX_VALIDATION_REPAIR_ROOT_ID,
			title: repairLeafTitle(gap),
			description: repairLeafDescription(gap, validation),
			type: 'leaf',
			status: 'pending',
			order: maxOrder + 2 + index,
		})),
	};
	return {
		...tree,
		status: 'active',
		roots: [...rootsWithoutPriorRepair, root],
		ixValidation: validation,
	};
}

async function readSurfacePath(fileService: IFileService, workspaceFolder: URI, surfaceId: string): Promise<string> {
	try {
		const raw = JSON.parse((await fileService.readFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST))).value.toString());
		const surfaces = Array.isArray(raw?.surfaces) ? raw.surfaces : [];
		for (const surface of surfaces) {
			if (surface?.id === surfaceId && typeof surface.path === 'string' && surface.path.trim()) {
				return normalizePath(surface.path);
			}
		}
	} catch {
		// Fall back to convention below.
	}
	return `apps/${surfaceId}`;
}

function expectedShapesFromBlueprint(blueprint: SurfaceBlueprint | undefined): ExpectedShape[] {
	return (blueprint?.subsystems ?? []).map(subsystem => expectedShapeFromSubsystem(subsystem));
}

function expectedShapeFromSubsystem(subsystem: SurfaceSubsystemSpec): ExpectedShape {
	return {
		id: subsystem.id,
		label: subsystem.label,
		paths: subsystem.paths.map(normalizePath),
		minFiles: subsystem.minFiles ?? 1,
	};
}

function expectedShapesFromTaskTree(tree: AgentTaskTree, surfacePath: string): ExpectedShape[] {
	return flattenNodes(tree.roots)
		.filter(node => node.type === 'leaf')
		.map(node => expectedShapeFromTaskLeaf(node, surfacePath))
		.filter((shape): shape is ExpectedShape => Boolean(shape));
}

function expectedShapeFromTaskLeaf(node: AgentTaskNode, surfacePath: string): ExpectedShape | undefined {
	const text = `${node.title}\n${node.description ?? ''}`;
	const paths = Array.from(text.matchAll(/(?:apps|packages|workflows)\/[a-z0-9._/-]+/gi))
		.map(match => normalizePath(match[0]))
		.filter(path => path === surfacePath || path.startsWith(`${surfacePath}/`));
	if (!paths.length) {
		return undefined;
	}
	return {
		id: node.id,
		label: node.title,
		paths,
		minFiles: 1,
	};
}

function mergeExpectedShapes(shapes: readonly ExpectedShape[]): ExpectedShape[] {
	const byKey = new Map<string, ExpectedShape>();
	for (const shape of shapes) {
		const key = shape.paths.join('|') || shape.id;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, shape);
			continue;
		}
		byKey.set(key, {
			...existing,
			label: existing.label,
			minFiles: Math.max(existing.minFiles, shape.minFiles),
			paths: uniqueStrings([...existing.paths, ...shape.paths]),
		});
	}
	return [...byKey.values()];
}

async function expectedPathsExist(fileService: IFileService, workspaceFolder: URI, paths: readonly string[]): Promise<boolean> {
	for (const path of paths) {
		const resource = joinPath(workspaceFolder, ...path.split('/'));
		if (await fileService.exists(resource)) {
			return true;
		}
	}
	return false;
}

function regionIsUnderSurface(region: IxSubsystemRegion, surfacePath: string, surfaceId: string): boolean {
	const paths = regionPaths(region);
	return paths.some(path => path === surfacePath || path.startsWith(`${surfacePath}/`) || path.includes(`/${surfaceId}/`));
}

function regionMatchesExpected(region: IxSubsystemRegion, expected: ExpectedShape): boolean {
	const paths = regionPaths(region);
	if (expected.paths.some(expectedPath => paths.some(path => path === expectedPath || path.startsWith(`${expectedPath}/`) || expectedPath.startsWith(`${path}/`)))) {
		return true;
	}
	const regionLabel = normalizeText(`${region.regionId} ${region.name}`);
	const expectedLabel = normalizeText(`${expected.id} ${expected.label}`);
	return Boolean(regionLabel && expectedLabel && (regionLabel.includes(expectedLabel) || expectedLabel.includes(regionLabel)));
}

function closestRegion(regions: readonly IxSubsystemRegion[], expected: ExpectedShape): IxSubsystemRegion | undefined {
	let best: { region: IxSubsystemRegion; score: number } | undefined;
	const expectedTokens = tokens([expected.id, expected.label, ...expected.paths]);
	for (const region of regions) {
		const regionTokens = tokens([region.regionId, region.name, ...regionPaths(region)]);
		const score = expectedTokens.filter(token => regionTokens.includes(token)).length;
		if (score > 0 && (!best || score > best.score)) {
			best = { region, score };
		}
	}
	return best?.region;
}

function regionPaths(region: IxSubsystemRegion): string[] {
	return uniqueStrings([region.entryPath, ...(region.memberFiles ?? [])]
		.filter((path): path is string => Boolean(path))
		.map(normalizePath));
}

function repairLeafTitle(gap: AgentTaskTreeIxValidationGap): string {
	switch (gap.kind) {
		case 'missing_path':
			return `Create missing generated files for ${gap.expectedLabel}`;
		case 'missing_region':
			return `Implement missing Ix subsystem for ${gap.expectedLabel}`;
		case 'thin_region':
			return `Expand thin Ix subsystem for ${gap.expectedLabel}`;
		case 'unexpected_region':
			return `Reconcile unexpected Ix subsystem ${gap.expectedLabel}`;
	}
}

function repairLeafDescription(gap: AgentTaskTreeIxValidationGap, validation: AgentTaskTreeIxValidation): string {
	const evidence = [
		`Ix command: ${validation.command}`,
		`Surface path: ${validation.surfacePath}`,
		`Gap: ${gap.message}`,
		`Expected paths: ${gap.expectedPaths.join(', ')}`,
		gap.matchedRegionLabel ? `Closest Ix region: ${gap.matchedRegionLabel} (${gap.matchedRegionId ?? 'unknown id'})` : undefined,
		'Acceptance: update the generated surface so Ix subsystem discovery maps this expected shape, then rerun Ix validation before marking this task complete.',
	].filter((line): line is string => Boolean(line));
	return evidence.join('\n');
}

function stableGapId(surfaceId: string, id: string, kind: AgentTaskTreeIxValidationGap['kind']): string {
	return `${surfaceId}-${kind}-${slugify(id) || 'gap'}`;
}

function tokens(values: readonly string[]): string[] {
	return uniqueStrings(values
		.flatMap(value => normalizePath(value).split(/[^a-z0-9]+/i))
		.filter(token => token.length >= 3));
}

function normalizePath(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/[.,;:)]+$/, '').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
}

function normalizeText(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = value.trim();
		const key = normalized.toLowerCase();
		if (!normalized || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function flattenNodes(nodes: readonly AgentTaskNode[]): AgentTaskNode[] {
	const result: AgentTaskNode[] = [];
	for (const node of nodes) {
		result.push(node);
		if (node.children?.length) {
			result.push(...flattenNodes(node.children));
		}
	}
	return result;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { GOAL_WORKSPACE_MANIFEST } from './GoalWorkspaceService.js';
import type { GoalWorkspaceSurface } from './GoalWorkspaceService.js';
import { blueprintResource, readBlueprint } from './surfaceBlueprintService.js';
import { blueprintSubsystemMatchesIx, type IxSubsystemRegion } from './surfaceIxMatch.js';
import type { SurfaceBlueprintGap, SurfaceBlueprintVerificationResult } from './surfaceBlueprintTypes.js';

export interface VerifySurfaceBlueprintOptions {
	readonly fileService: IFileService;
	readonly workspaceFolder: URI;
	readonly surfaceId: string;
	readonly ixSubsystems?: readonly IxSubsystemRegion[];
}

export async function verifySurfaceBlueprint(options: VerifySurfaceBlueprintOptions): Promise<SurfaceBlueprintVerificationResult> {
	const { fileService, workspaceFolder, surfaceId, ixSubsystems } = options;
	const gaps: SurfaceBlueprintGap[] = [];
	const resource = blueprintResource(workspaceFolder, surfaceId);
	const blueprint = await readBlueprint(fileService, resource);

	if (!blueprint) {
		return {
			passed: false,
			surfaceId,
			satisfiedCount: 0,
			totalCount: 1,
			gaps: [{
				subsystemId: '*',
				kind: 'missing_blueprint',
				message: `Blueprint not found at .agent/surfaces/${surfaceId}.blueprint.json`,
			}],
			ixChecked: false,
		};
	}

	const manifestSurface = await readManifestSurface(fileService, workspaceFolder, surfaceId);
	if (!manifestSurface) {
		gaps.push({
			subsystemId: '*',
			kind: 'missing_manifest_surface',
			message: `Surface "${surfaceId}" is not registered in workspace.goal.json`,
		});
	}

	let satisfied = 0;
	const totalSubsystemChecks = blueprint.subsystems.length;

	for (const subsystem of blueprint.subsystems) {
		const pathOk = await subsystemPathsExist(fileService, workspaceFolder, subsystem.paths, subsystem.minFiles ?? 1);
		if (!pathOk) {
			gaps.push({
				subsystemId: subsystem.id,
				kind: 'missing_path',
				message: `No files found for subsystem "${subsystem.label}" at: ${subsystem.paths.join(', ')}`,
			});
			continue;
		}
		satisfied++;
	}

	if (manifestSurface) {
		gaps.push(...compareManifestFields(blueprint.manifest.capabilities, manifestSurface.capabilities, 'capabilities'));
		gaps.push(...compareManifestFields(blueprint.manifest.events, manifestSurface.events, 'events'));
		gaps.push(...compareManifestFields(blueprint.manifest.entities, manifestSurface.entities, 'entities'));
		gaps.push(...compareManifestFields(blueprint.manifest.ixSubsystems, manifestSurface.ixSubsystems, 'ixSubsystems'));
	}

	gaps.push(...await verifyScaffoldBaseline(fileService, workspaceFolder, surfaceId, manifestSurface));

	let ixChecked = false;
	if (ixSubsystems && ixSubsystems.length > 0) {
		ixChecked = true;
		const surfacePathPrefix = manifestSurface?.path ?? `apps/${surfaceId}`;
		const scopedRegions = ixSubsystems.filter(region => regionIsUnderSurface(region, surfacePathPrefix, surfaceId));
		const regionsToCheck = scopedRegions.length > 0 ? scopedRegions : ixSubsystems;

		for (const subsystem of blueprint.subsystems) {
			if (!blueprintSubsystemMatchesIx(subsystem, regionsToCheck)) {
				gaps.push({
					subsystemId: subsystem.id,
					kind: 'ix_no_match',
					message: `Ix discovery found no region matching subsystem "${subsystem.label}"`,
				});
			}
		}
	}

	const passed = gaps.length === 0;

	return {
		passed,
		surfaceId,
		satisfiedCount: satisfied,
		totalCount: totalSubsystemChecks,
		gaps,
		ixChecked,
	};
}

export function formatSurfaceBlueprintGapReport(result: SurfaceBlueprintVerificationResult): string {
	const lines = [
		`Surface blueprint verification: ${result.surfaceId}`,
		`Status: ${result.passed ? 'PASSED' : 'FAILED'}`,
		`Subsystems: ${result.satisfiedCount}/${result.totalCount} satisfied`,
		result.ixChecked ? 'Ix discovery: checked' : 'Ix discovery: skipped',
	];
	if (result.gaps.length) {
		lines.push('', 'Gaps:');
		for (const gap of result.gaps) {
			lines.push(`- [${gap.kind}] ${gap.subsystemId}: ${gap.message}`);
		}
	}
	return lines.join('\n');
}

async function readManifestSurface(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
): Promise<GoalWorkspaceSurface | undefined> {
	try {
		const manifestUri = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);
		if (!(await fileService.exists(manifestUri))) {
			return undefined;
		}
		const raw = JSON.parse((await fileService.readFile(manifestUri)).value.toString());
		if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { surfaces?: unknown }).surfaces)) {
			return undefined;
		}
		const surfaces = (raw as { surfaces: unknown[] }).surfaces;
		for (const item of surfaces) {
			if (!item || typeof item !== 'object') {
				continue;
			}
			const id = (item as { id?: unknown }).id;
			if (typeof id !== 'string' || id !== surfaceId) {
				continue;
			}
			return {
				id,
				name: typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : surfaceId,
				type: optionalString((item as { type?: unknown }).type),
				path: optionalString((item as { path?: unknown }).path),
				devCommand: optionalString((item as { devCommand?: unknown }).devCommand),
				localUrl: optionalString((item as { localUrl?: unknown }).localUrl),
				purpose: optionalString((item as { purpose?: unknown }).purpose),
				capabilities: stringArray((item as { capabilities?: unknown }).capabilities),
				events: stringArray((item as { events?: unknown }).events),
				entities: stringArray((item as { entities?: unknown }).entities),
				ixSubsystems: stringArray((item as { ixSubsystems?: unknown }).ixSubsystems),
				ix: undefined,
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function compareManifestFields(
	expected: readonly string[],
	actual: readonly string[],
	fieldName: string,
): SurfaceBlueprintGap[] {
	const missing = expected.filter(value => !actual.some(item => item.toLowerCase() === value.toLowerCase()));
	return missing.map(value => ({
		subsystemId: '*',
		kind: 'missing_manifest_field' as const,
		message: `workspace.goal.json missing ${fieldName} value: ${value}`,
	}));
}

async function verifyScaffoldBaseline(
	fileService: IFileService,
	workspaceFolder: URI,
	surfaceId: string,
	manifestSurface: GoalWorkspaceSurface | undefined,
): Promise<SurfaceBlueprintGap[]> {
	const gaps: SurfaceBlueprintGap[] = [];
	const appRoot = joinPath(workspaceFolder, manifestSurface?.path ?? `apps/${surfaceId}`);
	const packageJson = joinPath(appRoot, 'package.json');
	if (!(await fileService.exists(packageJson))) {
		gaps.push({
			subsystemId: '*',
			kind: 'missing_scaffold_file',
			message: `Missing ${manifestSurface?.path ?? `apps/${surfaceId}`}/package.json`,
		});
	}
	const nextConfigs = ['next.config.ts', 'next.config.mjs', 'next.config.js'].map(name => joinPath(appRoot, name));
	const hasNextConfig = (await Promise.all(nextConfigs.map(uri => fileService.exists(uri)))).some(Boolean);
	if (!hasNextConfig) {
		gaps.push({
			subsystemId: '*',
			kind: 'missing_scaffold_file',
			message: `Missing next.config.* under ${manifestSurface?.path ?? `apps/${surfaceId}`}`,
		});
	}
	if (manifestSurface && !manifestSurface.devCommand?.trim()) {
		gaps.push({
			subsystemId: '*',
			kind: 'missing_manifest_field',
			message: 'workspace.goal.json surface missing devCommand',
		});
	}
	if (manifestSurface && !manifestSurface.localUrl?.trim()) {
		gaps.push({
			subsystemId: '*',
			kind: 'missing_manifest_field',
			message: 'workspace.goal.json surface missing localUrl',
		});
	}
	return gaps;
}

async function subsystemPathsExist(
	fileService: IFileService,
	workspaceFolder: URI,
	paths: readonly string[],
	minFiles: number,
): Promise<boolean> {
	let found = 0;
	for (const relativePath of paths) {
		const target = joinPath(workspaceFolder, ...relativePath.split('/'));
		if (await fileService.exists(target)) {
			const stat = await fileService.resolve(target);
			if (stat.isDirectory) {
				if (stat.children && stat.children.length > 0) {
					found++;
				}
			} else {
				found++;
			}
		}
	}
	return found >= minFiles;
}

function regionIsUnderSurface(region: IxSubsystemRegion, surfacePathPrefix: string, surfaceId: string): boolean {
	const normalizedPrefix = surfacePathPrefix.replace(/\\/g, '/').toLowerCase();
	const tokens = [normalizedPrefix, surfaceId.toLowerCase()];
	const paths = [region.entryPath, ...(region.memberFiles ?? [])].filter((path): path is string => Boolean(path));
	return paths.some(path => {
		const normalized = path.replace(/\\/g, '/').toLowerCase();
		return tokens.some(token => normalized.includes(token));
	});
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
}

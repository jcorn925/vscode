/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER } from './GoalConsoleService.js';
import type { GoalWorkspaceGoal } from './GoalConsoleService.js';
import { loadSurfaceTemplate } from './surfaceBlueprintTemplateRegistry.js';
import type { SurfaceBlueprint, SurfaceBlueprintTemplate } from './surfaceBlueprintTypes.js';

export const GOAL_WORKSPACE_SURFACE_BLUEPRINTS_FOLDER = 'surfaces';

export function blueprintResource(workspaceFolder: URI, surfaceId: string): URI {
	return joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_SURFACE_BLUEPRINTS_FOLDER, `${surfaceId}.blueprint.json`);
}

export function instantiateBlueprintFromTemplate(
	template: SurfaceBlueprintTemplate,
	options: { surfaceId: string; surfaceName?: string; goal?: GoalWorkspaceGoal },
): SurfaceBlueprint {
	const now = new Date().toISOString();
	const surfaceAppPrefix = `apps/${options.surfaceId}`;
	return {
		version: 1,
		surfaceId: options.surfaceId,
		surfaceName: options.surfaceName ?? template.surfaceName,
		templateId: template.templateId,
		status: 'draft',
		subsystems: template.requiredSubsystems.map(subsystem => ({
			...subsystem,
			paths: subsystem.paths.map(path => path.replace(`apps/${template.templateId}`, surfaceAppPrefix)),
		})),
		manifest: {
			capabilities: [...template.manifest.capabilities],
			events: [...template.manifest.events],
			entities: [...template.manifest.entities],
			ixSubsystems: [...template.manifest.ixSubsystems],
		},
		createdAt: now,
	};
}

export async function readBlueprint(fileService: IFileService, resource: URI): Promise<SurfaceBlueprint | undefined> {
	try {
		if (!(await fileService.exists(resource))) {
			return undefined;
		}
		const raw = JSON.parse((await fileService.readFile(resource)).value.toString());
		return parseBlueprint(raw);
	} catch {
		return undefined;
	}
}

export async function writeBlueprint(fileService: IFileService, workspaceFolder: URI, blueprint: SurfaceBlueprint): Promise<URI> {
	const resource = blueprintResource(workspaceFolder, blueprint.surfaceId);
	await fileService.createFolder(joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_SURFACE_BLUEPRINTS_FOLDER));
	await fileService.writeFile(resource, VSBuffer.fromString(`${JSON.stringify(blueprint, null, '\t')}\n`));
	return resource;
}

export async function applyBlueprintVerificationStatus(
	fileService: IFileService,
	workspaceFolder: URI,
	blueprint: SurfaceBlueprint,
	passed: boolean,
): Promise<void> {
	blueprint.status = passed ? 'verified' : 'failed';
	if (passed) {
		blueprint.verifiedAt = new Date().toISOString();
	}
	await writeBlueprint(fileService, workspaceFolder, blueprint);
}

export async function createBlueprintFromTemplateId(
	fileService: IFileService,
	workspaceFolder: URI,
	templateId: string,
	options: { surfaceId?: string; surfaceName?: string; goal?: GoalWorkspaceGoal },
): Promise<{ blueprint: SurfaceBlueprint; resource: URI } | undefined> {
	const template = loadSurfaceTemplate(templateId);
	if (!template) {
		return undefined;
	}
	const surfaceId = options.surfaceId ?? templateId;
	const blueprint = instantiateBlueprintFromTemplate(template, {
		surfaceId,
		surfaceName: options.surfaceName,
		goal: options.goal,
	});
	const resource = await writeBlueprint(fileService, workspaceFolder, blueprint);
	return { blueprint, resource };
}

function parseBlueprint(raw: unknown): SurfaceBlueprint | undefined {
	if (!isRecord(raw) || raw.version !== 1) {
		return undefined;
	}
	const surfaceId = optionalString(raw.surfaceId);
	const surfaceName = optionalString(raw.surfaceName);
	const templateId = optionalString(raw.templateId);
	const status = raw.status;
	if (!surfaceId || !surfaceName || !templateId || !isBlueprintStatus(status)) {
		return undefined;
	}
	const createdAt = optionalString(raw.createdAt);
	if (!createdAt) {
		return undefined;
	}
	const subsystems = parseSubsystems(raw.subsystems);
	const manifest = parseManifest(raw.manifest);
	if (!subsystems.length || !manifest) {
		return undefined;
	}
	return {
		version: 1,
		surfaceId,
		surfaceName,
		templateId,
		status,
		subsystems,
		manifest,
		createdAt,
		verifiedAt: optionalString(raw.verifiedAt),
	};
}

function parseSubsystems(raw: unknown): SurfaceBlueprint['subsystems'] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const result: SurfaceBlueprint['subsystems'][number][] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const id = optionalString(item.id);
		const label = optionalString(item.label);
		const kind = item.kind;
		const paths = stringArray(item.paths);
		if (!id || !label || !isSubsystemKind(kind) || !paths.length) {
			continue;
		}
		const minFiles = typeof item.minFiles === 'number' && Number.isFinite(item.minFiles) ? item.minFiles : undefined;
		result.push({ id, label, kind, paths, minFiles });
	}
	return result;
}

function parseManifest(raw: unknown): SurfaceBlueprint['manifest'] | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const capabilities = stringArray(raw.capabilities);
	const events = stringArray(raw.events);
	const entities = stringArray(raw.entities);
	const ixSubsystems = stringArray(raw.ixSubsystems);
	if (!capabilities.length && !events.length && !entities.length) {
		return undefined;
	}
	return { capabilities, events, entities, ixSubsystems };
}

function isBlueprintStatus(value: unknown): value is SurfaceBlueprint['status'] {
	return value === 'draft' || value === 'scaffolded' || value === 'verified' || value === 'failed';
}

function isSubsystemKind(value: unknown): value is SurfaceBlueprint['subsystems'][number]['kind'] {
	return value === 'route' || value === 'component' || value === 'api' || value === 'shared';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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

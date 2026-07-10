/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { instantiateBlueprintFromTemplate } from '../goalWorkspace/surfaceBlueprintService.js';
import { loadSurfaceTemplate } from '../goalWorkspace/surfaceBlueprintTemplateRegistry.js';
import type {
	SurfaceBlueprint,
	SurfaceBlueprintAcceptanceSpec,
	SurfaceBlueprintManifestSpec,
	SurfaceBlueprintTemplate,
	SurfaceSubsystemSpec,
} from '../goalWorkspace/surfaceBlueprintTypes.js';
import type { AgentTaskNode, AgentTaskTree } from './agentTaskTreeTypes.js';

export const SURFACE_CORE_BUILD_PLAN_SCAFFOLD_VERSION = 1 as const;

export interface SurfaceCoreBuildPlanLeaf {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly subsystemId?: string;
	readonly expectedPaths: readonly string[];
	readonly acceptanceChecks?: readonly string[];
}

export interface SurfaceCoreBuildPlanRoot {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly children: readonly SurfaceCoreBuildPlanLeaf[];
}

export interface SurfaceCoreBuildPlanScaffold {
	readonly version: typeof SURFACE_CORE_BUILD_PLAN_SCAFFOLD_VERSION;
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly templateId: string;
	readonly prompt: string;
	readonly roots: readonly SurfaceCoreBuildPlanRoot[];
}

export interface SurfaceCoreBuildPlanSource {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly templateId: string;
	readonly subsystems: readonly SurfaceSubsystemSpec[];
	readonly acceptance: SurfaceBlueprintAcceptanceSpec;
	readonly manifest: SurfaceBlueprintManifestSpec;
}

/** Prompt lines for Custom AI when regenerating a surface core build plan into this schema. */
export const SURFACE_CORE_BUILD_PLAN_SCAFFOLD_PROMPT_LINES = [
	'Return a SurfaceCoreBuildPlanScaffold JSON object only (version 1).',
	'Use fixed roots: Surface Scaffold, Routes and UI, APIs and Shared, Acceptance and Verification.',
	'Every leaf must include non-empty expectedPaths under apps/<surface-id> (or packages/ when shared).',
	'Map route/component blueprint subsystems to Routes and UI leaves; api/shared subsystems to APIs and Shared.',
	'Include acceptanceChecks for verification leaves so Ix and verifySurfaceBlueprint can score the plan.',
	'Do not emit Feature Planning, Agent Loop, UI Integration, or MVP Build Path roots for surface trees.',
] as const;

export const SURFACE_CORE_BUILD_PLAN_SCAFFOLD_GUIDANCE = SURFACE_CORE_BUILD_PLAN_SCAFFOLD_PROMPT_LINES.join('\n');

/** JSON Schema describing the LLM contract for surface core build plans. */
export const SURFACE_CORE_BUILD_PLAN_SCAFFOLD_JSON_SCHEMA = {
	type: 'object',
	required: ['version', 'surfaceId', 'surfaceName', 'templateId', 'prompt', 'roots'],
	properties: {
		version: { type: 'number', const: 1 },
		surfaceId: { type: 'string', minLength: 1 },
		surfaceName: { type: 'string', minLength: 1 },
		templateId: { type: 'string', minLength: 1 },
		prompt: { type: 'string', minLength: 1 },
		roots: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				required: ['id', 'title', 'children'],
				properties: {
					id: { type: 'string', minLength: 1 },
					title: { type: 'string', minLength: 1 },
					description: { type: 'string' },
					children: {
						type: 'array',
						minItems: 1,
						items: {
							type: 'object',
							required: ['id', 'title', 'description', 'expectedPaths'],
							properties: {
								id: { type: 'string', minLength: 1 },
								title: { type: 'string', minLength: 1 },
								description: { type: 'string', minLength: 1 },
								subsystemId: { type: 'string' },
								expectedPaths: {
									type: 'array',
									minItems: 1,
									items: { type: 'string', minLength: 1 },
								},
								acceptanceChecks: {
									type: 'array',
									items: { type: 'string', minLength: 1 },
								},
							},
						},
					},
				},
			},
		},
	},
} as const;

export function surfaceCoreBuildPlanSourceFromBlueprint(blueprint: SurfaceBlueprint): SurfaceCoreBuildPlanSource {
	return {
		surfaceId: blueprint.surfaceId,
		surfaceName: blueprint.surfaceName,
		templateId: blueprint.templateId,
		subsystems: blueprint.subsystems,
		acceptance: blueprint.acceptance,
		manifest: blueprint.manifest,
	};
}

export function surfaceCoreBuildPlanSourceFromTemplate(
	template: SurfaceBlueprintTemplate,
	options: { surfaceId: string; surfaceName?: string },
): SurfaceCoreBuildPlanSource {
	return surfaceCoreBuildPlanSourceFromBlueprint(instantiateBlueprintFromTemplate(template, options));
}

export function resolveSurfaceCoreBuildPlanSource(options: {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly templateId: string;
	readonly blueprint?: SurfaceBlueprint;
	readonly template?: SurfaceBlueprintTemplate;
}): SurfaceCoreBuildPlanSource | undefined {
	if (options.blueprint) {
		return surfaceCoreBuildPlanSourceFromBlueprint(options.blueprint);
	}
	if (options.template) {
		return surfaceCoreBuildPlanSourceFromTemplate(options.template, {
			surfaceId: options.surfaceId,
			surfaceName: options.surfaceName,
		});
	}
	const loaded = loadSurfaceTemplate(options.templateId);
	if (!loaded) {
		return undefined;
	}
	return surfaceCoreBuildPlanSourceFromTemplate(loaded, {
		surfaceId: options.surfaceId,
		surfaceName: options.surfaceName,
	});
}

export function buildSurfaceCoreBuildPlanScaffold(
	source: SurfaceCoreBuildPlanSource,
	prompt: string,
): SurfaceCoreBuildPlanScaffold {
	const slug = slugify(source.surfaceId) || 'surface';
	const surfacePath = `apps/${source.surfaceId}`;
	const routeUi = source.subsystems.filter(subsystem => subsystem.kind === 'route' || subsystem.kind === 'component');
	const apiShared = source.subsystems.filter(subsystem => subsystem.kind === 'api' || subsystem.kind === 'shared');

	const scaffoldLeaves: SurfaceCoreBuildPlanLeaf[] = [
		{
			id: `${slug}-scaffold-app-shell`,
			title: 'Scaffold app shell',
			description: `Create the Next.js App Router shell under ${surfacePath}, including package.json, app/layout.tsx, and next.config.`,
			expectedPaths: [
				`${surfacePath}/package.json`,
				`${surfacePath}/app/layout.tsx`,
				`${surfacePath}/next.config.mjs`,
			],
			acceptanceChecks: ['App shell files exist under apps/<surface-id>', 'Surface is registered in workspace.goal.json'],
		},
		{
			id: `${slug}-scaffold-manifest`,
			title: 'Register surface in workspace manifest',
			description: `Register path, localUrl, and devCommand for ${source.surfaceName} in workspace.goal.json.`,
			expectedPaths: ['workspace.goal.json'],
			acceptanceChecks: [`workspace.goal.json lists surface ${source.surfaceId}`],
		},
	];

	const routeLeaves: SurfaceCoreBuildPlanLeaf[] = routeUi.map(subsystem => ({
		id: `${slug}-ui-${subsystem.id}`,
		title: `Implement ${subsystem.label}`,
		description: `Build the ${subsystem.label} (${subsystem.kind}) for ${source.surfaceName}.`,
		subsystemId: subsystem.id,
		expectedPaths: [...subsystem.paths],
		acceptanceChecks: [`Subsystem ${subsystem.id} paths exist`, `UI covers ${subsystem.label}`],
	}));

	const apiLeaves: SurfaceCoreBuildPlanLeaf[] = apiShared.map(subsystem => ({
		id: `${slug}-api-${subsystem.id}`,
		title: `Implement ${subsystem.label}`,
		description: `Build the ${subsystem.label} (${subsystem.kind}) shared by ${source.surfaceName}.`,
		subsystemId: subsystem.id,
		expectedPaths: [...subsystem.paths],
		acceptanceChecks: [`Subsystem ${subsystem.id} paths exist`],
	}));

	if (source.manifest.entities.length || source.manifest.events.length) {
		apiLeaves.push({
			id: `${slug}-domain-shared`,
			title: 'Wire domain and events packages',
			description: `Ensure shared domain entities (${source.manifest.entities.join(', ') || 'none'}) and events (${source.manifest.events.join(', ') || 'none'}) are available to the surface.`,
			expectedPaths: ['packages/domain', 'packages/events'],
			acceptanceChecks: ['Domain and events packages are present for surface workflows'],
		});
	}

	const acceptanceLeaves: SurfaceCoreBuildPlanLeaf[] = [];
	if (source.acceptance.requiredRoutes.length) {
		acceptanceLeaves.push({
			id: `${slug}-acceptance-routes`,
			title: 'Cover required routes',
			description: `Implement required routes: ${source.acceptance.requiredRoutes.join(', ')}.`,
			expectedPaths: routeUi.flatMap(subsystem => [...subsystem.paths]).slice(0, 4).length
				? uniqueStrings(routeUi.flatMap(subsystem => [...subsystem.paths])).slice(0, 6)
				: [`${surfacePath}/app`],
			acceptanceChecks: source.acceptance.requiredRoutes.map(route => `Route ${route} is reachable`),
		});
	}
	if (source.acceptance.requiredWorkflows.length || source.acceptance.requiredUiSignals.length) {
		acceptanceLeaves.push({
			id: `${slug}-acceptance-workflows`,
			title: 'Satisfy workflow and UI signals',
			description: [
				source.acceptance.requiredWorkflows.length ? `Workflows: ${source.acceptance.requiredWorkflows.join(', ')}.` : undefined,
				source.acceptance.requiredUiSignals.length ? `UI signals: ${source.acceptance.requiredUiSignals.join(', ')}.` : undefined,
			].filter(Boolean).join(' '),
			expectedPaths: [`${surfacePath}/app`, `${surfacePath}/components`].filter(Boolean),
			acceptanceChecks: [
				...source.acceptance.requiredWorkflows.map(workflow => `Workflow "${workflow}" is represented`),
				...source.acceptance.requiredUiSignals.map(signal => `UI signal "${signal}" is present`),
			],
		});
	}
	acceptanceLeaves.push({
		id: `${slug}-verify-blueprint`,
		title: 'Verify surface blueprint and Ix shape',
		description: 'Call verifySurfaceBlueprint and ensure Ix subsystem regions match expectedPaths from this build plan.',
		expectedPaths: [surfacePath],
		acceptanceChecks: [
			'verifySurfaceBlueprint returns passed',
			'Ix validation finds no missing_path or missing_region gaps for this plan',
		],
	});

	return {
		version: SURFACE_CORE_BUILD_PLAN_SCAFFOLD_VERSION,
		surfaceId: source.surfaceId,
		surfaceName: source.surfaceName,
		templateId: source.templateId,
		prompt: prompt.trim(),
		roots: [
			{
				id: `${slug}-surface-scaffold`,
				title: 'Surface Scaffold',
				description: 'Create the runnable app shell and register the surface.',
				children: scaffoldLeaves,
			},
			{
				id: `${slug}-routes-ui`,
				title: 'Routes and UI',
				description: 'Implement route and component subsystems from the blueprint.',
				children: routeLeaves.length ? routeLeaves : [{
					id: `${slug}-routes-ui-home`,
					title: 'Implement primary surface UI',
					description: `Build the primary UI under ${surfacePath}/app.`,
					expectedPaths: [`${surfacePath}/app`],
					acceptanceChecks: ['Primary surface UI exists'],
				}],
			},
			{
				id: `${slug}-apis-shared`,
				title: 'APIs and Shared',
				description: 'Implement API/shared subsystems and domain packages.',
				children: apiLeaves.length ? apiLeaves : [{
					id: `${slug}-apis-shared-placeholder`,
					title: 'Confirm shared packages',
					description: 'Confirm shared packages used by this surface are present.',
					expectedPaths: ['packages/domain'],
					acceptanceChecks: ['Shared packages are available'],
				}],
			},
			{
				id: `${slug}-acceptance-verification`,
				title: 'Acceptance and Verification',
				description: 'Prove routes, workflows, and Ix shape against the blueprint.',
				children: acceptanceLeaves,
			},
		],
	};
}

export function parseSurfaceCoreBuildPlanScaffold(raw: unknown): SurfaceCoreBuildPlanScaffold | undefined {
	if (!isRecord(raw) || raw.version !== SURFACE_CORE_BUILD_PLAN_SCAFFOLD_VERSION) {
		return undefined;
	}
	const surfaceId = optionalString(raw.surfaceId);
	const surfaceName = optionalString(raw.surfaceName);
	const templateId = optionalString(raw.templateId);
	const prompt = optionalString(raw.prompt);
	if (!surfaceId || !surfaceName || !templateId || !prompt || !Array.isArray(raw.roots) || raw.roots.length === 0) {
		return undefined;
	}
	const roots: SurfaceCoreBuildPlanRoot[] = [];
	for (const rootRaw of raw.roots) {
		if (!isRecord(rootRaw)) {
			return undefined;
		}
		const id = optionalString(rootRaw.id);
		const title = optionalString(rootRaw.title);
		if (!id || !title || !Array.isArray(rootRaw.children) || rootRaw.children.length === 0) {
			return undefined;
		}
		const children: SurfaceCoreBuildPlanLeaf[] = [];
		for (const leafRaw of rootRaw.children) {
			if (!isRecord(leafRaw)) {
				return undefined;
			}
			const leafId = optionalString(leafRaw.id);
			const leafTitle = optionalString(leafRaw.title);
			const description = optionalString(leafRaw.description);
			const expectedPaths = stringArray(leafRaw.expectedPaths);
			if (!leafId || !leafTitle || !description || !expectedPaths?.length) {
				return undefined;
			}
			children.push({
				id: leafId,
				title: leafTitle,
				description,
				subsystemId: optionalString(leafRaw.subsystemId),
				expectedPaths,
				acceptanceChecks: stringArray(leafRaw.acceptanceChecks),
			});
		}
		roots.push({
			id,
			title,
			description: optionalString(rootRaw.description),
			children,
		});
	}
	return { version: SURFACE_CORE_BUILD_PLAN_SCAFFOLD_VERSION, surfaceId, surfaceName, templateId, prompt, roots };
}

export function scaffoldToAgentTaskTreeRoots(scaffold: SurfaceCoreBuildPlanScaffold): AgentTaskNode[] {
	let order = 1;
	const nextOrder = () => order++;
	return scaffold.roots.map(root => {
		const rootOrder = nextOrder();
		const children: AgentTaskNode[] = root.children.map(leaf => ({
			id: leaf.id,
			parentId: root.id,
			title: leaf.title,
			description: leaf.description,
			type: 'leaf' as const,
			status: 'pending' as const,
			order: nextOrder(),
			subsystemId: leaf.subsystemId,
			expectedPaths: [...leaf.expectedPaths],
			acceptanceChecks: leaf.acceptanceChecks ? [...leaf.acceptanceChecks] : undefined,
		}));
		return {
			id: root.id,
			title: root.title,
			description: root.description,
			type: 'root' as const,
			status: 'pending' as const,
			order: rootOrder,
			children,
		};
	});
}

export function scaffoldToAgentTaskTree(
	scaffold: SurfaceCoreBuildPlanScaffold,
	options?: { readonly id?: string; readonly createdAt?: string; readonly updatedAt?: string },
): AgentTaskTree {
	const now = options?.createdAt ?? new Date().toISOString();
	return {
		version: 1,
		id: options?.id ?? createTreeId(scaffold.prompt || scaffold.surfaceId),
		prompt: scaffold.prompt,
		createdAt: now,
		updatedAt: options?.updatedAt ?? now,
		status: 'active',
		roots: scaffoldToAgentTaskTreeRoots(scaffold),
		cursor: {},
		surfaceId: scaffold.surfaceId,
		surfaceName: scaffold.surfaceName,
		templateId: scaffold.templateId,
	};
}

function createTreeId(prompt: string): string {
	const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
	const slug = slugify(prompt).slice(0, 48) || 'task-tree';
	return `${stamp}-${slug}`;
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const result = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
	return result.length ? result : undefined;
}

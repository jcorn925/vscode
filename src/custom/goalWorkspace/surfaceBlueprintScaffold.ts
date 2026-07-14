/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { URI } from '../../vs/base/common/uri.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { WORKSPACE_MANIFEST } from './ConsoleService.js';
import type { SurfaceBlueprint } from './surfaceBlueprintTypes.js';
import { upsertWorkflowSpec, workflowCatalogResource } from './workflowCatalogService.js';
import type { WorkflowSpec } from './workflowCatalogTypes.js';

export interface ScaffoldSurfaceFromBlueprintResult {
	readonly surfaceId: string;
	readonly appPath: string;
	readonly localUrl: string;
	readonly createdFiles: readonly string[];
}

interface ManifestSurfaceRecord extends Record<string, unknown> {
	id: string;
	name: string;
	type: string;
	path: string;
	localUrl: string;
	devCommand: string;
	purpose: string;
	capabilities: readonly string[];
	events: readonly string[];
	entities: readonly string[];
	ixSubsystems: readonly string[];
}

const DEFAULT_PORT_BASE = 3001;

export async function scaffoldSurfaceFromBlueprint(
	fileService: IFileService,
	workspaceFolder: URI,
	blueprint: SurfaceBlueprint,
): Promise<ScaffoldSurfaceFromBlueprintResult> {
	const appPath = `apps/${blueprint.surfaceId}`;
	const manifest = await upsertManifestSurface(fileService, workspaceFolder, blueprint, appPath);
	const files = [
		...buildSurfaceFiles(blueprint, appPath, manifest.localUrl),
		...buildSharedWorkspaceFiles(blueprint, manifest),
	];
	const createdFiles: string[] = [];

	for (const [relativePath, content] of files) {
		await writeWorkspaceFile(fileService, workspaceFolder, relativePath, content);
		createdFiles.push(relativePath);
	}
	const seededWorkflow = buildSeedWorkflowSpec(blueprint, manifest);
	if (seededWorkflow) {
		const workflowsRoot = await resolveWorkflowsRoot(fileService, workspaceFolder);
		await upsertWorkflowSpec(fileService, workflowCatalogResource(workspaceFolder, workflowsRoot), seededWorkflow);
	}

	return {
		surfaceId: blueprint.surfaceId,
		appPath,
		localUrl: manifest.localUrl,
		createdFiles,
	};
}

async function resolveWorkflowsRoot(fileService: IFileService, workspaceFolder: URI): Promise<string> {
	try {
		const raw = JSON.parse((await fileService.readFile(joinPath(workspaceFolder, WORKSPACE_MANIFEST))).value.toString()) as Record<string, unknown>;
		const shared = isRecord(raw.shared) ? raw.shared : undefined;
		const workflows = shared && typeof shared.workflows === 'string' ? shared.workflows.trim() : '';
		return workflows || 'workflows';
	} catch {
		return 'workflows';
	}
}

function buildSeedWorkflowSpec(blueprint: SurfaceBlueprint, manifest: ManifestSurfaceRecord): WorkflowSpec | undefined {
	const routeSteps = blueprint.acceptance.requiredRoutes.map((route, index) => ({
		id: `navigate-${index + 1}`,
		type: 'navigate' as const,
		route,
	}));
	const uiSignalSteps = blueprint.acceptance.requiredUiSignals.map((signal, index) => ({
		id: `action-${index + 1}`,
		type: 'click' as const,
		target: { text: signal },
	}));
	const assertSteps = blueprint.acceptance.requiredWorkflows.slice(0, 2).map((workflow, index) => ({
		id: `assert-${index + 1}`,
		type: 'assertText' as const,
		target: { text: workflow },
	}));

	if (blueprint.surfaceId !== 'booking') {
		return {
			id: `${blueprint.surfaceId}-autoplay`,
			label: `${manifest.name} workflow`,
			scope: 'surface',
			surfaceId: blueprint.surfaceId,
			source: `template:${blueprint.templateId}`,
			steps: [{ id: 'ensure-server', type: 'ensureServer' }, ...routeSteps, ...uiSignalSteps, ...assertSteps],
			events: [...manifest.events],
			ixBindings: blueprint.manifest.ixSubsystems.slice(0, uiSignalSteps.length).map((label, index) => ({
				stepId: uiSignalSteps[index]?.id ?? `action-${index + 1}`,
				subsystemLabel: label,
			})),
		};
	}

	return {
		id: 'booking-intake',
		label: 'Booking intake flow',
		scope: 'surface',
		surfaceId: 'booking',
		source: `template:${blueprint.templateId}`,
		steps: [{ id: 'ensure-server', type: 'ensureServer' }, ...routeSteps, ...uiSignalSteps, ...assertSteps],
		events: [...manifest.events],
		ixBindings: [
			{ stepId: 'pick-package', subsystemLabel: 'Package Selection UI' },
			{ stepId: 'pick-time', subsystemLabel: 'Scheduling UI' },
		],
		fixtures: {
			leadEmail: 'booking-autoplay@example.com',
		},
	};
}

function buildSharedWorkspaceFiles(
	blueprint: SurfaceBlueprint,
	manifest: ManifestSurfaceRecord,
): readonly [string, string][] {
	const entities = uniqueStrings([...manifest.entities, ...blueprint.acceptance.requiredBusinessTerms]);
	const events = uniqueStrings([...manifest.events]);
	const workflows = uniqueStrings([...blueprint.acceptance.requiredWorkflows, ...manifest.capabilities]);
	const surfaceLabel = manifest.name || blueprint.surfaceName;
	const now = new Date().toISOString();

	return [
		['packages/domain/index.ts', [
			'export const goalWorkspaceDomain = {',
			`\tsurfaces: ${JSON.stringify([manifest.id])},`,
			`\tentities: ${JSON.stringify(entities)},`,
			`\tprimarySurface: '${escapeTsString(manifest.id)}',`,
			'} as const;',
			'',
		].join('\n')],
		['packages/events/index.ts', [
			'export const goalWorkspaceEvents = {',
			`\t${identifierFor(manifest.id)}: ${JSON.stringify(events)},`,
			'} as const;',
			'',
		].join('\n')],
		[`workflows/${manifest.id}.workflow.md`, [
			`# ${surfaceLabel} Workflow`,
			'',
			`Surface: \`${manifest.id}\``,
			`App path: \`${manifest.path}\``,
			`Preview: \`${manifest.localUrl}\``,
			'',
			'## Business Workflows',
			...workflows.map(workflow => `- ${workflow}`),
			'',
			'## Domain Entities',
			...entities.map(entity => `- ${entity}`),
			'',
			'## Events',
			...events.map(event => `- ${event}`),
			'',
		].join('\n')],
		['.agent/workspace-memory.md', [
			'# Workspace Memory',
			'',
			`Updated: ${now}`,
			'',
			`- Goal workspace includes the ${surfaceLabel} surface at \`${manifest.path}\`.`,
			`- Shared domain entities include ${entities.join(', ')}.`,
			`- Shared events include ${events.join(', ')}.`,
			`- Surface preview is expected at ${manifest.localUrl}.`,
			'',
		].join('\n')],
		[`.agent/surfaces/${manifest.id}.memory.md`, [
			`# ${surfaceLabel} Memory`,
			'',
			`Updated: ${now}`,
			'',
			`- Purpose: ${manifest.purpose}`,
			`- Capabilities: ${manifest.capabilities.join(', ')}`,
			`- Ix subsystems: ${manifest.ixSubsystems.join(', ')}`,
			`- Verification should cover ${workflows.join(', ')}.`,
			'',
		].join('\n')],
		['.agent/ix-surface-map.json', JSON.stringify({
			generatedAt: now,
			surfaces: {
				[manifest.id]: {
					path: manifest.path,
					localUrl: manifest.localUrl,
					ixSubsystems: manifest.ixSubsystems,
					entrypoints: [
						`${manifest.path}/app/page.tsx`,
						`${manifest.path}/lib/workflow.ts`,
					],
				},
			},
		}, null, '\t') + '\n'],
	];
}

async function upsertManifestSurface(
	fileService: IFileService,
	workspaceFolder: URI,
	blueprint: SurfaceBlueprint,
	appPath: string,
): Promise<ManifestSurfaceRecord> {
	const manifestResource = joinPath(workspaceFolder, WORKSPACE_MANIFEST);
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse((await fileService.readFile(manifestResource)).value.toString()) as Record<string, unknown>;
		if (!isRecord(raw)) {
			raw = {};
		}
	} catch {
		raw = {};
	}

	const normalizedManifest = normalizeWorkspaceManifest(raw);
	const surfaces: Record<string, unknown>[] = Array.isArray(normalizedManifest.surfaces) ? normalizedManifest.surfaces.filter(isRecord) : [];
	const existingIndex = surfaces.findIndex(surface => surface.id === blueprint.surfaceId);
	const existing = existingIndex >= 0 ? surfaces[existingIndex] : {};
	const localUrl = typeof existing.localUrl === 'string' && existing.localUrl.trim()
		? existing.localUrl.trim()
		: nextLocalUrl(surfaces);
	const surfacePath = typeof existing.path === 'string' && existing.path.trim() ? existing.path.trim() : appPath;
	const rawDevCommand = typeof existing.devCommand === 'string' && existing.devCommand.trim()
		? existing.devCommand.trim()
		: '';
	const normalizedDevCommand = normalizeSurfaceDevCommand(rawDevCommand, surfacePath);
	const surface: ManifestSurfaceRecord = {
		id: blueprint.surfaceId,
		name: blueprint.surfaceName,
		type: typeof existing.type === 'string' && existing.type.trim() ? existing.type.trim() : 'web-app',
		path: surfacePath,
		localUrl,
		devCommand: withPreferredPort(normalizedDevCommand, localUrl),
		purpose: typeof existing.purpose === 'string' && existing.purpose.trim()
			? existing.purpose.trim()
			: `Support ${blueprint.surfaceName} workflows for the goal workspace.`,
		capabilities: uniqueStrings([...stringArray(existing.capabilities), ...blueprint.manifest.capabilities]),
		events: uniqueStrings([...stringArray(existing.events), ...blueprint.manifest.events]),
		entities: uniqueStrings([...stringArray(existing.entities), ...blueprint.manifest.entities]),
		ixSubsystems: uniqueStrings([...stringArray(existing.ixSubsystems), ...blueprint.manifest.ixSubsystems]),
	};

	if (existingIndex >= 0) {
		surfaces[existingIndex] = { ...existing, ...surface };
	} else {
		surfaces.push(surface);
	}
	normalizedManifest.surfaces = surfaces;

	await fileService.writeFile(manifestResource, VSBuffer.fromString(`${JSON.stringify(normalizedManifest, null, '\t')}\n`));
	return surface;
}

export async function registerSurfaceFromBlueprint(
	fileService: IFileService,
	workspaceFolder: URI,
	blueprint: SurfaceBlueprint,
): Promise<{ readonly localUrl: string; readonly devCommand: string; readonly path: string }> {
	const surface = await upsertManifestSurface(fileService, workspaceFolder, blueprint, `apps/${blueprint.surfaceId}`);
	return {
		localUrl: surface.localUrl,
		devCommand: surface.devCommand,
		path: surface.path,
	};
}

function normalizeWorkspaceManifest(raw: Record<string, unknown>): Record<string, unknown> {
	const normalized: Record<string, unknown> = { ...raw };
	const goalRaw = isRecord(raw.goal) ? raw.goal : raw;
	const goalId = typeof goalRaw.id === 'string' && goalRaw.id.trim() ? goalRaw.id.trim() : 'goal-workspace';
	const goalName = typeof goalRaw.name === 'string' && goalRaw.name.trim() ? goalRaw.name.trim() : 'Goal Workspace';
	const goal: Record<string, unknown> = {
		id: goalId,
		name: goalName,
	};
	const description = typeof goalRaw.description === 'string' && goalRaw.description.trim() ? goalRaw.description.trim() : undefined;
	const northStarMetric = typeof goalRaw.northStarMetric === 'string' && goalRaw.northStarMetric.trim() ? goalRaw.northStarMetric.trim() : undefined;
	if (description) {
		goal.description = description;
	}
	if (northStarMetric) {
		goal.northStarMetric = northStarMetric;
	}
	normalized.goal = goal;

	if (!Array.isArray(normalized.surfaces)) {
		normalized.surfaces = [];
	}
	if (!isRecord(normalized.shared)) {
		normalized.shared = {};
	}
	if (!isRecord(normalized.brand) && isRecord(raw.branding)) {
		normalized.brand = normalizeLegacyBrand(raw.branding);
	}
	delete normalized.id;
	delete normalized.name;
	delete normalized.description;
	delete normalized.northStarMetric;
	delete normalized.branding;

	if (!Object.keys(normalized.shared as Record<string, unknown>).length) {
		normalized.shared = {
			domain: 'packages/domain',
			events: 'packages/events',
			ui: 'packages/ui',
			auth: 'packages/auth',
			workflows: 'workflows',
		};
	}

	return normalized;
}

function normalizeLegacyBrand(brand: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (typeof brand.primaryColor === 'string') {
		result.primaryColor = brand.primaryColor;
	}
	if (typeof brand.secondaryColor === 'string') {
		result.secondaryColor = brand.secondaryColor;
	}
	if (typeof brand.accentColor === 'string') {
		result.accentColor = brand.accentColor;
	}
	if (typeof brand.logoLight === 'string') {
		result.logoPath = brand.logoLight;
	}
	if (typeof brand.logoDark === 'string') {
		result.logoMarkPath = brand.logoDark;
	}
	return result;
}

function buildSurfaceFiles(blueprint: SurfaceBlueprint, appPath: string, localUrl: string): readonly [string, string][] {
	const title = blueprint.surfaceName;
	const subsystemLinks = blueprint.subsystems
		.map(subsystem => `\t\t\t<li><a href="/${routePathFromSubsystem(subsystem.paths[0])}">${escapeHtml(subsystem.label)}</a></li>`)
		.join('\n');
	const files: [string, string][] = [
		[`${appPath}/package.json`, JSON.stringify({
			private: true,
			scripts: {
				dev: 'next dev',
				build: 'next build',
				start: 'next start',
			},
			dependencies: {
				'@next/env': 'latest',
				next: 'latest',
				react: 'latest',
				'react-dom': 'latest',
			},
			devDependencies: {
				typescript: 'latest',
				'@types/node': 'latest',
				'@types/react': 'latest',
				'@types/react-dom': 'latest',
			},
		}, null, '\t') + '\n'],
		[`${appPath}/next.config.mjs`, 'const nextConfig = {};\n\nexport default nextConfig;\n'],
		[`${appPath}/tsconfig.json`, JSON.stringify({
			compilerOptions: {
				target: 'ES2017',
				lib: ['dom', 'dom.iterable', 'esnext'],
				allowJs: true,
				skipLibCheck: true,
				strict: true,
				noEmit: true,
				esModuleInterop: true,
				module: 'esnext',
				moduleResolution: 'bundler',
				resolveJsonModule: true,
				isolatedModules: true,
				jsx: 'preserve',
				incremental: true,
				plugins: [{ name: 'next' }],
			},
			include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
			exclude: ['node_modules'],
		}, null, '\t') + '\n'],
		[`${appPath}/next-env.d.ts`, '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// This file is generated by Next.js.\n'],
		[`${appPath}/app/globals.css`, [
			':root {',
			'\tcolor-scheme: dark;',
			'\tfont-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
			'}',
			'body {',
			'\tmargin: 0;',
			'\tbackground: #0f172a;',
			'\tcolor: #e5e7eb;',
			'}',
			'a { color: #60a5fa; }',
			'.surface-shell { min-height: 100vh; padding: 48px; }',
			'.surface-panel { max-width: 960px; border: 1px solid #334155; border-radius: 8px; padding: 32px; background: #111827; }',
			'.surface-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }',
			'.surface-card { border: 1px solid #334155; border-radius: 8px; padding: 20px; background: #0b1220; }',
			'',
		].join('\n')],
		[`${appPath}/app/layout.tsx`, [
			"import './globals.css';",
			"import type { Metadata } from 'next';",
			'',
			'export const metadata: Metadata = {',
			`\ttitle: '${escapeTsString(title)}',`,
			`\tdescription: '${escapeTsString(blueprint.surfaceId)} goal workspace surface',`,
			'};',
			'',
			'export default function RootLayout({ children }: { children: React.ReactNode }) {',
			'\treturn (',
			'\t\t<html lang="en">',
			'\t\t\t<body>{children}</body>',
			'\t\t</html>',
			'\t);',
			'}',
			'',
		].join('\n')],
		[`${appPath}/app/page.tsx`, [
			'export default function SurfaceHome() {',
			'\treturn (',
			'\t\t<main className="surface-shell">',
			'\t\t\t<section className="surface-panel">',
			`\t\t\t\t<p>${escapeHtml(blueprint.surfaceId)} surface</p>`,
			`\t\t\t\t<h1>${escapeHtml(title)}</h1>`,
			`\t\t\t\t<p>Runnable starter scaffold for ${escapeHtml(title)} at ${escapeHtml(localUrl)}.</p>`,
			'\t\t\t\t<ul>',
			subsystemLinks,
			'\t\t\t\t</ul>',
			'\t\t\t</section>',
			'\t\t</main>',
			'\t);',
			'}',
			'',
		].join('\n')],
	];

	const coreSurfaceFiles = buildCoreSurfaceFiles(blueprint, appPath, localUrl);
	if (coreSurfaceFiles.length) {
		return dedupeFiles([...coreSurfaceFiles, ...files]);
	}

	for (const subsystem of blueprint.subsystems) {
		for (const path of subsystem.paths) {
			if (path.endsWith('.tsx') || path.endsWith('.ts')) {
				files.push([path, scaffoldFileForPath(path, subsystem.label, blueprint.surfaceName)]);
			} else {
				files.push([`${path}/page.tsx`, scaffoldFileForPath(`${path}/page.tsx`, subsystem.label, blueprint.surfaceName)]);
			}
		}
	}

	return dedupeFiles(files);
}

function buildCoreSurfaceFiles(blueprint: SurfaceBlueprint, appPath: string, localUrl: string): readonly [string, string][] {
	switch (blueprint.templateId) {
		case 'booking':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Booking workspace',
					summary: 'Guide a prospect from package selection through session scheduling, intake, checkout, and confirmation.',
					steps: ['Choose a package', 'Select session time', 'Complete intake', 'Review checkout', 'See confirmation'],
					controls: ['Start booking', 'Compare packages', 'Continue'],
				},
				{
					route: '/packages',
					headline: 'Package cards',
					summary: 'Show training packages with pricing, duration, included coaching touchpoints, and booking CTAs.',
					steps: ['Strength Reset - 8 weeks - $499', 'Mobility Builder - 6 weeks - $349', 'Performance Coaching - 12 weeks - $899'],
					controls: ['Select Strength Reset', 'Select Mobility Builder', 'Select Performance Coaching'],
				},
				{
					route: '/schedule',
					headline: 'Time slots',
					summary: 'Let the lead choose a first consultation session and review coach availability.',
					steps: ['Tuesday 9:00 AM', 'Wednesday 12:30 PM', 'Friday 4:00 PM'],
					controls: ['Choose Tuesday', 'Choose Wednesday', 'Choose Friday'],
				},
				{
					route: '/intake',
					headline: 'Intake form',
					summary: 'Capture goals, constraints, injuries, preferred schedule, and readiness before checkout.',
					steps: ['Fitness goal', 'Training history', 'Injury notes', 'Preferred session cadence'],
					controls: ['Full name', 'Email', 'Primary goal', 'Submit intake'],
				},
				{
					route: '/checkout',
					headline: 'Payment summary',
					summary: 'Summarize package, session time, price, cancellation terms, and payment method before booking.',
					steps: ['Package total $499', 'Due today $99 deposit', 'Cancellation window 24 hours'],
					controls: ['Card number', 'Apply promo', 'Complete checkout'],
				},
				{
					route: '/confirmation',
					headline: 'Confirmation',
					summary: 'Confirm the booking, explain next steps, and send the client into account setup.',
					steps: ['Booking completed', 'Coach notified', 'Client portal invite queued'],
					controls: ['Add to calendar', 'Open client portal', 'Send confirmation'],
				},
			], ['TrainingPackage', 'Booking', 'Lead', 'booking.started', 'booking.completed']);
		case 'marketing':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Lead generation home',
					summary: 'Convert visitors with a clear training promise, proof, package teaser, and booking handoff.',
					steps: ['Outcome-focused hero', 'Client proof', 'Package preview', 'Book a consult'],
					controls: ['Start training', 'Choose a package', 'Book a consult'],
				},
				{
					route: '/offers',
					headline: 'Offer comparison',
					summary: 'Compare packages, pricing, coaching level, and who each offer is best for.',
					steps: ['Strength Reset', 'Mobility Builder', 'Performance Coaching'],
					controls: ['View details', 'Select package', 'Ask a question'],
				},
				{
					route: '/contact',
					headline: 'Lead form',
					summary: 'Capture lead information and route qualified prospects into the booking surface.',
					steps: ['Goal', 'Timeline', 'Budget', 'Preferred contact'],
					controls: ['Name', 'Email', 'Primary goal', 'Send lead'],
				},
			], ['Lead', 'Offer', 'testimonial', 'conversion', 'booking?package=strength-reset']);
		case 'client-portal':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Client dashboard',
					summary: 'Give clients a clear home for their plan, next session, progress, messages, and account state.',
					steps: ['Next session', 'Current plan', 'Weekly progress', 'Trainer message'],
					controls: ['View plan', 'Log progress', 'Message trainer'],
				},
				{
					route: '/dashboard',
					headline: 'Client dashboard',
					summary: 'Surface today\'s actions and upcoming coaching commitments for active clients.',
					steps: ['Workout due today', 'Nutrition check-in', 'Coach feedback'],
					controls: ['Mark complete', 'Upload result', 'Request change'],
				},
				{
					route: '/plans',
					headline: 'Session plan',
					summary: 'Show the active training plan, session notes, assignments, and package progress.',
					steps: ['Phase 1 strength', 'Phase 2 conditioning', 'Recovery block'],
					controls: ['Open session', 'Download plan', 'Ask about plan'],
				},
				{
					route: '/progress',
					headline: 'Progress tracker',
					summary: 'Track measurements, milestones, habit streaks, and client-reported outcomes.',
					steps: ['Weight trend', 'Workout adherence', 'Mobility score'],
					controls: ['Add measurement', 'Log workout', 'Share progress'],
				},
				{
					route: '/messages',
					headline: 'Messages',
					summary: 'Keep trainer and client communication tied to sessions, progress, and account needs.',
					steps: ['Unread coach note', 'Plan adjustment', 'Session reminder'],
					controls: ['Reply', 'Attach photo', 'Mark resolved'],
				},
				{
					route: '/account',
					headline: 'Account summary',
					summary: 'Show billing status, package renewal date, cancellation policy, and profile settings.',
					steps: ['Active subscription', 'Renewal date', 'Payment method'],
					controls: ['Update card', 'Change package', 'Cancel plan'],
				},
			], ['Client', 'SessionPlan', 'ProgressEntry', 'client.progress.updated']);
		case 'trainer-admin':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Coach dashboard',
					summary: 'Run daily coaching operations across clients, sessions, follow-ups, and revenue risk.',
					steps: ['Today\'s sessions', 'At-risk clients', 'Follow-up queue', 'Package renewals'],
					controls: ['Review schedule', 'Create follow-up', 'Open roster'],
				},
				{
					route: '/clients',
					headline: 'Client roster',
					summary: 'Review clients by status, package, next session, adherence, and required coach action.',
					steps: ['Active clients', 'Trial leads', 'Paused accounts'],
					controls: ['Filter status', 'Open client', 'Assign coach'],
				},
				{
					route: '/roster',
					headline: 'Client roster',
					summary: 'Operational roster view for coach ownership, risk level, and plan status.',
					steps: ['Coach owner', 'Risk score', 'Current phase'],
					controls: ['Sort by risk', 'Send message', 'Create task'],
				},
				{
					route: '/sessions',
					headline: 'Session board',
					summary: 'Manage upcoming sessions, completion state, notes, and reschedule requests.',
					steps: ['Scheduled', 'Completed', 'Needs notes'],
					controls: ['Add session', 'Reschedule', 'Complete session'],
				},
				{
					route: '/follow-ups',
					headline: 'Follow-up queue',
					summary: 'Assign and close retention, onboarding, missed-session, and renewal follow-ups.',
					steps: ['Missed check-in', 'Renewal reminder', 'New client onboarding'],
					controls: ['Assign follow-up', 'Set due date', 'Mark done'],
				},
			], ['Coach', 'Client', 'Session', 'followup.created', 'session.scheduled']);
		case 'analytics':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Analytics home',
					summary: 'Monitor conversion, retention, revenue, and north-star KPIs across the training business.',
					steps: ['Funnel conversion', 'Revenue trend', 'Retention cohorts', 'North star KPI'],
					controls: ['Filter date range', 'Export report', 'Open funnel'],
				},
				{
					route: '/funnel',
					headline: 'Funnel dashboard',
					summary: 'Track lead-to-booking conversion across marketing, booking, and client activation stages.',
					steps: ['Landing visits', 'Lead capture', 'Booking started', 'Booking completed'],
					controls: ['View funnel', 'Compare periods', 'Drill into stage'],
				},
				{
					route: '/dashboard',
					headline: 'Funnel dashboard',
					summary: 'Executive view of funnel health, campaign attribution, and conversion drop-offs.',
					steps: ['Top of funnel', 'Qualified leads', 'Booked sessions', 'Activated clients'],
					controls: ['Filter campaign', 'Segment audience', 'Share dashboard'],
				},
				{
					route: '/revenue',
					headline: 'Revenue reporting',
					summary: 'Report package revenue, recurring subscriptions, and coach utilization impact.',
					steps: ['Monthly recurring revenue', 'Package revenue', 'Refund rate', 'Average order value'],
					controls: ['Download CSV', 'Filter package', 'Compare month'],
				},
				{
					route: '/kpi',
					headline: 'North star KPI',
					summary: 'Track the primary growth metric and supporting indicators for the training business.',
					steps: ['Active paid clients', 'Retention rate', 'Session completion', 'Coach capacity'],
					controls: ['Set KPI target', 'Add annotation', 'View trend'],
				},
				{
					route: '/metrics',
					headline: 'North star KPI',
					summary: 'Drill into metric definitions, benchmarks, and weekly movement for leadership reviews.',
					steps: ['Metric definition', 'Current value', 'Weekly delta', 'Owner'],
					controls: ['Edit metric', 'Pin to dashboard', 'Alert threshold'],
				},
				{
					route: '/reports',
					headline: 'Analytics reports',
					summary: 'Export scheduled reports for funnel, revenue, retention, and campaign performance.',
					steps: ['Weekly funnel report', 'Monthly revenue report', 'Retention cohort export'],
					controls: ['Schedule report', 'Email report', 'Export PDF'],
				},
			], ['Metric', 'Campaign', 'Subscription', 'analytics.report.viewed', 'conversion', 'retention']);
		case 'content-scheduler':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Content scheduler home',
					summary: 'Plan campaigns, schedule posts, and review channel performance from one editorial workspace.',
					steps: ['Editorial calendar', 'Campaign drafts', 'Scheduled posts', 'Performance review'],
					controls: ['Create campaign', 'Schedule post', 'Open calendar'],
				},
				{
					route: '/calendar',
					headline: 'Editorial calendar',
					summary: 'See upcoming posts, campaign launches, and channel cadence across the month.',
					steps: ['Monday post', 'Wednesday reel', 'Friday newsletter'],
					controls: ['Add post', 'Move slot', 'Filter channel'],
				},
				{
					route: '/campaigns',
					headline: 'Campaign planning',
					summary: 'Define campaign goals, audiences, creative themes, and publishing windows.',
					steps: ['Spring challenge', 'Referral push', 'New package launch'],
					controls: ['New campaign', 'Assign owner', 'Set launch date'],
				},
				{
					route: '/compose',
					headline: 'Post composer',
					summary: 'Draft post copy, attach media, choose channels, and queue publish times.',
					steps: ['Hook', 'Body copy', 'Call to action', 'Channel selection'],
					controls: ['Post title', 'Post body', 'Schedule publish'],
				},
				{
					route: '/posts',
					headline: 'Post composer',
					summary: 'Manage draft, scheduled, and published posts with channel-specific previews.',
					steps: ['Draft queue', 'Scheduled queue', 'Published archive'],
					controls: ['Edit draft', 'Duplicate post', 'Preview channel'],
				},
				{
					route: '/performance',
					headline: 'Post performance',
					summary: 'Review engagement, clicks, leads, and campaign attribution by channel.',
					steps: ['Impressions', 'Engagement rate', 'Lead clicks', 'Top post'],
					controls: ['Filter channel', 'Compare campaign', 'Export metrics'],
				},
			], ['Post', 'Campaign', 'Channel', 'content.scheduled', 'campaign.created']);
		case 'ads-manager':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Ads manager home',
					summary: 'Launch campaigns, test creatives, and monitor spend against booked consult conversions.',
					steps: ['Active campaigns', 'Audience tests', 'Creative experiments', 'Spend pacing'],
					controls: ['Create campaign', 'Review spend', 'Open creatives'],
				},
				{
					route: '/campaigns',
					headline: 'Campaign setup',
					summary: 'Configure campaign objective, budget, schedule, and conversion destination.',
					steps: ['Lead generation', 'Booking conversion', 'Retargeting'],
					controls: ['Campaign name', 'Daily budget', 'Launch campaign'],
				},
				{
					route: '/audience',
					headline: 'Audience targeting',
					summary: 'Define lookalike, interest, and retargeting audiences for training offers.',
					steps: ['Local prospects', 'Website visitors', 'Past leads'],
					controls: ['Add audience', 'Exclude list', 'Save segment'],
				},
				{
					route: '/creatives',
					headline: 'Creative testing',
					summary: 'Compare headlines, images, and offers to improve cost per booked consult.',
					steps: ['Variant A', 'Variant B', 'Winner selection'],
					controls: ['Upload creative', 'Start test', 'Pause variant'],
				},
				{
					route: '/spend',
					headline: 'Spend analysis',
					summary: 'Track daily spend, pacing, and cost per lead across active campaigns.',
					steps: ['Spend today', 'Budget remaining', 'Cost per lead'],
					controls: ['Adjust budget', 'Filter campaign', 'Export spend'],
				},
				{
					route: '/roas',
					headline: 'Spend analysis',
					summary: 'Measure return on ad spend against booked packages and subscription revenue.',
					steps: ['ROAS by campaign', 'Attributed revenue', 'Payback period'],
					controls: ['Set ROAS target', 'Compare window', 'Share report'],
				},
			], ['AdCampaign', 'Audience', 'Creative', 'ad.campaign.launched', 'ad.spend.updated', 'roas']);
		case 'subscriptions':
			return buildWorkflowSurfaceFiles(blueprint, appPath, localUrl, [
				{
					route: '/',
					headline: 'Subscriptions home',
					summary: 'Manage plans, billing status, renewals, and cancellation workflows in one place.',
					steps: ['Active plans', 'Billing health', 'Upcoming renewals', 'Cancellation queue'],
					controls: ['Create plan', 'Review billing', 'Open lifecycle'],
				},
				{
					route: '/plans',
					headline: 'Plan management',
					summary: 'Configure package tiers, pricing, billing cadence, and included coaching benefits.',
					steps: ['Starter plan', 'Growth plan', 'Elite plan'],
					controls: ['Add plan', 'Edit pricing', 'Archive plan'],
				},
				{
					route: '/billing',
					headline: 'Billing status',
					summary: 'Review invoices, failed payments, dunning state, and account balances.',
					steps: ['Paid accounts', 'Past due', 'Failed payment retries'],
					controls: ['Filter status', 'Retry payment', 'Send invoice'],
				},
				{
					route: '/lifecycle',
					headline: 'Lifecycle events',
					summary: 'Track subscription created, upgraded, renewed, paused, and cancelled events.',
					steps: ['Trial started', 'Upgrade event', 'Renewal event'],
					controls: ['View timeline', 'Filter event', 'Export events'],
				},
				{
					route: '/events',
					headline: 'Lifecycle events',
					summary: 'Operational event feed for billing, renewal, and retention automations.',
					steps: ['subscription.created', 'subscription.renewed', 'subscription.cancelled'],
					controls: ['Filter lifecycle', 'Replay event', 'Create webhook'],
				},
				{
					route: '/cancel',
					headline: 'Cancellation workflow',
					summary: 'Guide clients through save offers, downgrade options, and exit surveys.',
					steps: ['Save offer', 'Downgrade option', 'Exit survey'],
					controls: ['Apply save offer', 'Confirm cancellation', 'Collect reason'],
				},
			], ['Subscription', 'Plan', 'BillingAccount', 'subscription.created', 'subscription.cancelled']);
		default:
			return [];
	}
}

interface WorkflowPageSpec {
	readonly route: string;
	readonly headline: string;
	readonly summary: string;
	readonly steps: readonly string[];
	readonly controls: readonly string[];
}

function buildWorkflowSurfaceFiles(
	blueprint: SurfaceBlueprint,
	appPath: string,
	localUrl: string,
	pages: readonly WorkflowPageSpec[],
	domainSignals: readonly string[],
): readonly [string, string][] {
	const files: [string, string][] = [
		[`${appPath}/components/SurfaceNav.tsx`, workflowNavFile(blueprint.surfaceName, pages)],
		[`${appPath}/components/WorkflowCard.tsx`, workflowCardFile()],
		[`${appPath}/lib/workflow.ts`, workflowDataFile(blueprint, pages, domainSignals, localUrl)],
		[`${appPath}/app/globals.css`, workflowCssFile()],
	];
	for (const page of pages) {
		files.push([routeFilePath(appPath, page.route), workflowPageFile(blueprint, page, domainSignals)]);
	}
	for (const subsystem of blueprint.subsystems) {
		for (const path of subsystem.paths) {
			if (!path.includes('/components/')) {
				continue;
			}
			const componentPath = path.endsWith('.tsx') || path.endsWith('.ts') ? path : `${path}/Checklist.tsx`;
			files.push([componentPath, workflowSupportComponentFile(subsystem.label, blueprint.surfaceName)]);
		}
	}
	return files;
}

function routeFilePath(appPath: string, route: string): string {
	if (route === '/') {
		return `${appPath}/app/page.tsx`;
	}
	return `${appPath}/app/${route.replace(/^\//, '')}/page.tsx`;
}

function workflowNavFile(surfaceName: string, pages: readonly WorkflowPageSpec[]): string {
	const links = pages.map(page => `\t\t\t<a href="${page.route}">${escapeTsString(page.headline)}</a>`).join('\n');
	return [
		'export function SurfaceNav() {',
		'\treturn (',
		'\t\t<nav className="surface-nav" aria-label="Surface workflow">',
		`\t\t\t<strong>${escapeHtml(surfaceName)}</strong>`,
		links,
		'\t\t</nav>',
		'\t);',
		'}',
		'',
	].join('\n');
}

function workflowCardFile(): string {
	return [
		'export function WorkflowCard({ title, children }: { title: string; children: React.ReactNode }) {',
		'\treturn (',
		'\t\t<section className="workflow-card">',
		'\t\t\t<h2>{title}</h2>',
		'\t\t\t{children}',
		'\t\t</section>',
		'\t);',
		'}',
		'',
	].join('\n');
}

function workflowDataFile(blueprint: SurfaceBlueprint, pages: readonly WorkflowPageSpec[], domainSignals: readonly string[], localUrl: string): string {
	return [
		'export const surfaceWorkflow = {',
		`\tsurface: '${escapeTsString(blueprint.surfaceName)}',`,
		`\tlocalUrl: '${escapeTsString(localUrl)}',`,
		`\tworkflows: ${JSON.stringify(blueprint.acceptance.requiredWorkflows)},`,
		`\tbusinessTerms: ${JSON.stringify(blueprint.acceptance.requiredBusinessTerms)},`,
		`\tdomainSignals: ${JSON.stringify(domainSignals)},`,
		`\troutes: ${JSON.stringify(pages.map(page => page.route))},`,
		'};',
		'',
	].join('\n');
}

function workflowPageFile(blueprint: SurfaceBlueprint, page: WorkflowPageSpec, domainSignals: readonly string[]): string {
	const importPrefix = page.route === '/' ? '..' : '../..';
	const stepItems = page.steps.map(step => `\t\t\t\t\t<li>${escapeHtml(step)}</li>`).join('\n');
	const signalItems = domainSignals.map(signal => `\t\t\t\t\t<li>${escapeHtml(signal)}</li>`).join('\n');
	const controlNodes = page.controls.map((control) => {
		if (/email|name|goal|card|filter|date/i.test(control)) {
			return `\t\t\t\t\t<label>${escapeHtml(control)}<input aria-label="${escapeHtml(control)}" placeholder="${escapeHtml(control)}" /></label>`;
		}
		return `\t\t\t\t\t<button type="button">${escapeHtml(control)}</button>`;
	}).join('\n');
	return [
		`import { SurfaceNav } from '${importPrefix}/components/SurfaceNav';`,
		`import { WorkflowCard } from '${importPrefix}/components/WorkflowCard';`,
		`import { surfaceWorkflow } from '${importPrefix}/lib/workflow';`,
		'',
		`export default function ${componentNameFromRoute(page.route, blueprint.surfaceId)}() {`,
		'\treturn (',
		'\t\t<main className="surface-shell">',
		'\t\t\t<SurfaceNav />',
		'\t\t\t<section className="surface-hero">',
		`\t\t\t\t<p className="eyebrow">${escapeHtml(blueprint.surfaceName)} workflow</p>`,
		`\t\t\t\t<h1>${escapeHtml(page.headline)}</h1>`,
		`\t\t\t\t<p>${escapeHtml(page.summary)}</p>`,
		'\t\t\t</section>',
		'\t\t\t<div className="surface-grid">',
		'\t\t\t\t<WorkflowCard title="Workflow steps">',
		'\t\t\t\t\t<ol>',
		stepItems,
		'\t\t\t\t\t</ol>',
		'\t\t\t\t</WorkflowCard>',
		'\t\t\t\t<WorkflowCard title="Business context">',
		'\t\t\t\t\t<ul>',
		signalItems,
		'\t\t\t\t\t</ul>',
		'\t\t\t\t\t<p>{surfaceWorkflow.workflows.join(", ")}</p>',
		'\t\t\t\t</WorkflowCard>',
		'\t\t\t\t<WorkflowCard title="Actions">',
		'\t\t\t\t\t<div className="control-grid">',
		controlNodes,
		'\t\t\t\t\t</div>',
		'\t\t\t\t</WorkflowCard>',
		'\t\t\t</div>',
		'\t\t</main>',
		'\t);',
		'}',
		'',
	].join('\n');
}

function workflowSupportComponentFile(label: string, surfaceName: string): string {
	return [
		`export function ${componentNameFromPath(label)}Checklist() {`,
		'\treturn (',
		'\t\t<aside className="workflow-card">',
		`\t\t\t<h2>${escapeHtml(label)}</h2>`,
		`\t\t\t<p>${escapeHtml(surfaceName)} support component for product-specific workflow verification.</p>`,
		'\t\t\t<label>Owner<input aria-label="Owner" placeholder="Owner" /></label>',
		'\t\t\t<button type="button">Save checklist</button>',
		'\t\t</aside>',
		'\t);',
		'}',
		'',
	].join('\n');
}

function workflowCssFile(): string {
	return [
		':root {',
		'\tcolor-scheme: dark;',
		'\tfont-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
		'}',
		'body { margin: 0; background: #0f172a; color: #e5e7eb; }',
		'a { color: #93c5fd; text-decoration: none; }',
		'button, input { border: 1px solid #475569; border-radius: 6px; padding: 10px 12px; background: #111827; color: #f8fafc; }',
		'button { cursor: pointer; background: #2563eb; border-color: #3b82f6; }',
		'label { display: grid; gap: 6px; color: #cbd5e1; }',
		'.surface-shell { min-height: 100vh; padding: 32px; display: grid; gap: 24px; }',
		'.surface-nav { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 16px; }',
		'.surface-hero { max-width: 920px; border: 1px solid #334155; border-radius: 8px; padding: 28px; background: #111827; }',
		'.surface-hero h1 { margin: 0 0 12px; font-size: 36px; }',
		'.eyebrow { color: #38bdf8; text-transform: uppercase; font-size: 12px; letter-spacing: 0; }',
		'.surface-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }',
		'.workflow-card { border: 1px solid #334155; border-radius: 8px; padding: 20px; background: #0b1220; }',
		'.workflow-card h2 { margin-top: 0; font-size: 18px; }',
		'.control-grid { display: grid; gap: 12px; }',
		'',
	].join('\n');
}

function scaffoldFileForPath(path: string, label: string, surfaceName: string): string {
	const componentName = componentNameFromPath(path);
	return [
		`export default function ${componentName}() {`,
		'\treturn (',
		'\t\t<main className="surface-shell">',
		'\t\t\t<section className="surface-card">',
		`\t\t\t\t<p>${escapeHtml(surfaceName)}</p>`,
		`\t\t\t\t<h1>${escapeHtml(label)}</h1>`,
		`\t\t\t\t<p>Starter implementation for the ${escapeHtml(label.toLowerCase())} subsystem.</p>`,
		'\t\t\t</section>',
		'\t\t</main>',
		'\t);',
		'}',
		'',
	].join('\n');
}

async function writeWorkspaceFile(fileService: IFileService, workspaceFolder: URI, relativePath: string, content: string): Promise<void> {
	const parts = relativePath.split('/').filter(Boolean);
	for (let i = 1; i < parts.length; i++) {
		await fileService.createFolder(joinPath(workspaceFolder, ...parts.slice(0, i)));
	}
	await fileService.writeFile(joinPath(workspaceFolder, ...parts), VSBuffer.fromString(content));
}

function nextLocalUrl(surfaces: readonly Record<string, unknown>[]): string {
	const usedPorts = new Set<number>();
	for (const surface of surfaces) {
		const localUrl = typeof surface.localUrl === 'string' ? surface.localUrl : '';
		const match = /localhost:(\d+)/.exec(localUrl);
		if (match) {
			usedPorts.add(Number(match[1]));
		}
	}
	let port = DEFAULT_PORT_BASE;
	while (usedPorts.has(port)) {
		port++;
	}
	return `http://localhost:${port}`;
}

function withPreferredPort(command: string, localUrl: string): string {
	const portMatch = /localhost:(\d+)/i.exec(localUrl);
	const port = portMatch ? Number(portMatch[1]) : undefined;
	if (!port || !Number.isFinite(port)) {
		return command;
	}
	if (/\bPORT=\d{2,5}\b/.test(command) || /(?:^|\s)--port(?:=|\s+)\d{2,5}\b/.test(command) || /(?:^|\s)-p\s+\d{2,5}\b/.test(command)) {
		return command;
	}
	if (/\bnext\s+dev\b/i.test(command)) {
		return `${command} --port ${port}`;
	}
	if (/\b(?:npm|pnpm)\b.*\brun\s+dev\b/i.test(command) || /\byarn\b.*\bdev\b/i.test(command)) {
		return `${command} -- --port ${port}`;
	}
	return command;
}

function normalizeSurfaceDevCommand(command: string, appPath: string): string {
	const normalizedPath = appPath.replace(/^\.?\//, '').trim();
	const canonical = `npm run dev --prefix ${normalizedPath}`;
	if (!command.trim()) {
		return canonical;
	}

	const trimmed = command.trim();

	// Legacy command shapes we can confidently normalize to the surface-local contract.
	if (/\bpnpm\b.*--filter\b/i.test(trimmed) || /\byarn\b\s+workspace\b/i.test(trimmed)) {
		return canonical;
	}
	if (/\bnpm\b.*--workspace\b/i.test(trimmed)) {
		return canonical;
	}
	if (/\bnpm\s+--prefix\s+\S+\s+run\s+dev\b/i.test(trimmed)) {
		return canonical;
	}
	if (/\bnpm\s+run\s+dev\b/i.test(trimmed) && /\b--prefix\s+\S+\b/i.test(trimmed)) {
		return canonical;
	}

	// Keep unknown custom commands untouched so we do not break bespoke setups.
	return trimmed;
}

function routePathFromSubsystem(path: string): string {
	const appIndex = path.indexOf('/app/');
	if (appIndex < 0) {
		return '';
	}
	return path.slice(appIndex + '/app/'.length).replace(/\/page\.tsx$/, '').replace(/\/$/, '');
}

function componentNameFromPath(path: string): string {
	const leaf = path.split('/').filter(Boolean).pop()?.replace(/\.[^.]+$/, '') ?? 'Surface';
	const base = leaf === 'page' || leaf === 'layout' ? path.split('/').filter(Boolean).slice(-2, -1)[0] ?? leaf : leaf;
	const name = base.replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join('');
	return `${name || 'Surface'}Subsystem`;
}

function componentNameFromRoute(route: string, surfaceId: string): string {
	const base = route === '/' ? surfaceId : route.replace(/^\//, '');
	const name = base.replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join('');
	return `${name || 'Surface'}Page`;
}

function identifierFor(value: string): string {
	const identifier = value.replace(/[^a-zA-Z0-9_$]+(.)?/g, (_, next: string | undefined) => next ? next.toUpperCase() : '');
	return /^[a-zA-Z_$]/.test(identifier) ? identifier : `surface${identifier}`;
}

function dedupeFiles(files: readonly [string, string][]): readonly [string, string][] {
	const seen = new Set<string>();
	const result: [string, string][] = [];
	for (const file of files) {
		if (seen.has(file[0])) {
			continue;
		}
		seen.add(file[0]);
		result.push(file);
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()) : [];
}

function uniqueStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		const key = trimmed.toLowerCase();
		if (!trimmed || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

function escapeTsString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

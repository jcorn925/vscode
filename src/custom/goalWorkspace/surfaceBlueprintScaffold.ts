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
	const files = buildSurfaceFiles(blueprint, appPath, manifest.localUrl);
	const createdFiles: string[] = [];

	for (const [relativePath, content] of files) {
		await writeWorkspaceFile(fileService, workspaceFolder, relativePath, content);
		createdFiles.push(relativePath);
	}

	return {
		surfaceId: blueprint.surfaceId,
		appPath,
		localUrl: manifest.localUrl,
		createdFiles,
	};
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
	const surface: ManifestSurfaceRecord = {
		id: blueprint.surfaceId,
		name: blueprint.surfaceName,
		type: typeof existing.type === 'string' && existing.type.trim() ? existing.type.trim() : 'web-app',
		path: typeof existing.path === 'string' && existing.path.trim() ? existing.path.trim() : appPath,
		localUrl,
		devCommand: typeof existing.devCommand === 'string' && existing.devCommand.trim()
			? existing.devCommand.trim()
			: `npm run dev --workspace ${appPath}`,
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

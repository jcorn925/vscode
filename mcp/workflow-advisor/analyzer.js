/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.vue', '.svelte']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', '.turbo', '.venv', 'vendor', 'target']);
const WALK_CAP = 20000;

const FRAMEWORK_DEPS = {
	next: 'Next.js',
	react: 'React',
	vue: 'Vue',
	svelte: 'Svelte',
	astro: 'Astro',
	'@remix-run/react': 'Remix',
	vite: 'Vite',
	express: 'Express',
	fastify: 'Fastify',
	'@nestjs/core': 'NestJS',
	electron: 'Electron',
};

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return undefined;
	}
}

function exists(filePath) {
	try {
		fs.accessSync(filePath);
		return true;
	} catch {
		return false;
	}
}

function listDirs(dirPath) {
	try {
		return fs.readdirSync(dirPath, { withFileTypes: true })
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
			.map(entry => entry.name);
	} catch {
		return [];
	}
}

/** Expand simple workspace globs (`apps/*`, `packages/foo`) one level deep. */
function expandWorkspacePatterns(root, patterns) {
	const dirs = [];
	for (const pattern of patterns) {
		if (typeof pattern !== 'string' || pattern.startsWith('!')) {
			continue;
		}
		const clean = pattern.replace(/\/\*\*?$/, '');
		if (pattern.endsWith('*')) {
			const base = pattern.replace(/\/?\*\*?$/, '');
			for (const name of listDirs(path.join(root, base))) {
				dirs.push(path.join(base, name));
			}
		} else if (exists(path.join(root, clean, 'package.json'))) {
			dirs.push(clean);
		}
	}
	return [...new Set(dirs)].sort();
}

function detectFrameworks(pkg) {
	const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
	return Object.entries(FRAMEWORK_DEPS)
		.filter(([dep]) => dep in deps)
		.map(([, label]) => label);
}

function describePackage(root, dir) {
	const pkg = readJson(path.join(root, dir, 'package.json'));
	if (!pkg) {
		return undefined;
	}
	const scripts = pkg.scripts ?? {};
	const devScript = scripts.dev ?? scripts.start ?? scripts.serve;
	return {
		dir: dir === '.' ? '(root)' : dir,
		name: pkg.name ?? path.basename(dir),
		frameworks: detectFrameworks(pkg),
		devScript: devScript ? String(devScript) : undefined,
		hasTestScript: typeof scripts.test === 'string' && !/no test specified/.test(scripts.test),
	};
}

function countSourceFiles(root) {
	let sourceFiles = 0;
	let visited = 0;
	const stack = [root];
	while (stack.length && visited < WALK_CAP) {
		const current = stack.pop();
		let entries;
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (visited >= WALK_CAP) {
				break;
			}
			visited++;
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
					stack.push(path.join(current, entry.name));
				}
			} else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
				sourceFiles++;
			}
		}
	}
	return { sourceFiles, capped: visited >= WALK_CAP };
}

function classify(facts) {
	if (facts.goalWorkspace.manifest) {
		return 'goal-workspace';
	}
	if (!facts.packages.length && facts.scale.sourceFiles < 20) {
		return 'empty-or-early';
	}
	const appPackages = facts.packages.filter(pkg => pkg.devScript || pkg.frameworks.length);
	if (facts.workspaceLayout !== 'single-package' && appPackages.length > 1) {
		return 'multi-app-monorepo';
	}
	if (appPackages.length >= 1) {
		return 'single-app';
	}
	return 'library-or-tool';
}

/**
 * Extracts deterministic, repo-specific facts used to ground a Babadaba
 * workflow assessment. Read-only; never executes repo code.
 */
export function analyzeRepo(repoPath) {
	const root = path.resolve(repoPath);
	if (!exists(root)) {
		return { root, exists: false };
	}

	const rootPkg = readJson(path.join(root, 'package.json'));
	const pnpmWorkspace = exists(path.join(root, 'pnpm-workspace.yaml'))
		? fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
		: undefined;

	let workspaceLayout = 'no-package-json';
	let packageDirs = [];
	if (Array.isArray(rootPkg?.workspaces) || Array.isArray(rootPkg?.workspaces?.packages)) {
		workspaceLayout = 'npm-workspaces';
		packageDirs = expandWorkspacePatterns(root, rootPkg.workspaces.packages ?? rootPkg.workspaces);
	} else if (pnpmWorkspace) {
		workspaceLayout = 'pnpm-workspaces';
		const patterns = [...pnpmWorkspace.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map(match => match[1]);
		packageDirs = expandWorkspacePatterns(root, patterns);
	} else if (rootPkg) {
		workspaceLayout = 'single-package';
		packageDirs = ['.'];
	}

	const packages = packageDirs
		.map(dir => describePackage(root, dir))
		.filter(Boolean);

	const manifest = readJson(path.join(root, 'workspace.goal.json'));
	const workflowsDir = path.join(root, '.github', 'workflows');
	const readmePath = ['README.md', 'readme.md', 'README'].map(name => path.join(root, name)).find(exists);

	const facts = {
		root,
		exists: true,
		git: exists(path.join(root, '.git')),
		workspaceLayout,
		packages,
		goalWorkspace: {
			manifest: Boolean(manifest),
			surfaces: Array.isArray(manifest?.surfaces)
				? manifest.surfaces.map(surface => surface?.id).filter(Boolean)
				: [],
			agentDir: exists(path.join(root, '.agent')),
		},
		deploy: {
			vercel: exists(path.join(root, 'vercel.json')) || exists(path.join(root, '.vercel')),
			netlify: exists(path.join(root, 'netlify.toml')),
			dockerfile: exists(path.join(root, 'Dockerfile')),
			githubActions: listDirsAndFiles(workflowsDir).length,
		},
		data: {
			prisma: exists(path.join(root, 'prisma')) || packages.some(pkg => exists(path.join(root, pkg.dir === '(root)' ? '.' : pkg.dir, 'prisma'))),
			migrations: exists(path.join(root, 'migrations')) || exists(path.join(root, 'db', 'migrations')),
		},
		docs: {
			readme: Boolean(readmePath),
			readmeBytes: readmePath ? safeSize(readmePath) : 0,
			docsDir: exists(path.join(root, 'docs')),
		},
		scale: countSourceFiles(root),
	};
	facts.classification = classify(facts);
	return facts;
}

function listDirsAndFiles(dirPath) {
	try {
		return fs.readdirSync(dirPath);
	} catch {
		return [];
	}
}

function safeSize(filePath) {
	try {
		return fs.statSync(filePath).size;
	} catch {
		return 0;
	}
}

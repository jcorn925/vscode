/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { analyzeRepo } from '../analyzer.js';
import { buildCapabilityMap, buildCaveats } from '../guidance.js';

function makeRepo(structure) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-test-'));
	for (const [relative, content] of Object.entries(structure)) {
		const target = path.join(root, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
	}
	return root;
}

test('classifies a multi-app npm-workspaces monorepo and maps capabilities', () => {
	const root = makeRepo({
		'package.json': { name: 'shop', workspaces: ['apps/*'] },
		'apps/web/package.json': { name: 'web', scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0' } },
		'apps/admin/package.json': { name: 'admin', scripts: { dev: 'vite' }, devDependencies: { vite: '6.0.0' } },
		'apps/web/src/index.tsx': 'export {};',
	});
	const facts = analyzeRepo(root);
	const map = buildCapabilityMap(facts);
	assert.deepStrictEqual(
		{
			classification: facts.classification,
			layout: facts.workspaceLayout,
			packages: facts.packages.map(pkg => [pkg.dir, pkg.frameworks, Boolean(pkg.devScript)]),
			highRelevance: map.filter(entry => entry.relevance === 'high').length >= 3,
			mentionsApps: map.some(entry => entry.because.includes('apps/web')),
			publishHigh: map.some(entry => entry.relevance === 'high' && entry.because.includes('No deployment config')),
		},
		{
			classification: 'multi-app-monorepo',
			layout: 'npm-workspaces',
			packages: [['apps/admin', ['Vite'], true], ['apps/web', ['Next.js'], true]],
			highRelevance: true,
			mentionsApps: true,
			publishHigh: true,
		},
	);
});

test('classifies greenfield, single app, goal workspace, and library repos', () => {
	const greenfield = analyzeRepo(makeRepo({ 'README.md': '# soon' }));
	const singleApp = analyzeRepo(makeRepo({
		'package.json': { name: 'app', scripts: { dev: 'vite' }, devDependencies: { vite: '6.0.0' } },
		'vercel.json': '{}',
	}));
	const goalWorkspace = analyzeRepo(makeRepo({
		'package.json': { name: 'gw' },
		'workspace.goal.json': { goal: { id: 'g' }, surfaces: [{ id: 'marketing' }, { id: 'booking' }] },
	}));
	const library = analyzeRepo(makeRepo({
		'package.json': { name: 'lib', scripts: { test: 'node --test' } },
		'index.js': 'export {};',
	}));
	assert.deepStrictEqual(
		{
			greenfield: greenfield.classification,
			singleApp: singleApp.classification,
			singleAppVercel: singleApp.deploy.vercel,
			goalWorkspace: goalWorkspace.classification,
			goalSurfaces: goalWorkspace.goalWorkspace.surfaces,
			goalCaveat: buildCaveats(goalWorkspace).some(caveat => caveat.includes('already uses Babadaba')),
			library: library.classification,
		},
		{
			greenfield: 'empty-or-early',
			singleApp: 'single-app',
			singleAppVercel: true,
			goalWorkspace: 'goal-workspace',
			goalSurfaces: ['marketing', 'booking'],
			goalCaveat: true,
			library: 'library-or-tool',
		},
	);
});

test('missing path is reported without throwing', () => {
	const facts = analyzeRepo('/nonexistent/path/for/advisor');
	assert.strictEqual(facts.exists, false);
});

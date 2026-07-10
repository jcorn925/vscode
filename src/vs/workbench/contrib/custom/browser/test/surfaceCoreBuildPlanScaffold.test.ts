/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { resolveTaskLeafExpectedPaths } from '../../../../../../custom/agentTaskTree/agentTaskTreeIxValidation.js';
import { parseTaskTree } from '../../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import {
	buildSurfaceCoreBuildPlanScaffold,
	parseSurfaceCoreBuildPlanScaffold,
	resolveSurfaceCoreBuildPlanSource,
	scaffoldToAgentTaskTree,
} from '../../../../../../custom/agentTaskTree/surfaceCoreBuildPlanScaffold.js';
import type { AgentTaskNode } from '../../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';

suite('surfaceCoreBuildPlanScaffold', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('builds ads-manager plan with fixed roots and subsystem leaves', () => {
		const source = resolveSurfaceCoreBuildPlanSource({
			surfaceId: 'ads-manager',
			surfaceName: 'Ads Manager',
			templateId: 'ads-manager',
		});
		assert.ok(source);
		const scaffold = buildSurfaceCoreBuildPlanScaffold(source!, 'Core implementation build plan for Ads Manager');

		assert.strictEqual(scaffold.version, 1);
		assert.deepStrictEqual(scaffold.roots.map(root => root.title), [
			'Surface Scaffold',
			'Routes and UI',
			'APIs and Shared',
			'Acceptance and Verification',
		]);

		const routeRoot = scaffold.roots.find(root => root.title === 'Routes and UI');
		assert.ok(routeRoot);
		assert.strictEqual(routeRoot!.children.length, 4);
		for (const leaf of routeRoot!.children) {
			assert.ok(leaf.expectedPaths.length > 0);
			assert.ok(leaf.subsystemId);
			assert.ok(leaf.expectedPaths.some(path => path.startsWith('apps/ads-manager/')));
		}
	});

	test('parseSurfaceCoreBuildPlanScaffold rejects bad version and missing paths', () => {
		assert.strictEqual(parseSurfaceCoreBuildPlanScaffold({ version: 2, roots: [] }), undefined);
		assert.strictEqual(parseSurfaceCoreBuildPlanScaffold({
			version: 1,
			surfaceId: 'ads-manager',
			surfaceName: 'Ads Manager',
			templateId: 'ads-manager',
			prompt: 'Build ads',
			roots: [{
				id: 'root-1',
				title: 'Surface Scaffold',
				children: [{
					id: 'leaf-1',
					title: 'Scaffold',
					description: 'Create shell',
					expectedPaths: [],
				}],
			}],
		}), undefined);
	});

	test('scaffoldToAgentTaskTree round-trips expectedPaths through parseTaskTree', () => {
		const source = resolveSurfaceCoreBuildPlanSource({
			surfaceId: 'ads-manager',
			surfaceName: 'Ads Manager',
			templateId: 'ads-manager',
		});
		const scaffold = buildSurfaceCoreBuildPlanScaffold(source!, 'Core implementation build plan for Ads Manager');
		const tree = scaffoldToAgentTaskTree(scaffold, {
			id: 'test-ads-tree',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		const parsed = parseTaskTree(JSON.parse(JSON.stringify(tree)));
		assert.ok(parsed);
		const leaf = parsed!.roots
			.flatMap(root => root.children ?? [])
			.find(node => node.subsystemId === 'campaign-setup');
		assert.ok(leaf);
		assert.ok((leaf!.expectedPaths?.length ?? 0) > 0);
		assert.deepStrictEqual(leaf!.expectedPaths, ['apps/ads-manager/app/campaigns']);
		assert.ok((leaf!.acceptanceChecks?.length ?? 0) > 0);
	});

	test('resolveTaskLeafExpectedPaths prefers explicit expectedPaths over description scrape', () => {
		const node: AgentTaskNode = {
			id: 'leaf-1',
			title: 'Implement Campaign Setup UI',
			description: 'Also mentions apps/ads-manager/app/spend in prose but should be ignored.',
			type: 'leaf',
			status: 'pending',
			order: 1,
			expectedPaths: ['apps/ads-manager/app/campaigns', 'workspace.goal.json'],
		};
		assert.deepStrictEqual(
			resolveTaskLeafExpectedPaths(node, 'apps/ads-manager'),
			['apps/ads-manager/app/campaigns'],
		);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { resolveDefaultSurfaceMainView, shouldShowSurfaceMainViewToggle, type SurfaceMainView } from '../../../../../../custom/agentTaskTree/surfaceMainViewHelpers.js';
import type { AgentTaskTree } from '../../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';

suite('surfaceMainViewHelpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shouldShowSurfaceMainViewToggle hides builder and shows real surfaces', () => {
		assert.strictEqual(shouldShowSurfaceMainViewToggle({
			selectedSurfaceId: '__add_surface__',
			addSurfaceId: '__add_surface__',
			contextGatheringOpen: true,
		}), false);
		assert.strictEqual(shouldShowSurfaceMainViewToggle({
			selectedSurfaceId: 'marketing',
			addSurfaceId: '__add_surface__',
			contextGatheringOpen: false,
		}), true);
	});

	test('resolveDefaultSurfaceMainView prefers task tree for active work', () => {
		const activeTree = createTree('active');
		assert.strictEqual(resolveDefaultSurfaceMainView(activeTree, true), 'taskTree');
		assert.strictEqual(resolveDefaultSurfaceMainView(activeTree, false), 'taskTree');
	});

	test('resolveDefaultSurfaceMainView opens preview when complete and reachable', () => {
		const completeTree = createTree('complete');
		assert.strictEqual(resolveDefaultSurfaceMainView(completeTree, true), 'preview');
		assert.strictEqual(resolveDefaultSurfaceMainView(completeTree, false), 'taskTree');
	});

	test('SurfaceMainView accepts the Ix subsystems tab without making it a default', () => {
		const ixView: SurfaceMainView = 'ixSubsystems';
		assert.strictEqual(ixView, 'ixSubsystems');
		assert.notStrictEqual(resolveDefaultSurfaceMainView(createTree('active'), true), ixView);
	});
});

function createTree(status: AgentTaskTree['status']): AgentTaskTree {
	return {
		version: 1,
		id: 'tree-1',
		prompt: 'Build feature',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		status,
		roots: [{
			id: 'root-1',
			title: 'Root',
			type: 'root',
			status: 'pending',
			order: 1,
			children: [
				{ id: 'leaf-1', parentId: 'root-1', title: 'First', type: 'leaf', status: 'pending', order: 1 },
			],
		}],
	};
}

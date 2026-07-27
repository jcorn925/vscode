/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	babadabaHubHasAttention,
	buildBabadabaHubGraph,
	type BabadabaHubGraphInput,
	type BabadabaHubSurfaceInput,
} from '../babadabaHubGraph.js';

suite('babadabaHubGraph', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const marketing: BabadabaHubSurfaceInput = {
		id: 'marketing',
		name: 'Marketing Site',
		ixSubsystems: [],
	};
	const booking: BabadabaHubSurfaceInput = {
		id: 'booking',
		name: 'Booking',
		productionUrl: 'https://booking.example.com',
		ixSubsystems: ['payments'],
		hasIxMeta: true,
	};

	function build(partial: Partial<BabadabaHubGraphInput> = {}) {
		return buildBabadabaHubGraph({
			signals: {},
			surfaces: [],
			surfaceProgressById: new Map(),
			startedSurfaceIds: new Set(),
			workspaceHasGitRepo: false,
			...partial,
		});
	}

	test('empty workspace still emits integration spokes', () => {
		const graph = build({ workspaceHasGitRepo: false });
		assert.strictEqual(graph.surfaceCount, 0);
		assert.strictEqual(graph.completeCount, 0);
		assert.deepStrictEqual(graph.nodes.map(n => n.id), [
			'integration:ix',
			'integration:docker',
			'integration:github',
			'integration:vercel',
		]);
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:ix')?.state, 'idle');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:docker')?.state, 'active');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:github')?.state, 'idle');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:vercel')?.state, 'idle');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:vercel')?.actionId, undefined);
	});

	test('omits GitHub spoke while .git probe is in flight', () => {
		const graph = build({ workspaceHasGitRepo: undefined });
		assert.ok(!graph.nodes.some(n => n.id === 'integration:github'));
	});

	test('surface nodes carry progress and open_surface actions; Ix/Vercel reflect mapping and deploys', () => {
		const progress = new Map([
			['marketing', { inProgress: true, percent: 10, label: 'Phase 1' }],
			['booking', { complete: true, percent: 100, label: 'Complete' }],
		]);
		const graph = build({
			surfaces: [marketing, booking],
			surfaceProgressById: progress,
			startedSurfaceIds: new Set(['booking']),
			workspaceHasGitRepo: true,
			signals: { dockerReady: true },
		});
		assert.strictEqual(graph.surfaceCount, 2);
		assert.strictEqual(graph.completeCount, 1);

		const surfaceNodes = graph.nodes.filter(n => n.id.startsWith('surface:'));
		assert.strictEqual(surfaceNodes.length, 2);
		assert.strictEqual(surfaceNodes[0]!.state, 'building');
		assert.strictEqual(surfaceNodes[0]!.actionId, 'open_surface');
		assert.strictEqual(surfaceNodes[0]!.targetId, 'marketing');
		assert.strictEqual(surfaceNodes[1]!.state, 'active');

		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:ix')?.state, 'active');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:github')?.state, 'active');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:github')?.actionId, 'open_github');
		const vercel = graph.nodes.find(n => n.id === 'integration:vercel');
		assert.strictEqual(vercel?.state, 'active');
		assert.strictEqual(vercel?.actionId, 'open_vercel');
		assert.strictEqual(vercel?.href, 'https://booking.example.com');
	});

	test('docker attention and ix building from signals', () => {
		const graph = build({
			surfaces: [marketing],
			signals: { dockerReady: false, kickoffInFlight: true },
			workspaceHasGitRepo: false,
		});
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:docker')?.state, 'attention');
		assert.strictEqual(graph.nodes.find(n => n.id === 'integration:ix')?.state, 'building');
		assert.ok(babadabaHubHasAttention(graph.nodes));
	});

	test('babadabaHubHasAttention is false for idle/active only', () => {
		const graph = build({
			surfaces: [booking],
			workspaceHasGitRepo: true,
			signals: { dockerReady: true },
		});
		assert.ok(!babadabaHubHasAttention(graph.nodes));
	});
});

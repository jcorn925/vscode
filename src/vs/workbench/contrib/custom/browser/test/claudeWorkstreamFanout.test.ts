/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { planClaudeWorkstreamFanout } from '../proposalGraphDiff/claudeWorkstreamFanout.js';
import { partitionProposalWorkstreams } from '../proposalGraphDiff/partitionProposalWorkstreams.js';
import type { GraphProposalDocument } from '../proposalGraphDiff/proposalGraphDiffTypes.js';
import { buildWorkstreamGeneratePrompt } from '../../../../../../custom/goalWorkspace/cadreSurfaceClaudeTemplate.js';

suite('claudeWorkstreamFanout', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('plans parallel keys when canParallelize', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: [
				'file:apps/bot/a.tsx',
				'file:apps/bot/b.tsx',
				'file:apps/bot/package.json',
				'file:apps/bot/next.config.mjs',
			],
			add_edges: [
				{ from: 'file:apps/bot/a.tsx', to: 'file:apps/bot/b.tsx', type: 'imports' } as never,
				{ from: 'file:apps/bot/package.json', to: 'file:apps/bot/next.config.mjs', type: 'configures' } as never,
			],
		};
		const partition = partitionProposalWorkstreams(proposal);
		const plan = planClaudeWorkstreamFanout('bot', partition);
		assert.strictEqual(plan.canFanout, true);
		assert.strictEqual(plan.serialize, undefined);
		assert.strictEqual(plan.parallel.length, 2);
		assert.ok(plan.allKeys.every(key => key.startsWith('bot::')));
		assert.ok(plan.parallel[0]!.forbiddenNodes.length >= 1);
	});

	test('includes serialize spawn when coupled groups exist alongside parallel streams', () => {
		const proposal: GraphProposalDocument = {
			add_nodes: [
				'file:apps/a/page.tsx',
				'file:packages/domain/types.ts',
				'file:apps/b/page.tsx',
				'file:packages/domain/events.ts',
				'file:apps/c/solo.ts',
				'file:apps/d/solo.ts',
			],
			add_edges: [
				{ src: 'file:apps/a/page.tsx', dst: 'file:packages/domain/types.ts', predicate: 'IMPORTS' },
				{ src: 'file:apps/b/page.tsx', dst: 'file:packages/domain/events.ts', predicate: 'IMPORTS' },
			],
			node_prefixes: ['packages/domain'],
		};
		const partition = partitionProposalWorkstreams(proposal);
		// a/b coupled via packages/domain; c and d are singleton parallel streams
		assert.ok(partition.workstreams.length >= 2);
		const plan = planClaudeWorkstreamFanout('multi', partition);
		assert.strictEqual(plan.canFanout, true);
		assert.ok(plan.serialize);
		assert.strictEqual(plan.serialize!.key, 'multi::serialize');
		assert.ok(plan.serialize!.nodes.some(n => n.includes('packages/domain') || n.includes('apps/a')));
	});

	test('buildWorkstreamGeneratePrompt scopes allowlist and forbids foreign paths', () => {
		const prompt = buildWorkstreamGeneratePrompt({
			surfaceId: 'bot',
			surfaceName: 'Bot',
			stepId: 'phase-ui',
			stepLabel: 'UI',
			workstreamId: 'ws-1',
			workstreamLabel: 'components',
			mode: 'parallel',
			nodes: ['apps/bot/components/chat.tsx'],
			forbiddenNodes: ['apps/bot/lib/ai/client.ts'],
			claudeKey: 'bot::ws-1',
		});
		assert.ok(prompt.includes('apps/bot/components/chat.tsx'));
		assert.ok(prompt.includes('apps/bot/lib/ai/client.ts'));
		assert.ok(prompt.includes('workstream-runs.json'));
		assert.ok(prompt.includes('bot::ws-1'));
		assert.ok(prompt.includes('Do NOT write phase-progress'));
	});
});

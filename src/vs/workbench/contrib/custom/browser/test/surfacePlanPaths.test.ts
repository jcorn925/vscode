/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileService } from '../../../../../platform/files/common/files.js';
import {
	graphCompareDir,
	isProposalCompareNamedSnapshotForSurface,
	latestProposalCompareSnapshotResource,
	pickNewestProposalCompareNamedSnapshot,
	proposalCompareSnapshotBelongsToSurface,
	resolveProposalCompareSnapshotResource,
	sanitizeGraphCompareId,
	surfaceGraphProposalDraftResource,
	surfaceGraphProposalResource,
	surfacePlanCandidateResources,
	surfacePlanResource,
} from '../../../../../../custom/goalWorkspace/surfacePlanPaths.js';

suite('surfacePlanPaths', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('prefers .agent/surfaces/<id>.plan.md then app path then root plan.md', () => {
		const root = URI.file('/tmp/ws');
		const candidates = surfacePlanCandidateResources(root, 'cadre', 'apps/cadre');
		assert.strictEqual(candidates[0]!.path, surfacePlanResource(root, 'cadre').path);
		assert.ok(candidates.some(uri => uri.path.endsWith('/apps/cadre/plan.md')));
		assert.ok(candidates.some(uri => uri.path.endsWith('/plan.md') && !uri.path.includes('/apps/')));
	});

	test('proposal paths use task-trees/<id>.graph-proposal(.draft).json', () => {
		const root = URI.file('/tmp/ws');
		assert.ok(surfaceGraphProposalResource(root, 'cadre-bot').path.endsWith('/.agent/task-trees/cadre-bot.graph-proposal.json'));
		assert.ok(surfaceGraphProposalDraftResource(root, 'cadre-bot').path.endsWith('/.agent/task-trees/cadre-bot.graph-proposal.draft.json'));
	});

	test('sanitizeGraphCompareId mirrors Python snapshot naming', () => {
		assert.strictEqual(sanitizeGraphCompareId('cadre-admin-console'), 'cadre-admin-console');
		assert.strictEqual(sanitizeGraphCompareId('cadre admin/console'), 'cadre-admin-console');
	});

	test('isProposalCompareNamedSnapshotForSurface matches proposal_<id>_vs_*.json', () => {
		assert.strictEqual(
			isProposalCompareNamedSnapshotForSurface('proposal_cadre-admin-console_vs_b8e99541.json', 'cadre-admin-console'),
			true,
		);
		assert.strictEqual(
			isProposalCompareNamedSnapshotForSurface('proposal_cadre-eval-harness_vs_b8e99541.json', 'cadre-admin-console'),
			false,
		);
		assert.strictEqual(
			isProposalCompareNamedSnapshotForSurface('latest-proposal.json', 'cadre-admin-console'),
			false,
		);
		assert.strictEqual(
			isProposalCompareNamedSnapshotForSurface('proposal_tree-a_vs_xyz.json', 'surface-b', 'tree-a'),
			true,
		);
	});

	test('pickNewestProposalCompareNamedSnapshot picks highest mtime for the surface', () => {
		const root = URI.file('/tmp/ws');
		const dir = graphCompareDir(root);
		const older = joinPath(dir, 'proposal_cadre-admin-console_vs_old.json');
		const newer = joinPath(dir, 'proposal_cadre-admin-console_vs_new.json');
		const other = joinPath(dir, 'proposal_cadre-eval-harness_vs_x.json');
		const picked = pickNewestProposalCompareNamedSnapshot([
			{ name: 'proposal_cadre-admin-console_vs_old.json', resource: older, mtime: 100 },
			{ name: 'proposal_cadre-eval-harness_vs_x.json', resource: other, mtime: 999 },
			{ name: 'proposal_cadre-admin-console_vs_new.json', resource: newer, mtime: 200 },
			{ name: 'latest-proposal.json', resource: latestProposalCompareSnapshotResource(root), mtime: 300 },
		], 'cadre-admin-console');
		assert.strictEqual(picked?.toString(), newer.toString());
	});

	test('proposalCompareSnapshotBelongsToSurface matches tree_id and proposal path', () => {
		assert.strictEqual(proposalCompareSnapshotBelongsToSurface({
			proposal: { tree_id: 'cadre-admin-console' },
		}, { surfaceId: 'cadre-admin-console' }), true);
		assert.strictEqual(proposalCompareSnapshotBelongsToSurface({
			proposal: { tree_id: 'cadre-eval-harness' },
		}, { surfaceId: 'cadre-admin-console' }), false);
		assert.strictEqual(proposalCompareSnapshotBelongsToSurface({
			proposal: { path: '/tmp/ws/.agent/task-trees/cadre-admin-console.graph-proposal.json' },
		}, { surfaceId: 'cadre-admin-console' }), true);
		assert.strictEqual(proposalCompareSnapshotBelongsToSurface({
			proposal: { path: '/tmp/ws/.agent/task-trees/cadre-eval-harness.graph-proposal.json' },
		}, {
			surfaceId: 'cadre-admin-console',
			proposalPath: '/tmp/ws/.agent/task-trees/cadre-admin-console.graph-proposal.json',
		}), false);
		assert.strictEqual(proposalCompareSnapshotBelongsToSurface({}, { surfaceId: 'cadre-admin-console' }), false);
	});

	test('resolveProposalCompareSnapshotResource prefers named surface snapshot over foreign latest', async () => {
		const root = URI.file('/tmp/ws');
		const dir = graphCompareDir(root);
		const named = joinPath(dir, 'proposal_cadre-admin-console_vs_b8e99541.json');
		const latest = latestProposalCompareSnapshotResource(root);
		const files = new Map<string, string>([
			[latest.toString(), JSON.stringify({
				proposal: { tree_id: 'cadre-eval-harness', path: '/tmp/ws/.agent/task-trees/cadre-eval-harness.graph-proposal.json' },
			})],
			[named.toString(), JSON.stringify({
				proposal: { tree_id: 'cadre-admin-console' },
			})],
		]);
		const fileService = {
			exists: async (resource: URI) => files.has(resource.toString()),
			readFile: async (resource: URI) => {
				const value = files.get(resource.toString());
				if (value === undefined) {
					throw new Error('missing');
				}
				return { value: VSBuffer.fromString(value) };
			},
			resolve: async (resource: URI) => {
				if (resource.toString() !== dir.toString()) {
					throw new Error('missing');
				}
				return {
					resource: dir,
					name: 'graph-compare',
					isDirectory: true,
					children: [
						{ resource: named, name: 'proposal_cadre-admin-console_vs_b8e99541.json', mtime: 100, isDirectory: false },
						{ resource: latest, name: 'latest-proposal.json', mtime: 999, isDirectory: false },
					],
				};
			},
		} as unknown as IFileService;

		const resolved = await resolveProposalCompareSnapshotResource(fileService, root, {
			surfaceId: 'cadre-admin-console',
		});
		assert.strictEqual(resolved?.toString(), named.toString());
	});

	test('resolveProposalCompareSnapshotResource uses owned latest when no named file exists', async () => {
		const root = URI.file('/tmp/ws');
		const dir = graphCompareDir(root);
		const latest = latestProposalCompareSnapshotResource(root);
		const proposal = surfaceGraphProposalResource(root, 'cadre-admin-console');
		const files = new Map<string, string>([
			[latest.toString(), JSON.stringify({
				proposal: {
					tree_id: 'cadre-admin-console',
					path: proposal.path,
				},
			})],
		]);
		const fileService = {
			exists: async (resource: URI) => files.has(resource.toString()),
			readFile: async (resource: URI) => {
				const value = files.get(resource.toString());
				if (value === undefined) {
					throw new Error('missing');
				}
				return { value: VSBuffer.fromString(value) };
			},
			resolve: async (resource: URI) => {
				if (resource.toString() !== dir.toString()) {
					throw new Error('missing');
				}
				return {
					resource: dir,
					name: 'graph-compare',
					isDirectory: true,
					children: [
						{ resource: latest, name: 'latest-proposal.json', mtime: 100, isDirectory: false },
					],
				};
			},
		} as unknown as IFileService;

		const resolved = await resolveProposalCompareSnapshotResource(fileService, root, {
			surfaceId: 'cadre-admin-console',
			proposalResource: proposal,
		});
		assert.strictEqual(resolved?.toString(), latest.toString());
	});

	test('resolveProposalCompareSnapshotResource rejects foreign latest-only compare', async () => {
		const root = URI.file('/tmp/ws');
		const dir = graphCompareDir(root);
		const latest = latestProposalCompareSnapshotResource(root);
		const files = new Map<string, string>([
			[latest.toString(), JSON.stringify({
				proposal: { tree_id: 'cadre-eval-harness' },
			})],
		]);
		const fileService = {
			exists: async (resource: URI) => files.has(resource.toString()),
			readFile: async (resource: URI) => {
				const value = files.get(resource.toString());
				if (value === undefined) {
					throw new Error('missing');
				}
				return { value: VSBuffer.fromString(value) };
			},
			resolve: async (resource: URI) => {
				if (resource.toString() !== dir.toString()) {
					throw new Error('missing');
				}
				return {
					resource: dir,
					name: 'graph-compare',
					isDirectory: true,
					children: [
						{ resource: latest, name: 'latest-proposal.json', mtime: 100, isDirectory: false },
					],
				};
			},
		} as unknown as IFileService;

		const resolved = await resolveProposalCompareSnapshotResource(fileService, root, {
			surfaceId: 'cadre-admin-console',
		});
		assert.strictEqual(resolved, undefined);
	});
});

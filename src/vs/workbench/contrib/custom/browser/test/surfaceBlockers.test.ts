/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	blockerStepId,
	envKeyBlockerId,
	isEnvValueConfigured,
	mergeEnvKeyProbes,
	openBlockerStepRefs,
	parseEnvExampleKeys,
	parseEnvFileMap,
	parseSurfaceBlockersDocument,
	resolveBlockerInDocument,
	serializeSurfaceBlockersDocument,
} from '../../../../../../custom/goalWorkspace/surfaceBlockers.js';

suite('surfaceBlockers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parseEnvExampleKeys skips comments and blanks', () => {
		const keys = parseEnvExampleKeys([
			'# Server-side only',
			'ANTHROPIC_API_KEY=sk-ant-...',
			'',
			'# CHAT_MODEL=claude-opus-4-8',
			'STRIPE_SECRET=your-secret-here',
		].join('\n'));
		assert.deepStrictEqual(keys, ['ANTHROPIC_API_KEY', 'STRIPE_SECRET']);
	});

	test('isEnvValueConfigured rejects placeholders', () => {
		assert.strictEqual(isEnvValueConfigured(undefined), false);
		assert.strictEqual(isEnvValueConfigured(''), false);
		assert.strictEqual(isEnvValueConfigured('sk-ant-...'), false);
		assert.strictEqual(isEnvValueConfigured('your-key-here'), false);
		assert.strictEqual(isEnvValueConfigured('changeme'), false);
		assert.strictEqual(isEnvValueConfigured('sk-ant-abc123real'), true);
	});

	test('parseEnvFileMap reads quoted values', () => {
		const map = parseEnvFileMap('FOO=bar\nBAZ="qux"\n# skip\n');
		assert.strictEqual(map.get('FOO'), 'bar');
		assert.strictEqual(map.get('BAZ'), 'qux');
	});

	test('mergeEnvKeyProbes opens missing keys and resolves configured ones', () => {
		const merged = mergeEnvKeyProbes({
			surfaceId: 'cadre-support-bot',
			surfacePath: 'apps/cadre-support-bot',
			exampleRaw: 'ANTHROPIC_API_KEY=sk-ant-...\nOTHER_KEY=\n',
			envLocalRaw: 'ANTHROPIC_API_KEY=sk-ant-real-key\n',
			envRaw: undefined,
		});
		const byId = new Map(merged.blockers.map(blocker => [blocker.id, blocker]));
		assert.strictEqual(byId.get(envKeyBlockerId('ANTHROPIC_API_KEY'))?.status, 'resolved');
		assert.strictEqual(byId.get(envKeyBlockerId('OTHER_KEY'))?.status, 'open');
		assert.deepStrictEqual(openBlockerStepRefs(merged), [{
			id: blockerStepId(envKeyBlockerId('OTHER_KEY')),
			label: 'Set OTHER_KEY in .env.local',
		}]);
	});

	test('mergeEnvKeyProbes preserves dismissed blockers', () => {
		const existing = parseSurfaceBlockersDocument(JSON.stringify({
			surfaceId: 'bot',
			updatedAt: '2026-01-01T00:00:00.000Z',
			blockers: [{
				id: 'env:SKIP_ME',
				label: 'Set SKIP_ME in .env.local',
				kind: 'env',
				status: 'dismissed',
				source: 'console',
			}],
		}), 'bot')!;
		const merged = mergeEnvKeyProbes({
			surfaceId: 'bot',
			surfacePath: 'apps/bot',
			exampleRaw: 'SKIP_ME=\n',
			envLocalRaw: undefined,
			envRaw: undefined,
			existing,
		});
		assert.strictEqual(merged.blockers.find(blocker => blocker.id === 'env:SKIP_ME')?.status, 'dismissed');
		assert.strictEqual(openBlockerStepRefs(merged).length, 0);
	});

	test('resolveBlockerInDocument marks blocker resolved', () => {
		const doc = parseSurfaceBlockersDocument(JSON.stringify({
			surfaceId: 'bot',
			blockers: [{
				id: 'env:ANTHROPIC_API_KEY',
				label: 'Set ANTHROPIC_API_KEY in .env.local',
				kind: 'env',
				status: 'open',
				source: 'console',
			}],
		}), 'bot')!;
		const resolved = resolveBlockerInDocument(doc, 'blocker:env:ANTHROPIC_API_KEY');
		assert.strictEqual(resolved.blockers[0]!.status, 'resolved');
		const roundTrip = parseSurfaceBlockersDocument(serializeSurfaceBlockersDocument(resolved), 'bot')!;
		assert.strictEqual(roundTrip.blockers[0]!.status, 'resolved');
	});

	test('preserves agent manual blockers across env probe', () => {
		const existing = parseSurfaceBlockersDocument(JSON.stringify({
			surfaceId: 'bot',
			blockers: [{
				id: 'manual:stripe-webhook',
				label: 'Configure Stripe webhook secret',
				kind: 'manual',
				status: 'open',
				source: 'agent',
				detail: 'Needed for checkout callbacks',
			}],
		}), 'bot')!;
		const merged = mergeEnvKeyProbes({
			surfaceId: 'bot',
			surfacePath: 'apps/bot',
			exampleRaw: undefined,
			envLocalRaw: undefined,
			envRaw: undefined,
			existing,
		});
		assert.strictEqual(merged.blockers.length, 1);
		assert.strictEqual(merged.blockers[0]!.id, 'manual:stripe-webhook');
		assert.strictEqual(merged.blockers[0]!.status, 'open');
	});
});

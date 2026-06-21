/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildIxSubsystemsDetailedDiscoveryArgs,
	buildSubsystemDetailGraph,
	formatCouplingSummary,
	formatInboundSummary,
	ixSubsystemsDetailedDiscoveryArgsAfterUnknownOption,
	isIxUnknownOptionError,
	isIxUnknownOptionFailure,
	parseSubsystemFingerprints,
	parseMemberFilePaths,
	parsePathEdges,
	formatSubsystemPathEdge,
	pickEntryPath,
	pickTopExternalDependency,
} from '../processNotesSubsystemSnapshot.js';

suite('processNotesSubsystemSnapshot', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const scheduleRegion = {
		region_id: 'ec884e80-22c4-345e-997e-a003fa61a04d',
		name: 'Schedule',
		level: 1,
		label_kind: 'module',
		file_count: 1,
		health_score: 0.4111917701594437,
		confidence: 0.03730590053147886,
		member_files: [{ id: 'd406e2ab-dc9e-ac78-2a43-7def077b8dfa', path: 'src/app/api/buffer/schedule/route.ts' }],
		calls_out: [],
		calls_out_total: 0,
		calls_in: [],
		calls_in_total: 0,
		imports_out: [
			{
				src: 'd406e2ab-dc9e-ac78-2a43-7def077b8dfa',
				src_path: 'src/app/api/buffer/schedule/route.ts',
				dst: 'd406e2ab-dc9e-ac78-2a43-7def077b8dfa',
				dst_path: 'src/app/api/buffer/schedule/route.ts',
			},
			{
				src: 'd406e2ab-dc9e-ac78-2a43-7def077b8dfa',
				src_path: 'src/app/api/buffer/schedule/route.ts',
				dst: '0c911ac9-24fc-0f94-67a0-ab188e472f8d',
				dst_path: 'src/lib/buffer.ts',
			},
		],
		imports_out_total: 2,
		imports_in: [],
		imports_in_total: 0,
	};

	test('parseSubsystemFingerprints reads scores and regions keys', () => {
		const fromScores = parseSubsystemFingerprints({ scores: [scheduleRegion] });
		assert.strictEqual(fromScores.length, 1);
		assert.strictEqual(fromScores[0]!.name, 'Schedule');
		assert.strictEqual(fromScores[0]!.topDependencyPath, 'src/lib/buffer.ts');
		assert.strictEqual(fromScores[0]!.entryPath, 'src/app/api/buffer/schedule/route.ts');
		assert.deepStrictEqual(fromScores[0]!.memberFiles, ['src/app/api/buffer/schedule/route.ts']);
		assert.strictEqual(fromScores[0]!.importsOut.length, 2);
		assert.strictEqual(formatSubsystemPathEdge(fromScores[0]!.importsOut[1]!), 'src/app/api/buffer/schedule/route.ts → src/lib/buffer.ts');

		const fromRegions = parseSubsystemFingerprints({ regions: [scheduleRegion] });
		assert.strictEqual(fromRegions[0]!.name, 'Schedule');
	});

	test('parseMemberFilePaths and parsePathEdges', () => {
		assert.deepStrictEqual(parseMemberFilePaths(scheduleRegion), ['src/app/api/buffer/schedule/route.ts']);
		const imports = parsePathEdges(scheduleRegion, 'imports_out');
		assert.strictEqual(imports.length, 2);
		assert.strictEqual(imports[1]!.dstPath, 'src/lib/buffer.ts');
		assert.deepStrictEqual(parsePathEdges(scheduleRegion, 'calls_out'), []);
	});

	test('pickEntryPath prefers API route', () => {
		const region = {
			member_files: [
				{ path: 'src/lib/buffer.ts' },
				{ path: 'src/app/api/buffer/schedule/route.ts' },
			],
		};
		assert.strictEqual(pickEntryPath(region), 'src/app/api/buffer/schedule/route.ts');
	});

	test('pickTopExternalDependency skips self edges', () => {
		const layoutRegion = {
			member_files: [{ path: 'src/app/layout.tsx' }],
			imports_out: [
				{ src_path: 'src/app/layout.tsx', dst_path: 'src/app/layout.tsx' },
				{ src_path: 'src/app/layout.tsx', dst_path: 'src/components/Theme.tsx' },
			],
		};
		assert.strictEqual(pickTopExternalDependency(layoutRegion), 'src/components/Theme.tsx');
	});

	test('formatInboundSummary omits zero parts', () => {
		assert.strictEqual(formatInboundSummary(2, 1), '2 callers · 1 importer');
		assert.strictEqual(formatInboundSummary(0, 3), '3 importers');
		assert.strictEqual(formatInboundSummary(0, 0), undefined);
	});

	test('buildSubsystemDetailGraph includes member files and import edges', () => {
		const [fp] = parseSubsystemFingerprints({ scores: [scheduleRegion] });
		assert.ok(fp);
		const graph = buildSubsystemDetailGraph(fp!.memberFiles, fp!.importsOut, fp!.callsOut, fp!.importsIn, fp!.callsIn);
		assert.ok(graph.nodes.some(n => n.label === 'route.ts'));
		assert.ok(graph.edges.some(e => e.type === 'imports'));
	});

	test('formatCouplingSummary', () => {
		assert.strictEqual(formatCouplingSummary(3, 4, 0), '3 files · 4 imports out · 0 calls');
		assert.strictEqual(formatCouplingSummary(1, 0, 2), '1 file · 0 imports out · 2 calls');
	});

	test('buildIxSubsystemsDetailedDiscoveryArgs includes caps when set', () => {
		const args = buildIxSubsystemsDetailedDiscoveryArgs({ edgeCap: 8, memberFileCap: 12, limit: 200 });
		assert.ok(args.includes('--list'));
		assert.ok(args.includes('--detailed'));
		assert.ok(args.includes('--edge-cap'));
		assert.ok(args.includes('8'));
	});

	test('isIxUnknownOptionError and args fallback', () => {
		assert.ok(isIxUnknownOptionError('error: unknown option \'--edge-cap\''));
		assert.ok(isIxUnknownOptionFailure('ix exited with code 1', 'error: unknown option \'--edge-cap\''));
		const failed = buildIxSubsystemsDetailedDiscoveryArgs({ edgeCap: 8 });
		const next = ixSubsystemsDetailedDiscoveryArgsAfterUnknownOption(failed);
		assert.ok(!next.includes('--edge-cap'));
		assert.ok(next.includes('--all-items'));
	});
});

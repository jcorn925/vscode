/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	WORKSPACE_PLAN_ANALYSIS_HISTORY_MAX,
	compareWorkspacePlanAnalysisRuns,
	firstMarkdownHeading,
	formatWorkspacePlanAnalysisArchiveStamp,
	formatWorkspacePlanAnalysisRunLabel,
	parseWorkspacePlanAnalysisArchiveStamp,
	pruneWorkspacePlanAnalysisHistoryNames,
	workspacePlanAnalysisArchiveResource,
	workspacePlanAnalysisHistoryDir,
	type WorkspacePlanAnalysisRun,
} from '../../../../../../custom/goalWorkspace/workspacePlanAnalysisHistory.js';

suite('workspacePlanAnalysisHistory', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('history paths live under .agent/workspace/plan-analysis/', () => {
		const root = URI.file('/tmp/ws');
		assert.ok(workspacePlanAnalysisHistoryDir(root).path.endsWith('/.agent/workspace/plan-analysis'));
		assert.ok(
			workspacePlanAnalysisArchiveResource(root, '20260720-154830').path
				.endsWith('/.agent/workspace/plan-analysis/20260720-154830.md'),
		);
	});

	test('format/parse archive stamp round-trip', () => {
		const date = new Date(Date.UTC(2026, 6, 20, 15, 48, 30));
		const stamp = formatWorkspacePlanAnalysisArchiveStamp(date);
		assert.strictEqual(stamp, '20260720-154830');
		const parsed = parseWorkspacePlanAnalysisArchiveStamp(`${stamp}.md`);
		assert.ok(parsed);
		assert.strictEqual(parsed!.toISOString(), date.toISOString());
		assert.strictEqual(parseWorkspacePlanAnalysisArchiveStamp('not-a-stamp.md'), undefined);
		assert.ok(parseWorkspacePlanAnalysisArchiveStamp('20260720-154830-2.md'));
	});

	test('firstMarkdownHeading picks first ATX h1', () => {
		assert.strictEqual(firstMarkdownHeading('# Cadre coverage\n\nBody'), 'Cadre coverage');
		assert.strictEqual(firstMarkdownHeading('Intro\n## Not h1\n# Real'), 'Real');
		assert.strictEqual(firstMarkdownHeading('no heading'), undefined);
	});

	test('formatWorkspacePlanAnalysisRunLabel', () => {
		assert.strictEqual(
			formatWorkspacePlanAnalysisRunLabel({ isLive: true, heading: 'Scorecard' }),
			'Latest — Scorecard',
		);
		assert.strictEqual(
			formatWorkspacePlanAnalysisRunLabel({ isLive: true }),
			'Latest',
		);
		const label = formatWorkspacePlanAnalysisRunLabel({
			isLive: false,
			stamp: '20260720-154830',
			heading: 'Gaps',
		});
		assert.ok(label.includes('Gaps'));
		assert.ok(!label.startsWith('Latest'));
	});

	test('pruneWorkspacePlanAnalysisHistoryNames keeps newest max', () => {
		const names: string[] = [];
		for (let i = 1; i <= WORKSPACE_PLAN_ANALYSIS_HISTORY_MAX + 3; i++) {
			names.push(`202607${String(i).padStart(2, '0')}-120000.md`);
		}
		names.push('readme.txt', 'junk.md');
		const toDelete = pruneWorkspacePlanAnalysisHistoryNames(names);
		assert.deepStrictEqual(toDelete.sort(), [
			'20260701-120000.md',
			'20260702-120000.md',
			'20260703-120000.md',
		]);
		assert.strictEqual(pruneWorkspacePlanAnalysisHistoryNames(names.slice(0, 5)).length, 0);
	});

	test('compareWorkspacePlanAnalysisRuns puts live first then newest mtime', () => {
		const live: WorkspacePlanAnalysisRun = {
			resource: URI.file('/tmp/live.md'),
			stamp: undefined,
			isLive: true,
			mtimeMs: 1,
			heading: undefined,
			label: 'Latest',
		};
		const older: WorkspacePlanAnalysisRun = {
			resource: URI.file('/tmp/a.md'),
			stamp: '20260701-120000',
			isLive: false,
			mtimeMs: 10,
			heading: undefined,
			label: 'a',
		};
		const newer: WorkspacePlanAnalysisRun = {
			resource: URI.file('/tmp/b.md'),
			stamp: '20260720-120000',
			isLive: false,
			mtimeMs: 20,
			heading: undefined,
			label: 'b',
		};
		const sorted = [older, live, newer].sort(compareWorkspacePlanAnalysisRuns);
		assert.strictEqual(sorted[0], live);
		assert.strictEqual(sorted[1], newer);
		assert.strictEqual(sorted[2], older);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	parseWorkspaceSuggestedSurfaces,
	selectedSuggestedSurfaces,
	serializeWorkspaceSuggestedSurfaces,
	withSuggestedSurfaceSelection,
	withSuggestedSurfacesStatus,
	workspaceAttachmentsDir,
	workspacePlanAnalysisResource,
	workspacePlanResource,
	workspaceSuggestedSurfacesResource,
} from '../../../../../../custom/goalWorkspace/workspacePlanPaths.js';

suite('workspacePlanPaths', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('paths live under .agent/', () => {
		const root = URI.file('/tmp/ws');
		assert.ok(workspacePlanResource(root).path.endsWith('/.agent/workspace.plan.md'));
		assert.ok(workspacePlanAnalysisResource(root).path.endsWith('/.agent/workspace.plan-analysis.md'));
		assert.ok(workspaceSuggestedSurfacesResource(root).path.endsWith('/.agent/workspace.surfaces.suggested.json'));
		assert.ok(workspaceAttachmentsDir(root).path.endsWith('/.agent/workspace/attachments'));
	});

	test('parse defaults selected from suggested when selected omitted', () => {
		const doc = parseWorkspaceSuggestedSurfaces(JSON.stringify({
			status: 'draft',
			sourceBrief: '.agent/workspace/attachments/brief.pdf',
			surfaces: [
				{
					id: 'cadre-support',
					name: 'Cadre Support Chat',
					purpose: 'Inbound FAQ and booking',
					primaryUsers: ['prospects'],
					keyCapabilities: ['faq', 'escalation'],
					suggested: true,
				},
				{
					id: 'cadre-portal',
					name: 'Client Portal',
					purpose: 'Track tools and results',
					suggested: false,
				},
			],
		}));
		assert.ok(doc);
		assert.strictEqual(doc!.status, 'draft');
		assert.strictEqual(doc!.surfaces[0]!.selected, true);
		assert.strictEqual(doc!.surfaces[1]!.selected, false);
		assert.deepStrictEqual(selectedSuggestedSurfaces(doc!).map(s => s.id), ['cadre-support']);
	});

	test('toggle selection and confirm status round-trip', () => {
		const initial = parseWorkspaceSuggestedSurfaces(JSON.stringify({
			status: 'draft',
			surfaces: [
				{ id: 'a', name: 'A', suggested: true, selected: true },
				{ id: 'b', name: 'B', suggested: true, selected: true },
			],
		}))!;
		const toggled = withSuggestedSurfaceSelection(initial, 'b', false);
		const confirmed = withSuggestedSurfacesStatus(toggled, 'confirmed');
		const again = parseWorkspaceSuggestedSurfaces(serializeWorkspaceSuggestedSurfaces(confirmed))!;
		assert.strictEqual(again.status, 'confirmed');
		assert.strictEqual(again.surfaces[0]!.selected, true);
		assert.strictEqual(again.surfaces[1]!.selected, false);
	});
});

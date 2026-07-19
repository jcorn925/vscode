/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	DEFAULT_FALLBACK_GOAL_WORKSPACE_MANIFEST,
	DEFAULT_WORKSPACE_PLAN_BUSINESS_NAME,
	DEFAULT_WORKSPACE_PLAN_INTENT,
	DEFAULT_WORKSPACE_PLAN_MARKDOWN,
	DEFAULT_WORKSPACE_SUGGESTED_SURFACES_JSON,
} from '../../../../../../custom/goalWorkspace/defaultWorkspacePlan.js';
import { parseWorkspaceSuggestedSurfaces } from '../../../../../../custom/goalWorkspace/workspacePlanPaths.js';

suite('defaultWorkspacePlan', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('hardcodes jason personal business Cadre workspace plan', () => {
		assert.strictEqual(DEFAULT_WORKSPACE_PLAN_BUSINESS_NAME, `jason's personal business`);
		assert.ok(DEFAULT_WORKSPACE_PLAN_INTENT.includes('Cadre AI'));
		assert.ok(DEFAULT_WORKSPACE_PLAN_MARKDOWN.includes('cadre-support-bot'));
		assert.ok(DEFAULT_WORKSPACE_PLAN_MARKDOWN.includes(`jason's personal business`));

		const manifest = JSON.parse(DEFAULT_FALLBACK_GOAL_WORKSPACE_MANIFEST);
		assert.strictEqual(manifest.goal.name, `jason's personal business`);
		assert.deepStrictEqual(manifest.surfaces, []);

		const suggested = parseWorkspaceSuggestedSurfaces(DEFAULT_WORKSPACE_SUGGESTED_SURFACES_JSON);
		assert.ok(suggested);
		assert.strictEqual(suggested.status, 'draft');
		assert.strictEqual(suggested.surfaces[0]?.id, 'cadre-support-bot');
		assert.strictEqual(suggested.surfaces[0]?.selected, true);
		assert.strictEqual(suggested.surfaces[0]?.suggested, true);
	});
});

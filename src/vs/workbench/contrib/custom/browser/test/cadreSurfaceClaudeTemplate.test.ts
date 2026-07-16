/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	buildSurfacePlanKickoffPrompt,
	CADRE_CLAUDE_SETTINGS_JSON,
	CADRE_SURFACE_CLAUDE_MD,
} from '../../../../../../custom/goalWorkspace/cadreSurfaceClaudeTemplate.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('cadreSurfaceClaudeTemplate', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('CADRE_SURFACE_CLAUDE_MD requires plan lock before scaffold', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Plan first'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('graph-proposal.json'));
	});

	test('buildSurfacePlanKickoffPrompt embeds intent and artifact paths', () => {
		const prompt = buildSurfacePlanKickoffPrompt({
			surfaceName: 'Cadre',
			surfaceId: 'cadre',
			intent: 'Group coaching for trainers',
		});
		assert.ok(prompt.includes('Group coaching for trainers'));
		assert.ok(prompt.includes('.agent/surfaces/cadre.plan.md'));
		assert.ok(prompt.includes('.agent/task-trees/cadre.graph-proposal.json'));
		assert.ok(prompt.includes('Do not scaffold application code yet'));
	});

	test('CADRE_CLAUDE_SETTINGS_JSON allow-lists inspect script but not python3 -c', () => {
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('inspect_goal_workspace.py'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(git status'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(rm -rf *)'));
		assert.ok(!CADRE_CLAUDE_SETTINGS_JSON.includes("python3 -c"));
	});
});

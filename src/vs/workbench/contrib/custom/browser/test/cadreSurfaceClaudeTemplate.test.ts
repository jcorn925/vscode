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
		assert.ok(prompt.includes('Keep the plan lean'));
		assert.ok(prompt.includes('End the plan with a Proposal Graph section'));
		assert.ok(prompt.includes('architecture notes'));
		assert.ok(prompt.includes('phases'));
		assert.ok(prompt.includes('draft_proposal_from_workspace'));
		assert.ok(prompt.includes('.agent/references/'));
		assert.ok(prompt.includes('cadre.graph-proposal.draft.json'));
	});

	test('CADRE_SURFACE_CLAUDE_MD keeps architecture and phases in the proposal', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Architecture notes and the phased checklist live **in the proposal**'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Plan vs Proposal split'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('do not paste architecture trees or phase'));
	});

	test('CADRE_SURFACE_CLAUDE_MD requires reference draft-then-adapt research', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Research recipe (planning only)'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('draft_proposal_from_workspace'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('.agent/references/'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Draft graph shape from a real comparable repo **first**'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('One surface id — no `-2` clones'));
	});

	test('CADRE_CLAUDE_SETTINGS_JSON allow-lists inspect script but not python3 -c', () => {
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('inspect_goal_workspace.py'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(git status'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(rm -rf *)'));
		assert.ok(!CADRE_CLAUDE_SETTINGS_JSON.includes("python3 -c"));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(gh search *)'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(git clone --depth 1 https://github.com/* .agent/references/*)'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('mcp__ix-graph__draft_proposal_from_workspace'));
	});
});

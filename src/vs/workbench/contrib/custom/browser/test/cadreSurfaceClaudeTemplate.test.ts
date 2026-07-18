/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	buildCadreClaudeMcpJson,
	buildSurfacePlanKickoffPrompt,
	buildWorkspacePlanKickoffPrompt,
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

	test('CADRE_SURFACE_CLAUDE_MD includes workspace planning section', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Workspace planning (Console home)'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('workspace.surfaces.suggested.json'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('.agent/workspace/attachments/'));
	});

	test('buildWorkspacePlanKickoffPrompt embeds brief paths and stop rule', () => {
		const prompt = buildWorkspacePlanKickoffPrompt({
			businessName: 'Cadre AI',
			intent: 'Support chatbot and portal',
			attachmentPaths: ['.agent/workspace/attachments/brief.pdf'],
		});
		assert.ok(prompt.includes('Cadre AI'));
		assert.ok(prompt.includes('Support chatbot and portal'));
		assert.ok(prompt.includes('.agent/workspace.plan.md'));
		assert.ok(prompt.includes('.agent/workspace.surfaces.suggested.json'));
		assert.ok(prompt.includes('.agent/workspace/attachments/brief.pdf'));
		assert.ok(prompt.includes('Do NOT create apps/'));
		assert.ok(prompt.includes('Workspace planning'));
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
		assert.ok(prompt.includes('End the plan with a Proposed Code Graph section'));
		assert.ok(prompt.includes('architecture notes'));
		assert.ok(prompt.includes('phases'));
		assert.ok(prompt.includes('draft_proposal_from_workspace'));
		assert.ok(prompt.includes('.agent/references/'));
		assert.ok(prompt.includes('cadre.graph-proposal.draft.json'));
		assert.ok(prompt.includes('reference-candidates.json'));
		assert.ok(prompt.includes('awaiting_selection'));
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
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('reference-candidates.json'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Wait for human selection'));
	});

	test('CADRE_CLAUDE_SETTINGS_JSON allow-lists inspect script but not python3 -c', () => {
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('inspect_goal_workspace.py'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(git status'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(rm -rf *)'));
		assert.ok(!CADRE_CLAUDE_SETTINGS_JSON.includes("python3 -c"));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(gh search *)'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(git clone --depth 1 https://github.com/* .agent/references/*)'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(sleep *)'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('mcp__ix-graph__draft_proposal_from_workspace'));
	});

	test('buildCadreClaudeMcpJson points stdio ix-graph at absolute script path', () => {
		const json = buildCadreClaudeMcpJson('/abs/scripts/ix_graph_mcp.py');
		const parsed = JSON.parse(json) as { mcpServers: { 'ix-graph': { command: string; args: string[] } } };
		assert.strictEqual(parsed.mcpServers['ix-graph'].command, 'python3');
		assert.deepStrictEqual(parsed.mcpServers['ix-graph'].args, ['/abs/scripts/ix_graph_mcp.py']);
	});
});

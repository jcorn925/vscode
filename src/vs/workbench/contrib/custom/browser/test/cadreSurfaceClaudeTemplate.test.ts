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
		assert.ok(/Architecture notes and the phased\s+checklist live \*\*in the proposal\*\*/.test(CADRE_SURFACE_CLAUDE_MD));
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
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('reason'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Wait for human selection'));
	});

	test('CADRE_SURFACE_CLAUDE_MD keeps Console as owner of Steps gates', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Console owns Steps'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('do **not** invent `.workflow.json` step completions'));
		assert.ok(!CADRE_SURFACE_CLAUDE_MD.includes('card click or chat message'));
	});

	test('CADRE_SURFACE_CLAUDE_MD documents phase-progress.json handshake', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Phase progress contract'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('phase-progress.json'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('status: "completed"'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('status: "failed"'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Do not begin generate phases on Plan lock alone'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Enable Preview (Console-owned gate)'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Operational blockers (Console-owned gate)'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('blockers.json'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('localUrl'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('devCommand'));
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
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(ix docker restart)'));
		assert.ok(CADRE_CLAUDE_SETTINGS_JSON.includes('Bash(docker restart backend-arangodb-1 backend-memory-layer-1)'));
	});

	test('CADRE_SURFACE_CLAUDE_MD documents Ix backend restart-and-retry', () => {
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Ix backend wedge'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('ix docker restart'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('Ix backend recovery (common)'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('backend-arangodb-1'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('ix_prune_workspace_registry.py'));
		assert.ok(CADRE_SURFACE_CLAUDE_MD.includes('~/.ix/config.yaml'));
	});

	test('buildCadreClaudeMcpJson points stdio ix-graph at absolute script path', () => {
		const json = buildCadreClaudeMcpJson('/abs/scripts/ix_graph_mcp.py');
		const parsed = JSON.parse(json) as { mcpServers: { 'ix-graph': { command: string; args: string[] } } };
		assert.strictEqual(parsed.mcpServers['ix-graph'].command, 'python3');
		assert.deepStrictEqual(parsed.mcpServers['ix-graph'].args, ['/abs/scripts/ix_graph_mcp.py']);
	});
});

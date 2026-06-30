/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildCustomAiGoalWorkspaceContextBlock,
	buildCustomAiSystemMessageParts,
	CUSTOM_AI_EDIT_TOOL_SYSTEM_PROMPT,
	CUSTOM_AI_PRODUCT_SYSTEM_PROMPT,
	formatGoalWorkspaceIxContextLines,
} from '../../../../../../custom/ai/browser/customAiChatAgent.js';
import {
	sanitizeTraceValue,
	summarizeTraceMessages,
	summarizeTraceText,
} from '../../../../../../custom/ai/browser/customAiChatTrace.js';
import {
	ADD_TRAINING_PACKAGE_WORKFLOW_ID,
	createMissingGoalWorkspaceState,
	GOAL_WORKSPACE_IX_OVERLAY_FILE,
	GOAL_WORKSPACE_MANIFEST,
	parseGoalWorkspaceManifestText,
} from '../../../../../../custom/goalWorkspace/GoalWorkspaceService.js';

suite('CustomAiChatAgent', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/workspace');
	const manifestResource = joinPath(workspaceFolder, GOAL_WORKSPACE_MANIFEST);

	test('product system prompt describes goal-workspace agent behavior', () => {
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /goal-workspace IDE/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /related app surfaces/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /workspace\.goal\.json/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /Ix\/code metadata/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /Next\.js App Router/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /swcPlugins/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /data-vscode-src/);
		assert.match(CUSTOM_AI_PRODUCT_SYSTEM_PROMPT, /do not pause for clarifying questions/);
	});

	test('renders loaded goal workspace context for Custom AI messages', () => {
		const state = parseGoalWorkspaceManifestText(JSON.stringify({
			goal: {
				id: 'personal-training-business',
				name: 'Online Personal Training Business',
				description: 'Acquire clients and run coaching operations.',
				northStarMetric: 'active_paid_clients'
			},
			surfaces: [
				{
					id: 'booking',
					name: 'Booking',
					type: 'web-app',
					path: 'apps/booking',
					localUrl: 'http://localhost:3001',
					devCommand: 'npm run dev --workspace apps/booking',
					purpose: 'Let leads book intro calls and training sessions',
					capabilities: ['booking', 'package-selection'],
					events: ['booking.started', 'booking.completed'],
					entities: ['Lead', 'Booking'],
					ixSubsystems: ['Booking UI']
				}
			],
			shared: {
				domain: 'packages/domain',
				events: 'packages/events',
				workflows: 'workflows'
			}
		}), workspaceFolder, manifestResource);

		const block = buildCustomAiGoalWorkspaceContextBlock(state);
		assert.ok(block);
		assert.match(block, /Goal: Online Personal Training Business/);
		assert.match(block, /North-star metric: active_paid_clients/);
		assert.match(block, /Booking \(booking\)/);
		assert.match(block, /capabilities=booking,package-selection/);
		assert.match(block, /Shared paths: domain=packages\/domain, events=packages\/events, workflows=workflows/);
		assert.match(block, /workspace\.goal\.json, app files, shared workflows\/domain\/events, durable memory, and Ix metadata/);
		assert.match(block, /Next\.js App Router/);
	});

	test('renders missing and invalid manifest guidance', () => {
		const missing = buildCustomAiGoalWorkspaceContextBlock(createMissingGoalWorkspaceState(workspaceFolder, manifestResource));
		assert.ok(missing);
		assert.match(missing, /workspace\.goal\.json is missing/);
		assert.match(missing, /create workspace\.goal\.json before scaffolding surfaces/);

		const invalidState = parseGoalWorkspaceManifestText('{ nope', workspaceFolder, manifestResource);
		const invalid = buildCustomAiGoalWorkspaceContextBlock(invalidState);
		assert.ok(invalid);
		assert.match(invalid, /present but invalid/);
		assert.match(invalid, /Invalid JSON/);
	});

	test('renders Ix overlay subsystem labels and surface mappings', () => {
		const lines = formatGoalWorkspaceIxContextLines({
			resource: joinPath(workspaceFolder, GOAL_WORKSPACE_IX_OVERLAY_FILE),
			generatedAt: '2026-06-29T00:00:00.000Z',
			command: 'ix subsystems --list',
			discoveredSubsystems: [
				{ id: 'ix-booking', label: 'Booking UI', path: 'apps/booking' }
			],
			surfaces: [
				{
					surfaceId: 'booking',
					subsystemIds: ['ix-booking'],
					subsystemLabels: ['Booking UI'],
					matchReason: 'heuristic name/path match'
				}
			]
		});

		const block = lines.join('\n');
		assert.match(block, /Booking UI \(ix-booking\)/);
		assert.match(block, /booking -> Booking UI/);
		assert.match(block, /heuristic name\/path match/);
	});

	test('buildCustomAiSystemMessageParts includes workflow hint and edit guidance for loaded workspace', () => {
		const state = parseGoalWorkspaceManifestText(JSON.stringify({
			goal: { id: 'demo', name: 'Demo Goal' },
			surfaces: [{ id: 'booking', name: 'Booking', capabilities: [], events: [], entities: [], ixSubsystems: [] }],
			shared: {}
		}), workspaceFolder, manifestResource);

		const parts = buildCustomAiSystemMessageParts({
			customSystemPrompt: 'Extra user guidance.',
			toolsEnabled: true,
			goalWorkspaceState: state,
		});
		const joined = parts.join('\n\n');

		assert.match(joined, /goal-workspace IDE/);
		assert.match(joined, /Goal: Demo Goal/);
		assert.match(joined, /planCrossAppWorkflow/);
		assert.match(joined, new RegExp(ADD_TRAINING_PACKAGE_WORKFLOW_ID));
		assert.match(joined, /Extra user guidance/);
		assert.match(joined, /editFile/);
		assert.ok(parts.includes(CUSTOM_AI_EDIT_TOOL_SYSTEM_PROMPT));
	});

	test('buildCustomAiSystemMessageParts omits edit guidance when tools are disabled', () => {
		const state = parseGoalWorkspaceManifestText(JSON.stringify({
			goal: { id: 'demo', name: 'Demo Goal' },
			surfaces: [],
			shared: {}
		}), workspaceFolder, manifestResource);

		const parts = buildCustomAiSystemMessageParts({
			toolsEnabled: false,
			goalWorkspaceState: state,
		});
		const joined = parts.join('\n\n');

		assert.match(joined, /goal-workspace IDE/);
		assert.doesNotMatch(joined, /editFile/);
		assert.ok(!parts.includes(CUSTOM_AI_EDIT_TOOL_SYSTEM_PROMPT));
	});

	test('trace sanitizer redacts secrets and summarizes content by default', () => {
		const sanitized = sanitizeTraceValue({
			apiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
			authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
			prompt: 'line one\nline two',
			uri: 'file:///workspace/apps/booking/page.tsx',
		}) as Record<string, unknown>;

		assert.strictEqual(sanitized.apiKey, '[redacted]');
		assert.strictEqual(sanitized.authorization, '[redacted]');
		assert.strictEqual(sanitized.prompt, 17);
		assert.strictEqual(sanitized.uri, 'file:///workspace/apps/booking/page.tsx');
	});

	test('trace sanitizer can include capped snippets when explicitly enabled', () => {
		const summary = summarizeTraceText('hello sk-abcdefghijklmnopqrstuvwxyz world', true, 64);

		assert.strictEqual(summary.chars, 41);
		assert.strictEqual(summary.snippet, 'hello [redacted] world');
		assert.strictEqual(summary.truncated, false);
	});

	test('trace message summary counts text and tool exchange shape', () => {
		const summary = summarizeTraceMessages([
			{ role: 'system', content: [{ type: 'text', value: 'system' }] },
			{ role: 'user', content: [{ type: 'text', value: 'create booking' }] },
			{ role: 'assistant', content: [{ type: 'tool_use', value: undefined }] },
			{ role: 'user', content: [{ type: 'tool_result', value: [{ type: 'text', value: 'ok' }] }] },
		]);

		assert.strictEqual(summary.messageCount, 4);
		assert.strictEqual(summary.textChars, 20);
		assert.strictEqual(summary.toolUseCount, 1);
		assert.strictEqual(summary.toolResultCount, 1);
	});
});

#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { analyzeRepo } from './analyzer.js';
import { ASSISTANT_GUIDANCE, buildCapabilityMap, buildCaveats } from './guidance.js';

const TOOL_NAME = 'goalconsole_workflow_assessment';
const PROMPT_NAME = 'workflow-assessment';

const server = new Server(
	{ name: 'goalconsole-workflow-advisor', version: '0.1.0' },
	{ capabilities: { tools: {}, prompts: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [{
		name: TOOL_NAME,
		description: 'Analyzes a repository and returns repo-specific facts plus a grounded map of which GoalConsole IDE capabilities would improve the workflow there. Use whenever the user asks how GoalConsole (the goal-workspace IDE) would help, improve, or fit their current project or workflow. Pass the root of the repo the user has open.',
		inputSchema: {
			type: 'object',
			properties: {
				repoPath: {
					type: 'string',
					description: 'Absolute path to the repository root to analyze. Defaults to the server working directory.',
				},
			},
		},
	}],
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
	if (request.params.name !== TOOL_NAME) {
		throw new Error(`Unknown tool: ${request.params.name}`);
	}
	const repoPath = request.params.arguments?.repoPath || process.cwd();
	const facts = analyzeRepo(repoPath);
	if (!facts.exists) {
		return { content: [{ type: 'text', text: `Path does not exist: ${facts.root}` }], isError: true };
	}
	return { content: [{ type: 'text', text: renderAssessment(facts) }] };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
	prompts: [{
		name: PROMPT_NAME,
		description: 'Ask how the GoalConsole IDE would improve the workflow for the currently open repository.',
		arguments: [{ name: 'repoPath', description: 'Repository root to assess', required: false }],
	}],
}));

server.setRequestHandler(GetPromptRequestSchema, async request => {
	if (request.params.name !== PROMPT_NAME) {
		throw new Error(`Unknown prompt: ${request.params.name}`);
	}
	const repoPath = request.params.arguments?.repoPath;
	return {
		messages: [{
			role: 'user',
			content: {
				type: 'text',
				text: `How would the GoalConsole IDE improve my current workflow? Call the ${TOOL_NAME} tool${repoPath ? ` with repoPath "${repoPath}"` : ' on the repository I have open'} and base your answer strictly on what it detects.`,
			},
		}],
	};
});

function renderAssessment(facts) {
	const capabilityMap = buildCapabilityMap(facts);
	const caveats = buildCaveats(facts);
	const lines = [
		'# GoalConsole workflow assessment (grounded input)',
		'',
		'## Detected repository facts',
		'```json',
		JSON.stringify(facts, null, 2),
		'```',
		'',
		'## Capability map for this repo',
		...capabilityMap.map(entry => `- **[${entry.relevance}]** ${entry.capability}\n  - Why here: ${entry.because}`),
	];
	if (caveats.length) {
		lines.push('', '## Honest limits for this repo', ...caveats.map(caveat => `- ${caveat}`));
	}
	lines.push('', '## How to answer', `- ${ASSISTANT_GUIDANCE}`);
	return lines.join('\n');
}

const transport = new StdioServerTransport();
await server.connect(transport);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import {
	formatCrossAppWorkflowPlanMarkdown,
	IConsoleService,
	listCrossAppWorkflows,
	type TrainingPackageDraft,
} from '../../goalWorkspace/ConsoleService.js';
import {
	CountTokensCallback,
	IPreparedToolInvocation,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolInvocationPreparationContext,
	IToolResult,
	ToolDataSource,
	ToolInvocationPresentation,
	ToolProgress,
} from '../../../vs/workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { CUSTOM_AI_PLAN_WORKFLOW_TOOL_ID, CUSTOM_AI_PLAN_WORKFLOW_TOOL_NAME } from '../common/customAiConstants.js';

const KNOWN_WORKFLOW_IDS = listCrossAppWorkflows().map(workflow => workflow.id);

function buildWorkflowCatalogDescription(): string {
	return listCrossAppWorkflows()
		.map(workflow => `  ${workflow.id}: ${workflow.label} (task kinds: ${workflow.taskKinds.join(', ')})`)
		.join('\n');
}

export const CustomAiPlanCrossAppWorkflowToolData: IToolData = {
	id: CUSTOM_AI_PLAN_WORKFLOW_TOOL_ID,
	toolReferenceName: CUSTOM_AI_PLAN_WORKFLOW_TOOL_NAME,
	displayName: 'Plan cross-app workflow',
	modelDescription: [
		'Build a structured cross-app workflow plan for a goal workspace business change.',
		'',
		'Call this before multi-surface edits when the user asks to add offers, packages, training programs, or similar business workflows that span multiple app surfaces.',
		'Returns affected surfaces, shared context, implementation steps, validation, and memory updates.',
		'',
		'Known workflows:',
		buildWorkflowCatalogDescription(),
		'',
		'Arguments:',
		'  workflowId     (string, required) One of the known workflow ids above.',
		'  packageDraft   (object, optional) Override draft fields for package-oriented workflows.',
		'    name, durationWeeks, priceCents, billingModel (one_time|monthly), description, features (string[]), status (draft|active)',
	].join('\n'),
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	inputSchema: {
		type: 'object',
		properties: {
			workflowId: {
				type: 'string',
				description: 'Known cross-app workflow id.',
				...(KNOWN_WORKFLOW_IDS.length ? { enum: [...KNOWN_WORKFLOW_IDS] } : {}),
			},
			packageDraft: {
				type: 'object',
				description: 'Optional package draft overrides for package-oriented workflows.',
				properties: {
					name: { type: 'string' },
					durationWeeks: { type: 'number' },
					priceCents: { type: 'number' },
					billingModel: { type: 'string', enum: ['one_time', 'monthly'] },
					description: { type: 'string' },
					features: { type: 'array', items: { type: 'string' } },
					status: { type: 'string', enum: ['draft', 'active'] },
				},
			},
		},
		required: ['workflowId'],
	},
};

interface PlanWorkflowToolParams {
	workflowId: string;
	packageDraft?: Partial<TrainingPackageDraft>;
}

export class CustomAiPlanCrossAppWorkflowTool implements IToolImpl {

	constructor(
		@IConsoleService private readonly _consoleService: IConsoleService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		return { presentation: ToolInvocationPresentation.Hidden };
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as Partial<PlanWorkflowToolParams>;
		const workflowId = typeof params.workflowId === 'string' ? params.workflowId.trim() : '';
		if (!workflowId) {
			return errorResult('Missing required argument: workflowId');
		}

		const workflow = this._consoleService.getCrossAppWorkflow(workflowId);
		if (!workflow) {
			const known = KNOWN_WORKFLOW_IDS.join(', ') || '(none)';
			return errorResult(`Unknown workflow id "${workflowId}". Known workflows: ${known}.`);
		}

		const state = this._consoleService.getState();
		if (state.status !== 'loaded') {
			return errorResult('Open a valid goal workspace with workspace.goal.json before planning a cross-app workflow.');
		}

		const packageDraft = parsePackageDraft(params.packageDraft);
		const plan = this._consoleService.buildCrossAppWorkflowPlan(workflowId, packageDraft);
		if (!plan) {
			return errorResult(`Could not build workflow plan for "${workflowId}". Ensure workspace.goal.json is loaded and valid.`);
		}

		return successResult(formatCrossAppWorkflowPlanMarkdown(plan));
	}
}

function parsePackageDraft(raw: unknown): Partial<TrainingPackageDraft> | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const draft: Record<string, unknown> = {};
	if (typeof record.name === 'string') {
		draft.name = record.name;
	}
	if (typeof record.durationWeeks === 'number') {
		draft.durationWeeks = record.durationWeeks;
	}
	if (typeof record.priceCents === 'number') {
		draft.priceCents = record.priceCents;
	}
	if (record.billingModel === 'one_time' || record.billingModel === 'monthly') {
		draft.billingModel = record.billingModel;
	}
	if (typeof record.description === 'string') {
		draft.description = record.description;
	}
	if (Array.isArray(record.features) && record.features.every(feature => typeof feature === 'string')) {
		draft.features = record.features;
	}
	if (record.status === 'draft' || record.status === 'active') {
		draft.status = record.status;
	}
	return Object.keys(draft).length ? draft as Partial<TrainingPackageDraft> : undefined;
}

function errorResult(message: string): IToolResult {
	return { content: [{ kind: 'text', value: message }], toolResultError: true };
}

function successResult(message: string): IToolResult {
	return { content: [{ kind: 'text', value: message }] };
}

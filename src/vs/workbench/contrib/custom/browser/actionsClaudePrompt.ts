/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkflowRunResult } from '../../../../../custom/goalWorkspace/workflowCatalogTypes.js';

export interface ActionsClaudeCommonOutcomePromptInput {
	readonly actionId: string;
	readonly actionLabel: string;
	readonly ok: boolean;
	readonly detail: string;
	readonly surfaceId?: string;
	readonly surfaceName?: string;
}

export interface ActionsClaudeWorkflowOutcomePromptInput {
	readonly surfaceName: string;
	readonly surfaceId: string;
	readonly workflowId: string;
	readonly workflowLabel?: string;
	readonly result: WorkflowRunResult;
	/** Optional single-step focus (step play from Actions). */
	readonly focusStepId?: string;
}

/** @deprecated Use ActionsClaudeWorkflowOutcomePromptInput. */
export type ActionsClaudeErrorPromptInput = ActionsClaudeWorkflowOutcomePromptInput;

/** Build a Claude prompt for a Common Actions panel request + outcome. */
export function formatActionsCommonOutcomePrompt(input: ActionsClaudeCommonOutcomePromptInput): string {
	const detail = input.detail.trim() || (input.ok ? 'Completed.' : 'Unknown error');
	const lines: string[] = [
		`The user requested an Actions panel common action.`,
		`Action: ${input.actionLabel} (${input.actionId}).`,
	];
	const surfaceName = input.surfaceName?.trim();
	const surfaceId = input.surfaceId?.trim();
	if (surfaceName || surfaceId) {
		lines.push(`Surface: ${surfaceName || surfaceId}${surfaceId && surfaceName ? ` (${surfaceId})` : ''}.`);
	}
	lines.push(`Outcome: ${input.ok ? 'success' : 'failure'}.`);
	lines.push(`Detail: ${detail}`);
	if (input.ok) {
		lines.push(
			'Verify the result in this workspace (and any related deploy/registry state). If anything is still broken or incomplete, fix it with the smallest change that makes the action succeed. Ask only if you need a decision I must make.',
		);
	} else {
		lines.push(
			'Diagnose the failure and fix it if you can from this workspace. Ask only if you need a decision I must make.',
		);
	}
	return lines.join('\n');
}

/** Build a Claude prompt for an Actions workflow request + outcome. */
export function formatActionsWorkflowOutcomePrompt(input: ActionsClaudeWorkflowOutcomePromptInput): string {
	const ok = input.result.ok;
	const lines: string[] = [
		`The user requested an Actions panel workflow for surface "${input.surfaceName}" (${input.surfaceId}).`,
		`Workflow: ${input.workflowLabel?.trim() || input.workflowId} (${input.result.workflowId}).`,
		`Outcome: ${ok ? 'success' : 'failure'}.`,
	];
	if (input.focusStepId) {
		lines.push(`Focused action step: ${input.focusStepId}.`);
	}
	if (!ok) {
		const failedSteps = input.result.steps.filter(step => !step.ok);
		if (failedSteps.length === 0) {
			lines.push('The run reported failure but no step details were recorded.');
		} else {
			lines.push('Failed steps:');
			for (const step of failedSteps) {
				const detail = step.detail?.trim() || 'No detail';
				lines.push(`- ${step.stepId}: ${detail}`);
			}
		}
	} else {
		const stepSummary = input.result.steps.map(step => `${step.stepId}:${step.ok ? 'ok' : 'fail'}`).join(', ');
		if (stepSummary) {
			lines.push(`Steps: ${stepSummary}.`);
		}
	}
	const verification = input.result.verificationReport?.trim();
	if (verification) {
		lines.push('Verification report:');
		lines.push(verification);
	}
	if (ok) {
		lines.push(
			'Verify the workflow result in this workspace and the embedded UI. If anything is still broken or incomplete, fix it with the smallest change that makes the action pass. Ask only if you need a decision I must make.',
		);
	} else {
		lines.push(
			'Diagnose the failure, propose a concrete fix in this workspace, and apply the smallest change that makes the action pass. Ask only if you need a decision I must make.',
		);
	}
	return lines.join('\n');
}

/** Build a Claude prompt from a failed Actions workflow run. */
export function formatActionsWorkflowErrorPrompt(input: ActionsClaudeWorkflowOutcomePromptInput): string {
	return formatActionsWorkflowOutcomePrompt(input);
}

/** Build a Claude prompt for a Common Actions panel failure (e.g. publish). */
export function formatActionsCommonErrorPrompt(actionId: string, actionLabel: string, errorMessage: string): string {
	return formatActionsCommonOutcomePrompt({
		actionId,
		actionLabel,
		ok: false,
		detail: errorMessage,
	});
}

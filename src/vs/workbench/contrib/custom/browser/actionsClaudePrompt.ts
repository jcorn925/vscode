/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkflowRunResult } from '../../../../../custom/goalWorkspace/workflowCatalogTypes.js';

export interface ActionsClaudeErrorPromptInput {
	readonly surfaceName: string;
	readonly surfaceId: string;
	readonly workflowId: string;
	readonly workflowLabel?: string;
	readonly result: WorkflowRunResult;
	/** Optional single-step focus (step play from Actions). */
	readonly focusStepId?: string;
}

/** Build a Claude prompt from a failed Actions workflow run. */
export function formatActionsWorkflowErrorPrompt(input: ActionsClaudeErrorPromptInput): string {
	const failedSteps = input.result.steps.filter(step => !step.ok);
	const lines: string[] = [
		`An Actions panel workflow failed for surface "${input.surfaceName}" (${input.surfaceId}).`,
		`Workflow: ${input.workflowLabel?.trim() || input.workflowId} (${input.result.workflowId}).`,
	];
	if (input.focusStepId) {
		lines.push(`Focused action step: ${input.focusStepId}.`);
	}
	if (failedSteps.length === 0) {
		lines.push('The run reported failure but no step details were recorded.');
	} else {
		lines.push('Failed steps:');
		for (const step of failedSteps) {
			const detail = step.detail?.trim() || 'No detail';
			lines.push(`- ${step.stepId}: ${detail}`);
		}
	}
	const verification = input.result.verificationReport?.trim();
	if (verification) {
		lines.push('Verification report:');
		lines.push(verification);
	}
	lines.push(
		'Diagnose the failure, propose a concrete fix in this workspace, and apply the smallest change that makes the action pass. Ask only if you need a decision I must make.',
	);
	return lines.join('\n');
}

/** Build a Claude prompt for a Common Actions panel failure (e.g. publish). */
export function formatActionsCommonErrorPrompt(actionId: string, actionLabel: string, errorMessage: string): string {
	const detail = errorMessage.trim() || 'Unknown error';
	return [
		`An Actions panel common action failed.`,
		`Action: ${actionLabel} (${actionId}).`,
		`Error: ${detail}`,
		'Diagnose the failure and fix it if you can from this workspace. Ask only if you need a decision I must make.',
	].join('\n');
}

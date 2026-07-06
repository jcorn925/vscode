/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import type { IxSubsystemRegion } from './surfaceIxMatch.js';
import type { WorkflowRunResult, WorkflowSpec, WorkflowStep, WorkflowStepRunResult } from './workflowCatalogTypes.js';

export interface WorkflowRunnerHandlers {
	readonly ensureServer: () => Promise<void>;
	readonly navigate: (route: string) => Promise<void>;
	readonly click: (step: WorkflowStep) => Promise<void>;
	readonly assertText: (step: WorkflowStep) => Promise<void>;
	readonly verifySurface: (surfaceId: string) => Promise<{ passed: boolean; report: string }>;
}

export interface WorkflowRunnerInput {
	readonly workflow: WorkflowSpec;
	readonly handlers: WorkflowRunnerHandlers;
	readonly ixSubsystems?: readonly IxSubsystemRegion[];
}

export interface IWorkflowRunnerService {
	readonly _serviceBrand: undefined;
	readonly onDidRunWorkflow: Event<WorkflowRunResult>;
	runWorkflow(input: WorkflowRunnerInput): Promise<WorkflowRunResult>;
}

export const IWorkflowRunnerService = createDecorator<IWorkflowRunnerService>('workflowRunnerService');

class WorkflowRunnerService extends Disposable implements IWorkflowRunnerService {
	readonly _serviceBrand: undefined;

	private readonly _onDidRunWorkflow = this._register(new Emitter<WorkflowRunResult>());
	readonly onDidRunWorkflow = this._onDidRunWorkflow.event;

	async runWorkflow(input: WorkflowRunnerInput): Promise<WorkflowRunResult> {
		const result = await runWorkflowSpec(input);
		this._onDidRunWorkflow.fire(result);
		return result;
	}
}

export async function runWorkflowSpec(input: WorkflowRunnerInput): Promise<WorkflowRunResult> {
	const { workflow, handlers, ixSubsystems } = input;
	const steps: WorkflowStepRunResult[] = [];
	let ixChecked = false;

	try {
		if (ixSubsystems && workflow.ixBindings.length > 0) {
			ixChecked = true;
			for (const binding of workflow.ixBindings) {
				const bindingKey = normalizeIxText(binding.subsystemLabel);
				const matched = ixSubsystems.some(region =>
					normalizeIxText(region.name) === bindingKey || normalizeIxText(region.regionId) === bindingKey
				);
				if (!matched) {
					steps.push({
						stepId: binding.stepId,
						ok: false,
						detail: `Ix subsystem missing for binding "${binding.subsystemLabel}"`,
					});
					return buildResult(workflow, steps, false, ixChecked);
				}
			}
		}

		for (const step of workflow.steps) {
			try {
				switch (step.type) {
					case 'ensureServer':
						await handlers.ensureServer();
						break;
					case 'navigate':
						await handlers.navigate(step.route ?? '/');
						break;
					case 'click':
						await handlers.click(step);
						break;
					case 'assertText':
						await handlers.assertText(step);
						break;
				}
				steps.push({ stepId: step.id, ok: true, detail: `${step.type} ok` });
			} catch (error: unknown) {
				steps.push({
					stepId: step.id,
					ok: false,
					detail: String((error as Error)?.message ?? error),
				});
				return buildResult(workflow, steps, false, ixChecked);
			}
		}

		const verification = await handlers.verifySurface(workflow.surfaceId);
		return buildResult(workflow, steps, verification.passed, ixChecked, verification.report);
	} catch (error: unknown) {
		return buildResult(workflow, [
			...steps,
			{ stepId: 'workflow-error', ok: false, detail: String((error as Error)?.message ?? error) }
		], false, ixChecked);
	}
}

function buildResult(
	workflow: WorkflowSpec,
	steps: readonly WorkflowStepRunResult[],
	ok: boolean,
	ixChecked: boolean,
	verificationReport?: string,
): WorkflowRunResult {
	return {
		workflowId: workflow.id,
		surfaceId: workflow.surfaceId,
		ok,
		ixChecked,
		steps,
		verificationReport,
	};
}

function normalizeIxText(value: string): string {
	return value.trim().toLowerCase();
}

registerSingleton(IWorkflowRunnerService, WorkflowRunnerService, InstantiationType.Delayed);

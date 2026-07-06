/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WorkflowScope = 'surface' | 'cross-app';

export type WorkflowStepType = 'ensureServer' | 'navigate' | 'click' | 'assertText';

export interface WorkflowStepTarget {
	readonly text?: string;
	readonly ariaLabel?: string;
	readonly selector?: string;
}

export interface WorkflowStep {
	readonly id: string;
	readonly type: WorkflowStepType;
	readonly route?: string;
	readonly target?: WorkflowStepTarget;
	readonly value?: string;
}

export interface WorkflowIxBinding {
	readonly stepId: string;
	readonly subsystemLabel: string;
}

export interface WorkflowSpec {
	readonly id: string;
	readonly label: string;
	readonly scope: WorkflowScope;
	readonly surfaceId: string;
	readonly source: string;
	readonly steps: readonly WorkflowStep[];
	readonly events: readonly string[];
	readonly ixBindings: readonly WorkflowIxBinding[];
	readonly fixtures?: Record<string, string>;
}

export interface WorkflowCatalog {
	readonly version: 1;
	readonly workflows: readonly WorkflowSpec[];
}

export interface WorkflowStepRunResult {
	readonly stepId: string;
	readonly ok: boolean;
	readonly detail: string;
}

export interface WorkflowRunResult {
	readonly workflowId: string;
	readonly surfaceId: string;
	readonly ok: boolean;
	readonly ixChecked: boolean;
	readonly steps: readonly WorkflowStepRunResult[];
	readonly verificationReport?: string;
}

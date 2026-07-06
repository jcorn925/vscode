/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SetupGuideStepStatus } from '../setup/setupGuideTypes.js';

export type SurfaceFeatureCheckStatus = SetupGuideStepStatus;

export type SurfaceFeatureCheckCategory = 'workspace' | 'builder' | 'blueprint' | 'agent' | 'verification';

export interface SurfaceFeatureCheckItem {
	readonly id: string;
	readonly category: SurfaceFeatureCheckCategory;
	readonly label: string;
	readonly description: string;
	readonly status: SurfaceFeatureCheckStatus;
	readonly detail: string;
}

export interface SurfaceWorkflowActionItem {
	readonly workflowId: string;
	readonly surfaceId: string;
	readonly workflowLabel: string;
	readonly stepId: string;
	readonly stepLabel: string;
}

export interface SurfaceFeatureChecklistState {
	readonly items: readonly SurfaceFeatureCheckItem[];
	readonly actions: readonly SurfaceWorkflowActionItem[];
	readonly readyCount: number;
	readonly totalCount: number;
	readonly isRefreshing: boolean;
}

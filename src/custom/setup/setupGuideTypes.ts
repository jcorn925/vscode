/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../vs/base/common/event.js';

export type SetupGuideStepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'warning';

export interface SetupGuideStepSnapshot {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly status: SetupGuideStepStatus;
	readonly detail: string;
	readonly manualHint: string;
	readonly canAutoFix: boolean;
	readonly autoFixLabel: string | undefined;
	readonly extraActions?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

export interface SetupGuideState {
	readonly steps: ReadonlyArray<SetupGuideStepSnapshot>;
	readonly incompleteCount: number;
	readonly isRefreshing: boolean;
	readonly isAutoFixRunning: boolean;
}

export interface SetupGuideController {
	readonly onDidChangeState: Event<SetupGuideState>;
	getState(): SetupGuideState;
	shouldShow(): boolean;
	markDismissed(): void;
	refresh(): Promise<void>;
	runAutomaticFixes(): Promise<void>;
	runStepFix(stepId: string): Promise<void>;
	runExtraAction?(actionId: string): Promise<void>;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WorkspacePlanSubmitPhase =
	| 'starting'
	| 'planning'
	| 'analyzing'
	| 'analyze'
	| 'start';

export interface WorkspacePlanSubmitSignals {
	readonly kickoffInFlight?: boolean;
	readonly sessionActive?: boolean;
	readonly analysisInFlight?: boolean;
	readonly hasPlanArtifacts?: boolean;
}

/** Console Workspace Plan primary button phase (labels applied in modeShell). */
export function resolveWorkspacePlanSubmitPhase(signals: WorkspacePlanSubmitSignals): WorkspacePlanSubmitPhase {
	if (signals.kickoffInFlight) {
		return 'starting';
	}
	if (signals.sessionActive) {
		return 'planning';
	}
	if (signals.analysisInFlight) {
		return 'analyzing';
	}
	if (signals.hasPlanArtifacts) {
		return 'analyze';
	}
	return 'start';
}

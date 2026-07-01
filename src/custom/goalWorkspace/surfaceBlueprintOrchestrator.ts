/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SurfaceBlueprintVerificationResult } from './surfaceBlueprintTypes.js';
import { SurfaceBuilderHandoffState } from './surfaceBuilderHandoffState.js';
import { formatSurfaceBlueprintGapReport } from './surfaceBlueprintVerify.js';

export const MAX_SURFACE_BLUEPRINT_REPAIR_ATTEMPTS = 2;

export type SurfaceBlueprintRepairHandler = (input: {
	readonly report: string;
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly attempt: number;
}) => void;

let repairHandler: SurfaceBlueprintRepairHandler | undefined;
let repairLimitHandler: ((input: { readonly surfaceName: string; readonly surfaceId: string }) => void) | undefined;

export const SurfaceBlueprintOrchestrator = {
	setRepairHandler(handler: SurfaceBlueprintRepairHandler | undefined): void {
		repairHandler = handler;
	},

	setRepairLimitHandler(handler: ((input: { readonly surfaceName: string; readonly surfaceId: string }) => void) | undefined): void {
		repairLimitHandler = handler;
	},

	handleVerificationResult(result: SurfaceBlueprintVerificationResult, surfaceName: string): void {
		const handoff = SurfaceBuilderHandoffState.getActive();
		if (!handoff || handoff.kind !== 'surface') {
			return;
		}
		if (result.passed) {
			SurfaceBuilderHandoffState.setActive({
				...handoff,
				phase: 'verify',
				repairAttempts: 0,
			});
			return;
		}

		const attempts = (handoff.repairAttempts ?? 0) + 1;
		SurfaceBuilderHandoffState.setActive({
			...handoff,
			phase: 'repair',
			repairAttempts: attempts,
		});

		if (attempts > MAX_SURFACE_BLUEPRINT_REPAIR_ATTEMPTS) {
			repairLimitHandler?.({ surfaceName, surfaceId: result.surfaceId });
			return;
		}

		const report = formatSurfaceBlueprintGapReport(result);
		repairHandler?.({
			report,
			surfaceId: result.surfaceId,
			surfaceName,
			attempt: attempts,
		});
	},
};

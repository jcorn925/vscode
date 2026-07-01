/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SurfaceBuilderHandoffStateValue {
	readonly kind: 'surface';
	readonly templateId: string;
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly title: string;
	readonly phase: 'blueprint' | 'scaffold' | 'verify' | 'repair';
	readonly prompt?: string;
	readonly blueprintResource?: string;
	readonly repairAttempts?: number;
}

let activeHandoff: SurfaceBuilderHandoffStateValue | undefined;

export const SurfaceBuilderHandoffState = {
	getActive(): SurfaceBuilderHandoffStateValue | undefined {
		return activeHandoff;
	},
	setActive(value: SurfaceBuilderHandoffStateValue | undefined): void {
		activeHandoff = value;
	},
};

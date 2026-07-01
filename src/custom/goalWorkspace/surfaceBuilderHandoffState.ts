/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SurfaceBuilderHandoffKind = 'context' | 'surface';

export interface SurfaceBuilderHandoffStateValue {
	readonly kind: SurfaceBuilderHandoffKind;
	readonly topicId?: string;
	readonly title: string;
	readonly fileName?: string;
	readonly prompt?: string;
	readonly surfaceName?: string;
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

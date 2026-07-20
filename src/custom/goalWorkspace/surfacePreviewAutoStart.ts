/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isSurfacePreviewWired } from './surfacePlanWorkflowStatus.js';

/** Whether Console should kick a surface's `devCommand` without waiting for Start preview. */
export function shouldAutoStartSurfacePreview(input: {
	readonly localUrl?: string;
	readonly devCommand?: string;
	readonly previewSelected: boolean;
	readonly reachable: boolean;
	readonly alreadyStarted: boolean;
	readonly alreadyStarting: boolean;
}): boolean {
	if (!input.previewSelected || input.reachable || input.alreadyStarted || input.alreadyStarting) {
		return false;
	}
	return isSurfacePreviewWired({
		localUrl: input.localUrl,
		devCommand: input.devCommand,
	});
}

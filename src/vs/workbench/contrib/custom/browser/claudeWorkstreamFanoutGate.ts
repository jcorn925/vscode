/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** True when Settings allows parallel fan-out and the partition can fan out. */
export function shouldFanoutClaudeWorkstreams(parallelEnabled: boolean, canFanout: boolean): boolean {
	return parallelEnabled && canFanout;
}

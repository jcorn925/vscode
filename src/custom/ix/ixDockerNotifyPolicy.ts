/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DockerAvailabilityStatus } from '../docker/DockerAvailabilityService.js';

/**
 * Whether a failed `ix docker start` warrants an error toast. When Docker is
 * definitively unavailable the pipeline step and the Docker rail card already
 * say so — a toast on every launch adds nothing. A toast fires at most once
 * (until a later Docker step succeeds and resets the flag) for genuine
 * failures while Docker itself looks fine.
 */
export function shouldNotifyIxDockerFailure(dockerStatus: DockerAvailabilityStatus, alreadyNotified: boolean): boolean {
	if (alreadyNotified) {
		return false;
	}
	return dockerStatus !== DockerAvailabilityStatus.Missing
		&& dockerStatus !== DockerAvailabilityStatus.McpToolkitMissing;
}

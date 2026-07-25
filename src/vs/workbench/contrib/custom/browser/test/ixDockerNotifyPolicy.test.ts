/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DockerAvailabilityStatus } from '../../../../../../custom/docker/DockerAvailabilityService.js';
import { shouldNotifyIxDockerFailure } from '../../../../../../custom/ix/ixDockerNotifyPolicy.js';

suite('ixDockerNotifyPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('notifies once for failures while Docker looks fine, never when Docker is down', () => {
		assert.deepStrictEqual(
			[
				shouldNotifyIxDockerFailure(DockerAvailabilityStatus.Available, false),
				shouldNotifyIxDockerFailure(DockerAvailabilityStatus.Unknown, false),
				shouldNotifyIxDockerFailure(DockerAvailabilityStatus.Available, true),
				shouldNotifyIxDockerFailure(DockerAvailabilityStatus.Missing, false),
				shouldNotifyIxDockerFailure(DockerAvailabilityStatus.McpToolkitMissing, false),
			],
			[true, true, false, false, false],
		);
	});
});

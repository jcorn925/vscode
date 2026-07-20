/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildOpenVercelDeploymentCommand,
	vercelProductionUrlFromProjectJson,
} from '../publishWorkspaceToVercel.js';

suite('publishWorkspaceToVercel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('vercelProductionUrlFromProjectJson uses projectName', () => {
		assert.strictEqual(
			vercelProductionUrlFromProjectJson('{"projectId":"prj_x","orgId":"team_y","projectName":"my-app"}'),
			'https://my-app.vercel.app',
		);
		assert.strictEqual(
			vercelProductionUrlFromProjectJson('{"projectId":"prj_x","orgId":"team_y"}'),
			undefined,
		);
		assert.strictEqual(vercelProductionUrlFromProjectJson('not-json'), undefined);
		assert.strictEqual(
			vercelProductionUrlFromProjectJson('{"projectName":"bad name"}'),
			undefined,
		);
	});

	test('buildOpenVercelDeploymentCommand opens vercel.app URL', () => {
		const command = buildOpenVercelDeploymentCommand();
		assert.ok(command.includes('vercel@latest ls'));
		assert.ok(command.includes('vercel.app'));
		assert.ok(command.includes('open "$url"') || command.includes('xdg-open'));
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { IFileService } from '../../../../../platform/files/common/files.js';
import type { IWebviewService } from '../../../webview/browser/webview.js';
import type { IIxIntegrationService } from '../../../../../../custom/ix/IxIntegrationService.js';
import { SurfacePlanPanel } from '../surfacePlanPanel.js';

suite('surfacePlanPanel ownership', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stamps owning surface on Steps tracker and clears on clear()', async () => {
		const root = document.createElement('div');
		const fileService = {
			onDidFilesChange: new Emitter().event,
			watch: () => ({ dispose: () => { } }),
			exists: async () => false,
			readFile: async () => { throw new Error('missing'); },
			stat: async () => { throw new Error('missing'); },
			writeFile: async () => { },
			createFolder: async () => { },
		} as unknown as IFileService;
		const onMessage = new Emitter<{ message: unknown }>();
		const webview = {
			onMessage: onMessage.event,
			postMessage: async () => true,
			claim: () => { },
			layout: () => { },
			setHtml: () => { },
			mountTo: () => { },
			dispose: () => onMessage.dispose(),
		};
		const panel = new SurfacePlanPanel(
			root,
			fileService,
			{ createWebviewElement: () => webview } as unknown as IWebviewService,
			{
				onDidChangeState: new Emitter().event,
				getState: () => ({}),
			} as unknown as IIxIntegrationService,
		);

		await panel.load({
			surfaceId: 'cadre-support-bot',
			surfaceName: 'Cadre AI Support Chatbot',
			workspaceFolder: URI.file('/tmp/ws'),
			surface: {
				id: 'cadre-support-bot',
				name: 'Cadre AI Support Chatbot',
				capabilities: [],
				events: [],
				entities: [],
				ixSubsystems: [],
			},
		});

		const tracker = panel.statusTrackerElement;
		assert.strictEqual(tracker.dataset.surfaceId, 'cadre-support-bot');
		assert.ok(tracker.getAttribute('aria-label')?.includes('Cadre AI Support Chatbot'));
		assert.strictEqual(tracker.querySelector('.custom-mode-surface-plan-status-surface-chip'), null);

		panel.clear();
		assert.strictEqual(tracker.dataset.surfaceId, undefined);
		assert.strictEqual(tracker.querySelectorAll('.custom-mode-surface-plan-status-step').length, 0);

		panel.dispose();
	});
});

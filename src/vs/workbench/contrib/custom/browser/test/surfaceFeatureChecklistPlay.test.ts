/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SurfaceFeatureChecklistPanel } from '../surfaceFeatureChecklistPanel.js';
import type { SurfaceFeatureChecklistState } from '../../../../../../custom/goalWorkspace/surfaceFeatureChecklistTypes.js';

suite('surfaceFeatureChecklistPlay', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('invokes play callback from header button', () => {
		let playCount = 0;
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceFeatureChecklistPanel(root, service, () => {
			playCount++;
		});
		try {
			const playButton = root.querySelector('.custom-mode-surface-feature-checklist-play') as HTMLButtonElement;
			assert.ok(playButton);
			playButton.click();
			assert.strictEqual(playCount, 1);
		} finally {
			panel.dispose();
		}
	});

	test('disables play button while refreshing', () => {
		const service = new TestChecklistService();
		const root = document.createElement('div');
		const panel = new SurfaceFeatureChecklistPanel(root, service);
		try {
			service.setState({ ...service.getState(), isRefreshing: true });
			const playButton = root.querySelector('.custom-mode-surface-feature-checklist-play') as HTMLButtonElement;
			assert.strictEqual(playButton.disabled, true);
		} finally {
			panel.dispose();
		}
	});
});

class TestChecklistService {
	declare readonly _serviceBrand: undefined;
	private readonly emitter = new Emitter<SurfaceFeatureChecklistState>();
	readonly onDidChangeState = this.emitter.event;
	private state: SurfaceFeatureChecklistState = {
		items: [],
		actions: [],
		readyCount: 0,
		totalCount: 0,
		isRefreshing: false,
	};

	getState(): SurfaceFeatureChecklistState {
		return this.state;
	}

	async refresh(): Promise<void> {
		return;
	}

	setState(next: SurfaceFeatureChecklistState): void {
		this.state = next;
		this.emitter.fire(this.state);
	}
}

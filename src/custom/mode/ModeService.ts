/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';

export type Mode = 'UI' | 'Process' | 'Code';

export interface IModeService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<Mode>;
	setMode(mode: Mode): void;
	getMode(): Mode;
}

export const IModeService = createDecorator<IModeService>('modeService');

export class ModeService extends Disposable implements IModeService {
	readonly _serviceBrand: undefined;
	private mode: Mode = 'UI';

	private readonly _onDidChange = new Emitter<Mode>();
	readonly onDidChange: Event<Mode> = this._onDidChange.event;

	constructor() {
		super();
		this._register(this._onDidChange);
	}

	setMode(mode: Mode): void {
		if (this.mode === mode) {
			return;
		}

		this.mode = mode;
		this._onDidChange.fire(this.mode);
	}

	getMode(): Mode {
		return this.mode;
	}
}

registerSingleton(IModeService, ModeService, InstantiationType.Delayed);

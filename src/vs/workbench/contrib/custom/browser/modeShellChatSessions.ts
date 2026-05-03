/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../../chat/browser/chat.js';
import type { Mode } from '../../../../../custom/mode/ModeService.js';

const STORAGE_KEY_PREFIX = 'custom.modeShell.chatSession';

function storageKeyForMode(mode: Mode): string {
	switch (mode) {
		case 'UI': return `${STORAGE_KEY_PREFIX}.ui`;
		case 'Process': return `${STORAGE_KEY_PREFIX}.process`;
		case 'Code': return `${STORAGE_KEY_PREFIX}.code`;
	}
}

export class ModeShellChatSessionManager {
	constructor(
		private readonly chatService: IChatService,
		private readonly chatWidgetService: IChatWidgetService,
		private readonly storageService: IStorageService,
	) { }

	getStoredSessionResource(mode: Mode): URI | undefined {
		const raw = this.storageService.get(storageKeyForMode(mode), StorageScope.WORKSPACE);
		if (!raw) {
			return undefined;
		}
		try {
			return URI.parse(raw);
		} catch {
			return undefined;
		}
	}

	private storeSessionResource(mode: Mode, resource: URI): void {
		this.storageService.store(storageKeyForMode(mode), resource.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private createNewSession(mode: Mode): URI {
		// Create local chat session and immediately release the reference.
		const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, { debugOwner: `ModeShellChatSessionManager#createNewSession(${mode})` });
		try {
			const resource = ref.object.sessionResource;
			this.storeSessionResource(mode, resource);
			return resource;
		} finally {
			ref.dispose();
		}
	}

	getOrCreateSessionResource(mode: Mode): URI {
		const stored = this.getStoredSessionResource(mode);
		if (stored) {
			return stored;
		}
		return this.createNewSession(mode);
	}

	async openSessionForMode(mode: Mode, token: CancellationToken = CancellationToken.None): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		// If chat is disabled, do nothing.
		if (!this.chatService.isEnabled(ChatAgentLocation.Chat)) {
			return;
		}

		const resource = this.getOrCreateSessionResource(mode);

		if (token.isCancellationRequested) {
			return;
		}

		await this.chatWidgetService.openSession(resource, ChatViewPaneTarget, { preserveFocus: true, revealIfOpened: true });
	}

	resetSessions(): void {
		for (const mode of ['UI', 'Process', 'Code'] as const satisfies readonly Mode[]) {
			this.storageService.remove(storageKeyForMode(mode), StorageScope.WORKSPACE);
		}
	}
}


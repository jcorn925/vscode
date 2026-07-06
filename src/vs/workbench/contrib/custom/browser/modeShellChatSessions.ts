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
const LEGACY_UI_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.ui`;

type NonUiMode = Exclude<Mode, 'UI'>;

function storageKeyForMode(mode: NonUiMode): string {
	switch (mode) {
		case 'Process': return `${STORAGE_KEY_PREFIX}.process`;
		case 'Code': return `${STORAGE_KEY_PREFIX}.code`;
	}
}

function storageKeyForUISurface(surfaceId: string): string {
	return `${STORAGE_KEY_PREFIX}.ui.${surfaceId}`;
}

function parseStoredSessionResource(raw: string | undefined): URI | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		return URI.parse(raw);
	} catch {
		return undefined;
	}
}

export class ModeShellChatSessionManager {
	constructor(
		private readonly chatService: IChatService,
		private readonly chatWidgetService: IChatWidgetService,
		private readonly storageService: IStorageService,
	) { }

	getStoredSessionResource(mode: NonUiMode): URI | undefined {
		return parseStoredSessionResource(this.storageService.get(storageKeyForMode(mode), StorageScope.WORKSPACE));
	}

	getStoredUISurfaceSessionResource(surfaceId: string): URI | undefined {
		return parseStoredSessionResource(this.storageService.get(storageKeyForUISurface(surfaceId), StorageScope.WORKSPACE));
	}

	private storeSessionResource(mode: NonUiMode, resource: URI): void {
		this.storageService.store(storageKeyForMode(mode), resource.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private storeUISurfaceSessionResource(surfaceId: string, resource: URI): void {
		this.storageService.store(storageKeyForUISurface(surfaceId), resource.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private createNewSession(debugOwner: string, store: (resource: URI) => void): URI {
		const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, { debugOwner });
		try {
			const resource = ref.object.sessionResource;
			store(resource);
			return resource;
		} finally {
			ref.dispose();
		}
	}

	getOrCreateSessionResource(mode: NonUiMode): URI {
		const stored = this.getStoredSessionResource(mode);
		if (stored) {
			return stored;
		}
		return this.createNewSession(`ModeShellChatSessionManager#createNewSession(${mode})`, resource => this.storeSessionResource(mode, resource));
	}

	getOrCreateUISurfaceSessionResource(surfaceId: string): URI {
		const stored = this.getStoredUISurfaceSessionResource(surfaceId);
		if (stored) {
			return stored;
		}

		const legacy = parseStoredSessionResource(this.storageService.get(LEGACY_UI_STORAGE_KEY, StorageScope.WORKSPACE));
		if (legacy) {
			this.storeUISurfaceSessionResource(surfaceId, legacy);
			this.storageService.remove(LEGACY_UI_STORAGE_KEY, StorageScope.WORKSPACE);
			return legacy;
		}

		return this.createNewSession(
			`ModeShellChatSessionManager#createNewUISurfaceSession(${surfaceId})`,
			resource => this.storeUISurfaceSessionResource(surfaceId, resource),
		);
	}

	removeUISurfaceSession(surfaceId: string): void {
		this.storageService.remove(storageKeyForUISurface(surfaceId), StorageScope.WORKSPACE);
	}

	async openSessionForMode(mode: Mode, token: CancellationToken = CancellationToken.None): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		if (!this.chatService.isEnabled(ChatAgentLocation.Chat)) {
			return;
		}

		if (mode === 'UI') {
			return;
		}

		const resource = this.getOrCreateSessionResource(mode);

		if (token.isCancellationRequested) {
			return;
		}

		await this.chatWidgetService.openSession(resource, ChatViewPaneTarget, { preserveFocus: true, revealIfOpened: true });
	}

	resetSessions(uiSurfaceIds?: readonly string[]): void {
		this.storageService.remove(LEGACY_UI_STORAGE_KEY, StorageScope.WORKSPACE);
		for (const surfaceId of uiSurfaceIds ?? []) {
			this.removeUISurfaceSession(surfaceId);
		}
		for (const mode of ['Process', 'Code'] as const satisfies readonly NonUiMode[]) {
			this.storageService.remove(storageKeyForMode(mode), StorageScope.WORKSPACE);
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { session } from 'electron';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { COI, FileAccess, Schemas, CacheControlheaders, DocumentPolicyheaders } from '../../../base/common/network.js';
import { basename, extname, normalize } from '../../../base/common/path.js';
import { isLinux } from '../../../base/common/platform.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { IIPCObjectUrl, IProtocolMainService } from './protocol.js';
import { IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';

type ProtocolCallback = { (result: string | Electron.FilePathWithHeaders | { error: number }): void };

export class ProtocolMainService extends Disposable implements IProtocolMainService {

	declare readonly _serviceBrand: undefined;

	private readonly validRoots = TernarySearchTree.forPaths<boolean>(!isLinux);
	private readonly validExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.otf', '.ttf']); // https://github.com/microsoft/vscode/issues/119384

	constructor(
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Define an initial set of roots we allow loading from
		// - appRoot	: all files installed as part of the app
		// - extensions : all files shipped from extensions
		// - storage    : all files in global and workspace storage (https://github.com/microsoft/vscode/issues/116735)
		this.addValidFileRoot(environmentService.appRoot);
		this.addValidFileRoot(environmentService.extensionsPath);
		this.addValidFileRoot(userDataProfilesService.defaultProfile.globalStorageHome.with({ scheme: Schemas.file }).fsPath);
		this.addValidFileRoot(environmentService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath);
		// #region agent log
		fetch('http://127.0.0.1:7678/ingest/b3c4b434-a44a-428c-a491-ca46a80d6724', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8655ed' }, body: JSON.stringify({ sessionId: '8655ed', runId: 'pre-fix', hypothesisId: 'H1', location: 'protocolMainService.ts:ctor', message: 'ProtocolMainService roots', data: { appRoot: environmentService.appRoot, extensionsPath: environmentService.extensionsPath, workspaceStorageHome: environmentService.workspaceStorageHome?.toString?.(), globalStorageHome: userDataProfilesService.defaultProfile.globalStorageHome?.toString?.(), isBuilt: environmentService.isBuilt }, timestamp: Date.now() }) }).catch(() => { });
		// #endregion agent log

		// Handle protocols
		this.handleProtocols();
	}

	private handleProtocols(): void {
		const { defaultSession } = session;

		// Register vscode-file:// handler
		defaultSession.protocol.registerFileProtocol(Schemas.vscodeFileResource, (request, callback) => this.handleResourceRequest(request, callback));

		// Block any file:// access
		defaultSession.protocol.interceptFileProtocol(Schemas.file, (request, callback) => this.handleFileRequest(request, callback));

		// Cleanup
		this._register(toDisposable(() => {
			defaultSession.protocol.unregisterProtocol(Schemas.vscodeFileResource);
			defaultSession.protocol.uninterceptProtocol(Schemas.file);
		}));
	}

	addValidFileRoot(root: string): IDisposable {

		// Pass to `normalize` because we later also do the
		// same for all paths to check against.
		const normalizedRoot = normalize(root);

		if (!this.validRoots.get(normalizedRoot)) {
			this.validRoots.set(normalizedRoot, true);

			return toDisposable(() => this.validRoots.delete(normalizedRoot));
		}

		return Disposable.None;
	}

	//#region file://

	private handleFileRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback) {
		const uri = URI.parse(request.url);

		this.logService.error(`Refused to load resource ${uri.fsPath} from ${Schemas.file}: protocol (original URL: ${request.url})`);

		return callback({ error: -3 /* ABORTED */ });
	}

	//#endregion

	//#region vscode-file://

	private handleResourceRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback): void {
		const path = this.requestToNormalizedFilePath(request);
		const pathBasename = basename(path);
		// #region agent log
		fetch('http://127.0.0.1:7678/ingest/b3c4b434-a44a-428c-a491-ca46a80d6724', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8655ed' }, body: JSON.stringify({ sessionId: '8655ed', runId: 'pre-fix', hypothesisId: 'H1', location: 'protocolMainService.ts:handleResourceRequest', message: 'vscode-file request', data: { url: request.url, path, pathBasename, appRoot: this.environmentService.appRoot, validRootsHit: Boolean(this.validRoots.findSubstr(path)) }, timestamp: Date.now() }) }).catch(() => { });
		// #endregion agent log

		let headers: Record<string, string> | undefined;
		if (this.environmentService.crossOriginIsolated) {
			if (pathBasename === 'workbench.html' || pathBasename === 'workbench-dev.html') {
				headers = COI.CoopAndCoep;
			} else {
				headers = COI.getHeadersFromQuery(request.url);
			}
		}

		// In OSS, evict resources from the memory cache in the renderer process
		// Refs https://github.com/microsoft/vscode/issues/148541#issuecomment-2670891511
		if (!this.environmentService.isBuilt) {
			headers = {
				...headers,
				...CacheControlheaders
			};
		}

		// Document-policy header is needed for collecting
		// JavaScript callstacks via https://www.electronjs.org/docs/latest/api/web-frame-main#framecollectjavascriptcallstack-experimental
		// until https://github.com/electron/electron/issues/45356 is resolved.
		if (pathBasename === 'workbench.html' || pathBasename === 'workbench-dev.html') {
			headers = {
				...headers,
				...DocumentPolicyheaders
			};
		}

		// first check by validRoots
		if (this.validRoots.findSubstr(path)) {
			return callback({ path, headers });
		}

		// then check by validExtensions
		if (this.validExtensions.has(extname(path).toLowerCase())) {
			return callback({ path, headers });
		}

		// finally block to load the resource
		this.logService.error(`${Schemas.vscodeFileResource}: Refused to load resource ${path} from ${Schemas.vscodeFileResource}: protocol (original URL: ${request.url})`);
		// #region agent log
		fetch('http://127.0.0.1:7678/ingest/b3c4b434-a44a-428c-a491-ca46a80d6724', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8655ed' }, body: JSON.stringify({ sessionId: '8655ed', runId: 'pre-fix', hypothesisId: 'H1', location: 'protocolMainService.ts:handleResourceRequest', message: 'vscode-file refused', data: { url: request.url, path, pathBasename, appRoot: this.environmentService.appRoot }, timestamp: Date.now() }) }).catch(() => { });
		// #endregion agent log

		return callback({ error: -3 /* ABORTED */ });
	}

	private requestToNormalizedFilePath(request: Electron.ProtocolRequest): string {

		// 1.) Use `URI.parse()` util from us to convert the raw
		//     URL into our URI.
		const requestUri = URI.parse(request.url);

		// 2.) Use `FileAccess.asFileUri` to convert back from a
		//     `vscode-file:` URI to a `file:` URI.
		const unnormalizedFileUri = FileAccess.uriToFileUri(requestUri);

		// 3.) Strip anything from the URI that could result in
		//     relative paths (such as "..") by using `normalize`
		return normalize(unnormalizedFileUri.fsPath);
	}

	//#endregion

	//#region IPC Object URLs

	createIPCObjectUrl<T>(): IIPCObjectUrl<T> {
		let obj: T | undefined = undefined;

		// Create unique URI
		const resource = URI.from({
			scheme: 'vscode', // used for all our IPC communication (vscode:<channel>)
			path: generateUuid()
		});

		// Install IPC handler
		const channel = resource.toString();
		const handler = async (): Promise<T | undefined> => obj;
		validatedIpcMain.handle(channel, handler);

		this.logService.trace(`IPC Object URL: Registered new channel ${channel}.`);

		return {
			resource,
			update: updatedObj => obj = updatedObj,
			dispose: () => {
				this.logService.trace(`IPC Object URL: Removed channel ${channel}.`);

				validatedIpcMain.removeHandler(channel);
			}
		};
	}

	//#endregion
}

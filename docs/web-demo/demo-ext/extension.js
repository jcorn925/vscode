/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Babadaba demo file system: a read-only in-memory provider for scheme `gcdemo`,
// seeded from the example goal workspace. The web extension host loads a single
// module, so `scripts/deploy-web-demo.sh` inlines the data map below at stage time.
'use strict';

const vscode = require('vscode');
const data = require('./data.js'); // BUILD->INLINE_DEMO_DATA

const ROOT = '/personal-training';

function decode(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/** Build a directory tree: path -> { type, children?, base64? } */
function buildTree() {
	const tree = new Map();
	tree.set(ROOT, { type: vscode.FileType.Directory, children: new Set() });
	for (const rel of Object.keys(data)) {
		const parts = rel.split('/');
		let dir = ROOT;
		for (let i = 0; i < parts.length - 1; i++) {
			const next = dir + '/' + parts[i];
			if (!tree.has(next)) {
				tree.set(next, { type: vscode.FileType.Directory, children: new Set() });
				tree.get(dir).children.add(parts[i]);
			}
			dir = next;
		}
		const name = parts[parts.length - 1];
		tree.set(dir + '/' + name, { type: vscode.FileType.File, base64: data[rel] });
		tree.get(dir).children.add(name);
	}
	return tree;
}

function activate() {
	const tree = buildTree();
	const mtime = 0;

	const provider = {
		onDidChangeFile: new vscode.EventEmitter().event,
		watch: () => new vscode.Disposable(() => { }),
		stat: uri => {
			const entry = tree.get(uri.path.replace(/\/+$/, '') || '/');
			if (!entry) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
			const size = entry.base64 ? decode(entry.base64).byteLength : 0;
			return { type: entry.type, ctime: mtime, mtime, size, permissions: vscode.FilePermission.Readonly };
		},
		readDirectory: uri => {
			const entry = tree.get(uri.path.replace(/\/+$/, ''));
			if (!entry || entry.type !== vscode.FileType.Directory) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
			return [...entry.children].map(name => [name, tree.get(uri.path.replace(/\/+$/, '') + '/' + name).type]);
		},
		readFile: uri => {
			const entry = tree.get(uri.path);
			if (!entry || entry.type !== vscode.FileType.File) {
				throw vscode.FileSystemError.FileNotFound(uri);
			}
			return decode(entry.base64);
		},
		createDirectory: uri => { throw vscode.FileSystemError.NoPermissions(uri); },
		writeFile: uri => { throw vscode.FileSystemError.NoPermissions(uri); },
		delete: uri => { throw vscode.FileSystemError.NoPermissions(uri); },
		rename: uri => { throw vscode.FileSystemError.NoPermissions(uri); }
	};

	return vscode.workspace.registerFileSystemProvider('gcdemo', provider, { isCaseSensitive: true, isReadonly: true });
}

module.exports = { activate };

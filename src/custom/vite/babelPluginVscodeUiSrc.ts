/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Babel plugin for Vite + `@vitejs/plugin-react`: injects `data-vscode-src` on native JSX tags
 * (`<div/>`, `<button/>`, …) so the embedded UI click overlay can map DOM nodes to workspace files.
 *
 * ```ts
 * import react from '@vitejs/plugin-react';
 * import { vscodeUiSrcBabelPlugin } from './path/to/babelPluginVscodeUiSrc';
 *
 * export default defineConfig({
 *   plugins: [
 *     react({
 *       babel: {
 *         plugins: [[vscodeUiSrcBabelPlugin, { workspaceRoot: import.meta.dirname }]],
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * Attribute value: `relative/path/from/workspaceRoot:line:column` with `/` separators (line/column are 1-based).
 */

export type VscodeUiSrcBabelPluginOptions = {
	/** Directory to make paths relative to (pass `import.meta.dirname` from `vite.config.ts`). */
	workspaceRoot?: string;
	/** DOM attribute name (default `data-vscode-src`). */
	attributeName?: string;
};

function posixRelPath(fromRoot: string, absoluteFile: string): string {
	const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
	const root = norm(fromRoot);
	const file = norm(absoluteFile);
	const prefix = root.endsWith('/') ? root : `${root}/`;
	if (!file.startsWith(prefix)) {
		return file.split('/').pop() ?? file;
	}
	return file.slice(prefix.length);
}

function toPosixPath(p: string): string {
	return p.replace(/\\/g, '/');
}

function isNativeJsxTag(name: string): boolean {
	return /^[a-z]/.test(name);
}

type BabelApi = { types: any; cwd: () => string };

export function vscodeUiSrcBabelPlugin(api: BabelApi, rawOptions?: VscodeUiSrcBabelPluginOptions): { visitor: Record<string, unknown> } {
	const t = api.types;
	const options = rawOptions ?? {};
	const attributeName = options.attributeName ?? 'data-vscode-src';

	return {
		visitor: {
			JSXOpeningElement(path: any) {
				const node = path.node;
				const nameNode = node.name;

				let tagName: string | undefined;
				if (t.isJSXIdentifier(nameNode)) {
					tagName = nameNode.name;
				} else {
					// Namespaced or member expression names — skip
					return;
				}

				if (!tagName || !isNativeJsxTag(tagName)) {
					return;
				}

				for (const attr of node.attributes) {
					if (!t.isJSXAttribute(attr)) {
						continue;
					}
					if (t.isJSXIdentifier(attr.name) && attr.name.name === attributeName) {
						return;
					}
				}

				const file = path.hub.file;
				const filename: string | undefined = file.opts.filename ?? file.opts.sourceFileName;
				if (!filename) {
					return;
				}

				const workspaceRoot = options.workspaceRoot ?? api.cwd();
				const rel = posixRelPath(workspaceRoot, filename);
				const start = node.loc?.start;
				const line = start?.line ?? 1;
				const column = start?.column != null ? start.column + 1 : 1;
				const value = `${toPosixPath(rel)}:${line}:${column}`;

				node.attributes.push(
					t.jsxAttribute(
						t.jsxIdentifier(attributeName),
						t.stringLiteral(value),
					),
				);
			},
		},
	};
}

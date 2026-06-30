/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Default stack for goal-workspace web surfaces so UI drag-to-select can map DOM nodes to source
 * via the bundled Next.js SWC plugin (`data-vscode-src`).
 */
export const CUSTOM_AI_SURFACE_SCAFFOLD_LINES = [
	'Default each new web surface to a Next.js App Router app (TypeScript) unless the user explicitly asks for another stack.',
	'Scaffold under apps/<surface-id>, register path/localUrl/devCommand in workspace.goal.json, and use a unique localhost port per surface.',
	'Enable UI source mapping in next.config.* with experimental.swcPlugins: [[path/to/swc_plugin_vscode_ui_src.wasm, { workspaceRoot: __dirname, attributeName: "data-vscode-src" }]].',
	'When scaffolding, copy swc_plugin_vscode_ui_src.wasm into the app (for example apps/<surface-id>/swc_plugin_vscode_ui_src.wasm) or a shared tools/ folder; the user can also run **Enable component mapping for Next.js (SWC plugin)** to patch an existing next.config.',
	'Use native JSX leaf elements (<div>, <button>, <section>, etc.) for mappable UI so drag-to-select resolves to workspace files.',
] as const;

export const CUSTOM_AI_SURFACE_SCAFFOLD_GUIDANCE = CUSTOM_AI_SURFACE_SCAFFOLD_LINES.join('\n');

/** Short suffix appended to surface-setup chat prompts drafted from the UI tab. */
export const CUSTOM_AI_SURFACE_SETUP_PROMPT_SUFFIX = [
	'Scaffold the app as Next.js (App Router, TypeScript) with SWC data-vscode-src mapping configured in next.config.',
	'Copy swc_plugin_vscode_ui_src.wasm into the surface app and wire experimental.swcPlugins, or tell the user to run **Enable component mapping for Next.js (SWC plugin)** after next.config exists.',
].join(' ');

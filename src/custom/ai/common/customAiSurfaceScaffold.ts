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
	'When the user explicitly asks to create or scaffold a surface, proceed with sensible product defaults and use the available editing tool; do not pause for clarifying questions about audience, first step, or workflow order unless the user requests a choice first.',
	'Scaffold under apps/<surface-id>, register path/localUrl/devCommand in workspace.goal.json, and use a unique localhost port per surface.',
	'Keep the scaffold runnable first. Enable data-vscode-src UI source mapping through experimental.swcPlugins in next.config.* only when a compiled, Next-compatible swc_plugin_vscode_ui_src.wasm is available. For next.config.mjs, derive workspaceRoot with fileURLToPath(import.meta.url) and dirname; do not use CommonJS __dirname in ESM config files.',
	'When scaffolding, do not create an empty placeholder wasm. If no compatible compiled wasm is available, leave SWC mapping disabled and tell the user to run **Enable component mapping for Next.js (SWC plugin)** after the app launches.',
	'Use native JSX leaf elements (<div>, <button>, <section>, etc.) for mappable UI so drag-to-select resolves to workspace files.',
] as const;

export const CUSTOM_AI_SURFACE_SCAFFOLD_GUIDANCE = CUSTOM_AI_SURFACE_SCAFFOLD_LINES.join('\n');

/** Short suffix appended to surface-setup chat prompts drafted from the UI tab. */
export const CUSTOM_AI_SURFACE_SETUP_PROMPT_SUFFIX = [
	'Proceed with sensible defaults and create the files now; do not ask clarifying questions unless the request is impossible without a missing decision.',
	'Use `editFile` for workspace.goal.json and every app file you create or change.',
	'Scaffold the app as Next.js (App Router, TypeScript) and keep it runnable even if SWC data-vscode-src mapping is unavailable.',
	'Only wire experimental.swcPlugins after copying an existing non-empty, Next-compatible swc_plugin_vscode_ui_src.wasm into the surface app; otherwise tell the user to run **Enable component mapping for Next.js (SWC plugin)** after the app launches.',
	'Finish by calling `verifySurfaceBlueprint`; a text-only plan is not a completed scaffold.',
].join(' ');

/** Blueprint-first workflow for surface handoff from the UI tab. */
export const CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_LINES = [
	'Surface creation is blueprint-first: finalize `.agent/surfaces/<surface-id>.blueprint.json` before scaffolding app files.',
	'During blueprint phase, edit only the blueprint JSON and workspace.goal.json surface metadata — do not scaffold apps yet.',
	'During scaffold phase, implement every subsystem in the blueprint, register the surface in workspace.goal.json, then call `verifySurfaceBlueprint`.',
	'During repair phase, fix only the reported gaps and call `verifySurfaceBlueprint` again.',
	'If you cannot call editing or verification tools, say that you are blocked and do not present the surface as implemented.',
	'Do not claim the surface is complete unless `verifySurfaceBlueprint` returns passed.',
] as const;

export const CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_GUIDANCE = CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_LINES.join('\n');

/**
 * Plan Steps hybrid routing: Custom AI orchestrates; Claude Code executes
 * tool-heavy research / generate work. See surfacePlanOrchestration.ts.
 */
export const CUSTOM_AI_PLAN_STEPS_ROLE_LINES = [
	'For Console Plan Steps, you are the goal/surface orchestrator: frame intent, acknowledge locks, choose the next phase, narrate status, and decide verify/repair.',
	'Do not perform tool-heavy repo exploration, shell commands, or generate-phase coding when Claude Code is available for Plan Steps.',
	'Claude Code owns research_survey, research_map, generate phases, and Enable Preview file edits via the Claude terminal and phase-progress.json.',
	'Never edit `.workflow.json` or claim a Plan Step completed — the Console advances Steps only after phase-progress or Preview gates.',
	'When an orchestration brief asks for DISPATCH_CLAUDE, emit that marker after a short summary and stop; do not implement the phase yourself.',
] as const;

export const CUSTOM_AI_PLAN_STEPS_ROLE_GUIDANCE = CUSTOM_AI_PLAN_STEPS_ROLE_LINES.join('\n');

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_GUIDANCE,
	CUSTOM_AI_SURFACE_SCAFFOLD_GUIDANCE,
	CUSTOM_AI_SURFACE_SETUP_PROMPT_SUFFIX,
} from '../ai/common/customAiSurfaceScaffold.js';

export type SurfaceHandoffPhase = 'blueprint' | 'scaffold';

export interface SurfaceHandoffPromptInput {
	readonly headline: string;
	readonly businessName?: string;
	readonly businessDescription?: string;
	readonly hasBrand?: boolean;
	readonly phase: SurfaceHandoffPhase;
}

export interface SurfaceHandoffPromptText {
	readonly headline: string;
	readonly body: string;
}

export function getSurfaceHandoffGuidance(phase: SurfaceHandoffPhase): string {
	return phase === 'blueprint'
		? CUSTOM_AI_SURFACE_BLUEPRINT_WORKFLOW_GUIDANCE
		: [CUSTOM_AI_SURFACE_SCAFFOLD_GUIDANCE, CUSTOM_AI_SURFACE_SETUP_PROMPT_SUFFIX].join('\n\n');
}

export function buildSurfaceHandoffPromptText(input: SurfaceHandoffPromptInput): SurfaceHandoffPromptText {
	const contextLines = [
		input.businessName ? `Business: ${input.businessName}` : undefined,
		input.businessDescription ? `Description: ${input.businessDescription}` : undefined,
		input.hasBrand ? 'Use the brand colors and logos from workspace.goal.json.' : undefined,
	].filter((line): line is string => Boolean(line));

	const guidance = getSurfaceHandoffGuidance(input.phase);
	const body = [input.headline, ...contextLines, guidance].join('\n\n');
	return { headline: input.headline, body };
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../vs/base/common/cancellation.js';
import { IFileService } from '../../../vs/platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../vs/platform/workspace/common/workspace.js';
import {
	CountTokensCallback,
	IPreparedToolInvocation,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolInvocationPreparationContext,
	IToolResult,
	ToolDataSource,
	ToolInvocationPresentation,
	ToolProgress,
} from '../../../vs/workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { IGoalConsoleService } from '../../goalWorkspace/GoalConsoleService.js';
import { SurfaceBlueprintOrchestrator } from '../../goalWorkspace/surfaceBlueprintOrchestrator.js';
import { formatSurfaceBlueprintGapReport, verifySurfaceBlueprint } from '../../goalWorkspace/surfaceBlueprintVerify.js';
import { CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_ID, CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_NAME } from '../common/customAiConstants.js';
import { IIxIntegrationService } from '../../ix/IxIntegrationService.js';
import { discoverIxSubsystemRegions } from '../../goalWorkspace/surfaceBlueprintIxDiscovery.js';

export const CustomAiVerifySurfaceBlueprintToolData: IToolData = {
	id: CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_ID,
	toolReferenceName: CUSTOM_AI_VERIFY_SURFACE_BLUEPRINT_TOOL_NAME,
	displayName: 'Verify surface blueprint',
	modelDescription: [
		'Verify that a goal-workspace surface matches its persisted blueprint and workspace.goal.json registration.',
		'Call after scaffolding a surface to check required subsystem paths, manifest fields, scaffold files, and Ix discovery matches.',
		'Returns a structured gap report. Do not claim the surface is complete unless this tool reports passed.',
		'Arguments:',
		'  surfaceId (string, required) The surface id from workspace.goal.json and .agent/surfaces/<id>.blueprint.json',
	].join('\n'),
	source: ToolDataSource.Internal,
	canBeReferencedInPrompt: true,
	inputSchema: {
		type: 'object',
		properties: {
			surfaceId: { type: 'string', description: 'Goal workspace surface id to verify.' },
		},
		required: ['surfaceId'],
	},
};

export class CustomAiVerifySurfaceBlueprintTool implements IToolImpl {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IGoalConsoleService private readonly goalConsoleService: IGoalConsoleService,
		@IIxIntegrationService private readonly ixIntegrationService: IIxIntegrationService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		return {
			invocationMessage: `Verifying surface blueprint for ${String(context.parameters.surfaceId ?? 'surface')}`,
			pastTenseMessage: 'Verified surface blueprint',
			presentation: ToolInvocationPresentation.Hidden,
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const surfaceId = typeof invocation.parameters.surfaceId === 'string' ? invocation.parameters.surfaceId.trim() : '';
		if (!surfaceId) {
			return { content: [{ kind: 'text', value: 'surfaceId is required.' }] };
		}

		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			return { content: [{ kind: 'text', value: 'Open a workspace folder before verifying a surface blueprint.' }] };
		}

		await this.ixIntegrationService.ensureIxMappedIfEmpty(workspaceFolder);
		const ixSubsystems = await discoverIxSubsystemRegions(this.ixIntegrationService, workspaceFolder);

		const result = await verifySurfaceBlueprint({
			fileService: this.fileService,
			workspaceFolder,
			surfaceId,
			ixSubsystems,
		});

		const surfaceName = this.goalConsoleService.getSurface(surfaceId)?.name ?? surfaceId;
		SurfaceBlueprintOrchestrator.handleVerificationResult(result, surfaceName);

		return {
			content: [{
				kind: 'text',
				value: formatSurfaceBlueprintGapReport(result),
			}],
		};
	}
}

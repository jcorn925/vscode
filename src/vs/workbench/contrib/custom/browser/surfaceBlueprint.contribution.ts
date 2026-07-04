/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConsoleService } from '../../../../../custom/goalWorkspace/ConsoleService.js';
import { formatSurfaceBlueprintGapReport, verifySurfaceBlueprint } from '../../../../../custom/goalWorkspace/surfaceBlueprintVerify.js';
import { discoverIxSubsystemRegions } from '../../../../../custom/goalWorkspace/surfaceBlueprintIxDiscovery.js';
import { SurfaceBlueprintOrchestrator } from '../../../../../custom/goalWorkspace/surfaceBlueprintOrchestrator.js';
import { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.goalWorkspace.verifySurfaceBlueprint',
			title: localize2('custom.goalWorkspace.verifySurfaceBlueprint', 'Verify Goal Workspace Surface Blueprint'),
			f1: true,
			category: localize2('custom.goalWorkspace.category', 'Goal Workspace'),
		});
	}

	override async run(accessor: ServicesAccessor, surfaceId?: string): Promise<void> {
		const goalWorkspace = accessor.get(IConsoleService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const ix = accessor.get(IIxIntegrationService);
		const notificationService = accessor.get(INotificationService);
		const clipboardService = accessor.get(IClipboardService);

		const workspaceFolder = workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.goalWorkspace.verifySurfaceBlueprint.noWorkspace', 'Open a workspace before verifying a surface blueprint.'),
			});
			return;
		}

		const targetSurfaceId = surfaceId ?? goalWorkspace.getSurfaces()[0]?.id;
		if (!targetSurfaceId) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.goalWorkspace.verifySurfaceBlueprint.noSurface', 'No surface id provided and workspace.goal.json has no surfaces.'),
			});
			return;
		}

		await ix.ensureIxMappedIfEmpty(workspaceFolder);
		const ixSubsystems = await discoverIxSubsystemRegions(ix, workspaceFolder);

		const result = await verifySurfaceBlueprint({
			fileService,
			workspaceFolder,
			surfaceId: targetSurfaceId,
			ixSubsystems,
			persistStatus: true,
		});

		const report = formatSurfaceBlueprintGapReport(result);
		await clipboardService.writeText(report);

		const surfaceName = goalWorkspace.getSurface(targetSurfaceId)?.name ?? targetSurfaceId;
		SurfaceBlueprintOrchestrator.handleVerificationResult(result, surfaceName);

		notificationService.notify({
			severity: result.passed ? Severity.Info : Severity.Warning,
			message: result.passed
				? localize('custom.goalWorkspace.verifySurfaceBlueprint.passed', 'Surface blueprint verification passed for {0}. Report copied to clipboard.', surfaceName)
				: localize('custom.goalWorkspace.verifySurfaceBlueprint.failed', 'Surface blueprint verification failed for {0}. Gap report copied to clipboard.', surfaceName),
		});
	}
});

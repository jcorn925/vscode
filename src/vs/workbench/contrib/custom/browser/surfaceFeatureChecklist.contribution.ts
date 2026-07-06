/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import '../../../../../custom/goalWorkspace/surfaceFeatureChecklistService.js';
import '../../../../../custom/goalWorkspace/workflowCatalogService.js';
import '../../../../../custom/goalWorkspace/workflowRunnerService.js';
import { runSurfaceWorkflowFromModeShell } from './modeShell.contribution.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.surfaceFeatureChecklist.play',
			title: localize2('custom.surfaceFeatureChecklist.play', 'Play Surface Workflow'),
			f1: true,
			category: localize2('custom.goalWorkspace.category', 'Goal Workspace'),
		});
	}

	override async run(accessor: ServicesAccessor, surfaceId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const handled = await runSurfaceWorkflowFromModeShell(surfaceId);
		if (!handled) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.surfaceFeatureChecklist.play.noHost', 'Open the Console UI to run workflow autoplay.'),
			});
		}
	}
});

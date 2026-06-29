/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ADD_TRAINING_PACKAGE_WORKFLOW_ID, formatCrossAppWorkflowPlanMarkdown, IGoalWorkspaceService } from '../../../../../custom/goalWorkspace/GoalWorkspaceService.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.goalWorkspace.planAddTrainingPackage',
			title: localize2('custom.goalWorkspace.planAddTrainingPackage', 'Goal Workspace: Plan Add 8-Week Training Package'),
			f1: true,
			category: localize2('custom.goalWorkspace.category', 'Goal Workspace'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const goalWorkspace = accessor.get(IGoalWorkspaceService);
		const notificationService = accessor.get(INotificationService);
		const clipboardService = accessor.get(IClipboardService);

		const state = goalWorkspace.getState();
		if (state.status !== 'loaded') {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.goalWorkspace.planAddTrainingPackage.noWorkspace', 'Open a valid goal workspace with workspace.goal.json before planning a cross-app workflow.')
			});
			return;
		}

		const plan = goalWorkspace.buildCrossAppWorkflowPlan(ADD_TRAINING_PACKAGE_WORKFLOW_ID);
		if (!plan) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.goalWorkspace.planAddTrainingPackage.noPlan', 'Could not build the add-training-package cross-app workflow plan.')
			});
			return;
		}

		await clipboardService.writeText(formatCrossAppWorkflowPlanMarkdown(plan));
		notificationService.notify({
			severity: Severity.Info,
			message: localize(
				'custom.goalWorkspace.planAddTrainingPackage.copied',
				'Copied cross-app workflow plan for {0} affected surfaces.',
				plan.context.affectedSurfaces.length
			)
		});
	}
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { WorkbenchStateContext } from '../../../common/contextkeys.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ADD_TRAINING_PACKAGE_WORKFLOW_ID, formatCrossAppWorkflowPlanMarkdown, IConsoleService } from '../../../../../custom/goalWorkspace/ConsoleService.js';
import { IDefaultProjectService } from '../../../../../custom/devserver/DefaultProjectService.js';

const GOAL_WORKSPACE_CATEGORY = localize2('custom.goalWorkspace.category', 'Goal Workspace');
const DELETE_WORKSPACE_ACTION_ID = 'custom.goalWorkspace.deleteWorkspace';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.goalWorkspace.planAddTrainingPackage',
			title: localize2('custom.goalWorkspace.planAddTrainingPackage', 'Goal Workspace: Plan Add 8-Week Training Package'),
			f1: true,
			category: GOAL_WORKSPACE_CATEGORY,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const goalWorkspace = accessor.get(IConsoleService);
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

registerAction2(class DeleteWorkspaceAction extends Action2 {
	constructor() {
		super({
			id: DELETE_WORKSPACE_ACTION_ID,
			title: localize2('custom.goalWorkspace.deleteWorkspace', 'Delete Workspace'),
			f1: true,
			category: GOAL_WORKSPACE_CATEGORY,
			precondition: WorkbenchStateContext.notEqualsTo('empty'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const dialogService = accessor.get(IDialogService);
		const fileService = accessor.get(IFileService);
		const defaultProjectService = accessor.get(IDefaultProjectService);
		const notificationService = accessor.get(INotificationService);
		const hostService = accessor.get(IHostService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);

		if (workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return;
		}

		const folders = workspaceContextService.getWorkspace().folders.map(folder => folder.uri);
		if (!folders.length) {
			return;
		}

		const primary = folders[0]!;
		const managed = defaultProjectService.isManagedProjectPath(primary);
		const label = folders.length === 1
			? basename(primary)
			: localize('custom.goalWorkspace.deleteWorkspace.multiLabel', '{0} (+{1} more)', basename(primary), folders.length - 1);

		const { confirmed } = await dialogService.confirm({
			type: 'warning',
			message: localize('custom.goalWorkspace.deleteWorkspace.confirm', 'Delete workspace "{0}" and start fresh?', label),
			detail: managed
				? localize(
					'custom.goalWorkspace.deleteWorkspace.detailManaged',
					'Moves the workspace folder to Trash and opens a new empty Console workspace. Dev servers and terminals for this folder should be stopped first if delete fails.',
				)
				: localize(
					'custom.goalWorkspace.deleteWorkspace.detailUnmanaged',
					'This folder is outside the managed Custom projects directory. It will be moved to Trash, then a fresh empty Console workspace will open.',
				),
			primaryButton: localize('custom.goalWorkspace.deleteWorkspace.confirmButton', '&&Delete Workspace'),
		});
		if (!confirmed) {
			return;
		}

		const deleteErrors: string[] = [];
		for (const folder of folders) {
			try {
				await deleteWorkspaceFolder(fileService, folder);
			} catch (error: unknown) {
				deleteErrors.push(`${basename(folder)}: ${String((error as Error)?.message ?? error)}`);
			}
		}

		if (deleteErrors.length === folders.length) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'custom.goalWorkspace.deleteWorkspace.deleteFailed',
					'Could not delete the workspace folder. Stop running terminals/dev servers and try again. {0}',
					deleteErrors.join('; '),
				),
			});
			return;
		}

		try {
			await defaultProjectService.openFallbackWorkspace();
		} catch (error: unknown) {
			// Fall back to an empty window if recreating Console fails.
			await hostService.openWindow({
				forceReuseWindow: true,
				remoteAuthority: environmentService.remoteAuthority,
			});
			notificationService.notify({
				severity: Severity.Error,
				message: localize(
					'custom.goalWorkspace.deleteWorkspace.openFreshFailed',
					'Workspace folder was removed, but opening a fresh workspace failed: {0}',
					String((error as Error)?.message ?? error),
				),
			});
			return;
		}

		if (deleteErrors.length) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'custom.goalWorkspace.deleteWorkspace.partialFailure',
					'Opened a fresh workspace, but some folders could not be deleted: {0}',
					deleteErrors.join('; '),
				),
			});
			return;
		}

		notificationService.notify({
			severity: Severity.Info,
			message: localize('custom.goalWorkspace.deleteWorkspace.done', 'Deleted workspace and opened a fresh Console workspace.'),
		});
	}
});

async function deleteWorkspaceFolder(fileService: IFileService, folder: URI): Promise<void> {
	if (!(await fileService.exists(folder))) {
		return;
	}
	try {
		await fileService.del(folder, { recursive: true, useTrash: true });
	} catch {
		// Trash can fail when files are locked; fall back to permanent delete.
		await fileService.del(folder, { recursive: true, useTrash: false });
	}
}

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '3_workspace',
	command: {
		id: DELETE_WORKSPACE_ACTION_ID,
		title: localize({ key: 'miDeleteWorkspace', comment: ['&& denotes a mnemonic'] }, "De&&lete Workspace"),
	},
	order: 4,
	when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('empty')),
});

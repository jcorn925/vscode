/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER, GOAL_WORKSPACE_IX_OVERLAY_FILE, IGoalWorkspaceService, type GoalSurface } from '../../../../../custom/goalWorkspace/GoalWorkspaceService.js';
import { matchSurfaceToIxSubsystems } from '../../../../../custom/goalWorkspace/surfaceIxMatch.js';
import { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';
import { formatIxSubsystemsDetailedDiscoveryCommand, parseSubsystemFingerprints, runSubsystemsDetailedDiscovery, type SubsystemFingerprint } from './processNotesSubsystemSnapshot.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.ix.restart',
			title: localize2('custom.ix.restart', 'Restart Ix (docker, map, watch)'),
			f1: true,
			category: localize2('custom.ix.category', 'Ix'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const ix = accessor.get(IIxIntegrationService);
		await ix.restart();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.goalWorkspace.refreshIxSurfaceMap',
			title: localize2('custom.goalWorkspace.refreshIxSurfaceMap', 'Refresh Goal Workspace Ix Surface Map'),
			f1: true,
			category: localize2('custom.ix.category', 'Ix'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const ix = accessor.get(IIxIntegrationService);
		const goalWorkspace = accessor.get(IGoalWorkspaceService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);

		const workspaceFolder = workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.goalWorkspace.refreshIxSurfaceMap.noWorkspace', 'Open a workspace before refreshing the goal workspace Ix surface map.')
			});
			return;
		}

		const surfaces = goalWorkspace.getSurfaces();
		if (surfaces.length === 0) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('custom.goalWorkspace.refreshIxSurfaceMap.noSurfaces', 'No goal workspace surfaces are declared in workspace.goal.json.')
			});
			return;
		}

		await ix.ensureIxMappedIfEmpty(workspaceFolder);
		const discovery = await runSubsystemsDetailedDiscovery(ix, workspaceFolder, 90_000, { edgeCap: 8, memberFileCap: 12, limit: 200 });
		if (!discovery.ok) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('custom.goalWorkspace.refreshIxSurfaceMap.failed', 'Ix subsystem discovery failed: {0}', discovery.error)
			});
			return;
		}

		const subsystems = parseSubsystemFingerprints(discovery.value);
		const overlay = buildGoalWorkspaceIxSurfaceOverlay(surfaces, subsystems, formatIxSubsystemsDetailedDiscoveryCommand(discovery.args));
		const agentRoot = joinPath(workspaceFolder, GOAL_WORKSPACE_AGENT_CONTEXT_FOLDER);
		await fileService.createFolder(agentRoot);
		await fileService.writeFile(joinPath(agentRoot, GOAL_WORKSPACE_IX_OVERLAY_FILE), VSBuffer.fromString(`${JSON.stringify(overlay, null, 2)}\n`));
		await goalWorkspace.refresh();

		notificationService.notify({
			severity: Severity.Info,
			message: localize('custom.goalWorkspace.refreshIxSurfaceMap.complete', 'Refreshed Ix surface map for {0} surfaces and {1} subsystems.', surfaces.length, subsystems.length)
		});
	}
});

function buildGoalWorkspaceIxSurfaceOverlay(surfaces: readonly GoalSurface[], subsystems: readonly SubsystemFingerprint[], command: string): unknown {
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		command,
		discoveredSubsystems: subsystems.map(subsystem => ({
			id: subsystem.regionId,
			label: subsystem.name,
			kind: subsystem.labelKind,
			path: subsystem.entryPath,
			fileCount: subsystem.fileCount
		})),
		surfaces: surfaces.map(surface => matchSurfaceToIxSubsystems(surface, subsystems.map(toIxRegion)))
	};
}

function toIxRegion(subsystem: SubsystemFingerprint): { regionId: string; name: string; entryPath?: string; memberFiles?: readonly string[] } {
	return {
		regionId: subsystem.regionId,
		name: subsystem.name,
		entryPath: subsystem.entryPath,
		memberFiles: subsystem.memberFiles,
	};
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.ix.install',
			title: localize2('custom.ix.install', 'Install or resolve Ix CLI'),
			f1: true,
			category: localize2('custom.ix.category', 'Ix'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const ix = accessor.get(IIxIntegrationService);
		await ix.installOrResolve();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.ix.openDocs',
			title: localize2('custom.ix.openDocs', 'Open Ix documentation'),
			f1: true,
			category: localize2('custom.ix.category', 'Ix'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const ix = accessor.get(IIxIntegrationService);
		await ix.openDocs();
	}
});

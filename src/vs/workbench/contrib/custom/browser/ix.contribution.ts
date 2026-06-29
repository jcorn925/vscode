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
		surfaces: surfaces.map(surface => matchSurfaceToIxSubsystems(surface, subsystems))
	};
}

function matchSurfaceToIxSubsystems(surface: GoalSurface, subsystems: readonly SubsystemFingerprint[]): { surfaceId: string; subsystemIds: string[]; subsystemLabels: string[]; matchReason: string } {
	const declaredMatches = new Set([
		...surface.ixSubsystems,
		...(surface.ix?.subsystemIds ?? []),
		...(surface.ix?.subsystemLabels ?? []),
	].map(normalizeIxText).filter(Boolean));
	const surfaceTokens = surfaceMatchTokens(surface);
	const matched: SubsystemFingerprint[] = [];
	let usedDeclared = false;

	for (const subsystem of subsystems) {
		const candidates = [
			subsystem.regionId,
			subsystem.name,
			subsystem.entryPath ?? '',
			...subsystem.memberFiles,
		].map(normalizeIxText).filter(Boolean);

		if (candidates.some(candidate => declaredMatches.has(candidate))) {
			matched.push(subsystem);
			usedDeclared = true;
			continue;
		}

		if (surfaceTokens.length > 0 && candidates.some(candidate => surfaceTokens.some(token => candidate.includes(token)))) {
			matched.push(subsystem);
		}
	}

	return {
		surfaceId: surface.id,
		subsystemIds: uniqueStrings(matched.map(subsystem => subsystem.regionId)),
		subsystemLabels: uniqueStrings(matched.map(subsystem => subsystem.name)),
		matchReason: usedDeclared ? 'declared ix metadata' : 'heuristic name/path match'
	};
}

function surfaceMatchTokens(surface: GoalSurface): readonly string[] {
	return uniqueStrings([
		surface.id,
		surface.name,
		surface.path ?? '',
		...(surface.capabilities ?? []),
		...(surface.entities ?? []),
	].flatMap(value => normalizeIxText(value).split(/[^a-z0-9]+/i))
		.filter(token => token.length >= 3));
}

function normalizeIxText(value: string): string {
	return value.trim().toLowerCase().replace(/\\/g, '/');
}

function uniqueStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const normalized = value.trim();
		const key = normalized.toLowerCase();
		if (!normalized || seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(normalized);
	}
	return result;
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

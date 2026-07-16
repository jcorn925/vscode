/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { findRegenerableNodes, findRetryableLeaf, IAgentTaskTreeService } from '../../../../../custom/agentTaskTree/agentTaskTreeService.js';
import type { AgentTaskNode, AgentTaskTree } from '../../../../../custom/agentTaskTree/agentTaskTreeTypes.js';
import { formatNodeDetail, statusIconQuickPick } from '../../../../../custom/agentTaskTree/surfaceTaskTreeUiHelpers.js';
import '../../../../../custom/agentTaskTree/agentTaskTreeService.js';

const CATEGORY = localize2('custom.agentTaskTree.category', 'Agent');

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.generate',
			title: localize2('custom.agentTaskTree.generate', 'Agent: Generate Task Tree'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const notifications = accessor.get(INotificationService);
		const service = accessor.get(IAgentTaskTreeService);
		const prompt = await quickInput.input({
			title: localize('custom.agentTaskTree.generate.title', 'Generate Task Tree'),
			prompt: localize('custom.agentTaskTree.generate.prompt', 'Describe the feature to decompose into a persistent task tree.'),
			placeHolder: localize('custom.agentTaskTree.generate.placeholder', 'Build a persistent task-tree agent loop'),
		});
		if (!prompt?.trim()) {
			return;
		}
		try {
			const tree = await service.generateTaskTree(prompt);
			notifications.notify({
				severity: Severity.Info,
				message: localize('custom.agentTaskTree.generate.created', 'Generated task tree {0}.', tree.id),
			});
			await showTaskTreeQuickPick(quickInput, tree);
		} catch (error) {
			notifications.notify({
				severity: Severity.Error,
				message: localize('custom.agentTaskTree.generate.failed', 'Failed to generate task tree: {0}', error instanceof Error ? error.message : String(error)),
			});
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.runAll',
			title: localize2('custom.agentTaskTree.runAll', 'Agent: Run All Remaining Tasks'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		if (!tree) {
			notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.runAll.none', 'No active or paused task tree was found.') });
			return;
		}
		const result = await service.runAllTasks(tree.id);
		notifications.notify({
			severity: result.status === 'complete' ? Severity.Info : Severity.Warning,
			message: localize('custom.agentTaskTree.runAll.result', 'Task-tree run {0}: {1}.', result.tree.id, result.status),
		});
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.resume',
			title: localize2('custom.agentTaskTree.resume', 'Agent: Resume Task Tree'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		if (!tree) {
			notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.resume.none', 'No active or paused task tree was found.') });
			return;
		}
		await service.resumeTaskTree(tree.id);
		notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.resume.done', 'Resumed task tree {0}.', tree.id) });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.continueNext',
			title: localize2('custom.agentTaskTree.continueNext', 'Agent: Continue Next Task'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		if (!tree) {
			notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.continue.none', 'No active or paused task tree was found.') });
			return;
		}
		const result = await service.continueNextTask(tree.id);
		notifications.notify({
			severity: result.status === 'completed' || result.status === 'complete' ? Severity.Info : Severity.Warning,
			message: localize('custom.agentTaskTree.continue.result', 'Task-tree run {0}: {1}.', result.tree.id, result.status),
		});
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.pause',
			title: localize2('custom.agentTaskTree.pause', 'Agent: Pause Current Task'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		if (tree) {
			await service.pauseTaskTree(tree.id);
		}
		notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.pause.done', 'Paused current task tree.') });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.retryCurrent',
			title: localize2('custom.agentTaskTree.retryCurrent', 'Agent: Retry Current Task'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		const node = tree ? findRetryableLeaf(tree) : undefined;
		if (tree && node) {
			await service.retryTask(tree.id, node.id);
		}
		notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.retry.done', 'Retried current task if one was selected.') });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.skipCurrent',
			title: localize2('custom.agentTaskTree.skipCurrent', 'Agent: Skip Current Task'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		const node = tree ? findRetryableLeaf(tree) : undefined;
		if (tree && node) {
			await service.skipTask(tree.id, node.id, localize('custom.agentTaskTree.skip.note', 'Skipped from command palette.'));
		}
		notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.skip.done', 'Skipped current task if one was selected.') });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.regenerateBranch',
			title: localize2('custom.agentTaskTree.regenerateBranch', 'Agent: Regenerate Branch'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const quickInput = accessor.get(IQuickInputService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		if (!tree) {
			notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.regenerate.none', 'No active or paused task tree was found.') });
			return;
		}
		const branches = findRegenerableNodes(tree);
		if (!branches.length) {
			notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.regenerate.noBranches', 'No branch nodes were found to regenerate.') });
			return;
		}
		type BranchPick = IQuickPickItem & { node: AgentTaskNode };
		const picked = await quickInput.pick<BranchPick>(
			branches.map(node => ({
				label: node.title,
				description: node.type,
				detail: node.description,
				node,
			})),
			{
				title: localize('custom.agentTaskTree.regenerate.title', 'Regenerate Branch'),
				placeHolder: localize('custom.agentTaskTree.regenerate.placeholder', 'Select a root or branch to reset for regeneration'),
			},
		);
		if (!picked) {
			return;
		}
		await service.regenerateBranch(tree.id, picked.node.id);
		notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.regenerate.done', 'Marked branch {0} for regeneration.', picked.node.title) });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.agentTaskTree.show',
			title: localize2('custom.agentTaskTree.show', 'Agent: Show Task Tree'),
			category: CATEGORY,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(IAgentTaskTreeService);
		const quickInput = accessor.get(IQuickInputService);
		const notifications = accessor.get(INotificationService);
		const tree = await service.loadLatestResumableTaskTree();
		if (tree) {
			await showTaskTreeQuickPick(quickInput, tree);
		} else {
			notifications.notify({ severity: Severity.Info, message: localize('custom.agentTaskTree.show.none', 'No active or paused task tree was found.') });
		}
	}
});

async function showTaskTreeQuickPick(quickInput: IQuickInputService, tree: AgentTaskTree): Promise<void> {
	await quickInput.pick(renderTaskTreeItems(tree), {
		title: localize('custom.agentTaskTree.pick.title', 'Task Tree: {0}', tree.id),
		placeHolder: localize('custom.agentTaskTree.pick.placeholder', '{0} — {1}', tree.status, tree.prompt),
	});
}

function renderTaskTreeItems(tree: AgentTaskTree): IQuickPickItem[] {
	const items: IQuickPickItem[] = [{
		label: `$(list-tree) ${tree.prompt}`,
		description: tree.status,
		detail: localize('custom.agentTaskTree.pick.summary', 'Current: {0}  Last completed: {1}', tree.cursor?.currentNodeId ?? '-', tree.cursor?.lastCompletedNodeId ?? '-'),
	}];
	for (const root of tree.roots) {
		pushNode(items, root, 0);
	}
	return items;
}

function pushNode(items: IQuickPickItem[], node: AgentTaskNode, depth: number): void {
	const prefix = depth === 0 ? '' : `${'  '.repeat(depth)}-> `;
	items.push({
		label: `${prefix}${statusIconQuickPick(node.status)} ${node.title}`,
		description: node.status,
		detail: formatNodeDetail(node),
	});
	for (const child of node.children ?? []) {
		pushNode(items, child, depth + 1);
	}
}


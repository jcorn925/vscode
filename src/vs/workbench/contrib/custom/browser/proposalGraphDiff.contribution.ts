/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ProposalGraphDiffEditor } from './proposalGraphDiff/proposalGraphDiffEditor.js';
import { ProposalGraphDiffInput } from './proposalGraphDiff/proposalGraphDiffInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ProposalGraphDiffEditor,
		ProposalGraphDiffEditor.ID,
		localize('proposalGraphDiffEditor', 'Proposal Graph Diff'),
	),
	[new SyncDescriptor(ProposalGraphDiffInput)],
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'custom.ix.openProposalGraphDiff',
			title: localize2('custom.ix.openProposalGraphDiff', 'Open Proposal Graph Diff'),
			f1: true,
			category: localize2('custom.ix.category', 'Ix'),
		});
	}

	override async run(accessor: ServicesAccessor, proposalUriArg?: URI, snapshotUriArg?: URI): Promise<void> {
		const workspaceContext = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const quickInput = accessor.get(IQuickInputService);
		const editorService = accessor.get(IEditorService);
		const notification = accessor.get(INotificationService);

		const folder = workspaceContext.getWorkspace().folders[0]?.uri;
		if (!folder) {
			notification.notify({
				severity: Severity.Warning,
				message: localize('custom.ix.openProposalGraphDiff.noWorkspace', 'Open a workspace before opening the Proposal Graph Diff.'),
			});
			return;
		}

		const snapshotUri = snapshotUriArg ?? joinPath(folder, '.ix-scaffold', 'graph-compare', 'latest-proposal.json');
		if (!(await fileService.exists(snapshotUri))) {
			notification.notify({
				severity: Severity.Warning,
				message: localize(
					'custom.ix.openProposalGraphDiff.noSnapshot',
					'No proposal snapshot at {0}. Run the ix-graph compare_proposal MCP tool (or CLI --proposal) first.',
					snapshotUri.fsPath,
				),
			});
			return;
		}

		let proposalUri = proposalUriArg;
		if (!proposalUri) {
			const picked = await pickProposalFile(folder, fileService, quickInput);
			if (!picked) {
				notification.notify({
					severity: Severity.Warning,
					message: localize(
						'custom.ix.openProposalGraphDiff.noProposal',
						'No *.graph-proposal.json under .agent/task-trees. Pass a proposal URI to the command, or create one for this plan.',
					),
				});
				return;
			}
			proposalUri = picked;
		}

		await editorService.openEditor(new ProposalGraphDiffInput(proposalUri, snapshotUri), { pinned: true });
	}
});

async function pickProposalFile(
	folder: URI,
	fileService: IFileService,
	quickInput: IQuickInputService,
): Promise<URI | undefined> {
	const taskTrees = joinPath(folder, '.agent', 'task-trees');
	const items: { label: string; description?: string; uri: URI }[] = [];
	if (await fileService.exists(taskTrees)) {
		const children = await fileService.resolve(taskTrees);
		for (const child of children.children ?? []) {
			if (child.name.endsWith('.graph-proposal.json')) {
				items.push({
					label: child.name,
					description: '.agent/task-trees',
					uri: child.resource,
				});
			}
		}
	}
	if (!items.length) {
		return undefined;
	}
	if (items.length === 1) {
		return items[0].uri;
	}
	const picked = await quickInput.pick(items, {
		placeHolder: localize('custom.ix.openProposalGraphDiff.chooseProposal', 'Choose a graph proposal'),
	});
	return picked?.uri;
}

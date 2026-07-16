/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';

const ProposalGraphDiffIcon = registerIcon(
	'proposal-graph-diff-editor-label-icon',
	Codicon.graph,
	localize('proposalGraphDiffEditorLabelIcon', 'Icon of the Proposal Graph Diff editor label.'),
);

export class ProposalGraphDiffInput extends EditorInput {
	static readonly ID = 'workbench.input.proposalGraphDiff';

	override get typeId(): string {
		return ProposalGraphDiffInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	readonly resource = URI.from({ scheme: 'proposal-graph-diff', path: 'default' });

	constructor(
		readonly proposalUri: URI | undefined,
		readonly snapshotUri: URI | undefined,
	) {
		super();
	}

	override getName(): string {
		return localize('proposalGraphDiffInputName', 'Proposal Graph Diff');
	}

	override getIcon(): ThemeIcon {
		return ProposalGraphDiffIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof ProposalGraphDiffInput;
	}
}

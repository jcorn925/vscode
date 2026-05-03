/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';

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

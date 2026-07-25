/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildGoalOverviewModel, splitGoalDescriptionParagraphs } from '../goalOverviewModel.js';
import type { WorkspaceSurface } from '../../../../../../custom/goalWorkspace/ConsoleService.js';

function surface(overrides: Partial<WorkspaceSurface> & { id: string; name: string }): WorkspaceSurface {
	return { capabilities: [], events: [], entities: [], ixSubsystems: [], ...overrides };
}

suite('goalOverviewModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('splits description paragraphs on blank lines and trims', () => {
		assert.deepStrictEqual(
			splitGoalDescriptionParagraphs('First para.\n\n Second para. \n\n\nThird.'),
			['First para.', 'Second para.', 'Third.'],
		);
		assert.deepStrictEqual(splitGoalDescriptionParagraphs(undefined), []);
		assert.deepStrictEqual(splitGoalDescriptionParagraphs('  \n\n  '), []);
	});

	test('builds lede, details, facts and ctas from goal + surfaces', () => {
		const model = buildGoalOverviewModel(
			{ id: 'g', name: 'Cadre AI', description: 'Lede paragraph.\n\nHow it works: details.\n\nStack: more details.', northStarMetric: 'inquiries_resolved' },
			[
				surface({ id: 'bot', name: 'Support Bot', productionUrl: 'https://bot.example', localUrl: 'http://localhost:3100' }),
				surface({ id: 'admin', name: 'Admin Console' }),
			],
		);
		assert.deepStrictEqual(
			{
				title: model.title,
				lede: model.lede,
				detailParagraphs: model.detailParagraphs,
				facts: model.facts,
				ctas: model.ctas,
			},
			{
				title: 'Goal: Cadre AI',
				lede: 'Lede paragraph.',
				detailParagraphs: ['How it works: details.', 'Stack: more details.'],
				facts: [
					{ label: 'North-star metric', value: 'inquiries_resolved' },
					{ label: '2 surface(s)', value: 'Support Bot, Admin Console' },
					{ label: 'Deployed', value: '1/2' },
				],
				ctas: [
					{ kind: 'openDeployed', label: 'Open Deployed', surfaceId: 'bot', url: 'https://bot.example' },
					{ kind: 'openPreview', label: 'Open Preview', surfaceId: 'bot', url: 'http://localhost:3100' },
					{ kind: 'showConsole', label: 'Browse Surfaces' },
				],
			},
		);
	});

	test('single-paragraph description yields no details; no urls yield no open ctas', () => {
		const model = buildGoalOverviewModel(
			{ id: 'g', name: 'Solo', description: 'Only paragraph.' },
			[surface({ id: 'a', name: 'A' })],
		);
		assert.deepStrictEqual(
			{ lede: model.lede, detailParagraphs: model.detailParagraphs, ctaKinds: model.ctas.map(cta => cta.kind), factLabels: model.facts.map(fact => fact.label) },
			{ lede: 'Only paragraph.', detailParagraphs: [], ctaKinds: ['showConsole'], factLabels: ['1 surface(s)'] },
		);
	});

	test('missing goal and surfaces fall back to bare title', () => {
		const model = buildGoalOverviewModel(undefined, []);
		assert.deepStrictEqual(
			{ title: model.title, lede: model.lede, facts: model.facts, ctas: model.ctas },
			{ title: 'Goal Workspace', lede: undefined, facts: [], ctas: [] },
		);
	});
});

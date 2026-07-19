/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	parseSurfaceReferenceCandidates,
	referenceRepoLabel,
	selectedReferenceRepos,
	serializeSurfaceReferenceCandidates,
	surfaceReferenceCandidatesResource,
	withCandidatesStatus,
	withRepoSelection,
	resolveReferenceRepoReason,
	extractPlanResearchNoteForRepo,
} from '../../../../../../custom/goalWorkspace/surfaceReferenceCandidates.js';

suite('surfaceReferenceCandidates', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('resource path is .agent/surfaces/<id>.reference-candidates.json', () => {
		const uri = surfaceReferenceCandidatesResource(URI.file('/tmp/ws'), 'cadre-bot');
		assert.ok(uri.path.endsWith('/.agent/surfaces/cadre-bot.reference-candidates.json'));
	});

	test('parse defaults selected from suggested when selected omitted', () => {
		const doc = parseSurfaceReferenceCandidates(JSON.stringify({
			status: 'awaiting_selection',
			surfaceId: 'cadre-bot',
			repos: [
				{ owner: 'vercel', repo: 'chatbot', suggested: true },
				{ owner: 'langchain-ai', repo: 'chat-langchain', suggested: false },
			],
		}));
		assert.ok(doc);
		assert.strictEqual(doc!.repos[0]!.selected, true);
		assert.strictEqual(doc!.repos[1]!.selected, false);
		assert.strictEqual(referenceRepoLabel(doc!.repos[0]!), 'vercel/chatbot');
		assert.deepStrictEqual(selectedReferenceRepos(doc!).map(r => referenceRepoLabel(r)), ['vercel/chatbot']);
	});

	test('parse keeps reason and falls back from relevance/why aliases', () => {
		const doc = parseSurfaceReferenceCandidates(JSON.stringify({
			status: 'awaiting_selection',
			surfaceId: 'cadre-bot',
			repos: [
				{ owner: 'vercel', repo: 'chatbot', suggested: true, reason: 'Matches plan chat UX research.' },
				{ owner: 'langchain-ai', repo: 'chat-langchain', suggested: false, relevance: 'Tooling patterns from Research.' },
				{ owner: 'open-webui', repo: 'open-webui', suggested: false, why: 'Admin console prior from Research.' },
			],
		}));
		assert.ok(doc);
		assert.strictEqual(doc!.repos[0]!.reason, 'Matches plan chat UX research.');
		assert.strictEqual(doc!.repos[1]!.reason, 'Tooling patterns from Research.');
		assert.strictEqual(doc!.repos[2]!.reason, 'Admin console prior from Research.');
	});

	test('resolveReferenceRepoReason prefers reason then plan Research citation', () => {
		const plan = [
			'# Cadre Bot — Plan',
			'## Research',
			'- vercel/chatbot for streaming chat UX and assistant layout.',
			'- open-webui/open-webui for multi-model admin shell.',
			'## Architecture',
			'- ignore this',
		].join('\n');
		assert.strictEqual(
			resolveReferenceRepoReason({ owner: 'vercel', repo: 'chatbot', reason: 'Structured reason wins.' }, plan),
			'Structured reason wins.',
		);
		assert.strictEqual(
			resolveReferenceRepoReason({ owner: 'vercel', repo: 'chatbot' }, plan),
			'vercel/chatbot for streaming chat UX and assistant layout.',
		);
		assert.strictEqual(
			extractPlanResearchNoteForRepo(plan, 'open-webui', 'open-webui'),
			'open-webui/open-webui for multi-model admin shell.',
		);
	});

	test('toggle selection and confirm status round-trip', () => {
		const initial = parseSurfaceReferenceCandidates(JSON.stringify({
			status: 'awaiting_selection',
			surfaceId: 'cadre-bot',
			repos: [
				{ owner: 'vercel', repo: 'chatbot', suggested: true, selected: true },
				{ owner: 'langchain-ai', repo: 'chat-langchain', suggested: true, selected: true },
			],
		}))!;
		const toggled = withRepoSelection(initial, 'langchain-ai', 'chat-langchain', false);
		const confirmed = withCandidatesStatus(toggled, 'confirmed');
		const raw = serializeSurfaceReferenceCandidates(confirmed);
		const again = parseSurfaceReferenceCandidates(raw)!;
		assert.strictEqual(again.status, 'confirmed');
		assert.strictEqual(again.repos[0]!.selected, true);
		assert.strictEqual(again.repos[1]!.selected, false);
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	buildGhPublishWorkspaceCommand,
	buildGitPushOriginCommand,
	defaultGitHubRepositoryName,
	githubBrowseUrlFromRemote,
	hasGitHubOriginRemote,
	isGithubPublishCommandMissingError,
	originRemoteUrlFromGitConfig,
	sanitizeGitHubRepositoryName,
} from '../publishWorkspaceToGitHub.js';

suite('publishWorkspaceToGitHub', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sanitizeGitHubRepositoryName strips unsafe characters', () => {
		assert.strictEqual(sanitizeGitHubRepositoryName('  My App!! '), 'My-App');
		assert.strictEqual(sanitizeGitHubRepositoryName('console_v1.0'), 'console_v1.0');
	});

	test('defaultGitHubRepositoryName prefers workspace goal name over folder basename', () => {
		assert.strictEqual(
			defaultGitHubRepositoryName({
				workspaceName: 'Cadre AI Support Bot',
				folderBasename: 'Console',
			}),
			'Cadre-AI-Support-Bot',
		);
		assert.strictEqual(
			defaultGitHubRepositoryName({
				workspaceName: '  ',
				folderBasename: 'cadre-support-bot',
			}),
			'cadre-support-bot',
		);
		assert.strictEqual(defaultGitHubRepositoryName({}), 'workspace');
	});

	test('buildGhPublishWorkspaceCommand uses private/public flags', () => {
		assert.ok(buildGhPublishWorkspaceCommand('Console', 'private').includes('--private'));
		assert.ok(buildGhPublishWorkspaceCommand('Console', 'public').includes('--public'));
		assert.ok(buildGhPublishWorkspaceCommand('Console', 'private').includes('gh repo create Console'));
		assert.throws(() => buildGhPublishWorkspaceCommand('   ', 'private'));
	});

	test('buildGitPushOriginCommand pushes to existing origin without creating', () => {
		const command = buildGitPushOriginCommand();
		assert.ok(command.includes('git push -u origin HEAD'));
		assert.ok(!command.includes('gh repo create'));
	});

	test('hasGitHubOriginRemote detects GitHub origin only', () => {
		assert.strictEqual(hasGitHubOriginRemote([
			'[remote "origin"]',
			'\turl = git@github.com:acme/console.git',
		].join('\n')), true);
		assert.strictEqual(hasGitHubOriginRemote([
			'[remote "origin"]',
			'\turl = https://gitlab.com/acme/console.git',
		].join('\n')), false);
		assert.strictEqual(hasGitHubOriginRemote(undefined), false);
		assert.strictEqual(hasGitHubOriginRemote(''), false);
	});

	test('isGithubPublishCommandMissingError detects missing command', () => {
		assert.strictEqual(isGithubPublishCommandMissingError(new Error("command 'github.publish' not found")), true);
		assert.strictEqual(isGithubPublishCommandMissingError(new Error('auth failed')), false);
	});

	test('originRemoteUrlFromGitConfig reads origin url', () => {
		const config = [
			'[core]',
			'\trepositoryformatversion = 0',
			'[remote "origin"]',
			'\turl = git@github.com:acme/console.git',
			'\tfetch = +refs/heads/*:refs/remotes/origin/*',
			'[branch "main"]',
			'\tremote = origin',
		].join('\n');
		assert.strictEqual(originRemoteUrlFromGitConfig(config), 'git@github.com:acme/console.git');
		assert.strictEqual(originRemoteUrlFromGitConfig('[remote "upstream"]\n\turl = https://example.com/x.git\n'), undefined);
	});

	test('githubBrowseUrlFromRemote normalizes common remotes', () => {
		assert.strictEqual(githubBrowseUrlFromRemote('git@github.com:acme/console.git'), 'https://github.com/acme/console');
		assert.strictEqual(githubBrowseUrlFromRemote('https://github.com/acme/console.git'), 'https://github.com/acme/console');
		assert.strictEqual(githubBrowseUrlFromRemote('ssh://git@github.com/acme/console.git'), 'https://github.com/acme/console');
		assert.strictEqual(githubBrowseUrlFromRemote('https://gitlab.com/acme/console.git'), undefined);
	});
});

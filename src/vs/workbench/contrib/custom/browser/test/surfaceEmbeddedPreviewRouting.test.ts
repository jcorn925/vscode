/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	isLiveSurfaceRailSection,
	resolveLiveSurfaceEmbeddedUrl,
	shouldAssignEmbeddedUrlForRailSection,
} from '../surfaceEmbeddedPreviewRouting.js';

suite('surfaceEmbeddedPreviewRouting', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const shareOrigin = (a: string, b: string) => {
		try {
			return new URL(a).origin === new URL(b).origin;
		} catch {
			return a === b;
		}
	};

	test('preview, deployed, and database are live rail sections', () => {
		assert.strictEqual(isLiveSurfaceRailSection('preview'), true);
		assert.strictEqual(isLiveSurfaceRailSection('deployed'), true);
		assert.strictEqual(isLiveSurfaceRailSection('database'), true);
		assert.strictEqual(isLiveSurfaceRailSection('proposed'), false);
		assert.strictEqual(isLiveSurfaceRailSection('schema'), false);
		assert.strictEqual(isLiveSurfaceRailSection('plan'), false);
		assert.strictEqual(isLiveSurfaceRailSection(undefined), false);
	});

	test('resolveLiveSurfaceEmbeddedUrl picks the URL for each live section', () => {
		assert.strictEqual(resolveLiveSurfaceEmbeddedUrl({
			sectionId: 'deployed',
			localUrl: 'http://localhost:3100',
			productionUrl: 'https://cadre-support-bot-jade.vercel.app',
			databaseUrl: 'http://127.0.0.1:54323',
		}), 'https://cadre-support-bot-jade.vercel.app');
		assert.strictEqual(resolveLiveSurfaceEmbeddedUrl({
			sectionId: 'preview',
			localUrl: 'http://localhost:3100',
			productionUrl: 'https://cadre-support-bot-jade.vercel.app',
			databaseUrl: 'http://127.0.0.1:54323',
		}), 'http://localhost:3100');
		assert.strictEqual(resolveLiveSurfaceEmbeddedUrl({
			sectionId: 'database',
			localUrl: 'http://localhost:3100',
			productionUrl: 'https://cadre-support-bot-jade.vercel.app',
			databaseUrl: 'http://127.0.0.1:54323',
		}), 'http://127.0.0.1:54323');
		assert.strictEqual(resolveLiveSurfaceEmbeddedUrl({
			sectionId: 'database',
			localUrl: 'http://localhost:3100',
			productionUrl: 'https://cadre-support-bot-jade.vercel.app',
		}), undefined);
		assert.strictEqual(resolveLiveSurfaceEmbeddedUrl({
			sectionId: 'proposed',
			localUrl: 'http://localhost:3100',
			productionUrl: 'https://cadre-support-bot-jade.vercel.app',
			databaseUrl: 'http://127.0.0.1:54323',
		}), undefined);
	});

	test('shouldAssignEmbeddedUrlForRailSection reuses webview for non-live cards', () => {
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'proposed',
			targetUrl: 'http://localhost:3100',
			currentUrl: 'https://cadre-support-bot-jade.vercel.app',
			urlsShareOrigin: shareOrigin,
		}), false);
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'plan',
			targetUrl: undefined,
			currentUrl: 'http://localhost:3100',
			urlsShareOrigin: shareOrigin,
		}), false);
	});

	test('shouldAssignEmbeddedUrlForRailSection navigates only when live origin changes', () => {
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'preview',
			targetUrl: 'http://localhost:3100/',
			currentUrl: 'http://localhost:3100/chat',
			urlsShareOrigin: shareOrigin,
		}), false);
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'deployed',
			targetUrl: 'https://cadre-support-bot-jade.vercel.app',
			currentUrl: 'http://localhost:3100',
			urlsShareOrigin: shareOrigin,
		}), true);
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'preview',
			targetUrl: 'http://localhost:3100',
			currentUrl: undefined,
			urlsShareOrigin: shareOrigin,
		}), true);
	});

	test('shouldAssignEmbeddedUrlForRailSection skips Preview while unreachable', () => {
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'preview',
			targetUrl: 'http://localhost:3102',
			currentUrl: undefined,
			urlsShareOrigin: shareOrigin,
			previewReachable: false,
		}), false);
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'preview',
			targetUrl: 'http://localhost:3102',
			currentUrl: undefined,
			urlsShareOrigin: shareOrigin,
			previewReachable: true,
		}), true);
		// Deployed / Database are unaffected by previewReachable.
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'deployed',
			targetUrl: 'https://cadre-eval-harness.vercel.app',
			currentUrl: undefined,
			urlsShareOrigin: shareOrigin,
			previewReachable: false,
		}), true);
		assert.strictEqual(shouldAssignEmbeddedUrlForRailSection({
			sectionId: 'database',
			targetUrl: 'http://127.0.0.1:54323',
			currentUrl: undefined,
			urlsShareOrigin: shareOrigin,
			previewReachable: false,
		}), true);
	});
});

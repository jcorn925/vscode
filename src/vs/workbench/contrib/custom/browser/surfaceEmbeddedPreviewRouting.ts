/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Preview / Deployed rail cards own the embedded Console webview URL.
 * Other section cards (Proposed, Plan, Graph, …) only change the plan column —
 * keep the webview on its last URL so flipping rail cards does not reload Next.
 */
export function isLiveSurfaceRailSection(sectionId: string | undefined): boolean {
	return sectionId === 'preview' || sectionId === 'deployed';
}

/** Target URL for the focused live rail card (Deployed → production, Preview → local). */
export function resolveLiveSurfaceEmbeddedUrl(input: {
	readonly sectionId: string | undefined;
	readonly localUrl?: string;
	readonly productionUrl?: string;
}): string | undefined {
	if (input.sectionId === 'deployed') {
		return input.productionUrl?.trim() || undefined;
	}
	if (input.sectionId === 'preview') {
		return input.localUrl?.trim() || undefined;
	}
	return undefined;
}

/**
 * Whether focusing a rail section should assign `src` on the embedded webview.
 * Non-live sections never navigate — reuse whatever is already loaded.
 * Preview with `previewReachable === false` must not navigate either — probing via
 * HTTP avoids ERR_CONNECTION_REFUSED after port-free / before `npm run dev` is back.
 */
export function shouldAssignEmbeddedUrlForRailSection(input: {
	readonly sectionId: string | undefined;
	readonly targetUrl: string | undefined;
	readonly currentUrl: string | undefined;
	readonly urlsShareOrigin: (a: string, b: string) => boolean;
	readonly previewReachable?: boolean;
}): boolean {
	if (!isLiveSurfaceRailSection(input.sectionId)) {
		return false;
	}
	if (input.sectionId === 'preview' && input.previewReachable === false) {
		return false;
	}
	const target = input.targetUrl?.trim();
	if (!target) {
		return false;
	}
	const current = input.currentUrl?.trim();
	if (!current || current === 'about:blank' || current.startsWith('chrome-error://')) {
		return true;
	}
	return !input.urlsShareOrigin(current, target);
}

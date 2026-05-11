/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from '../../../../base/common/uri.js';
import type { IIxIntegrationService } from '../../../../../custom/ix/IxIntegrationService.js';

type IxJsonQueryResult = Awaited<ReturnType<IIxIntegrationService['runJsonQuery']>>;

/**
 * Ix may return "Ambiguous target" when a label exists as both a module and a system (etc.).
 * @see user flow: `ix subsystems Scrape --pick 2 --explain` when pick 1 = module, pick 2 = system
 */
export function isAmbiguousSubsystemIxFailure(error: string, raw: string): boolean {
	const blob = `${error ?? ''}\n${raw ?? ''}`;
	return /ambiguous target|multiple architecture regions matched/i.test(blob);
}

/**
 * 1-based `--pick` order: prefer the pick that matches `label_kind` from `ix subsystems` JSON.
 * Heuristic for duplicate names: first listed is often the finer-grained (module) match, second the system.
 */
export function pickOrderForSubsystemLabelKind(labelKind: string | undefined): readonly number[] {
	const k = (labelKind ?? '').toLowerCase();
	if (k === 'system') {
		return [2, 1, 3, 4, 5, 6];
	}
	if (k === 'module') {
		return [1, 2, 3, 4, 5, 6];
	}
	if (k === 'subsystem') {
		return [1, 2, 3, 4, 5, 6];
	}
	return [1, 2, 3, 4, 5, 6];
}

/**
 * Runs `ix subsystems … --explain --format json`, retrying with `ix subsystems <label> --pick <n> --explain`
 * when Ix reports an ambiguous target (same label at module vs system scope).
 */
export async function runIxSubsystemExplainWithDisambiguation(
	ix: IIxIntegrationService,
	cwd: URI,
	label: string,
	labelKind: string | undefined,
	timeoutMs: number,
): Promise<IxJsonQueryResult> {
	const trimmed = label.trim();
	if (!trimmed.length) {
		return { ok: false, error: 'Empty subsystem label.', raw: '', exitCode: 1 };
	}

	const primary = await ix.runJsonQuery(['subsystems', '--target', trimmed, '--explain', '--format', 'json'], cwd, timeoutMs);
	if (primary.ok) {
		return primary;
	}
	if (!isAmbiguousSubsystemIxFailure(primary.error, primary.raw)) {
		return primary;
	}

	let last: IxJsonQueryResult = primary;
	for (const n of pickOrderForSubsystemLabelKind(labelKind)) {
		const args = ['subsystems', trimmed, '--pick', String(n), '--explain', '--format', 'json'] as const;
		const res = await ix.runJsonQuery([...args], cwd, timeoutMs);
		last = res;
		if (res.ok) {
			return res;
		}
		if (!isAmbiguousSubsystemIxFailure(res.error, res.raw)) {
			return res;
		}
	}
	return last;
}

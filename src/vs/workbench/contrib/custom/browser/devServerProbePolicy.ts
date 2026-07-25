/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Backoff policy for dev-server reachability probes. A down server should not
 * be hammered every 2.5s forever: delays double per consecutive miss up to a
 * cap, and the nearby-port fan-out (port, +1, +2, −1) stops after a few misses
 * so steady-state polling costs one request instead of four.
 */

export const DEV_SERVER_PROBE_BASE_DELAY_MS = 2500;
export const DEV_SERVER_PROBE_MAX_DELAY_MS = 30_000;
/** Consecutive misses after which probes stop fanning out to nearby ports. */
export const DEV_SERVER_PROBE_NEARBY_PORT_MISS_LIMIT = 3;

/** Delay before the next probe given how many consecutive probes have missed (≥1). */
export function nextProbeDelay(consecutiveFailures: number): number {
	const exponent = Math.max(0, consecutiveFailures - 1);
	return Math.min(DEV_SERVER_PROBE_BASE_DELAY_MS * 2 ** exponent, DEV_SERVER_PROBE_MAX_DELAY_MS);
}

/** Whether the next probe may still fan out to nearby ports. */
export function shouldProbeNearbyPorts(consecutiveFailures: number): boolean {
	return consecutiveFailures < DEV_SERVER_PROBE_NEARBY_PORT_MISS_LIMIT;
}

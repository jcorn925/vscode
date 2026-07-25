/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import type { ConsoleWorkflowSignals } from '../../../../../custom/goalWorkspace/consoleWorkflowStatus.js';

/**
 * An example business brief shown on the Console first-run hero. Selecting one
 * pre-fills the goal composer so a new user can start from a concrete plan
 * instead of a blank textarea.
 */
export interface ConsoleExampleBrief {
	readonly id: string;
	readonly title: string;
	readonly goal: string;
	readonly surfaces: readonly string[];
	readonly brief: string;
}

/**
 * The first-run hero (goal composer + example gallery) leads only while the
 * workspace has produced nothing yet: no plan, no suggested surfaces, no real
 * surfaces, and no planning session under way. Docker readiness deliberately
 * does not gate the hero — it is preflight status, not a lifecycle stage.
 */
export function shouldShowConsoleFirstRun(signals: ConsoleWorkflowSignals): boolean {
	return !signals.hasWorkspacePlan
		&& !signals.hasSuggestedSurfaces
		&& signals.surfaceCount === 0
		&& !signals.kickoffInFlight
		&& !signals.sessionActive;
}

/**
 * Journey-strip presentation labels: user outcomes rather than lifecycle
 * internals. The workflow model keeps its own stage labels; this remap is
 * display-only so the model and its consumers stay untouched.
 */
export function consoleWorkflowStepDisplayLabel(stepId: string, fallback: string): string {
	switch (stepId) {
		case 'planning':
			return localize('customMode.firstRun.stepDescribe', 'Describe your business');
		case 'review_surfaces':
			return localize('customMode.firstRun.stepReviewPlan', 'Review the plan');
		case 'create_surfaces':
			return localize('customMode.firstRun.stepApproveSurfaces', 'Approve surfaces');
		case 'building':
			return localize('customMode.firstRun.stepBuilding', 'Surfaces building');
		case 'running':
			return localize('customMode.firstRun.stepRunning', 'Apps running');
		default:
			return fallback;
	}
}

/**
 * Example workspaces for the first-run gallery. Briefs are written as a user
 * would describe their own business, so a pre-filled composer reads naturally
 * and is safe to submit as-is.
 */
export function consoleExampleBriefs(): ConsoleExampleBrief[] {
	return [
		{
			id: 'booking-studio',
			title: localize('customMode.firstRun.exampleBookingTitle', 'Booking studio'),
			goal: localize('customMode.firstRun.exampleBookingGoal', 'Class packages, session booking, and a marketing site for a boutique pilates studio.'),
			surfaces: ['marketing-site', 'booking', 'analytics'],
			brief: localize(
				'customMode.firstRun.exampleBookingBrief',
				'A boutique pilates studio that sells class packages online, takes bookings for sessions, and needs a simple marketing site to bring in new clients.',
			),
		},
		{
			id: 'support-desk',
			title: localize('customMode.firstRun.exampleSupportTitle', 'AI support desk'),
			goal: localize('customMode.firstRun.exampleSupportGoal', 'Grounded Q&A over a knowledge base, with human escalation and a public deploy.'),
			surfaces: ['support-chat', 'admin-console', 'eval-harness'],
			brief: localize(
				'customMode.firstRun.exampleSupportBrief',
				'An AI support desk for a SaaS product: grounded Q&A over our knowledge base, booking and portal redirects, out-of-scope escalation to a human, deployed publicly.',
			),
		},
		{
			id: 'online-store',
			title: localize('customMode.firstRun.exampleStoreTitle', 'Online store'),
			goal: localize('customMode.firstRun.exampleStoreGoal', 'Catalog and checkout for a ceramics brand, plus an order-management dashboard.'),
			surfaces: ['storefront', 'checkout', 'orders-dashboard'],
			brief: localize(
				'customMode.firstRun.exampleStoreBrief',
				'An online store for a small ceramics brand: a product catalog with checkout, order tracking for customers, and a dashboard where I manage inventory and orders.',
			),
		},
		{
			id: 'analytics-agency',
			title: localize('customMode.firstRun.exampleAgencyTitle', 'Analytics agency'),
			goal: localize('customMode.firstRun.exampleAgencyGoal', 'Client reporting portal, campaign dashboards, and a lead-capture site.'),
			surfaces: ['client-portal', 'dashboards', 'lead-capture'],
			brief: localize(
				'customMode.firstRun.exampleAgencyBrief',
				'A marketing analytics agency that needs a client reporting portal, campaign dashboards pulling from ad platforms, and a lead-capture site for new business.',
			),
		},
	];
}

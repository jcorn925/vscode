/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SurfaceBlueprintTemplate } from './surfaceBlueprintTypes.js';

function template(
	templateId: string,
	surfaceName: string,
	summary: string,
	requiredSubsystems: SurfaceBlueprintTemplate['requiredSubsystems'],
	manifest: SurfaceBlueprintTemplate['manifest'],
): SurfaceBlueprintTemplate {
	return { templateId, surfaceName, summary, requiredSubsystems, manifest };
}

export const SURFACE_BLUEPRINT_TEMPLATE_IDS = [
	'marketing',
	'booking',
	'client-portal',
	'trainer-admin',
	'analytics',
	'content-scheduler',
	'ads-manager',
	'subscriptions',
	'custom',
] as const;

export type SurfaceBlueprintTemplateId = (typeof SURFACE_BLUEPRINT_TEMPLATE_IDS)[number];

export const SURFACE_BLUEPRINT_TEMPLATES: Record<SurfaceBlueprintTemplateId, SurfaceBlueprintTemplate> = {
	marketing: template(
		'marketing',
		'Marketing Site',
		'Convert visitors into leads with offers, social proof, and clear calls to action.',
		[
			{ id: 'hero', label: 'Marketing Hero UI', kind: 'route', paths: ['apps/marketing/app', 'apps/marketing/app/page.tsx'] },
			{ id: 'offers', label: 'Offers UI', kind: 'route', paths: ['apps/marketing/app/offers'] },
			{ id: 'lead-capture', label: 'Lead Capture UI', kind: 'route', paths: ['apps/marketing/app/contact', 'apps/marketing/components/lead'] },
			{ id: 'marketing-layout', label: 'Marketing Layout UI', kind: 'component', paths: ['apps/marketing/app/layout.tsx', 'apps/marketing/components/layout'] },
		],
		{
			capabilities: ['display-offers', 'lead-capture'],
			events: ['lead.created', 'offer.viewed'],
			entities: ['Lead', 'Offer'],
			ixSubsystems: ['Marketing UI', 'Lead Capture UI'],
		},
	),
	booking: template(
		'booking',
		'Booking',
		'Let prospects pick packages, schedule sessions, and pay without leaving your funnel.',
		[
			{ id: 'package-selection', label: 'Package Selection UI', kind: 'route', paths: ['apps/booking/app/packages'] },
			{ id: 'scheduling', label: 'Scheduling UI', kind: 'route', paths: ['apps/booking/app/schedule'] },
			{ id: 'checkout', label: 'Checkout UI', kind: 'route', paths: ['apps/booking/app/checkout'] },
			{ id: 'intake', label: 'Intake Forms UI', kind: 'route', paths: ['apps/booking/app/intake', 'apps/booking/components/intake'] },
			{ id: 'booking-layout', label: 'Booking Layout UI', kind: 'component', paths: ['apps/booking/app/layout.tsx'] },
		],
		{
			capabilities: ['package-selection', 'schedule-session', 'checkout'],
			events: ['booking.started', 'booking.completed'],
			entities: ['Lead', 'Booking', 'TrainingPackage'],
			ixSubsystems: ['Package Selection UI', 'Scheduling UI', 'Checkout UI'],
		},
	),
	'client-portal': template(
		'client-portal',
		'Client Portal',
		'Give clients a home for plans, progress, messages, and account management.',
		[
			{ id: 'dashboard', label: 'Client Dashboard UI', kind: 'route', paths: ['apps/client-portal/app', 'apps/client-portal/app/dashboard'] },
			{ id: 'plans', label: 'Session Plans UI', kind: 'route', paths: ['apps/client-portal/app/plans'] },
			{ id: 'progress', label: 'Progress Tracking UI', kind: 'route', paths: ['apps/client-portal/app/progress'] },
			{ id: 'account', label: 'Account Access UI', kind: 'route', paths: ['apps/client-portal/app/account'] },
			{ id: 'messages', label: 'Client Messages UI', kind: 'route', paths: ['apps/client-portal/app/messages'] },
		],
		{
			capabilities: ['view-plans', 'track-progress', 'account-access'],
			events: ['client.session.viewed', 'client.progress.updated'],
			entities: ['Client', 'SessionPlan', 'ProgressEntry'],
			ixSubsystems: ['Client Dashboard UI', 'Session Plans UI', 'Progress Tracking UI'],
		},
	),
	'trainer-admin': template(
		'trainer-admin',
		'Trainer Admin',
		'Run day-to-day coaching operations—clients, sessions, follow-ups, and team workflows.',
		[
			{ id: 'roster', label: 'Client Roster UI', kind: 'route', paths: ['apps/trainer-admin/app/clients', 'apps/trainer-admin/app/roster'] },
			{ id: 'sessions', label: 'Session Management UI', kind: 'route', paths: ['apps/trainer-admin/app/sessions'] },
			{ id: 'coach-dashboard', label: 'Coach Dashboard UI', kind: 'route', paths: ['apps/trainer-admin/app', 'apps/trainer-admin/app/dashboard'] },
			{ id: 'follow-ups', label: 'Follow Ups UI', kind: 'route', paths: ['apps/trainer-admin/app/follow-ups'] },
		],
		{
			capabilities: ['manage-clients', 'manage-sessions', 'coach-dashboard'],
			events: ['session.scheduled', 'followup.created'],
			entities: ['Coach', 'Client', 'Session'],
			ixSubsystems: ['Client Roster UI', 'Session Management UI', 'Coach Dashboard UI'],
		},
	),
	analytics: template(
		'analytics',
		'Analytics',
		'Track conversion, retention, revenue, and the metrics that matter for growth.',
		[
			{ id: 'funnel', label: 'Funnel Dashboard UI', kind: 'route', paths: ['apps/analytics/app/funnel', 'apps/analytics/app/dashboard'] },
			{ id: 'revenue', label: 'Revenue Reporting UI', kind: 'route', paths: ['apps/analytics/app/revenue'] },
			{ id: 'kpi', label: 'North Star KPI UI', kind: 'route', paths: ['apps/analytics/app/kpi', 'apps/analytics/app/metrics'] },
			{ id: 'reports', label: 'Analytics Reports UI', kind: 'route', paths: ['apps/analytics/app/reports'] },
		],
		{
			capabilities: ['package-analytics', 'conversion', 'revenue'],
			events: ['analytics.report.viewed'],
			entities: ['Metric', 'Campaign', 'Subscription'],
			ixSubsystems: ['Funnel Dashboard UI', 'Revenue Reporting UI', 'North Star KPI UI'],
		},
	),
	'content-scheduler': template(
		'content-scheduler',
		'Content Scheduler',
		'Plan campaigns, schedule posts, and review what is working across channels.',
		[
			{ id: 'calendar', label: 'Editorial Calendar UI', kind: 'route', paths: ['apps/content-scheduler/app/calendar'] },
			{ id: 'campaigns', label: 'Campaign Planning UI', kind: 'route', paths: ['apps/content-scheduler/app/campaigns'] },
			{ id: 'composer', label: 'Post Composer UI', kind: 'route', paths: ['apps/content-scheduler/app/compose', 'apps/content-scheduler/app/posts'] },
			{ id: 'performance', label: 'Post Performance UI', kind: 'route', paths: ['apps/content-scheduler/app/performance'] },
		],
		{
			capabilities: ['schedule-content', 'plan-campaigns', 'review-performance'],
			events: ['content.scheduled', 'campaign.created'],
			entities: ['Post', 'Campaign', 'Channel'],
			ixSubsystems: ['Editorial Calendar UI', 'Campaign Planning UI', 'Post Performance UI'],
		},
	),
	'ads-manager': template(
		'ads-manager',
		'Ads Manager',
		'Launch ad campaigns, test creatives, and monitor spend against conversions.',
		[
			{ id: 'campaign-setup', label: 'Campaign Setup UI', kind: 'route', paths: ['apps/ads-manager/app/campaigns'] },
			{ id: 'audience', label: 'Audience Targeting UI', kind: 'route', paths: ['apps/ads-manager/app/audience'] },
			{ id: 'creatives', label: 'Creative Testing UI', kind: 'route', paths: ['apps/ads-manager/app/creatives'] },
			{ id: 'spend', label: 'Spend Analysis UI', kind: 'route', paths: ['apps/ads-manager/app/spend', 'apps/ads-manager/app/roas'] },
		],
		{
			capabilities: ['campaign-setup', 'audience-targeting', 'spend-analysis'],
			events: ['ad.campaign.launched', 'ad.spend.updated'],
			entities: ['AdCampaign', 'Audience', 'Creative'],
			ixSubsystems: ['Campaign Setup UI', 'Audience Targeting UI', 'Spend Analysis UI'],
		},
	),
	subscriptions: template(
		'subscriptions',
		'Subscriptions',
		'Manage plans, billing status, renewals, and cancellation workflows in one place.',
		[
			{ id: 'plans', label: 'Plan Management UI', kind: 'route', paths: ['apps/subscriptions/app/plans'] },
			{ id: 'billing', label: 'Billing Status UI', kind: 'route', paths: ['apps/subscriptions/app/billing'] },
			{ id: 'lifecycle', label: 'Lifecycle Events UI', kind: 'route', paths: ['apps/subscriptions/app/lifecycle', 'apps/subscriptions/app/events'] },
			{ id: 'cancellations', label: 'Cancellation Workflow UI', kind: 'route', paths: ['apps/subscriptions/app/cancel'] },
		],
		{
			capabilities: ['plan-management', 'billing-status', 'lifecycle-events'],
			events: ['subscription.created', 'subscription.cancelled'],
			entities: ['Subscription', 'Plan', 'BillingAccount'],
			ixSubsystems: ['Plan Management UI', 'Billing Status UI', 'Lifecycle Events UI'],
		},
	),
	custom: template(
		'custom',
		'New Surface',
		'A custom customer-facing workflow you describe.',
		[
			{ id: 'home', label: 'Surface Home UI', kind: 'route', paths: ['apps/custom/app', 'apps/custom/app/page.tsx'] },
			{ id: 'primary-flow', label: 'Primary Flow UI', kind: 'route', paths: ['apps/custom/app/flow'] },
			{ id: 'shared-components', label: 'Surface Components UI', kind: 'component', paths: ['apps/custom/components'] },
			{ id: 'layout', label: 'Surface Layout UI', kind: 'component', paths: ['apps/custom/app/layout.tsx'] },
		],
		{
			capabilities: ['primary-workflow'],
			events: ['surface.session.started'],
			entities: ['Customer'],
			ixSubsystems: ['Surface Home UI', 'Primary Flow UI'],
		},
	),
};

export function listSurfaceTemplateIds(): readonly SurfaceBlueprintTemplateId[] {
	return SURFACE_BLUEPRINT_TEMPLATE_IDS;
}

export function loadSurfaceTemplate(templateId: string): SurfaceBlueprintTemplate | undefined {
	return SURFACE_BLUEPRINT_TEMPLATES[templateId as SurfaceBlueprintTemplateId];
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hardcoded default Workspace Plan for the managed Console fallback workspace.
 * Skips Claude workspace-planning kickoff so dogfood can start at suggested surfaces.
 */

export const DEFAULT_WORKSPACE_PLAN_BUSINESS_NAME = `jason's personal business`;

/** Prefill for the Workspace Plan compose box when empty. */
export const DEFAULT_WORKSPACE_PLAN_INTENT = [
	`Cadre AI customer support chatbot take-home (4–6 hour MVP).`,
	`Propose one primary surface: Cadre AI Support Chatbot — grounded Q&A over a curated Cadre knowledge base, booking + portal redirects, out-of-scope escalation, public deploy.`,
	`Optional alternates only: inbound admin console and eval harness (not selected for MVP).`,
	`Aggressive scope-cutting: one polished surface over several half-finished ones.`,
].join(' ');

export const DEFAULT_WORKSPACE_PLAN_MARKDOWN = `# Workspace Plan — jason's personal business

## Goal summary

Build and deploy a **customer support chatbot for Cadre AI**, an AI strategy and
implementation consultancy. Cadre's inbound team is fielding a growing volume of
inquiries from prospective clients, existing clients, and the curious; the bot
should handle the common interactions (what Cadre does, industries served,
pricing/getting started, AI Maturity Index, portal access, LLM selection & data
security posture, booking a strategy call) and **escalate or redirect** when a
question is out of its depth.

This is a take-home-style MVP with a tight build budget. Prefer aggressive
scope-cutting ("3 working features > 8 broken ones") and a working, deployed
chat surface over breadth.

Hard deliverables:

- A deployed, publicly accessible chatbot URL
- Code in a fresh GitHub repo
- \`CLAUDE.md\` / plan artifacts at the project root
- Ready to walk through architecture, scope decisions, and AI workflow

## Who is served

- **Prospective Cadre AI clients** — B2B leaders asking what Cadre does, industry fit, pricing/engagement, and how to book a strategist.
- **Existing clients** — e.g. how to access the Cadre portal.
- **Cadre's inbound team** (indirect) — deflection of routine inquiries; escalation for the rest.

## Surface split & rationale

**Recommended: a single surface — \`cadre-support-bot\`.**

Everything the brief asks for — grounded Q&A, booking/portal redirects, escalation, and a public deploy — belongs in one chat application. Splitting admin or eval into separate surfaces adds integration overhead with little MVP payoff.

Plausible alternates (not recommended for the MVP window):

- \`cadre-admin-console\` — conversation logs, escalation queue, knowledge-base editing.
- \`cadre-eval-harness\` — scripted scenario tests; prefer a lightweight script inside the bot surface instead.

## Deferred

- Admin/analytics dashboard for the inbound team.
- Standalone evaluation harness surface.
- Auth/user accounts, CRM/calendar API integration (booking is a link-out).
- Multi-channel delivery, fine-tuning, large-scale vector RAG.

## Next step

Confirm which suggested surface(s) to create from
\`.agent/workspace.surfaces.suggested.json\`. Per-surface research and planning
begins only after a surface exists and its Plan flow is opened.
`;

export const DEFAULT_WORKSPACE_SUGGESTED_SURFACES_JSON = `{
	"status": "draft",
	"updatedAt": "2026-07-19T00:00:00.000Z",
	"surfaces": [
		{
			"id": "cadre-support-bot",
			"name": "Cadre AI Support Chatbot",
			"purpose": "Deployed customer support chatbot that answers common Cadre AI inquiries from a curated knowledge base, points users to booking and the client portal, and escalates questions it can't answer.",
			"primaryUsers": [
				"Prospective Cadre AI clients",
				"Existing Cadre AI clients",
				"Cadre inbound team (via deflection and escalation handoff)"
			],
			"keyCapabilities": [
				"Grounded chat over curated Cadre AI knowledge base",
				"Booking flow: direct users to schedule a call with an AI strategist",
				"Client portal access guidance and redirect",
				"Out-of-scope detection with escalation/redirect to a human",
				"Streaming chat UI with conversation history",
				"Public deployment with server-side LLM API key handling"
			],
			"suggested": true,
			"selected": true,
			"dependsOn": []
		},
		{
			"id": "cadre-admin-console",
			"name": "Cadre Inbound Admin Console",
			"purpose": "Internal dashboard for the inbound team: review conversation logs, work the escalation queue, and edit the bot's knowledge base.",
			"primaryUsers": [
				"Cadre inbound team",
				"Cadre engagement leads"
			],
			"keyCapabilities": [
				"Conversation transcript browsing and search",
				"Escalation queue with status tracking",
				"Knowledge-base content editing and publishing",
				"Basic deflection/volume analytics"
			],
			"suggested": false,
			"selected": false,
			"dependsOn": [
				"cadre-support-bot"
			]
		},
		{
			"id": "cadre-eval-harness",
			"name": "Chatbot Evaluation Harness",
			"purpose": "Standalone scenario-test runner that replays sample inquiries against the chat API and scores grounding and escalation behavior.",
			"primaryUsers": [
				"Builder / candidate",
				"Cadre engineering reviewers"
			],
			"keyCapabilities": [
				"Scripted scenario suite for sample interactions",
				"Grounding/escalation assertions on bot responses",
				"Regression runs against deployed or local chat API"
			],
			"suggested": false,
			"selected": false,
			"dependsOn": [
				"cadre-support-bot"
			]
		}
	]
}
`;

export const DEFAULT_FALLBACK_GOAL_WORKSPACE_MANIFEST = `{
	"goal": {
		"id": "jasons-personal-business",
		"name": "jason's personal business",
		"description": "Cadre AI customer support chatbot MVP — one polished support-bot surface; admin/eval deferred.",
		"northStarMetric": "deployed_support_deflection"
	},
	"surfaces": [],
	"shared": {
		"domain": "packages/domain",
		"events": "packages/events",
		"ui": "packages/ui",
		"auth": "packages/auth",
		"workflows": "workflows"
	}
}
`;

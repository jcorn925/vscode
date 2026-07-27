/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Seeded into a goal workspace as `CLAUDE.md` when New Surface starts a Claude
 * planning session. Process rules only — client intent lives in `plan.md`.
 */
export const CADRE_SURFACE_CLAUDE_MD = `# CLAUDE.md — Surface agent working agreement

You are creating a deployable surface (app) inside this workspace.
Planning comes before code. Graph verification gates "done."

## Non-negotiables

1. **Plan first.** Do not scaffold app code until
   \`.agent/surfaces/<surface-id>.plan.md\` exists and §0 (Plan lock) is checked
   off. If the plan is missing or incomplete, write or finish it — do not invent
   architecture silently in the chat.
2. **Proposal is the contract.** Structural success means the live ix graph
   matches \`.agent/task-trees/<surface-id>.graph-proposal.json\` (proposal recall),
   not byte-matching any reference source. Architecture notes and the phased
   checklist live **in the proposal**, not the plan.
3. **Reference research is planning-only (required).** During Research / proposal
   drafting you **must** survey 1–2 comparable public GitHub repos, map them with
   Ix, and draft graph shape from that map (see Research recipe below). During
   **generate** phases you must **not** read, clone, or copy application source
   from reference checkouts — feedback is plan + proposal gap lists only.
4. **Verify with tools, don't guess.** After each implementation phase:
   - \`remap_and_wait\` on this directory
   - \`compare_proposal\` with \`proposal_path\` pointing at the surface
     graph-proposal.json, a stable \`run_id\`, and the \`clone_workspace\`
     returned by remap (no reference workspace)
   - Stop when passed, or \`rounds_without_improvement >= 2\`, or the phase budget ends
   - After verify, open the **Proposed Code Graph** tab for architecture / phases /
     file+edge review
5. **Batch remaps.** Implement a whole subsystem, then remap once. Do not
   remap after every file (ingest settle is expensive).
6. **Ix backend wedge — restart immediately.** If \`remap_and_wait\`,
   \`compare_proposal\`, \`ix stats\`, or MCP calls hang / time out while
   \`docker ps\` still shows \`backend-arangodb-1\` / \`backend-memory-layer-1\`
   as healthy (Arango stuck-lock / false-healthy), do **not** burn time on
   longer timeouts. Run \`ix docker restart\`, wait ~10s, re-check
   \`ix docker status\` / \`ix stats\`, then retry the tool **once**. If
   \`ix\` is missing from PATH, restart both containers:
   \`docker restart backend-arangodb-1 backend-memory-layer-1\`. Note the
   recovery in your phase report; do not abandon the phase for a wedged
   backend.
7. **Stay in scope.** Only create/edit files under this project root
   (references stay under \`.agent/references/\` and are never copied into apps/).
8. **One surface id — no \`-2\` clones.** Re-plan by overwriting
   \`.agent/surfaces/<surface-id>.plan.md\` and
   \`.agent/task-trees/<surface-id>.graph-proposal.json\` for the **existing**
   surface. Do not invent \`cadre-bot-2\` / sibling ids when research was skipped.
   To throw away a surface, delete it in the Console UI (that removes the
   manifest entry, plan, proposal, and app folder) and create a fresh one.

## Workspace planning (Console home)

When the user kicks off planning from the **Console Surfaces home** (business
brief / PDF, not a single named surface):

1. Read attachments under \`.agent/workspace/attachments/\` and any intent text.
2. Write \`.agent/workspace.plan.md\` — goal summary, who is served, surface-split
   rationale, what is deferred.
3. Write \`.agent/workspace.surfaces.suggested.json\` with \`status: "draft"\` and a
   \`surfaces\` array. Each entry needs \`id\`, \`name\`, \`purpose\`,
   \`primaryUsers\`, \`keyCapabilities\`, \`dependsOn\`, plus \`suggested\` /
   \`selected\` (mark the surfaces you recommend with both \`true\`; include
   optional alternates with \`suggested: false\` / \`selected: false\`).
4. **Stop.** Do **not** create \`apps/\`, per-surface \`plan.md\`, or graph
   proposals yet. The Console UI shows suggestion cards; the human confirms
   which surfaces to create. Per-surface Research (below) starts only after the
   Console confirms a surface and kicks you.
5. **Console owns Steps — do not drive them from chat.** The Steps row advances
   only when the Console writes durable files / workflow state. If the user
   asks you to "confirm" a suggested surface in chat, tell them to click the
   Console suggestion card (or Confirm selected). Do **not** set
   \`workspace.surfaces.suggested.json\` \`status: "confirmed"\`, do **not**
   upsert \`workspace.goal.json\` surfaces yourself for that confirm gate, and
   do **not** invent \`.workflow.json\` step completions. Wait for the Console
   kickoff prompt, then do Research / build work only.

## Workspace plan analysis (Console home)

When Console kicks **Kickoff analysis** (plan already exists; grade the repo):

1. Read \`workspace.goal.json\`, \`.agent/workspace.plan.md\`, suggested surfaces
   if present, and on-disk apps under \`apps/\`.
2. Use Ix (\`ix map\` / subsystems / inventory as needed) to compare intended
   surfaces and capabilities against what exists in the repo.
3. Write \`.agent/workspace.plan-analysis.md\` with: coverage summary, per-surface
   gaps, shared-package notes, and a short scorecard (matches / missing /
   overbuilt).
4. **Stop.** Do not rewrite the workspace plan, suggested surfaces, or
   \`workspace.goal.json\` unless the human explicitly asks.

## Description regen (Console + surface)

When Console or a surface Plan UI kicks **Regen Description**:

**Shared format** — write a single JSON string with exactly three blocks separated
by blank lines (plain text, no markdown headings):

1. Lead (1–2 sentences) — what this is and who it serves.
2. \`How it works:\` — runtime/product path (routes, data/KB, handoffs, modules).
3. \`Stack & systems:\` — frameworks, AI/providers, deploy, persistence, siblings /
   verify commands when relevant.

**Workspace (Console Description):** only replace \`goal.description\` in
\`workspace.goal.json\`. Inspect goal + all surfaces, \`.agent/workspace.plan.md\`,
and \`apps/*\` READMEs as needed. Do not edit surface purposes, plan.md, or brand.

**Surface (Plan Description):** only replace that surface's \`purpose\` in
\`workspace.goal.json\`. Inspect that surface + siblings, \`apps/<id>/\`, and
\`.agent/surfaces/<id>.plan.md\` if present. Do not edit other surfaces or plan.md.

Stop when the target field is written.

## Schema regen (surface Plan)

When a surface Plan UI kicks **Regen Schema**:

1. Inspect that surface in \`workspace.goal.json\`, \`apps/<id>/\` (ORM schemas,
   migrations, models, package.json deps), and \`.agent/surfaces/<id>.plan.md\`
   if present.
2. Write only \`surfaces[id].schema\` as a JSON object with:
   - \`dbKind\`: \`"sql"\` | \`"nosql"\` | \`"none"\`
   - \`engine\` (optional): e.g. postgres, sqlite, mongodb, supabase
   - \`summary\` (optional): 1–2 sentences on persistence
   - \`entities\`: array of \`{ name, kind: "table"|"collection", fields: [{ name, type?, pk?, notes? }], notes? }\`
3. Use \`dbKind: "none"\` and empty \`entities\` when the surface has no database
   (client state, prompt-stuffed KB, files only, etc.).
4. Do NOT edit purpose, plan.md, proposals, or other surfaces. Stop when schema
   is written.
5. When the surface has a browsable database console (e.g. local Supabase Studio
   at \`http://127.0.0.1:54323\`, or a hosted Supabase project dashboard), also
   write \`databaseUrl\` on that surface in \`workspace.goal.json\` so the Console
   **Database** rail card can open it. Leave \`databaseUrl\` unset when there is
   no console URL. Schema (structured model) and Database (live webview) are
   separate — do not put Studio URLs inside \`schema\`.

## Phase progress contract (generate)

Console starts each generate phase by writing
\`.agent/surfaces/<surface-id>.phase-progress.json\` with \`status: "running"\`
and the phase \`stepId\`. After \`remap_and_wait\` + \`compare_proposal\` for
that phase, update the same file to \`status: "completed"\` (same \`stepId\` /
\`stepLabel\` / \`surfaceId\`). On failure set \`status: "failed"\` with a short
\`error\`, then stop. Console marks \`.workflow.json\` completed only after it
sees \`completed\`. Do not start the next phase until Console Next kicks it.
Do not begin generate phases on Plan lock alone — wait for Next.

## Code Graph (Console-owned gate)

After generate phases finish — and **before** Enable Preview — Console shows a
**Code Graph** Steps row (\`verify_graph\`). When Console Next kicks it, run
\`remap_and_wait\` + \`compare_proposal\` against
\`.agent/task-trees/<surface-id>.graph-proposal.json\`, then mark phase-progress
\`completed\` for \`verify_graph\`. Do not invent \`.workflow.json\` completions.
Do not start Enable Preview until Code Graph is completed.

## Enable Preview (Console-owned gate)

After Code Graph finishes, Console shows an **Enable Preview** Steps row.
That step is done only when this surface in \`workspace.goal.json\` has both
\`localUrl\` (e.g. \`http://localhost:<unique-port>\`) and \`devCommand\` that
serves it (prefer \`npm run dev --prefix apps/<surface-id> -- --port <port>\`).
When Console Next kicks \`enable_preview\`, write those fields (and \`path\` if
missing), then mark phase-progress \`completed\`. Do not invent \`.workflow.json\`
completions. Local Preview only for this step — public deploy is the separate
**Deployed** step.

## Operational blockers (Console-owned gate)

After Enable Preview (and before Deployed), Console may show **blocker** Steps
from \`.agent/surfaces/<surface-id>.blockers.json\` (e.g. missing \`.env.local\`
keys from \`.env.example\`). Console auto-probes env keys; you may also append
\`kind: "manual"\` open blockers when you discover operational gaps (API keys,
webhooks, etc.). Never invent secrets — ask the human to paste real values.
When Console Next kicks \`blocker:…\`, clear that blocker, then mark
phase-progress \`completed\` (and/or set the blocker \`status: "resolved"\`).
Do not invent \`.workflow.json\` completions.

## Deployed (Console-owned gate)

After Enable Preview and any open blockers, Console shows a **Deployed** Steps
row (\`deployed\`). That step is done only when this surface in
\`workspace.goal.json\` has a public \`productionUrl\` (https, not localhost —
e.g. a Vercel production URL). When Console Next kicks \`deployed\`, publish the
surface app, write \`productionUrl\`, then mark phase-progress \`completed\`.
Do not invent \`.workflow.json\` completions.

## Research recipe (planning only)

Draft graph shape from a real comparable repo **first**, then adapt it to this
surface's Plan lock:

1. **Find priors.** Use \`gh search repos\` / \`gh api\` / \`gh repo view\` to
   survey several comparable public repos (not random stars). Write
   \`.agent/surfaces/<surface-id>.reference-candidates.json\` with
   \`status: "awaiting_selection"\` and a \`repos\` array. Mark the best 1–2
   with \`suggested: true\` and \`selected: true\`; include a few alternates
   with \`suggested: false\` / \`selected: false\`. Each repo needs
   \`owner\`, \`repo\`, \`url\`, a short \`reason\` (1–2 sentences tying it to
   this surface's plan.md Research / intent — not a generic GitHub blurb),
   and optional \`description\` / \`stars\`.
2. **Wait for human selection.** Stop and tell the user the Plan tab now shows
   the found-repos row. Poll the candidates file (sleep 2–3s) until
   \`status\` is \`"confirmed"\` (or the user messages which repos to use).
   Do **not** clone until then. Only use repos with \`selected: true\`.
3. **Shallow clone** selected repos into \`.agent/references/<owner>-<repo>/\`
   only (\`git clone --depth 1 https://github.com/<owner>/<repo>
   .agent/references/<owner>-<repo>\`). Set candidates \`status\` to \`"done"\`
   after clones succeed.
4. **Map.** \`remap_and_wait\` on each selected reference directory; note the
   returned \`workspace_id\`.
5. **Draft shape.** Call \`draft_proposal_from_workspace\` with that workspace id,
   \`tree_id\` / \`surface_id\`, and \`rewrite_root_to\` = your app path
   (e.g. \`apps/<surface-id>\`). Prefer writing
   \`.agent/task-trees/<surface-id>.graph-proposal.draft.json\`.
6. **Adapt.** Rewrite the draft against §0 Plan lock: drop out-of-scope nodes,
   rename/re-root paths, add surface-specific files/edges, fill \`architecture\`
   + \`phases\`. Promote the result to
   \`.agent/task-trees/<surface-id>.graph-proposal.json\`.
7. **Cite.** Plan § Research must name the GitHub repos surveyed (and which
   the user selected), mirror each selected repo's \`reason\`, and say the
   proposal was drafted from their Ix graph then adapted — do not claim
   "internal priors only" when GitHub research was available.

Generate phases start only after the final proposal exists. Never \`cp -R\`
reference source into \`apps/\`.

## Workspace inspection

Prefer the seeded read-only inspector over ad-hoc \`python3 -c\`:

\`\`\`bash
python3 .claude/scripts/inspect_goal_workspace.py
python3 .claude/scripts/inspect_goal_workspace.py --json
\`\`\`

Project \`.claude/settings.json\` allow-lists that script plus common git/ls/cat
reads, planning-only GitHub survey, ix-graph MCP tools, and Ix Docker recovery
(\`ix docker restart\` / status). Write/destructive commands stay gated.

## Ix backend recovery (common)

Symptoms: health-check / \`remap_and_wait\` / \`ix stats\` timeout while Docker
still reports both Ix containers healthy.

Immediate fix (do this before lengthening timeouts):

\`\`\`bash
ix docker restart
# wait ~10s
ix docker status
ix stats
\`\`\`

Fallback if \`ix\` is unavailable:

\`\`\`bash
docker restart backend-arangodb-1 backend-memory-layer-1
\`\`\`

Then retry the failed remap/compare **once**. Do not loop restart more than
twice in a turn — if it still fails, set phase-progress \`failed\` with a short
error mentioning the wedged Ix backend.

### \`~/.ix/config.yaml\` (workspace registry)

This file is the ix CLI **address book** (disk path → \`workspace_id\`). Graph
nodes/edges live in ArangoDB — pruning the YAML only unregisters paths.

- \`ix map\` / \`remap_and_wait\` resolve identity from \`root_path\` here.
- Paths with spaces can YAML line-fold (\`Application\` / \`Support\`) and break
  MCP path lookup — when resolution fails, \`grep\` the workspace name and pass
  \`workspace_id\` explicitly.
- Hundreds of dead \`/tmp\`, dogfood, and single-file registrations slow backend
  boot and make the Arango wedge more likely. When the registry is bloated
  (roughly 200+ workspaces) or wedges keep recurring, prune with backup:

\`\`\`bash
python3 <code-oss-root>/scripts/ix_prune_workspace_registry.py
python3 <code-oss-root>/scripts/ix_prune_workspace_registry.py --apply --also-mtimes
ix docker restart
\`\`\`

Dry-run first. Never hand-edit shared \`~/.ix/config.yaml\` without a backup —
it is machine-global for every ix client on this host.

## How to use the docs

| Doc | Role |
|-----|------|
| \`CLAUDE.md\` (this file) | Standing process rules for every surface |
| \`.agent/workspace.plan.md\` | Workspace-level brief; multi-surface split |
| \`.agent/workspace.surfaces.suggested.json\` | Suggested surfaces for Console cards |
| \`.agent/workspace/attachments/*\` | Planning PDF / brief files from Console home |
| \`.agent/surfaces/<surface-id>.plan.md\` | Intent, research, plan lock, risks — keep lean |
| \`.agent/task-trees/*.graph-proposal.json\` | Architecture, phased checklist, file/edge targets |
| \`.agent/surfaces/<id>.reference-candidates.json\` | Found GitHub priors; user selects which to clone/map |
| \`.agent/surfaces/<id>.phase-progress.json\` | Claude↔Console phase handshake (\`running\` / \`completed\` / \`failed\`) |
| \`.agent/surfaces/<id>.workflow.json\` | Console-owned Steps row (do not invent completions) |
| \`.agent/surfaces/<id>.blockers.json\` | Operational blockers (env keys / agent-declared gaps) |
| \`workspace.goal.json\` | Surface registry — Preview needs \`localUrl\` + \`devCommand\`; Deployed needs \`productionUrl\`; Database console needs \`databaseUrl\` (optional) |
| \`.agent/references/*\` | Shallow clones for planning maps only |

### Plan vs Proposal split

**Plan** (\`.agent/surfaces/<id>.plan.md\`) — narrative only:

- §0 Plan lock
- Problem / intent
- Research (planning-only; cite GitHub priors + Ix draft step)
- Risks / deferrals
- **Last section:** link to the Proposed Code Graph (path of the paired
  \`.graph-proposal.json\`) — do not paste architecture trees or phase
  checklists into the plan

**Proposal** (\`.agent/task-trees/<id>.graph-proposal.json\`) — executable contract:

- \`architecture\` — folder tree + short notes
- \`phases\` — phased checklist with \`remap_and_wait\` / \`compare_proposal\` gates
- \`add_nodes\` / \`add_edges\` / \`node_prefixes\` — verification targets
  (adapted from the reference draft, not a raw dump)

## Definition of done (per phase)

A phase is done only when:

1. The phase checklist in the proposal (\`phases\`) is addressed, and
2. Proposal compare meets the phase pass bar (or gaps are listed as intentional
   deferrals in the plan § Risks), and
3. You report: proposal node recall, missing proposed nodes, and what you deferred, and
4. You write \`.agent/surfaces/<surface-id>.phase-progress.json\` with
   \`status: "completed"\` for that phase's \`stepId\` so Console can advance Steps.
`;

/**
 * Scoped generate prompt for one parallel (or serialize) workstream Claude.
 * Streams update workstream-runs.json; Console aggregates phase-progress completion.
 */
export function buildWorkstreamGeneratePrompt(options: {
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly stepId: string;
	readonly stepLabel: string;
	readonly workstreamId: string;
	readonly workstreamLabel: string;
	readonly mode: 'parallel' | 'serialize';
	readonly nodes: readonly string[];
	readonly sharedPrefixes?: readonly string[];
	readonly forbiddenNodes?: readonly string[];
	readonly claudeKey: string;
}): string {
	const progressPath = `.agent/surfaces/${options.surfaceId}.phase-progress.json`;
	const runsPath = `.agent/surfaces/${options.surfaceId}.workstream-runs.json`;
	const proposalPath = `.agent/task-trees/${options.surfaceId}.graph-proposal.json`;
	const nodeList = options.nodes.length
		? options.nodes.map(n => `- ${n}`).join('\n')
		: '- (none listed — stay within this workstream label only)';
	const forbidden = (options.forbiddenNodes ?? []).slice(0, 80);
	const forbiddenList = forbidden.length
		? forbidden.map(n => `- ${n}`).join('\n')
		: '- (none)';
	const prefixNote = options.sharedPrefixes?.length
		? `Shared prefixes for this stream: ${options.sharedPrefixes.join(', ')}.`
		: '';
	const modeLine = options.mode === 'serialize'
		? `You own the SERIALIZE (coupled) clusters for this phase. Finish these shared/coupled files before parallel streams are considered done.`
		: `You own ONE parallel-safe workstream. Other Claude instances are generating sibling streams concurrently.`;

	return [
		`Console started phase "${options.stepLabel}" (${options.stepId}) for surface ${options.surfaceId} (${options.surfaceName}).`,
		`Your Claude session key is ${options.claudeKey} (workstream ${options.workstreamId}: ${options.workstreamLabel}).`,
		modeLine,
		prefixNote,
		`${progressPath} is status "running" for that stepId. Do NOT write phase-progress completed yourself — update ${runsPath} instead.`,
		`Allowed files for this stream (edit only these unless a tiny local helper is required inside the same folder):\n${nodeList}`,
		`Do NOT edit these paths (other streams / serialize scope):\n${forbiddenList}`,
		`Execute this stream's slice of the phase from ${proposalPath}, then remap_and_wait + compare_proposal for your nodes.`,
		`When your stream's gate passes, update ${runsPath}: set the entry for key "${options.claudeKey}" to status "completed" (keep surfaceId, stepId, stepLabel).`,
		`On failure, set that entry to status "failed" with a short error, then stop.`,
		`Do not edit .workflow.json — Console marks Steps completed only after all workstream-runs for this phase are completed.`,
	].filter(Boolean).join(' ');
}

/**
 * First user message sent into Claude Code from the empty Plan tab compose box.
 */
export function buildSurfacePlanKickoffPrompt(options: {
	readonly surfaceName: string;
	readonly surfaceId: string;
	readonly intent: string;
}): string {
	const { surfaceName, surfaceId, intent } = options;
	const planPath = `.agent/surfaces/${surfaceId}.plan.md`;
	const proposalPath = `.agent/task-trees/${surfaceId}.graph-proposal.json`;
	const trimmed = intent.trim();
	return [
		`Read CLAUDE.md and follow it.`,
		`I want to build: ${trimmed}`,
		`Create ${planPath} for surface "${surfaceName}" (id: ${surfaceId}) from that intent.`,
		`Keep the plan lean: §0 Plan lock, problem/intent, research (planning-only), risks/deferrals.`,
		`In Research: survey comparable public GitHub repos (gh search/api), write .agent/surfaces/${surfaceId}.reference-candidates.json (status awaiting_selection; suggested repos selected:true; each repo needs a short reason tied to plan Research), wait until the Plan UI confirms selection, then shallow-clone only selected repos into .agent/references/, remap_and_wait, draft_proposal_from_workspace (write ${proposalPath.replace('.json', '.draft.json')}), then adapt that draft to the Plan lock.`,
		`End the plan with a Proposed Code Graph section that links to ${proposalPath} — do not put architecture trees or phased checklists in the plan.`,
		`Then write ${proposalPath} as the verification contract: architecture notes, phases (phased checklist with remap_and_wait/compare_proposal gates), file: nodes, and structural edges adapted from the reference draft; set plan_ref to "${planPath}".`,
		`Do not scaffold application code yet — plan + proposal only. Do not copy reference source into apps/.`,
		`Do not edit .workflow.json or invent Steps-row completions — the Console owns those gates.`,
		`When those two artifacts exist, summarize what you wrote (including which repos informed the draft) and stop for human review.`,
	].join(' ');
}

/**
 * Console Surfaces home: workspace-level planning from a brief/PDF.
 * Produces suggested surfaces; does not create apps/ or per-surface proposals.
 */
export function buildWorkspacePlanKickoffPrompt(options: {
	readonly businessName?: string;
	readonly intent: string;
	readonly attachmentPaths?: readonly string[];
}): string {
	const business = options.businessName?.trim();
	const trimmed = options.intent.trim();
	const attachments = (options.attachmentPaths ?? []).filter(path => !!path.trim());
	const parts = [
		`Read CLAUDE.md and follow the Workspace planning section.`,
		business ? `Business / workspace name: ${business}.` : '',
		trimmed ? `Planning intent: ${trimmed}` : 'Planning intent: derive the product split from the attached brief.',
		attachments.length
			? `Read these workspace planning attachments first:\n${attachments.map(path => `- ${path}`).join('\n')}`
			: '',
		`Write .agent/workspace.plan.md summarizing the goal, who is served, the recommended surface split, and what to defer.`,
		`Write .agent/workspace.surfaces.suggested.json with status "draft" and a surfaces array. Each surface needs id, name, purpose, primaryUsers, keyCapabilities, dependsOn, suggested, and selected. Mark recommended surfaces suggested:true and selected:true; include plausible alternates with suggested:false and selected:false.`,
		`If attachments were provided, set sourceBrief to the primary brief path.`,
		`Do NOT create apps/, per-surface plan.md files, graph proposals, or scaffold code. Stop when both workspace artifacts exist so the Console can show suggestion cards.`,
		`Do not set suggested surfaces status to confirmed and do not upsert workspace.goal.json for confirm — the Console owns that Steps gate when the user clicks a card.`,
	];
	return parts.filter(Boolean).join(' ');
}

/**
 * Console Surfaces home: grade how well the current repo implements the
 * workspace plan. Writes `.agent/workspace.plan-analysis.md` only.
 */
export function buildWorkspacePlanAnalysisPrompt(options: {
	readonly businessName?: string;
	readonly intent?: string;
}): string {
	const business = options.businessName?.trim();
	const trimmed = options.intent?.trim();
	const parts = [
		`Read CLAUDE.md and follow the Workspace plan analysis section.`,
		business ? `Business / workspace name: ${business}.` : '',
		trimmed ? `Current planning intent from Console (may refine the on-disk plan): ${trimmed}` : '',
		`Read workspace.goal.json, .agent/workspace.plan.md, and .agent/workspace.surfaces.suggested.json if present.`,
		`Inspect apps/ and use Ix (ix map / subsystems / inventory as needed) to compare intended surfaces and capabilities against what exists in this repo.`,
		`Write .agent/workspace.plan-analysis.md with: (1) coverage summary, (2) per-surface gaps, (3) shared-package notes, (4) a short scorecard of what matches / is missing / is overbuilt.`,
		`Do NOT rewrite .agent/workspace.plan.md, suggested surfaces, or workspace.goal.json. Do not scaffold new apps. Stop when the analysis file exists.`,
	];
	return parts.filter(Boolean).join(' ');
}

/** Shared three-block Description string contract (purpose / goal.description). */
const DESCRIPTION_FORMAT_CONTRACT = [
	`Write a single JSON string with exactly three blocks separated by blank lines (plain text, no markdown headings):`,
	`(1) Lead — 1–2 sentences on what this is and who it serves.`,
	`(2) A block starting with "How it works:" — runtime/product path (routes, data/KB, handoffs, key modules).`,
	`(3) A block starting with "Stack & systems:" — frameworks, AI/providers, deploy, persistence, siblings / verify commands when relevant.`,
].join(' ');

/**
 * Surface Plan Description: rewrite `surfaces[<id>].purpose` only.
 */
export function buildSurfacePurposeRegenPrompt(options: {
	readonly surfaceId: string;
	readonly surfaceName: string;
}): string {
	const { surfaceId, surfaceName } = options;
	return [
		`Read CLAUDE.md and follow the Description regen section.`,
		`Console asked to regenerate the Description for surface "${surfaceName}" (id: ${surfaceId}).`,
		`Inspect workspace.goal.json (this surface and siblings), apps/${surfaceId}/ (README, package.json, routes), and .agent/surfaces/${surfaceId}.plan.md if present.`,
		DESCRIPTION_FORMAT_CONTRACT,
		`Update only surfaces[id=${surfaceId}].purpose in workspace.goal.json with that string.`,
		`Do NOT edit other surfaces, goal.description, plan.md, proposals, or scaffold code. Stop when purpose is written.`,
	].join(' ');
}

/**
 * Console Description: rewrite `goal.description` only.
 */
export function buildWorkspaceDescriptionRegenPrompt(options: {
	readonly businessName?: string;
}): string {
	const business = options.businessName?.trim();
	return [
		`Read CLAUDE.md and follow the Description regen section.`,
		`Console asked to regenerate the workspace Description (goal.description).`,
		business ? `Business / workspace name: ${business}.` : '',
		`Inspect workspace.goal.json (goal + all surfaces), .agent/workspace.plan.md, and apps/*/README.md or package.json as needed.`,
		DESCRIPTION_FORMAT_CONTRACT,
		`Update only goal.description in workspace.goal.json with that string.`,
		`Do NOT edit surface purposes, brand fields, plan.md, or scaffold code. Stop when goal.description is written.`,
	].filter(Boolean).join(' ');
}

/**
 * Surface Plan Schema: rewrite `surfaces[<id>].schema` only.
 */
export function buildSurfaceSchemaRegenPrompt(options: {
	readonly surfaceId: string;
	readonly surfaceName: string;
}): string {
	const { surfaceId, surfaceName } = options;
	return [
		`Read CLAUDE.md and follow the Schema regen section.`,
		`Console asked to regenerate the Schema for surface "${surfaceName}" (id: ${surfaceId}).`,
		`Inspect workspace.goal.json (this surface), apps/${surfaceId}/ (README, package.json, ORM/migrations/models), and .agent/surfaces/${surfaceId}.plan.md if present.`,
		`Write only surfaces[id=${surfaceId}].schema as a JSON object:`,
		`{ "dbKind": "sql"|"nosql"|"none", "engine"?: string, "summary"?: string, "entities": [{ "name": string, "kind": "table"|"collection", "fields": [{ "name": string, "type"?: string, "pk"?: boolean, "notes"?: string }], "notes"?: string }] }.`,
		`Use dbKind "none" and entities [] when there is no database.`,
		`When a browsable console exists (e.g. local Supabase Studio http://127.0.0.1:54323), also write surfaces[id=${surfaceId}].databaseUrl; leave it unset when there is none.`,
		`Do NOT edit purpose, other surfaces, plan.md, or scaffold code. Stop when schema is written.`,
	].join(' ');
}

/**
 * Project-level Claude Code MCP config (``.mcp.json``) so the embedded Claude
 * session can actually spawn ix-graph. Permission allow-list entries alone are
 * not enough — without this file Claude reports "no MCP servers connected."
 *
 * ``ixGraphScriptAbsPath`` must be an absolute path to ``scripts/ix_graph_mcp.py``
 * in the Babadaba / Code OSS checkout (Console cwd is not the product root).
 */
export function buildCadreClaudeMcpJson(ixGraphScriptAbsPath: string): string {
	return `${JSON.stringify({
		mcpServers: {
			'ix-graph': {
				type: 'stdio',
				command: 'python3',
				args: [ixGraphScriptAbsPath],
			},
		},
	}, null, '\t')}\n`;
}

/**
 * Project-level Claude Code permissions seeded into goal workspaces.
 * Read-only inspect patterns are allow-listed; write/destructive stay gated.
 * Do not allow bare ``python3 -c`` — use the inspect script instead.
 */
export const CADRE_CLAUDE_SETTINGS_JSON = `{
	"$schema": "https://json.schemastore.org/claude-code-settings.json",
	"permissions": {
		"allow": [
			"Bash(python3 .claude/scripts/inspect_goal_workspace.py)",
			"Bash(python3 .claude/scripts/inspect_goal_workspace.py *)",
			"Bash(git status)",
			"Bash(git status *)",
			"Bash(git log *)",
			"Bash(git diff *)",
			"Bash(git show *)",
			"Bash(git branch *)",
			"Bash(git rev-parse *)",
			"Bash(git clone --depth 1 https://github.com/* .agent/references/*)",
			"Bash(git -C .agent/references *)",
			"Bash(gh search *)",
			"Bash(gh api *)",
			"Bash(gh repo view *)",
			"Bash(mkdir -p .agent/references)",
			"Bash(mkdir -p .agent/references/*)",
			"Bash(ls *)",
			"Bash(find .agent *)",
			"Bash(find apps *)",
			"Bash(head *)",
			"Bash(wc *)",
			"Bash(cat workspace.goal.json)",
			"Bash(cat CLAUDE.md)",
			"Bash(cat plan.md)",
			"Bash(cat .agent/surfaces/*)",
			"Bash(cat .agent/task-trees/*)",
			"Bash(cat .agent/workspace.plan.md)",
			"Bash(cat .agent/workspace.surfaces.suggested.json)",
			"Bash(cat .agent/workspace/attachments/*)",
			"Bash(mkdir -p .agent/workspace)",
			"Bash(mkdir -p .agent/workspace/attachments)",
			"Bash(jq *)",
			"Bash(sleep *)",
			"Bash(ix docker restart)",
			"Bash(ix docker restart *)",
			"Bash(ix docker status)",
			"Bash(ix docker status *)",
			"Bash(ix docker start)",
			"Bash(ix docker start *)",
			"Bash(ix status)",
			"Bash(ix stats)",
			"Bash(docker restart backend-arangodb-1)",
			"Bash(docker restart backend-memory-layer-1)",
			"Bash(docker restart backend-arangodb-1 backend-memory-layer-1)",
			"Bash(docker restart backend-memory-layer-1 backend-arangodb-1)",
			"Bash(docker ps *)",
			"Bash(python3 */scripts/ix_prune_workspace_registry.py)",
			"Bash(python3 */scripts/ix_prune_workspace_registry.py *)",
			"Bash(python3 scripts/ix_prune_workspace_registry.py)",
			"Bash(python3 scripts/ix_prune_workspace_registry.py *)",
			"Read(./workspace.goal.json)",
			"Read(./CLAUDE.md)",
			"Read(./plan.md)",
			"Read(./.agent/**)",
			"mcp__ix-graph__compare_graphs",
			"mcp__ix-graph__compare_proposal",
			"mcp__ix-graph__remap_and_wait",
			"mcp__ix-graph__list_workspaces",
			"mcp__ix-graph__draft_proposal_from_workspace"
		],
		"ask": [
			"Bash(git push *)",
			"Bash(git commit *)",
			"Bash(git checkout *)",
			"Bash(git switch *)",
			"Bash(git merge *)",
			"Bash(git rebase *)"
		],
		"deny": [
			"Bash(rm -rf *)",
			"Bash(git push --force *)",
			"Bash(git push -f *)",
			"Bash(git reset --hard *)",
			"Bash(git clean -fd *)",
			"Bash(sudo *)",
			"Read(./.env)",
			"Read(./.env.*)",
			"Read(./secrets/**)"
		]
	}
}
`;

/** Read-only goal inspector seeded next to CLAUDE settings (no arbitrary python3 -c). */
export const CADRE_INSPECT_GOAL_WORKSPACE_PY = `#!/usr/bin/env python3
"""Read-only Cadre / goal-workspace inspector for Claude Code."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_goal(root: Path) -> dict:
    path = root / "workspace.goal.json"
    if not path.is_file():
        raise FileNotFoundError(f"missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def summarize(root: Path) -> dict:
    goal = load_goal(root)
    surfaces = goal.get("surfaces") or []
    plan_dir = root / ".agent" / "surfaces"
    tree_dir = root / ".agent" / "task-trees"
    plans = sorted(p.name for p in plan_dir.glob("*.plan.md")) if plan_dir.is_dir() else []
    proposals = sorted(p.name for p in tree_dir.glob("*.graph-proposal.json")) if tree_dir.is_dir() else []
    return {
        "root": str(root.resolve()),
        "goal_keys": sorted(goal.keys()),
        "surfaces": [
            {
                "id": s.get("id"),
                "name": s.get("name"),
                "path": s.get("path"),
                "purpose": s.get("purpose"),
            }
            for s in surfaces
            if isinstance(s, dict)
        ],
        "plans": plans,
        "proposals": proposals,
        "has_claude_md": (root / "CLAUDE.md").is_file(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="Workspace root (default: cwd)")
    parser.add_argument("--json", action="store_true", help="Print JSON only")
    args = parser.parse_args(argv)
    root = Path(args.root).expanduser().resolve()
    try:
        summary = summarize(root)
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(summary, indent=2))
        return 0
    print(f"root: {summary['root']}")
    print(f"goal keys: {', '.join(summary['goal_keys'])}")
    print(f"CLAUDE.md: {'yes' if summary['has_claude_md'] else 'no'}")
    print("surfaces:")
    for surface in summary["surfaces"]:
        print(f"  {surface.get('id')} -> {surface.get('path')} | {surface.get('purpose')}")
    if summary["plans"]:
        print("plans:", ", ".join(summary["plans"]))
    if summary["proposals"]:
        print("proposals:", ", ".join(summary["proposals"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

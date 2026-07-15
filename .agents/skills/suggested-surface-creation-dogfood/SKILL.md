---
name: suggested-surface-creation-dogfood
description: >-
  Dogfood suggested surface creation from the Console view: click a starter
  surface card, run the generated task tree through Continue Next / Run All,
  and verify blueprint, manifest, task-tree JSON, scaffold, and preview output.
  Use when asked to create a surface from Console, dogfood starter cards,
  prove suggested-surface creation works end to end, or verify task-tree build
  output after clicking Marketing, Booking, or another starter surface.
---

# Suggested Surface Creation Dogfood

Runtime dogfood of the Console → suggested starter card → task tree → verified output loop. Prefer real workbench evidence over static code inspection.

## Target flow

1. Open **Console** (UI mode), not Code.
2. Click a **suggested starter surface** card (not New Surface / Import Repo unless the user asks).
3. Confirm the surface task tree appears and is bound to that surface.
4. Drive the tree with **Continue Next** and/or **Run All**.
5. Verify durable artifacts and UI output match what the product claims.

Default starter when the user does not name one: **Marketing Site** (`marketing`).

Starter ids: `marketing`, `booking`, `client-portal`, `trainer-admin`, `analytics`, `content-scheduler`, `ads-manager`, `subscriptions`.

## Prerequisites

- Built product (`npm run compile` or active `npm run watch`).
- Disposable goal workspace (do not use the vscode repo itself unless the user insists).
- `launch` skill for isolated Code OSS + `@playwright/cli` over CDP.

```bash
mkdir -p /tmp/gc-surface-dogfood
TMPDIR=/tmp .agents/skills/launch/scripts/launch.sh -- /tmp/gc-surface-dogfood
```

Use a unique `PW_SESSION` on every Playwright call. Attach to the workbench target, not `about:blank` or a webview.

## Workflow checklist

Copy and track:

```
Surface creation dogfood:
- [ ] 1. Console visible with starter grid
- [ ] 2. Clicked suggested starter card
- [ ] 3. Surface selected; Task Tree main view active
- [ ] 4. Blueprint + manifest + task-tree JSON on disk
- [ ] 5. Continued / ran task tree leaves
- [ ] 6. Verified output (files, statuses, preview or honest blocker)
```

### 1. Start at Console

- Ensure mode is **Console** / UI (toggle via the Console/Code control if needed).
- Confirm the guided builder / starter grid is visible: `.custom-mode-ui-surface-starter-grid` and cards `.custom-mode-ui-surface-starter-card`.
- Screenshot: Console with suggested surfaces visible.
- Save under `screenshots/surface-creation-dogfood-<YYYYMMDD-HHMMSS>/`.

If the workspace already has that starter scaffolded, a card click only selects the surface and loads its tree — it will not recreate. Prefer a clean disposable workspace, or pick an unused starter.

### 2. Click a suggested surface

- Click the starter card whose title matches the chosen surface (e.g. "Marketing Site").
- Do **not** use the tree-icon button on the card unless the user only wants the core build plan without full creation handoff.
- Expected after click (`beginSurfaceHandoff` → `draftSurfacePrompt` when not yet scaffolded):
  - Surface registered and selected
  - Main view switches to **Task Tree**
  - Notification roughly: "{name} task tree is ready. Continue the next task or run all."
- Screenshot: selected surface with Task Tree panel and controls.

### 3. Confirm task-tree readiness

Before running leaves, verify:

| Check | Where |
|-------|--------|
| Blueprint | `<ws>/.agent/surfaces/<surfaceId>.blueprint.json` |
| Manifest entry | `<ws>/workspace.goal.json` includes `id`, `name`, `path` for the surface |
| Task tree | `<ws>/.agent/task-trees/*.json` with matching `surfaceId` / `surfaceName` / `templateId` |
| UI | Task Tree panel shows roots/leaves, progress, **Continue Next**, **Run All**, Pause/Resume/Retry/Skip |

Cross-check UI labels against JSON: title, leaf names, status, current task.

### 4. Run through the task tree

Prefer the surface panel controls:

1. Click **Continue Next** once; wait for the leaf to finish (`complete`, `blocked`, or `failed`).
2. Screenshot after the first leaf transition.
3. Either keep **Continue Next** through remaining leaves, or click **Run All**.
4. On `blocked` / `failed`: capture the error/verification note; **Retry** once if the failure looks transient; otherwise record the honest blocker.
5. Re-read the task-tree JSON after each meaningful transition.

Do not claim autonomous code execution succeeded unless leaves record changed files, tool/transcript evidence, and verification notes in persisted state.

If the executor is a known stub or chat is unsigned-in, score that as a blocked product loop — still verify creation artifacts from steps 1–3.

### 5. Verify correct output

Pass criteria (all must be checked; mark each pass/partial/fail):

**Creation artifacts**

- [ ] Blueprint exists and matches the starter template id
- [ ] `workspace.goal.json` lists the surface with a workspace-relative `path` (usually `apps/<surfaceId>`)
- [ ] Task tree JSON is bound to the surface and survives reload/reselect
- [ ] Starter card status updates (Created / Running) when scaffolded or active

**Task-tree execution**

- [ ] At least one leaf transitions out of `pending` after Continue Next
- [ ] Progress percent / completed count match leaf statuses in JSON
- [ ] `in_progress` is persisted before execution completes
- [ ] Completed siblings are not wiped by a later blocked/failed leaf

**Product output** (when leaves claim to build)

- [ ] Expected paths under `apps/<surfaceId>/` exist (at minimum scaffold signals such as `package.json` when the tree intends scaffold)
- [ ] Changed files listed on completed leaves exist on disk
- [ ] Preview / local URL loads real app content when the tree is complete and a preview is claimed — not a blank iframe or error page
- [ ] Optional: command palette **Verify Goal Workspace Surface Blueprint** or unit grep `surfaceBlueprintVerify` / `agentTaskTree` when useful

## Selectors and commands (fragile — re-snapshot if stale)

UI:

- Starter grid: `.custom-mode-ui-surface-starter-grid`
- Starter card: `.custom-mode-ui-surface-starter-card` (title text = surface name)
- Task Tree toggle: button labeled `Task Tree`
- Controls: `Continue Next`, `Run All`, `Pause`, `Resume`, `Retry`, `Skip`

Implementation anchors:

- `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts` — `STARTER_SURFACES`, `beginSurfaceHandoff`, `draftSurfacePrompt`
- `src/vs/workbench/contrib/custom/browser/surfaceTaskTreePanel.ts` — panel controls
- `src/custom/agentTaskTree/agentTaskTreeService.ts` — generate / continue / runAll / persistence
- `src/custom/goalWorkspace/surfaceBlueprintService.ts` — blueprint create/register

## Scoring (0–5)

| Score | Meaning |
|-------|---------|
| 0 | Cannot reach Console or starter grid |
| 1 | Cards visible but click does not create/select a surface tree |
| 2 | Surface + tree created, but Continue Next does nothing useful |
| 3 | Creation artifacts solid; at least one leaf runs with UI/JSON agreement; executor may block |
| 4 | Full loop through most leaves with consistent persistence and screenshots |
| 5 | Tree completes into real scaffold/preview with clean verification and no material mismatches |

## Report format

```markdown
# Suggested Surface Creation Dogfood

## Summary
[1-2 sentences: which starter, what worked, score]

## Score: X / 5

## Flow
| Step | Result | Screenshot | Disk evidence |
|------|--------|------------|---------------|
| Console + starter grid | pass/partial/fail | ... | — |
| Click suggested surface | ... | ... | blueprint / manifest |
| Task tree ready | ... | ... | `.agent/task-trees/...` |
| Continue Next / Run All | ... | ... | leaf statuses |
| Output verification | ... | ... | apps/ + preview |

## Findings
### P0
- ...
### P1
- ...
### P2/P3
- ...

## What works
- ...

## Gaps / blockers
- ...

## Validation performed
- [ ] launch + Playwright screenshots
- [ ] blueprint / manifest / task-tree JSON cross-check
- [ ] leaf execution evidence
- [ ] scaffold or preview check (or documented blocker)
```

Do not implement product fixes during dogfood unless the user explicitly asks after the report.

# Primary CTA runtime evaluation

**Workspace:** scratchpad `console-ws` (Cadre AI planning artifacts present)  
**CDP:** `55219` · **Session:** `pctas-55219`  
**Date:** 2026-07-18  

## Score: **4 / 5**

Primary Console CTAs are wired and mostly work with screenshot proof. Gaps: Start App not proven after navigation race; task-tree Continue/Run All not present in this workspace state; Claude pane still shows empty placeholder on Plan home.

## Acceptance checks

| CTA | Result | Evidence |
|---|---|---|
| Plan home + progress rail + suggested cards | **PASS** | `02-plan-home.png` — progress DONE→CURRENT Review; 3 suggested cards; Start workspace planning |
| Code ↔ ← Console | **PASS** | `03c-code-mode.png` — Code mode, only `← Console` (Code pill hidden); `04b-back-*` returned to Console |
| Suggested surface card → open Plan | **PASS** | `08-suggested-card.png` — toast “Opened Cadre AI Support Chatbot”; surface sections + plan tracker |
| Run next phase (Phase 1 CTA) | **PASS** | Toast “Sent next step to Claude: Phase 1 — Scaffold + shell” (`06-phase-after.json`, visible in `06-phase-cta.png`) |
| Start App | **UNPROVEN** | Click registered (`07-start-app.json`) but subsequent UI was Plan home (`07-start-app.png`); no localhost/preview proof |
| Continue Next / Run All | **N/A** | Not visible on Cadre Bot surface in this state (`05b-surface-eval.json`) |

## Findings (severity order)

### P2 — Start App not verified end-to-end
- **Evidence:** `07-start-app.json` clicked=true; `07-start-app.png` shows Plan home, not preview.
- **Expected:** Dev server start + preview/progress feedback.
- **Recommendation:** Re-test while staying on the open surface; wait longer for server boot; assert Preview section / localhost URL.

### P2 — Task-tree primary CTAs absent in this workspace
- **Evidence:** `05b-surface-eval.json` — no Continue Next / Run All buttons.
- **Expected:** When a tree exists, those controls appear.
- **Recommendation:** Dogfood on a surface with an active task-tree binding; do not treat as a Console wiring failure yet.

### P3 — Claude pane empty placeholder on Plan home
- **Evidence:** `02-plan-home.png` — “Claude will appear here when you create a New Surface.”
- **Expected:** After workspace-plan kickoff, Claude session should remain attached/visible.
- **Note:** Kickoff status / progress rail still work; pane host may not re-attach after session restore.

### P3 — Synthetic DOM `.click()` on Code rail sometimes no-ops
- **Evidence:** First eval click left `modeCode:false`; Playwright role click succeeded.
- **Recommendation:** Prefer real pointer events in automation; low user impact.

## Console / runtime
- Workbench healthy: 1440×900, rail + Claude host present (`dom-health.json`).
- Pre-existing console noise (~60 errors / ~120 warnings) — mostly extension/auth/webview warnings; no blank-screen / import failure observed during CTA pass.
- Docker Desktop warning toast present (Ix-related; not blocking these CTAs).

## Screenshots
All under `screenshots/runtime-eval-primary-ctas-20260718-222408/`.

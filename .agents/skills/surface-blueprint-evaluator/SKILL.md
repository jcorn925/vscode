---
name: surface-blueprint-evaluator
description: Evaluate whether the goal-workspace surface blueprint plan-verify loop is implemented correctly. Use when reviewing surface generation, subsystem templates, blueprint persistence, Ix verification, auto-repair handoff, or customAi verifySurfaceBlueprint tooling.
---

# Surface Blueprint Evaluator

Audit the **plan → scaffold → verify → auto-repair** surface generation pipeline.

## Target behavior

1. **Templates** — bundled subsystem maps for every UI starter surface id (`marketing`, `booking`, `client-portal`, `trainer-admin`, `analytics`, `content-scheduler`, `ads-manager`, `subscriptions`, plus `custom`).
2. **Blueprint** — clicking a starter writes `.agent/surfaces/<surface-id>.blueprint.json` before scaffold.
3. **Agent workflow** — Custom AI prompt enforces blueprint-first ordering and `verifySurfaceBlueprint` before claiming complete.
4. **Verifier** — deterministic checks (manifest fields, subsystem paths, scaffold files, product-usefulness acceptance criteria) plus optional Ix discovery match.
5. **Auto-repair** — verification failure injects a repair prompt into the fixed right chat column (max 2 attempts).

## Evaluation workflow

1. **Locate implementation**
   - `src/custom/goalWorkspace/surfaceBlueprintTypes.ts`
   - `src/custom/goalWorkspace/surfaceBlueprintTemplateRegistry.ts`
   - `src/custom/goalWorkspace/surfaceBlueprintService.ts`
   - `src/custom/goalWorkspace/surfaceBlueprintVerify.ts`
   - `src/custom/goalWorkspace/surfaceIxMatch.ts`
   - `src/custom/goalWorkspace/surfaceBlueprintOrchestrator.ts`
   - `src/custom/ai/browser/customAiVerifySurfaceBlueprintTool.ts`
   - `src/vs/workbench/contrib/custom/browser/surfaceBlueprint.contribution.ts`
   - `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts` (`draftSurfacePrompt`)
   - `src/custom/goalWorkspace/surfaceBuilderHandoffState.ts`

2. **Template coverage**
   - `listSurfaceTemplateIds()` includes every `STARTER_SURFACES` id from `modeShell.contribution.ts`.
   - Each template has 4–8 subsystems with Next.js paths under `apps/<id>/`.
   - Manifest defaults include `capabilities`, `events`, `entities`, `ixSubsystems`.
   - Core product templates (`marketing`, `booking`, `client-portal`, `trainer-admin`) include an explicit `acceptance` contract with required routes, workflows, UI signals, business terms, minimum file count, minimum line count, and minimum interactive controls.

3. **Handoff wiring**
   - Starter click creates blueprint from template and attaches blueprint + `workspace.goal.json` to chat.
   - Phase-1 prompt says finalize blueprint only (no scaffold).
   - `SurfaceBuilderHandoffState` includes `templateId`, `surfaceId`, `phase`, `blueprintResource`.

4. **Verifier**
   - Run unit tests: `scripts/test.sh --grep surfaceBlueprintVerify`
   - Command palette: **Verify Goal Workspace Surface Blueprint**
   - Incomplete fixture returns structured gaps (`missing_path`, `missing_manifest_field`, `missing_required_route`, `thin_implementation`, `missing_workflow_signal`, `missing_business_terms`, `ix_no_match`).
   - A route-only or placeholder scaffold must fail verification even when `workspace.goal.json`, `package.json`, and required route paths exist.
   - `verified` means the scaffold passes the surface acceptance contract; `scaffolded` or `failed` means the app exists but still needs product generation or repair.

5. **Agent tools and prompts**
   - `verifySurfaceBlueprint` tool registered in `customAi.contribution.ts`.
   - `CUSTOM_AI_PRODUCT_SYSTEM_PROMPT` mentions blueprint path and verify tool.
   - Followups differ by handoff phase (`blueprint`, `scaffold`, `repair`).

6. **Auto-repair**
   - Failed verification triggers repair chat input with gap report.
   - After 2 repair attempts, user sees a warning notification (no infinite loop).

## Anti-patterns (flag as P1)

- Scaffolding without persisted blueprint file
- Blueprint labels with no token/path overlap for Ix matching
- Verifier only checks `workspace.goal.json`, not subsystem paths
- Verifier only checks file/path existence and lets placeholder pages pass as product-ready
- No auto-repair path when verification fails
- Missing template for a starter surface id
- Agent allowed to claim surface complete without calling verify tool
- Dogfood run declared successful without full file list, line counts, rendered UI evidence, or `scripts/score_goal_workspace.py` output

## Score (0–5)

- `0` — Not implemented
- `1` — Types/templates only, no handoff or verifier wiring
- `2` — Blueprint + verifier exist, agent workflow incomplete
- `3` — End-to-end wired with gaps in Ix matching or repair loop
- `4` — Strong match; minor polish issues
- `5` — Shippable plan-verify loop with product-usefulness acceptance tests, scorer command, and repair path

## Report format

Lead with P0–P3 findings (evidence, expected, recommendation), then overall score, what matches, highest-leverage fixes, and validation performed.

Do not implement fixes unless the user explicitly asks after the evaluation.

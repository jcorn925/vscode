---
name: surface-task-tree-progress-evaluator
description: Evaluate the Surface Task Tree Progress View in this VS Code fork, including per-surface task-tree binding, preview/task-tree toggle behavior, progress controls, persistence, and screenshot-backed UI evidence. Use when auditing, reviewing, scoring, QAing, or validating the surface task tree progress feature after implementation.
---

# Surface Task Tree Progress Evaluator

## Overview

Evaluate whether the per-surface task-tree progress view works as intended in the Console UI. Produce an evidence-based report with code references, test results, and screenshots that prove UI reasoning rather than relying only on static inspection.

## Evaluation Workflow

### 1. Ground The Implementation

Read the relevant implementation before running the UI:

- `src/custom/agentTaskTree/agentTaskTreeTypes.ts`
- `src/custom/agentTaskTree/agentTaskTreeService.ts`
- `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts`
- `src/vs/workbench/contrib/custom/browser/test/agentTaskTreeService.test.ts`

Use `rg` to confirm whether these expected concepts exist:

- `surfaceId`, `surfaceName`, `templateId` on `AgentTaskTree`
- `loadLatestTaskTreeForSurface`
- `IAgentTaskTreeService` injected into the mode shell
- task-tree/preview toggle UI
- task-tree render path and controls
- `onDidChangeTaskTree` subscription
- tests for surface metadata and per-surface lookup

### 2. Run Focused Checks

Run the smallest useful checks first:

```bash
./scripts/test.sh --grep agentTaskTreeService
npm run typecheck-client
```

If full typecheck is too slow, report that clearly and run a narrower compile/test command if available in the repo.

### 3. Capture Runtime Screenshots

Screenshots are required unless the UI cannot be launched. If screenshots cannot be captured, explain the blocker and provide the strongest substitute evidence.

When launching Code OSS, use the repo's launch workflow or the `launch` skill if available in the current session. Use a disposable goal workspace fixture, not the user's active project, unless the user explicitly asks otherwise.

Capture at least these screenshots:

1. **Builder or starter surface state**: proves the surface card flow is reachable.
2. **Selected surface with Task Tree active**: proves the tree is visible after selecting/pressing a surface.
3. **Preview toggle active**: proves the same selected surface can switch back to the running preview or preview placeholder.
4. **Blocked/failed or current-task state** when feasible: proves progress and controls are visible.

Save screenshot files in a temp or artifacts directory and include Markdown image links in the report using absolute paths.

### 4. Evaluate Acceptance Criteria

Score each item `pass`, `partial`, or `fail` with evidence.

#### Per-Surface Persistence

- `AgentTaskTree` stores optional `surfaceId`, `surfaceName`, and `templateId`.
- New trees generated from a surface handoff are bound to that surface.
- `loadLatestTaskTreeForSurface(surfaceId)` returns the newest bound tree and ignores unbound or other-surface trees.
- Old unbound task-tree files remain parseable.

#### Surface Selection And Visibility

- Pressing a starter surface creates or loads the surface task tree.
- Selecting an existing generated surface tab loads its bound tree.
- The task-tree view is visible for real selected surfaces.
- The task-tree toggle is hidden for the guided builder / `New Surface` state.
- Tree view updates when `onDidChangeTaskTree` fires for the selected surface.

#### Toggle And Preview Behavior

- `Task Tree | Preview` toggle is present and accessible.
- Switching to `Preview` preserves existing iframe/webview routing.
- Switching back to `Task Tree` does not clear the preview URL or stop the dev server.
- Active/paused/blocked/failed trees default to task-tree view.
- Complete trees with reachable preview default to preview view.

#### Progress Rendering And Controls

- Tree renders roots, branches, leaves, current task, and status glyphs.
- Overall progress percentage is derived from leaf completion.
- Changed files, commands, verification notes, and errors render when present.
- `Resume`, `Continue Next`, `Pause`, `Retry`, and `Skip` call the service methods.
- Retry/skip controls are available on blocked or failed leaves.

#### Visual Quality

- Layout is workbench-native, compact, and scannable.
- No UI text overlaps in the selected desktop viewport.
- Controls have stable dimensions and do not shift the preview frame.
- Empty/no-tree states are explicit and actionable.

## Severity Guide

- **P0**: Task tree is not visible after selecting a surface; preview toggle breaks routing; per-surface persistence loses or corrupts task trees.
- **P1**: Tree loads globally instead of per surface; controls call the wrong service method; updates do not react to persisted status changes; default view logic is wrong.
- **P2**: Missing metadata in UI, weak empty states, incomplete tests, accessibility labels missing, progress percent misleading.
- **P3**: Cosmetic polish issues that do not block evaluation of progress or preview switching.

## Scoring

Use a 0-5 score:

- **0**: Not implemented.
- **1**: Static UI or metadata only; no real per-surface task-tree loading.
- **2**: Per-surface persistence works, but UI/toggle is incomplete.
- **3**: MVP works with visible tree, preview toggle, and basic controls; test or screenshot gaps remain.
- **4**: Strong implementation with tests, runtime screenshots, robust update behavior, and usable controls.
- **5**: Shippable implementation with reliable autonomous progress updates, polished UI, complete tests, and no material runtime issues.

## Report Format

Return this structure:

```markdown
# Surface Task Tree Progress View Evaluation

## Summary
[1-2 sentences with readiness and score]

## Score: X / 5

## Screenshot Evidence
![Builder or surface cards](/absolute/path/to/screenshot-1.png)
![Task tree active](/absolute/path/to/screenshot-2.png)
![Preview active](/absolute/path/to/screenshot-3.png)

## Checklist Results
| Area | Status | Evidence |
|------|--------|----------|
| Per-surface persistence | pass/partial/fail | file/test/screenshot evidence |
| Surface selection visibility | pass/partial/fail | ... |
| Toggle and preview behavior | pass/partial/fail | ... |
| Progress rendering and controls | pass/partial/fail | ... |
| Tests | pass/partial/fail | ... |
| Visual quality | pass/partial/fail | ... |

## Findings
### P0
- ...
### P1
- ...
### P2 / P3
- ...

## Test Results
- `command`: result summary

## Residual Risk
[Known gaps, launch blockers, or untested scenarios]
```

Do not implement fixes during evaluation unless the user explicitly asks for fixes.

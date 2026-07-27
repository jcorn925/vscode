---
name: agent-task-tree-proof-evaluator
description: Evaluate whether the Persistent Task-Tree Agent Loop works in the running Babadaba/VS Code fork, with screenshot-backed evidence. Use when asked to prove the task-tree feature works, audit runtime behavior, compare UI state to persisted .agent/task-trees JSON, capture screenshots for reasoning, or produce an evidence-based score for task-tree generation, persistence, resume, continue, pause, retry, skip, and surface-panel progress behavior.
---

# Agent Task Tree Proof Evaluator

Evaluate the task-tree feature as a working product surface, not only as code. Every conclusion must tie back to observable evidence: screenshots, persisted JSON, command output, tests, or source references.

## Evidence Rules

- Capture screenshots before making runtime claims about the UI.
- Save screenshots under `screenshots/task-tree-proof-<YYYYMMDD-HHMMSS>/`.
- Include screenshot paths in the final report using absolute filesystem paths.
- Prefer screenshots of the actual running workbench. If launch is blocked, state the blocker and use static HTML or existing screenshots only as fallback evidence.
- Do not treat a screenshot alone as proof of persistence. Cross-check it against `.agent/task-trees/*.json`.
- Do not claim autonomous code execution works unless a leaf produces changed files, commands/tool calls, and verification in persisted state.

## Required Workflow

### 1. Establish Baseline

Inspect the implementation and current git state.

Read or grep:

- `src/custom/agentTaskTree/agentTaskTreeTypes.ts`
- `src/custom/agentTaskTree/agentTaskTreeService.ts`
- `src/custom/agentTaskTree/surfaceTaskTreeUiHelpers.ts`
- `src/vs/workbench/contrib/custom/browser/agentTaskTree.contribution.ts`
- `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts`
- `src/vs/workbench/contrib/custom/browser/surfaceTaskTreePanel.ts`
- `src/vs/workbench/contrib/custom/browser/test/*taskTree*.test.ts`
- `src/vs/workbench/workbench.common.main.ts`

Record:

- current branch and commit
- whether there are unrelated local changes
- whether the feature is registered in the workbench
- whether the surface panel and command-palette paths both exist

### 2. Run Automated Checks

Use the narrowest checks that validate the feature.

Recommended:

```bash
npm run gulp -- compile-client --max_old_space_size=8192
./scripts/test.sh --grep agentTaskTree
git diff --check
```

If a command is too expensive or blocked, report that directly and substitute the closest available check.

### 3. Prepare Runtime Evidence

Use the `launch` skill when evaluating the running VS Code/Babadaba workbench.

Launch an isolated throwaway workspace when possible:

```bash
mkdir -p /tmp/babadaba-task-tree-proof
TMPDIR=/tmp .agents/skills/launch/scripts/launch.sh -- /tmp/babadaba-task-tree-proof
```

If macOS socket path length errors occur, force a shorter `TMPDIR`, such as `/tmp`.

Capture at least two screenshots when the UI is reachable:

- a generated or loaded task tree in the UI
- a state transition after `Continue Next`, `Pause`, `Resume`, `Retry`, or `Skip`

Useful screenshot targets:

- Command Palette / quick-pick task tree
- Console surface panel with the `Task Tree` tab active
- right-side Custom AI/task plan copy if visible
- persisted progress state after a command

### 4. Verify Persistence Against UI

Locate the active tree file:

```bash
find <workspace>/.agent/task-trees -type f -name '*.json' -print
```

Compare UI and JSON:

- tree title/prompt
- root and leaf names
- current leaf
- progress percentage or completed count
- completed leaves
- blocked/failed leaves
- changed files
- verification notes
- cursor fields
- tree status

Flag mismatches as product bugs, even if service tests pass.

### 5. Exercise Core Actions

Evaluate these behaviors, with screenshots where the UI changes:

- Generate: creates `.agent/task-trees/{treeId}.json` immediately.
- Show: renders roots, branches/leaves, statuses, changed files, and verification.
- Continue Next: persists `in_progress` before execution and then `complete`, `blocked`, or `failed`.
- Pause: sets tree status to `paused` and disables or changes available actions appropriately.
- Resume: loads existing state without regenerating the tree.
- Retry: resets a failed/blocked/in-progress leaf without clearing completed siblings.
- Skip: marks the selected/retryable leaf as skipped with notes when available.
- Surface panel: shows per-surface progress and current task when a surface has a task tree.

If the default executor is still a blocking stub, expected runtime behavior is `blocked`, not a full code-editing pass. Score that honestly.

## Scoring

Score 0-5.

| Score | Meaning |
|-------|---------|
| 0 | Feature absent or not registered |
| 1 | Static UI or types only; no durable tree state |
| 2 | Durable state exists, but runtime controls or UI proof are weak |
| 3 | MVP works: generate/load/show/continue/pause/resume operate with persisted JSON; executor may block |
| 4 | Strong runtime loop: UI and JSON stay consistent across retry/skip/resume; tests pass; screenshots prove state transitions |
| 5 | Full product loop: Custom AI executes leaves into real code, records transcript/tool evidence, verifies changed files, and resumes reliably after restart |

## Severity Guide

P0:

- Resume regenerates or overwrites task state.
- `in_progress` is not persisted before execution.
- Completed sibling progress is erased by failed/blocked leaves.
- UI claims progress that persisted JSON does not support.
- No screenshot or runtime evidence is captured for UI claims.

P1:

- Commands are missing or not registered.
- Continue/pause/resume works in service tests but cannot be operated from UI.
- Current task/cursor shown in UI disagrees with JSON.
- Surface panel omits task-tree progress for surfaces with attached trees.
- Tests do not cover persistence boundaries.

P2/P3:

- UI is functional but hard to read.
- Screenshots do not show enough context.
- Executor is a documented blocking stub.
- Report lacks exact file/test references.

## Report Format

Use this format:

```markdown
# Task Tree Proof Evaluation

## Summary
[1-2 sentence verdict]

## Score: X / 5

## Evidence
| Evidence | Path / Command | What it proves |
|----------|----------------|----------------|
| Screenshot | ![label](/absolute/path.png) | ... |
| JSON | /absolute/path/.agent/task-trees/tree.json | ... |
| Test | ./scripts/test.sh --grep agentTaskTree | ... |
| Source | /absolute/path/file.ts:line | ... |

## Runtime Flow
| Step | Result | Screenshot | Persisted State |
|------|--------|------------|-----------------|
| Generate/load | pass/partial/fail | ... | ... |
| Show tree | ... | ... | ... |
| Continue next | ... | ... | ... |
| Pause/resume | ... | ... | ... |
| Retry/skip | ... | ... | ... |

## Findings
### P0
- ...
### P1
- ...
### P2/P3
- ...

## What Works
- ...

## Gaps
- ...

## Validation Performed
- [ ] compile/typecheck
- [ ] task-tree tests
- [ ] running workbench screenshot
- [ ] JSON/UI cross-check
```

Keep the report evidence-first. Do not implement fixes unless the user explicitly asks.

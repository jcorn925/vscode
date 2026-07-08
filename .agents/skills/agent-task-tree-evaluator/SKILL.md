---
name: agent-task-tree-evaluator
description: Evaluate the Persistent Task-Tree Agent Loop feature — prompt-to-tree generation, durable JSON state, leaf execution loop, resume/pause/retry/skip, and workbench UI. Use when reviewing agent task trees, task-tree persistence, resume behavior, or MVP completeness of the agent loop.
---

# Agent Task Tree Evaluator

Audit the **Persistent Task-Tree Agent Loop**: decompose a feature prompt into a hierarchical task tree, persist progress to disk, execute one leaf at a time, and resume after interruption.

## Feature summary

### Purpose

Give Custom AI (or any agent session) a durable implementation plan that survives crashes, pauses, and new chat sessions. Parent nodes represent modules/workstreams; leaf nodes are concrete build tasks the agent executes independently.

### Core flow

1. User enters a feature prompt.
2. Agent generates a nested task tree (roots → leaves).
3. Tree is saved immediately as durable JSON.
4. Loop selects the next pending leaf (ordered).
5. Leaf is marked `in_progress` and persisted **before** execution.
6. Agent implements the leaf; result records changed files, commands, verification, notes.
7. Leaf is marked `complete` / `failed` / `blocked` and persisted **after** execution.
8. Parent statuses are derived from children.
9. On restart, reload saved tree and continue — do **not** regenerate unless explicitly requested.

### Schema (version 1)

Persisted at `.agent/task-trees/{treeId}.json`:

```ts
type AgentTaskTree = {
  version: 1;
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'active' | 'paused' | 'complete' | 'failed';
  roots: AgentTaskNode[];
  cursor?: { currentNodeId?: string; lastCompletedNodeId?: string };
};

type AgentTaskNode = {
  id: string;
  parentId?: string;
  title: string;
  description?: string;
  type: 'root' | 'branch' | 'leaf';
  status: 'pending' | 'in_progress' | 'blocked' | 'complete' | 'failed' | 'skipped';
  order: number;
  children?: AgentTaskNode[];
  implementation?: {
    startedAt?: string;
    completedAt?: string;
    changedFiles?: string[];
    commandsRun?: string[];
    verification?: string;
    notes?: string;
    error?: string;
  };
};
```

### Expected workbench commands

| Command | ID |
|---------|-----|
| Agent: Generate Task Tree | `custom.agentTaskTree.generate` |
| Agent: Resume Task Tree | `custom.agentTaskTree.resume` |
| Agent: Continue Next Task | `custom.agentTaskTree.continueNext` |
| Agent: Pause Current Task | `custom.agentTaskTree.pause` |
| Agent: Retry Current Task | `custom.agentTaskTree.retryCurrent` |
| Agent: Skip Current Task | `custom.agentTaskTree.skipCurrent` |
| Agent: Regenerate Branch | `custom.agentTaskTree.regenerateBranch` |
| Agent: Show Task Tree | `custom.agentTaskTree.show` |

### MVP scope (in)

- Prompt-to-task-tree generation
- Persistent JSON file per tree
- Next pending leaf selection (ordered; includes resumable `in_progress`)
- Task status lifecycle + parent derivation
- Resume from saved state
- Simple tree UI (quick pick)
- One-task-at-a-time execution
- Changed files and verification notes per task
- Workspace resume detection prompt

### MVP scope (out — flag as future, not P0)

- Parallel task execution
- Dependency solving / DAG scheduling
- Automatic branch regeneration via LLM
- Full sidebar tree view or webview panel
- Custom AI executor wired for autonomous code edits

---

## Evaluation workflow

### 1. Locate implementation

Read these files first:

| Area | Path |
|------|------|
| Types | `src/custom/agentTaskTree/agentTaskTreeTypes.ts` |
| Service + persistence | `src/custom/agentTaskTree/agentTaskTreeService.ts` |
| Commands + UI | `src/vs/workbench/contrib/custom/browser/agentTaskTree.contribution.ts` |
| Workbench import | `src/vs/workbench/workbench.common.main.ts` |
| Unit tests | `src/vs/workbench/contrib/custom/browser/test/agentTaskTreeService.test.ts` |

### 2. Run automated checks

```bash
# Type-check (must pass before claiming complete)
npm run typecheck-client

# Unit tests
./scripts/test.sh --grep agentTaskTreeService
```

Confirm tests cover at minimum:
- Malformed JSON rejected by `parseTaskTree`
- Tree persisted immediately on `generateTaskTree`
- Next-leaf order and skip of completed leaves
- `in_progress` persisted before executor runs
- Success writes `changedFiles`, `verification`, `lastCompletedNodeId`
- Failed/blocked leaf preserves completed siblings
- Parent status derived from children
- Retry/skip affect only target leaf

### 3. Acceptance checklist

Score each item **pass / partial / fail** with evidence (file:symbol or test name).

#### Persistence

- [ ] Trees written to `.agent/task-trees/{id}.json` (uses `AGENT_CONTEXT_FOLDER`, not workspace storage only)
- [ ] `generateTaskTree` saves before returning
- [ ] `continueNextTask` saves before **and** after executor
- [ ] `parseTaskTree` validates `version: 1` and rejects malformed input
- [ ] `loadLatestResumableTaskTree` finds newest `active` or `paused` tree

#### Agent loop

- [ ] `findNextPendingLeaf` returns lowest-order leaf with status `pending` or `in_progress`
- [ ] When no leaves remain, tree status becomes `complete`
- [ ] `deriveParentStatuses` sets parent from children (`failed` > `blocked` > `in_progress` > all complete/skipped → `complete` > else `pending`)
- [ ] Failed/blocked leaf does not reset completed siblings
- [ ] `activeRun` guard prevents concurrent `continueNextTask` calls

#### Lifecycle commands

- [ ] `resumeTaskTree` sets status `active`
- [ ] `pauseTaskTree` sets status `paused`
- [ ] `retryTask` resets target leaf to `pending`, clears error
- [ ] `skipTask` sets `skipped` with optional notes
- [ ] `regenerateBranch` resets branch children to `pending`

#### UI / UX

- [ ] All 8 commands registered and in `Agent` category
- [ ] Show command renders tree with status icons, changed files, verification, errors
- [ ] Resume contribution prompts on workspace open when resumable tree exists
- [ ] Retry/skip resolve target via cursor or first failed/blocked/in_progress leaf

#### Task tree generation

- [ ] Generated tree has multiple workstream roots (planning, core, persistence, agent loop, UI, testing, MVP)
- [ ] Each root has ordered leaf children with descriptions sufficient for a fresh agent session
- [ ] Leaf descriptions include acceptance context (not just titles)

#### Executor integration

- [ ] `AgentTaskExecutor` interface exists and is injectable
- [ ] Default executor behavior documented (blocking stub vs real Custom AI wiring)
- [ ] Task context passed to executor includes full tree + current leaf

### 4. Manual smoke test (when running Code OSS)

1. Open a folder workspace.
2. **Agent: Generate Task Tree** → enter a feature prompt.
3. Confirm `.agent/task-trees/*.json` created.
4. **Agent: Show Task Tree** → verify roots, leaves, statuses.
5. **Agent: Continue Next Task** → confirm leaf moves to `in_progress` then `blocked`/`complete` in JSON.
6. **Agent: Pause Task Tree** → status `paused`.
7. Reload window → resume prompt appears.
8. **Agent: Resume Task Tree** → status `active`.
9. **Agent: Skip Current Task** on a blocked leaf → sibling progress preserved.

---

## Anti-patterns (flag by severity)

| Severity | Anti-pattern |
|----------|--------------|
| **P0** | Task tree regenerated on resume instead of loading saved JSON |
| **P0** | No persist between `in_progress` and executor (crash loses cursor) |
| **P0** | Completed sibling progress erased when sibling fails |
| **P0** | Service not registered in workbench (`workbench.common.main.ts`) |
| **P1** | Missing resume/pause/continue commands |
| **P1** | Parent status stored manually instead of derived |
| **P1** | `findNextPendingLeaf` skips `in_progress` leaves (breaks crash recovery) |
| **P1** | No unit tests for persistence loop |
| **P2** | Tree generation is a single flat list (no workstream roots) |
| **P2** | No workspace resume detection |
| **P2** | Retry only works via cursor, not failed/blocked fallback |
| **P3** | No regenerate-branch command |
| **P3** | UI is quick-pick only (acceptable for MVP) |
| **P3** | Executor still blocking stub (expected until Custom AI wired) |

---

## Score (0–5)

| Score | Meaning |
|-------|---------|
| **0** | Not implemented |
| **1** | Types or stub service only; no persistence |
| **2** | Persistence + next-leaf logic; missing commands or tests |
| **3** | MVP loop works; executor stub; UI minimal but functional |
| **4** | Strong MVP — all commands, resume prompt, tests green; executor still manual |
| **5** | Shippable — Custom AI executor wired, rich tree generation, reliable dogfood |

---

## Report format

Use this structure. Do not implement fixes unless the user explicitly asks after the evaluation.

```markdown
# Agent Task Tree Evaluation

## Summary
[1–2 sentences: overall readiness and score]

## Score: X / 5

## Feature recap
[Short restatement of what the loop does and where state lives]

## Checklist results
| Area | Status | Evidence |
|------|--------|----------|
| Persistence | pass/partial/fail | ... |
| Agent loop | ... | ... |
| Commands | ... | ... |
| UI | ... | ... |
| Tests | ... | ... |
| Executor | ... | ... |

## Findings
### P0
- ...
### P1
- ...
### P2 / P3
- ...

## What matches the spec
- ...

## Highest-leverage gaps
1. ...
2. ...

## Validation performed
- [ ] npm run typecheck-client
- [ ] ./scripts/test.sh --grep agentTaskTreeService
- [ ] Manual smoke test (if applicable)
```

---

## Quick reference: key symbols

| Symbol | Location |
|--------|----------|
| `IAgentTaskTreeService` | `agentTaskTreeService.ts` |
| `generateTaskTree` | Creates tree, persists, fires change event |
| `continueNextTask` | Main one-step loop |
| `findNextPendingLeaf` | Ordered leaf selection |
| `deriveParentStatuses` | Bottom-up parent status |
| `findRetryableLeaf` | Retry/skip target resolution |
| `AgentTaskTreeResumeContribution` | Workspace open resume prompt |
| `BlockingAgentTaskExecutor` | MVP stub until Custom AI connected |

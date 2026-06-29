---
name: milestone-evaluator
description: Evaluate custom fork milestones from .agent/milestones.json, report gaps, and apply suggested fixes. Use when asked to run milestone evaluation, close milestone gaps, or automate milestone-driven development.
---

# Milestone Evaluator

Evaluate each milestone in `.agent/milestones.json`, produce a structured report, and optionally apply fixes.

## Milestones list

**Source of truth:** `.agent/milestones.json`

Each milestone has:
- `id`, `title`, `description`
- `paths` — files to inspect when fixing gaps
- `checks` — automated verifications (see below)

## Quick start

```bash
# Evaluate all milestones (reports only)
npm run milestone:evaluate

# Evaluate and invoke an agent to apply fixes for failing milestones
npm run milestone:evaluate -- --apply

# Single milestone
npm run milestone:evaluate -- --milestone goal-workspace

# Dry-run apply (writes agent task files, does not invoke CLI)
npm run milestone:evaluate -- --apply --dry-run
```

Reports are written to `.agent/milestone-reports/<id>.json`.

## Evaluation workflow

For **each** milestone (or the one passed via `--milestone`):

1. **Run automated checks** from `checks[]` in milestones.json.
2. **Read focus paths** and confirm the feature matches the milestone description.
3. **Identify gaps** — missing files, failing tests, UX bugs, incomplete wiring.
4. **Write report** to `.agent/milestone-reports/<id>.json`:

```json
{
  "milestoneId": "goal-workspace",
  "status": "pass" | "fail" | "partial",
  "checkResults": [ { "check": "...", "passed": true, "detail": "..." } ],
  "gaps": [ "Human-readable gap description" ],
  "suggestedChanges": [
    {
      "summary": "What to change",
      "paths": ["src/..."],
      "steps": ["Concrete edit steps"]
    }
  ]
}
```

5. **If `--apply`:** implement every item in `suggestedChanges` for milestones that did not pass.

## Applying suggested changes

When applying fixes:

1. **Minimize scope** — only edit files needed for the milestone.
2. **Match repo conventions** — read surrounding code before editing.
3. **Run validation** after each milestone:
   - `npm run compile-check-ts-native` for TS changes under `src/`
   - `scripts/test.sh --grep <pattern>` when tests exist for the area
4. **Re-run evaluation** for that milestone before moving on.
5. **Commit** with message: `fix(milestone): <id> — <short summary>`

### Agent invocation

The runner tries these commands in order when `--apply` is set (not `--dry-run`):

1. `codex exec` (if `~/.codex/skills/milestone-evaluator/SKILL.md` or repo skill is available)
2. `cursor agent` (Cursor CLI)
3. Falls back to writing `.agent/milestone-tasks/<id>.md` for manual or Cloud Agent pickup

Override with `MILESTONE_AGENT_CMD='cursor agent -p'` if needed.

## Check types (automated)

| Type | Fields | Meaning |
|------|--------|---------|
| `fileExists` | `path` | File must exist |
| `rgAbsent` | `pattern`, `paths[]` | Pattern must not appear under paths |
| `testGrep` | `pattern`, `script` | Test script with `--grep` must exit 0 |
| `npmScript` | `script` | `npm run <script>` must exit 0 |

Add new check types in `.agents/skills/milestone-evaluator/scripts/run-milestones.mts`.

## Syncing from Codex home

If you maintain the skill at `~/.codex/skills/milestone-evaluator/SKILL.md`, copy updates into this repo path so Cloud Agents and CI use the same instructions:

```bash
cp ~/.codex/skills/milestone-evaluator/SKILL.md .agents/skills/milestone-evaluator/SKILL.md
```

## CI

Manual or scheduled runs: `.github/workflows/milestone-evaluator.yml`

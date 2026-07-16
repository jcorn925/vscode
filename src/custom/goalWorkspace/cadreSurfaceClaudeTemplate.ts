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
   - After verify, open the **Proposal Graph** tab for architecture / phases /
     file+edge review
5. **Batch remaps.** Implement a whole subsystem, then remap once. Do not
   remap after every file (ingest settle is expensive).
6. **Stay in scope.** Only create/edit files under this project root
   (references stay under \`.agent/references/\` and are never copied into apps/).
7. **One surface id — no \`-2\` clones.** Re-plan by overwriting
   \`.agent/surfaces/<surface-id>.plan.md\` and
   \`.agent/task-trees/<surface-id>.graph-proposal.json\` for the **existing**
   surface. Do not invent \`cadre-bot-2\` / sibling ids when research was skipped.
   To throw away a surface, delete it in the Console UI (that removes the
   manifest entry, plan, proposal, and app folder) and create a fresh one.

## Research recipe (planning only)

Draft graph shape from a real comparable repo **first**, then adapt it to this
surface's Plan lock:

1. **Find priors.** Use \`gh search repos\` / \`gh api\` / \`gh repo view\` to pick
   1–2 public repos closest to the locked workflow (not random stars).
2. **Shallow clone** into \`.agent/references/<owner>-<repo>/\` only
   (\`git clone --depth 1 https://github.com/<owner>/<repo> .agent/references/<owner>-<repo>\`).
3. **Map.** \`remap_and_wait\` on that reference directory; note the returned
   \`workspace_id\`.
4. **Draft shape.** Call \`draft_proposal_from_workspace\` with that workspace id,
   \`tree_id\` / \`surface_id\`, and \`rewrite_root_to\` = your app path
   (e.g. \`apps/<surface-id>\`). Prefer writing
   \`.agent/task-trees/<surface-id>.graph-proposal.draft.json\`.
5. **Adapt.** Rewrite the draft against §0 Plan lock: drop out-of-scope nodes,
   rename/re-root paths, add surface-specific files/edges, fill \`architecture\`
   + \`phases\`. Promote the result to
   \`.agent/task-trees/<surface-id>.graph-proposal.json\`.
6. **Cite.** Plan § Research must name the GitHub repos surveyed and say the
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
reads, planning-only GitHub survey, and ix-graph MCP tools.
Write/destructive commands stay gated.

## How to use the docs

| Doc | Role |
|-----|------|
| \`CLAUDE.md\` (this file) | Standing process rules for every surface |
| \`.agent/surfaces/<surface-id>.plan.md\` | Intent, research, plan lock, risks — keep lean |
| \`.agent/task-trees/*.graph-proposal.json\` | Architecture, phased checklist, file/edge targets |
| \`.agent/references/*\` | Shallow clones for planning maps only |

### Plan vs Proposal split

**Plan** (\`.agent/surfaces/<id>.plan.md\`) — narrative only:

- §0 Plan lock
- Problem / intent
- Research (planning-only; cite GitHub priors + Ix draft step)
- Risks / deferrals
- **Last section:** link to the Proposal Graph (path of the paired
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
3. You report: proposal node recall, missing proposed nodes, and what you deferred.
`;

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
		`In Research: survey 1-2 comparable public GitHub repos (gh search/api), shallow-clone into .agent/references/, remap_and_wait, draft_proposal_from_workspace (write ${proposalPath.replace('.json', '.draft.json')}), then adapt that draft to the Plan lock.`,
		`End the plan with a Proposal Graph section that links to ${proposalPath} — do not put architecture trees or phased checklists in the plan.`,
		`Then write ${proposalPath} as the verification contract: architecture notes, phases (phased checklist with remap_and_wait/compare_proposal gates), file: nodes, and structural edges adapted from the reference draft; set plan_ref to "${planPath}".`,
		`Do not scaffold application code yet — plan + proposal only. Do not copy reference source into apps/.`,
		`When those two artifacts exist, summarize what you wrote (including which repos informed the draft) and stop for human review.`,
	].join(' ');
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
			"Bash(jq *)",
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

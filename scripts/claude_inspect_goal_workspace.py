#!/usr/bin/env python3
"""Read-only Cadre / goal-workspace inspector for Claude Code.

Prefer this over ad-hoc ``python3 -c`` so project permission rules can allow
a fixed script without granting arbitrary Python execution.

Usage:
  python3 scripts/claude_inspect_goal_workspace.py
  python3 scripts/claude_inspect_goal_workspace.py --json
  python3 .claude/scripts/inspect_goal_workspace.py --root /path/to/workspace
"""

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
    except Exception as exc:  # noqa: BLE001 — CLI fail-closed
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

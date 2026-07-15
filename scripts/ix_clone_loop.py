#!/usr/bin/env python3
"""Agent clone repair loop.

Closes the loop around scripts/ix_graph_compare.py: compare a clone
workspace against a reference workspace in the live ix ArangoDB graph, and
when the comparison fails its recall thresholds, hand the gap list to a
headless coding agent (claude CLI by default) as a repair prompt, re-map the
clone with `ix map`, wait for the ingest to settle, and compare again —
iterating until the thresholds pass or --max-iterations is exhausted.

Repair mode only (v1): the agent fixes an existing clone directory and may
inspect the reference directory when --reference-dir is provided.

Same conventions as ix_scaffold_check.py / ix_graph_compare.py:

- Python 3.12+ standard library only.
- Fail closed: agent crashes/timeouts, unresolvable or empty clone
  workspaces, and ingests that never settle raise ``CloneLoopError`` and
  exit nonzero. Stale state is never compared silently.
- Deterministic JSON artifacts (no timestamps in content): per-iteration
  prompt.md / agent-output.txt / compare.json plus a top-level summary.json.

Usage:
    python3 scripts/ix_clone_loop.py \
        --reference-workspace b9d6d937 \
        --clone-dir /tmp/graph-compare-test/rebuild \
        --reference-dir /tmp/graph-compare-test/original \
        --max-iterations 3 --min-node-recall 1.0 --min-edge-recall 0
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ix_graph_compare as igc  # noqa: E402

DEFAULT_AGENT_CMD = "claude -p --permission-mode acceptEdits"
DEFAULT_AGENT_TIMEOUT = 600.0
DEFAULT_MAP_TIMEOUT = 180.0
DEFAULT_INGEST_TIMEOUT = 120.0
DEFAULT_POLL_INTERVAL = 5.0
DEFAULT_MAX_ITERATIONS = 3
DEFAULT_RUN_DIR_BASE = ".ix-scaffold/clone-loop"

_sleep = time.sleep


class CloneLoopError(Exception):
    """Hard failure: agent unavailable/crashed, workspace unresolvable, ingest stale."""


# --------------------------------------------------------------------------
# Subprocess seams (tests monkeypatch these)
# --------------------------------------------------------------------------


def _run_agent(cmd: list[str], prompt: str, cwd: Path, timeout: float) -> str:
    """Run the headless agent with the repair prompt on stdin."""

    try:
        result = subprocess.run(
            cmd, input=prompt, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as exc:
        raise CloneLoopError(f"Agent command not found: {cmd[0]!r} is not installed or not on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise CloneLoopError(f"Agent timed out after {timeout}s.") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:1000]
        raise CloneLoopError(f"Agent exited with code {result.returncode}: {detail}")
    return result.stdout


def _run_ix_map(clone_dir: Path, timeout: float = DEFAULT_MAP_TIMEOUT) -> None:
    try:
        result = subprocess.run(
            ["ix", "map", ".", "--silent"], cwd=clone_dir, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as exc:
        raise CloneLoopError("Ix is not installed or not on PATH (`ix map` failed to start).") from exc
    except subprocess.TimeoutExpired as exc:
        raise CloneLoopError(f"`ix map .` timed out after {timeout}s in {clone_dir}.") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:1000]
        raise CloneLoopError(f"`ix map .` failed with exit code {result.returncode}: {detail}")


# --------------------------------------------------------------------------
# Workspace resolution + ingest settling
# --------------------------------------------------------------------------

COUNT_CANONICAL_NODES_AQL = """
FOR n IN nodes
  FILTER n.workspace_id == @workspace
  FILTER n.deleted_rev == null
  FILTER n.kind IN @kinds
  COLLECT WITH COUNT INTO c
  RETURN c
"""


def count_canonical_nodes(
    endpoint: str, db: str, workspace_id: str, kinds: tuple[str, ...], timeout: float
) -> int:
    rows = igc._arango_query(
        endpoint, db, COUNT_CANONICAL_NODES_AQL,
        {"workspace": workspace_id, "kinds": list(kinds)},
        timeout=timeout,
    )
    if not rows:
        return 0
    try:
        return int(rows[0])
    except (TypeError, ValueError) as exc:
        raise CloneLoopError(f"Unexpected node-count result from Arango: {rows[0]!r}") from exc


def resolve_clone_workspace(clone_dir: Path, explicit: str | None, ix_config_path: Path) -> str:
    """Resolve the clone's workspace id, preferring an explicit id.

    Falls back to matching ``root_path`` entries in ~/.ix/config.yaml.
    Ambiguity or no match fails closed — the dry run showed `ix map` can
    attribute nodes to a different id than the config registers, so callers
    should verify the resolved workspace actually has nodes (run_loop does).
    """

    if explicit:
        return explicit
    entries = igc.list_workspaces(ix_config_path)
    target = clone_dir.resolve()
    matches = [
        e["workspace_id"]
        for e in entries
        if e.get("workspace_id") and Path(e.get("root_path", "")).resolve() == target
    ]
    unique = sorted(set(matches))
    if not unique:
        raise CloneLoopError(
            f"No workspace in {ix_config_path} has root_path {target}; pass --clone-workspace explicitly."
        )
    if len(unique) > 1:
        raise CloneLoopError(
            f"Multiple workspaces match root_path {target}: {', '.join(unique)}; pass --clone-workspace explicitly."
        )
    return unique[0]


def wait_for_ingest(
    endpoint: str,
    db: str,
    workspace_id: str,
    kinds: tuple[str, ...],
    ingest_timeout: float = DEFAULT_INGEST_TIMEOUT,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
    query_timeout: float = igc.DEFAULT_TIMEOUT,
) -> int:
    """Poll until the workspace's canonical node count is stable and nonzero.

    Two consecutive equal nonzero counts are treated as settled. Raises
    CloneLoopError on timeout so the loop never compares stale ingest state.
    """

    attempts = max(2, int(ingest_timeout / poll_interval))
    previous: int | None = None
    for attempt in range(attempts):
        count = count_canonical_nodes(endpoint, db, workspace_id, kinds, query_timeout)
        if count > 0 and count == previous:
            return count
        previous = count
        if attempt < attempts - 1:
            _sleep(poll_interval)
    raise CloneLoopError(
        f"Ingest for workspace {workspace_id} did not settle within {ingest_timeout}s "
        f"(last canonical node count: {previous})."
    )


# --------------------------------------------------------------------------
# Repair prompt
# --------------------------------------------------------------------------


def build_repair_prompt(
    snapshot: dict[str, Any],
    clone_dir: Path,
    reference_dir: Path | None,
    max_gaps: int,
) -> str:
    """Render the gap list into an actionable repair prompt.

    Missing nodes come first (each maps directly to a file + symbol), then
    missing edges. When the reference side has zero live edges (the ix
    content-hash dedup tombstones them), edge lines are suppressed entirely
    and noted as unavailable — they would be pure noise.
    """

    comparison = snapshot["comparison"]
    missing_nodes: list[str] = list(comparison["nodes"]["missing_in_clone"])
    reference_has_edges = snapshot["reference"]["canonical_edges"] > 0
    missing_edges: list[str] = list(comparison["edges"]["missing_in_clone"]) if reference_has_edges else []

    lines: list[str] = [
        "You are repairing a clone of a reference codebase.",
        "Make the minimal changes inside the current working directory that restore the missing structure below.",
        "",
        f"Clone directory (your working directory): {clone_dir}",
    ]
    if reference_dir is not None:
        lines += [
            f"Reference codebase (read-only, for inspection): {reference_dir}",
            "You may read the reference to understand what is missing, but never modify it.",
        ]
    lines.append("")

    budget = max_gaps
    if missing_nodes:
        lines.append("## Missing symbols (file and symbol name, restore each one)")
        shown = missing_nodes[:budget]
        lines += [f"- {node}" for node in shown]
        if len(missing_nodes) > len(shown):
            lines.append(f"- ... and {len(missing_nodes) - len(shown)} more missing symbols")
        budget -= len(shown)
        lines.append("")

    if reference_has_edges:
        if missing_edges and budget > 0:
            lines.append("## Missing relationships (src --PREDICATE--> dst)")
            shown = missing_edges[:budget]
            lines += [f"- {edge}" for edge in shown]
            if len(missing_edges) > len(shown):
                lines.append(f"- ... and {len(missing_edges) - len(shown)} more missing relationships")
            lines.append("")
    else:
        lines += [
            "Note: edge-level parity is unavailable for this comparison (the reference",
            "workspace has no live edges), so only missing symbols are listed.",
            "",
        ]

    lines += [
        "Constraints:",
        "- Only create or edit files inside the clone directory.",
        "- Match the reference implementation semantics for each restored symbol.",
        "- Do not refactor, rename, or reformat unrelated code.",
    ]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# Loop orchestration
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class LoopConfig:
    reference_workspace: str
    clone_workspace: str
    clone_dir: Path
    run_dir: Path
    reference_dir: Path | None = None
    endpoint: str = igc.DEFAULT_ENDPOINT
    db: str = igc.DEFAULT_DB
    root_a: str = ""
    root_b: str = ""
    kinds: tuple[str, ...] = igc.DEFAULT_KINDS
    predicates: tuple[str, ...] = igc.DEFAULT_PREDICATES
    excludes: tuple[str, ...] = ()
    min_node_recall: float = 1.0
    min_edge_recall: float = 0.0
    max_iterations: int = DEFAULT_MAX_ITERATIONS
    max_gaps: int = igc.DEFAULT_MAX_GAPS
    agent_cmd: tuple[str, ...] = tuple(shlex.split(DEFAULT_AGENT_CMD))
    agent_timeout: float = DEFAULT_AGENT_TIMEOUT
    map_timeout: float = DEFAULT_MAP_TIMEOUT
    ingest_timeout: float = DEFAULT_INGEST_TIMEOUT
    poll_interval: float = DEFAULT_POLL_INTERVAL
    query_timeout: float = igc.DEFAULT_TIMEOUT
    extra_summary: dict[str, Any] = field(default_factory=dict)


def _side_configs(cfg: LoopConfig) -> tuple[igc.SideConfig, igc.SideConfig]:
    side_a = igc.SideConfig(
        label="reference", endpoint=cfg.endpoint, db=cfg.db,
        workspace_id=cfg.reference_workspace, root=cfg.root_a.strip("/"),
        kinds=cfg.kinds, excludes=cfg.excludes,
    )
    side_b = igc.SideConfig(
        label="clone", endpoint=cfg.endpoint, db=cfg.db,
        workspace_id=cfg.clone_workspace, root=cfg.root_b.strip("/"),
        kinds=cfg.kinds, excludes=cfg.excludes,
    )
    return side_a, side_b


def _compare_once(cfg: LoopConfig) -> dict[str, Any]:
    side_a, side_b = _side_configs(cfg)
    return igc.run_compare(
        side_a, side_b, cfg.predicates,
        min_node_recall=cfg.min_node_recall,
        min_edge_recall=cfg.min_edge_recall,
        max_gaps=cfg.max_gaps,
        timeout=cfg.query_timeout,
    )


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def run_loop(cfg: LoopConfig) -> dict[str, Any]:
    initial_count = count_canonical_nodes(
        cfg.endpoint, cfg.db, cfg.clone_workspace, cfg.kinds, cfg.query_timeout
    )
    if initial_count == 0:
        raise CloneLoopError(
            f"Clone workspace {cfg.clone_workspace} has no canonical nodes; "
            "wrong workspace id, or the ingest has not landed yet."
        )

    iterations: list[dict[str, Any]] = []
    status = "failed"
    agent_invocations = 0

    for iteration in range(1, cfg.max_iterations + 1):
        iter_dir = cfg.run_dir / f"iter-{iteration}"
        snapshot = _compare_once(cfg)
        _write_json(iter_dir / "compare.json", snapshot)

        entry: dict[str, Any] = {
            "iteration": iteration,
            "passed": snapshot["passed"],
            "node_recall": snapshot["comparison"]["nodes"]["recall"],
            "edge_recall": snapshot["comparison"]["edges"]["overall"]["recall"],
            "gap_count": len(snapshot["comparison"]["gaps"]),
            "agent_ran": False,
        }

        if snapshot["passed"]:
            iterations.append(entry)
            status = "passed"
            break

        if iteration == cfg.max_iterations:
            iterations.append(entry)
            break

        prompt = build_repair_prompt(snapshot, cfg.clone_dir, cfg.reference_dir, cfg.max_gaps)
        iter_dir.mkdir(parents=True, exist_ok=True)
        (iter_dir / "prompt.md").write_text(prompt)

        agent_output = _run_agent(list(cfg.agent_cmd), prompt, cfg.clone_dir, cfg.agent_timeout)
        agent_invocations += 1
        entry["agent_ran"] = True
        (iter_dir / "agent-output.txt").write_text(agent_output)
        iterations.append(entry)

        _run_ix_map(cfg.clone_dir, cfg.map_timeout)
        wait_for_ingest(
            cfg.endpoint, cfg.db, cfg.clone_workspace, cfg.kinds,
            ingest_timeout=cfg.ingest_timeout,
            poll_interval=cfg.poll_interval,
            query_timeout=cfg.query_timeout,
        )

    summary: dict[str, Any] = {
        "status": status,
        "reference_workspace": cfg.reference_workspace,
        "clone_workspace": cfg.clone_workspace,
        "clone_dir": str(cfg.clone_dir),
        "reference_dir": str(cfg.reference_dir) if cfg.reference_dir else None,
        "thresholds": {
            "min_node_recall": cfg.min_node_recall,
            "min_edge_recall": cfg.min_edge_recall,
        },
        "max_iterations": cfg.max_iterations,
        "agent_invocations": agent_invocations,
        "iterations": iterations,
        **cfg.extra_summary,
    }
    _write_json(cfg.run_dir / "summary.json", summary)
    return summary


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _print_summary(summary: dict[str, Any]) -> None:
    marker = "PASS" if summary["status"] == "passed" else "FAIL"
    print(
        f"[{marker}] clone repair loop: {summary['reference_workspace']} (reference) vs "
        f"{summary['clone_workspace']} (clone) after {len(summary['iterations'])} iteration(s), "
        f"{summary['agent_invocations']} agent invocation(s)"
    )
    for entry in summary["iterations"]:
        print(
            f"  iter {entry['iteration']}: node_recall={entry['node_recall']} "
            f"edge_recall={entry['edge_recall']} gaps={entry['gap_count']} "
            f"{'PASS' if entry['passed'] else 'fail'}{' (agent ran)' if entry['agent_ran'] else ''}"
        )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reference-workspace", required=True, help="Workspace id of the reference graph.")
    parser.add_argument("--clone-dir", required=True, help="Path to the clone directory the agent repairs.")
    parser.add_argument("--clone-workspace", default=None, help="Clone workspace id (default: resolve from ix config by root_path).")
    parser.add_argument("--reference-dir", default=None, help="Read-only reference codebase path shared with the agent.")
    parser.add_argument("--root-a", default="", help="Path prefix to scope/strip on the reference side.")
    parser.add_argument("--root-b", default="", help="Path prefix to scope/strip on the clone side.")
    parser.add_argument("--endpoint", default=igc.DEFAULT_ENDPOINT, help="Arango endpoint for both sides.")
    parser.add_argument("--db", default=igc.DEFAULT_DB, help="Arango database name.")
    parser.add_argument("--kinds", default=",".join(igc.DEFAULT_KINDS), help="Comma-separated node kinds to compare.")
    parser.add_argument("--predicates", default=",".join(igc.DEFAULT_PREDICATES), help="Comma-separated edge predicates.")
    parser.add_argument("--exclude", action="append", default=[], help="Glob (relative to root) to drop from both sides; repeatable.")
    parser.add_argument("--min-node-recall", type=float, default=1.0, help="Node recall required to pass (default 1.0).")
    parser.add_argument("--min-edge-recall", type=float, default=0.0, help="Edge recall required to pass (default 0.0; ix edge tombstoning makes 1.0 unrealistic for identical content).")
    parser.add_argument("--max-iterations", type=int, default=DEFAULT_MAX_ITERATIONS, help="Max compare iterations (agent runs between them).")
    parser.add_argument("--max-gaps", type=int, default=igc.DEFAULT_MAX_GAPS, help="Cap on gap lines in reports and prompts.")
    parser.add_argument("--agent-cmd", default=DEFAULT_AGENT_CMD, help="Headless agent command; prompt is piped to stdin.")
    parser.add_argument("--agent-timeout", type=float, default=DEFAULT_AGENT_TIMEOUT, help="Agent subprocess timeout in seconds.")
    parser.add_argument("--map-timeout", type=float, default=DEFAULT_MAP_TIMEOUT, help="`ix map` subprocess timeout in seconds.")
    parser.add_argument("--ingest-timeout", type=float, default=DEFAULT_INGEST_TIMEOUT, help="Max seconds to wait for ingest to settle.")
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_INTERVAL, help="Seconds between ingest polls.")
    parser.add_argument("--run-dir", default=None, help=f"Artifacts directory (default: {DEFAULT_RUN_DIR_BASE}/<ref>_vs_<clone>).")
    parser.add_argument("--ix-config", default=str(igc.DEFAULT_IX_CONFIG), help="Path to ix config.yaml for workspace resolution.")
    parser.add_argument("--timeout", type=float, default=igc.DEFAULT_TIMEOUT, help="Per-request Arango HTTP timeout.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    clone_dir = Path(args.clone_dir).resolve()
    if not clone_dir.is_dir():
        print(f"error: --clone-dir {clone_dir} is not a directory.", file=sys.stderr)
        return 1

    try:
        clone_workspace = resolve_clone_workspace(clone_dir, args.clone_workspace, Path(args.ix_config))
        run_dir = (
            Path(args.run_dir)
            if args.run_dir
            else Path(DEFAULT_RUN_DIR_BASE) / f"{args.reference_workspace}_vs_{clone_workspace}"
        )
        cfg = LoopConfig(
            reference_workspace=args.reference_workspace,
            clone_workspace=clone_workspace,
            clone_dir=clone_dir,
            run_dir=run_dir,
            reference_dir=Path(args.reference_dir).resolve() if args.reference_dir else None,
            endpoint=args.endpoint,
            db=args.db,
            root_a=args.root_a,
            root_b=args.root_b,
            kinds=tuple(k.strip() for k in args.kinds.split(",") if k.strip()),
            predicates=tuple(p.strip().upper() for p in args.predicates.split(",") if p.strip()),
            excludes=tuple(args.exclude),
            min_node_recall=args.min_node_recall,
            min_edge_recall=args.min_edge_recall,
            max_iterations=args.max_iterations,
            max_gaps=args.max_gaps,
            agent_cmd=tuple(shlex.split(args.agent_cmd)),
            agent_timeout=args.agent_timeout,
            map_timeout=args.map_timeout,
            ingest_timeout=args.ingest_timeout,
            poll_interval=args.poll_interval,
            query_timeout=args.timeout,
        )
        summary = run_loop(cfg)
    except (CloneLoopError, igc.GraphCompareError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    _print_summary(summary)
    print(f"Artifacts written to {cfg.run_dir}")
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())

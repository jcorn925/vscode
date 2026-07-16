#!/usr/bin/env python3
"""Stdio MCP server exposing the ix graph-compare tooling to agents.

Wraps scripts/ix_graph_compare.py and scripts/ix_clone_loop.py as Model
Context Protocol tools so any MCP client (Claude Code, the Claude Agent SDK,
Cursor, this fork's workbench) can drive the compare/repair loop itself:

- ``compare_graphs``   — compare a clone workspace against a reference
  workspace in the live Arango graph; returns recall metrics and the gap list.
- ``compare_proposal`` — verify a workspace against a graph-proposal JSON file
  (the plan contract) instead of a reference workspace; plan-first builds.
- ``remap_and_wait``   — run ``ix map`` on a directory and poll Arango until
  the async ingest settles, so the next compare never scores stale state.
- ``list_workspaces``  — list workspace ids and root paths from ~/.ix/config.yaml.

Same conventions as the wrapped scripts: Python 3.12+ standard library only
(newline-delimited JSON-RPC 2.0 over stdio, per the MCP stdio transport), and
fail closed — infrastructure errors surface as ``isError`` tool results, never
as fabricated metrics.

Usage (registered in .mcp.json / .vscode/mcp.json):
    python3 scripts/ix_graph_mcp.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, IO

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ix_clone_loop as icl  # noqa: E402
import ix_graph_compare as igc  # noqa: E402

SERVER_NAME = "ix-graph"
SERVER_VERSION = "1.0.0"
PROTOCOL_VERSION = "2024-11-05"
# Tighter than the CLI default (200): tool results go straight into an agent
# context window, and a gap list that long stops being actionable.
DEFAULT_TOOL_MAX_GAPS = 50
# Per-run recall history for the compare_graphs `run_id` progress signal.
RUNS_DIR = Path(".ix-scaffold/graph-compare/runs")
PROPOSAL_SNAPSHOT_DIR = Path(".ix-scaffold/graph-compare")

JSONRPC_PARSE_ERROR = -32700
JSONRPC_INVALID_REQUEST = -32600
JSONRPC_METHOD_NOT_FOUND = -32601
JSONRPC_INVALID_PARAMS = -32602


TOOLS: list[dict[str, Any]] = [
    {
        "name": "compare_graphs",
        "description": (
            "Compare a clone ix workspace against a reference workspace in the live ArangoDB graph. "
            "Matches nodes by canonical structural id (kind:path::name) and edges as (src, PREDICATE, dst) "
            "triples, and returns precision/recall metrics plus an actionable gap list "
            "(missing_in_clone entries name the exact file and symbol to restore). "
            "Fails with an error rather than returning metrics if Arango is unreachable or a workspace is empty. "
            "Note: run remap_and_wait after editing files, or this will score the pre-edit graph."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "reference_workspace": {"type": "string", "description": "Workspace id of the reference (ground-truth) graph."},
                "clone_workspace": {"type": "string", "description": "Workspace id of the clone/recreation under test."},
                "root_a": {"type": "string", "description": "Optional path prefix to scope/strip on the reference side."},
                "root_b": {"type": "string", "description": "Optional path prefix to scope/strip on the clone side."},
                "predicates": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Edge predicates to compare (default CALLS, IMPORTS, DEFINES, EXTENDS).",
                },
                "exclude": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Globs (relative to root) dropped from both sides, e.g. tests/**.",
                },
                "min_node_recall": {"type": "number", "description": "Node recall required for passed=true (default 1.0)."},
                "min_edge_recall": {"type": "number", "description": "Edge recall required for passed=true (default 0; ix edge tombstoning makes 1.0 unrealistic for identical content)."},
                "max_gaps": {"type": "integer", "description": f"Cap on gap-list entries (default {DEFAULT_TOOL_MAX_GAPS})."},
                "run_id": {
                    "type": "string",
                    "description": (
                        "Optional session id for convergence tracking across repeated compares. "
                        "When set, the result includes a `progress` block (round number, recall delta "
                        "vs the previous compare, rounds_without_improvement). Recommended stopping "
                        "rule for iterative generation: stop when passed is true OR "
                        "rounds_without_improvement >= 2."
                    ),
                },
            },
            "required": ["reference_workspace", "clone_workspace"],
        },
    },
    {
        "name": "compare_proposal",
        "description": (
            "Verify a workspace against a graph-proposal JSON file (the plan contract) instead of a "
            "reference workspace — use this for plan-first builds where no reference repo exists. "
            "The proposal predicts nodes/edges that should exist after implementation "
            "(.agent/task-trees/<id>.graph-proposal.json). Recall-oriented: extra structure in the "
            "workspace never fails; missing proposed nodes/structural edges and still-present "
            "removals do. Speculative edges and node_prefixes are advisory only. "
            "Run remap_and_wait after editing files, or this scores the pre-edit graph."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "proposal_path": {"type": "string", "description": "Absolute path to the graph-proposal JSON file."},
                "clone_workspace": {"type": "string", "description": "Workspace id of the implementation under test."},
                "root_b": {"type": "string", "description": "Path prefix to scope/strip on the workspace side (default: the proposal's own root)."},
                "exclude": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Globs (relative to root) dropped from the workspace side, e.g. tests/**.",
                },
                "min_node_recall": {"type": "number", "description": "Proposed-node recall required for passed=true (default 1.0; proposals are curated, so full coverage is the natural bar — lower it per plan phase if the plan says so)."},
                "min_edge_recall": {"type": "number", "description": "Structural-edge recall required for passed=true (default 1.0; trivially satisfied when the proposal declares no structural edges)."},
                "max_gaps": {"type": "integer", "description": f"Cap on gap-list entries (default {DEFAULT_TOOL_MAX_GAPS})."},
                "run_id": {
                    "type": "string",
                    "description": (
                        "Optional session id for convergence tracking across repeated compares; adds a "
                        "`progress` block. Stop when passed is true OR rounds_without_improvement >= 2."
                    ),
                },
            },
            "required": ["proposal_path", "clone_workspace"],
        },
    },
    {
        "name": "remap_and_wait",
        "description": (
            "Run `ix map` on a directory and poll ArangoDB until the async ingest settles "
            "(two consecutive stable nonzero node counts). Call this after editing files and "
            "before compare_graphs — ix ingestion is asynchronous, and comparing too early "
            "scores the pre-edit graph. Returns the workspace id and settled node count. "
            "Fails with an error if the ingest never stabilizes within the timeout."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "directory": {"type": "string", "description": "Absolute path of the repo to map (a git repo; first-time directories are registered with ix automatically, but must already contain files or the ingest poll will time out)."},
                "workspace_id": {"type": "string", "description": "Workspace id to poll; resolved from ~/.ix/config.yaml by root_path when omitted."},
                "ingest_timeout": {"type": "number", "description": "Max seconds to wait for the ingest to settle (default 120)."},
            },
            "required": ["directory"],
        },
    },
    {
        "name": "list_workspaces",
        "description": (
            "List ix workspaces registered in ~/.ix/config.yaml (workspace id, name, root path). "
            "Use this to resolve which workspace ids to pass to compare_graphs."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]


class ToolError(Exception):
    """Tool-level failure reported via result.isError (not a protocol error)."""


# --------------------------------------------------------------------------
# Tool implementations
# --------------------------------------------------------------------------


def _require_str(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ToolError(f"argument {key!r} is required and must be a non-empty string")
    return value.strip()


def _str_tuple(args: dict[str, Any], key: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = args.get(key)
    if value is None:
        return default
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ToolError(f"argument {key!r} must be an array of strings")
    cleaned = tuple(v.strip() for v in value if v.strip())
    return cleaned or default


def _record_progress(run_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Append this compare's recall to the run history and derive a plateau signal.

    The agent driving an iterative generate/compare loop cannot reliably judge
    "am I still improving?" from memory — this makes it mechanical: stop when
    passed is true or rounds_without_improvement >= 2.
    """

    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", run_id)
    run_path = RUNS_DIR / f"{safe_id}.json"
    history: list[dict[str, Any]] = []
    if run_path.exists():
        try:
            history = json.loads(run_path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            raise ToolError(f"run history {run_path} is unreadable: {exc}") from exc
        if not isinstance(history, list):
            raise ToolError(f"run history {run_path} is malformed (expected a JSON array)")

    # Workspace-vs-workspace snapshots report edges.overall; proposal
    # snapshots report edges.structural. Track whichever gates the pass.
    edges = snapshot["comparison"]["edges"]
    edge_recall = (edges.get("overall") or edges["structural"])["recall"]
    history.append({
        "node_recall": snapshot["comparison"]["nodes"]["recall"],
        "edge_recall": edge_recall,
        "passed": snapshot["passed"],
    })
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_path.write_text(json.dumps(history, indent=2) + "\n")

    best = -1.0
    rounds_without_improvement = 0
    for entry in history:
        recall = float(entry["node_recall"])
        if recall > best:
            best = recall
            rounds_without_improvement = 0
        else:
            rounds_without_improvement += 1

    current = history[-1]["node_recall"]
    previous = history[-2]["node_recall"] if len(history) > 1 else None
    return {
        "run_id": run_id,
        "round": len(history),
        "node_recall": current,
        "previous_node_recall": previous,
        "node_recall_delta": round(current - previous, 6) if previous is not None else None,
        "best_node_recall": best,
        "rounds_without_improvement": rounds_without_improvement,
        "recommendation": (
            "converged: thresholds met" if snapshot["passed"]
            else "plateaued: no node-recall improvement in "
                 f"{rounds_without_improvement} round(s); consider stopping" if rounds_without_improvement >= 2
            else "keep iterating"
        ),
    }


def tool_compare_graphs(args: dict[str, Any]) -> dict[str, Any]:
    endpoint = igc.DEFAULT_ENDPOINT
    db = igc.DEFAULT_DB
    predicates = tuple(p.upper() for p in _str_tuple(args, "predicates", igc.DEFAULT_PREDICATES))
    excludes = _str_tuple(args, "exclude", ())
    side_a = igc.SideConfig(
        label="reference", endpoint=endpoint, db=db,
        workspace_id=_require_str(args, "reference_workspace"),
        root=str(args.get("root_a", "")).strip("/"),
        kinds=igc.DEFAULT_KINDS, excludes=excludes,
    )
    side_b = igc.SideConfig(
        label="clone", endpoint=endpoint, db=db,
        workspace_id=_require_str(args, "clone_workspace"),
        root=str(args.get("root_b", "")).strip("/"),
        kinds=igc.DEFAULT_KINDS, excludes=excludes,
    )
    try:
        snapshot = igc.run_compare(
            side_a, side_b, predicates,
            min_node_recall=float(args.get("min_node_recall", 1.0)),
            min_edge_recall=float(args.get("min_edge_recall", 0.0)),
            max_gaps=int(args.get("max_gaps", DEFAULT_TOOL_MAX_GAPS)),
        )
    except igc.GraphCompareError as exc:
        raise ToolError(f"graph compare failed: {exc}") from exc

    if snapshot["reference"]["canonical_nodes"] == 0:
        raise ToolError(
            f"reference workspace {side_a.workspace_id} has no canonical nodes; "
            "wrong workspace id, or its ingest has not landed."
        )

    run_id = args.get("run_id")
    if isinstance(run_id, str) and run_id.strip():
        snapshot["progress"] = _record_progress(run_id.strip(), snapshot)
    return snapshot


def tool_compare_proposal(args: dict[str, Any]) -> dict[str, Any]:
    proposal_path = Path(_require_str(args, "proposal_path"))
    if not proposal_path.is_file():
        raise ToolError(f"proposal file {proposal_path} does not exist")
    try:
        proposal = igc.load_graph_proposal(proposal_path)
    except igc.GraphCompareError as exc:
        raise ToolError(f"invalid proposal: {exc}") from exc
    if not proposal.add_nodes and not proposal.structural_edges and not proposal.remove_nodes and not proposal.remove_edges:
        raise ToolError(
            f"proposal {proposal_path} declares nothing verifiable "
            "(no add_nodes, structural add_edges, or removals)."
        )

    root_b = args.get("root_b")
    side_b = igc.SideConfig(
        label="clone", endpoint=igc.DEFAULT_ENDPOINT, db=igc.DEFAULT_DB,
        workspace_id=_require_str(args, "clone_workspace"),
        root=(str(root_b) if isinstance(root_b, str) else proposal.root).strip("/"),
        kinds=igc.DEFAULT_KINDS,
        excludes=_str_tuple(args, "exclude", ()),
    )
    try:
        snapshot = igc.run_proposal_compare(
            proposal, side_b,
            min_node_recall=float(args.get("min_node_recall", 1.0)),
            min_edge_recall=float(args.get("min_edge_recall", 1.0)),
            max_gaps=int(args.get("max_gaps", DEFAULT_TOOL_MAX_GAPS)),
        )
    except igc.GraphCompareError as exc:
        raise ToolError(f"proposal compare failed: {exc}") from exc

    try:
        named_path, latest_path = igc.write_proposal_snapshot(snapshot, PROPOSAL_SNAPSHOT_DIR)
    except OSError as exc:
        raise ToolError(f"could not write proposal snapshot: {exc}") from exc
    snapshot["snapshot_path"] = str(named_path)
    snapshot["latest_snapshot_path"] = str(latest_path)

    run_id = args.get("run_id")
    if isinstance(run_id, str) and run_id.strip():
        snapshot["progress"] = _record_progress(run_id.strip(), snapshot)
    return snapshot


def tool_remap_and_wait(args: dict[str, Any]) -> dict[str, Any]:
    directory = Path(_require_str(args, "directory")).resolve()
    if not directory.is_dir():
        raise ToolError(f"directory {directory} does not exist or is not a directory")
    explicit = args.get("workspace_id")
    ingest_timeout = float(args.get("ingest_timeout", icl.DEFAULT_INGEST_TIMEOUT))
    try:
        # Map before resolving: a never-mapped directory (recreate-from-spec
        # bootstrap) only gets its workspace registered in ~/.ix/config.yaml
        # by the first `ix map` run.
        icl._run_ix_map(directory)
        workspace_id = icl.resolve_clone_workspace(
            directory,
            explicit if isinstance(explicit, str) and explicit.strip() else None,
            igc.DEFAULT_IX_CONFIG,
        )
        settled = icl.wait_for_ingest(
            igc.DEFAULT_ENDPOINT, igc.DEFAULT_DB, workspace_id, igc.DEFAULT_KINDS,
            ingest_timeout=ingest_timeout,
        )
    except (icl.CloneLoopError, igc.GraphCompareError) as exc:
        raise ToolError(f"remap failed: {exc}") from exc
    return {
        "workspace_id": workspace_id,
        "directory": str(directory),
        "settled_canonical_nodes": settled,
        "note": "Ingest settled; compare_graphs will now score the post-edit graph.",
    }


def tool_list_workspaces(_args: dict[str, Any]) -> dict[str, Any]:
    try:
        entries = igc.list_workspaces(igc.DEFAULT_IX_CONFIG)
    except igc.GraphCompareError as exc:
        raise ToolError(f"could not read ix config: {exc}") from exc
    return {"workspaces": entries}


TOOL_HANDLERS = {
    "compare_graphs": tool_compare_graphs,
    "compare_proposal": tool_compare_proposal,
    "remap_and_wait": tool_remap_and_wait,
    "list_workspaces": tool_list_workspaces,
}


# --------------------------------------------------------------------------
# JSON-RPC dispatch
# --------------------------------------------------------------------------


def _result(request_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": payload}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _tool_text_result(request_id: Any, payload: dict[str, Any], is_error: bool = False) -> dict[str, Any]:
    return _result(request_id, {
        "content": [{"type": "text", "text": json.dumps(payload, indent=2, sort_keys=True)}],
        "isError": is_error,
    })


def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    """Handle one JSON-RPC message; returns None for notifications."""

    request_id = request.get("id")
    method = request.get("method")
    is_notification = "id" not in request

    if not isinstance(method, str):
        return None if is_notification else _error(request_id, JSONRPC_INVALID_REQUEST, "method is required")

    if method == "initialize":
        return _result(request_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None
    if method == "ping":
        return _result(request_id, {})
    if method == "tools/list":
        return _result(request_id, {"tools": TOOLS})
    if method == "tools/call":
        params = request.get("params")
        if not isinstance(params, dict):
            return _error(request_id, JSONRPC_INVALID_PARAMS, "params must be an object")
        tool_name = params.get("name")
        handler = TOOL_HANDLERS.get(tool_name) if isinstance(tool_name, str) else None
        if handler is None:
            return _error(request_id, JSONRPC_INVALID_PARAMS, f"unknown tool: {tool_name!r}")
        arguments = params.get("arguments")
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            return _error(request_id, JSONRPC_INVALID_PARAMS, "arguments must be an object")
        try:
            payload = handler(arguments)
        except ToolError as exc:
            return _tool_text_result(request_id, {"error": str(exc)}, is_error=True)
        return _tool_text_result(request_id, payload)

    if is_notification:
        return None
    return _error(request_id, JSONRPC_METHOD_NOT_FOUND, f"method not supported: {method}")


def serve(stdin: IO[str], stdout: IO[str]) -> None:
    """Newline-delimited JSON-RPC loop (MCP stdio transport)."""

    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response: dict[str, Any] | None = _error(None, JSONRPC_PARSE_ERROR, "invalid JSON")
        else:
            if isinstance(request, dict):
                response = handle_request(request)
            else:
                response = _error(None, JSONRPC_INVALID_REQUEST, "request must be an object")
        if response is not None:
            stdout.write(json.dumps(response) + "\n")
            stdout.flush()


def main() -> int:
    serve(sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

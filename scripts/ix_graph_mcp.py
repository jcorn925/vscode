#!/usr/bin/env python3
"""Stdio MCP server exposing the ix graph-compare tooling to agents.

Wraps scripts/ix_graph_compare.py and scripts/ix_clone_loop.py as Model
Context Protocol tools so any MCP client (Claude Code, the Claude Agent SDK,
Cursor, this fork's workbench) can drive the compare/repair loop itself:

- ``compare_graphs``   — compare a clone workspace against a reference
  workspace in the live Arango graph; returns recall metrics and the gap list.
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
            },
            "required": ["reference_workspace", "clone_workspace"],
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
                "directory": {"type": "string", "description": "Absolute path of the mapped repo (must be a git repo already known to ix)."},
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
    return snapshot


def tool_remap_and_wait(args: dict[str, Any]) -> dict[str, Any]:
    directory = Path(_require_str(args, "directory")).resolve()
    if not directory.is_dir():
        raise ToolError(f"directory {directory} does not exist or is not a directory")
    explicit = args.get("workspace_id")
    ingest_timeout = float(args.get("ingest_timeout", icl.DEFAULT_INGEST_TIMEOUT))
    try:
        workspace_id = icl.resolve_clone_workspace(
            directory,
            explicit if isinstance(explicit, str) and explicit.strip() else None,
            igc.DEFAULT_IX_CONFIG,
        )
        icl._run_ix_map(directory)
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

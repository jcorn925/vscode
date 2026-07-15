"""Tests for scripts/ix_graph_mcp.py.

The server is exercised through ``handle_request`` (single JSON-RPC message)
and ``serve`` (newline-delimited stdio loop) with the underlying compare/loop
functions monkeypatched — no live Arango, ix, or MCP client is required.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import ix_clone_loop as icl  # noqa: E402
import ix_graph_compare as igc  # noqa: E402
import ix_graph_mcp as mcp  # noqa: E402


def _request(method: str, request_id: Any = 1, params: dict[str, Any] | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


def _call(tool: str, arguments: dict[str, Any], request_id: Any = 7) -> dict[str, Any]:
    return _request("tools/call", request_id, {"name": tool, "arguments": arguments})


def _tool_payload(response: dict[str, Any]) -> dict[str, Any]:
    return json.loads(response["result"]["content"][0]["text"])


FAKE_SNAPSHOT = {
    "reference": {"workspace_id": "ws-ref", "canonical_nodes": 509, "canonical_edges": 0},
    "clone": {"workspace_id": "ws-clone", "canonical_nodes": 508, "canonical_edges": 402},
    "comparison": {"nodes": {"recall": 0.998, "missing_in_clone": ["function:database/pool.py::_encode_vector"]}},
    "hard_failures": ["node recall 0.998 is below --min-node-recall 1.0"],
    "passed": False,
}


# --------------------------------------------------------------------------
# Protocol lifecycle
# --------------------------------------------------------------------------


def test_initialize_reports_tools_capability() -> None:
    response = mcp.handle_request(_request("initialize"))

    assert response is not None
    assert response["result"]["serverInfo"]["name"] == "ix-graph"
    assert "tools" in response["result"]["capabilities"]


def test_initialized_notification_gets_no_response() -> None:
    assert mcp.handle_request({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_tools_list_names_all_three_tools() -> None:
    response = mcp.handle_request(_request("tools/list"))

    assert response is not None
    names = [t["name"] for t in response["result"]["tools"]]
    assert names == ["compare_graphs", "remap_and_wait", "list_workspaces"]
    for tool in response["result"]["tools"]:
        assert tool["inputSchema"]["type"] == "object"
        assert tool["description"].strip()


def test_unknown_method_is_method_not_found() -> None:
    response = mcp.handle_request(_request("resources/list"))

    assert response is not None
    assert response["error"]["code"] == mcp.JSONRPC_METHOD_NOT_FOUND


# --------------------------------------------------------------------------
# compare_graphs tool
# --------------------------------------------------------------------------


def test_compare_graphs_returns_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_run_compare(side_a: igc.SideConfig, side_b: igc.SideConfig, predicates: tuple[str, ...], **kwargs: Any) -> dict[str, Any]:
        captured["reference"] = side_a.workspace_id
        captured["clone"] = side_b.workspace_id
        captured["predicates"] = predicates
        captured["kwargs"] = kwargs
        return FAKE_SNAPSHOT

    monkeypatch.setattr(igc, "run_compare", fake_run_compare)

    response = mcp.handle_request(_call("compare_graphs", {
        "reference_workspace": "ws-ref",
        "clone_workspace": "ws-clone",
        "predicates": ["calls", "imports"],
        "min_node_recall": 0.9,
    }))

    assert response is not None
    assert response["result"]["isError"] is False
    payload = _tool_payload(response)
    assert payload["comparison"]["nodes"]["missing_in_clone"] == ["function:database/pool.py::_encode_vector"]
    assert captured["reference"] == "ws-ref"
    assert captured["clone"] == "ws-clone"
    assert captured["predicates"] == ("CALLS", "IMPORTS")
    assert captured["kwargs"]["min_node_recall"] == 0.9
    assert captured["kwargs"]["max_gaps"] == mcp.DEFAULT_TOOL_MAX_GAPS


def test_compare_graphs_requires_workspace_ids() -> None:
    response = mcp.handle_request(_call("compare_graphs", {"reference_workspace": "ws-ref"}))

    assert response is not None
    assert response["result"]["isError"] is True
    assert "clone_workspace" in _tool_payload(response)["error"]


def test_compare_graphs_empty_reference_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    empty = dict(FAKE_SNAPSHOT, reference={"workspace_id": "ws-ref", "canonical_nodes": 0, "canonical_edges": 0})
    monkeypatch.setattr(igc, "run_compare", lambda *a, **k: empty)

    response = mcp.handle_request(_call("compare_graphs", {
        "reference_workspace": "ws-ref", "clone_workspace": "ws-clone",
    }))

    assert response is not None
    assert response["result"]["isError"] is True
    assert "no canonical nodes" in _tool_payload(response)["error"]


def test_compare_graphs_arango_failure_is_tool_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise igc.GraphCompareError("Arango request failed: connection refused")

    monkeypatch.setattr(igc, "run_compare", boom)

    response = mcp.handle_request(_call("compare_graphs", {
        "reference_workspace": "ws-ref", "clone_workspace": "ws-clone",
    }))

    assert response is not None
    assert response["result"]["isError"] is True
    assert "connection refused" in _tool_payload(response)["error"]


# --------------------------------------------------------------------------
# remap_and_wait tool
# --------------------------------------------------------------------------


def test_remap_and_wait_runs_map_then_polls(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[str] = []
    monkeypatch.setattr(icl, "resolve_clone_workspace", lambda d, e, c: "ws-clone")
    monkeypatch.setattr(icl, "_run_ix_map", lambda d, timeout=0.0: calls.append(f"map:{d}"))

    def fake_wait(*args: Any, **kwargs: Any) -> int:
        calls.append("wait")
        return 509

    monkeypatch.setattr(icl, "wait_for_ingest", fake_wait)

    response = mcp.handle_request(_call("remap_and_wait", {"directory": str(tmp_path)}))

    assert response is not None
    assert response["result"]["isError"] is False
    payload = _tool_payload(response)
    assert payload["workspace_id"] == "ws-clone"
    assert payload["settled_canonical_nodes"] == 509
    assert calls == [f"map:{tmp_path.resolve()}", "wait"]


def test_remap_and_wait_missing_directory_is_tool_error(tmp_path: Path) -> None:
    response = mcp.handle_request(_call("remap_and_wait", {"directory": str(tmp_path / "nope")}))

    assert response is not None
    assert response["result"]["isError"] is True


def test_remap_and_wait_settle_timeout_is_tool_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(icl, "resolve_clone_workspace", lambda d, e, c: "ws-clone")
    monkeypatch.setattr(icl, "_run_ix_map", lambda d, timeout=0.0: None)

    def never_settles(*args: Any, **kwargs: Any) -> int:
        raise icl.CloneLoopError("Ingest for workspace ws-clone did not settle within 120s")

    monkeypatch.setattr(icl, "wait_for_ingest", never_settles)

    response = mcp.handle_request(_call("remap_and_wait", {"directory": str(tmp_path)}))

    assert response is not None
    assert response["result"]["isError"] is True
    assert "did not settle" in _tool_payload(response)["error"]


# --------------------------------------------------------------------------
# list_workspaces tool
# --------------------------------------------------------------------------


def test_list_workspaces_returns_config_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    entries = [{"workspace_id": "aaaa1111", "workspace_name": "original", "root_path": "/tmp/original"}]
    monkeypatch.setattr(igc, "list_workspaces", lambda path: entries)

    response = mcp.handle_request(_call("list_workspaces", {}))

    assert response is not None
    assert _tool_payload(response)["workspaces"] == entries


def test_unknown_tool_is_invalid_params() -> None:
    response = mcp.handle_request(_call("delete_everything", {}))

    assert response is not None
    assert response["error"]["code"] == mcp.JSONRPC_INVALID_PARAMS


# --------------------------------------------------------------------------
# Stdio loop
# --------------------------------------------------------------------------


def test_serve_round_trips_newline_delimited_jsonrpc(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(igc, "list_workspaces", lambda path: [])
    stdin = io.StringIO(
        json.dumps(_request("initialize", 1)) + "\n"
        + json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"
        + "not json\n"
        + json.dumps(_call("list_workspaces", {}, request_id=2)) + "\n"
    )
    stdout = io.StringIO()

    mcp.serve(stdin, stdout)

    responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert len(responses) == 3  # initialize, parse error, tools/call (notification is silent)
    assert responses[0]["id"] == 1
    assert responses[0]["result"]["serverInfo"]["name"] == "ix-graph"
    assert responses[1]["error"]["code"] == mcp.JSONRPC_PARSE_ERROR
    assert responses[2]["id"] == 2


def test_package_index_exports_public_api() -> None:
    sys.path.insert(0, str(REPO_ROOT))
    try:
        import scripts as ix_scripts
        for name in ("run_compare", "compare_graphs", "wait_for_ingest", "build_repair_prompt", "run_check"):
            assert hasattr(ix_scripts, name), f"scripts package should export {name}"
            assert name in ix_scripts.__all__
    finally:
        sys.path.remove(str(REPO_ROOT))

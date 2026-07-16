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


def _snapshot(node_recall: float, passed: bool) -> dict[str, Any]:
    return {
        "reference": {"workspace_id": "ws-ref", "canonical_nodes": 509, "canonical_edges": 0},
        "clone": {"workspace_id": "ws-clone", "canonical_nodes": 508, "canonical_edges": 402},
        "comparison": {
            "nodes": {"recall": node_recall, "missing_in_clone": ["function:database/pool.py::_encode_vector"]},
            "edges": {"overall": {"recall": 1.0}},
        },
        "hard_failures": [] if passed else [f"node recall {node_recall} is below --min-node-recall 1.0"],
        "passed": passed,
    }


FAKE_SNAPSHOT = _snapshot(0.998, passed=False)


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
# compare_graphs progress tracking (run_id)
# --------------------------------------------------------------------------


@pytest.fixture
def runs_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    target = tmp_path / "runs"
    monkeypatch.setattr(mcp, "RUNS_DIR", target)
    return target


def _compare_with_recall(monkeypatch: pytest.MonkeyPatch, node_recall: float, passed: bool = False) -> dict[str, Any]:
    monkeypatch.setattr(igc, "run_compare", lambda *a, **k: _snapshot(node_recall, passed))
    response = mcp.handle_request(_call("compare_graphs", {
        "reference_workspace": "ws-ref", "clone_workspace": "ws-clone", "run_id": "recreate-1",
    }))
    assert response is not None
    assert response["result"]["isError"] is False
    return _tool_payload(response)


def test_no_run_id_means_no_progress_block(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    monkeypatch.setattr(igc, "run_compare", lambda *a, **k: FAKE_SNAPSHOT)

    response = mcp.handle_request(_call("compare_graphs", {
        "reference_workspace": "ws-ref", "clone_workspace": "ws-clone",
    }))

    assert response is not None
    assert "progress" not in _tool_payload(response)
    assert not runs_dir.exists()


def test_first_round_has_no_delta_and_keeps_iterating(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    payload = _compare_with_recall(monkeypatch, 0.4)

    progress = payload["progress"]
    assert progress["round"] == 1
    assert progress["previous_node_recall"] is None
    assert progress["node_recall_delta"] is None
    assert progress["rounds_without_improvement"] == 0
    assert progress["recommendation"] == "keep iterating"
    assert (runs_dir / "recreate-1.json").is_file()


def test_improving_rounds_reset_plateau_counter(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    _compare_with_recall(monkeypatch, 0.4)
    payload = _compare_with_recall(monkeypatch, 0.7)

    progress = payload["progress"]
    assert progress["round"] == 2
    assert progress["previous_node_recall"] == 0.4
    assert progress["node_recall_delta"] == pytest.approx(0.3)
    assert progress["best_node_recall"] == 0.7
    assert progress["rounds_without_improvement"] == 0
    assert progress["recommendation"] == "keep iterating"


def test_two_flat_rounds_recommend_stopping(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    _compare_with_recall(monkeypatch, 0.7)
    second = _compare_with_recall(monkeypatch, 0.7)
    third = _compare_with_recall(monkeypatch, 0.69)

    assert second["progress"]["rounds_without_improvement"] == 1
    assert second["progress"]["recommendation"] == "keep iterating"
    assert third["progress"]["rounds_without_improvement"] == 2
    assert "plateaued" in third["progress"]["recommendation"]


def test_passed_round_reports_converged_even_after_plateau(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    _compare_with_recall(monkeypatch, 0.7)
    _compare_with_recall(monkeypatch, 0.7)
    payload = _compare_with_recall(monkeypatch, 0.7, passed=True)

    assert payload["progress"]["recommendation"] == "converged: thresholds met"


def test_run_ids_are_isolated_and_sanitized(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    monkeypatch.setattr(igc, "run_compare", lambda *a, **k: _snapshot(0.5, passed=False))
    for run_id in ("run/a", "run b"):
        response = mcp.handle_request(_call("compare_graphs", {
            "reference_workspace": "ws-ref", "clone_workspace": "ws-clone", "run_id": run_id,
        }))
        assert response is not None
        assert _tool_payload(response)["progress"]["round"] == 1

    assert sorted(p.name for p in runs_dir.iterdir()) == ["run-a.json", "run-b.json"]


def test_corrupt_run_history_fails_closed(monkeypatch: pytest.MonkeyPatch, runs_dir: Path) -> None:
    runs_dir.mkdir(parents=True)
    (runs_dir / "recreate-1.json").write_text("{not json")
    monkeypatch.setattr(igc, "run_compare", lambda *a, **k: _snapshot(0.5, passed=False))

    response = mcp.handle_request(_call("compare_graphs", {
        "reference_workspace": "ws-ref", "clone_workspace": "ws-clone", "run_id": "recreate-1",
    }))

    assert response is not None
    assert response["result"]["isError"] is True
    assert "unreadable" in _tool_payload(response)["error"]


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


def test_remap_and_wait_bootstraps_never_mapped_directory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Recreate-from-spec bootstrap: the directory is only registered in the ix
    config by the first `ix map`, so resolution must happen after the map."""

    mapped = {"done": False}

    def fake_map(directory: Path, timeout: float = 0.0) -> None:
        mapped["done"] = True

    def fake_resolve(directory: Path, explicit: str | None, config: Path) -> str:
        if not mapped["done"]:
            raise icl.CloneLoopError(f"No workspace in {config} has root_path {directory}")
        return "ws-new"

    monkeypatch.setattr(icl, "_run_ix_map", fake_map)
    monkeypatch.setattr(icl, "resolve_clone_workspace", fake_resolve)
    monkeypatch.setattr(icl, "wait_for_ingest", lambda *a, **k: 42)

    response = mcp.handle_request(_call("remap_and_wait", {"directory": str(tmp_path)}))

    assert response is not None
    assert response["result"]["isError"] is False
    payload = _tool_payload(response)
    assert payload["workspace_id"] == "ws-new"
    assert payload["settled_canonical_nodes"] == 42


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

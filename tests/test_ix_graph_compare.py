"""Tests for scripts/ix_graph_compare.py.

All Arango interaction goes through two seams: ``_arango_query`` (high-level
AQL dispatch, patched with FakeArango fixtures) and ``_http_json`` (raw HTTP
transport, patched to exercise fail-closed cursor handling). No live Arango
is required, so this suite runs the same in CI as it does locally.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import ix_graph_compare as igc  # noqa: E402


# --------------------------------------------------------------------------
# Fixtures / helpers
# --------------------------------------------------------------------------


def _node(
    logical_id: str,
    kind: str,
    source_uri: str,
    name: str | None = None,
    created_rev: int = 1,
    deleted_rev: int | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "name": name if name is not None else Path(source_uri).name,
        "logical_id": logical_id,
        "created_rev": created_rev,
        "deleted_rev": deleted_rev,
        "source_uri": source_uri,
    }


def _edge(src: str, predicate: str, dst: str) -> dict[str, Any]:
    return {"src": src, "dst": dst, "predicate": predicate}


class FakeArango:
    """Dispatches canned query results by workspace and collection, and
    records every invocation so tests can assert what was queried."""

    def __init__(self, graphs: dict[str, dict[str, list[dict[str, Any]]]]) -> None:
        # graphs: workspace_id -> {"nodes": [...], "edges": [...]}
        self.graphs = graphs
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self,
        endpoint: str,
        db: str,
        aql: str,
        bind_vars: dict[str, Any] | None = None,
        timeout: float = 0.0,
        batch_size: int = 0,
    ) -> list[Any]:
        bind_vars = bind_vars or {}
        workspace = bind_vars.get("workspace")
        self.calls.append({"endpoint": endpoint, "db": db, "aql": aql, "bind_vars": bind_vars})
        graph = self.graphs.get(workspace, {"nodes": [], "edges": []})
        if "FOR n IN nodes" in aql:
            kinds = set(bind_vars.get("kinds", []))
            return [
                n for n in graph["nodes"]
                if n.get("kind") in kinds and n.get("deleted_rev") is None
            ]
        if "FOR e IN edges" in aql:
            predicates = set(bind_vars.get("predicates", []))
            return [e for e in graph["edges"] if e.get("predicate") in predicates]
        raise AssertionError(f"unexpected AQL query: {aql}")


REFERENCE_NODES = [
    _node("uuid-file-api", "file", "backend/api.py"),
    _node("uuid-file-models", "file", "backend/models.py"),
    _node("uuid-fn-create", "function", "backend/api.py", name="create_task"),
    _node("uuid-class-task", "class", "backend/models.py", name="Task"),
]

REFERENCE_EDGES = [
    _edge("uuid-file-api", "IMPORTS", "uuid-file-models"),
    _edge("uuid-fn-create", "CALLS", "uuid-class-task"),
    _edge("uuid-file-api", "DEFINES", "uuid-fn-create"),
]


def _clone_graph(*, drop_calls_edge: bool = False) -> dict[str, list[dict[str, Any]]]:
    """Same structure as the reference but with different (instance-local) UUIDs."""

    nodes = [
        _node("clone-file-api", "file", "backend/api.py"),
        _node("clone-file-models", "file", "backend/models.py"),
        _node("clone-fn-create", "function", "backend/api.py", name="create_task"),
        _node("clone-class-task", "class", "backend/models.py", name="Task"),
    ]
    edges = [
        _edge("clone-file-api", "IMPORTS", "clone-file-models"),
        _edge("clone-file-api", "DEFINES", "clone-fn-create"),
    ]
    if not drop_calls_edge:
        edges.append(_edge("clone-fn-create", "CALLS", "clone-class-task"))
    return {"nodes": nodes, "edges": edges}


def _side(workspace_id: str, root: str = "", excludes: tuple[str, ...] = ()) -> igc.SideConfig:
    return igc.SideConfig(
        label="reference" if workspace_id == "ws-ref" else "clone",
        endpoint="http://127.0.0.1:8529",
        db="ix_memory",
        workspace_id=workspace_id,
        root=root,
        kinds=igc.DEFAULT_KINDS,
        excludes=excludes,
    )


# --------------------------------------------------------------------------
# Revision collapse
# --------------------------------------------------------------------------


def test_collapse_revisions_keeps_latest_live_revision() -> None:
    docs = [
        _node("uuid-1", "function", "backend/api.py", name="old_name", created_rev=1),
        _node("uuid-1", "function", "backend/api.py", name="new_name", created_rev=3),
        _node("uuid-1", "function", "backend/api.py", name="middle_name", created_rev=2),
    ]

    collapsed = igc.collapse_revisions(docs)

    assert len(collapsed) == 1
    assert collapsed[0]["name"] == "new_name"


def test_collapse_revisions_drops_tombstoned_docs() -> None:
    docs = [
        _node("uuid-live", "file", "backend/api.py", created_rev=1),
        _node("uuid-dead", "file", "backend/gone.py", created_rev=1, deleted_rev=5),
    ]

    collapsed = igc.collapse_revisions(docs)

    assert [d["logical_id"] for d in collapsed] == ["uuid-live"]


# --------------------------------------------------------------------------
# Canonicalization
# --------------------------------------------------------------------------


def test_canonical_ids_per_kind() -> None:
    docs = [
        _node("u1", "file", "backend/api.py"),
        _node("u2", "module", "backend"),
        _node("u3", "function", "backend/api.py", name="create_task"),
        _node("u4", "method", "backend/models.py", name="save"),
        _node("u5", "class", "backend/models.py", name="Task"),
    ]

    canonical = igc.canonicalize_nodes(docs, root="")

    assert canonical.ids == frozenset(
        {
            "file:backend/api.py",
            "module:backend",
            "function:backend/api.py::create_task",
            "method:backend/models.py::save",
            "class:backend/models.py::Task",
        }
    )


def test_root_prefix_is_scoped_and_stripped() -> None:
    docs = [
        _node("u1", "file", "examples/reference-app/backend/api.py"),
        _node("u2", "file", "web/other.py"),  # outside the root
    ]

    canonical = igc.canonicalize_nodes(docs, root="examples/reference-app")

    assert canonical.ids == frozenset({"file:backend/api.py"})
    assert canonical.skipped_outside_root == 1


def test_exclude_globs_drop_matching_paths() -> None:
    docs = [
        _node("u1", "file", "backend/api.py"),
        _node("u2", "file", "tests/test_api.py"),
    ]

    canonical = igc.canonicalize_nodes(docs, root="", excludes=("tests/**",))

    assert canonical.ids == frozenset({"file:backend/api.py"})
    assert canonical.skipped_excluded == 1


def test_unnamed_symbol_nodes_are_skipped_and_counted() -> None:
    docs = [_node("u1", "function", "backend/api.py", name="")]

    canonical = igc.canonicalize_nodes(docs, root="")

    assert canonical.ids == frozenset()
    assert canonical.skipped_unnamed == 1


# --------------------------------------------------------------------------
# Edge triple resolution
# --------------------------------------------------------------------------


def test_edges_resolve_through_canonical_map_and_count_unresolved() -> None:
    nodes = igc.canonicalize_nodes(
        [
            _node("u-src", "file", "backend/api.py"),
            _node("u-dst", "file", "backend/models.py"),
        ],
        root="",
    )
    edge_docs = [
        _edge("u-src", "IMPORTS", "u-dst"),
        _edge("u-src", "CALLS", "u-unknown"),  # dst never canonicalized
    ]

    edges = igc.canonicalize_edges(edge_docs, nodes)

    assert edges.triples == frozenset({("file:backend/api.py", "IMPORTS", "file:backend/models.py")})
    assert edges.unresolved == 1


# --------------------------------------------------------------------------
# Full comparison via run_compare
# --------------------------------------------------------------------------


def test_identical_graphs_score_perfect_despite_different_uuids(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeArango(
        {
            "ws-ref": {"nodes": REFERENCE_NODES, "edges": REFERENCE_EDGES},
            "ws-clone": _clone_graph(),
        }
    )
    monkeypatch.setattr(igc, "_arango_query", fake)

    snapshot = igc.run_compare(
        _side("ws-ref"), _side("ws-clone"), igc.DEFAULT_PREDICATES,
        min_node_recall=1.0, min_edge_recall=1.0,
    )

    assert snapshot["passed"] is True
    assert snapshot["hard_failures"] == []
    assert snapshot["comparison"]["nodes"]["recall"] == 1.0
    assert snapshot["comparison"]["nodes"]["precision"] == 1.0
    assert snapshot["comparison"]["edges"]["overall"]["jaccard"] == 1.0
    assert snapshot["comparison"]["gaps"] == []


def test_missing_calls_edge_fails_threshold_with_gap_line(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeArango(
        {
            "ws-ref": {"nodes": REFERENCE_NODES, "edges": REFERENCE_EDGES},
            "ws-clone": _clone_graph(drop_calls_edge=True),
        }
    )
    monkeypatch.setattr(igc, "_arango_query", fake)

    snapshot = igc.run_compare(
        _side("ws-ref"), _side("ws-clone"), igc.DEFAULT_PREDICATES,
        min_node_recall=1.0, min_edge_recall=1.0,
    )

    assert snapshot["passed"] is False
    assert snapshot["comparison"]["edges"]["overall"]["recall"] < 1.0
    assert snapshot["comparison"]["edges"]["per_predicate"]["CALLS"]["recall"] == 0.0
    assert snapshot["comparison"]["edges"]["per_predicate"]["IMPORTS"]["recall"] == 1.0
    expected_gap = (
        "clone missing function:backend/api.py::create_task --CALLS--> class:backend/models.py::Task"
    )
    assert expected_gap in snapshot["comparison"]["gaps"]
    assert any("edge recall" in failure for failure in snapshot["hard_failures"])


def test_lower_threshold_lets_partial_clone_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeArango(
        {
            "ws-ref": {"nodes": REFERENCE_NODES, "edges": REFERENCE_EDGES},
            "ws-clone": _clone_graph(drop_calls_edge=True),
        }
    )
    monkeypatch.setattr(igc, "_arango_query", fake)

    snapshot = igc.run_compare(
        _side("ws-ref"), _side("ws-clone"), igc.DEFAULT_PREDICATES,
        min_node_recall=1.0, min_edge_recall=0.5,
    )

    assert snapshot["passed"] is True


# --------------------------------------------------------------------------
# Fail-closed transport behavior
# --------------------------------------------------------------------------


def test_malformed_cursor_response_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_http(method: str, url: str, payload: Any, timeout: float) -> dict[str, Any]:
        return {"unexpected": "shape"}  # no 'result' list

    monkeypatch.setattr(igc, "_http_json", fake_http)

    with pytest.raises(igc.GraphCompareError, match="missing a 'result' list"):
        igc._arango_query("http://127.0.0.1:8529", "ix_memory", "FOR n IN nodes RETURN n")


def test_arango_error_flag_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_http(method: str, url: str, payload: Any, timeout: float) -> dict[str, Any]:
        return {"error": True, "errorMessage": "collection not found"}

    monkeypatch.setattr(igc, "_http_json", fake_http)

    with pytest.raises(igc.GraphCompareError, match="collection not found"):
        igc._arango_query("http://127.0.0.1:8529", "ix_memory", "FOR n IN nodes RETURN n")


def test_cursor_pagination_follows_has_more(monkeypatch: pytest.MonkeyPatch) -> None:
    responses = [
        {"result": [1, 2], "hasMore": True, "id": "cursor-1"},
        {"result": [3], "hasMore": False},
    ]
    calls: list[tuple[str, str]] = []

    def fake_http(method: str, url: str, payload: Any, timeout: float) -> dict[str, Any]:
        calls.append((method, url))
        return responses[len(calls) - 1]

    monkeypatch.setattr(igc, "_http_json", fake_http)

    result = igc._arango_query("http://127.0.0.1:8529", "ix_memory", "FOR n IN nodes RETURN n")

    assert result == [1, 2, 3]
    assert calls[0][0] == "POST"
    assert calls[1] == ("PUT", "http://127.0.0.1:8529/_db/ix_memory/_api/cursor/cursor-1")


def test_unreachable_arango_exits_nonzero(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_query(*args: Any, **kwargs: Any) -> list[Any]:
        raise igc.GraphCompareError("Could not reach Arango at http://127.0.0.1:8529: refused")

    monkeypatch.setattr(igc, "_arango_query", fake_query)

    exit_code = igc.main(
        [
            "--workspace-a", "ws-ref",
            "--workspace-b", "ws-clone",
            "--snapshot-dir", str(tmp_path / "graph-compare"),
        ]
    )

    assert exit_code == 1


# --------------------------------------------------------------------------
# CLI / snapshot writing
# --------------------------------------------------------------------------


def test_main_writes_deterministic_snapshot_and_exit_code(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = FakeArango(
        {
            "ws-ref": {"nodes": REFERENCE_NODES, "edges": REFERENCE_EDGES},
            "ws-clone": _clone_graph(),
        }
    )
    monkeypatch.setattr(igc, "_arango_query", fake)

    snapshot_dir = tmp_path / "graph-compare"
    exit_code = igc.main(
        [
            "--workspace-a", "ws-ref",
            "--workspace-b", "ws-clone",
            "--snapshot-dir", str(snapshot_dir),
        ]
    )

    assert exit_code == 0
    named = json.loads((snapshot_dir / "ws-ref_vs_ws-clone.json").read_text())
    latest = json.loads((snapshot_dir / "latest.json").read_text())
    assert named == latest
    assert named["passed"] is True
    assert "generated_at" not in named  # snapshot content must be timestamp-independent


def test_main_returns_nonzero_when_thresholds_fail(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango(
        {
            "ws-ref": {"nodes": REFERENCE_NODES, "edges": REFERENCE_EDGES},
            "ws-clone": _clone_graph(drop_calls_edge=True),
        }
    )
    monkeypatch.setattr(igc, "_arango_query", fake)

    exit_code = igc.main(
        [
            "--workspace-a", "ws-ref",
            "--workspace-b", "ws-clone",
            "--snapshot-dir", str(tmp_path / "graph-compare"),
        ]
    )

    assert exit_code == 1


def test_main_requires_workspace_ids() -> None:
    assert igc.main([]) == 1


# --------------------------------------------------------------------------
# Graph proposals
# --------------------------------------------------------------------------


def _write_proposal(tmp_path: Path, **overrides: Any) -> Path:
    document: dict[str, Any] = {
        "version": 1,
        "tree_id": "tree-1",
        "plan_ref": ".agent/task-trees/tree-1.json",
        "created_at": "2026-07-15T00:00:00.000Z",
        "root": "",
        "add_nodes": ["file:backend/api.py", "function:backend/api.py::create_task"],
        "add_edges": [
            {
                "src": "file:backend/api.py",
                "predicate": "IMPORTS",
                "dst": "file:backend/models.py",
                "confidence": "structural",
            },
        ],
        "remove_nodes": [],
        "remove_edges": [],
        "node_prefixes": [],
    }
    document.update(overrides)
    path = tmp_path / "tree-1.graph-proposal.json"
    path.write_text(json.dumps(document))
    return path


def test_load_graph_proposal_parses_valid_file(tmp_path: Path) -> None:
    path = _write_proposal(
        tmp_path,
        add_edges=[
            {"src": "file:backend/api.py", "predicate": "IMPORTS", "dst": "file:backend/models.py", "confidence": "structural"},
            {"src": "function:backend/api.py::create_task", "predicate": "CALLS", "dst": "class:backend/models.py::Task"},
        ],
        node_prefixes=["backend/"],
    )

    proposal = igc.load_graph_proposal(path)

    assert proposal.tree_id == "tree-1"
    assert proposal.add_nodes == frozenset({"file:backend/api.py", "function:backend/api.py::create_task"})
    assert proposal.structural_edges == frozenset(
        {("file:backend/api.py", "IMPORTS", "file:backend/models.py")}
    )
    # Missing confidence defaults to speculative.
    assert proposal.speculative_edges == frozenset(
        {("function:backend/api.py::create_task", "CALLS", "class:backend/models.py::Task")}
    )
    assert proposal.node_prefixes == ("backend",)


def test_load_graph_proposal_rejects_malformed_node_id(tmp_path: Path) -> None:
    path = _write_proposal(tmp_path, add_nodes=["backend/api.py"])  # no kind prefix

    with pytest.raises(igc.GraphCompareError, match="missing a 'kind:' prefix"):
        igc.load_graph_proposal(path)


def test_load_graph_proposal_rejects_unknown_kind_and_predicate(tmp_path: Path) -> None:
    with pytest.raises(igc.GraphCompareError, match="unknown kind"):
        igc.load_graph_proposal(_write_proposal(tmp_path, add_nodes=["widget:backend/api.py"]))

    with pytest.raises(igc.GraphCompareError, match="unknown predicate"):
        igc.load_graph_proposal(
            _write_proposal(
                tmp_path,
                add_edges=[{"src": "file:a.py", "predicate": "USES", "dst": "file:b.py"}],
            )
        )


def test_load_graph_proposal_rejects_symbol_id_without_name(tmp_path: Path) -> None:
    with pytest.raises(igc.GraphCompareError, match="must look like"):
        igc.load_graph_proposal(_write_proposal(tmp_path, add_nodes=["function:backend/api.py"]))


def test_load_graph_proposal_rejects_wrong_version(tmp_path: Path) -> None:
    with pytest.raises(igc.GraphCompareError, match="unsupported version"):
        igc.load_graph_proposal(_write_proposal(tmp_path, version=2))


def _proposal_side() -> igc.SideConfig:
    return _side("ws-clone")


def test_proposal_fully_present_in_clone_passes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph()})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal = igc.load_graph_proposal(_write_proposal(tmp_path))

    snapshot = igc.run_proposal_compare(proposal, _proposal_side(), min_node_recall=1.0, min_edge_recall=1.0)

    assert snapshot["passed"] is True
    assert snapshot["hard_failures"] == []
    assert snapshot["comparison"]["nodes"]["recall"] == 1.0
    assert snapshot["comparison"]["nodes"]["matched_in_clone"] == sorted(proposal.add_nodes)
    assert snapshot["comparison"]["nodes"]["missing_in_clone"] == []
    assert snapshot["comparison"]["edges"]["structural"]["recall"] == 1.0
    assert snapshot["comparison"]["gaps"] == []


def test_proposal_missing_structural_edge_fails_with_gap(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph(drop_calls_edge=True)})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal = igc.load_graph_proposal(
        _write_proposal(
            tmp_path,
            add_edges=[
                {
                    "src": "function:backend/api.py::create_task",
                    "predicate": "CALLS",
                    "dst": "class:backend/models.py::Task",
                    "confidence": "structural",
                },
            ],
        )
    )

    snapshot = igc.run_proposal_compare(proposal, _proposal_side(), min_node_recall=1.0, min_edge_recall=1.0)

    assert snapshot["passed"] is False
    assert snapshot["comparison"]["edges"]["structural"]["recall"] == 0.0
    expected_gap = (
        "clone missing proposed function:backend/api.py::create_task --CALLS--> class:backend/models.py::Task"
    )
    assert expected_gap in snapshot["comparison"]["gaps"]
    assert any("structural edge recall" in failure for failure in snapshot["hard_failures"])


def test_proposal_speculative_edges_are_advisory_only(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph(drop_calls_edge=True)})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal = igc.load_graph_proposal(
        _write_proposal(
            tmp_path,
            add_edges=[
                {
                    "src": "function:backend/api.py::create_task",
                    "predicate": "CALLS",
                    "dst": "class:backend/models.py::Task",
                    "confidence": "speculative",
                },
            ],
        )
    )

    snapshot = igc.run_proposal_compare(proposal, _proposal_side(), min_node_recall=1.0, min_edge_recall=1.0)

    assert snapshot["passed"] is True
    speculative = snapshot["comparison"]["edges"]["speculative"]
    assert speculative["recall"] == 0.0
    assert speculative["missing_in_clone"] != []
    # Missing speculative edges are reported but never become gaps or hard failures.
    assert snapshot["comparison"]["gaps"] == []


def test_proposal_removal_still_present_fails(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph()})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal = igc.load_graph_proposal(
        _write_proposal(tmp_path, remove_nodes=["file:backend/api.py"])
    )

    snapshot = igc.run_proposal_compare(proposal, _proposal_side(), min_node_recall=1.0, min_edge_recall=1.0)

    assert snapshot["passed"] is False
    assert snapshot["comparison"]["removals"]["nodes_still_present"] == ["file:backend/api.py"]
    assert "proposed removal still present: node file:backend/api.py" in snapshot["comparison"]["gaps"]
    assert any("removal" in failure for failure in snapshot["hard_failures"])


def test_proposal_prefix_coverage_is_advisory(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph()})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal = igc.load_graph_proposal(
        _write_proposal(tmp_path, node_prefixes=["backend", "frontend"])
    )

    snapshot = igc.run_proposal_compare(proposal, _proposal_side(), min_node_recall=1.0, min_edge_recall=1.0)

    assert snapshot["comparison"]["prefixes"]["covered"] == ["backend"]
    assert snapshot["comparison"]["prefixes"]["uncovered"] == ["frontend"]
    # Uncovered prefixes never affect pass/fail.
    assert snapshot["passed"] is True


def test_main_proposal_writes_snapshot_and_exit_code(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph()})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal_path = _write_proposal(tmp_path)
    snapshot_dir = tmp_path / "graph-compare"

    exit_code = igc.main(
        [
            "--proposal", str(proposal_path),
            "--workspace-b", "ws-clone",
            "--snapshot-dir", str(snapshot_dir),
        ]
    )

    assert exit_code == 0
    named = json.loads((snapshot_dir / "proposal_tree-1_vs_ws-clone.json").read_text())
    latest = json.loads((snapshot_dir / "latest-proposal.json").read_text())
    assert named == latest
    assert named["passed"] is True
    assert not (snapshot_dir / "latest.json").exists()  # never clobbers workspace-vs-workspace snapshots


def test_main_proposal_missing_node_returns_nonzero(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = FakeArango({"ws-clone": _clone_graph()})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal_path = _write_proposal(tmp_path, add_nodes=["file:backend/missing.py"])

    exit_code = igc.main(
        [
            "--proposal", str(proposal_path),
            "--workspace-b", "ws-clone",
            "--snapshot-dir", str(tmp_path / "graph-compare"),
        ]
    )

    assert exit_code == 1


def test_main_rejects_proposal_combined_with_workspace_a(tmp_path: Path) -> None:
    assert igc.main(
        [
            "--proposal", str(_write_proposal(tmp_path)),
            "--workspace-a", "ws-ref",
            "--workspace-b", "ws-clone",
        ]
    ) == 1


def test_main_proposal_root_defaults_from_proposal(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    scoped_nodes = [
        _node("clone-file-api", "file", "examples/reference-app/backend/api.py"),
        _node("clone-fn-create", "function", "examples/reference-app/backend/api.py", name="create_task"),
        _node("clone-file-models", "file", "examples/reference-app/backend/models.py"),
    ]
    scoped_edges = [_edge("clone-file-api", "IMPORTS", "clone-file-models")]
    fake = FakeArango({"ws-clone": {"nodes": scoped_nodes, "edges": scoped_edges}})
    monkeypatch.setattr(igc, "_arango_query", fake)
    proposal_path = _write_proposal(tmp_path, root="examples/reference-app")

    exit_code = igc.main(
        [
            "--proposal", str(proposal_path),
            "--workspace-b", "ws-clone",
            "--snapshot-dir", str(tmp_path / "graph-compare"),
        ]
    )

    assert exit_code == 0


# --------------------------------------------------------------------------
# Workspace listing
# --------------------------------------------------------------------------


def test_list_workspaces_parses_flat_config(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    config.write_text(
        "endpoint: http://localhost:8090\n"
        "format: text\n"
        "workspaces:\n"
        '  - workspace_id: "52379e01"\n'
        "    workspace_name: vscode\n"
        "    root_path: /Users/example/vscode\n"
        "    default: true\n"
        "  - workspace_id: 4c13acde\n"
        "    workspace_name: reference-app\n"
        "    root_path: /Users/example/vscode/examples/reference-app\n"
        "    default: false\n"
    )

    entries = igc.list_workspaces(config)

    assert entries == [
        {
            "workspace_id": "52379e01",
            "workspace_name": "vscode",
            "root_path": "/Users/example/vscode",
            "default": "true",
        },
        {
            "workspace_id": "4c13acde",
            "workspace_name": "reference-app",
            "root_path": "/Users/example/vscode/examples/reference-app",
            "default": "false",
        },
    ]


def test_list_workspaces_missing_config_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(igc.GraphCompareError, match="Could not read ix config"):
        igc.list_workspaces(tmp_path / "does-not-exist.yaml")

"""Tests for scripts/ix_clone_loop.py.

The loop's three seams are monkeypatched: ``ix_graph_compare._arango_query``
(graph reads), ``ix_clone_loop._run_agent`` (headless agent), and
``ix_clone_loop._run_ix_map`` (re-ingest). A mutable ``FakeWorld`` backs all
three so the loop genuinely converges through its own control flow: the fake
agent "repairs" the clone graph, and the next compare sees the fix. No live
Arango, ix, or claude CLI is required.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import ix_clone_loop as icl  # noqa: E402
import ix_graph_compare as igc  # noqa: E402


# --------------------------------------------------------------------------
# Fixtures / helpers
# --------------------------------------------------------------------------


def _node(logical_id: str, kind: str, source_uri: str, name: str | None = None) -> dict[str, Any]:
    return {
        "kind": kind,
        "name": name if name is not None else Path(source_uri).name,
        "logical_id": logical_id,
        "created_rev": 1,
        "deleted_rev": None,
        "source_uri": source_uri,
    }


def _edge(src: str, predicate: str, dst: str) -> dict[str, Any]:
    return {"src": src, "dst": dst, "predicate": predicate}


REF_WS = "ws-ref"
CLONE_WS = "ws-clone"

REFERENCE_NODES = [
    _node("r-file-pool", "file", "database/pool.py"),
    _node("r-fn-encode", "function", "database/pool.py", name="_encode_vector"),
    _node("r-fn-decode", "function", "database/pool.py", name="_decode_vector"),
]

MISSING_NODE_DOC = _node("c-fn-encode", "function", "database/pool.py", name="_encode_vector")

MISSING_GAP_LINE = "clone missing node function:database/pool.py::_encode_vector"


class FakeWorld:
    """Mutable graph store + call recorder shared by all three seams."""

    def __init__(self, clone_missing_encode: bool = True, agent_fixes: bool = True) -> None:
        self.graphs: dict[str, dict[str, list[dict[str, Any]]]] = {
            REF_WS: {"nodes": list(REFERENCE_NODES), "edges": []},
            CLONE_WS: {
                "nodes": [
                    _node("c-file-pool", "file", "database/pool.py"),
                    _node("c-fn-decode", "function", "database/pool.py", name="_decode_vector"),
                ],
                "edges": [],
            },
        }
        if not clone_missing_encode:
            self.graphs[CLONE_WS]["nodes"].append(MISSING_NODE_DOC)
        self.agent_fixes = agent_fixes
        self.agent_prompts: list[str] = []
        self.map_calls: list[Path] = []

    # ---- igc._arango_query seam ----
    def arango_query(
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
        graph = self.graphs.get(workspace, {"nodes": [], "edges": []})
        kinds = set(bind_vars.get("kinds", []))
        live_nodes = [n for n in graph["nodes"] if n["kind"] in kinds and n["deleted_rev"] is None]
        if "COLLECT WITH COUNT INTO" in aql:
            return [len(live_nodes)]
        if "FOR n IN nodes" in aql:
            return live_nodes
        if "FOR e IN edges" in aql:
            predicates = set(bind_vars.get("predicates", []))
            return [e for e in graph["edges"] if e["predicate"] in predicates]
        raise AssertionError(f"unexpected AQL query: {aql}")

    # ---- icl._run_agent seam ----
    def run_agent(self, cmd: list[str], prompt: str, cwd: Path, timeout: float) -> str:
        self.agent_prompts.append(prompt)
        if self.agent_fixes:
            self.graphs[CLONE_WS]["nodes"].append(dict(MISSING_NODE_DOC))
        return "agent transcript"

    # ---- icl._run_ix_map seam ----
    def run_ix_map(self, clone_dir: Path, timeout: float = 0.0) -> None:
        self.map_calls.append(clone_dir)


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> FakeWorld:
    fake = FakeWorld()
    monkeypatch.setattr(igc, "_arango_query", fake.arango_query)
    monkeypatch.setattr(icl, "_run_agent", fake.run_agent)
    monkeypatch.setattr(icl, "_run_ix_map", fake.run_ix_map)
    monkeypatch.setattr(icl, "_sleep", lambda seconds: None)
    return fake


def _config(tmp_path: Path, **overrides: Any) -> icl.LoopConfig:
    defaults: dict[str, Any] = {
        "reference_workspace": REF_WS,
        "clone_workspace": CLONE_WS,
        "clone_dir": tmp_path / "clone",
        "run_dir": tmp_path / "run",
        "reference_dir": tmp_path / "reference",
        "min_node_recall": 1.0,
        "min_edge_recall": 0.0,
        "max_iterations": 3,
        "poll_interval": 0.01,
        "ingest_timeout": 1.0,
    }
    defaults.update(overrides)
    return icl.LoopConfig(**defaults)


# --------------------------------------------------------------------------
# Loop control flow
# --------------------------------------------------------------------------


def test_pass_on_first_compare_never_invokes_agent(
    monkeypatch: pytest.MonkeyPatch, world: FakeWorld, tmp_path: Path
) -> None:
    world.graphs[CLONE_WS]["nodes"].append(dict(MISSING_NODE_DOC))  # already complete

    summary = icl.run_loop(_config(tmp_path))

    assert summary["status"] == "passed"
    assert summary["agent_invocations"] == 0
    assert len(summary["iterations"]) == 1
    assert world.agent_prompts == []
    assert world.map_calls == []


def test_agent_repair_converges_on_second_iteration(world: FakeWorld, tmp_path: Path) -> None:
    summary = icl.run_loop(_config(tmp_path))

    assert summary["status"] == "passed"
    assert summary["agent_invocations"] == 1
    assert [e["passed"] for e in summary["iterations"]] == [False, True]
    assert summary["iterations"][0]["agent_ran"] is True
    assert summary["iterations"][0]["node_recall"] < 1.0
    assert summary["iterations"][1]["node_recall"] == 1.0
    # The agent was told exactly what to restore, and where to look.
    assert MISSING_GAP_LINE.replace("clone missing node ", "") in world.agent_prompts[0]
    assert str(tmp_path / "reference") in world.agent_prompts[0]
    # ix map ran once, on the clone dir.
    assert world.map_calls == [tmp_path / "clone"]


def test_max_iterations_exhausted_reports_failed(world: FakeWorld, tmp_path: Path) -> None:
    world.agent_fixes = False  # agent runs but never fixes anything

    summary = icl.run_loop(_config(tmp_path, max_iterations=2))

    assert summary["status"] == "failed"
    assert summary["agent_invocations"] == 1  # no agent run after the final compare
    assert [e["passed"] for e in summary["iterations"]] == [False, False]


def test_loop_writes_iteration_artifacts_and_summary(world: FakeWorld, tmp_path: Path) -> None:
    cfg = _config(tmp_path)
    icl.run_loop(cfg)

    iter1 = cfg.run_dir / "iter-1"
    assert (iter1 / "compare.json").is_file()
    assert (iter1 / "prompt.md").is_file()
    assert (iter1 / "agent-output.txt").read_text() == "agent transcript"
    assert (cfg.run_dir / "iter-2" / "compare.json").is_file()

    summary = json.loads((cfg.run_dir / "summary.json").read_text())
    assert summary["status"] == "passed"
    assert "generated_at" not in summary  # deterministic, timestamp-free content


def test_empty_clone_workspace_fails_closed(world: FakeWorld, tmp_path: Path) -> None:
    world.graphs[CLONE_WS]["nodes"] = []

    with pytest.raises(icl.CloneLoopError, match="no canonical nodes"):
        icl.run_loop(_config(tmp_path))


def test_agent_failure_propagates(monkeypatch: pytest.MonkeyPatch, world: FakeWorld, tmp_path: Path) -> None:
    def broken_agent(cmd: list[str], prompt: str, cwd: Path, timeout: float) -> str:
        raise icl.CloneLoopError("Agent exited with code 2: boom")

    monkeypatch.setattr(icl, "_run_agent", broken_agent)

    with pytest.raises(icl.CloneLoopError, match="code 2"):
        icl.run_loop(_config(tmp_path))


# --------------------------------------------------------------------------
# Ingest settling
# --------------------------------------------------------------------------


def test_wait_for_ingest_requires_two_stable_nonzero_polls(
    monkeypatch: pytest.MonkeyPatch, world: FakeWorld
) -> None:
    counts = iter([0, 3, 5, 5])

    def fake_query(*args: Any, **kwargs: Any) -> list[Any]:
        return [next(counts)]

    monkeypatch.setattr(igc, "_arango_query", fake_query)

    settled = icl.wait_for_ingest("http://x", "db", CLONE_WS, igc.DEFAULT_KINDS, ingest_timeout=10.0, poll_interval=0.01)

    assert settled == 5


def test_wait_for_ingest_times_out_on_unstable_counts(
    monkeypatch: pytest.MonkeyPatch, world: FakeWorld
) -> None:
    tick = {"n": 0}

    def fake_query(*args: Any, **kwargs: Any) -> list[Any]:
        tick["n"] += 1
        return [tick["n"]]  # strictly increasing, never stable

    monkeypatch.setattr(igc, "_arango_query", fake_query)

    with pytest.raises(icl.CloneLoopError, match="did not settle"):
        icl.wait_for_ingest("http://x", "db", CLONE_WS, igc.DEFAULT_KINDS, ingest_timeout=0.05, poll_interval=0.01)


# --------------------------------------------------------------------------
# Workspace resolution
# --------------------------------------------------------------------------


def _write_ix_config(tmp_path: Path, entries: list[tuple[str, str]]) -> Path:
    lines = ["endpoint: http://localhost:8090", "workspaces:"]
    for ws_id, root in entries:
        lines += [f"  - workspace_id: {ws_id}", "    workspace_name: x", f"    root_path: {root}", "    default: false"]
    config = tmp_path / "config.yaml"
    config.write_text("\n".join(lines) + "\n")
    return config


def test_resolve_clone_workspace_by_root_path(tmp_path: Path) -> None:
    clone_dir = tmp_path / "clone"
    clone_dir.mkdir()
    config = _write_ix_config(tmp_path, [("aaaa1111", str(tmp_path / "other")), ("bbbb2222", str(clone_dir))])

    assert icl.resolve_clone_workspace(clone_dir, None, config) == "bbbb2222"


def test_resolve_clone_workspace_prefers_explicit_id(tmp_path: Path) -> None:
    assert icl.resolve_clone_workspace(tmp_path, "cccc3333", tmp_path / "missing.yaml") == "cccc3333"


def test_resolve_clone_workspace_no_match_fails_closed(tmp_path: Path) -> None:
    clone_dir = tmp_path / "clone"
    clone_dir.mkdir()
    config = _write_ix_config(tmp_path, [("aaaa1111", str(tmp_path / "other"))])

    with pytest.raises(icl.CloneLoopError, match="No workspace"):
        icl.resolve_clone_workspace(clone_dir, None, config)


def test_resolve_clone_workspace_ambiguous_fails_closed(tmp_path: Path) -> None:
    clone_dir = tmp_path / "clone"
    clone_dir.mkdir()
    config = _write_ix_config(tmp_path, [("aaaa1111", str(clone_dir)), ("bbbb2222", str(clone_dir))])

    with pytest.raises(icl.CloneLoopError, match="Multiple workspaces"):
        icl.resolve_clone_workspace(clone_dir, None, config)


# --------------------------------------------------------------------------
# Repair prompt builder
# --------------------------------------------------------------------------


def _snapshot(
    missing_nodes: list[str],
    missing_edges: list[str],
    reference_edges: int,
) -> dict[str, Any]:
    return {
        "reference": {"canonical_edges": reference_edges},
        "comparison": {
            "nodes": {"missing_in_clone": missing_nodes},
            "edges": {"missing_in_clone": missing_edges},
        },
    }


def test_prompt_lists_missing_nodes_before_edges() -> None:
    snapshot = _snapshot(
        missing_nodes=["function:a.py::f"],
        missing_edges=["function:a.py::f --CALLS--> function:b.py::g"],
        reference_edges=10,
    )

    prompt = icl.build_repair_prompt(snapshot, Path("/clone"), Path("/ref"), max_gaps=50)

    assert prompt.index("function:a.py::f") < prompt.index("--CALLS-->")
    assert "## Missing symbols" in prompt
    assert "## Missing relationships" in prompt
    assert "/ref" in prompt
    assert "never modify it" in prompt


def test_prompt_suppresses_edge_section_when_reference_has_no_live_edges() -> None:
    snapshot = _snapshot(
        missing_nodes=["function:a.py::f"],
        missing_edges=[],
        reference_edges=0,
    )

    prompt = icl.build_repair_prompt(snapshot, Path("/clone"), None, max_gaps=50)

    assert "edge-level parity is unavailable" in prompt
    assert "## Missing relationships" not in prompt
    assert "Reference codebase" not in prompt  # no reference dir provided


def test_prompt_caps_gap_lines_at_max_gaps() -> None:
    snapshot = _snapshot(
        missing_nodes=[f"function:a.py::f{i}" for i in range(10)],
        missing_edges=[],
        reference_edges=0,
    )

    prompt = icl.build_repair_prompt(snapshot, Path("/clone"), None, max_gaps=4)

    assert prompt.count("- function:a.py::f") == 4
    assert "and 6 more missing symbols" in prompt


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def test_main_exit_codes(world: FakeWorld, tmp_path: Path) -> None:
    clone_dir = tmp_path / "clone"
    clone_dir.mkdir()

    exit_code = icl.main(
        [
            "--reference-workspace", REF_WS,
            "--clone-workspace", CLONE_WS,
            "--clone-dir", str(clone_dir),
            "--run-dir", str(tmp_path / "run"),
        ]
    )

    assert exit_code == 0
    summary = json.loads((tmp_path / "run" / "summary.json").read_text())
    assert summary["status"] == "passed"


def test_main_returns_nonzero_when_loop_fails(world: FakeWorld, tmp_path: Path) -> None:
    world.agent_fixes = False
    clone_dir = tmp_path / "clone"
    clone_dir.mkdir()

    exit_code = icl.main(
        [
            "--reference-workspace", REF_WS,
            "--clone-workspace", CLONE_WS,
            "--clone-dir", str(clone_dir),
            "--run-dir", str(tmp_path / "run"),
            "--max-iterations", "2",
        ]
    )

    assert exit_code == 1


def test_main_rejects_missing_clone_dir(tmp_path: Path) -> None:
    exit_code = icl.main(
        [
            "--reference-workspace", REF_WS,
            "--clone-workspace", CLONE_WS,
            "--clone-dir", str(tmp_path / "does-not-exist"),
        ]
    )

    assert exit_code == 1

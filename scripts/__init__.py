"""Public Python API index for the ix verification tooling in scripts/.

This package re-exports every function that is considered public API across
the three tools, so `from scripts import run_compare` (with the repo root on
sys.path) is the single import point. Anything not listed in __all__ —
leading-underscore helpers, AQL strings, CLI plumbing — is internal and may
change without notice.

The agent-facing surface is narrower still: scripts/ix_graph_mcp.py exposes
`compare_graphs`, `remap_and_wait`, and `list_workspaces` as MCP tools.

Tools:
- ix_graph_compare: live Arango workspace-vs-workspace and proposal compare.
- ix_clone_loop:    agent repair loop driver (compare -> prompt -> re-map).
- ix_scaffold_check: contract checker over the public ix CLI exports.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

# The modules import each other by bare name (`import ix_graph_compare`), so
# the scripts directory itself must be importable regardless of whether the
# caller imported this package or added scripts/ to sys.path directly.
_SCRIPTS_DIR = str(_Path(__file__).resolve().parent)
if _SCRIPTS_DIR not in _sys.path:
    _sys.path.insert(0, _SCRIPTS_DIR)

from ix_graph_compare import (  # noqa: E402
    GraphCompareError,
    GraphProposal,
    SideConfig,
    canonicalize_edges,
    canonicalize_nodes,
    collapse_revisions,
    compare_graphs,
    compare_proposal,
    fetch_edge_docs,
    fetch_node_docs,
    list_workspaces,
    load_graph_proposal,
    run_compare,
    run_proposal_compare,
    write_proposal_snapshot,
    write_snapshot,
)
from ix_clone_loop import (  # noqa: E402
    CloneLoopError,
    LoopConfig,
    build_repair_prompt,
    count_canonical_nodes,
    resolve_clone_workspace,
    run_loop,
    wait_for_ingest,
)
from ix_scaffold_check import (  # noqa: E402
    Contract,
    ScaffoldCheckError,
    build_snapshot,
    load_contract,
    run_check,
    run_ix_inventory_files,
    run_ix_map,
    run_ix_status_revision,
    run_ix_subsystems_detailed,
)

__all__ = [
    # ix_graph_compare — live graph comparison
    "GraphCompareError",
    "GraphProposal",
    "SideConfig",
    "canonicalize_edges",
    "canonicalize_nodes",
    "collapse_revisions",
    "compare_graphs",
    "compare_proposal",
    "fetch_edge_docs",
    "fetch_node_docs",
    "list_workspaces",
    "load_graph_proposal",
    "run_compare",
    "run_proposal_compare",
    "write_proposal_snapshot",
    "write_snapshot",
    # ix_clone_loop — agent repair loop
    "CloneLoopError",
    "LoopConfig",
    "build_repair_prompt",
    "count_canonical_nodes",
    "resolve_clone_workspace",
    "run_loop",
    "wait_for_ingest",
    # ix_scaffold_check — CLI-contract checker
    "Contract",
    "ScaffoldCheckError",
    "build_snapshot",
    "load_contract",
    "run_check",
    "run_ix_inventory_files",
    "run_ix_map",
    "run_ix_status_revision",
    "run_ix_subsystems_detailed",
]

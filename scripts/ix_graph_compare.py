#!/usr/bin/env python3
"""Live Arango graph comparison for ix workspaces.

Compares two ix workspace graphs directly against the live ArangoDB
``ix_memory`` database (collections ``nodes`` and ``edges``) instead of the
lossy ``ix map`` / ``ix inventory`` CLI exports. Companion to
``scripts/ix_scaffold_check.py`` and follows the same conventions:

- Python 3.12+ standard library only. No third-party dependencies.
- Never joins on instance-local identity (``_key``, ``logical_id`` UUIDs,
  Louvain region labels). Nodes are matched by canonical structural IDs
  built from workspace-relative path + kind + name; edges are compared as
  ``(src_canonical, PREDICATE, dst_canonical)`` triples.
- Fails closed: connection failures, HTTP errors, and malformed cursor
  responses raise ``GraphCompareError`` and exit nonzero.
- Read-only: only AQL ``FOR ... RETURN`` queries are ever issued.

Both sides default to the same Arango endpoint (the "two workspace_ids in
one instance" mode); pass --endpoint-b to compare across two instances.

The reference side may also be a *graph proposal* file — a JSON prediction of
the nodes/edges a plan should produce, written by the agent task-tree pipeline
(see src/custom/agentTaskTree/agentTaskTreeGraphProposal.ts). Proposal
comparison is recall-oriented: the live graph legitimately contains much more
than the proposal, so precision and "extra in clone" reporting do not apply.
Edges marked "speculative" and node_prefixes are advisory only; structural
add_nodes/add_edges recall and remove_* absence gate the exit code.

Usage:
    python3 scripts/ix_graph_compare.py --list-workspaces
    python3 scripts/ix_graph_compare.py \
        --workspace-a 4c13acde --workspace-b <clone-ws-id>
    python3 scripts/ix_graph_compare.py \
        --workspace-a 52379e01 --root-a examples/reference-app \
        --workspace-b 4c13acde --root-b "" \
        --predicates CALLS,IMPORTS,DEFINES,EXTENDS \
        --min-edge-recall 0.9
    python3 scripts/ix_graph_compare.py \
        --proposal .agent/task-trees/<tree-id>.graph-proposal.json \
        --workspace-b 52379e01
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_ENDPOINT = "http://127.0.0.1:8529"
DEFAULT_DB = "ix_memory"
DEFAULT_KINDS = ("file", "function", "method", "class", "module")
DEFAULT_PREDICATES = ("CALLS", "IMPORTS", "DEFINES", "EXTENDS")
DEFAULT_SNAPSHOT_DIR = ".ix-scaffold/graph-compare"
DEFAULT_IX_CONFIG = Path.home() / ".ix" / "config.yaml"
DEFAULT_TIMEOUT = 60.0
DEFAULT_BATCH_SIZE = 5000
DEFAULT_TOP_HUBS = 15
DEFAULT_MAX_GAPS = 200


class GraphCompareError(Exception):
    """Hard infrastructure failure: Arango unreachable, malformed response."""


# --------------------------------------------------------------------------
# Arango HTTP access (stdlib only)
# --------------------------------------------------------------------------


def _http_json(method: str, url: str, payload: dict[str, Any] | None, timeout: float) -> dict[str, Any]:
    """Single HTTP transport seam — tests monkeypatch this (or _arango_query)."""

    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        raise GraphCompareError(f"Arango request {method} {url} failed with HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GraphCompareError(f"Could not reach Arango at {url}: {exc}") from exc

    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GraphCompareError(f"Arango returned malformed JSON from {url}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise GraphCompareError(f"Arango returned a non-object JSON response from {url}.")
    return parsed


def _extract_batch(body: dict[str, Any], context: str) -> tuple[list[Any], str | None]:
    if body.get("error"):
        raise GraphCompareError(f"Arango query failed ({context}): {body.get('errorMessage', 'unknown error')}")
    result = body.get("result")
    if not isinstance(result, list):
        raise GraphCompareError(f"Arango cursor response is missing a 'result' list ({context}).")
    cursor_id = body.get("id")
    return result, str(cursor_id) if cursor_id is not None else None


def _arango_query(
    endpoint: str,
    db: str,
    aql: str,
    bind_vars: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> list[Any]:
    """Run an AQL query, following the cursor until exhausted."""

    base = endpoint.rstrip("/")
    cursor_url = f"{base}/_db/{db}/_api/cursor"
    body = _http_json("POST", cursor_url, {"query": aql, "bindVars": bind_vars or {}, "batchSize": batch_size}, timeout)
    results, cursor_id = _extract_batch(body, aql.splitlines()[0].strip())

    while body.get("hasMore"):
        if not cursor_id:
            raise GraphCompareError("Arango reported hasMore=true but returned no cursor id.")
        body = _http_json("PUT", f"{cursor_url}/{cursor_id}", None, timeout)
        batch, next_id = _extract_batch(body, aql.splitlines()[0].strip())
        results.extend(batch)
        cursor_id = next_id or cursor_id
    return results


# --------------------------------------------------------------------------
# Glob matching (same semantics as ix_scaffold_check: '**' vs '*' distinct)
# --------------------------------------------------------------------------


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    out: list[str] = []
    i = 0
    n = len(pattern)
    while i < n:
        char = pattern[i]
        if char == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                out.append(".*")
                i += 2
            else:
                out.append("[^/]*")
                i += 1
        elif char == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(char))
            i += 1
    return re.compile("^" + "".join(out) + "$")


# --------------------------------------------------------------------------
# Fetch + canonicalize one workspace side
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SideConfig:
    label: str
    endpoint: str
    db: str
    workspace_id: str
    root: str
    kinds: tuple[str, ...]
    excludes: tuple[str, ...] = ()


NODES_AQL = """
FOR n IN nodes
  FILTER n.workspace_id == @workspace
  FILTER n.deleted_rev == null
  FILTER n.kind IN @kinds
  RETURN {
    kind: n.kind,
    name: n.name,
    logical_id: n.logical_id,
    created_rev: n.created_rev,
    deleted_rev: n.deleted_rev,
    source_uri: n.provenance.source_uri
  }
"""

EDGES_AQL = """
FOR e IN edges
  FILTER e.workspace_id == @workspace
  FILTER e.deleted_rev == null
  FILTER e.predicate IN @predicates
  RETURN { src: e.src, dst: e.dst, predicate: e.predicate }
"""


def fetch_node_docs(side: SideConfig, timeout: float = DEFAULT_TIMEOUT) -> list[dict[str, Any]]:
    rows = _arango_query(
        side.endpoint, side.db, NODES_AQL,
        {"workspace": side.workspace_id, "kinds": list(side.kinds)},
        timeout=timeout,
    )
    docs: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise GraphCompareError(f"Arango node row is not an object ({side.label}).")
        docs.append(row)
    return docs


def fetch_edge_docs(side: SideConfig, predicates: tuple[str, ...], timeout: float = DEFAULT_TIMEOUT) -> list[dict[str, Any]]:
    rows = _arango_query(
        side.endpoint, side.db, EDGES_AQL,
        {"workspace": side.workspace_id, "predicates": list(predicates)},
        timeout=timeout,
    )
    docs: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise GraphCompareError(f"Arango edge row is not an object ({side.label}).")
        docs.append(row)
    return docs


def collapse_revisions(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only the latest live revision per logical_id.

    The AQL already filters tombstones (deleted_rev != null), but this is
    re-checked here as defense-in-depth so a fake/altered data source can
    never smuggle deleted documents into the comparison.
    """

    latest: dict[str, dict[str, Any]] = {}
    for doc in docs:
        if doc.get("deleted_rev") is not None:
            continue
        logical_id = doc.get("logical_id")
        if not isinstance(logical_id, str) or not logical_id:
            continue
        rev = doc.get("created_rev")
        rev_num = rev if isinstance(rev, int) else -1
        current = latest.get(logical_id)
        if current is None or rev_num > (current.get("created_rev") if isinstance(current.get("created_rev"), int) else -1):
            latest[logical_id] = doc
    return list(latest.values())


@dataclass(frozen=True)
class CanonicalNodes:
    ids: frozenset[str]
    by_logical_id: dict[str, str]
    skipped_no_path: int
    skipped_outside_root: int
    skipped_excluded: int
    skipped_unnamed: int


def _relative_path(source_uri: str, root: str) -> str | None:
    """Strip the side's root prefix; None means the node is outside the root."""

    if not root:
        return source_uri
    prefix = root.rstrip("/") + "/"
    if source_uri == root.rstrip("/"):
        return None  # the root folder itself is not a comparable file
    if not source_uri.startswith(prefix):
        return None
    return source_uri[len(prefix):]


def canonicalize_nodes(docs: list[dict[str, Any]], root: str, excludes: tuple[str, ...] = ()) -> CanonicalNodes:
    exclude_patterns = tuple(_glob_to_regex(p) for p in excludes)
    by_logical_id: dict[str, str] = {}
    ids: set[str] = set()
    skipped_no_path = skipped_outside_root = skipped_excluded = skipped_unnamed = 0

    for doc in collapse_revisions(docs):
        source_uri = doc.get("source_uri")
        if not isinstance(source_uri, str) or not source_uri:
            skipped_no_path += 1
            continue
        rel_path = _relative_path(source_uri, root)
        if rel_path is None:
            skipped_outside_root += 1
            continue
        if any(p.match(rel_path) for p in exclude_patterns):
            skipped_excluded += 1
            continue

        kind = str(doc.get("kind", ""))
        name = doc.get("name")
        if kind in ("file", "module"):
            canonical = f"{kind}:{rel_path}"
        else:
            if not isinstance(name, str) or not name:
                skipped_unnamed += 1
                continue
            canonical = f"{kind}:{rel_path}::{name}"

        by_logical_id[str(doc["logical_id"])] = canonical
        ids.add(canonical)

    return CanonicalNodes(
        ids=frozenset(ids),
        by_logical_id=by_logical_id,
        skipped_no_path=skipped_no_path,
        skipped_outside_root=skipped_outside_root,
        skipped_excluded=skipped_excluded,
        skipped_unnamed=skipped_unnamed,
    )


@dataclass(frozen=True)
class CanonicalEdges:
    triples: frozenset[tuple[str, str, str]]
    unresolved: int


def canonicalize_edges(edge_docs: list[dict[str, Any]], nodes: CanonicalNodes) -> CanonicalEdges:
    triples: set[tuple[str, str, str]] = set()
    unresolved = 0
    for doc in edge_docs:
        src = nodes.by_logical_id.get(str(doc.get("src", "")))
        dst = nodes.by_logical_id.get(str(doc.get("dst", "")))
        predicate = str(doc.get("predicate", ""))
        if src is None or dst is None or not predicate:
            unresolved += 1
            continue
        triples.add((src, predicate, dst))
    return CanonicalEdges(triples=frozenset(triples), unresolved=unresolved)


# --------------------------------------------------------------------------
# Graph proposals (reference side loaded from a JSON prediction file)
# --------------------------------------------------------------------------


PROPOSAL_PATH_KINDS = ("file", "module")
PROPOSAL_SYMBOL_KINDS = ("function", "method", "class")


def _validate_canonical_node_id(value: Any, context: str) -> str:
    """Fail closed on anything that is not a canonical `kind:path[::name]` ID."""

    if not isinstance(value, str) or not value:
        raise GraphCompareError(f"Proposal {context} entry is not a non-empty string: {value!r}")
    kind, sep, rest = value.partition(":")
    if not sep:
        raise GraphCompareError(f"Proposal {context} entry {value!r} is missing a 'kind:' prefix.")
    if kind in PROPOSAL_PATH_KINDS:
        if not rest or "::" in rest or rest.startswith("/") or rest.endswith("/"):
            raise GraphCompareError(f"Proposal {context} entry {value!r} has an invalid path.")
        return value
    if kind in PROPOSAL_SYMBOL_KINDS:
        path, symbol_sep, name = rest.partition("::")
        if not symbol_sep or not path or not name or path.startswith("/") or path.endswith("/"):
            raise GraphCompareError(
                f"Proposal {context} entry {value!r} must look like '{kind}:relative/path::name'."
            )
        return value
    raise GraphCompareError(f"Proposal {context} entry {value!r} has unknown kind {kind!r}.")


def _canonical_node_path(node_id: str) -> str:
    """Path component of a canonical node ID (symbol IDs keep the part before '::')."""

    rest = node_id.partition(":")[2]
    return rest.partition("::")[0]


@dataclass(frozen=True)
class GraphProposal:
    path: str
    tree_id: str
    surface_id: str | None
    plan_ref: str | None
    root: str
    add_nodes: frozenset[str]
    structural_edges: frozenset[tuple[str, str, str]]
    speculative_edges: frozenset[tuple[str, str, str]]
    remove_nodes: frozenset[str]
    remove_edges: frozenset[tuple[str, str, str]]
    node_prefixes: tuple[str, ...]

    def predicates(self) -> tuple[str, ...]:
        found = {t[1] for t in self.structural_edges | self.speculative_edges | self.remove_edges}
        return tuple(sorted(set(DEFAULT_PREDICATES) | found))


def _parse_proposal_node_list(raw: Any, context: str) -> frozenset[str]:
    if raw is None:
        return frozenset()
    if not isinstance(raw, list):
        raise GraphCompareError(f"Proposal field '{context}' must be a list.")
    return frozenset(_validate_canonical_node_id(item, context) for item in raw)


def _parse_proposal_edge(raw: Any, context: str) -> tuple[tuple[str, str, str], str]:
    if not isinstance(raw, dict):
        raise GraphCompareError(f"Proposal {context} entry is not an object: {raw!r}")
    src = _validate_canonical_node_id(raw.get("src"), f"{context}.src")
    dst = _validate_canonical_node_id(raw.get("dst"), f"{context}.dst")
    predicate = raw.get("predicate")
    if predicate not in DEFAULT_PREDICATES:
        raise GraphCompareError(f"Proposal {context} entry has unknown predicate {predicate!r}.")
    confidence = raw.get("confidence", "speculative")
    if confidence not in ("structural", "speculative"):
        raise GraphCompareError(f"Proposal {context} entry has invalid confidence {confidence!r}.")
    return (src, predicate, dst), confidence


def _parse_proposal_edge_list(raw: Any, context: str) -> tuple[frozenset[tuple[str, str, str]], frozenset[tuple[str, str, str]]]:
    if raw is None:
        return frozenset(), frozenset()
    if not isinstance(raw, list):
        raise GraphCompareError(f"Proposal field '{context}' must be a list.")
    structural: set[tuple[str, str, str]] = set()
    speculative: set[tuple[str, str, str]] = set()
    for item in raw:
        triple, confidence = _parse_proposal_edge(item, context)
        if confidence == "structural":
            structural.add(triple)
        else:
            speculative.add(triple)
    # A triple proposed with both confidences counts once, as structural.
    return frozenset(structural), frozenset(speculative - structural)


def load_graph_proposal(path: Path) -> GraphProposal:
    """Load and strictly validate a graph proposal document. Fails closed."""

    try:
        raw_text = path.read_text()
    except OSError as exc:
        raise GraphCompareError(f"Could not read proposal file {path}: {exc}") from exc
    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise GraphCompareError(f"Proposal file {path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise GraphCompareError(f"Proposal file {path} must contain a JSON object.")
    if raw.get("version") != 1:
        raise GraphCompareError(f"Proposal file {path} has unsupported version {raw.get('version')!r}.")
    tree_id = raw.get("tree_id")
    if not isinstance(tree_id, str) or not tree_id:
        raise GraphCompareError(f"Proposal file {path} is missing a non-empty 'tree_id'.")
    root = raw.get("root", "")
    if not isinstance(root, str):
        raise GraphCompareError(f"Proposal file {path} field 'root' must be a string.")
    prefixes_raw = raw.get("node_prefixes") or []
    if not isinstance(prefixes_raw, list) or any(not isinstance(p, str) or not p for p in prefixes_raw):
        raise GraphCompareError(f"Proposal file {path} field 'node_prefixes' must be a list of non-empty strings.")

    structural_edges, speculative_edges = _parse_proposal_edge_list(raw.get("add_edges"), "add_edges")
    remove_structural, remove_speculative = _parse_proposal_edge_list(raw.get("remove_edges"), "remove_edges")

    return GraphProposal(
        path=str(path),
        tree_id=tree_id,
        surface_id=raw.get("surface_id") if isinstance(raw.get("surface_id"), str) else None,
        plan_ref=raw.get("plan_ref") if isinstance(raw.get("plan_ref"), str) else None,
        root=root.strip("/"),
        add_nodes=_parse_proposal_node_list(raw.get("add_nodes"), "add_nodes"),
        structural_edges=structural_edges,
        speculative_edges=speculative_edges,
        remove_nodes=_parse_proposal_node_list(raw.get("remove_nodes"), "remove_nodes"),
        # Removal is a hard expectation regardless of the confidence marker.
        remove_edges=remove_structural | remove_speculative,
        node_prefixes=tuple(sorted({p.strip("/") for p in prefixes_raw})),
    )


# --------------------------------------------------------------------------
# Comparison
# --------------------------------------------------------------------------


def _set_metrics(reference: frozenset[Any], clone: frozenset[Any]) -> dict[str, Any]:
    intersection = reference & clone
    union = reference | clone
    precision = (len(intersection) / len(clone)) if clone else (1.0 if not reference else 0.0)
    recall = (len(intersection) / len(reference)) if reference else 1.0
    jaccard = (len(intersection) / len(union)) if union else 1.0
    return {
        "reference_count": len(reference),
        "clone_count": len(clone),
        "intersection_count": len(intersection),
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "jaccard": round(jaccard, 6),
    }


def _edge_label(triple: tuple[str, str, str]) -> str:
    src, predicate, dst = triple
    return f"{src} --{predicate}--> {dst}"


def _top_hubs(edges: frozenset[tuple[str, str, str]], top_n: int) -> list[dict[str, Any]]:
    degree: dict[str, int] = {}
    for src, _, dst in edges:
        degree[src] = degree.get(src, 0) + 1
        degree[dst] = degree.get(dst, 0) + 1
    ranked = sorted(degree.items(), key=lambda item: (-item[1], item[0]))
    return [{"node": node, "degree": count} for node, count in ranked[:top_n]]


def compare_graphs(
    nodes_a: CanonicalNodes,
    edges_a: CanonicalEdges,
    nodes_b: CanonicalNodes,
    edges_b: CanonicalEdges,
    predicates: tuple[str, ...],
    top_hubs: int = DEFAULT_TOP_HUBS,
    max_gaps: int = DEFAULT_MAX_GAPS,
) -> dict[str, Any]:
    node_metrics = _set_metrics(nodes_a.ids, nodes_b.ids)
    missing_nodes = sorted(nodes_a.ids - nodes_b.ids)
    extra_nodes = sorted(nodes_b.ids - nodes_a.ids)

    edge_metrics_overall = _set_metrics(edges_a.triples, edges_b.triples)
    per_predicate: dict[str, dict[str, Any]] = {}
    for predicate in predicates:
        ref_p = frozenset(t for t in edges_a.triples if t[1] == predicate)
        clone_p = frozenset(t for t in edges_b.triples if t[1] == predicate)
        per_predicate[predicate] = _set_metrics(ref_p, clone_p)

    missing_edges = sorted(edges_a.triples - edges_b.triples)
    extra_edges = sorted(edges_b.triples - edges_a.triples)

    gaps: list[str] = []
    for node in missing_nodes:
        gaps.append(f"clone missing node {node}")
    for triple in missing_edges:
        gaps.append(f"clone missing {_edge_label(triple)}")
    for node in extra_nodes:
        gaps.append(f"clone extra node {node}")
    for triple in extra_edges:
        gaps.append(f"clone extra {_edge_label(triple)}")
    gaps_truncated = len(gaps) > max_gaps
    gaps = gaps[:max_gaps]

    hubs_a = _top_hubs(edges_a.triples, top_hubs)
    hubs_b = _top_hubs(edges_b.triples, top_hubs)
    hub_names_a = {h["node"] for h in hubs_a}
    hub_names_b = {h["node"] for h in hubs_b}

    return {
        "nodes": {
            **node_metrics,
            "missing_in_clone": missing_nodes[:max_gaps],
            "extra_in_clone": extra_nodes[:max_gaps],
        },
        "edges": {
            "overall": edge_metrics_overall,
            "per_predicate": per_predicate,
            "missing_in_clone": [_edge_label(t) for t in missing_edges[:max_gaps]],
            "extra_in_clone": [_edge_label(t) for t in extra_edges[:max_gaps]],
        },
        "hubs": {
            "note": "Advisory only: degree-ranked hubs; divergence never affects the exit code.",
            "reference_top": hubs_a,
            "clone_top": hubs_b,
            "only_in_reference_top": sorted(hub_names_a - hub_names_b),
            "only_in_clone_top": sorted(hub_names_b - hub_names_a),
        },
        "gaps": gaps,
        "gaps_truncated": gaps_truncated,
    }


def _recall_metrics(reference: frozenset[Any], clone: frozenset[Any]) -> dict[str, Any]:
    """Recall-only metrics for proposal comparison, where the clone side is the
    entire live graph and precision/extra-in-clone would be meaningless noise."""

    present = reference & clone
    recall = (len(present) / len(reference)) if reference else 1.0
    return {
        "proposed_count": len(reference),
        "present_count": len(present),
        "recall": round(recall, 6),
    }


def compare_proposal(
    proposal: GraphProposal,
    nodes_b: CanonicalNodes,
    edges_b: CanonicalEdges,
    max_gaps: int = DEFAULT_MAX_GAPS,
) -> dict[str, Any]:
    node_metrics = _recall_metrics(proposal.add_nodes, nodes_b.ids)
    missing_nodes = sorted(proposal.add_nodes - nodes_b.ids)

    structural_metrics = _recall_metrics(proposal.structural_edges, edges_b.triples)
    missing_structural = sorted(proposal.structural_edges - edges_b.triples)

    speculative_metrics = _recall_metrics(proposal.speculative_edges, edges_b.triples)
    missing_speculative = sorted(proposal.speculative_edges - edges_b.triples)

    remove_nodes_present = sorted(proposal.remove_nodes & nodes_b.ids)
    remove_edges_present = sorted(proposal.remove_edges & edges_b.triples)

    clone_paths = {_canonical_node_path(node_id) for node_id in nodes_b.ids}
    covered: list[str] = []
    uncovered: list[str] = []
    for prefix in proposal.node_prefixes:
        hit = any(path == prefix or path.startswith(prefix + "/") for path in clone_paths)
        (covered if hit else uncovered).append(prefix)

    gaps: list[str] = []
    for node in missing_nodes:
        gaps.append(f"clone missing proposed node {node}")
    for triple in missing_structural:
        gaps.append(f"clone missing proposed {_edge_label(triple)}")
    for node in remove_nodes_present:
        gaps.append(f"proposed removal still present: node {node}")
    for triple in remove_edges_present:
        gaps.append(f"proposed removal still present: {_edge_label(triple)}")
    gaps_truncated = len(gaps) > max_gaps
    gaps = gaps[:max_gaps]

    return {
        "nodes": {
            **node_metrics,
            "missing_in_clone": missing_nodes[:max_gaps],
        },
        "edges": {
            "structural": {
                **structural_metrics,
                "missing_in_clone": [_edge_label(t) for t in missing_structural[:max_gaps]],
            },
            "speculative": {
                "note": "Advisory only: speculative edges never affect the exit code.",
                **speculative_metrics,
                "missing_in_clone": [_edge_label(t) for t in missing_speculative[:max_gaps]],
            },
        },
        "removals": {
            "nodes_still_present": remove_nodes_present[:max_gaps],
            "edges_still_present": [_edge_label(t) for t in remove_edges_present[:max_gaps]],
        },
        "prefixes": {
            "note": "Advisory only: prefix coverage never affects the exit code.",
            "covered": covered,
            "uncovered": uncovered,
        },
        "gaps": gaps,
        "gaps_truncated": gaps_truncated,
    }


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------


def _side_summary(side: SideConfig, nodes: CanonicalNodes, edges: CanonicalEdges) -> dict[str, Any]:
    return {
        "label": side.label,
        "endpoint": side.endpoint,
        "db": side.db,
        "workspace_id": side.workspace_id,
        "root": side.root,
        "kinds": list(side.kinds),
        "excludes": list(side.excludes),
        "canonical_nodes": len(nodes.ids),
        "canonical_edges": len(edges.triples),
        "unresolved_edges": edges.unresolved,
        "skipped_nodes": {
            "no_path": nodes.skipped_no_path,
            "outside_root": nodes.skipped_outside_root,
            "excluded": nodes.skipped_excluded,
            "unnamed": nodes.skipped_unnamed,
        },
    }


def run_compare(
    side_a: SideConfig,
    side_b: SideConfig,
    predicates: tuple[str, ...],
    min_node_recall: float,
    min_edge_recall: float,
    top_hubs: int = DEFAULT_TOP_HUBS,
    max_gaps: int = DEFAULT_MAX_GAPS,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    nodes_a = canonicalize_nodes(fetch_node_docs(side_a, timeout), side_a.root, side_a.excludes)
    nodes_b = canonicalize_nodes(fetch_node_docs(side_b, timeout), side_b.root, side_b.excludes)
    edges_a = canonicalize_edges(fetch_edge_docs(side_a, predicates, timeout), nodes_a)
    edges_b = canonicalize_edges(fetch_edge_docs(side_b, predicates, timeout), nodes_b)

    comparison = compare_graphs(nodes_a, edges_a, nodes_b, edges_b, predicates, top_hubs, max_gaps)

    node_recall = comparison["nodes"]["recall"]
    edge_recall = comparison["edges"]["overall"]["recall"]
    hard_failures: list[str] = []
    if node_recall < min_node_recall:
        hard_failures.append(f"node recall {node_recall} is below --min-node-recall {min_node_recall}")
    if edge_recall < min_edge_recall:
        hard_failures.append(f"edge recall {edge_recall} is below --min-edge-recall {min_edge_recall}")

    return {
        "reference": _side_summary(side_a, nodes_a, edges_a),
        "clone": _side_summary(side_b, nodes_b, edges_b),
        "predicates": list(predicates),
        "thresholds": {"min_node_recall": min_node_recall, "min_edge_recall": min_edge_recall},
        "comparison": comparison,
        "hard_failures": hard_failures,
        "passed": not hard_failures,
    }


def run_proposal_compare(
    proposal: GraphProposal,
    side_b: SideConfig,
    min_node_recall: float,
    min_edge_recall: float,
    max_gaps: int = DEFAULT_MAX_GAPS,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """Compare a proposal (reference prediction) against the live clone workspace."""

    predicates = proposal.predicates()
    nodes_b = canonicalize_nodes(fetch_node_docs(side_b, timeout), side_b.root, side_b.excludes)
    edges_b = canonicalize_edges(fetch_edge_docs(side_b, predicates, timeout), nodes_b)

    comparison = compare_proposal(proposal, nodes_b, edges_b, max_gaps)

    hard_failures: list[str] = []
    node_recall = comparison["nodes"]["recall"]
    edge_recall = comparison["edges"]["structural"]["recall"]
    if node_recall < min_node_recall:
        hard_failures.append(f"proposed node recall {node_recall} is below --min-node-recall {min_node_recall}")
    if edge_recall < min_edge_recall:
        hard_failures.append(f"proposed structural edge recall {edge_recall} is below --min-edge-recall {min_edge_recall}")
    removals = comparison["removals"]
    if removals["nodes_still_present"] or removals["edges_still_present"]:
        still = len(removals["nodes_still_present"]) + len(removals["edges_still_present"])
        hard_failures.append(f"{still} proposed removal(s) are still present in the clone graph")

    return {
        "proposal": {
            "path": proposal.path,
            "tree_id": proposal.tree_id,
            "surface_id": proposal.surface_id,
            "plan_ref": proposal.plan_ref,
            "root": proposal.root,
            "add_nodes": len(proposal.add_nodes),
            "structural_edges": len(proposal.structural_edges),
            "speculative_edges": len(proposal.speculative_edges),
            "remove_nodes": len(proposal.remove_nodes),
            "remove_edges": len(proposal.remove_edges),
            "node_prefixes": list(proposal.node_prefixes),
        },
        "clone": _side_summary(side_b, nodes_b, edges_b),
        "predicates": list(predicates),
        "thresholds": {"min_node_recall": min_node_recall, "min_edge_recall": min_edge_recall},
        "comparison": comparison,
        "hard_failures": hard_failures,
        "passed": not hard_failures,
    }


def write_snapshot(snapshot: dict[str, Any], snapshot_dir: Path) -> tuple[Path, Path]:
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(snapshot, indent=2, sort_keys=True) + "\n"
    name = f"{snapshot['reference']['workspace_id']}_vs_{snapshot['clone']['workspace_id']}.json"
    named_path = snapshot_dir / name
    latest_path = snapshot_dir / "latest.json"
    named_path.write_text(payload)
    latest_path.write_text(payload)
    return named_path, latest_path


def write_proposal_snapshot(snapshot: dict[str, Any], snapshot_dir: Path) -> tuple[Path, Path]:
    """Proposal snapshots use their own `latest-proposal.json` so they never
    clobber the workspace-vs-workspace `latest.json` with a different shape."""

    snapshot_dir.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(snapshot, indent=2, sort_keys=True) + "\n"
    tree_id = re.sub(r"[^A-Za-z0-9._-]+", "-", snapshot["proposal"]["tree_id"])
    name = f"proposal_{tree_id}_vs_{snapshot['clone']['workspace_id']}.json"
    named_path = snapshot_dir / name
    latest_path = snapshot_dir / "latest-proposal.json"
    named_path.write_text(payload)
    latest_path.write_text(payload)
    return named_path, latest_path


# --------------------------------------------------------------------------
# Workspace listing (naive stdlib parse of ~/.ix/config.yaml)
# --------------------------------------------------------------------------


def list_workspaces(config_path: Path) -> list[dict[str, str]]:
    """Best-effort parse of the flat list in ~/.ix/config.yaml.

    Only handles the simple `- workspace_id:` / `workspace_name:` /
    `root_path:` entries the ix CLI writes; wrapped root_path lines keep the
    first line only. This is a convenience view — pass ids explicitly if the
    parse looks wrong.
    """

    try:
        text = config_path.read_text()
    except OSError as exc:
        raise GraphCompareError(f"Could not read ix config at {config_path}: {exc}") from exc

    entries: list[dict[str, str]] = []
    current: dict[str, str] | None = None

    def _value(line: str) -> str:
        return line.split(":", 1)[1].strip().strip('"').strip("'")

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- workspace_id:"):
            if current:
                entries.append(current)
            current = {"workspace_id": _value(stripped)}
        elif current is not None and stripped.startswith("workspace_name:"):
            current["workspace_name"] = _value(stripped)
        elif current is not None and stripped.startswith("root_path:"):
            current["root_path"] = _value(stripped)
        elif current is not None and stripped.startswith("default:"):
            current["default"] = _value(stripped)
    if current:
        entries.append(current)
    return entries


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _print_summary(snapshot: dict[str, Any]) -> None:
    status = "PASS" if snapshot["passed"] else "FAIL"
    ref = snapshot["reference"]
    clone = snapshot["clone"]
    comparison = snapshot["comparison"]
    print(f"[{status}] {ref['workspace_id']} (reference) vs {clone['workspace_id']} (clone)")
    nodes = comparison["nodes"]
    print(
        f"nodes: ref={nodes['reference_count']} clone={nodes['clone_count']} "
        f"precision={nodes['precision']} recall={nodes['recall']} jaccard={nodes['jaccard']}"
    )
    overall = comparison["edges"]["overall"]
    print(
        f"edges: ref={overall['reference_count']} clone={overall['clone_count']} "
        f"precision={overall['precision']} recall={overall['recall']} jaccard={overall['jaccard']}"
    )
    for predicate, metrics in comparison["edges"]["per_predicate"].items():
        print(f"  {predicate}: ref={metrics['reference_count']} clone={metrics['clone_count']} recall={metrics['recall']}")
    for side_key in ("reference", "clone"):
        unresolved = snapshot[side_key]["unresolved_edges"]
        if unresolved:
            print(f"note: {unresolved} {side_key} edges touched non-canonical nodes and were dropped (counted, not ignored)")
    if snapshot["hard_failures"]:
        print("Hard failures:")
        for failure in snapshot["hard_failures"]:
            print(f"  - {failure}")
    if comparison["gaps"]:
        suffix = " (truncated)" if comparison["gaps_truncated"] else ""
        print(f"Gaps{suffix}:")
        for gap in comparison["gaps"]:
            print(f"  - {gap}")


def _print_proposal_summary(snapshot: dict[str, Any]) -> None:
    status = "PASS" if snapshot["passed"] else "FAIL"
    proposal = snapshot["proposal"]
    clone = snapshot["clone"]
    comparison = snapshot["comparison"]
    print(f"[{status}] proposal {proposal['tree_id']} vs {clone['workspace_id']} (clone)")
    nodes = comparison["nodes"]
    print(f"nodes: proposed={nodes['proposed_count']} present={nodes['present_count']} recall={nodes['recall']}")
    structural = comparison["edges"]["structural"]
    print(f"edges (structural): proposed={structural['proposed_count']} present={structural['present_count']} recall={structural['recall']}")
    speculative = comparison["edges"]["speculative"]
    if speculative["proposed_count"]:
        print(
            f"edges (speculative, advisory): proposed={speculative['proposed_count']} "
            f"present={speculative['present_count']} recall={speculative['recall']}"
        )
    prefixes = comparison["prefixes"]
    if prefixes["covered"] or prefixes["uncovered"]:
        print(f"prefixes (advisory): covered={len(prefixes['covered'])} uncovered={len(prefixes['uncovered'])}")
        for prefix in prefixes["uncovered"]:
            print(f"  - uncovered: {prefix}")
    if snapshot["hard_failures"]:
        print("Hard failures:")
        for failure in snapshot["hard_failures"]:
            print(f"  - {failure}")
    if comparison["gaps"]:
        suffix = " (truncated)" if comparison["gaps_truncated"] else ""
        print(f"Gaps{suffix}:")
        for gap in comparison["gaps"]:
            print(f"  - {gap}")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workspace-a", help="Reference workspace_id (the graph being reproduced).")
    parser.add_argument("--workspace-b", help="Clone workspace_id (the reproduction under test).")
    parser.add_argument(
        "--proposal",
        help="Path to a graph proposal JSON file to use as the reference side instead of --workspace-a.",
    )
    parser.add_argument("--root-a", default="", help="Path prefix to scope/strip on the reference side.")
    parser.add_argument(
        "--root-b",
        default=None,
        help="Path prefix to scope/strip on the clone side (with --proposal, defaults to the proposal's root).",
    )
    parser.add_argument("--endpoint-a", default=DEFAULT_ENDPOINT, help="Arango endpoint for the reference side.")
    parser.add_argument("--endpoint-b", default=None, help="Arango endpoint for the clone side (default: same as --endpoint-a).")
    parser.add_argument("--db", default=DEFAULT_DB, help="Arango database name (default: ix_memory).")
    parser.add_argument("--kinds", default=",".join(DEFAULT_KINDS), help="Comma-separated node kinds to compare.")
    parser.add_argument("--predicates", default=",".join(DEFAULT_PREDICATES), help="Comma-separated edge predicates to compare.")
    parser.add_argument("--exclude", action="append", default=[], help="Glob (relative to root) to drop from both sides; repeatable.")
    parser.add_argument("--min-node-recall", type=float, default=1.0, help="Fail if clone node recall is below this (default 1.0).")
    parser.add_argument("--min-edge-recall", type=float, default=1.0, help="Fail if clone edge recall is below this (default 1.0).")
    parser.add_argument("--top-hubs", type=int, default=DEFAULT_TOP_HUBS, help="How many degree-ranked hubs to report per side.")
    parser.add_argument("--max-gaps", type=int, default=DEFAULT_MAX_GAPS, help="Cap on reported gap lines and missing/extra lists.")
    parser.add_argument("--snapshot-dir", default=DEFAULT_SNAPSHOT_DIR, help="Directory to write JSON snapshots into.")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="Per-request HTTP timeout in seconds.")
    parser.add_argument("--list-workspaces", action="store_true", help="List workspaces from ~/.ix/config.yaml and exit.")
    parser.add_argument("--ix-config", default=str(DEFAULT_IX_CONFIG), help="Path to the ix config.yaml for --list-workspaces.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)

    if args.list_workspaces:
        try:
            entries = list_workspaces(Path(args.ix_config))
        except GraphCompareError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        for entry in entries:
            default_marker = " (default)" if entry.get("default") == "true" else ""
            print(f"{entry.get('workspace_id', '?'):>10}  {entry.get('workspace_name', '?')}{default_marker}  {entry.get('root_path', '?')}")
        return 0

    if args.proposal and args.workspace_a:
        print("error: --proposal replaces the reference side; do not combine it with --workspace-a.", file=sys.stderr)
        return 1
    if not args.workspace_b or (not args.workspace_a and not args.proposal):
        print("error: --workspace-b plus either --workspace-a or --proposal are required (or use --list-workspaces).", file=sys.stderr)
        return 1

    kinds = tuple(k.strip() for k in args.kinds.split(",") if k.strip())
    predicates = tuple(p.strip().upper() for p in args.predicates.split(",") if p.strip())
    excludes = tuple(args.exclude)
    endpoint_b = args.endpoint_b or args.endpoint_a
    snapshot_dir = Path(args.snapshot_dir)

    if args.proposal:
        try:
            proposal = load_graph_proposal(Path(args.proposal))
            root_b = args.root_b if args.root_b is not None else proposal.root
            side_b = SideConfig(
                label="clone", endpoint=endpoint_b, db=args.db,
                workspace_id=args.workspace_b, root=root_b.strip("/"), kinds=kinds, excludes=excludes,
            )
            snapshot = run_proposal_compare(
                proposal, side_b,
                min_node_recall=args.min_node_recall,
                min_edge_recall=args.min_edge_recall,
                max_gaps=args.max_gaps,
                timeout=args.timeout,
            )
        except GraphCompareError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        named_path, latest_path = write_proposal_snapshot(snapshot, snapshot_dir)
        _print_proposal_summary(snapshot)
        print(f"Snapshot written to {named_path} and {latest_path}")
        return 0 if snapshot["passed"] else 1

    side_a = SideConfig(
        label="reference", endpoint=args.endpoint_a, db=args.db,
        workspace_id=args.workspace_a, root=args.root_a.strip("/"), kinds=kinds, excludes=excludes,
    )
    side_b = SideConfig(
        label="clone", endpoint=endpoint_b, db=args.db,
        workspace_id=args.workspace_b, root=(args.root_b or "").strip("/"), kinds=kinds, excludes=excludes,
    )

    try:
        snapshot = run_compare(
            side_a, side_b, predicates,
            min_node_recall=args.min_node_recall,
            min_edge_recall=args.min_edge_recall,
            top_hubs=args.top_hubs,
            max_gaps=args.max_gaps,
            timeout=args.timeout,
        )
    except GraphCompareError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    named_path, latest_path = write_snapshot(snapshot, snapshot_dir)
    _print_summary(snapshot)
    print(f"Snapshot written to {named_path} and {latest_path}")
    return 0 if snapshot["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

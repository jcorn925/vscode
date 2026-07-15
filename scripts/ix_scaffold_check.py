#!/usr/bin/env python3
"""Ix scaffold verification checker.

Verifies that a target project (as described by an ``architecture.scaffold.toml``
contract) matches its declared module ownership and phase-scoped path
boundaries, using evidence collected from the ``ix`` CLI (``ix map``,
``ix inventory``, ``ix subsystems``, ``ix status``).

Design constraints (see architecture.scaffold.toml and README.md):

- Python 3.12+ standard library only. No third-party dependencies.
- Module identity is defined by hand-authored ``id``/``paths``/``excludes`` in
  the contract, never by Ix's own inferred cluster labels or region UUIDs —
  those can be renamed/regrouped by Ix at any time and are advisory only.
- Hard failures (missing required files, unowned files, overlapping
  ownership, path-boundary violations, or Ix being unavailable/malformed)
  fail closed with a nonzero exit code.
- ``ix map`` is scoped to the contract's project root, not the enclosing
  repo. Ix's graph is shared/global — mapping the whole enclosing repo (e.g.
  ``ix map .`` from a large monorepo root) was observed to time out even
  with a 120s budget, while mapping just the small project root the
  contract actually describes is fast.
- Detailed subsystem membership/edges from ``ix subsystems --detailed`` are
  frequently unavailable or slow in practice (observed to hang even with
  small limits) — such evidence is reported as "unsupported", never
  silently treated as passing, and never allowed to hang the whole run.

Usage:
    python3 scripts/ix_scaffold_check.py --checkpoint 003
    python3 scripts/ix_scaffold_check.py --checkpoint 007 --no-remap
    python3 scripts/ix_scaffold_check.py --contract other.toml --snapshot-dir .ix-scaffold
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_CONTRACT = "architecture.scaffold.toml"
DEFAULT_SNAPSHOT_DIR = ".ix-scaffold"
DEFAULT_INVENTORY_LIMIT = 5000
IX_MAP_TIMEOUT = 120.0
IX_INVENTORY_TIMEOUT = 60.0
IX_SUBSYSTEMS_TIMEOUT = 20.0
IX_STATUS_TIMEOUT = 10.0


class ScaffoldCheckError(Exception):
    """Hard infrastructure failure: Ix unavailable, malformed contract/output."""


# --------------------------------------------------------------------------
# Contract model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Module:
    id: str
    paths: tuple[str, ...]
    excludes: tuple[str, ...] = ()


@dataclass(frozen=True)
class Checkpoint:
    id: str
    spec: str
    active_modules: tuple[str, ...]
    allowed_scope: tuple[str, ...]
    required_files: tuple[str, ...]
    advisory_ix_region_hints: tuple[str, ...] = ()
    advisory_min_confidence: float = 0.0


@dataclass(frozen=True)
class Contract:
    path: Path
    project_name: str
    project_root: Path
    project_root_rel: str
    modules: tuple[Module, ...] = field(default_factory=tuple)
    checkpoints: tuple[Checkpoint, ...] = field(default_factory=tuple)

    def module_ids(self) -> set[str]:
        return {m.id for m in self.modules}

    def get_checkpoint(self, checkpoint_id: str | None) -> Checkpoint:
        if not self.checkpoints:
            raise ScaffoldCheckError("Contract declares no checkpoints.")
        if checkpoint_id is None:
            return self.checkpoints[-1]
        for checkpoint in self.checkpoints:
            if checkpoint.id == checkpoint_id:
                return checkpoint
        known = ", ".join(c.id for c in self.checkpoints)
        raise ScaffoldCheckError(f"Unknown checkpoint '{checkpoint_id}'. Known checkpoints: {known}")


def load_contract(contract_path: Path) -> Contract:
    try:
        raw_bytes = contract_path.read_bytes()
    except OSError as exc:
        raise ScaffoldCheckError(f"Could not read contract at {contract_path}: {exc}") from exc

    try:
        data = tomllib.loads(raw_bytes.decode("utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise ScaffoldCheckError(f"Contract at {contract_path} is not valid TOML: {exc}") from exc

    project = data.get("project")
    if not isinstance(project, dict) or "root" not in project:
        raise ScaffoldCheckError("Contract is missing a [project] table with a 'root' key.")
    project_root_rel = str(project["root"]).strip("/")
    project_root = (contract_path.parent / project_root_rel).resolve()

    raw_modules = data.get("modules")
    if not isinstance(raw_modules, list) or not raw_modules:
        raise ScaffoldCheckError("Contract must declare at least one [[modules]] entry.")

    modules: list[Module] = []
    seen_ids: set[str] = set()
    for entry in raw_modules:
        if not isinstance(entry, dict) or "id" not in entry or "paths" not in entry:
            raise ScaffoldCheckError("Each [[modules]] entry needs an 'id' and 'paths'.")
        module_id = str(entry["id"])
        if module_id in seen_ids:
            raise ScaffoldCheckError(f"Duplicate module id '{module_id}' in contract.")
        seen_ids.add(module_id)
        modules.append(
            Module(
                id=module_id,
                paths=tuple(str(p) for p in entry["paths"]),
                excludes=tuple(str(p) for p in entry.get("excludes", [])),
            )
        )

    raw_checkpoints = data.get("checkpoints")
    if not isinstance(raw_checkpoints, list) or not raw_checkpoints:
        raise ScaffoldCheckError("Contract must declare at least one [[checkpoints]] entry.")

    checkpoints: list[Checkpoint] = []
    seen_checkpoint_ids: set[str] = set()
    module_ids = seen_ids
    for entry in raw_checkpoints:
        if not isinstance(entry, dict) or "id" not in entry:
            raise ScaffoldCheckError("Each [[checkpoints]] entry needs an 'id'.")
        checkpoint_id = str(entry["id"])
        if checkpoint_id in seen_checkpoint_ids:
            raise ScaffoldCheckError(f"Duplicate checkpoint id '{checkpoint_id}' in contract.")
        seen_checkpoint_ids.add(checkpoint_id)
        active_modules = tuple(str(m) for m in entry.get("active_modules", []))
        unknown = [m for m in active_modules if m not in module_ids]
        if unknown:
            raise ScaffoldCheckError(
                f"Checkpoint '{checkpoint_id}' references unknown module id(s): {', '.join(unknown)}"
            )
        advisory = entry.get("advisory", {}) or {}
        checkpoints.append(
            Checkpoint(
                id=checkpoint_id,
                spec=str(entry.get("spec", "")),
                active_modules=active_modules,
                allowed_scope=tuple(str(p) for p in entry.get("allowed_scope", [])),
                required_files=tuple(str(p) for p in entry.get("required_files", [])),
                advisory_ix_region_hints=tuple(str(h) for h in advisory.get("ix_region_hints", [])),
                advisory_min_confidence=float(advisory.get("min_confidence", 0.0)),
            )
        )

    return Contract(
        path=contract_path,
        project_name=str(project.get("name", contract_path.stem)),
        project_root=project_root,
        project_root_rel=project_root_rel,
        modules=tuple(modules),
        checkpoints=tuple(checkpoints),
    )


# --------------------------------------------------------------------------
# Glob matching (stdlib only — no fnmatch, so '**' and '*' are distinct)
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


@dataclass(frozen=True)
class CompiledModule:
    id: str
    include: tuple[re.Pattern[str], ...]
    exclude: tuple[re.Pattern[str], ...]

    def matches(self, rel_path: str) -> bool:
        if not any(p.match(rel_path) for p in self.include):
            return False
        return not any(p.match(rel_path) for p in self.exclude)


def _compile_modules(modules: tuple[Module, ...]) -> tuple[CompiledModule, ...]:
    return tuple(
        CompiledModule(
            id=m.id,
            include=tuple(_glob_to_regex(p) for p in m.paths),
            exclude=tuple(_glob_to_regex(p) for p in m.excludes),
        )
        for m in modules
    )


def _owners_for(rel_path: str, compiled_modules: tuple[CompiledModule, ...]) -> list[str]:
    return sorted(cm.id for cm in compiled_modules if cm.matches(rel_path))


def _classify_files(
    rel_paths: list[str], compiled_modules: tuple[CompiledModule, ...]
) -> tuple[dict[str, list[str]], list[str], dict[str, list[str]]]:
    files_by_module: dict[str, list[str]] = {cm.id: [] for cm in compiled_modules}
    unowned: list[str] = []
    overlapping: dict[str, list[str]] = {}
    for rel_path in sorted(set(rel_paths)):
        owners = _owners_for(rel_path, compiled_modules)
        if not owners:
            unowned.append(rel_path)
        elif len(owners) > 1:
            overlapping[rel_path] = owners
        else:
            files_by_module[owners[0]].append(rel_path)
    for paths in files_by_module.values():
        paths.sort()
    return files_by_module, sorted(unowned), overlapping


def _check_path_boundaries(checkpoint: Checkpoint, files_by_module: dict[str, list[str]]) -> list[str]:
    allowed_patterns = tuple(_glob_to_regex(p) for p in checkpoint.allowed_scope)
    violations: set[str] = set()
    for module_id, paths in files_by_module.items():
        module_active = module_id in checkpoint.active_modules
        for rel_path in paths:
            in_scope = any(p.match(rel_path) for p in allowed_patterns)
            if not in_scope or not module_active:
                violations.add(rel_path)
    return sorted(violations)


# --------------------------------------------------------------------------
# Ix CLI evidence collection
# --------------------------------------------------------------------------


def _run_subprocess(args: list[str], cwd: Path, timeout: float) -> subprocess.CompletedProcess[str]:
    """Thin subprocess wrapper — the single seam tests monkeypatch."""

    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def run_ix_map(cwd: Path, target: str, timeout: float = IX_MAP_TIMEOUT) -> None:
    """Map just the contract's project root, not the whole enclosing repo.

    Ix's graph is shared/global (observed with hundreds of thousands of
    nodes on a real machine, spanning far more than one project), so
    `ix map .` from the repo root re-analyzes everything it can see and can
    time out even with a generous timeout. Scoping to the contract's
    project root keeps this fast and focused on what the contract actually
    describes.
    """

    try:
        result = _run_subprocess(["ix", "map", target, "--silent"], cwd, timeout)
    except FileNotFoundError as exc:
        raise ScaffoldCheckError("Ix is not installed or not on PATH (`ix map` failed to start).") from exc
    except subprocess.TimeoutExpired as exc:
        raise ScaffoldCheckError(f"`ix map {target}` timed out after {timeout}s.") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise ScaffoldCheckError(f"`ix map {target}` failed with exit code {result.returncode}: {detail}")


def run_ix_inventory_files(
    cwd: Path, path_filter: str, timeout: float = IX_INVENTORY_TIMEOUT, limit: int = DEFAULT_INVENTORY_LIMIT
) -> list[str]:
    args = ["ix", "inventory", "--kind", "file", "--path", path_filter, "--format", "json", "--limit", str(limit)]
    try:
        result = _run_subprocess(args, cwd, timeout)
    except FileNotFoundError as exc:
        raise ScaffoldCheckError("Ix is not installed or not on PATH (`ix inventory` failed to start).") from exc
    except subprocess.TimeoutExpired as exc:
        raise ScaffoldCheckError(f"`ix inventory` timed out after {timeout}s.") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise ScaffoldCheckError(f"`ix inventory` failed with exit code {result.returncode}: {detail}")

    try:
        data: Any = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ScaffoldCheckError(f"`ix inventory` produced malformed JSON: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(data.get("byFile"), list):
        raise ScaffoldCheckError("`ix inventory` JSON is missing the expected 'byFile' list.")

    paths: list[str] = []
    for entry in data["byFile"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise ScaffoldCheckError("`ix inventory` JSON contains a 'byFile' entry without a string 'path'.")
        paths.append(entry["path"])

    if len(paths) >= limit:
        raise ScaffoldCheckError(
            f"`ix inventory` returned {len(paths)} files, at or above --limit {limit}; "
            "results may be truncated. Re-run with a higher inventory limit."
        )
    return paths


def run_ix_subsystems_detailed(
    cwd: Path, timeout: float = IX_SUBSYSTEMS_TIMEOUT
) -> tuple[dict[str, Any] | None, str | None]:
    """Best-effort detailed subsystem evidence.

    Never raises: on any failure this returns (None, reason) so the caller
    can record the assertion as unsupported rather than hanging the run or
    treating absent evidence as a pass.
    """

    args = ["ix", "subsystems", "--list", "--detailed", "--format", "json"]
    try:
        result = _run_subprocess(args, cwd, timeout)
    except FileNotFoundError:
        return None, "ix binary not found"
    except subprocess.TimeoutExpired:
        return None, f"`ix subsystems --detailed` timed out after {timeout}s"

    if result.returncode != 0:
        return None, f"`ix subsystems --detailed` exited with code {result.returncode}"

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None, "`ix subsystems --detailed` produced malformed JSON"

    regions: list[Any] | None = None
    if isinstance(data, dict):
        candidate = data.get("regions", data.get("items"))
        if isinstance(candidate, list):
            regions = candidate
    elif isinstance(data, list):
        regions = data

    if regions is None:
        return (data if isinstance(data, dict) else None), "unexpected JSON shape (no regions/items list found)"

    has_membership_detail = any(
        isinstance(region, dict) and (region.get("members") or region.get("edges"))
        for region in regions
    )
    if not has_membership_detail:
        return {"regions": regions}, "detailed member/edge data absent from Ix output"

    return {"regions": regions}, None


def run_ix_status_revision(cwd: Path, timeout: float = IX_STATUS_TIMEOUT) -> int | None:
    try:
        result = _run_subprocess(["ix", "status"], cwd, timeout)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    match = re.search(r"Revision:\s*(\d+)", result.stdout)
    return int(match.group(1)) if match else None


def _extract_region_names(subsystems_data: dict[str, Any] | None) -> set[str]:
    if not subsystems_data:
        return set()
    names: set[str] = set()
    for region in subsystems_data.get("regions", []):
        if not isinstance(region, dict):
            continue
        for key in ("name", "label", "id"):
            value = region.get(key)
            if isinstance(value, str):
                names.add(value)
    return names


# --------------------------------------------------------------------------
# Snapshot assembly
# --------------------------------------------------------------------------


def build_snapshot(
    contract: Contract,
    checkpoint: Checkpoint,
    inventory_paths: list[str],
    subsystems_data: dict[str, Any] | None,
    subsystems_unsupported_reason: str | None,
    ix_revision: int | None,
) -> dict[str, Any]:
    prefix = contract.project_root_rel.rstrip("/") + "/"
    rel_paths = [p[len(prefix):] for p in inventory_paths if p.startswith(prefix)]

    compiled_modules = _compile_modules(contract.modules)
    files_by_module, unowned_files, overlapping_files = _classify_files(rel_paths, compiled_modules)

    present = set(rel_paths)
    required_present = sorted(p for p in checkpoint.required_files if p in present)
    required_missing = sorted(p for p in checkpoint.required_files if p not in present)

    path_boundary_violations = _check_path_boundaries(checkpoint, files_by_module)

    unsupported: list[dict[str, str]] = []
    if subsystems_unsupported_reason is not None:
        unsupported.append({"check": "detailed_subsystem_membership", "reason": subsystems_unsupported_reason})
    if ix_revision is None:
        unsupported.append({"check": "ix_revision", "reason": "unavailable from `ix status`"})

    region_names = _extract_region_names(subsystems_data)
    advisory = {
        "ix_region_hints": list(checkpoint.advisory_ix_region_hints),
        "ix_region_hints_matched": sorted(
            hint for hint in checkpoint.advisory_ix_region_hints if hint in region_names
        ),
        "min_confidence": checkpoint.advisory_min_confidence,
        "note": "Advisory only: Ix region labels/confidence may be renamed or regrouped and never fail this check.",
    }

    hard_failures: list[str] = []
    if required_missing:
        hard_failures.append(f"missing required files for checkpoint {checkpoint.id}: {required_missing}")
    if unowned_files:
        hard_failures.append(f"unowned files (match no module): {unowned_files}")
    if overlapping_files:
        hard_failures.append(f"files owned by more than one module: {overlapping_files}")
    if path_boundary_violations:
        hard_failures.append(
            f"files outside checkpoint {checkpoint.id}'s allowed scope/active modules: {path_boundary_violations}"
        )

    return {
        "checkpoint": checkpoint.id,
        "checkpoint_spec": checkpoint.spec,
        "contract": contract.project_name,
        "project_root": contract.project_root_rel,
        "ix_revision": ix_revision,
        "files_by_module": files_by_module,
        "unowned_files": unowned_files,
        "overlapping_files": overlapping_files,
        "required_files": {"present": required_present, "missing": required_missing},
        "path_boundary_violations": path_boundary_violations,
        "advisory": advisory,
        "unsupported": unsupported,
        "hard_failures": hard_failures,
        "passed": not hard_failures,
    }


def write_snapshot(snapshot: dict[str, Any], snapshot_dir: Path) -> tuple[Path, Path]:
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    checkpoints_dir = snapshot_dir / "checkpoints"
    checkpoints_dir.mkdir(parents=True, exist_ok=True)

    payload = json.dumps(snapshot, indent=2, sort_keys=True) + "\n"
    latest_path = snapshot_dir / "latest.json"
    checkpoint_path = checkpoints_dir / f"{snapshot['checkpoint']}.json"
    latest_path.write_text(payload)
    checkpoint_path.write_text(payload)
    return latest_path, checkpoint_path


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------


def run_check(
    contract: Contract,
    checkpoint_id: str | None,
    no_remap: bool,
    inventory_limit: int = DEFAULT_INVENTORY_LIMIT,
) -> dict[str, Any]:
    checkpoint = contract.get_checkpoint(checkpoint_id)
    cwd = contract.path.parent

    if not no_remap:
        run_ix_map(cwd, target=contract.project_root_rel)

    inventory_paths = run_ix_inventory_files(cwd, contract.project_root_rel, limit=inventory_limit)
    subsystems_data, subsystems_reason = run_ix_subsystems_detailed(cwd)
    ix_revision = run_ix_status_revision(cwd)

    return build_snapshot(
        contract=contract,
        checkpoint=checkpoint,
        inventory_paths=inventory_paths,
        subsystems_data=subsystems_data,
        subsystems_unsupported_reason=subsystems_reason,
        ix_revision=ix_revision,
    )


def _print_summary(snapshot: dict[str, Any]) -> None:
    status = "PASS" if snapshot["passed"] else "FAIL"
    print(f"[{status}] checkpoint {snapshot['checkpoint']} ({snapshot['contract']})")
    if snapshot["hard_failures"]:
        print("Hard failures:")
        for failure in snapshot["hard_failures"]:
            print(f"  - {failure}")
    if snapshot["unsupported"]:
        print("Unsupported (advisory, not a failure):")
        for item in snapshot["unsupported"]:
            print(f"  - {item['check']}: {item['reason']}")
    advisory = snapshot["advisory"]
    if advisory["ix_region_hints"]:
        matched = advisory["ix_region_hints_matched"]
        print(f"Advisory Ix region hints: {advisory['ix_region_hints']} (matched: {matched})")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", default=None, help="Checkpoint id to verify (default: last declared).")
    parser.add_argument("--contract", default=DEFAULT_CONTRACT, help="Path to the architecture.scaffold.toml contract.")
    parser.add_argument(
        "--snapshot-dir", default=DEFAULT_SNAPSHOT_DIR, help="Directory to write JSON snapshots into."
    )
    parser.add_argument(
        "--no-remap", action="store_true", help="Skip `ix map .` and read the already-persisted Ix graph."
    )
    parser.add_argument(
        "--inventory-limit",
        type=int,
        default=DEFAULT_INVENTORY_LIMIT,
        help="Max files requested from `ix inventory` (fails closed if the result hits this ceiling).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    contract_path = Path(args.contract).resolve()
    snapshot_dir = Path(args.snapshot_dir)
    if not snapshot_dir.is_absolute():
        snapshot_dir = contract_path.parent / snapshot_dir

    try:
        contract = load_contract(contract_path)
        snapshot = run_check(
            contract=contract,
            checkpoint_id=args.checkpoint,
            no_remap=args.no_remap,
            inventory_limit=args.inventory_limit,
        )
    except ScaffoldCheckError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    latest_path, checkpoint_path = write_snapshot(snapshot, snapshot_dir)
    _print_summary(snapshot)
    print(f"Snapshot written to {latest_path} and {checkpoint_path}")
    return 0 if snapshot["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

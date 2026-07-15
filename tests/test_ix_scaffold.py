"""Tests for scripts/ix_scaffold_check.py.

All Ix CLI interaction goes through a single seam (``_run_subprocess``),
which every test here monkeypatches with canned responses. No real ``ix``
binary is required, so this suite runs the same in CI as it does locally.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import ix_scaffold_check as isc  # noqa: E402


# --------------------------------------------------------------------------
# Fixtures / helpers
# --------------------------------------------------------------------------


def _completed(args: list[str], returncode: int = 0, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr=stderr)


def _inventory_json(paths: list[str]) -> str:
    return json.dumps({"kind": "file", "total": len(paths), "byFile": [{"path": p, "items": [Path(p).name]} for p in paths]})


def _subsystems_json_with_detail() -> str:
    return json.dumps({"regions": [{"name": "backend-core", "members": ["backend/app.py"], "edges": []}]})


def _subsystems_json_without_detail() -> str:
    return json.dumps({"regions": [{"name": "backend-core"}]})


class FakeIx:
    """Dispatches canned CompletedProcess results by ix subcommand, and
    records every invocation so tests can assert what was (or wasn't) run."""

    def __init__(
        self,
        inventory_paths: list[str],
        subsystems_stdout: str | None = None,
        subsystems_error: Exception | None = None,
        status_stdout: str = "Revision: 42\n",
        map_returncode: int = 0,
    ) -> None:
        self.inventory_paths = inventory_paths
        self.subsystems_stdout = subsystems_stdout if subsystems_stdout is not None else _subsystems_json_with_detail()
        self.subsystems_error = subsystems_error
        self.status_stdout = status_stdout
        self.map_returncode = map_returncode
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], cwd: Path, timeout: float) -> subprocess.CompletedProcess[str]:
        self.calls.append(args)
        subcommand = args[1]
        if subcommand == "map":
            return _completed(args, returncode=self.map_returncode)
        if subcommand == "inventory":
            return _completed(args, stdout=_inventory_json(self.inventory_paths))
        if subcommand == "subsystems":
            if self.subsystems_error is not None:
                raise self.subsystems_error
            return _completed(args, stdout=self.subsystems_stdout)
        if subcommand == "status":
            return _completed(args, stdout=self.status_stdout)
        raise AssertionError(f"unexpected ix subcommand invoked: {args}")

    def map_was_called(self) -> bool:
        return any(c[1] == "map" for c in self.calls)


CONTRACT_TOML = """
schema_version = 1

[project]
name = "fixture-app"
root = "proj"

[[modules]]
id = "backend"
paths = ["backend/**"]
excludes = ["backend/agent/tools/**"]

[[modules]]
id = "frontend"
paths = ["frontend/**"]

[[modules]]
id = "infrastructure"
paths = ["infra/**", "backend/agent/tools/**"]

[[checkpoints]]
id = "001"
spec = "specs/001-backend.md"
active_modules = ["backend"]
allowed_scope = ["backend/**"]
required_files = ["backend/app.py"]
advisory = { ix_region_hints = ["backend-core"], min_confidence = 0.0 }

[[checkpoints]]
id = "002"
spec = "specs/002-frontend.md"
active_modules = ["backend", "frontend"]
allowed_scope = ["backend/**", "frontend/**"]
required_files = ["backend/app.py", "frontend/index.html"]
advisory = { ix_region_hints = ["backend-core", "frontend-ui"], min_confidence = 0.0 }
"""

OVERLAPPING_CONTRACT_TOML = """
schema_version = 1

[project]
name = "fixture-app"
root = "proj"

[[modules]]
id = "backend"
paths = ["backend/**"]

[[modules]]
id = "shared"
paths = ["backend/**"]

[[checkpoints]]
id = "001"
spec = "specs/001-backend.md"
active_modules = ["backend", "shared"]
allowed_scope = ["backend/**"]
required_files = ["backend/app.py"]
"""


@pytest.fixture
def contract_path(tmp_path: Path) -> Path:
    path = tmp_path / "architecture.scaffold.toml"
    path.write_text(CONTRACT_TOML)
    return path


@pytest.fixture
def contract(contract_path: Path) -> isc.Contract:
    return isc.load_contract(contract_path)


# --------------------------------------------------------------------------
# Successful run
# --------------------------------------------------------------------------


def test_successful_checkpoint_passes(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=False)

    assert snapshot["passed"] is True
    assert snapshot["hard_failures"] == []
    assert snapshot["required_files"]["missing"] == []
    assert snapshot["files_by_module"]["backend"] == ["backend/app.py"]
    assert snapshot["ix_revision"] == 42
    assert snapshot["unsupported"] == []
    assert fake.map_was_called() is True


def test_no_remap_skips_ix_map(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    isc.run_check(contract, checkpoint_id="001", no_remap=True)

    assert fake.map_was_called() is False


# --------------------------------------------------------------------------
# Hard failures
# --------------------------------------------------------------------------


def test_missing_required_file_is_hard_failure(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=[])  # backend/app.py never shows up
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=True)

    assert snapshot["passed"] is False
    assert snapshot["required_files"]["missing"] == ["backend/app.py"]
    assert any("missing required files" in failure for failure in snapshot["hard_failures"])


def test_unowned_file_is_hard_failure(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py", "proj/mystery/thing.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=True)

    assert snapshot["passed"] is False
    assert snapshot["unowned_files"] == ["mystery/thing.py"]
    assert any("unowned files" in failure for failure in snapshot["hard_failures"])


def test_overlapping_ownership_is_hard_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    contract_file = tmp_path / "architecture.scaffold.toml"
    contract_file.write_text(OVERLAPPING_CONTRACT_TOML)
    overlapping_contract = isc.load_contract(contract_file)

    fake = FakeIx(inventory_paths=["proj/backend/app.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(overlapping_contract, checkpoint_id="001", no_remap=True)

    assert snapshot["passed"] is False
    assert snapshot["overlapping_files"] == {"backend/app.py": ["backend", "shared"]}
    assert any("more than one module" in failure for failure in snapshot["hard_failures"])


def test_path_boundary_violation_when_out_of_active_scope(
    monkeypatch: pytest.MonkeyPatch, contract: isc.Contract
) -> None:
    # frontend/index.html exists but checkpoint 001 only activates 'backend'.
    fake = FakeIx(inventory_paths=["proj/backend/app.py", "proj/frontend/index.html"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=True)

    assert snapshot["passed"] is False
    assert "frontend/index.html" in snapshot["path_boundary_violations"]


def test_malformed_inventory_json_fails_closed(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    def fake_run(args: list[str], cwd: Path, timeout: float) -> subprocess.CompletedProcess[str]:
        if args[1] == "inventory":
            return _completed(args, stdout="not json {{{")
        return _completed(args, stdout="Revision: 1\n")

    monkeypatch.setattr(isc, "_run_subprocess", fake_run)

    with pytest.raises(isc.ScaffoldCheckError, match="malformed JSON"):
        isc.run_check(contract, checkpoint_id="001", no_remap=True)


def test_ix_unavailable_fails_closed(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    def fake_run(args: list[str], cwd: Path, timeout: float) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("ix not found")

    monkeypatch.setattr(isc, "_run_subprocess", fake_run)

    with pytest.raises(isc.ScaffoldCheckError, match="not installed"):
        isc.run_check(contract, checkpoint_id="001", no_remap=False)


# --------------------------------------------------------------------------
# Advisory / unsupported detailed-subsystem handling
# --------------------------------------------------------------------------


def test_detailed_subsystems_timeout_is_unsupported_not_pass(
    monkeypatch: pytest.MonkeyPatch, contract: isc.Contract
) -> None:
    fake = FakeIx(
        inventory_paths=["proj/backend/app.py"],
        subsystems_error=subprocess.TimeoutExpired(cmd="ix subsystems --detailed", timeout=20.0),
    )
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=True)

    # Other checks still pass, so the overall run passes...
    assert snapshot["passed"] is True
    # ...but the detailed-membership assertion is explicitly unsupported, not "passed".
    reasons = {item["check"] for item in snapshot["unsupported"]}
    assert "detailed_subsystem_membership" in reasons


def test_detailed_subsystems_present_but_missing_membership_is_unsupported(
    monkeypatch: pytest.MonkeyPatch, contract: isc.Contract
) -> None:
    fake = FakeIx(
        inventory_paths=["proj/backend/app.py"],
        subsystems_stdout=_subsystems_json_without_detail(),
    )
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=True)

    reasons = {item["check"]: item["reason"] for item in snapshot["unsupported"]}
    assert "detailed_subsystem_membership" in reasons
    assert "absent" in reasons["detailed_subsystem_membership"]
    # The region name is still recorded/matched as an advisory hint even
    # though detailed membership itself is unsupported.
    assert snapshot["advisory"]["ix_region_hints_matched"] == ["backend-core"]


def test_ix_revision_unavailable_is_unsupported(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py"], status_stdout="no revision here\n")
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id="001", no_remap=True)

    assert snapshot["ix_revision"] is None
    reasons = {item["check"] for item in snapshot["unsupported"]}
    assert "ix_revision" in reasons


# --------------------------------------------------------------------------
# Nested exclusion (backend/agent/tools -> infrastructure)
# --------------------------------------------------------------------------


def test_nested_exclusion_reassigns_ownership(contract: isc.Contract) -> None:
    inventory_paths = [
        "proj/backend/app.py",
        "proj/backend/agent/__init__.py",
        "proj/backend/agent/tools/README.md",
    ]

    checkpoint = isc.Checkpoint(
        id="003",
        spec="specs/003.md",
        active_modules=("backend", "infrastructure"),
        allowed_scope=("backend/**", "infra/**"),
        required_files=("backend/app.py", "backend/agent/tools/README.md"),
    )
    snapshot = isc.build_snapshot(
        contract=contract,
        checkpoint=checkpoint,
        inventory_paths=inventory_paths,
        subsystems_data=None,
        subsystems_unsupported_reason="not collected in this test",
        ix_revision=1,
    )

    assert "backend/agent/tools/README.md" not in snapshot["files_by_module"]["backend"]
    assert snapshot["files_by_module"]["infrastructure"] == ["backend/agent/tools/README.md"]
    assert snapshot["files_by_module"]["backend"] == ["backend/agent/__init__.py", "backend/app.py"]
    assert snapshot["overlapping_files"] == {}
    assert snapshot["unowned_files"] == []


# --------------------------------------------------------------------------
# Checkpoint progression
# --------------------------------------------------------------------------


def test_checkpoint_progression_tightens_requirements(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    checkpoint_001 = isc.run_check(contract, checkpoint_id="001", no_remap=True)
    checkpoint_002 = isc.run_check(contract, checkpoint_id="002", no_remap=True)

    assert checkpoint_001["passed"] is True
    assert checkpoint_002["passed"] is False
    assert checkpoint_002["required_files"]["missing"] == ["frontend/index.html"]


def test_default_checkpoint_is_last_declared(monkeypatch: pytest.MonkeyPatch, contract: isc.Contract) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot = isc.run_check(contract, checkpoint_id=None, no_remap=True)

    assert snapshot["checkpoint"] == "002"


# --------------------------------------------------------------------------
# CLI / snapshot writing
# --------------------------------------------------------------------------


def test_main_writes_deterministic_snapshot_and_exit_code(
    monkeypatch: pytest.MonkeyPatch, contract_path: Path, tmp_path: Path
) -> None:
    fake = FakeIx(inventory_paths=["proj/backend/app.py"])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    snapshot_dir = tmp_path / ".ix-scaffold"
    exit_code = isc.main(
        [
            "--checkpoint",
            "001",
            "--contract",
            str(contract_path),
            "--snapshot-dir",
            str(snapshot_dir),
            "--no-remap",
        ]
    )

    assert exit_code == 0
    latest = json.loads((snapshot_dir / "latest.json").read_text())
    checkpoint_report = json.loads((snapshot_dir / "checkpoints" / "001.json").read_text())
    assert latest == checkpoint_report
    assert latest["passed"] is True
    assert "generated_at" not in latest  # snapshot content must be timestamp-independent


def test_main_returns_nonzero_on_hard_failure(
    monkeypatch: pytest.MonkeyPatch, contract_path: Path, tmp_path: Path
) -> None:
    fake = FakeIx(inventory_paths=[])
    monkeypatch.setattr(isc, "_run_subprocess", fake)

    exit_code = isc.main(
        [
            "--checkpoint",
            "001",
            "--contract",
            str(contract_path),
            "--snapshot-dir",
            str(tmp_path / ".ix-scaffold"),
            "--no-remap",
        ]
    )

    assert exit_code == 1


def test_main_returns_nonzero_on_infra_error(monkeypatch: pytest.MonkeyPatch, contract_path: Path, tmp_path: Path) -> None:
    def fake_run(args: list[str], cwd: Path, timeout: float) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("ix not found")

    monkeypatch.setattr(isc, "_run_subprocess", fake_run)

    exit_code = isc.main(
        [
            "--contract",
            str(contract_path),
            "--snapshot-dir",
            str(tmp_path / ".ix-scaffold"),
        ]
    )

    assert exit_code == 1


# --------------------------------------------------------------------------
# Glob translator correctness
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "pattern,path,expected",
    [
        ("backend/**", "backend/app.py", True),
        ("backend/**", "backend/agent/tools/x.py", True),
        ("backend/*", "backend/app.py", True),
        ("backend/*", "backend/agent/tools/x.py", False),
        ("backend/**", "frontend/app.py", False),
    ],
)
def test_glob_to_regex_distinguishes_single_and_double_star(pattern: str, path: str, expected: bool) -> None:
    assert bool(isc._glob_to_regex(pattern).match(path)) is expected

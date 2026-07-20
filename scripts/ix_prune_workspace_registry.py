#!/usr/bin/env python3
"""Prune dead / throwaway entries from ~/.ix/config.yaml (ix client workspace registry).

The YAML is only an address book (path → workspace_id). Graph data lives in ArangoDB.
Pruning stale registrations reduces memory-layer boot/ingest work and helps avoid the
Arango stuck-lock wedge after hundreds of dogfood /tmp registrations accumulate.

Safety:
  - Always writes a timestamped backup next to config.yaml before mutating.
  - Never removes the ``default: true`` workspace.
  - Default mode is dry-run; pass ``--apply`` to write.

Examples:
  python3 scripts/ix_prune_workspace_registry.py
  python3 scripts/ix_prune_workspace_registry.py --apply
  python3 scripts/ix_prune_workspace_registry.py --apply --also-mtimes
"""

from __future__ import annotations

import argparse
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
	import yaml
except ImportError as exc:  # pragma: no cover
	raise SystemExit("PyYAML is required (pip install pyyaml)") from exc

DEFAULT_CONFIG = Path.home() / ".ix" / "config.yaml"

TMP_MARKERS = (
	"/private/tmp/",
	"/tmp/",
	"/var/folders/",
)
JUNK_NAME_MARKERS = (
	"dogfood",
	"throwaway",
	"gwdf-",
	"goal-workspace-full-loop",
	"goal-workspace-dogfood",
	"code-oss-dogfood",
)


@dataclass(frozen=True)
class PruneDecision:
	keep: bool
	reason: str


def _as_bool(value: Any) -> bool:
	if isinstance(value, bool):
		return value
	if isinstance(value, str):
		return value.strip().lower() in {"1", "true", "yes", "on"}
	return False


def normalize_root_path(value: Any) -> str:
	if value is None:
		return ""
	if isinstance(value, str):
		# Undo YAML line-fold damage: "…/Application\n  Support/…" → "…/Application Support/…"
		return re.sub(r"\s*\n\s*", " ", value).strip()
	return str(value).strip()


def classify_workspace(entry: dict[str, Any]) -> PruneDecision:
	if _as_bool(entry.get("default")):
		return PruneDecision(True, "default workspace")

	root = normalize_root_path(entry.get("root_path"))
	name = str(entry.get("workspace_name") or entry.get("name") or "").strip()
	if not root:
		return PruneDecision(False, "missing root_path")

	lower = root.lower()
	name_lower = name.lower()
	if any(marker in lower for marker in TMP_MARKERS):
		return PruneDecision(False, "temp path")
	if any(marker in lower or marker in name_lower for marker in JUNK_NAME_MARKERS):
		return PruneDecision(False, "dogfood/throwaway path")

	path = Path(root)
	if not path.exists():
		return PruneDecision(False, "path does not exist")
	if path.is_file():
		# Single files / screenshots accidentally registered as workspaces.
		return PruneDecision(False, "root_path is a file, not a directory")
	if not path.is_dir():
		return PruneDecision(False, "root_path is not a directory")

	return PruneDecision(True, "existing directory")


_WORKSPACE_ID_LINE = re.compile(
	r'^(?P<prefix>\s*(?:-\s+)?)workspace_id:\s*(?P<val>[^\s#][^#]*?)\s*(?:#.*)?$',
	re.MULTILINE,
)


def _quote_workspace_id_lines(text: str) -> str:
	"""Force workspace_id values to quoted strings before YAML parse.

	Unquoted ids like ``52379e01`` are scientific notation in YAML 1.1 and become
	integers (523790), permanently corrupting the registry.
	"""

	def repl(match: re.Match[str]) -> str:
		prefix = match.group("prefix")
		val = match.group("val").strip()
		if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
			return f"{prefix}workspace_id: {val}"
		return f'{prefix}workspace_id: "{val}"'

	return _WORKSPACE_ID_LINE.sub(repl, text)


def load_config(path: Path) -> dict[str, Any]:
	text = _quote_workspace_id_lines(path.read_text(encoding="utf-8"))
	raw = yaml.safe_load(text)
	if not isinstance(raw, dict):
		raise SystemExit(f"{path} did not parse as a YAML mapping")
	workspaces = raw.get("workspaces")
	if isinstance(workspaces, list):
		for item in workspaces:
			if isinstance(item, dict) and "workspace_id" in item:
				item["workspace_id"] = str(item["workspace_id"])
	return raw


def dump_config(data: dict[str, Any]) -> str:
	# Prefer block style; always quote workspace ids + spaced paths.
	class RegistryDumper(yaml.SafeDumper):
		pass

	def represent_str(dumper: yaml.SafeDumper, value: str) -> Any:
		# Always quote ids / paths so YAML 1.1 never re-parses hex-ish ids as floats.
		if re.fullmatch(r"[0-9a-fA-F]{6,}", value) or "/" in value or " " in value or ":" in value:
			return dumper.represent_scalar("tag:yaml.org,2002:str", value, style='"')
		return dumper.represent_scalar("tag:yaml.org,2002:str", value)

	RegistryDumper.add_representer(str, represent_str)
	workspaces = data.get("workspaces")
	if isinstance(workspaces, list):
		for item in workspaces:
			if isinstance(item, dict) and "workspace_id" in item:
				item["workspace_id"] = str(item["workspace_id"])
	return yaml.dump(
		data,
		Dumper=RegistryDumper,
		default_flow_style=False,
		sort_keys=False,
		allow_unicode=True,
		width=10_000,
	)


def prune_workspaces(workspaces: list[Any]) -> tuple[list[dict[str, Any]], list[tuple[dict[str, Any], str]]]:
	kept: list[dict[str, Any]] = []
	removed: list[tuple[dict[str, Any], str]] = []
	for item in workspaces:
		if not isinstance(item, dict):
			continue
		entry = dict(item)
		entry["root_path"] = normalize_root_path(entry.get("root_path"))
		decision = classify_workspace(entry)
		if decision.keep:
			kept.append(entry)
		else:
			removed.append((entry, decision.reason))
	return kept, removed


def prune_orphan_mtimes(ix_dir: Path, kept_ids: set[str], apply: bool) -> list[Path]:
	orphans: list[Path] = []
	for path in sorted(ix_dir.glob("ingest_mtimes_*.json")):
		workspace_id = path.name[len("ingest_mtimes_") : -len(".json")]
		if workspace_id and workspace_id not in kept_ids:
			orphans.append(path)
			if apply:
				path.unlink(missing_ok=True)
	return orphans


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="Path to ix config.yaml")
	parser.add_argument("--apply", action="store_true", help="Write pruned config (default: dry-run)")
	parser.add_argument(
		"--also-mtimes",
		action="store_true",
		help="Also delete ingest_mtimes_<id>.json for removed workspace ids",
	)
	parser.add_argument("--limit-report", type=int, default=20, help="Max removed rows to print")
	args = parser.parse_args()

	config_path: Path = args.config.expanduser()
	if not config_path.is_file():
		raise SystemExit(f"Missing ix config: {config_path}")

	data = load_config(config_path)
	workspaces = data.get("workspaces")
	if not isinstance(workspaces, list):
		raise SystemExit(f"{config_path}: workspaces is not a list")

	kept, removed = prune_workspaces(workspaces)
	print(f"config: {config_path}")
	print(f"before: {len(workspaces)}")
	print(f"keep:   {len(kept)}")
	print(f"remove: {len(removed)}")
	by_reason: dict[str, int] = {}
	for _, reason in removed:
		by_reason[reason] = by_reason.get(reason, 0) + 1
	for reason, count in sorted(by_reason.items(), key=lambda kv: (-kv[1], kv[0])):
		print(f"  - {reason}: {count}")

	print("\nSample removals:")
	for entry, reason in removed[: max(0, args.limit_report)]:
		wid = entry.get("workspace_id", "?")
		name = entry.get("workspace_name") or entry.get("name") or "?"
		root = entry.get("root_path", "")
		print(f"  [{reason}] {wid}  {name}  {root}")

	kept_ids = {str(e.get("workspace_id", "")).strip() for e in kept if e.get("workspace_id")}
	orphans: list[Path] = []
	if args.also_mtimes:
		orphans = prune_orphan_mtimes(config_path.parent, kept_ids, apply=False)
		print(f"\norphan ingest_mtimes_*.json: {len(orphans)}")

	if not args.apply:
		print("\nDry-run only. Re-run with --apply to backup and write.")
		return 0

	stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
	backup = config_path.with_name(f"config.yaml.bak-{stamp}")
	shutil.copy2(config_path, backup)
	data["workspaces"] = kept
	config_path.write_text(dump_config(data), encoding="utf-8")
	if args.also_mtimes:
		orphans = prune_orphan_mtimes(config_path.parent, kept_ids, apply=True)
	print(f"\nWrote {config_path}")
	print(f"Backup {backup}")
	if args.also_mtimes:
		print(f"Deleted {len(orphans)} orphan ingest_mtimes_*.json files")
	print("Restart Ix backend when convenient: ix docker restart")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())

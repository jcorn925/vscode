#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

"""Score a goal-workspace dogfood run.

The script is intentionally dependency-free so it can inspect disposable workspaces,
fixtures, or examples without needing the VS Code fork runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


SCENARIOS: dict[str, dict[str, Any]] = {
	"personal-training": {
		"goal_terms": [
			"personal",
			"training",
			"trainer",
			"fitness",
			"coach",
			"coaching",
			"client",
		],
		"metric_terms": ["active", "paid", "client"],
		"expected_surfaces": [
			"marketing",
			"booking",
			"client-portal",
			"trainer-admin",
			"analytics",
			"content-scheduler",
			"ads-manager",
			"subscriptions",
		],
		"required_surfaces": [
			"marketing",
			"booking",
			"client-portal",
			"trainer-admin",
			"analytics",
		],
		"entities": [
			"lead",
			"client",
			"offer",
			"package",
			"booking",
			"session",
			"subscription",
			"payment",
			"campaign",
		],
		"events": [
			"lead.created",
			"offer.viewed",
			"booking.started",
			"booking.completed",
			"subscription.started",
			"subscription.cancelled",
			"payment.failed",
			"session.completed",
		],
		"workflow_terms": [
			"booking",
			"payment",
			"subscription",
			"customer",
			"client",
			"campaign",
			"analytics",
			"workflow",
			"conversion",
		],
	}
}


@dataclass
class Finding:
	severity: str
	area: str
	message: str
	evidence: str
	recommendation: str


@dataclass
class AreaScore:
	name: str
	score: int
	evidence: list[str] = field(default_factory=list)


def slug(value: str) -> str:
	lowered = value.strip().lower()
	lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
	return lowered.strip("-")


def load_text(path: Path, limit: int = 200_000) -> str:
	try:
		return path.read_text(encoding="utf-8", errors="replace")[:limit]
	except OSError:
		return ""


def load_json(path: Path) -> tuple[Any | None, str | None]:
	try:
		return json.loads(path.read_text(encoding="utf-8")), None
	except FileNotFoundError:
		return None, f"{path} does not exist"
	except json.JSONDecodeError as exc:
		return None, f"{path} is invalid JSON: {exc.msg} at line {exc.lineno}, column {exc.colno}"
	except OSError as exc:
		return None, f"Could not read {path}: {exc}"


def as_list(value: Any) -> list[Any]:
	return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
	return value if isinstance(value, dict) else {}


def path_exists(root: Path, value: Any) -> bool:
	if not isinstance(value, str) or not value.strip():
		return False
	return (root / value).exists()


def collect_files(root: Path, relative: str, max_files: int = 30) -> list[Path]:
	base = root / relative
	if not base.exists():
		return []
	if base.is_file():
		return [base]
	files: list[Path] = []
	for path in base.rglob("*"):
		if path.is_file() and "node_modules" not in path.parts and ".git" not in path.parts:
			files.append(path)
			if len(files) >= max_files:
				break
	return files


def read_surface_sample(root: Path, relative: str) -> str:
	sample_parts: list[str] = []
	for file_path in collect_files(root, relative, max_files=12):
		if file_path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".html", ".css", ".md", ".json"}:
			sample_parts.append(load_text(file_path, 12_000))
	return "\n".join(sample_parts).lower()


def count_terms(text: str, terms: list[str]) -> int:
	lowered = text.lower()
	return sum(1 for term in terms if term.lower() in lowered)


def surface_identity(surface: dict[str, Any]) -> str:
	for key in ("id", "name", "path"):
		value = surface.get(key)
		if isinstance(value, str) and value.strip():
			return slug(value.split("/")[-1])
	return ""


def surface_path(surface: dict[str, Any]) -> str:
	path = surface.get("path")
	if isinstance(path, str) and path.strip():
		return path.strip()
	sid = surface_identity(surface)
	return f"apps/{sid}" if sid else ""


def build_inventory(root: Path, manifest: dict[str, Any] | None) -> dict[str, Any]:
	surfaces = as_list(as_dict(manifest).get("surfaces")) if manifest else []
	surface_rows = []
	for item in surfaces:
		surface = as_dict(item)
		rel = surface_path(surface)
		surface_rows.append({
			"id": surface.get("id"),
			"name": surface.get("name"),
			"path": rel,
			"path_exists": bool(rel and (root / rel).exists()),
			"devCommand": surface.get("devCommand"),
			"localUrl": surface.get("localUrl"),
			"capabilities": as_list(surface.get("capabilities")),
			"events": as_list(surface.get("events")),
			"entities": as_list(surface.get("entities")),
			"ixSubsystems": as_list(surface.get("ixSubsystems")),
		})
	agent = root / ".agent"
	return {
		"workspace": str(root),
		"manifest_exists": (root / "workspace.goal.json").exists(),
		"surfaces": surface_rows,
		"agent_files": sorted(str(path.relative_to(root)) for path in agent.rglob("*") if path.is_file()) if agent.exists() else [],
		"shared_paths": [name for name in ["packages/domain", "packages/events", "packages/ui", "workflows"] if (root / name).exists()],
	}


def score_business_goal(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	goal = as_dict(manifest.get("goal"))
	text = " ".join(str(goal.get(key, "")) for key in ("id", "name", "description", "northStarMetric")).lower()
	points = 0
	evidence: list[str] = []
	if goal.get("id") and goal.get("name"):
		points += 1
		evidence.append("goal.id and goal.name are present")
	if goal.get("description") and count_terms(text, scenario["goal_terms"]) >= 2:
		points += 1
		evidence.append("goal description matches the business scenario")
	if goal.get("northStarMetric") and count_terms(str(goal.get("northStarMetric", "")), scenario["metric_terms"]) >= 2:
		points += 1
		evidence.append("north-star metric matches active paid clients")
	if points < 3:
		findings.append(Finding(
			"P1" if points == 0 else "P2",
			"Business goal setup",
			"Goal manifest does not fully define the business purpose.",
			f"goal={goal}",
			"Add goal id, name, scenario-specific description, and northStarMetric to workspace.goal.json.",
		))
	return AreaScore("Business goal setup", points, evidence)


def score_surfaces(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	expected = set(scenario["expected_surfaces"])
	required = set(scenario["required_surfaces"])
	identities = {surface_identity(surface) for surface in surfaces}
	paths_existing = sum(1 for surface in surfaces if path_exists(root, surface_path(surface)))
	rich = sum(1 for surface in surfaces if surface.get("name") and surface_path(surface) and (as_list(surface.get("capabilities")) or as_list(surface.get("events")) or as_list(surface.get("entities"))))
	required_hits = len(required & identities)
	expected_hits = len(expected & identities)
	points = 0
	evidence: list[str] = []
	if surfaces:
		points += 1
		evidence.append(f"{len(surfaces)} surface(s) registered")
	if required_hits >= 3 or expected_hits >= 5:
		points += 1
		evidence.append(f"{expected_hits} expected surface id(s) found")
	if paths_existing >= max(1, min(3, len(surfaces))) and rich >= max(1, min(3, len(surfaces))):
		points += 1
		evidence.append(f"{paths_existing} surface path(s) exist and {rich} have metadata")
	if points < 3:
		findings.append(Finding(
			"P1" if not surfaces else "P2",
			"Surface creation and manifest registration",
			"Surfaces are missing, incomplete, or not backed by app folders.",
			f"registered={sorted(identities)}, existing_paths={paths_existing}, rich_metadata={rich}",
			"Register expected starter surfaces with path, capabilities, events/entities, and scaffolded apps/<surface> folders.",
		))
	return AreaScore("Surface creation and manifest registration", points, evidence)


def score_app_usefulness(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	useful = 0
	package_or_entry = 0
	scenario_rich = 0
	for surface in surfaces:
		rel = surface_path(surface)
		if not rel or not (root / rel).exists():
			continue
		files = collect_files(root, rel)
		if any(path.name == "package.json" or path.name in {"index.html", "main.tsx", "App.tsx", "app.tsx"} for path in files):
			package_or_entry += 1
		sample = read_surface_sample(root, rel)
		if len(sample.strip()) > 400:
			useful += 1
		if count_terms(sample, scenario["workflow_terms"] + scenario["entities"]) >= 4:
			scenario_rich += 1
	points = 0
	evidence: list[str] = []
	if useful >= 1:
		points += 1
		evidence.append(f"{useful} surface app(s) contain substantive files")
	if package_or_entry >= 2:
		points += 1
		evidence.append(f"{package_or_entry} surface app(s) include package/entry files")
	if scenario_rich >= 2:
		points += 1
		evidence.append(f"{scenario_rich} surface app(s) contain scenario/workflow terms")
	if points < 3:
		findings.append(Finding(
			"P2",
			"Generated app usefulness",
			"Generated apps are thin, missing entry points, or not clearly tied to the business workflow.",
			f"useful={useful}, package_or_entry={package_or_entry}, scenario_rich={scenario_rich}",
			"Scaffold runnable surface apps with visible business workflow content, not only placeholder files.",
		))
	return AreaScore("Generated app usefulness", points, evidence)


def score_shared_context(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	shared = as_dict(manifest.get("shared"))
	shared_paths = [value for value in shared.values() if isinstance(value, str) and value.strip()]
	shared_existing = [value for value in shared_paths if (root / value).exists()]
	fallback_existing = [name for name in ["packages/domain", "packages/events", "packages/ui", "workflows"] if (root / name).exists()]
	combined_text = ""
	for rel in shared_existing + fallback_existing:
		for file_path in collect_files(root, rel, max_files=20):
			combined_text += "\n" + load_text(file_path, 20_000)
	entity_hits = count_terms(combined_text, scenario["entities"])
	event_hits = count_terms(combined_text, scenario["events"])
	workflow_hits = count_terms(combined_text, scenario["workflow_terms"])
	points = 0
	evidence: list[str] = []
	if shared_paths or fallback_existing:
		points += 1
		evidence.append("shared paths are declared or present")
	if entity_hits >= 4 or event_hits >= 3:
		points += 1
		evidence.append(f"shared context includes {entity_hits} entity term(s) and {event_hits} event term(s)")
	if workflow_hits >= 4:
		points += 1
		evidence.append(f"shared workflow terms found: {workflow_hits}")
	if points < 3:
		findings.append(Finding(
			"P2",
			"Shared domain, events, and workflows",
			"Shared business model is missing or too weak to connect surfaces.",
			f"shared={shared}, fallback_paths={fallback_existing}, entity_hits={entity_hits}, event_hits={event_hits}, workflow_hits={workflow_hits}",
			"Add shared domain, events, and workflow files and reference them from workspace.goal.json.",
		))
	return AreaScore("Shared domain, events, and workflows", points, evidence)


def score_memory(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	agent = root / ".agent"
	global_files = ["workspace.md", "workspace-memory.md", "domain.md", "events.md", "decisions.md"]
	existing_globals = [name for name in global_files if (agent / name).exists()]
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	app_memory_dir = agent / "apps"
	surface_memory_dir = agent / "surfaces"
	surface_memory = 0
	for surface in surfaces:
		sid = surface_identity(surface)
		if sid and (
			(app_memory_dir / f"{sid}.md").exists()
			or (app_memory_dir / sid).exists()
			or (surface_memory_dir / f"{sid}.memory.md").exists()
			or (surface_memory_dir / sid).exists()
		):
			surface_memory += 1
	combined = "\n".join(load_text(agent / name) for name in existing_globals)
	if surface_memory_dir.exists():
		for file_path in surface_memory_dir.glob("*.memory.md"):
			combined += "\n" + load_text(file_path)
	points = 0
	evidence: list[str] = []
	if len(existing_globals) >= 2:
		points += 1
		evidence.append(f"{len(existing_globals)} global memory file(s) present")
	if surface_memory >= max(1, min(3, len(surfaces))):
		points += 1
		evidence.append(f"{surface_memory} surface memory file(s) present")
	if count_terms(combined, scenario["entities"] + scenario["workflow_terms"]) >= 6:
		points += 1
		evidence.append("memory files include business workflow context")
	if points < 3:
		findings.append(Finding(
			"P2",
			"Durable memory",
			"Durable memory is missing or does not capture enough business context.",
			f"global_files={existing_globals}, surface_memory={surface_memory}",
			"Write .agent workspace/domain/events/decisions files and per-surface app memory as surfaces are created.",
		))
	return AreaScore("Durable memory", points, evidence)


def score_cross_surface(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], transcript: str, findings: list[Finding]) -> AreaScore:
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	entity_counts: dict[str, int] = {}
	event_counts: dict[str, int] = {}
	for surface in surfaces:
		for entity in as_list(surface.get("entities")):
			entity_counts[str(entity).lower()] = entity_counts.get(str(entity).lower(), 0) + 1
		for event in as_list(surface.get("events")):
			event_counts[str(event).lower()] = event_counts.get(str(event).lower(), 0) + 1
	shared_entities = sum(1 for count in entity_counts.values() if count >= 2)
	shared_events = sum(1 for count in event_counts.values() if count >= 2)
	text = json.dumps(manifest).lower() + "\n" + transcript.lower()
	cross_terms = count_terms(text, ["shared", "workflow", "cross-surface", "surface", "connect", "impact", "customer", "payment"])
	points = 0
	evidence: list[str] = []
	if len(surfaces) >= 3:
		points += 1
		evidence.append("multiple surfaces exist")
	if shared_entities >= 2 or shared_events >= 2:
		points += 1
		evidence.append(f"shared_entities={shared_entities}, shared_events={shared_events}")
	if cross_terms >= 5:
		points += 1
		evidence.append("manifest/transcript references shared workflows or impact")
	if points < 3:
		findings.append(Finding(
			"P1" if len(surfaces) >= 2 and shared_entities == 0 and shared_events == 0 else "P2",
			"Cross-surface coherence",
			"Surfaces look disconnected from each other.",
			f"shared_entities={shared_entities}, shared_events={shared_events}, cross_terms={cross_terms}",
			"Use shared entities/events/workflows so business changes can identify affected surfaces.",
		))
	return AreaScore("Cross-surface coherence", points, evidence)


def score_preview(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	with_url = sum(1 for surface in surfaces if isinstance(surface.get("localUrl"), str) and surface.get("localUrl", "").startswith(("http://", "https://")))
	with_command = sum(1 for surface in surfaces if isinstance(surface.get("devCommand"), str) and surface.get("devCommand", "").strip())
	package_scripts = 0
	for surface in surfaces:
		rel = surface_path(surface)
		package_path = root / rel / "package.json"
		package, _ = load_json(package_path)
		scripts = as_dict(as_dict(package).get("scripts"))
		if any(key in scripts for key in ("dev", "start", "web")):
			package_scripts += 1
	points = 0
	evidence: list[str] = []
	if with_url >= 1:
		points += 1
		evidence.append(f"{with_url} surface(s) declare localUrl")
	if with_command >= 1:
		points += 1
		evidence.append(f"{with_command} surface(s) declare devCommand")
	if package_scripts >= 1 and min(with_url, with_command) >= 1:
		points += 1
		evidence.append(f"{package_scripts} surface package(s) expose runnable scripts")
	if points < 3:
		findings.append(Finding(
			"P2",
			"Preview/run/switch readiness",
			"Surface previews are not clearly runnable from the UI.",
			f"localUrl={with_url}, devCommand={with_command}, package_scripts={package_scripts}",
			"Add localUrl and devCommand per runnable surface and ensure package scripts exist.",
		))
	return AreaScore("Preview/run/switch readiness", points, evidence)


def score_agent_behavior(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], transcript: str, findings: list[Finding]) -> AreaScore:
	text = transcript.lower()
	if not text.strip():
		findings.append(Finding(
			"P3",
			"Agent behavior and context quality",
			"No transcript was provided, so agent behavior could only be inferred from artifacts.",
			"transcript=<missing>",
			"Capture prompts, responses, and tool/edit actions during dogfood runs.",
		))
		artifact_points = 1 if as_list(manifest.get("surfaces")) else 0
		return AreaScore("Agent behavior and context quality", min(2, artifact_points), ["no transcript; artifact-only inference"] if artifact_points else [])
	checks = {
		"register_manifest": count_terms(text, ["workspace.goal.json", "register", "manifest"]) >= 2,
		"scaffold_apps": count_terms(text, ["scaffold", "apps/", "surface"]) >= 2,
		"shared_context": count_terms(text, ["shared", "domain", "events", "workflow"]) >= 3,
		"memory_ix": count_terms(text, ["memory", "ix", "metadata"]) >= 2,
	}
	points = 0
	evidence: list[str] = []
	if checks["register_manifest"] and checks["scaffold_apps"]:
		points += 1
		evidence.append("transcript includes manifest registration and scaffolding")
	if checks["shared_context"]:
		points += 1
		evidence.append("transcript includes shared context/workflow behavior")
	if checks["memory_ix"]:
		points += 1
		evidence.append("transcript includes memory/Ix updates")
	if points < 3:
		findings.append(Finding(
			"P2",
			"Agent behavior and context quality",
			"Agent transcript does not show cohesive goal-workspace behavior.",
			f"checks={checks}",
			"Prompt or configure the agent to register surfaces, scaffold apps, update shared context, durable memory, and Ix metadata.",
		))
	return AreaScore("Agent behavior and context quality", points, evidence)


def score_ix(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	surface_ix = sum(1 for surface in surfaces if as_list(surface.get("ixSubsystems")) or as_dict(surface.get("ix")))
	overlay_path = root / ".agent" / "ix-surface-map.json"
	overlay, overlay_error = load_json(overlay_path) if overlay_path.exists() else (None, "missing")
	overlay_surface_value = as_dict(overlay).get("surfaces") if isinstance(overlay, dict) else None
	overlay_surfaces = len(overlay_surface_value) if isinstance(overlay_surface_value, (list, dict)) else 0
	discovered = len(as_list(as_dict(overlay).get("discoveredSubsystems"))) if isinstance(overlay, dict) else 0
	points = 0
	evidence: list[str] = []
	if surface_ix >= 1:
		points += 1
		evidence.append(f"{surface_ix} surface(s) include Ix metadata")
	if isinstance(overlay, dict) and overlay_surfaces >= 1:
		points += 1
		evidence.append(f"Ix overlay maps {overlay_surfaces} surface(s)")
	if discovered >= 1 or overlay_surfaces >= max(1, min(3, len(surfaces))):
		points += 1
		evidence.append(f"Ix discoveredSubsystems={discovered}")
	if points < 3:
		findings.append(Finding(
			"P3" if points else "P2",
			"Ix/code-context integration",
			"Ix metadata is missing or too sparse to improve code-level understanding.",
			f"surface_ix={surface_ix}, overlay={overlay_path if overlay_path.exists() else overlay_error}, overlay_surfaces={overlay_surfaces}, discovered={discovered}",
			"Attach ixSubsystems or ix metadata to surfaces and write .agent/ix-surface-map.json when Ix is available.",
		))
	return AreaScore("Ix/code-context integration", points, evidence)


def score_repeatability(root: Path, manifest: dict[str, Any], scenario: dict[str, Any], findings: list[Finding]) -> AreaScore:
	root_text = str(root)
	absolute_refs: list[str] = []
	for file_path in [root / "workspace.goal.json", root / ".agent" / "workspace.md", root / ".agent" / "decisions.md"]:
		text = load_text(file_path, 80_000)
		if "/Users/jasoncornell/vscode" in text:
			absolute_refs.append(str(file_path.relative_to(root)))
	surfaces = [as_dict(item) for item in as_list(manifest.get("surfaces"))]
	ids = [surface_identity(surface) for surface in surfaces if surface_identity(surface)]
	unique_ids = len(ids) == len(set(ids))
	package_json = (root / "package.json").exists()
	manifest_stable = bool(as_dict(manifest.get("goal")).get("id")) and unique_ids
	disposable = "/Users/jasoncornell/vscode" not in root_text
	points = 0
	evidence: list[str] = []
	if disposable and not absolute_refs:
		points += 1
		evidence.append("workspace appears disposable and has no VS Code repo absolute refs in key files")
	if manifest_stable:
		points += 1
		evidence.append("manifest has stable goal/surface ids")
	if package_json or any((root / surface_path(surface) / "package.json").exists() for surface in surfaces):
		points += 1
		evidence.append("package metadata exists for repeatable installs/runs")
	if points < 3:
		findings.append(Finding(
			"P3",
			"Repeatability and test hygiene",
			"Dogfood workspace may be hard to rerun or may be coupled to the VS Code source checkout.",
			f"disposable={disposable}, absolute_refs={absolute_refs}, unique_surface_ids={unique_ids}, package_json={package_json}",
			"Use disposable paths, stable ids, checked-in package metadata, and avoid source-checkout absolute paths in generated workspace artifacts.",
		))
	return AreaScore("Repeatability and test hygiene", points, evidence)


def verdict(total: int, findings: list[Finding], manifest_valid: bool) -> str:
	blocker = any(f.severity in {"P0", "P1"} for f in findings)
	if not manifest_valid or total <= 14:
		return "Not Ready"
	if total >= 24 and not blocker:
		return "Ready"
	return "Partially Ready"


def render_markdown(result: dict[str, Any]) -> str:
	lines: list[str] = []
	lines.append("**Verdict**")
	lines.append(str(result["verdict"]))
	lines.append("")
	lines.append("**Score**")
	lines.append(f"{result['total']}/30")
	lines.append("")
	lines.append("**Findings**")
	if result["findings"]:
		for finding in result["findings"]:
			lines.append(f"- [{finding['severity']}] {finding['area']}: {finding['message']}")
			lines.append(f"  Evidence: {finding['evidence']}")
			lines.append(f"  Recommendation: {finding['recommendation']}")
	else:
		lines.append("- No blocking findings.")
	lines.append("")
	lines.append("**Rubric**")
	lines.append("| Area | Score | Evidence |")
	lines.append("| --- | ---: | --- |")
	for area in result["areas"]:
		evidence = "; ".join(area["evidence"]) if area["evidence"] else "No positive evidence found."
		lines.append(f"| {area['name']} | {area['score']} | {evidence} |")
	lines.append("")
	lines.append("**Workspace Artifact Inventory**")
	inv = result["inventory"]
	lines.append(f"- Workspace: `{inv['workspace']}`")
	lines.append(f"- Manifest exists: `{inv['manifest_exists']}`")
	lines.append(f"- Shared paths: {', '.join(f'`{p}`' for p in inv['shared_paths']) if inv['shared_paths'] else 'none'}")
	lines.append(f"- Agent files: {len(inv['agent_files'])}")
	lines.append("- Surfaces:")
	if inv["surfaces"]:
		for surface in inv["surfaces"]:
			lines.append(
				f"  - `{surface.get('id')}` path=`{surface.get('path')}` exists=`{surface.get('path_exists')}` "
				f"localUrl=`{surface.get('localUrl')}` devCommand=`{surface.get('devCommand')}`"
			)
	else:
		lines.append("  - none")
	lines.append("")
	lines.append("**Recommended Next Changes**")
	recs: list[str] = []
	for finding in result["findings"]:
		if finding["recommendation"] not in recs:
			recs.append(finding["recommendation"])
	if recs:
		for index, rec in enumerate(recs[:6], start=1):
			lines.append(f"{index}. {rec}")
	else:
		lines.append("1. Preserve this flow as a regression fixture and add UI automation when needed.")
	return "\n".join(lines)


def score_workspace(workspace: Path, scenario_id: str, transcript_path: Path | None) -> dict[str, Any]:
	scenario = SCENARIOS.get(scenario_id)
	if not scenario:
		raise SystemExit(f"Unknown scenario '{scenario_id}'. Known scenarios: {', '.join(sorted(SCENARIOS))}")

	root = workspace.resolve()
	transcript = load_text(transcript_path) if transcript_path else ""
	manifest_path = root / "workspace.goal.json"
	raw_manifest, manifest_error = load_json(manifest_path)
	findings: list[Finding] = []

	if manifest_error:
		findings.append(Finding(
			"P0",
			"Business goal setup",
			"The workspace manifest is missing or invalid.",
			manifest_error,
			"Create a valid workspace.goal.json at the workspace root before scoring the dogfood run.",
		))
		manifest: dict[str, Any] = {}
		areas = [
			AreaScore("Business goal setup", 0, []),
			AreaScore("Surface creation and manifest registration", 0, []),
			AreaScore("Generated app usefulness", 0, []),
			AreaScore("Shared domain, events, and workflows", 0, []),
			AreaScore("Durable memory", 0, []),
			AreaScore("Cross-surface coherence", 0, []),
			AreaScore("Preview/run/switch readiness", 0, []),
			AreaScore("Agent behavior and context quality", 0, []),
			AreaScore("Ix/code-context integration", 0, []),
			AreaScore("Repeatability and test hygiene", 0, []),
		]
	else:
		manifest = as_dict(raw_manifest)
		areas = [
			score_business_goal(root, manifest, scenario, findings),
			score_surfaces(root, manifest, scenario, findings),
			score_app_usefulness(root, manifest, scenario, findings),
			score_shared_context(root, manifest, scenario, findings),
			score_memory(root, manifest, scenario, findings),
			score_cross_surface(root, manifest, scenario, transcript, findings),
			score_preview(root, manifest, scenario, findings),
			score_agent_behavior(root, manifest, scenario, transcript, findings),
			score_ix(root, manifest, scenario, findings),
			score_repeatability(root, manifest, scenario, findings),
		]

	total = sum(area.score for area in areas)
	result = {
		"verdict": verdict(total, findings, manifest_error is None),
		"total": total,
		"scenario": scenario_id,
		"areas": [{"name": area.name, "score": area.score, "evidence": area.evidence} for area in areas],
		"findings": [finding.__dict__ for finding in sorted(findings, key=lambda item: {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(item.severity, 9))],
		"inventory": build_inventory(root, manifest if manifest_error is None else None),
	}
	return result


def main(argv: list[str]) -> int:
	parser = argparse.ArgumentParser(description="Score a goal-workspace dogfood run.")
	parser.add_argument("--workspace", required=True, help="Path to the workspace root to score.")
	parser.add_argument("--scenario", default="personal-training", help="Scenario id. Default: personal-training.")
	parser.add_argument("--transcript", help="Optional transcript or run-notes file.")
	parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
	args = parser.parse_args(argv)

	workspace = Path(args.workspace)
	transcript = Path(args.transcript) if args.transcript else None
	result = score_workspace(workspace, args.scenario, transcript)
	if args.json:
		print(json.dumps(result, indent=2, sort_keys=True))
	else:
		print(render_markdown(result))
	return 0


if __name__ == "__main__":
	raise SystemExit(main(sys.argv[1:]))

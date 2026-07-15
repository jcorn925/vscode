"""Backend automation hooks for the Task Tracker reference app.

This module is owned by the `backend` scaffold module. Its `tools/`
subfolder is deliberately carved out and owned by `infrastructure` instead
(see architecture.scaffold.toml `excludes`) — it holds deployment-managed
tool adapters rather than application code, which is the nested-exclusion
case the Ix scaffold contract needs to model.
"""

from __future__ import annotations

from typing import Sequence


def run_digest(titles: Sequence[str]) -> str:
    """Return a one-line human-readable summary of open task titles."""

    if not titles:
        return "digest: no tasks yet"
    return f"digest: {len(titles)} task(s) — {', '.join(titles)}"

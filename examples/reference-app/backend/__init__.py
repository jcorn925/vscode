"""Task Tracker backend package.

A tiny stdlib-only HTTP service used as the "reference app" for the Ix
scaffold verification framework. It exists so architecture.scaffold.toml has
a real, buildable target: each checkpoint in specs/001-007 adds a slice of
this package (and its sibling frontend/database/tests/infra modules).
"""

from .models import Task, TaskStore
from .api import build_handler

__all__ = ["Task", "TaskStore", "build_handler"]

"""Domain model for the Task Tracker reference app."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Iterator


@dataclass
class Task:
    id: int
    title: str
    done: bool = False

    def to_dict(self) -> dict:
        return {"id": self.id, "title": self.title, "done": self.done}


class TaskStore:
    """In-memory task store, mirroring the shape of database/schema.sql."""

    def __init__(self) -> None:
        self._tasks: dict[int, Task] = {}
        self._ids: Iterator[int] = itertools.count(1)

    def add(self, title: str) -> Task:
        task = Task(id=next(self._ids), title=title)
        self._tasks[task.id] = task
        return task

    def complete(self, task_id: int) -> Task:
        task = self._tasks[task_id]
        task.done = True
        return task

    def list(self) -> list[Task]:
        return list(self._tasks.values())

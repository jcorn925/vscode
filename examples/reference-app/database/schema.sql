-- Task Tracker reference app schema (final shape).
-- Mirrors examples/reference-app/backend/models.py:Task.

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
);

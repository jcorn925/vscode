-- Initial migration for the Task Tracker reference app.
-- Introduced at checkpoint 002 (specs/002-domain-models-and-migrations.md).

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
);

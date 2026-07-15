# Checkpoint 001 — Backend skeleton

## Goal

Stand up the minimal backend package and a matching database schema stub for
the Task Tracker reference app, with nothing else in scope yet.

## Required files

- `backend/__init__.py`
- `backend/app.py`
- `database/schema.sql`

## Active modules

- `backend`
- `database`

## Allowed scope

Only paths under `backend/**` and `database/**` may exist/change at this
checkpoint. `frontend/`, `tests/`, and `infra/` are not started yet.

## Advisory

Ix is expected (not required) to surface a `backend-core` region once enough
backend files exist to cluster. Region naming/confidence are advisory only —
they never fail this checkpoint.

## Next

Checkpoint 002 adds domain models and a first real migration.

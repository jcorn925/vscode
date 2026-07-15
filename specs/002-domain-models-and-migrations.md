# Checkpoint 002 — Domain models and migrations

## Goal

Add the `Task`/`TaskStore` domain model to the backend, and the first
tracked database migration alongside the schema stub.

## Required files

Everything from checkpoint 001, plus:

- `backend/models.py`
- `database/migrations/0001_init.sql`

## Active modules

- `backend`
- `database`

## Allowed scope

Same as checkpoint 001: `backend/**`, `database/**` only.

## Advisory

`ix_region_hints`: `backend-core`. Confidence is not enforced.

## Next

Checkpoint 003 adds the HTTP API surface and introduces the backend
automation hook module, including the `agent/tools/` nested exclusion.

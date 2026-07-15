# Checkpoint 003 — API endpoints and agent automation hooks

## Goal

Add the HTTP API surface on top of the domain model, and introduce the
backend automation hook module (`backend/agent/`). This checkpoint also
introduces the framework's nested-exclusion case: `backend/agent/tools/` is
physically inside `backend/`, but is owned by the `infrastructure` module,
not `backend`.

## Required files

Everything from checkpoint 002, plus:

- `backend/api.py`
- `backend/agent/__init__.py`
- `backend/agent/tools/README.md` (owned by `infrastructure`, per the
  `excludes` entry on the `backend` module)

## Active modules

- `backend`
- `database`
- `infrastructure` (only for the `backend/agent/tools/**` carve-out)

## Allowed scope

`backend/**`, `database/**`, `infra/**` — note `backend/agent/tools/**` is
allowed here even though `infra/` itself has no files yet, because ownership
(not physical location) determines which module a path belongs to.

## Advisory

`ix_region_hints`: `backend-core`, `backend-automation`. Confidence is not
enforced.

## Next

Checkpoint 004 starts the frontend scaffold.

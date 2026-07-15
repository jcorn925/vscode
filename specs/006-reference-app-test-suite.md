# Checkpoint 006 — Reference app test suite

## Goal

Add the Task Tracker's own tests, covering the backend model/API and a
frontend smoke test. This is the reference app's `tests/` module — distinct
from this repo's own `tests/test_ix_scaffold.py`, which tests the
verification framework itself, not the reference app.

## Required files

Everything from checkpoint 005, plus:

- `tests/backend/test_api.py`
- `tests/frontend/test_app.cjs` (`.cjs` for the same CommonJS-under-`"type":
  "module"` reason as `frontend/api-client.cjs`)

## Active modules

- `backend`
- `database`
- `infrastructure`
- `frontend`
- `tests`

## Allowed scope

Everything from checkpoint 005, plus `tests/**`.

## Advisory

`ix_region_hints`: `backend-core`, `backend-automation`, `frontend-ui`,
`reference-app-tests`. Confidence is not enforced.

## Next

Checkpoint 007 finalizes infrastructure/CI and brings all five modules into
scope at once.

# Checkpoint 007 — Infrastructure and CI finalization

## Goal

Finalize deployment infrastructure for the Task Tracker reference app. This
is the last checkpoint: all five scaffold modules (`backend`, `frontend`,
`database`, `tests`, `infrastructure`) are active and the full reference app
is complete.

## Required files

Everything from checkpoint 006, plus:

- `infra/Dockerfile`
- `infra/ci.yml`

## Active modules

- `backend`
- `database`
- `infrastructure`
- `frontend`
- `tests`

## Allowed scope

All module paths: `backend/**`, `database/**`, `infra/**` (incl.
`backend/agent/tools/**`), `frontend/**`, `tests/**`.

## Advisory

`ix_region_hints`: `backend-core`, `backend-automation`, `frontend-ui`,
`reference-app-tests`, `infra`. Confidence is not enforced.

## Next

None — this is the final checkpoint. A future exercise can delete
`examples/reference-app/` and have an agent rebuild it from scratch,
re-running the verifier at each checkpoint to check its progress against
this same contract.

# Checkpoint 004 — Frontend scaffold

## Goal

Add a static frontend shell (markup + UI wiring) for the Task Tracker. The
frontend does not talk to the backend yet — that comes at checkpoint 005.

## Required files

Everything from checkpoint 003, plus:

- `frontend/index.html` (part of the `frontend` module; see note below)
- `frontend/app.js`

> **Note:** `frontend/index.html` is *not* listed as an Ix-verifiable
> required file in `architecture.scaffold.toml`. Empirically, `ix map`/`ix
> inventory` do not ingest plain `.html` files as file entities in this
> environment, so a required-files gate sourced from Ix evidence cannot
> reference it. `frontend/app.js` is the Ix-visible proxy for "frontend
> scaffold exists" at this checkpoint. The HTML file should still exist on
> disk — it just isn't part of the hard-fail gate.

## Active modules

- `backend`
- `database`
- `infrastructure`
- `frontend`

## Allowed scope

`backend/**`, `database/**`, `infra/**` (incl. `backend/agent/tools/**`),
`frontend/**`.

## Advisory

`ix_region_hints`: `backend-core`, `backend-automation`, `frontend-ui`.
Confidence is not enforced.

## Next

Checkpoint 005 wires the frontend to the backend API.

# Checkpoint 005 — Frontend/backend integration

## Goal

Add the API client the frontend uses to talk to the backend, closing the
loop between `frontend/app.js` and `backend/api.py`.

## Required files

Everything from checkpoint 004, plus:

- `frontend/api-client.cjs` (named `.cjs`, not `.js`, so Node's CommonJS
  `module.exports` works unambiguously regardless of this repo's root
  `package.json` `"type": "module"` — browsers don't care about the
  extension for a classic `<script src>`)

## Active modules

- `backend`
- `database`
- `infrastructure`
- `frontend`

## Allowed scope

Same as checkpoint 004: `backend/**`, `database/**`, `infra/**` (incl.
`backend/agent/tools/**`), `frontend/**`.

## Advisory

`ix_region_hints`: `backend-core`, `backend-automation`, `frontend-ui`.
Confidence is not enforced.

## Next

Checkpoint 006 adds the reference app's own test suite.

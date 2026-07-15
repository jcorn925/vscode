# Agent tools (infrastructure-owned)

This folder is physically nested under `backend/agent/`, but it is
deliberately **not** owned by the `backend` scaffold module. It is owned by
`infrastructure` instead, per the `excludes` entry on the `backend` module in
[`architecture.scaffold.toml`](../../../../../architecture.scaffold.toml).

Why: files here represent deployment-managed tool adapters (for example,
generated CLI wrappers or environment-specific integration configs) rather
than application logic. In a real project these files are typically
generated or injected by infrastructure/CI, not authored alongside the
backend's domain code — so the scaffold contract routes them to the
`infrastructure` module even though they live inside `backend/agent/`.

This is the nested-exclusion example the Ix scaffold verification framework
exercises: a subfolder of an owned path reassigned to a different module.

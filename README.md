# Babadaba

> Works so well you'll say "Babadaba."

Babadaba is a custom Code - OSS fork for turning business intent into working product surfaces. It keeps the familiar editor and workbench foundation, then adds goal workspaces, guided surface planning, launch guidance, milestone evaluation, and agent context for building multi-surface products.

- Purpose: [.agent/PROJECT_PURPOSE.md](.agent/PROJECT_PURPOSE.md)
- Live IDE demo (read-only, in the browser): [https://goalconsole-demo.vercel.app](https://goalconsole-demo.vercel.app)
- Local landing page: [docs/ide-purpose/index.html](docs/ide-purpose/index.html)
- Published landing page (GitHub Pages): [https://jcorn925.github.io/vscode/](https://jcorn925.github.io/vscode/)
- Legacy Vercel URL ([ide-purpose.vercel.app](https://ide-purpose.vercel.app/)) may lag until redeployed from `docs/ide-purpose`
- Milestones: [.agent/milestones.json](.agent/milestones.json)

## Compile and start

From the repo root:

```bash
# 1. Install dependencies (first time, or after package-lock changes)
npm ci

# 2. Compile the client, built-in extensions, and Copilot bits
npm run compile

# 3. Start Babadaba (downloads Electron on first run if needed)
./scripts/code.sh
```

On Windows, use `scripts\code.bat` instead of `./scripts/code.sh`.

Optional:

```bash
# Incremental rebuild while developing (leave running in another terminal)
npm run watch

# Open a specific workspace folder
./scripts/code.sh /path/to/your/goal-workspace
```

`./scripts/code.sh` runs `build/lib/preLaunch.ts` first: it installs `node_modules` if missing, fetches Electron, and runs `npm run compile` only when `out/` is missing. Prefer an explicit `npm run compile` (or `npm run watch`) after source changes so you are not relying on a stale `out/`.

## Ix scaffold verification

[architecture.scaffold.toml](architecture.scaffold.toml) is a hand-authored contract that declares stable module IDs and path ownership (`backend`, `frontend`, `database`, `tests`, `infrastructure`, including nested exclusions like `backend/agent/tools/**`) for [examples/reference-app](examples/reference-app), plus seven phased checkpoints aligned to [specs/001-backend-skeleton.md](specs/001-backend-skeleton.md) through [specs/007-infra-ci-finalization.md](specs/007-infra-ci-finalization.md). [scripts/ix_scaffold_check.py](scripts/ix_scaffold_check.py) verifies a checkpoint by combining that contract with live evidence from the [Ix CLI](src/custom/ix/IxIntegrationService.ts) (`ix map`, `ix inventory`, `ix subsystems`).

Local checkpoint gate sequence:

```bash
# 1. Generate/build the phase (add the files a given checkpoint requires)
# 2. Run the verifier for that checkpoint
python3 scripts/ix_scaffold_check.py --checkpoint 003

# 3. Inspect the snapshot it wrote
cat .ix-scaffold/latest.json          # always the most recent run
cat .ix-scaffold/checkpoints/003.json # this checkpoint's report

# 4. Only continue to the next phase if the command exited 0
```

Use `--no-remap` to skip re-running `ix map .` and read the already-persisted Ix graph (faster iteration once the graph is fresh). Use `--contract`/`--snapshot-dir` to point at a different contract or output location.

**Hard failures** (nonzero exit): missing required files for the checkpoint, files that match no declared module (unowned), files claimed by more than one module (overlapping ownership), and files outside the checkpoint's `allowed_scope`/`active_modules`, or Ix itself being unavailable or returning malformed output.

**Advisory / unsupported** (never affect the exit code): Ix's own inferred region/cluster labels, health, and confidence scores are recorded for comparison against each checkpoint's `advisory.ix_region_hints`, but are never authoritative — Ix may rename or regroup them. Detailed subsystem membership/edges (`ix subsystems --list --detailed`) are collected best-effort with a bounded timeout; when that data is slow, absent, or incomplete (as observed in practice), the report marks those specific assertions `unsupported` rather than claiming they passed.

**Known Ix evidence gap:** `required_files` is sourced from `ix inventory --kind file`, not a raw filesystem scan, so it can only require files Ix actually ingests. In this environment, plain `.html` files were not ingested by `ix map`/`ix inventory` even after a forced re-map, while `.py`/`.js`/`.sql`/`.md`/`.yml` all were. `examples/reference-app/frontend/index.html` still exists as part of the `frontend` module, but is deliberately left out of every checkpoint's `required_files` for this reason — see the note at the top of the checkpoints section in `architecture.scaffold.toml`.

`.ix-scaffold/` is git-ignored — it's a local, regenerable snapshot directory, not checked-in state.

Run the framework's own tests with `pytest tests/` (mocks all `ix` subprocess calls, so no local Ix install is required; this is what CI runs in [.github/workflows/ix-scaffold-tests.yml](.github/workflows/ix-scaffold-tests.yml)).

### Live Arango graph compare

[scripts/ix_graph_compare.py](scripts/ix_graph_compare.py) compares two ix workspaces directly against the live ArangoDB `ix_memory` database (collections `nodes`/`edges` on `http://127.0.0.1:8529`) instead of the CLI exports. It is for clone-accuracy scoring: "did the reproduction recreate the same call/import/defines wiring as the original?"

```bash
# See workspace ids known to ix
python3 scripts/ix_graph_compare.py --list-workspaces

# Compare a reference workspace against a clone (same Arango, two workspace_ids)
python3 scripts/ix_graph_compare.py \
  --workspace-a 4c13acde --workspace-b <clone-ws-id> \
  --min-edge-recall 0.9

# Snapshots land in .ix-scaffold/graph-compare/
cat .ix-scaffold/graph-compare/latest.json
```

Nodes are matched by canonical structural IDs (`file:<path>`, `function:<path>::<name>`, …) built from workspace-relative paths — never by `_key`s, `logical_id` UUIDs, or Ix's inferred region labels, which are instance-local and won't survive a second ingest. Edges are compared as `(src, PREDICATE, dst)` triples over `CALLS`/`IMPORTS`/`DEFINES`/`EXTENDS` by default (`CONTAINS`/`REFERENCES` are excluded as noise; override with `--predicates`). Use `--root-a`/`--root-b` to align differing path prefixes and `--exclude` globs to drop tests/docs. The report includes per-predicate precision/recall/Jaccard, an advisory degree-ranked hub diff, and a gap list (`clone missing … --CALLS--> …`) sized by `--max-gaps`; exit code is nonzero when `--min-node-recall`/`--min-edge-recall` (default 1.0) are not met, or when Arango is unreachable or returns malformed responses (fail-closed, read-only AQL throughout).

**Stability caveat:** this reads ix's internal Arango schema, which may change between ix versions; [scripts/ix_scaffold_check.py](scripts/ix_scaffold_check.py) consumes the public CLI contract and remains the stable fallback. Its tests are mocked the same way (`tests/test_ix_graph_compare.py`), so CI needs no Arango.

### Agent clone repair loop

[scripts/ix_clone_loop.py](scripts/ix_clone_loop.py) wires a headless coding agent into the generate side: when the graph compare fails its recall thresholds, the gap list is rendered into a repair prompt (missing symbols first — each line names a file and symbol), piped to the agent (`claude -p --permission-mode acceptEdits` by default, override with `--agent-cmd`), then the clone is re-mapped with `ix map`, the loop waits for the async ingest to settle, and compares again — up to `--max-iterations`.

```bash
python3 scripts/ix_clone_loop.py \
  --reference-workspace <ref-ws-id> \
  --clone-dir /path/to/clone \
  --reference-dir /path/to/original \
  --max-iterations 3

# Per-iteration artifacts (prompt.md, agent-output.txt, compare.json) plus summary.json:
ls .ix-scaffold/clone-loop/<ref>_vs_<clone>/
```

The clone workspace id is resolved from `~/.ix/config.yaml` by `root_path` (pass `--clone-workspace` if attribution is ambiguous) and verified to contain nodes before any compare — empty or unsettled ingests fail closed rather than scoring stale state. When the reference workspace has no live edges (ix tombstones a workspace's edges once identical content is ingested elsewhere), edge gaps are suppressed from the prompt as noise; `--min-edge-recall` defaults to 0 for the same reason. The claude CLI is only needed at runtime — the loop's tests (`tests/test_ix_clone_loop.py`) mock the agent, `ix map`, and Arango, so CI needs none of them.

### Graph-compare MCP server

[scripts/ix_graph_mcp.py](scripts/ix_graph_mcp.py) exposes the compare tooling to any MCP client (Claude Code, the Claude Agent SDK, Cursor, this fork) as a stdlib-only stdio server, so an agent can drive the compare/repair loop itself instead of being driven by `ix_clone_loop.py`:

- `compare_graphs` — reference vs clone workspace compare; returns recall metrics plus the `missing_in_clone` gap list (capped at 50 entries for context-window sanity). Pass an optional `run_id` for iterative generation: the result then carries a `progress` block (round number, recall delta, `rounds_without_improvement`) persisted under `.ix-scaffold/graph-compare/runs/`, giving the agent a mechanical stopping rule — stop when `passed` is true or `rounds_without_improvement >= 2`.
- `compare_proposal` — verifies a workspace against a graph-proposal JSON file (`.agent/task-trees/<id>.graph-proposal.json`) instead of a reference workspace, for plan-first builds where the plan itself is the contract. Recall-oriented: extra structure never fails; missing proposed nodes/structural edges and still-present removals do. Supports the same `run_id` progress tracking as `compare_graphs`. On success it also writes `.ix-scaffold/graph-compare/latest-proposal.json` (plus a named `proposal_<tree>_vs_<ws>.json`) for the workbench visualizer.
- `remap_and_wait` — runs `ix map` on a directory and polls Arango until the async ingest settles; call it after editing files or the compare tools score the pre-edit graph. Never-mapped directories are registered on first call (the map runs before workspace resolution), so recreate-from-spec bootstraps work.
- `list_workspaces` — workspace ids and root paths from `~/.ix/config.yaml`.

Registered in [.mcp.json](.mcp.json) (Claude Code) and [.vscode/mcp.json](.vscode/mcp.json) (workbench). All infrastructure failures surface as `isError` tool results — the server never fabricates metrics. Tests (`tests/test_ix_graph_mcp.py`) mock the compare/loop seams, so CI needs no Arango or ix.

**Proposal Graph Diff (workbench):** after `remap_and_wait` + `compare_proposal`, run **Ix: Open Proposal Graph Diff** from the Command Palette. It loads the proposal + `latest-proposal.json` into a Cytoscape board colored by status (matched / missing / removal still present / speculative). Leave the editor open — it watches the snapshot file and refreshes when the agent re-compares.

The public Python API for these tools is indexed in [scripts/__init__.py](scripts/__init__.py) (`from scripts import run_compare, wait_for_ingest, ...` with the repo root on `sys.path`); leading-underscore names are internal.

### Live Arango graph comparison

[scripts/ix_graph_compare.py](scripts/ix_graph_compare.py) compares two ix workspace graphs directly against the live ArangoDB `ix_memory` database (read-only AQL over the `nodes`/`edges` collections) instead of the lossy CLI exports. It canonicalizes both sides by structure — `file:<path>`, `function:<path>::<name>`, etc., never instance-local `_key`s or UUIDs — and compares edges as `(src, PREDICATE, dst)` triples for `CALLS`/`IMPORTS`/`DEFINES`/`EXTENDS`, reporting precision/recall/Jaccard per predicate plus an actionable gap list (`clone missing backend/api.py::create_task --CALLS--> ...`).

```bash
# Discover workspace ids ix has ingested
python3 scripts/ix_graph_compare.py --list-workspaces

# Score a clone against its reference (same Arango, two workspace_ids)
python3 scripts/ix_graph_compare.py \
  --workspace-a <reference-ws-id> --workspace-b <clone-ws-id> \
  --min-edge-recall 0.9

# Snapshots land in .ix-scaffold/graph-compare/
```

Use `--root-a`/`--root-b` to scope and strip path prefixes so differently rooted checkouts align, `--exclude 'tests/**'` to drop noise, and `--endpoint-b` to compare across two Arango instances. Exit is nonzero when node/edge recall falls below `--min-node-recall`/`--min-edge-recall` (both default 1.0) or when Arango is unreachable/malformed (fails closed).

**When to use which:** the graph compare reads ix's internal Arango schema, which may change between ix versions — `scripts/ix_scaffold_check.py` consumes the public CLI contract and remains the stable fallback. Use the CLI checker for checkpoint gating, and the live-graph compare when you need full-fidelity wiring verification (did the clone recreate the same call/import graph, not just the same file list). Note that AQL reads can stall while an ix ingest is actively writing; re-run after `ix status` reports the graph is up to date.

Its tests (`tests/test_ix_graph_compare.py`) mock the Arango HTTP seam, so they run without a live database, in the same CI workflow.

## Upstream Base

This fork is based on Visual Studio Code - Open Source ("Code - OSS").

[![Feature Requests](https://img.shields.io/github/issues/microsoft/vscode/feature-request.svg)](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
[![Bugs](https://img.shields.io/github/issues/microsoft/vscode/bug.svg)](https://github.com/microsoft/vscode/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Abug)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-yellow.svg)](https://gitter.im/Microsoft/vscode)

## The Repository

This repository ("`Code - OSS`") is where we (Microsoft) develop the [Visual Studio Code](https://code.visualstudio.com) product together with the community. Not only do we work on code and issues here, but we also publish our [roadmap](https://github.com/microsoft/vscode/wiki/Roadmap), [monthly iteration plans](https://github.com/microsoft/vscode/wiki/Iteration-Plans), and our [endgame plans](https://github.com/microsoft/vscode/wiki/Running-the-Endgame). This source code is available to everyone under the standard [MIT license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).

## Visual Studio Code

<p align="center">
  <img alt="VS Code in action" src="https://github.com/user-attachments/assets/56af271c-949d-454c-a3ea-16188c063414">
</p>

[Visual Studio Code](https://code.visualstudio.com) is a distribution of the `Code - OSS` repository with Microsoft-specific customizations released under a traditional [Microsoft product license](https://code.visualstudio.com/License/).

[Visual Studio Code](https://code.visualstudio.com) combines the simplicity of a code editor with what developers need for their core edit-build-debug cycle. It provides comprehensive code editing, navigation, and understanding support along with lightweight debugging, a rich extensibility model, and lightweight integration with existing tools.

Visual Studio Code is updated monthly with new features and bug fixes. You can download it for Windows, macOS, and Linux on [Visual Studio Code's website](https://code.visualstudio.com/Download). To get the latest releases every day, install the [Insiders build](https://code.visualstudio.com/insiders).

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/microsoft/vscode/issues), and help us verify as they are checked in
* Review [source code changes](https://github.com/microsoft/vscode/pulls)
* Review the [documentation](https://github.com/microsoft/vscode-docs) and make pull requests for anything from typos to new content.

If you are interested in fixing issues and contributing directly to the code base,
please see the document [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), which covers the following:

* [How to build and run from source](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
* [The development workflow, including debugging and running tests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#debugging)
* [Coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests)
* [Finding an issue to work on](https://github.com/microsoft/vscode/wiki/How-to-Contribute#where-to-contribute)
* [Contributing to translations](https://aka.ms/vscodeloc)

## Feedback

* Ask a question on [Stack Overflow](https://stackoverflow.com/questions/tagged/vscode)
* [Request a new feature](CONTRIBUTING.md)
* Upvote [popular feature requests](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* [File an issue](https://github.com/microsoft/vscode/issues)
* Connect with the extension author community on [GitHub Discussions](https://github.com/microsoft/vscode-discussions/discussions) or [Slack](https://aka.ms/vscode-dev-community)
* Follow [@code](https://x.com/code) and let us know what you think!

See our [wiki](https://github.com/microsoft/vscode/wiki/Feedback-Channels) for a description of each of these channels and information on some other available community-driven channels.

## Related Projects

Many of the core components and extensions to VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) repositories are separate from each other. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).

## Bundled Extensions

VS Code includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (inline suggestions, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

## Development Container

This repository includes a Visual Studio Code Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command which creates a Docker volume for better disk I/O on macOS and Windows.
  * If you already have VS Code and Docker installed, you can also click [here](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/microsoft/vscode) to get started. This will cause VS Code to automatically install the Dev Containers extension if needed, clone the source code into a container volume, and spin up a dev container for use.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code, and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 cores and 6 GB of RAM (8 GB recommended)** to run a full build. See the [development container README](.devcontainer/README.md) for more information.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.

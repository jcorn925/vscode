# Ix command trace — Process notes **Generate** (`buildCustomPromptEvidencePack`)

This document is the human-readable spec for **which `ix` commands run, in what order**, when building a **Custom prompt / Process notes** evidence pack. It mirrors the implementation in:

- [`processNotesCustomEvidence.ts`](processNotesCustomEvidence.ts) — `buildCustomPromptEvidencePack`
- [`ixSubsystemExplain.ts`](ixSubsystemExplain.ts) — `runIxSubsystemExplainWithDisambiguation`
- [`IxIntegrationService.ts`](../../../../../custom/ix/IxIntegrationService.ts) — `ensureIxMappedIfEmpty`, `runJsonQuery` (argv quoting via `quoteShellArg`)

**Not covered here:** the **discovery-only** card grid in `modeShell.contribution.ts` (`loadProcessNotesSuggestions`), which uses only hydrate + `ix subsystems … --format json`—see that file if you need the grid trace.

---

## Notation

| Mechanism | Meaning |
|-----------|---------|
| **Shell** | Invoked via `runCommand`, not `runJsonQuery`. Uses resolved `ix` binary + quoting. |
| **`runJsonQuery(argv)`** | Invoked as `ix` + space-separated quoted args (same logical argv as below). |
| **`commandBudget`** | Starts at **20**. Decremented by each successful scheduling of the inner `run()` helper, and once per **subsystem-region** deepening target before `runIxSubsystemExplainWithDisambiguation`. Subsystem explain **retries** (`--pick`) do **not** decrement the budget. |

---

## Phase 0 — Graph hydrate (always first)

**Purpose:** Ensure Ix has material to query; cold graphs trigger a full map.

| Order | Type | Command (conceptual) | Condition |
|-------|------|----------------------|-----------|
| 0.1 | Shell | `ix stats` | Always (when Ix is available and not web). |
| 0.2 | Shell | `ix map --all-items .` | Only if stats indicate **zero** graph nodes. |

Source: `IIxIntegrationService.ensureIxMappedIfEmpty`.

---

## Phase 1 — Discovery (`runJsonQuery`)

All steps use **budget** −1 per `run()` call that actually executes (stops if budget ≤ 0 before scheduling).

| Order | argv passed to `runJsonQuery` | Timeout | Condition |
|-------|-------------------------------|---------|-----------|
| 1.1 | `subsystems` `--sort` `importance` `--all-items` `--format` `json` | 90s | Always. **Do not** append `.` — global regions list shape. |
| 1.2 | `map` `--format` `json` `.` | 90s | Only if **no regions** were collected from 1.1. |
| 1.3 | `inventory` `--format` `json` | 90s | Only if **still no regions** after 1.2. |

---

## Phase 2 — Selection

**No `ix` CLI.** In-process candidate scoring + `selectProcessCandidates` (model or deterministic). Recorded in evidence as `process.candidate-selection`.

---

## Phase 3 — Resolution (branch)

### Branch A — Card / forced subsystem selection (`selectedRegions.length > 0`)

**No** `search`, `locate`, or `text` invocations. Targets are built only from:

- Up to **3** selected regions’ **labels** as subsystem targets (`source: subsystem`).
- Optional **file paths** from `collectPathHintsFromSubsystemRaw(region.raw)` (`path` set, still `source: subsystem`).

### Branch B — Free-form (no card selection)

For each keyword `term` in `selection.keywords` — **first 3 only**, skipping low-signal terms (too short, numeric-only, etc.):

| Per term | argv | Timeout |
|----------|------|---------|
| B.a | `search` `<term>` `--format` `json` | 30s |
| B.b | `locate` `<term>` `--format` `json` | 30s |

**If** `resolved` is still empty after all pairs above, for each `kw` in the same **first 3** keywords (same skip rules):

| Step | argv | Timeout |
|------|------|---------|
| B.c | `text` `<kw>` `--format` `json` | 30s |

---

## Phase 4 — Deepening (at most **2** targets)

Targets: `uniqueTargets(resolved)` after filtering deepen candidates, then **`slice(0, 2)`** — **maximum two** deepen entities.

For **each** target, in order:

### Subsystem region only

When `source === 'subsystem'` **and** there is **no** `path` (pure region label):

1. Decrement **commandBudget** once before explain; if budget ≤ 0, **stop** deepening loop.
2. Run **`runIxSubsystemExplainWithDisambiguation`** (90s total per call chain):

   **2a. Primary**

   - argv: `subsystems` `--target` `<label>` `--explain` `--format` `json`

   **2b. Ambiguity retries** (only if Ix error matches ambiguous-target heuristic)

   - For `n` in order from `pickOrderForSubsystemLabelKind(labelKind)` (e.g. module-heavy vs system-heavy orders):

     - argv: `subsystems` `<label>` `--pick` `<n>` `--explain` `--format` `json`

   - Stop on first success, or on first failure that is **not** ambiguous.

   Each attempt is a separate `runJsonQuery`; **retries do not use `commandBudget`.**

### Entity / file path targets

When not subsystem-region-only (`path` present or non-subsystem resolution):

Let `explainTarget = path ?? target`.

| Order | argv | Timeout |
|-------|------|---------|
| 4.1 | `explain` `<explainTarget>` `--format` `json` | 60s |
| 4.2 | `overview` `<explainTarget>` `--format` `json` | 60s |

---

## Phase 5 — Context (no new `ix` argv)

Reads integration **state**, not a fresh CLI tree:

1. Optional **`ix.pipeline.snapshot(map-related)`** — subset of `pipelineSteps` from `ix.getState()` (workspace / map-related), capped.
2. Optional **`ix.state.lastOutput`** — if last output length &lt; 12 000 characters.

---

## Linear “happy path” examples (illustrative)

**Hydrated graph, regions from subsystems, card picks two subsystem labels:**

1. `ix stats`
2. `ix subsystems --sort importance --all-items --format json`
3. *(no map/inventory)*
4. *(resolution: no search/locate/text)*
5. `ix subsystems --target "<LabelA>" --explain --format json` [+ optional `--pick` retries]
6. `ix subsystems --target "<LabelB>" --explain --format json` [+ optional `--pick` retries]
7. *(optional pipeline snapshot + lastOutput)*

**Free-form, keywords resolve to a file path:**

1. `ix stats`
2. `ix subsystems --sort importance --all-items --format json`
3. `ix search <term> --format json` / `ix locate <term> --format json` / …
4. `ix explain <pathOrEntity> --format json`
5. `ix overview <pathOrEntity> --format json`
6. *(optional context)*

---

## Related plan

Aligned with the **Process note document schema** plan (`process_note_document_schema_620586c4.plan.md` in Cursor plans): **`CustomPromptEvidencePack`** is the structured input to synthesis; this trace is the **Ix side** of that pack.

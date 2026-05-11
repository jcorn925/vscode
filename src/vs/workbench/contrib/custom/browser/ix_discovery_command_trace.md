# Ix discovery command trace

Authoritative, ordered list of every `ix` invocation issued by the Process Notes
**discovery** phase, as implemented in
[`modeShell.contribution.ts`](./modeShell.contribution.ts).

Discovery is triggered by `ModeShellContribution.loadProcessNotesSuggestions()`,
which runs:

- on initial mode activation (the constructor schedules it),
- whenever the workspace key changes,
- whenever the user explicitly reloads suggestions.

The trace below reflects the post-cleanup state in which the per-card
`ix subsystems --target … --explain` prefetch has been removed (it was
unreliable for region labels and produced no useful preview text).

> Discovery and **deepening** are different phases.
> This document covers discovery only — i.e. building the "System processes"
> cards. Deepening (per-target evidence after a card is selected) lives in
> [`processNotesCustomEvidence.ts`](./processNotesCustomEvidence.ts) and is
> documented separately.

---

## Sequential trace

### 1. `ix stats`

- **Phase log**: `[discovery] … ensure ix mapped` → `[discovery] ✓ ensure ix mapped`
- **Caller**: `ModeShellContribution.loadProcessNotesSuggestions`
  invokes `IIxIntegrationService.ensureIxMappedIfEmpty(discoveryFolder)`.
- **Implementation**: `IxIntegrationService.ensureIxMappedIfEmpty` in
  [`src/custom/ix/IxIntegrationService.ts`](../../../../../custom/ix/IxIntegrationService.ts).
- **Command**: `ix stats`
- **Why we run it**: cheap probe to detect whether the Ix graph is empty.
  Output is also surfaced as a `statsPreview` headline for the discovery log.
- **Always runs**: yes — first command in every discovery cycle.

### 2. `ix map --all-items .` *(conditional)*

- **Phase log**: still under `[discovery] … ensure ix mapped`. When triggered,
  the deepening pipeline that consumes the trace records it as
  `ix map --all-items . (graph was empty)`.
- **Caller**: same `ensureIxMappedIfEmpty` call.
- **Command**: `ix map --all-items .`
- **Why we run it**: hydrate the Ix graph for first-time / cleared workspaces
  so the subsequent `ix subsystems` call has data to return.
- **When it runs**: only if `looksIxGraphEmptyFromStats(stats.output)` returns
  `true`. On a populated workspace this step is skipped.
- **Timeout**: 600s (mapping is the expensive step).

### 3. `ix subsystems --sort importance --all-items --format json`

- **Phase log**:
  `[discovery] … ix subsystems --sort importance --all-items --format json` →
  `[discovery] ✓ …` (or `[discovery] ✗ …` on failure).
- **Caller**: `ModeShellContribution.loadProcessNotesSuggestions` directly.
- **Implementation**: `IIxIntegrationService.runJsonQuery(['subsystems', '--sort', 'importance', '--all-items', '--format', 'json'], discoveryFolder, 90_000)`.
- **Command**: `ix subsystems --sort importance --all-items --format json`
- **Why we run it**: returns the global `regions` hierarchy used to render the
  "System processes" cards.
- **Important**: do **not** pass a target like `.` here. With a target, Ix
  switches to a scoped `target/children` JSON shape, while the global form
  returns the top-level region list we need.
- **Timeout**: 90s.
- **On failure**: discovery aborts with `[discovery] ✗ No discovery JSON available.`
  No further `ix` commands are issued and `processNotesSuggestions` is left empty.

---

## What discovery does **not** run

The following commands are intentionally absent from discovery. If you see them
in the discovery log, something has regressed:

| Command | Why not in discovery |
| --- | --- |
| `ix subsystems --target <label> --explain --format json` (and `--pick` retries) | Removed: this was the per-card prefetch loop. Architectural region labels (`Channels`, `Ast`, `Graphify Out`, …) are not graph entity names, so explain returned exit code 1 for ~⅓ of cards and produced no useful preview text on the rest. The deepening phase still uses the disambiguating wrapper for selected targets only. |
| `ix search <term> --format json` | Operates on graph entities, not region labels. Used only in the **resolution** sub-phase of deepening, and only for free-form prompts (no card selection). |
| `ix locate <term> --format json` | Same reasoning as `ix search`. |
| `ix text <term> --format json` | Resolution-phase fallback when search/locate return nothing. |
| `ix explain <target> --format json` | Deepening phase only. |
| `ix overview <target> --format json` | Deepening phase only. |
| `ix inventory --format json` | Resolution-phase fallback path inside `processNotesCustomEvidence`, not discovery. |

---

## Post-discovery (still part of `loadProcessNotesSuggestions`)

After the three commands above, no further `ix` calls are made. The remaining
work is purely in-process:

1. Parse `subsystems.value` via
   `ModeShellContribution.extractDiscoveryCardsFromIxSubsystems(...)` to flatten
   the hierarchy into ordered system / subsystem / module cards.
2. Populate the hidden `processNotesTopicSelect` with one option per card.
3. Build `processNotesSuggestions` (id, label, kind, prompt templates).
4. Log `[selection] ✓ cards=<N>` and `[done] ✓ suggestions=<N>`.

The total fixed cost of a discovery cycle is therefore:

- 1 × `ix stats` (always)
- 0–1 × `ix map --all-items .` (only on empty graphs)
- 1 × `ix subsystems --sort importance --all-items --format json`

---

## Source pointers

- Discovery driver: `loadProcessNotesSuggestions()` in
  [`modeShell.contribution.ts`](./modeShell.contribution.ts).
- `ensureIxMappedIfEmpty` (commands 1 + 2): `IxIntegrationService` in
  [`src/custom/ix/IxIntegrationService.ts`](../../../../../custom/ix/IxIntegrationService.ts).
- `runJsonQuery` (command 3): same file as above.
- Card extraction: `extractDiscoveryCardsFromIxSubsystems()` in
  [`modeShell.contribution.ts`](./modeShell.contribution.ts).

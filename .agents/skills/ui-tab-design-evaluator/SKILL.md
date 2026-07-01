---
name: ui-tab-design-evaluator
description: Evaluate whether the VS Code custom goal-workspace UI tab implementation matches the approved Guided Builder design. Use when reviewing, auditing, scoring, or validating code, screenshots, or running UI for `ModeShellContribution`, `custom-mode-ui-surface-setup`, the UI tab landing callout, goal workspace surface generation, brand setup, or surface handoff in this custom VS Code fork.
---

# UI Tab Design Evaluator

Evaluate the implemented UI tab against the approved design direction for the goal-workspace surface builder. This skill is a review workflow: gather evidence, compare against the target design, identify gaps, and produce prioritized findings.

## Target Design

The approved direction is a **surface-first Guided Builder** with a clear **no-project landing** and a **single scrollable builder column** when `+ Add Surface` is open.

### No-project landing (UI tab, no workspace folder)

When `custom-mode-shell-hasProject` is absent, show a centered callout (`custom-mode-callout`) in the UI preview area:

- Title: **Build your goal workspace**
- Subtitle explaining goal workspace ties business, brand, and apps together with autosave
- Numbered steps: name business → brand assets → pick/generate surfaces one at a time
- **Starter surfaces** chip row listing all eight starter names (Marketing Site, Booking, Client Portal, Trainer Admin, Analytics, Content Scheduler, Ads Manager, Subscriptions)
- Primary CTA: **Open Goal Workspace Example**
- Callout hidden once a project folder is open (`custom-mode-shell-hasProject`)

### Guided Builder (`+ Add Surface`)

Required structure:

- Keep the VS Code-like top workbench navigation: product/workspace title area, active **UI** tab, **Code** tab, **+ Add Surface**, surface tabs when declared, and right utility actions when present.
- Remove the old left progress rail/column entirely.
- **Do not** use exclusive step tabs, section tab rails, sticky outline nav, or a page hero above the builder form.
- **Single main column** only: Goal → Brand → Surfaces (no right companion Agent Plan panel in the current design).
- Right **AI chat** column may remain visible; surface handoff attaches `workspace.goal.json` to that chat session.
- Main scroll column content (top to bottom):
  1. **Goal** — editable business name and description
  2. **Brand** — logo drop zones (full logo + mark), primary/secondary/accent color pickers (persisted to `workspace.goal.json` + `.agent/brand/`)
  3. **Surfaces** — **2-column grid** of all eight starter cards (summary, highlights, icon) plus a dashed **New Surface** `+` card; clicking a card autosaves then opens surface handoff (one surface at a time)
- **No** Save Draft or bulk Generate Surfaces buttons — goal, brand, and builder state **autosave** on change (~600ms debounce).
- **No** six-topic context questionnaire section and **no** freeform “Notes for the agent” textarea in the builder.
- Surface starter clicks should require a business name, autosave goal/brand, then open surface handoff with `workspace.goal.json` attached.

Visual expectations:

- Native VS Code dark workbench feel: compact, mature, productivity-oriented, no marketing page composition inside the builder.
- Use VS Code theme colors (`var(--vscode-...)`), subtle borders, restrained blue accents.
- Prefer rows, section separators, grouped panels, and compact status pills over heavy nested cards.
- Brand drop zones use dashed borders and inline image previews when logos are present.
- Starter surface cards use icon, name, summary, and bullet highlights in a responsive 2-column grid.
- Text must fit at desktop and narrower workbench widths without clipping or incoherent overlap.
- macOS: Goal workspace title area must clear traffic lights (adequate top-bar padding / `mac-native` handling).

## Anti-patterns (flag as P1)

- Left progress rail or starter-surface side card
- **Exclusive step tabs**, sticky outline nav (`Goal | Brand | Surfaces | Generate`), or page hero header copy above the builder
- Six-topic **Context** rows or **Notes for the agent** textarea in the builder
- Save Draft / Generate Surfaces bulk action buttons
- Read-only goal summary when the design calls for editable business name/description
- Missing brand section (logo upload + color pickers)
- Landing callout missing steps or starter-surface chips when no project is open
- Surfaces grid showing fewer than eight starters (excluding the New Surface card)

## Evaluation Workflow

1. Locate the relevant implementation.
   - Start with `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts`.
   - Search for `custom-mode-callout`, `createGoalWorkspaceLandingCallout`, `custom-mode-ui-surface-setup`, `custom-mode-ui-surface-brand-dropzone`, `uiSurfaceSetup`, `surface-builder-handoff`, `STARTER_SURFACES`, and `ADD_SURFACE_ID`.
   - Include CSS embedded in TypeScript and `src/custom/goalWorkspace/goalWorkspaceSurfaceSetup.ts`.

2. Inspect the actual UI when feasible.
   - **No project**: verify landing callout copy, steps, surface chips, and CTA.
   - **With project + Add Surface**: verify builder sections, surface grid, and handoff.
   - If a running workbench or screenshot is available, inspect it directly.
   - If no runtime is available, evaluate DOM construction, class names, layout CSS, and copy.

3. Compare implementation to the Target Design.
   - Check landing first (no-project callout).
   - Check builder layout: no left rail, single scroll column, no sticky outline or page hero.
   - Check content: editable goal, brand assets, full surfaces grid + New Surface card.
   - Check interaction: autosave (no manual save buttons), per-surface handoff, business-name guard.
   - Check visual quality: density, spacing, hierarchy, VS Code theme usage, responsive behavior.

4. Score the implementation.
   - `0`: Not implemented or still resembles the original static setup.
   - `1`: Some copy/content exists, but layout is materially wrong.
   - `2`: Main design direction recognizable, but key structural pieces are missing.
   - `3`: Mostly matches with several polish or responsiveness gaps.
   - `4`: Strong match with minor nits.
   - `5`: Faithful, shippable implementation of the approved design.

## Report Format

Lead with findings, ordered by severity. Use file and line references when code is available.

For each finding include:

- Severity: `P0` blocking, `P1` major design mismatch, `P2` meaningful polish/usability gap, `P3` nit.
- Evidence: screenshot observation or code reference.
- Expected: the target-design requirement.
- Recommendation: concrete fix.

Then include:

- Overall score out of 5.
- What matches well.
- Highest-leverage next changes.
- Validation performed and any gaps, such as no running UI or no screenshot.

Keep the report concise and actionable. Do not implement fixes unless the user explicitly asks for implementation after the evaluation.

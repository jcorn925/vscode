---
name: ui-tab-design-evaluator
description: Evaluate whether the VS Code custom goal-workspace UI tab implementation matches the approved no-left-column Guided Builder design. Use when reviewing, auditing, scoring, or validating code, screenshots, or running UI for `ModeShellContribution`, `custom-mode-ui-surface-setup`, the UI tab, goal workspace surface generation, context builder flows, or agent handoff/plan panels in this custom VS Code fork.
---

# UI Tab Design Evaluator

Evaluate the implemented UI tab against the approved design direction for the goal-workspace surface builder. This skill is a review workflow: gather evidence, compare against the target design, identify gaps, and produce prioritized findings.

## Target Design

The approved direction is **Guided Builder without the left column**.

Required structure:

- Keep the VS Code-like top workbench navigation: product/workspace title area, active `UI` tab, `Code` tab, `+ Add Surface`, and right utility actions when present.
- Remove the old left progress rail/column entirely. There should be no persistent left column with `Goal`, `Context`, `Surfaces`, `Generate`, and no starter-surface side card.
- Use a compact horizontal stepper or progress strip near the top of the main content with `Goal`, `Context`, `Surfaces`, `Generate`; the active state should make the current step clear.
- Expand the main builder content into the space freed by the removed left rail.
- Preserve a two-zone layout: main builder content on the left/middle and a right `Agent Plan` panel.
- Main builder content should include `Build Goal Workspace`, goal summary, `Online Personal Training Business`, north-star metric `active_paid_clients`, context rows, notes for agent, `Save Draft`, and `Generate Surfaces`.
- Context rows should include `Customer & Pain`, `Offers & Pricing`, `Booking Flow`, `Payments`, `Acquisition`, and `Analytics`, each with an icon or affordance, concise prompt text, status, and action.
- Right `Agent Plan` should group what will be generated: `Workspace definition`, `Applications (apps/)`, `Shared domain`, `Ix metadata`, and `What happens next`.
- Starter surfaces should be a compact inline action near the surfaces/progress area or below the context list, not a dominant row of equal-weight buttons and not a left-side card.

Visual expectations:

- Native VS Code dark workbench feel: compact, mature, productivity-oriented, no marketing page composition.
- Use VS Code theme colors where possible (`var(--vscode-...)`), with subtle borders, restrained blue accents, and semantic status indicators.
- Prefer rows, separators, grouped panels, and compact status pills over heavy nested cards.
- Avoid decorative gradients, oversized hero treatment, giant empty canvas, browser/device chrome, and one-off ornamental UI.
- Text must fit at desktop and narrower workbench widths without clipping or incoherent overlap.

## Evaluation Workflow

1. Locate the relevant implementation.
   - Start with `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts`.
   - Search for `custom-mode-ui-surface-setup`, `uiSurfaceSetup`, `Agent Plan`, `Build Goal Workspace`, `Create first surface`, `STARTER_SURFACES`, and `ADD_SURFACE_ID`.
   - Include CSS embedded in TypeScript and any adjacent style files.

2. Inspect the actual UI when feasible.
   - If a running workbench or screenshot is available, inspect it directly.
   - If the user provides a screenshot, use it as visual evidence.
   - If no runtime is available, evaluate DOM construction, class names, layout CSS, and copy.

3. Compare implementation to the Target Design.
   - Check layout first: no left rail, horizontal stepper, expanded main content, right plan panel.
   - Check content second: required sections, labels, CTAs, context rows, and agent plan groups.
   - Check interaction affordances third: status visibility, actions, starter suggestions placement, handoff clarity.
   - Check visual quality last: density, spacing, hierarchy, VS Code theme usage, responsive behavior.

4. Score the implementation.
   - `0`: Not implemented or still resembles the original awful static setup.
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

---
name: workbench-feature-runtime-evaluator
description: Evaluate whether a VS Code/GoalConsole workbench feature actually works at runtime, with screenshot proof, console/runtime evidence, DOM checks, and prioritized findings. Use when auditing blank screens, broken workbench startup, generated surface previews, goal-workspace UI flows, or any feature whose correctness depends on the running Electron workbench.
---

# Workbench Feature Runtime Evaluator

Evaluate a feature in the running GoalConsole/VS Code workbench using real runtime evidence. This skill is for proving whether a feature works, not just whether code looks plausible.

Always include screenshots as evidence when a UI can run. A report without screenshots is incomplete unless launch is impossible; in that case, explain exactly what blocked screenshot capture.

## Scope

Use this skill for:

- Blank or partially rendered workbench windows.
- Goal-workspace builder/runtime flows.
- Generated surface previews and tabs.
- Ix validation UI, task-tree UI, repair loop UI, and surface handoff flows.
- Any feature where DOM state, console errors, rendered pixels, or user-visible behavior determine correctness.

If the request is purely static design compliance, use `ui-tab-design-evaluator` instead. If it is blueprint/verifier logic without runtime UI, use `surface-blueprint-evaluator` or `agent-task-tree-evaluator`.

## Evidence Requirements

Capture and save artifacts under a timestamped folder such as:

`screenshots/runtime-eval-YYYYMMDD-HHMMSS/`

Required artifacts:

- At least one full-window screenshot for each evaluated state.
- A screenshot after each critical interaction or state transition.
- Browser console/runtime exceptions captured from CDP or Playwright.
- The active target URL and page title.
- DOM health checks: `document.readyState`, body text length, visible workbench root dimensions, and key selectors.
- Process/log references: launch command, CDP port, app PID, and relevant log tail.

For blank-screen investigations, include:

- Screenshot of the blank state.
- Console exceptions after reload with runtime listeners attached.
- Network/resource failures if available.
- DOM summary proving whether the workbench root exists but is empty, hidden, or failed before mount.

## Runtime Workflow

1. **Orient**
   - Record branch, dirty files, and the exact feature under test.
   - Identify expected user-visible behavior and at least 3 acceptance checks.
   - If the user provided a screenshot, treat it as an input artifact and compare against a fresh screenshot.

2. **Launch or attach**
   - Prefer the repo launch skill when available: `.agents/skills/launch/SKILL.md`.
   - Use a short temp root on macOS (`TMPDIR=/tmp` or `/tmp/gc`) to avoid IPC socket path length failures.
   - If an app is already running, attach to its CDP endpoint instead of launching a duplicate.
   - Record PID, CDP port, user data dir, workspace path, and log path.

3. **Capture first-frame evidence**
   - Capture a screenshot before interacting.
   - Read CDP target list and choose the workbench page, not `about:blank` or a webview.
   - Capture:
     - URL and title.
     - `document.readyState`.
     - body text sample and length.
     - `document.body.getBoundingClientRect()`.
     - visible dimensions for `.monaco-workbench`, `.part.editor`, `.custom-mode-shell`, or feature-specific roots.

4. **Capture console/runtime failures**
   - Attach console and exception listeners before reload when investigating startup failures.
   - Reload the workbench page once after listeners are attached.
   - Save exception text, stack, source URL, and timestamp.
   - Treat unresolved module specifiers, failed dynamic imports, syntax errors, and top-level promise rejections as P0 until proven harmless.

5. **Exercise the feature**
   - Perform the smallest realistic flow the user cares about.
   - Capture a screenshot after each meaningful transition.
   - Check visible text and controls, not only DOM existence.
   - For generated surfaces, verify preview loads actual app content, not a placeholder, blank iframe, error page, or static shell.

6. **Score**
   - `0`: Cannot launch or attach; no runtime proof.
   - `1`: Workbench launches but feature is blank or blocks the primary flow.
   - `2`: Feature renders partially but primary flow fails or critical evidence is missing.
   - `3`: Primary flow works with visible defects, console errors, or missing states.
   - `4`: Works end to end with minor UI/robustness issues.
   - `5`: Shippable runtime behavior with clean console, stable screenshots, and complete acceptance checks.

## Blank Screen Triage

When the screenshot is an empty/dark workbench window:

1. Capture the current page screenshot and CDP target list.
2. Evaluate the following in the workbench page:
   - `location.href`
   - `document.readyState`
   - `document.body.innerText.slice(0, 1000)`
   - `document.querySelector('.monaco-workbench')?.getBoundingClientRect().toJSON?.()`
   - `Array.from(document.scripts).map(s => s.src || s.textContent?.slice(0, 80))`
3. Attach runtime listeners, reload once, and capture:
   - `Runtime.exceptionThrown`
   - `Log.entryAdded`
   - `Console.messageAdded` or equivalent Playwright console events
4. Search changed files for browser-side static imports of Node-only modules:
   - `child_process`, `fs`, `path`, `net`, `os`, `process`, Electron main-only APIs
   - Imports from `/node/`, `/electron-main/`, or services that register Node process behavior
5. Check whether the app was launched with the correct app root. On macOS LaunchServices, the first app argument must be the absolute repo root, not `.`.

## Report Format

Lead with findings, ordered by severity.

For each finding include:

- Severity: `P0` blocking, `P1` major runtime break, `P2` meaningful defect, `P3` nit.
- Evidence: screenshot path, console/log excerpt, or DOM observation.
- Expected: the feature behavior that should have happened.
- Recommendation: concrete next fix or diagnostic.

Then include:

- Overall score out of 5.
- Screenshots captured, with paths.
- Acceptance checks passed/failed.
- Console/runtime errors.
- Commands run and validation gaps.

Do not claim a feature works without screenshot proof and a clean-enough console/runtime check. Do not implement fixes unless the user asks for fixes or the current task explicitly includes repair.

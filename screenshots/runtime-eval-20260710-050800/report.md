# Workbench Feature Runtime Evaluation

## Findings

### P0 - Workbench reloads to a fully blank renderer

Evidence:

- Screenshot: `screenshots/runtime-eval-20260710-050800/02-after-reload.png`
- DOM after reload:
  - `document.readyState`: `complete`
  - `document.body.innerText.length`: `0`
  - `.monaco-workbench`: `null`
  - `.part.editor`: `null`
  - `.custom-mode-shell`: `null`
- Runtime error:
  - `TypeError: Failed to fetch dynamically imported module: vscode-file://vscode-app/Users/jasoncornell/vscode/out/vs/workbench/workbench.desktop.main.js`

Expected:

The Electron workbench should mount `.monaco-workbench`, show workbench chrome, and render the custom workspace/surface UI.

Recommendation:

Treat this as a workbench bootstrap failure, not a feature-level rendering bug. The next fix should target the generated `out/` bootstrap/module output so `workbench.desktop.main.js` and its transitive imports load successfully.

### P0 - CSS assets are being loaded as JavaScript module scripts

Evidence:

- Runtime events repeatedly report:
  - `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/css".`
- Example failing module URLs:
  - `out/vs/workbench/browser/actions/media/actions.css`
  - `out/vs/workbench/browser/parts/banner/media/bannerpart.css`
  - `out/vs/workbench/browser/parts/statusbar/media/statusbarpart.css`
- `out/vs/workbench/workbench.desktop.main.js` exists, but its module graph rejects during evaluation.

Expected:

CSS side-effect imports should be handled by the workbench CSS loader/build pipeline, not fetched as JavaScript ESM modules.

Recommendation:

Inspect the compile/dev output path that generates `out/vs/workbench/*.js`. The runtime is seeing raw CSS imports in the ESM graph. Verify whether the current app launch expects a bundled build, a loader transform, or a generated aggregate CSS artifact.

### P1 - Aggregate workbench CSS artifact referenced by bootstrap is missing

Evidence:

- Runtime event:
  - `Failed to load resource: net::ERR_FILE_NOT_FOUND`
  - URL: `vscode-file://vscode-app/Users/jasoncornell/vscode/out/vs/workbench/workbench.desktop.main.css`
- Filesystem check:
  - `out/vs/workbench/workbench.desktop.main.js` exists
  - `out/vs/workbench/workbench.desktop.main.css` does not exist

Expected:

If `workbench.html`/bootstrap references `workbench.desktop.main.css`, the build should emit it or the bootstrap should not reference it in this dev mode.

Recommendation:

Check whether `npm run compile-client` is sufficient for this app launch mode. If this fork now requires a CSS bundling task or `npm run compile`/watch path, update the launch workflow and/or build scripts so the expected CSS artifact is produced.

## Score

Runtime score: **1 / 5**

The app process and a CDP target exist, but the workbench is blank after reload and the primary UI cannot be evaluated. This blocks validation of the feature itself.

## Screenshots

- `screenshots/runtime-eval-20260710-050800/01-before-reload.png`
- `screenshots/runtime-eval-20260710-050800/02-after-reload.png`

## Captured Artifacts

- `screenshots/runtime-eval-20260710-050800/evidence.json`
- `screenshots/runtime-eval-20260710-050800/console-events.json`

## Acceptance Checks

- Workbench CDP target exists: **pass**
- `.monaco-workbench` mounted: **fail**
- Body contains visible text: **fail**
- Custom workspace shell mounted: **fail**
- Console/runtime clean enough to proceed: **fail**

## Commands / Context

- Attached to live renderer on CDP port `59126`.
- Runtime page URL: `vscode-file://vscode-app/Users/jasoncornell/vscode/out/vs/code/electron-browser/workbench/workbench.html`
- Main PID: `25103`
- Renderer PID observed: `57900`

Validation gap:

The launch-skill isolated process on CDP port `65130` exited before screenshot capture. The successful capture used the existing live renderer on port `59126`.

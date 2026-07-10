---
name: new-surface-import-repo-evaluator
description: Evaluate whether this VS Code fork correctly implemented the New Surface action extension that lets users either create a generated surface or import a repo/local folder as a goal workspace surface. Use when auditing, reviewing, scoring, QAing, or validating the New Surface import repo feature, including mode shell UI flow, workspace.goal.json manifest upserts, Git clone/local folder import behavior, and tests.
---

# New Surface Import Repo Evaluator

## Goal

Evaluate how well the implementation matches the approved plan: clicking **New Surface** should offer **Create New Surface** or **Import Repo**; create preserves the existing scaffold flow; import supports both Git URL clone into `apps/<surface-id>` and registering an existing workspace-contained folder as a surface.

## Evaluation Workflow

1. Inspect the current repo state before judging.
   - Run `git status --short`.
   - Read the relevant code, usually:
     - `src/vs/workbench/contrib/custom/browser/modeShell.contribution.ts`
     - `src/custom/goalWorkspace/goalWorkspaceSurfaceSetup.ts`
     - `src/vs/workbench/contrib/custom/browser/test/goalWorkspaceSurfaceSetup.test.ts`
   - Use `rg` for symbols such as `showNewSurfaceActionPicker`, `importSurfaceRepo`, `upsertImportedGoalWorkspaceSurface`, `_git.cloneRepository`, and `showOpenDialog`.

2. Score implementation against the plan.
   - **New Surface branch UI**: New Surface shows a choice; Create New Surface calls the existing `draftNewSurfacePrompt()` path unchanged.
   - **Import source choices**: Import Repo offers Git URL clone and existing folder registration.
   - **Git URL import**: prompts for repo URL, surface name, optional dev command, optional local URL; clones to `apps/<surface-id>` using `_git.cloneRepository`; avoids overwriting an existing target folder.
   - **Existing folder import**: uses `IFileDialogService.showOpenDialog`; accepts only folders inside the current workspace; rejects workspace root, absolute external paths, and parent traversal.
   - **Manifest helper**: exported helper upserts `workspace.goal.json` with `id`, `name`, `type`, `path`, `purpose`, optional `devCommand`, optional `localUrl`, and empty metadata arrays for new imports; preserves existing unrelated fields on re-import.
   - **Post-import behavior**: refreshes `IConsoleService`, updates surface tabs/card/checklist state, selects the imported surface, and does not create blueprints, task trees, generated app files, or `.agent/surfaces/*.blueprint.json`.
   - **Validation**: tests cover add, update preserving fields, absolute path rejection, parent traversal rejection, and existing scaffold regressions.

3. Run validation commands when feasible.
   - `npm run compile`
   - `./scripts/test.sh --grep goalWorkspaceSurfaceSetup`
   - `./scripts/test.sh --grep surfaceBlueprintVerify`
   - `git diff --check`
   - If runtime proof is requested, launch the workbench and manually exercise:
     - New Surface -> Create New Surface
     - New Surface -> Import Repo -> Use Existing Folder
     - New Surface -> Import Repo -> Clone from Git URL

4. Report with evidence.
   - Lead with findings ordered by severity, each with file/line references.
   - Include a score from 0-10:
     - 9-10: Plan is implemented with tests and no material gaps.
     - 7-8: Core behavior works, but minor UX/test/runtime gaps remain.
     - 5-6: Partial implementation with notable missing plan items.
     - 0-4: Feature is mostly absent or unsafe.
   - Include validation commands and pass/fail status.
   - Note any unverified runtime behavior separately from code/test evidence.

## Common Failure Modes

- New Surface directly opens the old prompt without a Create/Import choice.
- Import writes absolute paths into `workspace.goal.json`, which the manifest parser rejects.
- Existing folder import accepts a folder outside the workspace.
- Git import registers the surface before clone success or overwrites an existing `apps/<surface-id>` folder.
- Imported surfaces trigger scaffold/blueprint/task-tree generation, which is out of scope for v1.
- Re-importing a surface deletes existing metadata such as capabilities, events, entities, Ix fields, or custom fields.
- Tests only cover the manifest helper and miss the old scaffold-flow regression.

## Output Shape

Use this structure:

```markdown
**Findings**
- [P1/P2/P3] Finding title — file:line
  Explain impact and evidence.

**Score**
N/10, with one sentence explaining why.

**Validation**
- command — result

**Residual Risk**
Briefly list runtime or UX behavior not directly verified.
```

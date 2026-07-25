---
name: merge-upstream
description: "Merge microsoft/vscode upstream changes into this fork while preserving the fork's de-branding (no hardcoded GitHub Copilot strings), custom code under src/custom and contrib/custom, and extra dependencies. Use when asked to merge upstream, sync the fork, pull in upstream VS Code changes, or resolve merge conflicts against upstream/main."
---

# Merge Upstream VS Code into the Fork

This fork tracks `microsoft/vscode` (`upstream` remote) and carries ~100+ commits of its own:
custom workbench code (`src/custom/`, `src/vs/workbench/contrib/custom/`), extra npm
dependencies, build tweaks, and a **de-branding layer** that replaces hardcoded
"GitHub Copilot" strings with the product-configured provider name.

Target cadence: merge every 2-4 weeks. Longer gaps turn 3-line re-applies into archaeology,
because upstream churns exactly the areas the fork lightly touches (chat, sessions, pickers).

## Process

1. **Scout before merging** (no working-tree changes):
   ```sh
   git fetch upstream
   git merge-base HEAD upstream/main                 # how stale are we?
   git merge-tree --write-tree --name-only HEAD upstream/main   # in-memory trial merge
   ```
   The trial merge gives the exact conflict list up front. Report it before starting.

2. **Checkpoint the working tree.** Commit (or stash) any WIP first, including untracked
   files. Fork WIP often fails the hygiene hook (unicode chars, formatting) — a WIP
   checkpoint commit with `--no-verify` is acceptable; note the debt in the message.
   Watch for concurrent sessions editing the tree mid-merge: before every `git add -u`
   or commit, re-check `git status` for files you didn't change yourself, and never
   stage them into the merge.

3. **Merge on a branch**, e.g. `merge-upstream-YYYY-MM-DD`, then fast-forward `main`
   at the end (`git checkout main && git merge --ff-only <branch>`).

4. **Resolve conflicts** using the heuristics below.

5. **Lockfile ordering matters.** Resolve `package-lock.json` by taking upstream's side
   (`git checkout --theirs package-lock.json`), then run `npm install` to re-add the
   fork's dependencies — and **re-stage the lockfile after `npm install`**, or the merge
   commit ships a stale lockfile missing the fork's deps.

6. **Validate**, in order:
   - `npm run typecheck-client` (must be clean)
   - Recompile: `npm run compile-client` (unit tests load from `out/`)
   - Custom unit tests: `./scripts/test.sh --glob '**/custom/**/*.test.js'`
     (the glob must end in `*.test.js` — a bare directory glob matches the directory
     itself and fails with a bogus dynamic-import error)
   - Hygiene runs automatically in the pre-commit hook; fix findings, don't bypass
     them for the merge commit itself
   - `node build/checker/layersChecker.ts` if anything moved between layers
     (needs `NODE_OPTIONS=--max-old-space-size=8192` on this machine)
   - Compare test failures against pre-merge state before blaming the merge; the fork
     often has pre-existing failures from in-flight WIP.

## Branding policy (the fork's #1 invariant)

User-facing strings must never hardcode **"GitHub Copilot"** (or other provider brands).
The fork routes display names through:

- `src/vs/workbench/services/chat/common/chatBranding.ts` —
  `getDefaultChatProviderName()` reads `product.defaultChatAgent?.provider?.default?.name`
  and falls back to `'AI'`. It lives in the **services** layer so both services and
  contrib code may import it; do not move it back under `contrib/`.

When upstream adds or moves a branded string:

- Keep **upstream's code structure**, swap only the string:
  `localize('key', "Sign in to {0} ...", getDefaultChatProviderName())`.
- When upstream deletes a file the fork had de-branded (refactors), find where the
  string moved (`git grep <localize-key> upstream/main`) and re-apply there.
- Non-user-facing identifiers, telemetry values, protected-resource constants, and
  test fixtures may keep Copilot names — only *displayed* strings are de-branded.
- Settings descriptions that enumerate products (e.g. terminal agent-CLI lists): keep
  upstream's list but drop the "GitHub Copilot CLI" style mentions the fork removed.

## Resolution heuristics

- **Upstream structure + fork strings.** When both sides changed the same code, prefer
  upstream's refactor and re-apply the fork's intent (usually a string or a small hook)
  on top. Never keep a stale fork copy of a file upstream restructured.
- **Fork edits that exist only to work around stale packages are disposable.** Example:
  `@vscode/markdown-editor` feature removals made because an old npm version lacked
  exports — take upstream's side and let `npm install` pull the newer package.
- **Check suspicious fork deletions before honoring them.** If the fork removed a
  dependency or export that upstream code still references (`git grep`), the removal
  was likely accidental — restore it and note it in the merge commit.
- **Prefer upstream's extension points over fork hard-coding.** Upstream often grows a
  delegate/override API right where the fork had hardcoded divergent behavior; adopt
  the API instead of keeping the hardcoded block.
- Keep the fork's footprint on upstream-owned files minimal — every avoided
  modification is a conflict the next merge doesn't have.

## Known landmines

- **`.eslint-allowed-javascript-files`**: upstream's hygiene bans JS files not on this
  allowlist. Fork-added `.js`/`.cjs`/`.mjs` files (e.g. `examples/reference-app/`) must
  be listed there, alphabetically.
- **Duplicate `localize` keys**: hygiene rejects the same key with different message
  values across code paths — a classic symptom of an auto-merge keeping both upstream's
  and the fork's copy of a label block. Fix the code duplication, don't rename the key.
- **Layering**: `src/vs/workbench/services/**` must not import from
  `src/vs/workbench/contrib/**`. Auto-merges can silently combine imports that violate
  this; hygiene's `code-import-patterns` catches it on commit.
- **Node version bumps**: upstream raises `.nvmrc` regularly; `npm install` fails its
  preinstall check on an older Node. `nvm install && nvm use` before debugging anything
  else. Background/CI shells may resolve a different Node than your interactive shell.
- **Husky pre-commit is slow but load-bearing** on a merge this size; let it run for the
  merge commit. `--no-verify` is reserved for WIP checkpoints of pre-existing debt.

## Merge commit message

List every conflicted file and how it was resolved (which side won and why), plus any
latent fork bugs the merge surfaced. Today's future reader is the person running the
next merge.

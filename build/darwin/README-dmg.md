# macOS DMG packaging (unsigned)

The DMG is produced by [create-dmg.ts](create-dmg.ts) using Python [dmgbuild](https://github.com/dmgbuild/dmgbuild) (vendored into `build/darwin/.dmgbuild/` on first run; that directory is gitignored).

## Quick path

From the repository root, after a successful client build:

```sh
npm run gulp vscode-darwin-arm64-min   # or vscode-darwin-x64-min on Intel
npm run darwin-dmg
```

Or run [scripts/create-dmg.sh](../../scripts/create-dmg.sh) directly; see the script header for `VSCODE_ARCH`, `VSCODE_QUALITY`, and `SKIP_PATCH_DMG`.

## Layout

- Gulp writes the app under **`<parent-of-repo>/VSCode-darwin-<arch>/`** (sibling of the clone), e.g. `../VSCode-darwin-arm64/Code - OSS.app`.
- `create-dmg.ts` is invoked with that parent directory as the first argument and an output directory as the second.

## Background image

- **Per-quality:** `dmg-background-<quality>.tiff` (e.g. `VSCODE_QUALITY=stable`).
- **Fallback:** [dmg-background.tiff](dmg-background.tiff) (neutral 480×352 placeholder).

## Signing / notarization

Not covered here. For distribution outside a small team, plan Apple code signing and notarization on the `.app` and/or the `.dmg`.

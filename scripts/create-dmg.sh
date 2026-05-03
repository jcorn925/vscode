#!/usr/bin/env bash
#
# Build a macOS DMG from an existing gulp-packaged client (unsigned).
#
# Prerequisites:
#   1. macOS with Python 3.10+ (see build/darwin/create-dmg.ts — may install Homebrew Python).
#   2. git (clones dmgbuild into build/darwin/.dmgbuild on first run).
#   3. Run the desktop client build first, e.g.:
#        npm run gulp vscode-darwin-arm64-min
#      This creates ../VSCode-darwin-<arch>/ next to this repo (sibling folder).
#
# Environment (optional):
#   VSCODE_ARCH   arm64 | x64 (default: inferred from uname -m)
#   VSCODE_QUALITY  oss | stable | insider | exploration (default: oss)
#                   Affects DMG window title; background image resolves to
#                   build/darwin/dmg-background-${quality}.tiff if present, else
#                   build/darwin/dmg-background.tiff
#   SKIP_PATCH_DMG  if set to 1, skip python3 build/darwin/patch-dmg.py (volume icon)
#
# Usage:
#   ./scripts/create-dmg.sh [OUTPUT_DIR]
#   OUTPUT_DIR defaults to <repo>/.build/darwin-dmg
#
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "create-dmg.sh is macOS-only." >&2
	exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_PARENT="$(dirname "$ROOT")"

ARCH="${VSCODE_ARCH:-}"
if [[ -z "$ARCH" ]]; then
	case "$(uname -m)" in
		arm64) ARCH=arm64 ;;
		x86_64) ARCH=x64 ;;
		*)
			echo "Unsupported machine: $(uname -m). Set VSCODE_ARCH to arm64 or x64." >&2
			exit 1
			;;
	esac
	export VSCODE_ARCH="$ARCH"
fi

export VSCODE_QUALITY="${VSCODE_QUALITY:-oss}"

CLIENT_DIR="${BUILD_PARENT}/VSCode-darwin-${ARCH}"
if [[ ! -d "$CLIENT_DIR" ]]; then
	echo "Packaged client not found: $CLIENT_DIR" >&2
	echo "Build it first from repo root, e.g.: npm run gulp vscode-darwin-${ARCH}-min" >&2
	exit 1
fi

OUT_DIR="${1:-"$ROOT/.build/darwin-dmg"}"
mkdir -p "$OUT_DIR"

echo "Creating DMG..."
echo "  Repo:           $ROOT"
echo "  Build parent:   $BUILD_PARENT (expects VSCode-darwin-${ARCH} here)"
echo "  VSCODE_ARCH:    $VSCODE_ARCH"
echo "  VSCODE_QUALITY: $VSCODE_QUALITY"
echo "  Output dir:     $OUT_DIR"

node "$ROOT/build/darwin/create-dmg.ts" "$BUILD_PARENT" "$OUT_DIR"

DMG_PATH="$OUT_DIR/VSCode-darwin-${ARCH}.dmg"
if [[ ! -f "$DMG_PATH" ]]; then
	echo "Expected DMG missing: $DMG_PATH" >&2
	exit 1
fi

if [[ "${SKIP_PATCH_DMG:-}" != "1" ]]; then
	DISK_ICNS="$ROOT/resources/darwin/disk.icns"
	if [[ -f "$DISK_ICNS" ]]; then
		echo "Patching DMG volume icon..."
		python3 "$ROOT/build/darwin/patch-dmg.py" "$DMG_PATH" "$DISK_ICNS"
	else
		echo "No disk.icns at $DISK_ICNS — skipping patch-dmg.py" >&2
	fi
fi

echo "Done: $DMG_PATH"

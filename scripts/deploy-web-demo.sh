#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
#---------------------------------------------------------------------------------------------

# Build and deploy the hosted read-only web demo of the IDE.
#
#   ./scripts/deploy-web-demo.sh              build + stage + deploy to Vercel production
#   ./scripts/deploy-web-demo.sh --skip-build stage + deploy from the existing ../vscode-web bits
#   ./scripts/deploy-web-demo.sh --no-deploy  build + stage only (serve .build/web-demo-site to test)
#
# Pipeline:
#   1. compile-build-without-mangling  (the mangler rejects pre-existing fork debt in sessions/)
#   2. vscode-web-min-ci               (emits static web bits to ../vscode-web)
#   3. stage into .build/web-demo-site: prune heavy extensions and sourcemaps, add the demo
#      host page and the read-only gcdemo file system extension with the example workspace
#      data inlined (the web extension host loads a single module only)
#   4. vercel deploy --prod            (project link comes from docs/web-demo/vercel-project.json)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS="$ROOT/docs/web-demo"
BITS="$ROOT/../vscode-web"
STAGE="$ROOT/.build/web-demo-site"

SKIP_BUILD=0
NO_DEPLOY=0
for arg in "$@"; do
	case "$arg" in
		--skip-build) SKIP_BUILD=1 ;;
		--no-deploy) NO_DEPLOY=1 ;;
		*) echo "Unknown argument: $arg" >&2; exit 1 ;;
	esac
done

if [ "$SKIP_BUILD" = "0" ]; then
	echo "==> Building static web bits (this can take a few minutes)"
	(cd "$ROOT" && npm run gulp compile-build-without-mangling)
	(cd "$ROOT" && npm run gulp vscode-web-min-ci)
fi

if [ ! -f "$BITS/out/vs/code/browser/workbench/workbench.js" ]; then
	echo "Error: $BITS is missing the browser boot shell; run without --skip-build" >&2
	exit 1
fi

echo "==> Staging demo site at $STAGE"
mkdir -p "$STAGE"
rsync -a --delete \
	--exclude "extensions/mermaid-markdown-features" \
	--exclude "extensions/markdown-language-features" \
	--exclude "extensions/markdown-math" \
	--exclude "extensions/latex" \
	--exclude "*.map" \
	"$BITS/" "$STAGE/"

cp "$ASSETS/index.html" "$ASSETS/vercel.json" "$STAGE/"
mkdir -p "$STAGE/demo-ext" "$STAGE/.vercel"
cp "$ASSETS/demo-ext/package.json" "$ASSETS/demo-ext/package.nls.json" "$STAGE/demo-ext/"
cp "$ASSETS/vercel-project.json" "$STAGE/.vercel/project.json"

echo "==> Inlining example workspace data into the demo extension"
node -e '
const fs = require("fs"), path = require("path");
const [assets, stage] = process.argv.slice(1);
const root = path.join(assets, "example-workspace");
const files = {};
(function walk(dir, rel) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, e.name), r = rel ? rel + "/" + e.name : e.name;
		if (e.isDirectory()) { walk(abs, r); } else { files[r] = fs.readFileSync(abs).toString("base64"); }
	}
})(root, "");
const src = fs.readFileSync(path.join(assets, "demo-ext", "extension.js"), "utf8");
const marker = /const data = require\(.\.\/data\.js.\); \/\/ BUILD->INLINE_DEMO_DATA/;
if (!marker.test(src)) { throw new Error("inline marker not found in extension.js"); }
fs.writeFileSync(path.join(stage, "demo-ext", "extension.js"),
	src.replace(marker, "const data = " + JSON.stringify(files) + ";"));
console.log("    " + Object.keys(files).length + " files inlined");
' "$ASSETS" "$STAGE"

if [ "$NO_DEPLOY" = "1" ]; then
	echo "==> Staged only. Test with: (cd $STAGE && python3 -m http.server 8090)"
	exit 0
fi

echo "==> Deploying to Vercel production"
(cd "$STAGE" && npx -y vercel deploy --prod --yes)

## `swc_plugin_vscode_ui_src`

SWC (WASM) transform plugin for Next.js that injects `data-vscode-src="path:line:col"` onto native JSX tags.

### Build

Rust 1.95+ uses `wasm32-wasip1` (the old `wasm32-wasi` target was removed).

```bash
cd /Users/macbookuser/vscode/src/custom/next/swc-plugin-vscode-ui-src
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
```

Output:

- `target/wasm32-wasip1/release/swc_plugin_vscode_ui_src.wasm`

### Next.js config

In your Next app’s `next.config.js`:

```js
const path = require('path');

module.exports = {
  experimental: {
    swcPlugins: [
      [
        // Use an absolute path to the .wasm, or ship it in your repo/package.
        path.join(__dirname, 'path/to/swc_plugin_vscode_ui_src.wasm'),
        { workspaceRoot: __dirname, attributeName: 'data-vscode-src' },
      ],
    ],
  },
};
```


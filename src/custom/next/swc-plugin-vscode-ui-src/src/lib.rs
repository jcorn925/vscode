//! Next.js SWC plugin: inject `data-vscode-src` onto JSX elements.
//!
//! Intended for use with Next's `experimental.swcPlugins` (WASM plugins).
//! The attribute value is `relative/path:line:col` (1-based) to line up with the
//! embedded UI click overlay in VS Code.
//!
//! Example `next.config.js`:
//!
//! ```js
//! const path = require('path');
//!
//! /** @type {import('next').NextConfig} */
//! const nextConfig = {
//!   experimental: {
//!     swcPlugins: [
//!       [
//!         path.join(__dirname, 'swc-plugin-vscode-ui-src.wasm'),
//!         { workspaceRoot: __dirname, attributeName: 'data-vscode-src' },
//!       ],
//!     ],
//!   },
//! };
//!
//! module.exports = nextConfig;
//! ```
//!
//! Build (Rust 1.95+):
//!
//! ```bash
//! rustup target add wasm32-wasip1
//! cargo build --release --target wasm32-wasip1
//! # output: target/wasm32-wasip1/release/swc_plugin_vscode_ui_src.wasm
//! ```

use serde::Deserialize;
use swc_core::{
    common::{plugin::metadata::TransformPluginMetadataContextKind, SourceMapper, Span},
    ecma::{
        ast::*,
        visit::{VisitMut, VisitMutWith},
    },
    plugin::{
        metadata::TransformPluginProgramMetadata,
        plugin_transform,
    },
};

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    workspace_root: Option<String>,
    attribute_name: Option<String>,
}

fn is_native_jsx_tag(name: &str) -> bool {
    name.chars().next().map(|c| c.is_ascii_lowercase()).unwrap_or(false)
}

struct InjectVscodeSrc {
    attribute_name: String,
    filename: Option<String>,
    workspace_root: Option<String>,
    source_map: swc_core::plugin::proxies::PluginSourceMapProxy,
}

impl InjectVscodeSrc {
    fn make_value(&self, span: Span) -> String {
        let file = self.filename.as_deref().unwrap_or("unknown");
        let rel = if let Some(root) = self.workspace_root.as_deref() {
            // Very lightweight, string-based relpath to avoid extra deps.
            // This expects both strings to use `/` already (Next does on POSIX).
            let root_norm = root.trim_end_matches('/');
            if let Some(stripped) = file.strip_prefix(&format!("{root_norm}/")) {
                stripped.to_string()
            } else {
                file.to_string()
            }
        } else {
            file.to_string()
        };

        let loc = self.source_map.lookup_char_pos(span.lo());
        let line: u32 = loc.line as u32; // 1-based
        let col: u32 = (loc.col_display as u32) + 1; // convert to 1-based
        format!("{rel}:{line}:{col}")
    }

    fn has_attr(&self, attrs: &[JSXAttrOrSpread]) -> bool {
        attrs.iter().any(|a| match a {
            JSXAttrOrSpread::JSXAttr(attr) => match &attr.name {
                JSXAttrName::Ident(i) => i.sym.as_ref() == self.attribute_name,
                _ => false,
            },
            _ => false,
        })
    }
}

impl VisitMut for InjectVscodeSrc {
    fn visit_mut_jsx_opening_element(&mut self, n: &mut JSXOpeningElement) {
        n.visit_mut_children_with(self);

        let tag_name = match &n.name {
            JSXElementName::Ident(i) => i.sym.as_ref(),
            _ => return,
        };
        if !is_native_jsx_tag(tag_name) {
            return;
        }
        if self.has_attr(&n.attrs) {
            return;
        }

        let value = self.make_value(n.span);
        n.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: n.span,
            name: JSXAttrName::Ident(IdentName {
                span: n.span,
                sym: self.attribute_name.clone().into(),
            }),
            value: Some(JSXAttrValue::Str(Str {
                span: n.span,
                value: value.into(),
                raw: None,
            })),
        }));
    }
}

#[plugin_transform]
pub fn transform(mut program: Program, metadata: TransformPluginProgramMetadata) -> Program {
    let cfg: Config = metadata
        .get_transform_plugin_config()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    let attribute_name = cfg
        .attribute_name
        .unwrap_or_else(|| "data-vscode-src".to_string());

    let filename = metadata.get_context(&TransformPluginMetadataContextKind::Filename);

    let mut v = InjectVscodeSrc {
        attribute_name,
        filename,
        workspace_root: cfg.workspace_root,
        source_map: metadata.source_map,
    };

    program.visit_mut_with(&mut v);
    program
}


# Hosted Web Demo

Assets for the read-only, browser-hosted demo of the IDE at
[goalconsole-demo.vercel.app](https://goalconsole-demo.vercel.app).

Deploy with:

```sh
./scripts/deploy-web-demo.sh              # build + stage + deploy to production
./scripts/deploy-web-demo.sh --skip-build # reuse existing ../vscode-web bits
./scripts/deploy-web-demo.sh --no-deploy  # stage only, for local testing
```

Contents:

- `index.html` - host page; builds the workbench configuration for whatever origin
  serves it and opens the `gcdemo:/personal-training` workspace
- `demo-ext/` - built-in web extension registering the read-only `gcdemo:` file
  system provider; the deploy script inlines the example workspace data into
  `extension.js` at stage time (the web extension host loads a single module)
- `example-workspace/` - the personal-training example goal workspace that seeds
  the demo (no build artifacts, no local telemetry)
- `vercel.json`, `vercel-project.json` - deploy configuration and project link

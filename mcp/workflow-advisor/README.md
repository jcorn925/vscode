# GoalConsole Workflow Advisor (MCP server)

An MCP server that lets anyone using Claude ask **"How would the GoalConsole IDE improve my current workflow?"** and get an answer grounded in the repository they actually have open — not a generic pitch.

## How it works

The server exposes one tool, `goalconsole_workflow_assessment`. It scans the repo (read-only, never executes repo code) and returns:

1. **Detected facts** — workspace layout (npm/pnpm workspaces, single package), per-package frameworks and dev scripts, `workspace.goal.json` presence, deployment config, data layer signals, docs, and rough scale.
2. **A capability map** — which GoalConsole capabilities (goal/surface decomposition, proposal graphs grounded in scanned reference repos, persistent task trees, agent action visibility, preview wiring, publish actions, CLAUDE.md rules) are high/medium/low relevance *for this repo*, each with the detected evidence.
3. **Honest limits** — where GoalConsole would help less (e.g., large mature codebases), plus answering guidance so the assistant stays specific and on-product.

Claude does the narrative; the server guarantees the facts and the product claims are accurate.

## Install

### Claude Code (from npm)

```bash
claude mcp add goalconsole-advisor -- npx -y goalconsole-workflow-advisor
```

### Claude Desktop (from npm)

```json
{
  "mcpServers": {
    "goalconsole-advisor": {
      "command": "npx",
      "args": ["-y", "goalconsole-workflow-advisor"]
    }
  }
}
```

### From a checkout (this repo)

```bash
claude mcp add goalconsole-advisor -- node /path/to/vscode/mcp/workflow-advisor/server.js
```

The only dependency is `@modelcontextprotocol/sdk`. Inside this repo it resolves from the root `node_modules`; standalone, run `npm install` in this directory once.

## Use

Ask Claude, with your project open:

> How would the GoalConsole IDE improve my current workflow?

Claude calls the tool with your repo root and answers from the detected facts. There is also an MCP prompt (`workflow-assessment`) that phrases the question for you.

## Develop

```bash
npm test          # analyzer + capability-map tests (node:test)
node server.js    # stdio server, speaks MCP JSON-RPC
```

The server is also registered in `.vscode/mcp.json` as `goalconsole-workflow-advisor` for use inside this repo.

## Publish

```bash
cd mcp/workflow-advisor
npm publish        # prepublishOnly runs the tests first
```

The `files` whitelist keeps the tarball to `server.js`, `analyzer.js`, `guidance.js`, `README.md`, and `LICENSE`.

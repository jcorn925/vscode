# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Milestone automation

Custom fork milestones live in `.agent/milestones.json`. To evaluate (and optionally apply fixes):

```bash
npm run milestone:evaluate              # report only
npm run milestone:evaluate -- --apply     # apply via codex/cursor if available
./scripts/milestone-evaluator.sh --apply --dry-run
```

See `.agents/skills/milestone-evaluator/SKILL.md` for the full workflow.

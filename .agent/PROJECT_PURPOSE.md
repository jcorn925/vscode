# Project Purpose

This repository is a custom fork of Code - OSS focused on turning VS Code into a goal-oriented workspace for building, launching, and iterating on multi-surface products with agent assistance.

The fork keeps the strengths of VS Code as an editor and workbench, then adds opinionated product-building workflows on top: goal workspace manifests, startup readiness checks, app launch guidance, Ix CLI integration, custom mode surfaces, and a custom AI agent that understands cross-app planning and repo-local context.

## Product Thesis

Modern product work often spans more than one code surface. A single goal can involve a frontend, backend, automation, documentation, deployment setup, and design decisions. Traditional editor workflows expose those pieces as files and terminals, but they do not always preserve the user's higher-level intent.

This fork treats the user's goal as a first-class workspace object. The workbench should help the user understand what exists, what is ready, what needs to be launched, and how a change in one surface affects the others.

## Intended User Experience

The product should feel like VS Code for people building an outcome rather than only editing a repository. Users should be able to:

- Open or bootstrap a useful default project without unnecessary setup friction.
- Load a `workspace.goal.json` manifest that describes product surfaces and workflows.
- See readiness guidance for required tools such as Node, Docker, Ix, and local services.
- Launch and inspect app surfaces from guided UI flows.
- Ask a custom AI agent for help that is aware of the goal workspace and can plan across app boundaries.
- Keep product, process, and implementation context connected inside the workbench.

## Design Principles

- Preserve VS Code's architecture and extension patterns wherever possible.
- Prefer explicit goal and surface metadata over implicit assumptions about the repository.
- Make setup state visible and actionable instead of burying it in terminal output.
- Support agentic workflows without hiding the underlying files, commands, or evidence.
- Keep custom behavior isolated under `src/custom` or clearly named `src/vs/workbench/contrib/custom` contributions.
- Use milestone checks to keep the fork's product direction testable.

## Current Focus Areas

The active milestone set lives in `.agent/milestones.json` and currently emphasizes:

- Goal workspace manifests and planning.
- Startup setup guidance.
- App launch guidance for local product surfaces.
- Ix CLI integration for discovery and mapping workflows.
- Default project bootstrap behavior.
- Custom mode shell surfaces.
- AI branding decoupled from GitHub Copilot wording.
- A custom AI goal-workspace agent.
- TypeScript compile health for fork-specific sources.

## Success Criteria

This fork is succeeding when a user can move from intent to working product surface with less context loss than in a plain editor. The product should make project state legible, help the user launch and inspect real app surfaces, and allow AI assistance to reason about the whole goal workspace instead of only isolated files.

Implementation work should be judged by whether it strengthens that loop: define the goal, understand the surfaces, prepare the environment, launch the work, make a change, and verify the result.

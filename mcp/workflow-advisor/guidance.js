/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Curated, accurate descriptions of what Babadaba actually does. This is the
 * grounding that keeps assistant answers on-product instead of hallucinated.
 */
const CAPABILITIES = {
	goalDecomposition: 'Goal workspace decomposition: a business goal is formalized in workspace.goal.json and broken into "surfaces" (apps/services) with explicit purpose, capabilities, events, entities, and data schema — the workspace is organized around outcomes, not files.',
	groundedPlanning: 'Grounded planning with proposal graphs: before writing code, Babadaba scans real reference GitHub repos, maps their subsystems (Ix code-graph analysis), and derives a proposal graph for each surface. Plans come from proven architectures, not model imagination, and the proposed graph is later diffed against the real graph of what was actually built.',
	taskTrees: 'Persistent task trees: agent work is decomposed into a durable task tree (JSON state under .agent/) that survives restarts and supports resume, pause, retry, and skip per step — long builds are checkpointed, not one-shot prompts.',
	actionVisibility: 'Agent action visibility: every surface shows cards for its plan, graphs, schema, preview, and deployment, plus a live steps list and process notes with evidence — you can watch and steer what the agent is doing instead of reading a final diff.',
	previewWiring: 'Live preview wiring: each surface declares its dev command and local URL; Babadaba probes the dev server and embeds the running app next to the plan, so generated code is verified visually as it lands.',
	publishActions: 'One-click publish: built-in actions create the GitHub repo, push the workspace, and deploy surfaces to Vercel; the actions panel is extensible so teams can register their own workflow actions and views.',
	rules: 'Workspace rules: a CLAUDE.md agent agreement per workspace/surface keeps agent behavior consistent across sessions and team members.',
	fullIde: 'Full VS Code underneath: the guided goal/surface experience sits on a complete VS Code fork, so there is no capability cliff — drop to the Code tab any time.',
};

/** Map detected repo facts to the capabilities that would matter, with the evidence. */
export function buildCapabilityMap(facts) {
	const entries = [];
	const add = (capability, relevance, because) => entries.push({ capability: CAPABILITIES[capability], relevance, because });

	const appPackages = facts.packages.filter(pkg => pkg.devScript || pkg.frameworks.length);
	const names = list => list.map(pkg => pkg.dir).join(', ');

	switch (facts.classification) {
		case 'goal-workspace':
			add('taskTrees', 'high', `This is already a Babadaba workspace (surfaces: ${facts.goalWorkspace.surfaces.join(', ') || 'none yet'}); the assessment should focus on unused capabilities.`);
			break;
		case 'empty-or-early':
			add('goalDecomposition', 'high', `The repo has ${facts.scale.sourceFiles} source files — greenfield is Babadaba's strongest phase: state the goal, get surfaces proposed.`);
			add('groundedPlanning', 'high', 'Nothing is built yet, so planning from scanned reference repos replaces starting from a blank page.');
			break;
		case 'multi-app-monorepo':
			add('goalDecomposition', 'high', `The workspace already has multiple apps (${names(appPackages)}); these map one-to-one onto Babadaba surfaces, making the existing structure explicit and agent-legible.`);
			add('actionVisibility', 'high', 'With several apps in flight, per-surface cards and step lists show which app each agent action touches.');
			break;
		case 'single-app':
			add('goalDecomposition', 'medium', `A single app (${names(appPackages) || facts.packages[0]?.dir}) often hides multiple surfaces (marketing, product, admin); Babadaba would propose that decomposition when the next surface is added.`);
			add('groundedPlanning', 'high', 'New features and surfaces get planned from reference architectures instead of ad-hoc prompting.');
			break;
		default:
			add('groundedPlanning', 'medium', 'For a library/tool repo, proposal graphs help most when adding companion apps (docs site, playground, dashboard) around it.');
	}

	if (facts.classification !== 'goal-workspace') {
		add('taskTrees', 'high', 'Any multi-step agent build here would be checkpointed and resumable instead of living in one chat transcript.');
		add('actionVisibility', 'high', 'Applies to any repo: agent work becomes observable steps with evidence rather than a wall of diffs.');
	}

	const devServers = facts.packages.filter(pkg => pkg.devScript);
	if (devServers.length) {
		add('previewWiring', 'high', `Detected dev scripts in ${names(devServers)} — Babadaba would probe and embed these next to each surface's plan.`);
	}

	if (!facts.deploy.vercel && !facts.deploy.netlify && !facts.deploy.githubActions) {
		add('publishActions', 'high', 'No deployment config detected (no vercel.json/netlify.toml/CI workflows) — publish-to-GitHub/Vercel actions would close that gap without setup.');
	} else {
		add('publishActions', 'low', 'Deployment is already wired up; Babadaba publish actions would mostly add per-surface convenience.');
	}

	if (!facts.docs.readme || facts.docs.readmeBytes < 500) {
		add('rules', 'medium', 'Little written project context detected — a CLAUDE.md agent agreement would capture conventions agents should follow.');
	}

	add('fullIde', 'medium', 'Whatever the workflow, there is no capability cliff: the full VS Code editor remains available.');
	return entries;
}

/** Honest limits — where Babadaba would help less. Credibility is the point. */
export function buildCaveats(facts) {
	const caveats = [];
	if (facts.scale.sourceFiles > 3000 || facts.scale.capped) {
		caveats.push('This is a large, established codebase. Babadaba is strongest for the zero-to-one phase and for making new agent-built work legible; it will not restructure a mature repo, and day-to-day editing here would feel like VS Code plus goal tooling, not a transformation.');
	}
	if (facts.classification === 'library-or-tool') {
		caveats.push('This repo looks like a library or tool rather than a user-facing product; surface decomposition and live previews matter less here.');
	}
	if (facts.classification === 'goal-workspace') {
		caveats.push('The repo already uses Babadaba conventions — frame the answer as "capabilities you may not be using yet", not as an introduction.');
	}
	return caveats;
}

/** Instructions for the assistant that consumes the tool result. */
export const ASSISTANT_GUIDANCE = [
	'Ground every claim in the detected facts above — name actual directories, packages, and scripts from this repo, and do not invent facts that are not listed.',
	'Lead with the two or three highest-relevance capabilities for THIS repo, not the full feature list.',
	'Include the caveats honestly; the product positioning is trust and legibility, so an oversold answer is off-brand.',
	'Close with the one concrete first step: open this repo (or a new workspace) in Babadaba and state the goal — the IDE proposes the surface breakdown from there.',
].join('\n- ');

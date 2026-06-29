#!/usr/bin/env node
/**
 * Evaluate milestones from .agent/milestones.json and optionally apply fixes via agent CLI.
 *
 * Usage:
 *   node .agents/skills/milestone-evaluator/scripts/run-milestones.mts [options]
 *
 * Options:
 *   --apply           Invoke agent (or write task files) for failing milestones
 *   --dry-run         With --apply, only write .agent/milestone-tasks/*.md
 *   --milestone <id>  Evaluate a single milestone
 *   --json            Print summary JSON to stdout
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');

interface MilestoneCheck {
	readonly type: string;
	readonly path?: string;
	readonly pattern?: string;
	readonly paths?: readonly string[];
	readonly script?: string;
}

interface Milestone {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly paths?: readonly string[];
	readonly checks?: readonly MilestoneCheck[];
}

interface MilestonesFile {
	readonly version: number;
	readonly description?: string;
	readonly milestones: readonly Milestone[];
}

interface CheckResult {
	readonly check: string;
	readonly passed: boolean;
	readonly detail: string;
}

interface SuggestedChange {
	readonly summary: string;
	readonly paths: readonly string[];
	readonly steps: readonly string[];
}

interface MilestoneReport {
	readonly milestoneId: string;
	readonly title: string;
	readonly status: 'pass' | 'fail' | 'partial';
	readonly checkResults: readonly CheckResult[];
	readonly gaps: readonly string[];
	readonly suggestedChanges: readonly SuggestedChange[];
	readonly evaluatedAt: string;
}

function parseArgs(argv: readonly string[]): {
	apply: boolean;
	dryRun: boolean;
	milestoneId?: string;
	json: boolean;
} {
	let apply = false;
	let dryRun = false;
	let milestoneId: string | undefined;
	let json = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--apply') {
			apply = true;
		} else if (arg === '--dry-run') {
			dryRun = true;
		} else if (arg === '--json') {
			json = true;
		} else if (arg === '--milestone') {
			milestoneId = argv[++i];
		} else if (arg === '--help' || arg === '-h') {
			console.log(`Usage: run-milestones.mts [--apply] [--dry-run] [--milestone <id>] [--json]`);
			process.exit(0);
		}
	}

	return { apply, dryRun, milestoneId, json };
}

function runCommand(command: string, args: readonly string[], cwd = REPO_ROOT): { ok: boolean; output: string } {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
	});
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
	return { ok: result.status === 0, output };
}

function runCheck(check: MilestoneCheck): CheckResult {
	const label = JSON.stringify(check);

	switch (check.type) {
		case 'fileExists': {
			if (!check.path) {
				return { check: label, passed: false, detail: 'Missing path field' };
			}
			const full = join(REPO_ROOT, check.path);
			const passed = existsSync(full);
			return { check: label, passed, detail: passed ? `Found ${check.path}` : `Missing ${check.path}` };
		}
		case 'rgAbsent': {
			if (!check.pattern || !check.paths?.length) {
				return { check: label, passed: false, detail: 'Missing pattern or paths' };
			}
			for (const rel of check.paths) {
				const result = runCommand('rg', ['-l', check.pattern, rel], REPO_ROOT);
				if (result.ok && result.output.trim()) {
					return {
						check: label,
						passed: false,
						detail: `Pattern "${check.pattern}" found in:\n${result.output}`,
					};
				}
			}
			return { check: label, passed: true, detail: `Pattern absent under ${check.paths.join(', ')}` };
		}
		case 'testGrep': {
			if (!check.pattern || !check.script) {
				return { check: label, passed: false, detail: 'Missing pattern or script' };
			}
			const scriptPath = check.script.startsWith('/') ? check.script : join(REPO_ROOT, check.script);
			const result = runCommand(scriptPath, ['--grep', check.pattern], REPO_ROOT);
			return {
				check: label,
				passed: result.ok,
				detail: result.ok ? `Tests passed for ${check.pattern}` : result.output.slice(0, 2000),
			};
		}
		case 'npmScript': {
			if (!check.script) {
				return { check: label, passed: false, detail: 'Missing script field' };
			}
			const result = runCommand('npm', ['run', check.script], REPO_ROOT);
			return {
				check: label,
				passed: result.ok,
				detail: result.ok ? `npm run ${check.script} succeeded` : result.output.slice(0, 2000),
			};
		}
		default:
			return { check: label, passed: false, detail: `Unknown check type: ${check.type}` };
	}
}

function evaluateMilestone(milestone: Milestone): MilestoneReport {
	const checkResults = (milestone.checks ?? []).map(runCheck);
	const failed = checkResults.filter(r => !r.passed);
	const gaps = failed.map(r => r.detail);
	const suggestedChanges: SuggestedChange[] = failed.length
		? [{
			summary: `Close gaps for milestone "${milestone.title}"`,
			paths: milestone.paths ?? [],
			steps: [
				`Read ${(milestone.paths ?? []).join(', ') || 'milestone focus paths'}`,
				...gaps.map(g => `Fix: ${g.split('\n')[0]}`),
				'Run npm run compile-check-ts-native if TypeScript changed',
				`Re-run: npm run milestone:evaluate -- --milestone ${milestone.id}`,
			],
		}]
		: [];

	const status: MilestoneReport['status'] =
		failed.length === 0 ? 'pass' :
			failed.length === checkResults.length ? 'fail' : 'partial';

	return {
		milestoneId: milestone.id,
		title: milestone.title,
		status,
		checkResults,
		gaps,
		suggestedChanges,
		evaluatedAt: new Date().toISOString(),
	};
}

function writeReport(report: MilestoneReport): string {
	const dir = join(REPO_ROOT, '.agent/milestone-reports');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${report.milestoneId}.json`);
	writeFileSync(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
	return path;
}

function buildAgentPrompt(milestone: Milestone, report: MilestoneReport): string {
	const skillPath = '.agents/skills/milestone-evaluator/SKILL.md';
	return `# Milestone task: ${milestone.id}

Follow **${skillPath}** and apply all suggested changes for this milestone.

## Milestone
- **Title:** ${milestone.title}
- **Description:** ${milestone.description}
- **Status:** ${report.status}

## Gaps
${report.gaps.map(g => `- ${g.replace(/\n/g, ' ')}`).join('\n') || '- None'}

## Focus paths
${(milestone.paths ?? []).map(p => `- \`${p}\``).join('\n') || '- (see milestones.json)'}

## Suggested changes
${report.suggestedChanges.map(sc => `### ${sc.summary}\n${sc.steps.map(s => `- ${s}`).join('\n')}`).join('\n\n')}

## Requirements
1. Implement fixes with minimal scope.
2. Run \`npm run compile-check-ts-native\` after edits.
3. Re-run \`npm run milestone:evaluate -- --milestone ${milestone.id}\` until status is pass.
`;
}

function tryInvokeAgent(milestone: Milestone, report: MilestoneReport, dryRun: boolean): boolean {
	const tasksDir = join(REPO_ROOT, '.agent/milestone-tasks');
	mkdirSync(tasksDir, { recursive: true });
	const taskPath = join(tasksDir, `${milestone.id}.md`);
	const prompt = buildAgentPrompt(milestone, report);
	writeFileSync(taskPath, prompt, 'utf8');

	if (dryRun) {
		console.log(`  Wrote agent task: ${taskPath}`);
		return true;
	}

	const customCmd = process.env.MILESTONE_AGENT_CMD;
	if (customCmd) {
		const result = runCommand('bash', ['-lc', `${customCmd} "$(cat "${taskPath}")"`], REPO_ROOT);
		if (result.ok) {
			console.log(`  Applied via MILESTONE_AGENT_CMD for ${milestone.id}`);
			return true;
		}
		console.error(`  MILESTONE_AGENT_CMD failed: ${result.output.slice(0, 500)}`);
	}

	for (const [cmd, args] of [
		['codex', ['exec', '--full-auto', prompt]],
		['cursor', ['agent', '--print', prompt]],
	] as const) {
		if (!runCommand('bash', ['-lc', `command -v ${cmd}`], REPO_ROOT).ok) {
			continue;
		}
		console.log(`  Invoking ${cmd} for ${milestone.id}...`);
		const result = runCommand(cmd, [...args], REPO_ROOT);
		if (result.ok) {
			return true;
		}
		console.error(`  ${cmd} failed: ${result.output.slice(0, 500)}`);
	}

	console.log(`  No agent CLI available. Task file: ${taskPath}`);
	return false;
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const milestonesPath = join(REPO_ROOT, '.agent/milestones.json');

	if (!existsSync(milestonesPath)) {
		console.error(`Missing milestones list: ${milestonesPath}`);
		process.exit(1);
	}

	const config = JSON.parse(readFileSync(milestonesPath, 'utf8')) as MilestonesFile;
	let milestones = config.milestones;
	if (args.milestoneId) {
		milestones = milestones.filter(m => m.id === args.milestoneId);
		if (!milestones.length) {
			console.error(`Unknown milestone: ${args.milestoneId}`);
			process.exit(1);
		}
	}

	const reports: MilestoneReport[] = [];

	for (const milestone of milestones) {
		console.log(`\n=== ${milestone.id}: ${milestone.title} ===`);
		const report = evaluateMilestone(milestone);
		const reportPath = writeReport(report);
		console.log(`  Status: ${report.status}`);
		console.log(`  Report: ${reportPath}`);

		if (report.status !== 'pass' && args.apply) {
			tryInvokeAgent(milestone, report, args.dryRun);
		}

		reports.push(report);
	}

	const summary = {
		evaluated: reports.length,
		passed: reports.filter(r => r.status === 'pass').length,
		failed: reports.filter(r => r.status !== 'pass').length,
		reports: reports.map(r => ({ id: r.milestoneId, status: r.status })),
	};

	if (args.json) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		console.log(`\nDone: ${summary.passed}/${summary.evaluated} passed`);
	}

	process.exit(summary.failed > 0 ? 1 : 0);
}

main();

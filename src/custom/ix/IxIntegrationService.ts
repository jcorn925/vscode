/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable, DisposableStore } from '../../vs/base/common/lifecycle.js';
import { isWeb, isWindows } from '../../vs/base/common/platform.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { RunOnceScheduler } from '../../vs/base/common/async.js';
import { parse, type YamlMapNode, type YamlNode } from '../../vs/base/common/yaml.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../vs/platform/configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../vs/platform/environment/common/environment.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService, WorkbenchState } from '../../vs/platform/workspace/common/workspace.js';
import { ITerminalService } from '../../vs/workbench/contrib/terminal/browser/terminal.js';
import { IStorageService, StorageScope, StorageTarget } from '../../vs/platform/storage/common/storage.js';
import { INotificationService, Severity } from '../../vs/platform/notification/common/notification.js';
import { ILifecycleService } from '../../vs/workbench/services/lifecycle/common/lifecycle.js';
import { IOpenerService } from '../../vs/platform/opener/common/opener.js';
import { localize } from '../../vs/nls.js';

export type IxPhase = 'idle' | 'installing' | 'docker' | 'mapping' | 'watching' | 'error';

export type IxPipelineStepStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type IxPipelineStepKind = 'global' | 'workspace';

export interface IxPipelineStepSnapshot {
	readonly id: string;
	readonly kind: IxPipelineStepKind;
	readonly label: string;
	readonly workspaceUri?: string;
	readonly workspaceName?: string;
	readonly status: IxPipelineStepStatus;
	readonly command?: string;
	readonly error?: string;
	readonly startedAtMs?: number;
	readonly endedAtMs?: number;
	readonly outputTail: string;
}

export interface IxIntegrationState {
	readonly phase: IxPhase;
	readonly lastCommand: string | undefined;
	readonly lastError: string | undefined;
	readonly lastOutput: string;
	readonly pipelineGeneration: number;
	readonly pipelineSteps: ReadonlyArray<IxPipelineStepSnapshot>;
}

export interface IIxIntegrationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<IxIntegrationState>;
	getState(): IxIntegrationState;
	restart(): Promise<void>;
	installOrResolve(): Promise<void>;
	openDocs(): Promise<void>;
	runJsonQuery(args: readonly string[], cwd?: URI, timeoutMs?: number): Promise<{ ok: true; value: unknown; raw: string } | { ok: false; error: string; raw: string; exitCode: number }>;
	/**
	 * Ensures the Ix Docker backend on port 8090 is reachable, running `ix docker start` when needed.
	 */
	ensureIxBackendReady(cwd: URI): Promise<boolean>;
	/**
	 * Runs `ix stats`; if there are no nodes, runs `ix map .` once to hydrate the workspace graph.
	 * Use before `ix subsystems` / JSON `ix map` in Process notes flows.
	 */
	ensureIxMappedIfEmpty(cwd: URI): Promise<{ readonly statsPreview: string; readonly ranMap: boolean; readonly statsOk: boolean }>;
}

export const IIxIntegrationService = createDecorator<IIxIntegrationService>('ixIntegrationService');

const STORAGE_IX_CLI = 'custom.ix/resolvedCliPath';

const OUTPUT_TAIL = 16_384;

const STEP_RESOLVE = 'resolve';
const STEP_DOCKER = 'docker';
const STEP_RESET = 'ix-reset';
const STEP_STATS = 'ix-stats';

function mapStepId(uri: URI): string {
	return `map:${uri.toString()}`;
}

function watchStepId(uri: URI): string {
	return `watch:${uri.toString()}`;
}

function stripAnsi(data: string): string {
	return data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Appends a PTY-style `chunk` onto `buf` while honoring bare carriage returns the way a
 * terminal would: a CR without a following LF rewinds to the start of the current line, so
 * a subsequent write overwrites the previous frame. Without this, spinners like
 * `ix reset`'s "Wiping code graph..." accumulate as a wall of duplicated lines in our
 * captured output buffer. The result is still truncated to `OUTPUT_TAIL` like before.
 */
function appendOutputCollapsingCr(buf: string, chunk: string): string {
	let next = buf;
	let i = 0;
	while (i < chunk.length) {
		const cr = chunk.indexOf('\r', i);
		if (cr === -1) {
			next += chunk.slice(i);
			break;
		}
		next += chunk.slice(i, cr);
		// CRLF: keep both as a real newline.
		if (chunk[cr + 1] === '\n') {
			next += '\r\n';
			i = cr + 2;
			continue;
		}
		// Bare CR: drop everything back to the last newline so the next chars overwrite.
		const lastNl = next.lastIndexOf('\n');
		next = lastNl === -1 ? '' : next.slice(0, lastNl + 1);
		i = cr + 1;
	}
	return next.slice(-OUTPUT_TAIL);
}

/** True when `ix stats` reports zero nodes (cold or reset graph). */
function looksIxGraphEmptyFromStats(statsOutput: string): boolean {
	return /nodes\s*\(\s*0\s+total\s*\)/i.test(stripAnsi(statsOutput));
}

function looksIxBackendUnreachable(output: string): boolean {
	return /fetch failed|ECONNREFUSED|connection refused|connect ECONNREFUSED/i.test(output);
}

interface IxWorkspaceConfigEntry {
	readonly workspace_name?: string;
	readonly root_path?: string;
	readonly default?: boolean;
}

function yamlScalarValue(node: YamlNode | undefined): string | undefined {
	return node?.type === 'scalar' ? node.value : undefined;
}

function yamlBooleanValue(node: YamlNode | undefined): boolean | undefined {
	const value = yamlScalarValue(node);
	if (value === 'true') {
		return true;
	}
	if (value === 'false') {
		return false;
	}
	return undefined;
}

function yamlMapProperty(map: YamlMapNode, key: string): YamlNode | undefined {
	return map.properties.find(p => p.key.value === key)?.value;
}

function parseIxWorkspacesFromConfig(root: YamlNode | undefined): IxWorkspaceConfigEntry[] {
	if (!root || root.type !== 'map') {
		return [];
	}
	const workspacesNode = yamlMapProperty(root, 'workspaces');
	if (!workspacesNode || workspacesNode.type !== 'sequence') {
		return [];
	}
	const workspaces: IxWorkspaceConfigEntry[] = [];
	for (const item of workspacesNode.items) {
		if (item.type !== 'map') {
			continue;
		}
		workspaces.push({
			workspace_name: yamlScalarValue(yamlMapProperty(item, 'workspace_name')),
			root_path: yamlScalarValue(yamlMapProperty(item, 'root_path')),
			default: yamlBooleanValue(yamlMapProperty(item, 'default')),
		});
	}
	return workspaces;
}

function getIxDefaultWorkspaceRootFromConfig(root: YamlNode | undefined): string | undefined {
	if (!root || root.type !== 'map') {
		return undefined;
	}
	const workspaces = parseIxWorkspacesFromConfig(root);
	const namedWorkspace = yamlScalarValue(yamlMapProperty(root, 'workspace'));
	if (namedWorkspace) {
		const match = workspaces.find(w => w.workspace_name === namedWorkspace);
		if (match?.root_path) {
			return match.root_path;
		}
	}
	return workspaces.find(w => w.default)?.root_path;
}

function normalizeIxFilesystemPath(path: string): string {
	let normalized = path.trim();
	while (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
		normalized = normalized.slice(0, -1);
	}
	try {
		return URI.file(normalized).fsPath;
	} catch {
		return normalized;
	}
}

/** Skip reset when a single-root VS Code folder is already the Ix default workspace. */
function vscodeFoldersMatchIxDefaultWorkspace(
	folders: ReadonlyArray<{ readonly uri: URI }>,
	ixDefaultRoot: string | undefined,
): boolean {
	if (!ixDefaultRoot || folders.length !== 1) {
		return false;
	}
	return normalizeIxFilesystemPath(folders[0].uri.fsPath) === normalizeIxFilesystemPath(ixDefaultRoot);
}

function tailOutput(text: string): string {
	const t = stripAnsi(text).trim();
	if (!t) {
		return '';
	}
	const lines = t.split(/\r?\n/);
	return lines.slice(-24).join('\n');
}

function normalizeIxJsonOutput(output: string): string {
	const trimmed = output.trim().replace(/^\uFEFF/, '');
	if (!trimmed) {
		return trimmed;
	}
	if (trimmed.startsWith('```')) {
		const lines = trimmed.split(/\r?\n/);
		const fenceEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '```');
		if (fenceEnd > 0) {
			return lines.slice(1, fenceEnd).join('\n').trim();
		}
	}
	const start = trimmed.search(/[\[{]/);
	return start > 0 ? trimmed.slice(start).trim() : trimmed;
}

interface IxPipelineStepMutable {
	readonly id: string;
	readonly kind: IxPipelineStepKind;
	readonly label: string;
	workspaceUri?: string;
	workspaceName?: string;
	status: IxPipelineStepStatus;
	command?: string;
	error?: string;
	startedAtMs?: number;
	endedAtMs?: number;
	outputBuf: string;
}

export class IxIntegrationService extends Disposable implements IIxIntegrationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IxIntegrationState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private phase: IxPhase = 'idle';
	private lastCommand: string | undefined;
	private lastError: string | undefined;
	private outputBuffer = '';

	private pipelineGeneration = 0;
	private pipelineStepsMutable: IxPipelineStepMutable[] = [];
	private readonly watchInstances = new Map<string, DisposableStore>();
	private readonly startScheduler = this._register(new RunOnceScheduler(() => void this.runAutoStartPipeline(), 900));
	private readonly pipelineOutputFlushScheduler = this._register(new RunOnceScheduler(() => this.fireState(), 120));
	private dockerStartInFlight: Promise<boolean> | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();

		if (isWeb) {
			return;
		}

		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.scheduleStart()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.scheduleStart()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('custom.ix')) {
				this.scheduleStart();
			}
		}));
		this._register(this.lifecycleService.onWillShutdown(() => this.disposeWatchers()));

		this.scheduleStart();
	}

	getState(): IxIntegrationState {
		return {
			phase: this.phase,
			lastCommand: this.lastCommand,
			lastError: this.lastError,
			lastOutput: this.getLastOutputSnippet(),
			pipelineGeneration: this.pipelineGeneration,
			pipelineSteps: this.snapshotPipeline(),
		};
	}

	private getLastOutputSnippet(): string {
		return tailOutput(this.outputBuffer);
	}

	private pushAggregateOutput(chunk: string): void {
		this.outputBuffer = (this.outputBuffer + chunk).slice(-OUTPUT_TAIL);
	}

	private pushPipelineOutput(stepId: string | undefined, chunk: string, debounce: boolean): void {
		if (stepId) {
			const s = this.findStep(stepId);
			if (s) {
				s.outputBuf = appendOutputCollapsingCr(s.outputBuf, chunk);
			}
		}
		this.pushAggregateOutput(chunk);
		if (debounce) {
			this.pipelineOutputFlushScheduler.schedule();
		} else {
			this.fireState();
		}
	}

	private clearPipeline(): void {
		this.pipelineStepsMutable = [];
	}

	private rebuildPipelineForFolders(folders: ReadonlyArray<{ readonly name: string; readonly uri: URI }>): void {
		this.pipelineStepsMutable = [];
		this.pipelineStepsMutable.push({
			id: STEP_RESOLVE,
			kind: 'global',
			label: localize('ix.pipeline.resolve', 'Resolve CLI'),
			status: 'idle',
			outputBuf: '',
		});
		this.pipelineStepsMutable.push({
			id: STEP_DOCKER,
			kind: 'global',
			label: localize('ix.pipeline.docker', 'Docker start'),
			status: 'idle',
			outputBuf: '',
		});
		if (this.isAutoResetOnStartEnabled()) {
			this.pipelineStepsMutable.push({
				id: STEP_RESET,
				kind: 'global',
				label: localize('ix.pipeline.reset', 'Ix reset (code)'),
				status: 'idle',
				outputBuf: '',
			});
		}
		this.pipelineStepsMutable.push({
			id: STEP_STATS,
			kind: 'global',
			label: localize('ix.pipeline.stats', 'Ix stats'),
			status: 'idle',
			outputBuf: '',
		});
		for (const f of folders) {
			this.pipelineStepsMutable.push({
				id: mapStepId(f.uri),
				kind: 'workspace',
				label: localize('ix.pipeline.mapFolder', 'Map: {0}', f.name),
				workspaceUri: f.uri.toString(),
				workspaceName: f.name,
				status: 'idle',
				outputBuf: '',
			});
		}
		for (const f of folders) {
			this.pipelineStepsMutable.push({
				id: watchStepId(f.uri),
				kind: 'workspace',
				label: localize('ix.pipeline.watchFolder', 'Watch: {0}', f.name),
				workspaceUri: f.uri.toString(),
				workspaceName: f.name,
				status: 'idle',
				outputBuf: '',
			});
		}
	}

	private rebuildPipelineResolveOnly(): void {
		this.pipelineStepsMutable = [{
			id: STEP_RESOLVE,
			kind: 'global',
			label: localize('ix.pipeline.resolve', 'Resolve CLI'),
			status: 'idle',
			outputBuf: '',
		}];
	}

	private findStep(id: string): IxPipelineStepMutable | undefined {
		return this.pipelineStepsMutable.find(s => s.id === id);
	}

	private beginStep(id: string): void {
		const s = this.findStep(id);
		if (!s) {
			return;
		}
		s.status = 'running';
		s.startedAtMs = Date.now();
		s.endedAtMs = undefined;
		s.error = undefined;
		this.fireState();
	}

	private completeStep(id: string, status: 'success' | 'error' | 'skipped', error?: string): void {
		const s = this.findStep(id);
		if (!s) {
			return;
		}
		s.status = status;
		s.endedAtMs = Date.now();
		if (error) {
			s.error = error;
		}
		this.fireState();
	}

	private markRemainingIdleStepsSkipped(): void {
		for (const s of this.pipelineStepsMutable) {
			if (s.status === 'idle') {
				s.status = 'skipped';
				s.endedAtMs = Date.now();
			}
		}
		this.fireState();
	}

	private snapshotPipeline(): ReadonlyArray<IxPipelineStepSnapshot> {
		return this.pipelineStepsMutable.map(s => ({
			id: s.id,
			kind: s.kind,
			label: s.label,
			workspaceUri: s.workspaceUri,
			workspaceName: s.workspaceName,
			status: s.status,
			command: s.command,
			error: s.error,
			startedAtMs: s.startedAtMs,
			endedAtMs: s.endedAtMs,
			outputTail: tailOutput(s.outputBuf),
		}));
	}

	private fireState(): void {
		this._onDidChangeState.fire(this.getState());
	}

	private scheduleStart(): void {
		if (isWeb) {
			return;
		}
		this.startScheduler.schedule();
	}

	private isIxAutomationEnabled(): boolean {
		if (isWeb) {
			return false;
		}
		return Boolean(this.configurationService.getValue<boolean>('custom.ix.enabled') ?? true);
	}

	private isAutoStartEnabled(): boolean {
		return Boolean(this.configurationService.getValue<boolean>('custom.ix.autoStart') ?? true);
	}

	private isAutoResetOnStartEnabled(): boolean {
		return Boolean(this.configurationService.getValue<boolean>('custom.ix.autoResetOnStart') ?? true);
	}

	private async getIxDefaultWorkspaceRootPath(): Promise<string | undefined> {
		try {
			const configUri = joinPath(this.environmentService.userHome, '.ix', 'config.yaml');
			const content = await this.fileService.readFile(configUri);
			return getIxDefaultWorkspaceRootFromConfig(parse(content.value.toString()));
		} catch {
			return undefined;
		}
	}

	private getInstallUrl(): string {
		const raw = this.configurationService.getValue<string>('custom.ix.installScriptUrl');
		const url = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'https://ix-infra.com/install.sh';
		return url;
	}

	private getConfiguredCliPath(): string | undefined {
		const raw = this.configurationService.getValue<string>('custom.ix.cliPath');
		if (typeof raw === 'string') {
			const t = raw.trim();
			return t.length > 0 ? t : undefined;
		}
		return undefined;
	}

	private shellLaunchForCommand(commandLine: string): { executable: string; args: string[] } {
		if (isWindows) {
			return { executable: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
		}
		return { executable: '/bin/bash', args: ['-c', commandLine] };
	}

	private async runCommand(
		cwd: URI | undefined,
		commandLine: string,
		timeoutMs: number,
		opts?: { ui?: 'pipeline' | 'none'; stepId?: string; debounceOutput?: boolean },
	): Promise<{ exitCode: number; output: string }> {
		const ui = opts?.ui ?? 'pipeline';
		const stepId = opts?.stepId;
		const debounce = opts?.debounceOutput ?? false;

		const shell = this.shellLaunchForCommand(commandLine);
		const store = new DisposableStore();
		let buf = '';
		try {
			if (ui !== 'none') {
				this.lastCommand = commandLine;
				if (stepId) {
					const s = this.findStep(stepId);
					if (s) {
						s.command = commandLine;
					}
				}
				this.fireState();
			}

			const instance = await this.terminalService.createTerminal({
				cwd,
				config: {
					...shell,
					name: 'Ix',
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			});
			store.add(instance);
			store.add(instance.onData(d => {
				buf += d;
				if (ui === 'none') {
					return;
				}
				this.pushPipelineOutput(stepId, d, debounce);
			}));

			const exitCode = await new Promise<number>((resolve, reject) => {
				const handle = setTimeout(() => reject(new Error('timeout')), timeoutMs);
				store.add({ dispose: () => clearTimeout(handle) });
				store.add(instance.onExit(code => {
					clearTimeout(handle);
					if (typeof code === 'number') {
						resolve(code);
					} else {
						resolve(1);
					}
				}));
			});

			if (ui !== 'none' && debounce) {
				this.pipelineOutputFlushScheduler.cancel();
				this.fireState();
			}

			return { exitCode, output: stripAnsi(buf) };
		} finally {
			store.dispose();
		}
	}

	private async probeIxBackendReachable(cwd: URI, ixBin: string): Promise<boolean> {
		const stats = await this.runCommand(cwd, `${this.quoteIx(ixBin)} stats`, 15_000, { ui: 'none' });
		if (stats.exitCode === 0) {
			return true;
		}
		const output = stripAnsi(stats.output);
		if (looksIxBackendUnreachable(output)) {
			return false;
		}
		const status = await this.runCommand(cwd, `${this.quoteIx(ixBin)} status`, 15_000, { ui: 'none' });
		return status.exitCode === 0 && /Ix Memory:\s*ok/i.test(stripAnsi(status.output));
	}

	private async ensureIxDockerStarted(
		cwd: URI,
		ixBin: string,
		opts?: { ui?: 'pipeline' | 'none'; stepId?: string; skipIfReachable?: boolean },
	): Promise<boolean> {
		if (opts?.skipIfReachable && await this.probeIxBackendReachable(cwd, ixBin)) {
			return true;
		}
		if (this.dockerStartInFlight) {
			return this.dockerStartInFlight;
		}
		const ui = opts?.ui ?? 'none';
		this.dockerStartInFlight = (async () => {
			try {
				const docker = await this.runCommand(cwd, `${this.quoteIx(ixBin)} docker start`, 300_000, {
					ui,
					stepId: opts?.stepId,
				});
				return docker.exitCode === 0;
			} finally {
				this.dockerStartInFlight = undefined;
			}
		})();
		return this.dockerStartInFlight;
	}

	async ensureIxBackendReady(cwd: URI): Promise<boolean> {
		if (isWeb || !this.isIxAutomationEnabled()) {
			return false;
		}
		const ixBin = await this.resolveIxBinary(cwd);
		if (!ixBin) {
			return false;
		}
		if (await this.probeIxBackendReachable(cwd, ixBin)) {
			return true;
		}
		const started = await this.ensureIxDockerStarted(cwd, ixBin, { ui: 'none' });
		if (!started) {
			return false;
		}
		return this.probeIxBackendReachable(cwd, ixBin);
	}

	async ensureIxMappedIfEmpty(cwd: URI): Promise<{ readonly statsPreview: string; readonly ranMap: boolean; readonly statsOk: boolean }> {
		if (isWeb) {
			return { statsPreview: '', ranMap: false, statsOk: false };
		}
		const ixBin = await this.resolveIxBinary(cwd);
		if (!ixBin) {
			return { statsPreview: '', ranMap: false, statsOk: false };
		}
		if (!await this.ensureIxBackendReady(cwd)) {
			return {
				statsPreview: localize('ix.error.backendUnreachable', 'Ix backend is not reachable on port 8090.'),
				ranMap: false,
				statsOk: false,
			};
		}
		const stats = await this.runCommand(cwd, `${this.quoteIx(ixBin)} stats`, 30_000, { ui: 'none' });
		const statsPreview = stripAnsi(stats.output).trim();
		if (stats.exitCode !== 0) {
			return { statsPreview, ranMap: false, statsOk: false };
		}
		if (!looksIxGraphEmptyFromStats(stats.output)) {
			return { statsPreview, ranMap: false, statsOk: true };
		}
		const mapped = await this.runCommand(cwd, `${this.quoteIx(ixBin)} map --all-items .`, 600_000, { ui: 'none' });
		return { statsPreview, ranMap: mapped.exitCode === 0, statsOk: mapped.exitCode === 0 };
	}

	async runJsonQuery(args: readonly string[], cwd?: URI, timeoutMs: number = 60_000): Promise<{ ok: true; value: unknown; raw: string } | { ok: false; error: string; raw: string; exitCode: number }> {
		if (isWeb) {
			return { ok: false, error: 'Ix is not available on web.', raw: '', exitCode: 1 };
		}

		const folder = cwd ?? this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!folder) {
			return { ok: false, error: 'No workspace folder.', raw: '', exitCode: 1 };
		}

		const ixBin = await this.resolveIxBinary(folder);
		if (!ixBin) {
			return { ok: false, error: 'Could not resolve ix CLI binary.', raw: '', exitCode: 1 };
		}

		if (!await this.ensureIxBackendReady(folder)) {
			return {
				ok: false,
				error: localize('ix.error.backendUnreachable', 'Ix backend is not reachable on port 8090.'),
				raw: '',
				exitCode: 1,
			};
		}

		// Shell passes through `bash -c "<cmd>"` / `cmd /c <cmd>` — values with spaces (subsystem labels like
		// "Graphify Out") must be quoted or they split into wrong argv and ix exits non‑zero, spamming terminal errors.
		const cmd = `${this.quoteIx(ixBin)} ${args.map(a => this.quoteShellArg(a)).join(' ')}`;
		const { exitCode, output } = await this.runCommand(folder, cmd, timeoutMs, { ui: 'none' });
		if (exitCode !== 0) {
			const stripped = stripAnsi(output).trim();
			const tail = tailOutput(output);
			const notable = stripped.split(/\r?\n/).find(l =>
				/error:|unknown option|fetch failed|ECONNREFUSED|connection refused/i.test(l),
			);
			const error = notable ?? (tail || `ix exited with code ${exitCode}`);
			return { ok: false, error, raw: output, exitCode };
		}
		try {
			const normalized = normalizeIxJsonOutput(output);
			const value = JSON.parse(normalized);
			return { ok: true, value, raw: output };
		} catch (e: any) {
			const trimmed = output.trim();
			const head = trimmed.split(/\r?\n/).slice(0, 6).join('\n');
			// Some ix subcommands print a human-readable message even when --format json was requested.
			// Treat this as an ix-level failure rather than a JSON parsing failure, and prefer the ix message.
			const parseMsg = String(e?.message ?? e);
			const ixMessage = head || trimmed;
			if (/^No entity named\b/i.test(ixMessage)) {
				return { ok: false, error: ixMessage, raw: output, exitCode: 0 };
			}
			return {
				ok: false,
				error: localize('ix.jsonQuery.notJson', 'Ix did not return JSON. {0}{1}', parseMsg ? `(${parseMsg})` : '', head ? `\n${head}` : ''),
				raw: output,
				exitCode: 0
			};
		}
	}

	private probeCommand(): string {
		return isWindows ? 'where ix >nul 2>nul' : 'command -v ix';
	}

	private async resolveIxBinary(cwd: URI): Promise<string | undefined> {
		const configured = this.getConfiguredCliPath();
		if (configured) {
			return configured;
		}

		const cached = this.storageService.get(STORAGE_IX_CLI, StorageScope.APPLICATION);
		if (cached && cached.length > 0) {
			return cached;
		}

		const probe = this.probeCommand();
		const r = await this.runCommand(cwd, probe, 30_000, { ui: 'none' });
		if (r.exitCode !== 0) {
			return undefined;
		}

		if (isWindows) {
			const w = await this.runCommand(cwd, 'where ix', 30_000, { ui: 'none' });
			const line = w.output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
			if (line) {
				this.storageService.store(STORAGE_IX_CLI, line, StorageScope.APPLICATION, StorageTarget.MACHINE);
				return line;
			}
			return 'ix';
		}

		const line = r.output.split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
		if (line) {
			this.storageService.store(STORAGE_IX_CLI, line, StorageScope.APPLICATION, StorageTarget.MACHINE);
			return line;
		}
		return 'ix';
	}

	private buildInstallCommand(): string {
		const url = this.getInstallUrl();
		if (isWindows) {
			const safe = url.replace(/'/g, "''");
			return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-Expression (Invoke-WebRequest -UseBasicParsing -Uri '${safe}').Content"`;
		}
		const safe = url.replace(/'/g, `'\\''`);
		return `curl -fsSL '${safe}' | sh`;
	}

	private async ensureInstalled(cwd: URI, gen: number, resolveStepId: string): Promise<string | undefined> {
		let binary = await this.resolveIxBinary(cwd);
		if (binary) {
			return binary;
		}

		const allowInstall = Boolean(this.configurationService.getValue<boolean>('custom.ix.autoInstall') ?? true);
		if (!allowInstall) {
			const msg = localize('ix.error.noCli', 'The ix CLI was not found and automatic installation is disabled (custom.ix.autoInstall).');
			this.completeStep(resolveStepId, 'error', msg);
			this.setPhase('error', msg);
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('ix.notify.noCli', 'Ix CLI not found. Install ix manually or enable custom.ix.autoInstall.'),
			});
			return undefined;
		}

		if (gen !== this.pipelineGeneration) {
			return undefined;
		}

		this.setPhase('installing');
		const installCmd = this.buildInstallCommand();
		try {
			const r = await this.runCommand(cwd, installCmd, 600_000, { stepId: resolveStepId });
			if (gen !== this.pipelineGeneration) {
				return undefined;
			}
			if (r.exitCode !== 0) {
				const err = localize('ix.error.installFailed', 'Ix install script failed (exit {0}).', String(r.exitCode));
				this.completeStep(resolveStepId, 'error', err);
				this.setPhase('error', err);
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('ix.notify.installFailed', 'Ix installation failed. Check the Process tab log or install ix manually.'),
				});
				return undefined;
			}
		} catch (e) {
			if (gen !== this.pipelineGeneration) {
				return undefined;
			}
			this.completeStep(resolveStepId, 'error', String(e));
			this.setPhase('error', String(e));
			this.notificationService.notify({ severity: Severity.Error, message: String(e) });
			return undefined;
		}

		this.storageService.remove(STORAGE_IX_CLI, StorageScope.APPLICATION);
		binary = await this.resolveIxBinary(cwd);
		if (!binary) {
			const msg = localize('ix.error.afterInstall', 'Ix install finished but `ix` is still not on PATH.');
			this.completeStep(resolveStepId, 'error', msg);
			this.setPhase('error', msg);
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('ix.notify.afterInstall', 'Ix was installed but could not be detected on PATH. Restart VS Code or set custom.ix.cliPath.'),
			});
		}
		return binary;
	}

	private getPrimaryFolder(): URI | undefined {
		const folders = this.workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri : undefined;
	}

	private async runAutoStartPipeline(): Promise<void> {
		if (isWeb || !this.isIxAutomationEnabled() || !this.isAutoStartEnabled()) {
			this.clearPipeline();
			this.setPhase('idle');
			return;
		}

		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.disposeWatchers();
			this.clearPipeline();
			this.setPhase('idle');
			this.lastCommand = undefined;
			this.lastError = undefined;
			this.outputBuffer = '';
			this.fireState();
			return;
		}

		const gen = ++this.pipelineGeneration;
		const folders = this.workspaceContextService.getWorkspace().folders;
		const primary = folders[0]?.uri;
		if (!primary) {
			this.clearPipeline();
			this.fireState();
			return;
		}

		this.lastError = undefined;
		this.lastCommand = undefined;
		this.outputBuffer = '';
		this.rebuildPipelineForFolders(folders);

		this.beginStep(STEP_RESOLVE);
		const ix = await this.ensureInstalled(primary, gen, STEP_RESOLVE);
		if (gen !== this.pipelineGeneration) {
			return;
		}
		if (!ix) {
			const rs = this.findStep(STEP_RESOLVE);
			if (rs?.status === 'error') {
				this.markRemainingIdleStepsSkipped();
			}
			return;
		}

		const rs = this.findStep(STEP_RESOLVE);
		if (rs?.status === 'running') {
			this.completeStep(STEP_RESOLVE, 'success');
		}

		this.beginStep(STEP_DOCKER);
		try {
			const dockerStarted = await this.ensureIxDockerStarted(primary, ix, { ui: 'pipeline', stepId: STEP_DOCKER, skipIfReachable: true });
			if (gen !== this.pipelineGeneration) {
				return;
			}
			if (!dockerStarted) {
				const tail = tailOutput(this.outputBuffer);
				const detail = tail
					? localize('ix.error.dockerWithLog', '`ix docker start` failed (exit {0}). Recent output:\n\n{1}', '1', tail)
					: localize('ix.error.docker', '`ix docker start` failed (exit {0}). Is Docker running?', '1');
				this.completeStep(STEP_DOCKER, 'error', detail);
				this.markRemainingIdleStepsSkipped();
				this.setPhase('error', detail);
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('ix.notify.docker', 'Ix Docker backend failed to start. See Process tab for details.'),
				});
				return;
			}
			this.completeStep(STEP_DOCKER, 'success');
		} catch (e) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			this.completeStep(STEP_DOCKER, 'error', String(e));
			this.markRemainingIdleStepsSkipped();
			this.setPhase('error', String(e));
			this.notificationService.notify({ severity: Severity.Error, message: String(e) });
			return;
		}

		if (this.isAutoResetOnStartEnabled()) {
			this.beginStep(STEP_RESET);
			const ixDefaultRoot = await this.getIxDefaultWorkspaceRootPath();
			if (gen !== this.pipelineGeneration) {
				return;
			}
			if (vscodeFoldersMatchIxDefaultWorkspace(folders, ixDefaultRoot)) {
				const resetStep = this.findStep(STEP_RESET);
				if (resetStep) {
					resetStep.command = localize('ix.reset.skippedCmd', '(skipped — open workspace matches Ix default)');
					resetStep.outputBuf = localize(
						'ix.reset.skippedSameWorkspace',
						'Skipped `ix reset --code`: the open workspace already matches the default Ix workspace ({0}).',
						ixDefaultRoot ?? '',
					);
				}
				this.completeStep(STEP_RESET, 'skipped');
			} else {
				try {
					// --code wipes files/functions/classes/regions only; preserves goals/plans/tasks/bugs/decisions.
					// Use a generous 5-minute budget: large repos can churn for a while and 60s was tripping the
					// timeout mid-"Wiping code graph..." spinner.
					const reset = await this.runCommand(primary, `${this.quoteIx(ix)} reset --code -y`, 300_000, { stepId: STEP_RESET, debounceOutput: true });
					if (gen !== this.pipelineGeneration) {
						return;
					}
					if (reset.exitCode !== 0) {
						const err = localize('ix.error.reset', '`ix reset --code` failed (exit {0}).', String(reset.exitCode));
						this.completeStep(STEP_RESET, 'error', err);
						// Non-fatal: continue to stats/map so an aging-but-present graph is still usable.
					} else {
						this.completeStep(STEP_RESET, 'success');
					}
				} catch (e) {
					if (gen !== this.pipelineGeneration) {
						return;
					}
					this.completeStep(STEP_RESET, 'error', String(e));
				}
			}
		}

		this.beginStep(STEP_STATS);
		try {
			await this.runCommand(primary, `${this.quoteIx(ix)} stats`, 30_000, { stepId: STEP_STATS });
			if (gen !== this.pipelineGeneration) {
				return;
			}
			this.completeStep(STEP_STATS, 'success');
		} catch (e) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			this.completeStep(STEP_STATS, 'error', String(e));
		}

		this.setPhase('mapping');
		for (const folder of folders) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			const mid = mapStepId(folder.uri);
			this.beginStep(mid);
			try {
				// Prefer `map .`: bare `ix map` may bind to ~/.ix registered default workspace instead of terminal cwd.
				const map = await this.runCommand(folder.uri, `${this.quoteIx(ix)} map --all-items .`, 600_000, { stepId: mid });
				if (gen !== this.pipelineGeneration) {
					return;
				}
				if (map.exitCode !== 0) {
					const err = localize('ix.error.map', '`ix map` failed for {0} (exit {1}).', folder.name, String(map.exitCode));
					this.completeStep(mid, 'error', err);
					this.markRemainingIdleStepsSkipped();
					this.setPhase('error', err);
					this.notificationService.notify({
						severity: Severity.Error,
						message: localize('ix.notify.map', 'Ix map failed for folder {0}.', folder.name),
					});
					return;
				}
				this.completeStep(mid, 'success');
			} catch (e) {
				if (gen !== this.pipelineGeneration) {
					return;
				}
				this.completeStep(mid, 'error', String(e));
				this.markRemainingIdleStepsSkipped();
				this.setPhase('error', String(e));
				this.notificationService.notify({ severity: Severity.Error, message: String(e) });
				return;
			}
		}

		if (gen !== this.pipelineGeneration) {
			return;
		}

		this.startWatchers(ix, gen);
		this.setPhase('watching');
	}

	private quoteIx(ixPath: string): string {
		if (/\s/.test(ixPath)) {
			if (isWindows) {
				return `"${ixPath.replace(/"/g, '\\"')}"`;
			}
			return `'${ixPath.replace(/'/g, `'\\''`)}'`;
		}
		return ixPath;
	}

	/** Quote one argv token for the platform shell used by {@link runCommand} (bash `-c` or cmd `/c`). */
	private quoteShellArg(arg: string): string {
		if (isWindows) {
			if (/[\s"&<>|^]/.test(arg)) {
				return `"${arg.replace(/"/g, '\\"')}"`;
			}
			return arg;
		}
		return `'${arg.replace(/'/g, `'\\''`)}'`;
	}

	private startWatchers(ix: string, gen: number): void {
		this.disposeWatchers();
		const folders = this.workspaceContextService.getWorkspace().folders;
		for (const folder of folders) {
			if (gen !== this.pipelineGeneration) {
				return;
			}
			const key = folder.uri.toString();
			const wid = watchStepId(folder.uri);
			void this.terminalService.createTerminal({
				cwd: folder.uri,
				config: {
					...this.shellLaunchForCommand(`${this.quoteIx(ix)} watch .`),
					name: `Ix watch (${folder.name})`,
					hideFromUser: true,
					isFeatureTerminal: true,
				},
			}).then(instance => {
				if (gen !== this.pipelineGeneration) {
					instance.dispose();
					return;
				}
				const store = new DisposableStore();
				store.add(instance);

				this.beginStep(wid);

				store.add(instance.onData(d => {
					const prefixed = `[${folder.name}] ${d}`;
					this.pushPipelineOutput(wid, prefixed, true);
				}));

				let exitHandled = false;
				store.add(instance.onExit(code => {
					if (exitHandled || gen !== this.pipelineGeneration) {
						return;
					}
					exitHandled = true;
					if (typeof code === 'number' && code !== 0) {
						this.completeStep(wid, 'error', localize('ix.error.watchExit', '`ix watch` exited ({0}) for {1}.', String(code), folder.name));
					} else {
						this.completeStep(wid, 'success');
					}
				}));

				store.add(instance.onDisposed(() => {
					this.watchInstances.delete(key);
					if (!store.isDisposed) {
						store.dispose();
					}
					if (gen !== this.pipelineGeneration || exitHandled) {
						return;
					}
					const s = this.findStep(wid);
					if (s?.status === 'running') {
						this.completeStep(wid, 'success');
					}
				}));

				this.watchInstances.set(key, store);
			}).catch(err => {
				if (gen === this.pipelineGeneration) {
					this.completeStep(wid, 'error', String(err));
				}
			});
		}
	}

	override dispose(): void {
		this.disposeWatchers();
		super.dispose();
	}

	private disposeWatchers(): void {
		const stores = [...this.watchInstances.values()];
		this.watchInstances.clear();
		for (const s of stores) {
			s.dispose();
		}
	}

	async restart(): Promise<void> {
		if (isWeb) {
			return;
		}
		this.pipelineGeneration++;
		this.disposeWatchers();
		this.scheduleStart();
	}

	async installOrResolve(): Promise<void> {
		if (isWeb) {
			return;
		}
		const primary = this.getPrimaryFolder();
		if (!primary) {
			return;
		}
		const gen = this.pipelineGeneration;
		this.storageService.remove(STORAGE_IX_CLI, StorageScope.APPLICATION);
		this.rebuildPipelineResolveOnly();
		this.beginStep(STEP_RESOLVE);
		const ix = await this.ensureInstalled(primary, gen, STEP_RESOLVE);
		if (this.pipelineGeneration !== gen) {
			this.fireState();
			return;
		}
		const rs = this.findStep(STEP_RESOLVE);
		if (ix && rs?.status === 'running') {
			this.completeStep(STEP_RESOLVE, 'success');
		}
		this.fireState();
	}

	async openDocs(): Promise<void> {
		await this.openerService.open(URI.parse('https://ix-infra.com/docs/'));
	}

	private setPhase(phase: IxPhase, error?: string): void {
		this.phase = phase;
		if (error) {
			this.lastError = error;
		}
		this.fireState();
	}
}

registerSingleton(IIxIntegrationService, IxIntegrationService, InstantiationType.Delayed);

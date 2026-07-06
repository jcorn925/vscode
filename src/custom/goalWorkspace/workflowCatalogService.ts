/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { joinPath } from '../../vs/base/common/resources.js';
import { Emitter, Event } from '../../vs/base/common/event.js';
import { Disposable } from '../../vs/base/common/lifecycle.js';
import { createDecorator } from '../../vs/platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../vs/platform/instantiation/common/extensions.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IWorkspaceContextService } from '../../vs/platform/workspace/common/workspace.js';
import { IConsoleService } from './ConsoleService.js';
import type { WorkflowCatalog, WorkflowIxBinding, WorkflowSpec, WorkflowStep, WorkflowStepTarget } from './workflowCatalogTypes.js';

export const WORKFLOW_CATALOG_FILE = 'catalog.json';

export interface IWorkflowCatalogService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeCatalog: Event<WorkflowCatalog | undefined>;
	getCatalog(): WorkflowCatalog | undefined;
	getWorkflow(id: string): WorkflowSpec | undefined;
	listWorkflows(): readonly WorkflowSpec[];
	refresh(): Promise<void>;
}

export const IWorkflowCatalogService = createDecorator<IWorkflowCatalogService>('workflowCatalogService');

export function workflowCatalogResource(workspaceFolder: URI, workflowsRoot = 'workflows'): URI {
	return joinPath(workspaceFolder, ...workflowsRoot.split('/'), WORKFLOW_CATALOG_FILE);
}

export async function readWorkflowCatalog(fileService: IFileService, resource: URI): Promise<WorkflowCatalog | undefined> {
	try {
		if (!(await fileService.exists(resource))) {
			return undefined;
		}
		const raw = JSON.parse((await fileService.readFile(resource)).value.toString());
		return parseWorkflowCatalog(raw);
	} catch {
		return undefined;
	}
}

export async function writeWorkflowCatalog(fileService: IFileService, resource: URI, catalog: WorkflowCatalog): Promise<void> {
	await fileService.createFolder(resource.with({ path: resource.path.replace(/\/[^/]+$/, '') }));
	await fileService.writeFile(resource, VSBuffer.fromString(`${JSON.stringify(catalog, null, '\t')}\n`));
}

export async function upsertWorkflowSpec(
	fileService: IFileService,
	resource: URI,
	spec: WorkflowSpec,
): Promise<WorkflowCatalog> {
	const existing = await readWorkflowCatalog(fileService, resource);
	const workflows = [...(existing?.workflows ?? [])];
	const index = workflows.findIndex(workflow => workflow.id === spec.id);
	if (index >= 0) {
		workflows[index] = spec;
	} else {
		workflows.push(spec);
	}
	const catalog: WorkflowCatalog = { version: 1, workflows };
	await writeWorkflowCatalog(fileService, resource, catalog);
	return catalog;
}

class WorkflowCatalogService extends Disposable implements IWorkflowCatalogService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeCatalog = this._register(new Emitter<WorkflowCatalog | undefined>());
	readonly onDidChangeCatalog = this._onDidChangeCatalog.event;
	private catalog: WorkflowCatalog | undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IConsoleService private readonly consoleService: IConsoleService,
	) {
		super();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.refresh()));
		this._register(this.consoleService.onDidChangeWorkspace(() => void this.refresh()));
		void this.refresh();
	}

	getCatalog(): WorkflowCatalog | undefined {
		return this.catalog;
	}

	listWorkflows(): readonly WorkflowSpec[] {
		return this.catalog?.workflows ?? [];
	}

	getWorkflow(id: string): WorkflowSpec | undefined {
		return this.catalog?.workflows.find(workflow => workflow.id === id);
	}

	async refresh(): Promise<void> {
		const workspaceFolder = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceFolder) {
			this.catalog = undefined;
			this._onDidChangeCatalog.fire(undefined);
			return;
		}
		const workflowsRoot = this.consoleService.getWorkspace()?.shared.workflows ?? 'workflows';
		this.catalog = await readWorkflowCatalog(this.fileService, workflowCatalogResource(workspaceFolder, workflowsRoot));
		this._onDidChangeCatalog.fire(this.catalog);
	}
}

function parseWorkflowCatalog(raw: unknown): WorkflowCatalog | undefined {
	if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.workflows)) {
		return undefined;
	}
	const workflows = raw.workflows.map(parseWorkflowSpec).filter((spec): spec is WorkflowSpec => Boolean(spec));
	return { version: 1, workflows };
}

function parseWorkflowSpec(raw: unknown): WorkflowSpec | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const id = optionalString(raw.id);
	const label = optionalString(raw.label);
	const source = optionalString(raw.source);
	const scope = raw.scope;
	const surfaceId = optionalString(raw.surfaceId);
	if (!id || !label || !source || !surfaceId || !isWorkflowScope(scope)) {
		return undefined;
	}
	const steps = Array.isArray(raw.steps) ? raw.steps.map(parseWorkflowStep).filter((step): step is WorkflowStep => Boolean(step)) : [];
	if (steps.length === 0) {
		return undefined;
	}
	const events = stringArray(raw.events);
	const ixBindings = Array.isArray(raw.ixBindings) ? raw.ixBindings.map(parseWorkflowIxBinding).filter((binding): binding is WorkflowIxBinding => Boolean(binding)) : [];
	const fixtures = parseFixtures(raw.fixtures);
	return { id, label, source, scope, surfaceId, steps, events, ixBindings, fixtures };
}

function parseWorkflowStep(raw: unknown): WorkflowStep | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const id = optionalString(raw.id);
	const type = raw.type;
	if (!id || !isWorkflowStepType(type)) {
		return undefined;
	}
	const route = optionalString(raw.route);
	const target = parseTarget(raw.target);
	const value = optionalString(raw.value);
	return { id, type, route, target, value };
}

function parseTarget(raw: unknown): WorkflowStepTarget | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const target: WorkflowStepTarget = {
		text: optionalString(raw.text),
		ariaLabel: optionalString(raw.ariaLabel),
		selector: optionalString(raw.selector),
	};
	if (!target.text && !target.ariaLabel && !target.selector) {
		return undefined;
	}
	return target;
}

function parseWorkflowIxBinding(raw: unknown): WorkflowIxBinding | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const stepId = optionalString(raw.stepId);
	const subsystemLabel = optionalString(raw.subsystemLabel);
	if (!stepId || !subsystemLabel) {
		return undefined;
	}
	return { stepId, subsystemLabel };
}

function parseFixtures(raw: unknown): Record<string, string> | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === 'string' && value.trim().length > 0) {
			out[key] = value;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
}

function isWorkflowScope(value: unknown): value is WorkflowSpec['scope'] {
	return value === 'surface' || value === 'cross-app';
}

function isWorkflowStepType(value: unknown): value is WorkflowStep['type'] {
	return value === 'ensureServer' || value === 'navigate' || value === 'click' || value === 'assertText';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

registerSingleton(IWorkflowCatalogService, WorkflowCatalogService, InstantiationType.Delayed);

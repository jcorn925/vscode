/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** SQL vs document/key-value store vs no persistence. */
export type SurfaceDbKind = 'sql' | 'nosql' | 'none';

export interface SurfaceSchemaField {
	readonly name: string;
	readonly type?: string;
	readonly pk?: boolean;
	readonly notes?: string;
}

export interface SurfaceSchemaEntity {
	readonly name: string;
	readonly kind: 'table' | 'collection';
	readonly fields: readonly SurfaceSchemaField[];
	readonly notes?: string;
}

/** Structured data model for a surface (`workspace.goal.json` → `surfaces[].schema`). */
export interface SurfaceSchema {
	readonly dbKind: SurfaceDbKind;
	readonly engine?: string;
	readonly summary?: string;
	readonly entities: readonly SurfaceSchemaEntity[];
}

export interface SurfaceSchemaParseDiagnostic {
	readonly path: string;
	readonly message: string;
}

const INCOMPLETE = '—';

export function isSurfaceDbKind(value: string | undefined): value is SurfaceDbKind {
	return value === 'sql' || value === 'nosql' || value === 'none';
}

/** Compact rail badge: `postgres · 4 tables`, `No database`, or `—`. */
export function surfaceSchemaCardValue(schema: SurfaceSchema | undefined): string {
	if (!schema) {
		return INCOMPLETE;
	}
	if (schema.dbKind === 'none') {
		return 'No database';
	}
	const entities = schema.entities ?? [];
	const noun = schema.dbKind === 'nosql' ? 'collection' : 'table';
	const countLabel = entities.length === 1
		? `1 ${noun}`
		: `${entities.length} ${noun}s`;
	const engine = schema.engine?.trim();
	if (engine) {
		return entities.length ? `${engine} · ${countLabel}` : engine;
	}
	const kindLabel = schema.dbKind === 'nosql' ? 'NoSQL' : 'SQL';
	return entities.length ? `${kindLabel} · ${countLabel}` : kindLabel;
}

export function parseSurfaceSchema(
	raw: unknown,
	path: string,
	diagnostics: SurfaceSchemaParseDiagnostic[],
): SurfaceSchema | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (!isRecord(raw)) {
		diagnostics.push({ path, message: 'Schema must be an object.' });
		return undefined;
	}
	const dbKindRaw = typeof raw.dbKind === 'string' ? raw.dbKind.trim().toLowerCase() : '';
	if (!isSurfaceDbKind(dbKindRaw)) {
		diagnostics.push({ path: `${path}.dbKind`, message: 'Expected "sql", "nosql", or "none".' });
		return undefined;
	}
	const engine = optionalTrimmedString(raw.engine);
	const summary = optionalTrimmedString(raw.summary);
	const entitiesRaw = raw.entities;
	const entities: SurfaceSchemaEntity[] = [];
	if (entitiesRaw === undefined) {
		// ok — none / empty
	} else if (!Array.isArray(entitiesRaw)) {
		diagnostics.push({ path: `${path}.entities`, message: 'Expected an array of entities.' });
	} else {
		for (let i = 0; i < entitiesRaw.length; i++) {
			const entity = parseEntity(entitiesRaw[i], `${path}.entities[${i}]`, diagnostics);
			if (entity) {
				entities.push(entity);
			}
		}
	}
	return {
		dbKind: dbKindRaw,
		...(engine ? { engine } : {}),
		...(summary ? { summary } : {}),
		entities,
	};
}

function parseEntity(
	raw: unknown,
	path: string,
	diagnostics: SurfaceSchemaParseDiagnostic[],
): SurfaceSchemaEntity | undefined {
	if (!isRecord(raw)) {
		diagnostics.push({ path, message: 'Entity must be an object.' });
		return undefined;
	}
	const name = optionalTrimmedString(raw.name);
	if (!name) {
		diagnostics.push({ path: `${path}.name`, message: 'Expected a non-empty string.' });
		return undefined;
	}
	const kindRaw = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
	const kind: 'table' | 'collection' = kindRaw === 'collection' ? 'collection' : 'table';
	if (kindRaw && kindRaw !== 'table' && kindRaw !== 'collection') {
		diagnostics.push({ path: `${path}.kind`, message: 'Expected "table" or "collection".' });
	}
	const fieldsRaw = raw.fields;
	const fields: SurfaceSchemaField[] = [];
	if (fieldsRaw === undefined) {
		// ok
	} else if (!Array.isArray(fieldsRaw)) {
		diagnostics.push({ path: `${path}.fields`, message: 'Expected an array of fields.' });
	} else {
		for (let i = 0; i < fieldsRaw.length; i++) {
			const field = parseField(fieldsRaw[i], `${path}.fields[${i}]`, diagnostics);
			if (field) {
				fields.push(field);
			}
		}
	}
	const notes = optionalTrimmedString(raw.notes);
	return {
		name,
		kind,
		fields,
		...(notes ? { notes } : {}),
	};
}

function parseField(
	raw: unknown,
	path: string,
	diagnostics: SurfaceSchemaParseDiagnostic[],
): SurfaceSchemaField | undefined {
	if (!isRecord(raw)) {
		diagnostics.push({ path, message: 'Field must be an object.' });
		return undefined;
	}
	const name = optionalTrimmedString(raw.name);
	if (!name) {
		diagnostics.push({ path: `${path}.name`, message: 'Expected a non-empty string.' });
		return undefined;
	}
	const type = optionalTrimmedString(raw.type);
	const notes = optionalTrimmedString(raw.notes);
	return {
		name,
		...(type ? { type } : {}),
		...(raw.pk === true ? { pk: true as const } : {}),
		...(notes ? { notes } : {}),
	};
}

function optionalTrimmedString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

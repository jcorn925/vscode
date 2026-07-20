/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	parseSurfaceSchema,
	surfaceSchemaCardValue,
	type SurfaceSchema,
} from '../../../../../../custom/goalWorkspace/surfaceSchema.js';

suite('surfaceSchema', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('surfaceSchemaCardValue formats engine and counts', () => {
		assert.strictEqual(surfaceSchemaCardValue(undefined), '—');
		assert.strictEqual(surfaceSchemaCardValue({ dbKind: 'none', entities: [] }), 'No database');
		assert.strictEqual(surfaceSchemaCardValue({
			dbKind: 'sql',
			engine: 'postgres',
			entities: [
				{ name: 'users', kind: 'table', fields: [] },
				{ name: 'orders', kind: 'table', fields: [] },
			],
		}), 'postgres · 2 tables');
		assert.strictEqual(surfaceSchemaCardValue({
			dbKind: 'nosql',
			engine: 'mongodb',
			entities: [{ name: 'sessions', kind: 'collection', fields: [] }],
		}), 'mongodb · 1 collection');
		assert.strictEqual(surfaceSchemaCardValue({ dbKind: 'sql', entities: [] }), 'SQL');
	});

	test('parseSurfaceSchema accepts sql/nosql/none shapes', () => {
		const diagnostics: Array<{ path: string; message: string }> = [];
		const schema = parseSurfaceSchema({
			dbKind: 'sql',
			engine: 'postgres',
			summary: 'Booking data.',
			entities: [{
				name: 'bookings',
				kind: 'table',
				fields: [
					{ name: 'id', type: 'uuid', pk: true },
					{ name: 'email', type: 'text' },
				],
			}],
		}, '$.surfaces[0].schema', diagnostics);
		assert.deepStrictEqual(diagnostics, []);
		assert.deepStrictEqual(schema, {
			dbKind: 'sql',
			engine: 'postgres',
			summary: 'Booking data.',
			entities: [{
				name: 'bookings',
				kind: 'table',
				fields: [
					{ name: 'id', type: 'uuid', pk: true },
					{ name: 'email', type: 'text' },
				],
			}],
		} satisfies SurfaceSchema);

		const none = parseSurfaceSchema({ dbKind: 'none' }, '$.surfaces[0].schema', []);
		assert.deepStrictEqual(none, { dbKind: 'none', entities: [] });
	});

	test('parseSurfaceSchema rejects invalid dbKind', () => {
		const diagnostics: Array<{ path: string; message: string }> = [];
		assert.strictEqual(parseSurfaceSchema({ dbKind: 'graph' }, '$.schema', diagnostics), undefined);
		assert.ok(diagnostics.some(d => d.path === '$.schema.dbKind'));
	});
});

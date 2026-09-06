import { col, defineTable } from '@core/db/descriptor';
import { defineTables } from '@core/module-kit';

/**
 * One tenant-scoped table, prefixed with the module namespace (G-9). Migrated by the same
 * `bun db:migrate` as core tables (O-1) — the module never ships its own migration runner.
 */
export default defineTables('Dummy', [
  defineTable({
    name: 'dummy_notes',
    tenant: true,
    columns: {
      title: col.varchar(191),
      body: col.text().nullable(),
      state: col.enum(['draft', 'published'], 16).default('draft'),
      tags: col.json().nullable(),
    },
    indexes: [{ columns: ['client_id', 'state'] }],
  }),
]);

import { col, defineTable } from '@core/db';
import { defineTables } from '@core/module-kit';

/** Tables (extension point 1). Tenant-scoped: every row carries client_id and every query goes through the facade (B-3). */
export default defineTables('Hello', [
  defineTable({
    name: 'hello_notes',
    tenant: true,
    columns: {
      title: col.varchar(191),
      body: col.text().nullable(),
      pinned: col.boolean().default(false),
    },
    indexes: [{ columns: ['client_id', 'created_at'] }],
  }),
]);

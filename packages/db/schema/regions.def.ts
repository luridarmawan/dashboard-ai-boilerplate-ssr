import { col, defineTable } from '../src/descriptor.ts';

/**
 * Administrative regions — shared reference data, not tenant data, so the table is global.
 * Loaded by `api regions` / `bun db:regions` (never by a migration: the data set is large and
 * revised independently of the schema). For Indonesia the levels are:
 *   1 province (`11`), 2 regency / city (`11.01`), 3 district / kecamatan (`11.01.01`),
 *   4 village / kelurahan / desa (`11.01.01.2001`).
 * `code` is the natural key and is hierarchical: a child's code starts with `<parent_code>.`.
 * Tenants and modules store these codes (`clients.province_id`, …) instead of foreign keys, so a
 * re-import never orphans a row.
 */
export const regions = defineTable({
  name: 'regions',
  tenant: false,
  softDelete: false,
  columns: {
    code: col.identifier(16),
    parent_code: col.identifier(16).nullable(),
    /** ISO 3166-1 alpha-2 (`ID`); room for alpha-3. */
    country_code: col.identifier(3).default('ID'),
    level: col.int(),
    name: col.varchar(191),
  },
  indexes: [
    { columns: ['code'], unique: true },
    { columns: ['parent_code'] },
    { columns: ['country_code', 'level'] },
  ],
});

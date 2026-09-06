import { col, defineTable } from '../src/descriptor.ts';

/**
 * Tenant (B-1). A global table — it is NOT itself tenant-scoped; hierarchy goes through
 * `parent_id`. One default tenant is seeded for single-tenant installs (B-5).
 */
export const clients = defineTable({
  name: 'clients',
  tenant: false,
  columns: {
    parent_id: col.uuid().nullable(),
    /** Unique slug for URLs and the X-Client-ID header; ascii_bin for strict comparison. */
    code: col.identifier(32),
    name: col.varchar(191),
    /** Small per-tenant preferences. Never queried into (§4.3). */
    settings: col.json().nullable(),
  },
  indexes: [{ columns: ['code'], unique: true }, { columns: ['parent_id'] }],
});

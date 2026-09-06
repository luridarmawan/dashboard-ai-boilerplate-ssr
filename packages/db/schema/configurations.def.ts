import { col, defineTable } from '../src/descriptor.ts';

/**
 * Runtime configuration (PRD E-1, E-2, Decision I). Per tenant with fallback to global:
 * `scope` is the tenant id or the literal `global` — a real column, because a nullable
 * `client_id` cannot carry a UNIQUE constraint on MySQL (NULLs never collide). `client_id`
 * stays as the foreign key for cascade on tenant deletion. Not a tenant-scoped table for the
 * facade: reading a tenant's config MUST also read the global rows (E-2).
 */
export const configurations = defineTable({
  name: 'configurations',
  tenant: false,
  softDelete: false,
  columns: {
    scope: col.identifier(36),
    client_id: col.uuid().references('clients', 'cascade').nullable(),
    section: col.identifier(64),
    sub: col.identifier(64).nullable(),
    key: col.identifier(191),
    value: col.text().nullable(),
    type: col.identifier(16),
    title: col.varchar(191).nullable(),
    note: col.text().nullable(),
    order: col.int().default(100),
    public: col.boolean().default(false),
    updated_by: col.uuid().nullable(),
  },
  indexes: [{ columns: ['scope', 'key'], unique: true }, { columns: ['section'] }],
});

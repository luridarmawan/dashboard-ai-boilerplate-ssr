import { col, defineTable } from '../src/descriptor.ts';

/** Permission groups, per tenant (C-3). `is_system` marks the seeded Administrator / Regular User (O-3). */
export const groups = defineTable({
  name: 'groups',
  tenant: true,
  columns: {
    code: col.identifier(64),
    name: col.varchar(191),
    description: col.text().nullable(),
    is_system: col.boolean().default(false),
  },
  indexes: [{ columns: ['client_id', 'code'], unique: true }],
});

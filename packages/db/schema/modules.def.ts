import { col, defineTable } from '../src/descriptor.ts';

/**
 * Module state per tenant (PRD G-8): enabled/disabled, with a global default row
 * (`scope = 'global'`). A disabled module keeps its tables; its menu, routes, widgets, themes
 * and public pages disappear for that tenant. Absence of a row = enabled (installed modules
 * are on by default).
 */
export const modules = defineTable({
  name: 'modules',
  tenant: false,
  softDelete: false,
  columns: {
    scope: col.identifier(36),
    client_id: col.uuid().references('clients', 'cascade').nullable(),
    module: col.identifier(64),
    enabled: col.boolean().default(true),
    updated_by: col.uuid().nullable(),
  },
  indexes: [{ columns: ['scope', 'module'], unique: true }],
});

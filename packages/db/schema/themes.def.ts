import { col, defineTable } from '../src/descriptor.ts';

/**
 * Themes assembled in the admin UI (PRD L-24): token values, an icon set and layouts chosen from
 * what is registered, saved as a new theme without a deploy. Global (`scope = 'global'`) or per
 * tenant. Built-in and module themes are NOT here — they are files validated at build time; this
 * table only holds the ones an admin composed, and the same contrast rules (L-21) gate a save.
 */
export const themes = defineTable({
  name: 'themes',
  tenant: false,
  columns: {
    scope: col.identifier(36),
    client_id: col.uuid().references('clients', 'cascade').nullable(),
    /** Theme id as the registry sees it: `custom.<slug>`. Unique per scope. */
    code: col.identifier(64),
    name: col.json(),
    description: col.json().nullable(),
    /** Registered theme the tokens were copied from at creation (informational). */
    base: col.identifier(64),
    /** `{ light: { token: value }, dark: { token: value } }` — full sets, validated for AA contrast. */
    tokens: col.json(),
    icons: col.identifier(64),
    /** `{ dashboard: { default: layoutId, … }, public: {…}, auth: {…} }` — registered layouts only. */
    layouts: col.json(),
    /** `{ logo?: fileId, favicon?: fileId }` — public files from the `files` table (Q-16). */
    assets: col.json().nullable(),
    enabled: col.boolean().default(true),
    updated_by: col.uuid().nullable(),
  },
  indexes: [{ columns: ['scope', 'code'], unique: true }],
});

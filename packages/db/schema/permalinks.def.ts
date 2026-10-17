import { col, defineTable } from '../src/descriptor.ts';

/**
 * Permalink registry (PRD F-12): which module answers a URL at the root of the site, and the
 * history of URLs that moved. Modules register the public path of each piece of content they
 * own (`/about-us` → Pages, `/how-to-grow-chilli` → Articles, `/shoes/sneaker-x` → Commerce);
 * the web looks an unknown URL up here — one indexed query, whatever the number of modules —
 * before the 404 handler (F-11) is asked. Tenant-scoped: every tenant has its own site.
 *
 * INVARIANT kept by `apps/api/src/permalinks.ts`: a path is held by exactly one row per tenant
 * (that is the unique index), so two modules can never claim the same URL. Per (module, target)
 * there is at most one `canonical` row; `redirect` rows are its old paths and name the TARGET,
 * not a path, so every old URL answers 301 straight to the current one — no chains, no loops.
 */
export const permalinks = defineTable({
  name: 'permalinks',
  tenant: true,
  // History, not a record anyone edits: rows are replaced or removed outright.
  softDelete: false,
  columns: {
    /** Normalised path: lower-case slug segments, leading slash, no trailing slash. */
    path: col.identifier(255),
    /** Namespace of the owning module (`pages`, `articles`, …). */
    module: col.identifier(64),
    /** The module's own id for the content (a row id, a SKU — anything it can render). */
    target: col.identifier(64),
    /** canonical | redirect */
    kind: col.identifier(16).default('canonical'),
    /**
     * Served to visitors. A draft keeps its path reserved (nobody else may take it) but the URL,
     * and every redirect to it, answers 404 until the module marks it live.
     */
    live: col.boolean().default(false),
  },
  indexes: [
    { columns: ['client_id', 'path'], unique: true },
    { columns: ['client_id', 'module', 'target'] },
  ],
});

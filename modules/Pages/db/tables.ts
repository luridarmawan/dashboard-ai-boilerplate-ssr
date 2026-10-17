import { col, defineTable } from '@core/db';
import { defineTables } from '@core/module-kit';

/**
 * Tables of the Pages module (extension point 1). Both are tenant-scoped: every tenant has its
 * own pages and its own permalink history, served from the root of the site (`/<slug>`) while
 * this module is the tenant's 404 handler.
 *
 * INVARIANT kept by `api/permalinks.ts`: within one tenant a slug is EITHER the current slug of
 * one page OR the old slug of one redirect, never both and never twice. That is what makes
 * every old permalink answer with a single 301 straight to the current one (no chains, no loops):
 * a redirect names its target PAGE, not a target slug, so renaming a page again moves every old
 * permalink along with it for free.
 */
export default defineTables('Pages', [
  defineTable({
    name: 'pages_pages',
    tenant: true,
    columns: {
      title: col.varchar(191),
      /** The page's public URL is `/<slug>`. Freed on delete (see the delete route). */
      slug: col.identifier(120),
      /** Meta description and list teaser. */
      summary: col.varchar(512).nullable(),
      /** Markdown, rendered and sanitised by the API. */
      body: col.text().nullable(),
      /** draft | published */
      status: col.identifier(16).default('draft'),
      /**
       * Set the first time the page is published and never cleared. A slug change creates a
       * redirect only when this is set: a page nobody could ever visit has no old URL to keep.
       */
      published_at: col.datetime().nullable(),
      /**
       * Featured image: a PUBLIC row in core `files` (kind `pages.featured`), shown above the body
       * and used as `og:image`. Not a foreign key, for the same reasons as `pages_redirects`.
       */
      image_id: col.uuid().nullable(),
      /** Alt text of the featured image (also `og:image:alt`). */
      image_alt: col.varchar(191).nullable(),
    },
    indexes: [
      { columns: ['client_id', 'slug'], unique: true },
      { columns: ['client_id', 'status'] },
      // The public media route looks a page up by its image.
      { columns: ['client_id', 'image_id'] },
    ],
  }),
  defineTable({
    name: 'pages_redirects',
    tenant: true,
    // History, not a record anyone edits: a row is removed outright when its page is deleted, so
    // the old slug is free again and no redirect outlives the page it pointed to.
    softDelete: false,
    columns: {
      /**
       * The page the old slug now belongs to. Deliberately NOT a foreign key: pages are soft
       * deleted (the redirects are removed by the same transaction instead), and a generated FK
       * name would flirt with MySQL's 64-character limit once TABLE_PREFIX is applied.
       */
      page_id: col.uuid(),
      old_slug: col.identifier(120),
    },
    indexes: [
      { columns: ['client_id', 'old_slug'], unique: true },
      { columns: ['client_id', 'page_id'] },
    ],
  }),
]);

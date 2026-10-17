import { col, defineTable } from '@core/db';
import { defineTables } from '@core/module-kit';

/**
 * Tables of the Pages module (extension point 1). Tenant-scoped: every tenant has its own pages,
 * served at the root of its site (`/<slug>`). The URL itself — uniqueness across modules, the
 * 301 history of old slugs, what a visitor's URL resolves to — lives in the core permalink
 * registry (`permalinks`, PRD F-12); `slug` here is the page's copy of its current one.
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
       * Set the first time the page is published and never cleared. A slug change keeps the old
       * URL as a 301 only when this is set: a page nobody could ever visit has no old URL to keep.
       */
      published_at: col.datetime().nullable(),
      /**
       * Featured image: a PUBLIC row in core `files` (kind `pages.featured`), shown above the body
       * and used as `og:image`. Deliberately not a foreign key: files are soft-deleted, and the
       * generated constraint name would flirt with MySQL's 64-character limit once TABLE_PREFIX
       * is applied.
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
]);

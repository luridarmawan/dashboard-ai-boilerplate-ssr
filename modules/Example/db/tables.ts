import { col, defineTable } from '@core/db';
import { defineTables } from '@core/module-kit';

/**
 * Tables of the Example module (extension point 1). Tenant-scoped like any business data: the
 * public landing reads the DEFAULT tenant's rows (or the tenant named by X-Client-ID), so one
 * installation can host one storefront per tenant.
 */
export default defineTables('Example', [
  defineTable({
    name: 'example_products',
    tenant: true,
    columns: {
      slug: col.identifier(120),
      name: col.varchar(191),
      summary: col.varchar(512).nullable(),
      description: col.text().nullable(),
      /** Minor units (e.g. rupiah) — never floats for money. */
      price: col.int().default(0),
      currency: col.identifier(3).default('IDR'),
      image_url: col.varchar(512).nullable(),
      featured: col.boolean().default(false),
      sort: col.int().default(100),
    },
    indexes: [
      { columns: ['client_id', 'slug'], unique: true },
      { columns: ['client_id', 'featured', 'sort'] },
    ],
  }),
  defineTable({
    name: 'example_inquiries',
    tenant: true,
    softDelete: false,
    columns: {
      name: col.varchar(191),
      email: col.varchar(191),
      message: col.text(),
      /** Which public page the form was on. */
      source: col.varchar(191).nullable(),
      ip: col.identifier(45).nullable(),
      /** new | read | replied | spam */
      state: col.identifier(16).default('new'),
    },
    indexes: [{ columns: ['client_id', 'created_at'] }, { columns: ['client_id', 'state'] }],
  }),
  defineTable({
    name: 'example_testimonials',
    tenant: true,
    columns: {
      author: col.varchar(191),
      role: col.varchar(191).nullable(),
      quote: col.text(),
      avatar_url: col.varchar(512).nullable(),
      sort: col.int().default(100),
    },
    indexes: [{ columns: ['client_id', 'sort'] }],
  }),
]);

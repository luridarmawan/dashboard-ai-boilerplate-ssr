import { publicLink, sendTemplate } from '@app/api/mail';
import { notify } from '@app/api/notifications';
import { clientIp } from '@app/api/plugins/auth';
import { requestContext } from '@app/api/plugins/request-context';
import { permission, tenantContext } from '@app/api/plugins/tenancy';
import { settings } from '@app/api/services';
import { consumeRateLimit, parseRateLimitRule, rateLimitHeaders, writeAudit } from '@core/auth';
import {
  errorResponses,
  fail,
  Id,
  OkSchema,
  ok,
  PageSchema,
  page,
  pageMeta,
} from '@core/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  forTenant,
  isNull,
  newId,
  schema,
  unsafeAcrossTenants,
} from '@core/db';
import { defineApiRoutes } from '@core/module-kit';
import { Elysia, t } from 'elysia';
import { InquiryBody, InquiryStateBody, ProductBody, ProductUpdateBody } from './schemas.ts';

/**
 * Example API (extension point 2), mounted at /v1/m/example. Two halves:
 *   public  — storefront reads + the contact form (no session; rate limited; honeypot)
 *   admin   — CRUD behind `example.*` permissions, through the tenant facade (B-3)
 * The storefront tenant is the session's / X-Client-ID tenant, else the `default` tenant — one
 * installation, one storefront per tenant.
 */

let defaultTenantId: string | null = null;
async function storefrontTenant(clientId: string | null): Promise<string | null> {
  if (clientId) return clientId;
  if (defaultTenantId) return defaultTenantId;
  const [row] = await unsafeAcrossTenants()
    .select({ id: schema.clients.id })
    .from(schema.clients)
    .where(and(eq(schema.clients.code, 'default'), isNull(schema.clients.deleted_at)))
    .limit(1);
  defaultTenantId = row?.id ?? null;
  return defaultTenantId;
}

type ProductRow = typeof schema.exampleProducts.$inferSelect;
const Product = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  summary: t.Nullable(t.String()),
  description: t.Nullable(t.String()),
  price: t.Integer(),
  currency: t.String(),
  imageUrl: t.Nullable(t.String()),
  featured: t.Boolean(),
  sort: t.Integer(),
  updatedAt: t.String(),
});
const view = (p: ProductRow) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  summary: p.summary,
  description: p.description,
  price: p.price,
  currency: p.currency,
  imageUrl: p.image_url,
  featured: p.featured,
  sort: p.sort,
  updatedAt: p.updated_at.toISOString(),
});
const Testimonial = t.Object({
  id: t.String(),
  author: t.String(),
  role: t.Nullable(t.String()),
  quote: t.String(),
  avatarUrl: t.Nullable(t.String()),
});
const Inquiry = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  message: t.String(),
  source: t.Nullable(t.String()),
  state: t.String(),
  createdAt: t.String(),
});

export default defineApiRoutes(
  'Example',
  new Elysia({ name: 'module:example', tags: ['module:example'] })
    .use(requestContext)
    .use(tenantContext)

    // ---- public storefront ----
    .get(
      '/products',
      async ({ query, tenantState }) => {
        const tid = await storefrontTenant(tenantState?.clientId ?? null);
        if (!tid) return page([], pageMeta(1, 50, 0));
        const tenant = forTenant(tid);
        const rows = await tenant.select(
          schema.exampleProducts,
          and(
            isNull(schema.exampleProducts.deleted_at),
            query.featured === '1' ? eq(schema.exampleProducts.featured, true) : undefined,
          ),
        );
        const sorted = rows
          .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
          .slice(0, Number(query.limit ?? 50));
        return page(sorted.map(view), pageMeta(1, sorted.length || 1, rows.length));
      },
      {
        query: t.Object({ featured: t.Optional(t.String()), limit: t.Optional(t.String()) }),
        response: { 200: PageSchema(Product), ...errorResponses },
        detail: { summary: 'Storefront products (public; default tenant unless X-Client-ID)' },
      },
    )
    .get(
      '/products/:slug',
      async ({ params, set, requestId, tenantState }) => {
        const tid = await storefrontTenant(tenantState?.clientId ?? null);
        const row = tid
          ? await forTenant(tid).selectOne(
              schema.exampleProducts,
              and(
                eq(schema.exampleProducts.slug, params.slug),
                isNull(schema.exampleProducts.deleted_at),
              ),
            )
          : null;
        if (!row) {
          set.status = 404;
          return fail('not_found', 'Produk tidak ditemukan', requestId);
        }
        return ok(view(row));
      },
      {
        params: t.Object({ slug: t.String({ maxLength: 120 }) }),
        response: { 200: OkSchema(Product), ...errorResponses },
        detail: { summary: 'One product by slug (public)' },
      },
    )
    .get(
      '/testimonials',
      async ({ tenantState }) => {
        const tid = await storefrontTenant(tenantState?.clientId ?? null);
        if (!tid) return ok([]);
        const rows = await forTenant(tid).select(
          schema.exampleTestimonials,
          isNull(schema.exampleTestimonials.deleted_at),
        );
        return ok(
          rows
            .sort((a, b) => a.sort - b.sort)
            .map((r) => ({
              id: r.id,
              author: r.author,
              role: r.role,
              quote: r.quote,
              avatarUrl: r.avatar_url,
            })),
        );
      },
      {
        response: { 200: OkSchema(t.Array(Testimonial)), ...errorResponses },
        detail: { summary: 'Testimonials (public)' },
      },
    )
    .get(
      '/sitemap',
      async ({ tenantState }) => {
        const tid = await storefrontTenant(tenantState?.clientId ?? null);
        if (!tid) return ok([]);
        const rows = await forTenant(tid).select(
          schema.exampleProducts,
          isNull(schema.exampleProducts.deleted_at),
        );
        return ok(
          rows.map((r) => ({ path: `/product/${r.slug}`, lastmod: r.updated_at.toISOString() })),
        );
      },
      {
        response: {
          200: OkSchema(t.Array(t.Object({ path: t.String(), lastmod: t.String() }))),
          ...errorResponses,
        },
        detail: { summary: 'Dynamic public paths for sitemap.xml (F-7, R-4)' },
      },
    )
    .post(
      '/inquiries',
      async ({ body, set, request, server, requestId, tenantState }) => {
        const tid = await storefrontTenant(tenantState?.clientId ?? null);
        if (!tid) {
          set.status = 503;
          return fail(
            'service_unavailable',
            'Etalase belum disiapkan (tenant default belum ada)',
            requestId,
          );
        }
        // Honeypot (R-5): a filled hidden field is a bot — answer as if stored, store nothing.
        if (body.website) return ok({ received: true as const });
        const db = unsafeAcrossTenants();
        const ip = clientIp(request, server) ?? 'unknown';
        const rule = parseRateLimitRule(
          (await settings.get<string | null>(tid, 'example.inquiry_rate_limit')) ?? '5/3600',
        );
        const rl = await consumeRateLimit(db, `example:inquiry:${ip}`, rule);
        Object.assign(set.headers, rateLimitHeaders(rl));
        if (!rl.allowed) {
          set.status = 429;
          return fail('rate_limited', 'Terlalu banyak pesan dari alamat ini', requestId);
        }
        const tenant = forTenant(tid);
        const id = newId();
        await tenant.insert(schema.exampleInquiries, {
          id,
          name: body.name.trim(),
          email: body.email.trim().toLowerCase(),
          message: body.message.trim(),
          source: body.source ?? null,
          ip,
        });
        const to = await settings.get<string | null>(tid, 'example.contact_email');
        if (to) {
          await sendTemplate(db, {
            to,
            template: 'contact',
            locale: 'id',
            clientId: tid,
            data: {
              name: body.name.trim(),
              email: body.email.trim(),
              message: body.message.trim(),
              link: publicLink('/m/example/inquiries'),
            },
          });
        }
        // J-4: whoever may read inquiries in this tenant gets a bell notification (no email needed).
        await notify({
          clientId: tid,
          permission: 'example.inquiry.read',
          type: 'example.inquiry',
          title: `Pesan baru dari ${body.name.trim()}`,
          body: body.message.trim().slice(0, 200),
          link: '/m/example/inquiries',
          data: { inquiryId: id },
        });
        await writeAudit(db, {
          clientId: tid,
          actorId: null,
          action: 'example.inquiry.create',
          resource: 'example.inquiry',
          resourceId: id,
          ip,
          requestId,
          after: { email: body.email.trim().toLowerCase(), source: body.source ?? null },
        });
        set.status = 201;
        return ok({ received: true as const });
      },
      {
        body: InquiryBody,
        response: {
          200: OkSchema(t.Object({ received: t.Literal(true) })),
          201: OkSchema(t.Object({ received: t.Literal(true) })),
          ...errorResponses,
        },
        detail: {
          summary:
            'Contact form (public): rate limited, honeypot, stored, emailed via outbox (R-5)',
        },
      },
    )

    // ---- admin: products ----
    .get(
      '/admin/products',
      async ({ tenantState }) => {
        if (!tenantState?.tenant) return page([], pageMeta(1, 1, 0));
        const rows = await tenantState.tenant.select(
          schema.exampleProducts,
          isNull(schema.exampleProducts.deleted_at),
        );
        const sorted = rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
        return page(sorted.map(view), pageMeta(1, Math.max(1, sorted.length), sorted.length));
      },
      {
        beforeHandle: permission('example.product.read'),
        response: { 200: PageSchema(Product), ...errorResponses },
        detail: { summary: 'All products of the active tenant (admin)' },
      },
    )
    .get(
      '/admin/products/:id',
      async ({ params, set, requestId, tenantState }) => {
        const row = tenantState?.tenant
          ? await tenantState.tenant.selectOne(
              schema.exampleProducts,
              and(
                eq(schema.exampleProducts.id, params.id),
                isNull(schema.exampleProducts.deleted_at),
              ),
            )
          : null;
        if (!row) {
          set.status = 404;
          return fail('not_found', 'Produk tidak ditemukan', requestId);
        }
        return ok(view(row));
      },
      {
        beforeHandle: permission('example.product.read'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(Product), ...errorResponses },
        detail: { summary: 'One product (admin)' },
      },
    )
    .post(
      '/admin/products',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        if (!tenant || !tenantState.clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const dup = await tenant.selectOne(
          schema.exampleProducts,
          eq(schema.exampleProducts.slug, body.slug),
        );
        if (dup) {
          set.status = 409;
          return fail('conflict', `Slug "${body.slug}" sudah dipakai`, requestId);
        }
        const id = newId();
        await tenant.insert(schema.exampleProducts, {
          id,
          slug: body.slug,
          name: body.name,
          summary: body.summary ?? null,
          description: body.description ?? null,
          price: body.price,
          currency: body.currency ?? 'IDR',
          image_url: body.imageUrl ?? null,
          featured: body.featured ?? false,
          sort: body.sort ?? 100,
        });
        const row = (await tenant.selectOne(
          schema.exampleProducts,
          eq(schema.exampleProducts.id, id),
        )) as ProductRow;
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: auth?.user.id ?? null,
          action: 'example.product.create',
          resource: 'example.product',
          resourceId: id,
          ip: clientIp(request, server),
          requestId,
          after: view(row),
        });
        set.status = 201;
        return ok(view(row));
      },
      {
        beforeHandle: permission('example.product.create'),
        body: ProductBody,
        response: { 201: OkSchema(Product), ...errorResponses },
        detail: { summary: 'Create a product' },
      },
    )
    .put(
      '/admin/products/:id',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const before = tenant
          ? await tenant.selectOne(
              schema.exampleProducts,
              and(
                eq(schema.exampleProducts.id, params.id),
                isNull(schema.exampleProducts.deleted_at),
              ),
            )
          : null;
        if (!tenant || !before || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Produk tidak ditemukan', requestId);
        }
        if (body.slug && body.slug !== before.slug) {
          const dup = await tenant.selectOne(
            schema.exampleProducts,
            eq(schema.exampleProducts.slug, body.slug),
          );
          if (dup) {
            set.status = 409;
            return fail('conflict', `Slug "${body.slug}" sudah dipakai`, requestId);
          }
        }
        const patch: Partial<typeof schema.exampleProducts.$inferInsert> = {};
        if (body.slug !== undefined) patch.slug = body.slug;
        if (body.name !== undefined) patch.name = body.name;
        if (body.summary !== undefined) patch.summary = body.summary;
        if (body.description !== undefined) patch.description = body.description;
        if (body.price !== undefined) patch.price = body.price;
        if (body.currency !== undefined) patch.currency = body.currency;
        if (body.imageUrl !== undefined) patch.image_url = body.imageUrl;
        if (body.featured !== undefined) patch.featured = body.featured;
        if (body.sort !== undefined) patch.sort = body.sort;
        if (Object.keys(patch).length)
          await tenant.update(
            schema.exampleProducts,
            patch,
            eq(schema.exampleProducts.id, before.id),
          );
        const after = (await tenant.selectOne(
          schema.exampleProducts,
          eq(schema.exampleProducts.id, before.id),
        )) as ProductRow;
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: auth?.user.id ?? null,
          action: 'example.product.edit',
          resource: 'example.product',
          resourceId: before.id,
          ip: clientIp(request, server),
          requestId,
          before: view(before),
          after: view(after),
        });
        return ok(view(after));
      },
      {
        beforeHandle: permission('example.product.edit'),
        params: t.Object({ id: Id }),
        body: ProductUpdateBody,
        response: { 200: OkSchema(Product), ...errorResponses },
        detail: { summary: 'Edit a product' },
      },
    )
    .delete(
      '/admin/products/:id',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const row = tenant
          ? await tenant.selectOne(
              schema.exampleProducts,
              and(
                eq(schema.exampleProducts.id, params.id),
                isNull(schema.exampleProducts.deleted_at),
              ),
            )
          : null;
        if (!tenant || !row || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Produk tidak ditemukan', requestId);
        }
        await tenant.update(
          schema.exampleProducts,
          { deleted_at: new Date() },
          eq(schema.exampleProducts.id, row.id),
        );
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: auth?.user.id ?? null,
          action: 'example.product.delete',
          resource: 'example.product',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          before: view(row),
        });
        return ok({ deleted: true as const });
      },
      {
        beforeHandle: permission('example.product.manage'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
        detail: { summary: 'Soft-delete a product' },
      },
    )

    // ---- admin: inquiries ----
    .get(
      '/admin/inquiries',
      async ({ query, tenantState }) => {
        if (!tenantState?.tenant || !tenantState.clientId) return page([], pageMeta(1, 20, 0));
        const db = unsafeAcrossTenants(); // paging query; tenant condition explicit
        const p = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
        const where = and(
          eq(schema.exampleInquiries.client_id, tenantState.clientId),
          query.state ? eq(schema.exampleInquiries.state, query.state) : undefined,
        );
        const [tot] = await db.select({ n: count() }).from(schema.exampleInquiries).where(where);
        const rows = await db
          .select()
          .from(schema.exampleInquiries)
          .where(where)
          .orderBy(desc(schema.exampleInquiries.created_at))
          .limit(limit)
          .offset((p - 1) * limit);
        return page(
          rows.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            message: r.message,
            source: r.source,
            state: r.state,
            createdAt: r.created_at.toISOString(),
          })),
          pageMeta(p, limit, Number(tot?.n ?? 0)),
        );
      },
      {
        beforeHandle: permission('example.inquiry.read'),
        query: t.Object({
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          state: t.Optional(t.String()),
        }),
        response: { 200: PageSchema(Inquiry), ...errorResponses },
        detail: { summary: 'Inquiries of the active tenant, newest first' },
      },
    )
    .put(
      '/admin/inquiries/:id',
      async ({ params, body, set, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const n = tenant
          ? await tenant.update(
              schema.exampleInquiries,
              { state: body.state },
              eq(schema.exampleInquiries.id, params.id),
            )
          : 0;
        if (!n) {
          set.status = 404;
          return fail('not_found', 'Pesan tidak ditemukan', requestId);
        }
        return ok({ id: params.id, state: body.state });
      },
      {
        beforeHandle: permission('example.inquiry.manage'),
        params: t.Object({ id: Id }),
        body: InquiryStateBody,
        response: {
          200: OkSchema(t.Object({ id: t.String(), state: t.String() })),
          ...errorResponses,
        },
        detail: { summary: 'Set an inquiry state (new/read/replied/spam)' },
      },
    ),
);
// Note: the sort column is ordered in memory above; `asc` stays imported for a DB-side orderBy when the catalogue grows.
void asc;

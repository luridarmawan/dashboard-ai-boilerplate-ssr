import { readFile, removeFile, storeUpload } from '@app/api/files';
import { clientIp } from '@app/api/plugins/auth';
import { requestContext } from '@app/api/plugins/request-context';
import { permission, tenantContext } from '@app/api/plugins/tenancy';
import { settings } from '@app/api/services';
import { writeAudit } from '@core/auth';
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
  eq,
  forTenant,
  isNull,
  newId,
  schema,
  type TenantDb,
  unsafeAcrossTenants,
} from '@core/db';
import { defineApiRoutes } from '@core/module-kit';
import { Elysia, t } from 'elysia';
import {
  adminUrl,
  FEATURED_KIND,
  FEATURED_MAX_BYTES,
  FEATURED_TYPES,
  featuredFile,
  featuredMeta,
  mediaPath,
  sizeOf,
} from './featured.ts';
import { renderMarkdown } from './markdown.ts';
import {
  applySlugChange,
  assertSlugFree,
  inTransaction,
  isUniqueViolation,
  redirectsOf,
  resolvePath,
  type SlugChangeResult,
  SlugConflictError,
  slugify,
} from './permalinks.ts';
import { ImageBody, PageBody, PageUpdateBody, SlugBody } from './schemas.ts';

/**
 * Pages API (extension point 2), mounted at /v1/m/pages. Two halves:
 *   public  — `/resolve` (what a root URL is: a page, an old permalink, or nothing) and
 *             `/sitemap`, both for the anonymous site; the tenant is the session's / X-Client-ID
 *             one, else the `default` tenant
 *             plus `/media/:fileId`, the featured image of a published page (og:image)
 *   admin   — CRUD behind `pages.page.*`, through the tenant facade; every slug change runs in one
 *             transaction with the redirect it creates (see ./permalinks.ts); featured image
 *             upload/removal through core `storeUpload()` (see ./featured.ts)
 */

/** The public route the 404 handler setting must name for root URLs to be ours (see public.ts). */
const TRAP_ROUTE = '/pages';

let defaultTenantId: string | null = null;
async function siteTenant(clientId: string | null): Promise<string | null> {
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

type Row = typeof schema.pagesPages.$inferSelect;
const Page = t.Object({
  id: t.String(),
  title: t.String(),
  slug: t.String(),
  summary: t.Nullable(t.String()),
  body: t.Nullable(t.String()),
  status: t.String(),
  publishedAt: t.Nullable(t.String()),
  imageId: t.Nullable(t.String()),
  imageAlt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});
const view = (r: Row) => ({
  id: r.id,
  title: r.title,
  slug: r.slug,
  summary: r.summary,
  body: r.body,
  status: r.status,
  publishedAt: r.published_at ? r.published_at.toISOString() : null,
  imageId: r.image_id,
  imageAlt: r.image_alt,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
/** A featured image: where to fetch it and what it is (size feeds og:image:width/height). */
const Image = t.Object({
  url: t.String(),
  width: t.Nullable(t.Integer()),
  height: t.Nullable(t.Integer()),
  mime: t.String(),
  alt: t.Nullable(t.String()),
});
/** A page as the dashboard edits it: plus its old permalinks and its featured image. */
const PageDetail = t.Composite([
  Page,
  t.Object({
    redirects: t.Array(t.Object({ oldSlug: t.String(), createdAt: t.String() })),
    image: t.Nullable(Image),
  }),
]);
const detail = async (tenant: TenantDb, r: Row) => {
  const file = r.image_id ? await featuredFile(tenant.clientId, r.image_id) : null;
  return {
    ...view(r),
    redirects: await redirectsOf(tenant, r.id),
    image: file ? { url: adminUrl(file), alt: r.image_alt, ...featuredMeta(file) } : null,
  };
};
const SlugChange = t.Object({
  changed: t.Boolean(),
  redirected: t.Boolean(),
  from: t.String(),
  to: t.String(),
});

/** What a visitor sees: no draft fields, the body already rendered. */
const PublicPage = t.Object({
  title: t.String(),
  slug: t.String(),
  summary: t.Nullable(t.String()),
  html: t.String(),
  /** The featured image at its public media URL — what crawlers fetch for og:image. */
  image: t.Nullable(Image),
  publishedAt: t.Nullable(t.String()),
  updatedAt: t.String(),
});
const publicView = async (clientId: string, r: Row) => {
  const file = r.image_id ? await featuredFile(clientId, r.image_id) : null;
  return {
    title: r.title,
    slug: r.slug,
    summary: r.summary,
    html: renderMarkdown(r.body),
    image: file ? { url: mediaPath(file.id), alt: r.image_alt, ...featuredMeta(file) } : null,
    publishedAt: r.published_at ? r.published_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
  };
};
const Resolved = t.Union([
  t.Object({ kind: t.Literal('page'), page: PublicPage }),
  t.Object({ kind: t.Literal('redirect'), location: t.String() }),
]);

const live = (id: string) =>
  and(eq(schema.pagesPages.id, id), isNull(schema.pagesPages.deleted_at));

/** A taken slug as the envelope the dashboard maps to a field error (`details.reason`). */
function slugConflict(err: SlugConflictError, requestId: string) {
  return fail(
    'conflict',
    err.holder === 'page'
      ? `Slug "${err.slug}" sudah dipakai halaman lain`
      : `Slug "${err.slug}" masih dipakai sebagai alamat lama halaman lain`,
    requestId,
    { field: 'slug', reason: err.holder === 'page' ? 'slug_taken' : 'slug_redirected' },
  );
}
/** Two saves racing for one slug: the unique index refuses the loser, the transaction is undone. */
function raceConflict(requestId: string) {
  return fail('conflict', 'Slug baru saja dipakai perubahan lain, coba lagi', requestId, {
    field: 'slug',
    reason: 'slug_race',
  });
}

export default defineApiRoutes(
  'Pages',
  new Elysia({ name: 'module:pages', tags: ['module:pages'] })
    .use(requestContext)
    .use(tenantContext)

    // ---- public ----
    .get(
      '/resolve',
      async ({ query, set, requestId, tenantState }) => {
        const tid = await siteTenant(tenantState?.clientId ?? null);
        const hit = tid ? await resolvePath(forTenant(tid), query.path) : null;
        if (!hit) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        if (hit.kind === 'redirect')
          return ok({ kind: 'redirect' as const, location: `/${hit.page.slug}` });
        return ok({ kind: 'page' as const, page: await publicView(tid as string, hit.page) });
      },
      {
        query: t.Object({ path: t.String({ maxLength: 512 }) }),
        response: { 200: OkSchema(Resolved), ...errorResponses },
        detail: {
          summary: 'Resolve a root URL',
          description:
            'Public. Maps `/<slug>` to a published page, or an old permalink to the current one ' +
            '(`kind: redirect`, which the web answers with a 301). Anything else is 404.',
        },
      },
    )
    .get(
      '/media/:fileId',
      async ({ params, set, requestId, tenantState }) => {
        // Crawlers fetch this anonymously (no session, no X-Client-ID): the site tenant decides,
        // and only the image of a PUBLISHED page is served — a draft's image stays private.
        const tid = await siteTenant(tenantState?.clientId ?? null);
        const owner = tid
          ? await forTenant(tid).selectOne(
              schema.pagesPages,
              and(
                eq(schema.pagesPages.image_id, params.fileId),
                eq(schema.pagesPages.status, 'published'),
                isNull(schema.pagesPages.deleted_at),
              ),
            )
          : null;
        const file = owner && tid ? await featuredFile(tid, params.fileId) : null;
        const obj = file ? await readFile(file) : null;
        if (!file || !obj) {
          set.status = 404;
          return fail('not_found', 'Gambar tidak ditemukan', requestId);
        }
        return new Response(new Blob([obj.bytes as unknown as ArrayBuffer]), {
          headers: {
            'content-type': file.mime,
            'content-length': String(obj.bytes.byteLength),
            'x-content-type-options': 'nosniff',
            // The id never changes for a given image: a new upload is a new id.
            'cache-control': 'public, max-age=86400',
            'x-request-id': requestId,
          },
        });
      },
      {
        params: t.Object({ fileId: Id }),
        response: { 200: t.Unknown(), ...errorResponses },
        detail: {
          summary: 'Featured image of a page',
          description:
            'Public, for visitors and social crawlers (og:image). Served only while the page that ' +
            'uses it is published.',
        },
      },
    )
    .get(
      '/sitemap',
      async ({ tenantState }) => {
        const tid = await siteTenant(tenantState?.clientId ?? null);
        if (!tid) return ok([]);
        // Root URLs exist only while this module is the tenant's 404 handler: listing `/about-us`
        // in a sitemap that answers it with 404 would be worse than not listing it at all.
        if ((await settings.get<string | null>(tid, 'app.not_found_route')) !== TRAP_ROUTE)
          return ok([]);
        const rows = await forTenant(tid).select(
          schema.pagesPages,
          and(eq(schema.pagesPages.status, 'published'), isNull(schema.pagesPages.deleted_at)),
        );
        return ok(rows.map((r) => ({ path: `/${r.slug}`, lastmod: r.updated_at.toISOString() })));
      },
      {
        response: {
          200: OkSchema(t.Array(t.Object({ path: t.String(), lastmod: t.String() }))),
          ...errorResponses,
        },
        detail: {
          summary: 'Sitemap paths',
          description: 'Published pages, while this module answers unknown URLs.',
        },
      },
    )

    // ---- admin ----
    .get(
      '/pages',
      async ({ query, tenantState }) => {
        if (!tenantState?.tenant) return page([], pageMeta(1, 20, 0));
        const rows = await tenantState.tenant.select(
          schema.pagesPages,
          and(
            isNull(schema.pagesPages.deleted_at),
            query.status ? eq(schema.pagesPages.status, query.status) : undefined,
          ),
        );
        const q = query.q?.trim().toLowerCase();
        const list = rows
          .filter((r) => !q || `${r.title} ${r.slug}`.toLowerCase().includes(q))
          .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
        const p = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
        return page(
          list.slice((p - 1) * limit, p * limit).map(view),
          pageMeta(p, limit, list.length),
        );
      },
      {
        beforeHandle: permission('pages.page.read'),
        query: t.Object({
          q: t.Optional(t.String({ maxLength: 191 })),
          status: t.Optional(t.Union([t.Literal('draft'), t.Literal('published')])),
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        }),
        response: { 200: PageSchema(Page), ...errorResponses },
        detail: {
          summary: 'List pages',
          description: 'Most recently updated first. `q` searches title and slug.',
        },
      },
    )
    .get(
      '/pages/:id',
      async ({ params, set, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const row = tenant ? await tenant.selectOne(schema.pagesPages, live(params.id)) : null;
        if (!tenant || !row) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        return ok(await detail(tenant, row));
      },
      {
        beforeHandle: permission('pages.page.read'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(PageDetail), ...errorResponses },
        detail: {
          summary: 'Get a page',
          description: 'Includes the old permalinks that redirect to it.',
        },
      },
    )
    .post(
      '/pages',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
        const clientId = tenantState?.clientId;
        if (!tenantState?.tenant || !clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const id = newId();
        const slug = body.slug ?? slugify(body.title);
        const status = body.status ?? 'draft';
        try {
          await inTransaction(clientId, async (tenant) => {
            await assertSlugFree(tenant, slug);
            await tenant.insert(schema.pagesPages, {
              id,
              title: body.title,
              slug,
              summary: body.summary ?? null,
              body: body.body ?? null,
              status,
              published_at: status === 'published' ? new Date() : null,
            });
          });
        } catch (err) {
          set.status = 409;
          if (err instanceof SlugConflictError) return slugConflict(err, requestId);
          if (isUniqueViolation(err)) return raceConflict(requestId);
          throw err;
        }
        const row = (await tenantState.tenant.selectOne(schema.pagesPages, live(id))) as Row;
        await writeAudit(unsafeAcrossTenants(), {
          clientId,
          actorId: auth?.user.id ?? null,
          action: 'pages.page.create',
          resource: 'pages.page',
          resourceId: id,
          ip: clientIp(request, server),
          requestId,
          after: view(row),
        });
        set.status = 201;
        return ok(await detail(tenantState.tenant, row));
      },
      {
        beforeHandle: permission('pages.page.create'),
        body: PageBody,
        response: { 201: OkSchema(PageDetail), ...errorResponses },
        detail: {
          summary: 'Create a page',
          description:
            'An empty `slug` is derived from the title. A slug held by another page, or still ' +
            'redirecting to one, is refused with 409.',
        },
      },
    )
    .put(
      '/pages/:id',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const clientId = tenantState?.clientId;
        const tenant = tenantState?.tenant;
        const before = tenant ? await tenant.selectOne(schema.pagesPages, live(params.id)) : null;
        if (!tenant || !before || !clientId) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        const patch: Partial<typeof schema.pagesPages.$inferInsert> = {};
        if (body.title !== undefined) patch.title = body.title;
        if (body.summary !== undefined) patch.summary = body.summary;
        if (body.body !== undefined) patch.body = body.body;
        if (body.status !== undefined) patch.status = body.status;
        if (body.status === 'published' && !before.published_at) patch.published_at = new Date();
        if (body.imageAlt !== undefined) patch.image_alt = body.imageAlt?.trim() || null;
        try {
          await inTransaction(clientId, async (tx) => {
            // The slug moves first, judged by the page as it was: publishing and renaming in one
            // save does not count as "was published", because the old slug was never public.
            if (body.slug !== undefined) await applySlugChange(tx, before, body.slug);
            if (Object.keys(patch).length)
              await tx.update(schema.pagesPages, patch, eq(schema.pagesPages.id, before.id));
          });
        } catch (err) {
          set.status = 409;
          if (err instanceof SlugConflictError) return slugConflict(err, requestId);
          if (isUniqueViolation(err)) return raceConflict(requestId);
          throw err;
        }
        const after = (await tenant.selectOne(schema.pagesPages, live(before.id))) as Row;
        await writeAudit(unsafeAcrossTenants(), {
          clientId,
          actorId: auth?.user.id ?? null,
          action: 'pages.page.edit',
          resource: 'pages.page',
          resourceId: before.id,
          ip: clientIp(request, server),
          requestId,
          before: view(before),
          after: view(after),
        });
        return ok(await detail(tenant, after));
      },
      {
        beforeHandle: permission('pages.page.edit'),
        params: t.Object({ id: Id }),
        body: PageUpdateBody,
        response: { 200: OkSchema(PageDetail), ...errorResponses },
        detail: {
          summary: 'Update a page',
          description:
            'Changing `slug` on a page that has been published keeps the old URL alive as a ' +
            'permanent redirect, written in the same transaction as the change.',
        },
      },
    )
    .put(
      '/pages/:id/slug',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const clientId = tenantState?.clientId;
        const tenant = tenantState?.tenant;
        const before = tenant ? await tenant.selectOne(schema.pagesPages, live(params.id)) : null;
        if (!tenant || !before || !clientId) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        let change: SlugChangeResult;
        try {
          change = await inTransaction(clientId, (tx) => applySlugChange(tx, before, body.slug));
        } catch (err) {
          set.status = 409;
          if (err instanceof SlugConflictError) return slugConflict(err, requestId);
          if (isUniqueViolation(err)) return raceConflict(requestId);
          throw err;
        }
        const after = (await tenant.selectOne(schema.pagesPages, live(before.id))) as Row;
        if (change.changed)
          await writeAudit(unsafeAcrossTenants(), {
            clientId,
            actorId: auth?.user.id ?? null,
            action: 'pages.page.edit',
            resource: 'pages.page',
            resourceId: before.id,
            ip: clientIp(request, server),
            requestId,
            before: view(before),
            after: { ...view(after), redirected: change.redirected },
          });
        return ok({ page: await detail(tenant, after), change });
      },
      {
        beforeHandle: permission('pages.page.edit'),
        params: t.Object({ id: Id }),
        body: SlugBody,
        response: {
          200: OkSchema(t.Object({ page: PageDetail, change: SlugChange })),
          ...errorResponses,
        },
        detail: {
          summary: 'Change a page slug',
          description:
            'Moves the page to a new permalink. When the page has been published, the old slug ' +
            'answers 301 to the new one from then on (`change.redirected`), and every older ' +
            'permalink follows along without a chain.',
        },
      },
    )
    .post(
      '/pages/:id/image',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const clientId = tenantState?.clientId;
        const tenant = tenantState?.tenant;
        const before = tenant ? await tenant.selectOne(schema.pagesPages, live(params.id)) : null;
        if (!tenant || !before || !clientId) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        const dims = await sizeOf(body.file);
        const stored = await storeUpload({
          clientId,
          userId: auth?.user.id ?? null,
          file: body.file,
          kind: FEATURED_KIND,
          visibility: 'public',
          allowedTypes: FEATURED_TYPES,
          maxBytes: FEATURED_MAX_BYTES,
          meta: { page_id: before.id, width: dims?.width ?? null, height: dims?.height ?? null },
        });
        if (!stored.ok) {
          set.status = stored.code === 'too_large' ? 413 : 422;
          return fail('validation_failed', stored.message, requestId, {
            field: 'image',
            reason: stored.code,
          });
        }
        const patch: Partial<typeof schema.pagesPages.$inferInsert> = { image_id: stored.row.id };
        if (body.alt !== undefined) patch.image_alt = body.alt.trim() || null;
        await tenant.update(schema.pagesPages, patch, eq(schema.pagesPages.id, before.id));
        // The replaced image is nobody's any more: remove it, bytes included.
        const old = before.image_id ? await featuredFile(clientId, before.image_id) : null;
        if (old) await removeFile(old);
        const after = (await tenant.selectOne(schema.pagesPages, live(before.id))) as Row;
        await writeAudit(unsafeAcrossTenants(), {
          clientId,
          actorId: auth?.user.id ?? null,
          action: 'pages.page.edit',
          resource: 'pages.page',
          resourceId: before.id,
          ip: clientIp(request, server),
          requestId,
          before: view(before),
          after: view(after),
        });
        return ok(await detail(tenant, after));
      },
      {
        beforeHandle: permission('pages.page.edit'),
        params: t.Object({ id: Id }),
        body: ImageBody,
        response: {
          200: OkSchema(PageDetail),
          ...errorResponses,
          413: errorResponses[422],
        },
        detail: {
          summary: 'Set the featured image',
          description:
            'Multipart: `file` (JPEG, PNG, WebP or GIF, at most 5 MB) and optional `alt`. The ' +
            "image becomes the page's og:image; the one it replaces is deleted. 1200×630 suits " +
            'every social network.',
        },
      },
    )
    .delete(
      '/pages/:id/image',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const clientId = tenantState?.clientId;
        const tenant = tenantState?.tenant;
        const before = tenant ? await tenant.selectOne(schema.pagesPages, live(params.id)) : null;
        if (!tenant || !before || !clientId) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        if (before.image_id) {
          await tenant.update(
            schema.pagesPages,
            { image_id: null, image_alt: null },
            eq(schema.pagesPages.id, before.id),
          );
          const old = await featuredFile(clientId, before.image_id);
          if (old) await removeFile(old);
          const after = (await tenant.selectOne(schema.pagesPages, live(before.id))) as Row;
          await writeAudit(unsafeAcrossTenants(), {
            clientId,
            actorId: auth?.user.id ?? null,
            action: 'pages.page.edit',
            resource: 'pages.page',
            resourceId: before.id,
            ip: clientIp(request, server),
            requestId,
            before: view(before),
            after: view(after),
          });
          return ok(await detail(tenant, after));
        }
        return ok(await detail(tenant, before));
      },
      {
        beforeHandle: permission('pages.page.edit'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(PageDetail), ...errorResponses },
        detail: {
          summary: 'Remove the featured image',
          description: 'The image file is deleted; the page shares without a picture again.',
        },
      },
    )
    .delete(
      '/pages/:id',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const clientId = tenantState?.clientId;
        const tenant = tenantState?.tenant;
        const row = tenant ? await tenant.selectOne(schema.pagesPages, live(params.id)) : null;
        if (!tenant || !row || !clientId) {
          set.status = 404;
          return fail('not_found', 'Halaman tidak ditemukan', requestId);
        }
        const redirects = await redirectsOf(tenant, row.id);
        await inTransaction(clientId, async (tx) => {
          // The slug is released (the unique index counts deleted rows) and no redirect may keep
          // pointing at a page that is gone: both old and current URLs become plain 404s.
          await tx.update(
            schema.pagesPages,
            { deleted_at: new Date(), slug: `deleted-${row.id}` },
            eq(schema.pagesPages.id, row.id),
          );
          await tx.delete(schema.pagesRedirects, eq(schema.pagesRedirects.page_id, row.id));
        });
        // Its featured image has no page to illustrate any more.
        const image = row.image_id ? await featuredFile(clientId, row.image_id) : null;
        if (image) await removeFile(image);
        await writeAudit(unsafeAcrossTenants(), {
          clientId,
          actorId: auth?.user.id ?? null,
          action: 'pages.page.delete',
          resource: 'pages.page',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          before: { ...view(row), redirects },
        });
        return ok({ deleted: true as const });
      },
      {
        beforeHandle: permission('pages.page.manage'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
        detail: {
          summary: 'Delete a page',
          description: 'Its slug and every old permalink that redirected to it become free.',
        },
      },
    ),
);

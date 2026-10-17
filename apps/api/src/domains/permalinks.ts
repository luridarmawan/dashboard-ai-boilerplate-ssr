import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { modulePublicRoutes } from '@core/module-kit/public-routes';
import { Elysia, t } from 'elysia';
import { livePermalinks, resolvePermalink, siteTenant } from '../permalinks.ts';
import { requestContext } from '../plugins/request-context.ts';
import { tenantContext } from '../plugins/tenancy.ts';
import { moduleState } from '../services.ts';

/**
 * The permalink registry, read side (PRD F-12): what the web asks for every URL no route matches,
 * and what sitemap.xml lists. Both public — they answer for the visitor's site (session /
 * X-Client-ID tenant, else the `default` one) and only for modules enabled there. Writes happen
 * inside module transactions through `@app/api/permalinks`, never over HTTP.
 */

/** Module namespace → its permalink page (public.ts `permalinks: true`) and module name. */
const PERMALINK_PAGES = new Map(
  modulePublicRoutes
    .filter((r) => r.permalinks)
    .map((r) => [r.ns, { page: r.path, module: r.module }]),
);

async function servable(clientId: string, ns: string) {
  const page = PERMALINK_PAGES.get(ns);
  if (!page) return null;
  return (await moduleState.enabledFor(clientId)).has(page.module) ? page : null;
}

const Resolved = t.Union([
  t.Object({
    kind: t.Literal('content'),
    /** Namespace of the owning module. */
    module: t.String(),
    /** The module page that renders it (declared `permalinks: true`). */
    page: t.String(),
    /** Canonical path; differs from the request when it was written loosely (`/About-Us/`). */
    path: t.String(),
  }),
  t.Object({ kind: t.Literal('redirect'), module: t.String(), location: t.String() }),
]);

export const permalinksDomain = new Elysia({
  name: 'permalinks',
  prefix: '/permalinks',
  tags: ['permalinks'],
})
  .use(requestContext)
  .use(tenantContext)
  .get(
    '/resolve',
    async ({ query, set, requestId, tenantState }) => {
      const tid = await siteTenant(tenantState?.clientId ?? null);
      const hit = tid ? await resolvePermalink(tid, query.path) : null;
      const page = hit && tid ? await servable(tid, hit.module) : null;
      if (!hit || !page) {
        set.status = 404;
        return fail('not_found', 'Permalink tidak ditemukan', requestId);
      }
      if (hit.kind === 'redirect')
        return ok({ kind: 'redirect' as const, module: hit.module, location: hit.location });
      return ok({ kind: 'content' as const, module: hit.module, page: page.page, path: hit.path });
    },
    {
      query: t.Object({ path: t.String({ maxLength: 512 }) }),
      response: { 200: OkSchema(Resolved), ...errorResponses },
      detail: {
        summary: 'Resolve a root URL',
        description:
          'Public. Which module answers a URL no page route matches: `content` (render the ' +
          "module's permalink page), `redirect` (an old path — answer 301 to `location`), or 404.",
      },
    },
  )
  .get(
    '/sitemap',
    async ({ tenantState }) => {
      const tid = await siteTenant(tenantState?.clientId ?? null);
      if (!tid) return ok([]);
      const enabled = await moduleState.enabledFor(tid);
      const rows = await livePermalinks(tid);
      return ok(
        rows
          .filter((r) => {
            const page = PERMALINK_PAGES.get(r.module);
            return page && enabled.has(page.module);
          })
          .map((r) => ({ path: r.path, lastmod: r.lastmod })),
      );
    },
    {
      response: {
        200: OkSchema(t.Array(t.Object({ path: t.String(), lastmod: t.String() }))),
        ...errorResponses,
      },
      detail: {
        summary: 'Sitemap paths',
        description: 'Public. Live permalinks of the enabled modules, for sitemap.xml.',
      },
    },
  );

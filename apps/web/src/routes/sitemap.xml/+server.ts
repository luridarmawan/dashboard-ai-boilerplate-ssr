import type { RequestHandler } from '@sveltejs/kit';
import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { apiFetchData } from '$lib/server/session';
import { mergeEntries, renderSitemap, type SitemapEntry, staticEntries } from '$lib/server/sitemap';
import { landingTarget } from '../../hooks.server';

/**
 * sitemap.xml (PRD F-7, R-4): `/`, the module public pages flagged `sitemap` (extension point
 * 13) except the one that currently answers `/`, plus the dynamic entries a module exposes at
 * `GET /v1/m/<ns>/sitemap` (convention: `{ path, lastmod }[]`). Disabled modules (G-8) and their
 * pages are left out. The rules live in `$lib/server/sitemap`; this handler only gathers inputs.
 */
const MODULE_TIMEOUT_MS = 3000;

export const GET: RequestHandler = async (event) => {
  const enabled = event.locals.config.enabledModules;
  const entries = staticEntries({
    routes: modulePublicRoutes,
    enabled,
    landing: landingTarget(event),
  });
  const namespaces = new Set(modulePublicRoutes.filter((r) => enabled.has(r.ns)).map((r) => r.ns));
  // One bounded call per module, through the same path loaders use (identity headers, request id).
  // A module without the convention, a failing one or a slow one simply contributes nothing.
  const dynamic = await Promise.all(
    [...namespaces].map((ns) =>
      apiFetchData<SitemapEntry[]>(event, `/v1/m/${ns}/sitemap`, null, {
        signal: AbortSignal.timeout(MODULE_TIMEOUT_MS),
      }),
    ),
  );
  const xml = renderSitemap(event.url.origin, mergeEntries(entries, ...dynamic));
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};

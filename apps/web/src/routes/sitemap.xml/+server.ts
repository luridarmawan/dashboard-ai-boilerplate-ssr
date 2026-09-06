import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { webRoutes } from '$lib/../generated/routes';

/**
 * sitemap.xml (PRD F-7, R-4): public core pages + module public routes flagged `sitemap`, plus
 * dynamic entries a module exposes at `GET /v1/m/<ns>/sitemap` (convention: `{ path, lastmod }[]`).
 * Disabled modules (G-8) and their pages are left out.
 */
const CORE_PUBLIC = new Set(['/', '/theme', '/lang']);

export const GET: RequestHandler = async (event) => {
  const origin = event.url.origin;
  const enabled = event.locals.config.enabledModules;
  const urls: { loc: string; lastmod?: string }[] = [];
  for (const r of webRoutes) if (CORE_PUBLIC.has(r)) urls.push({ loc: `${origin}${r}` });
  const seenNs = new Set<string>();
  for (const r of modulePublicRoutes) {
    if (!enabled.has(r.ns)) continue;
    if (r.sitemap && !r.path.includes('[')) urls.push({ loc: `${origin}${r.path}` });
    seenNs.add(r.ns);
  }
  for (const ns of seenNs) {
    try {
      // The API is a separate server (Caddy fronts both in production): call it directly, not via SvelteKit.
      const r = await fetch(`${env.API_URL ?? 'http://127.0.0.1:3001'}/v1/m/${ns}/sitemap`, {
        headers: { accept: 'application/json', 'x-request-id': event.locals.requestId },
      });
      if (r.ok) {
        const body = (await r.json()) as {
          success: boolean;
          data?: { path: string; lastmod?: string }[];
        };
        for (const e of body.data ?? [])
          urls.push({ loc: `${origin}${e.path}`, ...(e.lastmod ? { lastmod: e.lastmod } : {}) });
      }
    } catch {
      /* a module without the convention simply contributes no dynamic entries */
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('\n')}\n</urlset>\n`;
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};

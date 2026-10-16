/**
 * sitemap.xml, the pure part (PRD F-7, R-4). One URL per piece of content: the front door `/`,
 * the public pages modules flagged `sitemap: true` (extension point 13) minus the one that
 * currently answers `/` (the landing target, F-5), and the dynamic entries each module hands
 * back from `GET /v1/m/<ns>/sitemap`. Utility pages (`/theme`, `/lang`) never belong here.
 * No SvelteKit imports, so `bun test` covers it directly; `+server.ts` only gathers the inputs.
 */

export interface SitemapEntry {
  /** Absolute path on this origin, no query. */
  readonly path: string;
  /** ISO-8601 date or date-time, verbatim from the module. */
  readonly lastmod?: string;
}

/** The shape `modules:sync` generates into `public-routes.ts`; only what the sitemap reads. */
export interface PublicRouteLike {
  readonly path: string;
  readonly ns: string;
  readonly sitemap: boolean;
}

export interface StaticEntriesInput {
  readonly routes: readonly PublicRouteLike[];
  /** Module namespaces enabled for this tenant (G-8). */
  readonly enabled: ReadonlySet<string>;
  /** The route `/` currently serves (`app.landing_route`), or null when the built-in page does. */
  readonly landing: string | null;
}

/** The five characters XML cannot carry verbatim in text or attribute content. */
export function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * `/`, then every module public page that is enabled, flagged for the sitemap, has no
 * parameter (those come from the module's dynamic endpoint) and is not the landing target —
 * which already appears as `/` and declares `/` as its canonical URL.
 */
export function staticEntries(input: StaticEntriesInput): SitemapEntry[] {
  const out: SitemapEntry[] = [{ path: '/' }];
  for (const r of input.routes) {
    if (!r.sitemap || !input.enabled.has(r.ns)) continue;
    if (r.path.includes('[')) continue;
    if (input.landing && r.path === input.landing) continue;
    out.push({ path: r.path });
  }
  return out;
}

/** A module entry is usable when it is an absolute path on this origin. */
function usable(e: unknown): e is SitemapEntry {
  if (!e || typeof e !== 'object') return false;
  const { path, lastmod } = e as { path?: unknown; lastmod?: unknown };
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('\n') || path.includes('\r')) return false;
  return lastmod === undefined || lastmod === null || typeof lastmod === 'string';
}

/** Concatenate entry lists, keeping the first occurrence of each path and dropping bad entries. */
export function mergeEntries(
  ...lists: readonly (readonly unknown[] | null | undefined)[]
): SitemapEntry[] {
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const list of lists) {
    for (const e of list ?? []) {
      if (!usable(e) || seen.has(e.path)) continue;
      seen.add(e.path);
      out.push(e.lastmod ? { path: e.path, lastmod: e.lastmod } : { path: e.path });
    }
  }
  return out;
}

/** The sitemaps.org 0.9 document. */
export function renderSitemap(origin: string, entries: readonly SitemapEntry[]): string {
  const body = entries
    .map((e) => {
      const loc = `<loc>${escapeXml(origin + e.path)}</loc>`;
      const lastmod = e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : '';
      return `  <url>${loc}${lastmod}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

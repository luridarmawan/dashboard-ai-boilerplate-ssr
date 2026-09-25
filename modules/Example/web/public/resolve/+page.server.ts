import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import { trappedPath } from '$lib/server/trap';
import { matchTrap } from '../../../trap.ts';

/**
 * The module's 404 handler (F-11, PRD §4.7 rule 6). This page has no content of its own: it
 * renders whatever URL the visitor asked for once an admin points `app.not_found_route` at
 * `/resolve`. The web's hooks forward the unknown URL here and hand it over through
 * `trappedPath(event)`; a direct visit (no such header) is 404.
 *
 * Two resolvers, in order — read `modules/Example/trap.ts` first, it explains the whole idea:
 *   1. the RULE TABLE (`matchTrap`): URL shapes of the site being migrated, matched by pattern,
 *      no database — `/category-food`, `/food/nasi-goreng` (demo rules)
 *   2. the DATABASE (`GET /v1/m/example/resolve`): `/<category-slug>` and `/<product-slug>`
 *      looked up in the module's tables
 * Neither recognising the URL → `error(404)` → the core's built-in 404 page, exactly as if the
 * trap did not exist.
 */
export const load: ServerLoad = async (event) => {
  const trapped = trappedPath(event);
  if (!trapped) error(404, 'Halaman tidak ditemukan');
  const cfg = event.locals.config.values;
  const brand = (cfg['example.brand_name'] as string | undefined) ?? 'Kopi Nusantara';

  // 1. rule table — pure, synchronous, no I/O
  const ruled = matchTrap(trapped.pathname);
  if (ruled) {
    return {
      hit: { kind: 'rule' as const, ruleId: ruled.rule.id, demo: ruled.hit },
      requested: trapped.pathname + trapped.search,
      path: trapped.pathname,
      brand,
      origin: event.url.origin,
    };
  }

  // 2. database — categories and products by slug
  const res = await apiFor(event).v1.m.example.resolve.get({ query: { path: trapped.pathname } });
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Halaman tidak ditemukan');
  const hit = res.data.data;
  return {
    hit,
    requested: trapped.pathname + trapped.search,
    /** The path as the visitor sees it, normalised to the slug the API matched. */
    path: `/${hit.kind === 'category' ? hit.category.slug : hit.product.slug}`,
    brand,
    origin: event.url.origin,
  };
};

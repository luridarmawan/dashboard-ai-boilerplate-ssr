import type { ServerLoad } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { apiFor } from '$lib/server/session';
import { trappedPath } from '$lib/server/trap';

/**
 * The module's 404 handler (F-11, PRD §4.7 rule 6). This page has no content of its own: it
 * renders whatever ROOT URL the visitor asked for — `/<category>` lists that category,
 * `/<product-slug>` is the product — once an admin points `app.not_found_route` at `/resolve`.
 * The web's hooks forward the unknown URL here and hand it over through `trappedPath(event)`;
 * a direct visit (no such header) is 404, and so is any URL the API does not recognise, which
 * makes the built-in 404 page show exactly as before.
 */
export const load: ServerLoad = async (event) => {
  const trapped = trappedPath(event);
  if (!trapped) error(404, 'Halaman tidak ditemukan');
  const res = await apiFor(event).v1.m.example.resolve.get({ query: { path: trapped.pathname } });
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Halaman tidak ditemukan');
  const hit = res.data.data;
  const cfg = event.locals.config.values;
  return {
    hit,
    /** The path as the visitor sees it, normalised to the slug the API matched. */
    path: `/${hit.kind === 'category' ? hit.category.slug : hit.product.slug}`,
    brand: (cfg['example.brand_name'] as string | undefined) ?? 'Kopi Nusantara',
    origin: event.url.origin,
  };
};

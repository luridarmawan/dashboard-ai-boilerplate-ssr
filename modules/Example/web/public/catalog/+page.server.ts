import type { Actions, ServerLoad } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { apiFor, checkCsrf, csrfToken, str, unwrap } from '$lib/server/session';

/**
 * The catalogue landing (R-9): the module's SECOND public arrangement of the same data. Where
 * `/example` sells — hero, story, plans — this one lists: every product, searchable and sortable,
 * with the shop's contact form reduced to one line at the end.
 *
 * Both are ordinary public routes of one module (extension point 13) and both are candidates for
 * `app.landing_route`, so an admin can decide which shape answers `/` without a deploy (F-5, F-7).
 *
 * The search and the sort are the API's work, not the browser's (`?q`, `?sort`, `?order`): the
 * page must give the same answer with JavaScript off as with it on — the enhanced layer only
 * removes the reload (L-20 over L-22).
 */
const SORTS = ['catalog', 'name', 'price'] as const;
type Sort = (typeof SORTS)[number];

export const load: ServerLoad = async (event) => {
  const q = (event.url.searchParams.get('q') ?? '').trim().slice(0, 191);
  const sortRaw = event.url.searchParams.get('sort') ?? '';
  const sort: Sort = (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as Sort) : 'catalog';
  const order = event.url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const featured = event.url.searchParams.get('featured') === '1';

  const products = await apiFor(event).v1.m.example.products.get({
    query: {
      limit: '50',
      ...(q ? { q } : {}),
      ...(sort === 'catalog' ? {} : { sort, order }),
      ...(featured ? { featured: '1' } : {}),
    },
  });
  const cfg = event.locals.config.values;
  return {
    csrf: csrfToken(event),
    products: products.data?.success ? products.data.data : [],
    total: products.data?.success ? (products.data.meta?.total ?? 0) : 0,
    filters: { q, sort, order, featured },
    brand: (cfg['example.brand_name'] as string | undefined) ?? 'Kopi Nusantara',
    tagline: (cfg['example.tagline'] as string | null | undefined) ?? null,
    origin: event.url.origin,
    sent: event.url.searchParams.has('sent'),
  };
};

export const actions: Actions = {
  /** The same inquiry the storefront takes, tagged with the page it came from. */
  contact: async (event) => {
    const form = await event.request.formData();
    const values = {
      name: str(form, 'name'),
      email: str(form, 'email'),
      message: str(form, 'message'),
    };
    if (!checkCsrf(event, form)) return fail(403, { error: 'csrf', values });
    const r = unwrap(
      await apiFor(event).v1.m.example.inquiries.post({
        ...values,
        website: str(form, 'website'), // honeypot — forwarded as-is; the API decides
        source: '/catalog',
      }),
    );
    if (!r.ok)
      return fail(r.failure.status, {
        error: r.failure.code === 'rate_limited' ? 'rate_limited' : 'failed',
        details: r.failure.details ?? null,
        values,
      });
    return { sent: true };
  },
};

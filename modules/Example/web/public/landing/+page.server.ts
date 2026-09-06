import type { Actions, ServerLoad } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { apiFor, checkCsrf, csrfToken, str, unwrap } from '$lib/server/session';

/**
 * The commercial landing (PRD §4.6, R-2): everything the page shows is loaded HERE, on the
 * server — products and testimonials from the module's tables through the API, copy from i18n,
 * colours from the theme. The contact form is a plain form action (R-5): no JavaScript needed.
 */
export const load: ServerLoad = async (event) => {
  const api = apiFor(event);
  const [products, testimonials] = await Promise.all([
    api.v1.m.example.products.get({ query: { featured: '1', limit: '6' } }),
    api.v1.m.example.testimonials.get(),
  ]);
  const cfg = event.locals.config.values;
  return {
    csrf: csrfToken(event),
    products: products.data?.success ? products.data.data : [],
    testimonials: testimonials.data?.success ? testimonials.data.data : [],
    brand: (cfg['example.brand_name'] as string | undefined) ?? 'Kopi Nusantara',
    tagline: (cfg['example.tagline'] as string | null | undefined) ?? null,
    showPricing: cfg['example.show_pricing'] !== false,
    loggedIn: !!event.locals.session,
    origin: event.url.origin,
    sent: event.url.searchParams.has('sent'),
  };
};

export const actions: Actions = {
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
        source: '/example',
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

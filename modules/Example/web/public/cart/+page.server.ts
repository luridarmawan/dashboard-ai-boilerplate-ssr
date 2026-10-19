import type { Actions, RequestEvent, ServerLoad } from '@sveltejs/kit';
import { fail, redirect } from '@sveltejs/kit';
import { apiFor, checkCsrf, str } from '$lib/server/session';
import { CART_COOKIE, type CartLine, changeCart, formatCart, parseCart } from '../../../cart.ts';

/**
 * The demo cart page (`/cart`) behind the header's cart icon — read `modules/Example/cart.ts`
 * first. Everything is a form action, so adding, removing and emptying work without JavaScript;
 * the product page posts its "add to cart" form here (`/cart?/add`).
 */
function readCart(event: RequestEvent): CartLine[] {
  return parseCart(event.cookies.get(CART_COOKIE));
}

function writeCart(event: RequestEvent, lines: readonly CartLine[]): void {
  const value = formatCart(lines);
  if (!value) {
    event.cookies.delete(CART_COOKIE, { path: '/' });
    return;
  }
  event.cookies.set(CART_COOKIE, value, {
    path: '/',
    // Read by the header icon in the browser; it holds product slugs, nothing secret.
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    // The wire format is cookie-safe already; the default percent-encoding would only obscure it.
    encode: (v) => v,
  });
}

export const load: ServerLoad = async (event) => {
  const items = formatCart(readCart(event));
  const res = await apiFor(event).v1.m.example.cart.get({ query: items ? { items } : {} });
  return {
    cart: res.data?.success
      ? res.data.data
      : { count: 0, total: 0, currency: 'IDR', items: [] as never[] },
    added: event.url.searchParams.get('added'),
  };
};

export const actions: Actions = {
  add: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return fail(403, { error: 'csrf' });
    const slug = str(form, 'slug');
    const qty = Math.max(1, Math.min(99, Number.parseInt(str(form, 'qty') || '1', 10) || 1));
    writeCart(event, changeCart(readCart(event), slug, qty));
    redirect(303, `/cart?added=${encodeURIComponent(slug)}`);
  },
  change: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return fail(403, { error: 'csrf' });
    const by = str(form, 'by') === '-1' ? -1 : 1;
    writeCart(event, changeCart(readCart(event), str(form, 'slug'), by));
    return { ok: true };
  },
  remove: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return fail(403, { error: 'csrf' });
    const slug = str(form, 'slug');
    writeCart(
      event,
      readCart(event).filter((l) => l.slug !== slug),
    );
    return { ok: true };
  },
  clear: async (event) => {
    const form = await event.request.formData();
    if (!checkCsrf(event, form)) return fail(403, { error: 'csrf' });
    writeCart(event, []);
    return { ok: true };
  },
};

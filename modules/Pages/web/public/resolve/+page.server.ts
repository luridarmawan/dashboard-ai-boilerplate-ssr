import type { ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { DEFAULT_OG_IMAGE } from '$lib/seo';
import { apiFor } from '$lib/server/session';
import { trappedPath } from '$lib/server/trap';

/**
 * The module's 404 handler. It has no page of its own: once an admin points
 * `app.not_found_route` at `/pages`, the web's hooks forward every unknown root URL here and hand
 * it over through `trappedPath(event)`. A direct visit (no such header) is 404.
 *
 * The answer is decided on the SERVER, so browsers, crawlers and plain HTTP clients all get the
 * real status code:
 *   - a published page                → 200, rendered under the visitor's URL
 *   - an old permalink of one         → 301, `Location` = the page's current URL
 *   - the right page, written loosely → 301 to the exact form (`/About-Us/` → `/about-us`), so
 *                                       every page has one URL
 *   - anything else                   → 404, which lets the core render its built-in 404 page
 * The hooks return this page's 3xx untouched (status and `Location`), so the 301 a visitor gets
 * is the one thrown below — not a client-side navigation.
 */
export const load: ServerLoad = async (event) => {
  const trapped = trappedPath(event);
  if (!trapped) error(404, 'Halaman tidak ditemukan');
  const res = await apiFor(event).v1.m.pages.resolve.get({ query: { path: trapped.pathname } });
  if (!res.data?.success) error(res.status === 404 ? 404 : res.status, 'Halaman tidak ditemukan');
  const hit = res.data.data;
  const origin = event.url.origin;
  if (hit.kind === 'redirect') redirect(301, `${origin}${hit.location}${trapped.search}`);
  const path = `/${hit.page.slug}`;
  if (trapped.pathname !== path) redirect(301, `${origin}${path}${trapped.search}`);
  const image = hit.page.image;
  const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : `${origin}${url}`);
  return {
    page: hit.page,
    canonical: `${origin}${path}`,
    // What a share shows. Social crawlers need an ABSOLUTE og:image: the page's featured image
    // (the API hands out a path on this origin, or a CDN URL), else the site's default image, so
    // a page without one is never shared as a bare text card.
    share: image
      ? {
          url: absolute(image.url),
          width: image.width,
          height: image.height,
          mime: image.mime,
          alt: image.alt || hit.page.title,
        }
      : {
          url: absolute(DEFAULT_OG_IMAGE.path),
          width: DEFAULT_OG_IMAGE.width,
          height: DEFAULT_OG_IMAGE.height,
          mime: DEFAULT_OG_IMAGE.mime,
          alt: hit.page.title,
        },
  };
};

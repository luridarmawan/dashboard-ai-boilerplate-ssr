import type { ServerLoad } from '@sveltejs/kit';
import { error, redirect } from '@sveltejs/kit';
import { shareImage } from '$lib/server/seo';
import { apiFor } from '$lib/server/session';
import { trappedPath } from '$lib/server/trap';

/**
 * The module's permalink page (PRD F-12). It has no page of its own: the web's hooks look every
 * unknown root URL up in the core permalink registry and, when a published page holds it, forward
 * it here; the page reads the visitor's URL with `trappedPath(event)`. A direct visit is 404.
 *
 * The core already answers the 301s (old permalinks, loose spellings) before forwarding, so in
 * practice this page renders a published page with 200. It still handles a redirect answer from
 * the API — the registry may have moved between the two lookups — on the SERVER, so browsers,
 * crawlers and plain HTTP clients get a real 301, never a client-side navigation.
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
    // (the API hands out a path on this origin, or a CDN URL), else the site's default share
    // image (Settings → Application), so a page without one is never shared as a bare text card.
    share: image
      ? {
          url: absolute(image.url),
          width: image.width,
          height: image.height,
          mime: image.mime,
          alt: image.alt || hit.page.title,
        }
      : { ...(await shareImage(event)), alt: hit.page.title },
  };
};

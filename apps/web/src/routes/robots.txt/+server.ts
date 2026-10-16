import type { RequestHandler } from '@sveltejs/kit';
import { cfgString } from '$lib/server/config';

/**
 * robots.txt (F-7): configurable body (`app.robots_txt`, Settings → Application → SEO), always
 * followed by the sitemap location. The built-in rules keep crawlers off the dashboard, module
 * pages, sign-in, the theme/language pickers (cookie forms, not content) and invitation links.
 */
const DEFAULT_ROBOTS =
  'User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /m/\nDisallow: /auth/\nDisallow: /theme\nDisallow: /lang\nDisallow: /join/';

export const GET: RequestHandler = async (event) => {
  const body = cfgString(event.locals.config, 'app.robots_txt', DEFAULT_ROBOTS);
  return new Response(`${body.trim()}\nSitemap: ${event.url.origin}/sitemap.xml\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};

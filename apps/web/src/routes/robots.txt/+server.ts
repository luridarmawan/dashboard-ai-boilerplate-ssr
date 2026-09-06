import type { RequestHandler } from '@sveltejs/kit';
import { cfgString } from '$lib/server/config';

/** robots.txt (F-7): configurable body (`app.robots_txt`), always with the sitemap location. */
export const GET: RequestHandler = async (event) => {
  const body = cfgString(
    event.locals.config,
    'app.robots_txt',
    'User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /m/\nDisallow: /auth/',
  );
  return new Response(`${body.trim()}\nSitemap: ${event.url.origin}/sitemap.xml\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};

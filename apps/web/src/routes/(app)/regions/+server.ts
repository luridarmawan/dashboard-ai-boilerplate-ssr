import { json } from '@sveltejs/kit';
import { regionOptions } from '$lib/server/regions';
import type { RequestHandler } from './$types';

/**
 * Region picker options for the browser: `GET /regions?parent=<code>` → `[{ value, label }]`.
 * Progressive enhancement only — every picker also works without JavaScript, by saving and
 * letting the page's `load` fill the next level. Same-origin, read-only, session-bound (the
 * API call carries the visitor's cookie), so it needs no CSRF token.
 */
export const GET: RequestHandler = async (event) => {
  const parent = event.url.searchParams.get('parent');
  if (parent !== null && !/^[A-Za-z0-9.]{1,16}$/.test(parent)) return json([], { status: 400 });
  return json(await regionOptions(event, parent ?? undefined), {
    headers: { 'cache-control': 'private, max-age=300' },
  });
};

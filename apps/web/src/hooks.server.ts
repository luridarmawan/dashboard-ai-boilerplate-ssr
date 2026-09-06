import type { Handle } from '@sveltejs/kit';
import { loadSession } from '$lib/server/session';

/**
 * Per-request plumbing:
 *   - mint (or forward) a request id; `load` passes it to the API so one id spans web → API → log (M-1)
 *   - resolve the session server-side (A-3): user, active tenant, effective permissions (C-7) —
 *     so menus and buttons render right in the first HTML, without a flicker
 *   - resolve the document language on the server so the first HTML is already correct (K-2).
 *     The user → cookie → Accept-Language chain lands with FR-K; for now the user's locale wins.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = event.request.headers.get('x-request-id') ?? crypto.randomUUID();
  event.locals.session = await loadSession(event);
  const lang = event.locals.session?.user.locale ?? 'id';
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', lang),
  });
  response.headers.set('x-request-id', event.locals.requestId);
  return response;
};

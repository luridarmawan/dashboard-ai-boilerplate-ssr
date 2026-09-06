import type { Handle } from '@sveltejs/kit';

/**
 * Per-request plumbing:
 *   - mint (or forward) a request id; `load` passes it to the API so one id spans web → API → log (M-1)
 *   - resolve the document language on the server so the first HTML is already correct (K-2).
 *     M0 ships the default; the user → cookie → Accept-Language chain lands with FR-K.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = event.request.headers.get('x-request-id') ?? crypto.randomUUID();
  const lang = 'id';
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', lang),
  });
  response.headers.set('x-request-id', event.locals.requestId);
  return response;
};

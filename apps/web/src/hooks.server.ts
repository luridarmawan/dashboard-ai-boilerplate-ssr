import type { Handle } from '@sveltejs/kit';
import { loadSession } from '$lib/server/session';
import { resolveRequestTheme } from '$lib/server/theme';

/**
 * Per-request plumbing:
 *   - mint (or forward) a request id; `load` passes it to the API so one id spans web → API → log (M-1)
 *   - resolve the session server-side (A-3): user, active tenant, effective permissions (C-7) —
 *     so menus and buttons render right in the first HTML, without a flicker
 *   - resolve theme + mode (L-12) and stamp them on <html> before the first byte: palette,
 *     icons and layout are right on first paint, for anonymous visitors too
 *   - resolve the document language on the server (K-2); the full chain lands with i18n (M2 S4)
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = event.request.headers.get('x-request-id') ?? crypto.randomUUID();
  event.locals.session = await loadSession(event);
  event.locals.theme = resolveRequestTheme(event);
  const lang = event.locals.session?.user.locale ?? 'id';
  const { theme, mode } = event.locals.theme;
  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('%lang%', lang).replace('%theme%', theme.id).replace('%mode%', mode),
  });
  response.headers.set('x-request-id', event.locals.requestId);
  return response;
};

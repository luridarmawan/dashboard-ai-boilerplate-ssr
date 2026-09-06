import type { Handle } from '@sveltejs/kit';
import { resolveRequestLocale } from '$lib/server/locale';
import { loadSession } from '$lib/server/session';
import { resolveRequestTheme } from '$lib/server/theme';

/**
 * Per-request plumbing:
 *   - mint (or forward) a request id; `load` passes it to the API so one id spans web → API → log (M-1)
 *   - resolve the session server-side (A-3): user, active tenant, effective permissions (C-7) —
 *     so menus and buttons render right in the first HTML, without a flicker
 *   - resolve theme + mode (L-12) and language (K-2), stamping <html lang data-app-theme data-mode>
 *     before the first byte: palette, icons, layout and language are right on first paint
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = event.request.headers.get('x-request-id') ?? crypto.randomUUID();
  event.locals.session = await loadSession(event);
  event.locals.theme = resolveRequestTheme(event);
  event.locals.locale = resolveRequestLocale(event);
  const { theme, mode } = event.locals.theme;
  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html
        .replace('%lang%', event.locals.locale.locale)
        .replace('%theme%', theme.id)
        .replace('%mode%', mode),
  });
  response.headers.set('x-request-id', event.locals.requestId);
  return response;
};

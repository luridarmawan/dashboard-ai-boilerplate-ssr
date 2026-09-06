import type { Handle } from '@sveltejs/kit';
import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { webRoutes } from '$lib/../generated/routes';
import { cfgString, loadPublicConfig } from '$lib/server/config';
import { resolveRequestLocale } from '$lib/server/locale';
import { loadSession } from '$lib/server/session';
import { resolveRequestTheme } from '$lib/server/theme';

/**
 * Per-request plumbing:
 *   - mint (or forward) a request id; `load` passes it to the API so one id spans web → API → log (M-1)
 *   - resolve the session server-side (A-3): user, active tenant, effective permissions (C-7) —
 *     so menus and buttons render right in the first HTML, without a flicker
 *   - load the tenant's public configuration (E-2), then resolve theme + mode (L-12) and language
 *     (K-2), stamping <html lang data-app-theme data-mode> before the first byte
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = event.request.headers.get('x-request-id') ?? crypto.randomUUID();
  event.locals.session = await loadSession(event);
  // Runtime configuration of the active tenant (public values + enabled modules), from the API's
  // versioned cache: what an admin saves on any instance is live here on the next request (E-5).
  event.locals.config = await loadPublicConfig(event, event.locals.session?.clientId ?? null);
  event.locals.theme = resolveRequestTheme(event, event.locals.config);
  event.locals.locale = resolveRequestLocale(event, event.locals.config);
  const { theme, mode } = event.locals.theme;

  // Decision I / F-5 / F-6: `/` for an anonymous visitor serves the configured landing route —
  // rendered server-side and returned as `/` (no redirect, no flicker; search engines see the
  // content). A landing route that no longer exists, or belongs to a disabled module, falls back
  // to the built-in landing page with a warning instead of a 404 on the front door.
  if (event.url.pathname === '/' && event.request.method === 'GET' && !event.locals.session) {
    const landing = cfgString(event.locals.config, 'app.landing_route', '/example');
    const target = landingTarget(landing, event.locals.config.enabledModules);
    if (target) {
      const forwarded = await event.fetch(new URL(target + event.url.search, event.url.origin), {
        headers: { accept: 'text/html', cookie: event.request.headers.get('cookie') ?? '' },
      });
      if (forwarded.ok) {
        const headers = new Headers(forwarded.headers);
        headers.set('x-request-id', event.locals.requestId);
        headers.set('x-landing-route', target);
        return new Response(await forwarded.text(), { status: 200, headers });
      }
    }
  }

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

/** A landing route is usable when it is a real page and, for `/m/<ns>/…`, its module is enabled. */
function landingTarget(landing: string, enabledModules: ReadonlySet<string>): string | null {
  if (!landing || landing === '/' || !landing.startsWith('/') || landing.startsWith('//'))
    return null;
  if (!webRoutes.includes(landing)) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'landing route tidak ada di registry — memakai halaman depan bawaan (F-6)',
        landing,
      }),
    );
    return null;
  }
  const owner = moduleOwning(landing);
  if (owner && !enabledModules.has(owner)) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'landing route milik modul nonaktif — memakai halaman depan bawaan (F-6)',
        landing,
      }),
    );
    return null;
  }
  return landing;
}

/** Namespace of the module that owns a public path (`/m/<ns>/…` or a route from public.ts), else null. */
export function moduleOwning(path: string): string | null {
  const m = /^\/m\/([a-z][a-z0-9]*)(\/|$)/.exec(path);
  if (m) return m[1] ?? null;
  for (const r of modulePublicRoutes) {
    const re = new RegExp(`^${r.path.replace(/\[[^\]]+\]/g, '[^/]+')}(/|$)`);
    if (re.test(path)) return r.ns;
  }
  return null;
}

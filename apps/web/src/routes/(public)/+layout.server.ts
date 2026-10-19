import { resolveLayout } from '@core/ui-theme';
import { error } from '@sveltejs/kit';
import { layoutVariants } from '$lib/../generated/layout-variants';
import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { isSignupEnabled } from '$lib/server/config';
import { publicNavLinks } from '$lib/server/public-nav';
import { csrfToken } from '$lib/server/session';
import { trappedPath } from '$lib/server/trap';
import { moduleOwning } from '../../hooks.server';
import type { LayoutServerLoad } from './$types';

/** Public pages (landing, theme picker) use the theme's `public` layout; anonymous visitors included (L-12). */
export const load: LayoutServerLoad = async (event) => {
  // G-8: a public page of a module disabled for this tenant does not exist.
  if (event.route.id?.includes('(modules)')) {
    const owner = moduleOwning(event.url.pathname);
    if (owner && !event.locals.config.enabledModules.has(owner))
      error(404, 'Halaman tidak ditemukan');
  }
  const variant = layoutVariants[event.route.id ?? ''] ?? 'default';
  const layout = resolveLayout(event.locals.theme.theme, 'public', variant);
  return {
    layoutId: layout.layout.id,
    layoutVariant: variant,
    loggedIn: !!event.locals.session,
    signupEnabled: isSignupEnabled(event.locals.config),
    /** For the language dropdown in the nav (K-7): the form posts to /lang and comes back here. */
    csrf: csrfToken(event),
    path: visiblePath(event),
    /** Header links that module public pages asked for (`nav` in public.ts). */
    navLinks: publicNavLinks(
      modulePublicRoutes,
      event.locals.config.enabledModules,
      event.locals.locale.locale,
      visiblePath(event).split('?')[0] ?? '/',
    ),
  };
};

/**
 * The address in the visitor's bar. When this page renders on behalf of another URL — the
 * landing forward (`/`) or the 404 trapper (`/furniture`) — the forms must come back THERE, not
 * to the page's own path, which the visitor never saw and which may 404 on a direct visit.
 */
function visiblePath(event: Parameters<LayoutServerLoad>[0]): string {
  const t = trappedPath(event);
  return t ? t.pathname + t.search : event.url.pathname + event.url.search;
}

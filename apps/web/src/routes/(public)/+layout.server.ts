import { storedSiteMenu } from '@core/module-kit/site-menu';
import { resolveLayout } from '@core/ui-theme';
import { error } from '@sveltejs/kit';
import { layoutVariants } from '$lib/../generated/layout-variants';
import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { moduleWidgets } from '$lib/../generated/widgets';
import { isSignupEnabled } from '$lib/server/config';
import { publicNavLinks, resolveSiteMenu } from '$lib/server/public-nav';
import { apiFetchData, csrfToken } from '$lib/server/session';
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
  const { config, locale, session } = event.locals;
  const visible = visiblePath(event);
  const path = visible.split('?')[0] ?? '/';
  const search = visible.slice(path.length);
  const menuOpts = {
    locale: locale.locale,
    path,
    search,
    owner: moduleOwning,
    enabled: config.enabledModules,
  };
  // A row an admin limited to signed-in users is simply empty for everyone else, so the layout
  // does not draw it at all.
  const shown = (key: string) => config.values[key] !== 'signed_in' || !!session;
  // Header widgets: what enabled modules put in the public header (search box, cart). Filtered
  // here like the dashboard's shell widgets, so a widget of a disabled module — or one behind a
  // permission the visitor lacks — never reaches the HTML. A slow `data` call must not hold the
  // page: past the timeout the widget renders without it.
  const headerWidgets = await Promise.all(
    moduleWidgets
      .filter((w) => w.slot?.startsWith('public-'))
      .filter((w) => config.enabledModules.has(w.module.toLowerCase()))
      .filter((w) => !w.permission || !!session?.can(w.permission))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map(async (w) => ({
        id: w.id,
        slot: w.slot as 'public-topbar' | 'public-search' | 'public-actions',
        data: w.data
          ? await apiFetchData(event, w.data, session?.clientId ?? null, {
              signal: AbortSignal.timeout(1500),
            })
          : null,
      })),
  );
  return {
    layoutId: layout.layout.id,
    layoutVariant: variant,
    loggedIn: !!event.locals.session,
    signupEnabled: isSignupEnabled(event.locals.config),
    /** For the language dropdown in the nav (K-7): the form posts to /lang and comes back here. */
    csrf: csrfToken(event),
    path: visiblePath(event),
    /** Header links that module public pages asked for (`nav` in public.ts). */
    navLinks: publicNavLinks(modulePublicRoutes, config.enabledModules, locale.locale, path),
    /** Rows an admin assembled in Settings → Site header; empty = the row is not drawn. */
    topbar: shown('site.topbar_visibility')
      ? resolveSiteMenu(storedSiteMenu(config.values['site.topbar']), menuOpts)
      : [],
    menubar: shown('site.menubar_visibility')
      ? resolveSiteMenu(storedSiteMenu(config.values['site.menubar']), menuOpts)
      : [],
    headerWidgets,
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

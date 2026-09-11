import { resolveLayout } from '@core/ui-theme';
import { redirect } from '@sveltejs/kit';
import { layoutVariants, pageAsides } from '$lib/../generated/layout-variants';
import { moduleWidgets } from '$lib/../generated/widgets';
import { buildBreadcrumb, buildMenu } from '$lib/server/menu';
import { apiFetchData, apiFor, csrfToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

/** What the bell dropdown shows per row — the shell never needs more than this. */
type BellItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
};

/**
 * Everything under (app) needs a session; menu, breadcrumb and permissions ride along for SSR
 * (C-6b, C-7, F-2). The dashboard LAYOUT is resolved here too (§4.8): the page's declared
 * variant → the active theme's mapping → its default. `+layout.ts` turns the id into a
 * code-split component before render, so the first HTML already has the right shell.
 */
export const load: LayoutServerLoad = async (event) => {
  const s = event.locals.session;
  if (!s)
    redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
  const locale = event.locals.locale.locale;
  const menu = buildMenu(s, event.url.pathname, locale, event.locals.config.enabledModules);
  // Bell (J-4): ONE call feeds both the badge and the dropdown preview — asking for the unread
  // rows returns the unread total alongside them, so this costs no more than the old count call.
  // A failure must never break the shell.
  const empty = { unread: 0, items: [] as BellItem[] };
  const bell = await apiFor(event)
    .v1.notifications.get({ query: { unread: '1', limit: '5' } })
    .then((r) =>
      r.data?.success
        ? {
            unread: r.data.data.unread,
            items: r.data.data.items.map((n) => ({
              id: n.id,
              title: n.title,
              body: n.body,
              link: n.link,
              // Eden revives date-like strings into Date objects; the shell renders a string.
              createdAt: new Date(n.createdAt).toISOString(),
            })),
          }
        : empty,
    )
    .catch(() => empty);
  // Shell widgets (H-13): module-contributed, on every page, filtered here like the dashboard's —
  // a widget the user may not see (or whose module is off for the tenant) never reaches the HTML.
  const shellWidgets = await Promise.all(
    moduleWidgets
      .filter((w) => w.slot === 'shell')
      .filter((w) => event.locals.config.enabledModules.has(w.module.toLowerCase()))
      .filter((w) => !w.permission || s.can(w.permission))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map(async (w) => ({
        id: w.id,
        module: w.module,
        data: w.data ? await apiFetchData(event, w.data, s.clientId) : null,
      })),
  );
  const variant = layoutVariants[event.route.id ?? ''] ?? 'default';
  const layout = resolveLayout(event.locals.theme.theme, 'dashboard', variant);
  if (layout.fellBack && variant !== 'default' && import.meta.env.DEV) {
    console.warn(
      `layout: tema ${event.locals.theme.theme.id} tidak memetakan varian "${variant}" — memakai default`,
    );
  }
  return {
    csrf: csrfToken(event),
    user: s.user,
    impersonator: s.impersonator,
    clientId: s.clientId,
    tenants: s.tenants,
    permissions: s.permissions,
    path: event.url.pathname + event.url.search,
    tenantError: event.url.searchParams.has('tenant_error'),
    menu,
    breadcrumb: buildBreadcrumb(event.url.pathname, menu, locale),
    layoutId: layout.layout.id,
    layoutVariant: variant,
    /** Side content this route asked for (§4.8); `+layout.ts` turns it into a component. */
    asideId: pageAsides[event.route.id ?? ''] ?? null,
    unreadNotifications: bell.unread,
    recentNotifications: bell.items,
    shellWidgets,
  };
};

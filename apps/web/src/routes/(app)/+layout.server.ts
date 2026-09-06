import { resolveLayout } from '@core/ui-theme';
import { redirect } from '@sveltejs/kit';
import { layoutVariants } from '$lib/../generated/layout-variants';
import { buildBreadcrumb, buildMenu } from '$lib/server/menu';
import { csrfToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

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
  const menu = buildMenu(s, event.url.pathname, locale);
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
    clientId: s.clientId,
    tenants: s.tenants,
    permissions: s.permissions,
    path: event.url.pathname + event.url.search,
    tenantError: event.url.searchParams.has('tenant_error'),
    menu,
    breadcrumb: buildBreadcrumb(event.url.pathname, menu, locale),
    layoutId: layout.layout.id,
    layoutVariant: variant,
  };
};

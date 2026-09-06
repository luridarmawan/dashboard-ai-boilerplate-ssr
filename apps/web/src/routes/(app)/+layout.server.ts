import { redirect } from '@sveltejs/kit';
import { csrfToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

/** Everything under (app) needs a session; the permissions ride along for SSR menus (C-6b, C-7). */
export const load: LayoutServerLoad = async (event) => {
  const s = event.locals.session;
  if (!s)
    redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
  return {
    csrf: csrfToken(event),
    user: s.user,
    clientId: s.clientId,
    tenants: s.tenants,
    permissions: s.permissions,
    path: event.url.pathname + event.url.search,
    tenantError: event.url.searchParams.has('tenant_error'),
  };
};

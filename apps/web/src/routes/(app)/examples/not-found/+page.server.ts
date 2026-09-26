import { modulePublicRoutes } from '$lib/../generated/public-routes';
import { hasPermission } from '$lib/permissions';
import { cfgString } from '$lib/server/config';
import type { PageServerLoad } from './$types';

/**
 * The 404 handler explained on a live installation (F-11, PRD §4.7 rule 6): which pages modules
 * declared as handlers (`notFound: true` in public.ts), which one this tenant has chosen in
 * Settings → Application, and URLs to try. Everything is read, nothing is changed here — the
 * setting itself stays in /settings where it is validated (E-3).
 */
export const load: PageServerLoad = async ({ locals }) => {
  const enabled = locals.config.enabledModules;
  const handlers = modulePublicRoutes
    .filter((r) => r.notFound && enabled.has(r.ns))
    .map((r) => ({ path: r.path, module: r.module }));
  const current = cfgString(locals.config, 'app.not_found_route', '');
  return {
    handlers,
    current: current || null,
    currentModule: handlers.find((h) => h.path === current)?.module ?? null,
    canConfigure: hasPermission(locals.session?.permissions ?? [], 'config.edit'),
  };
};

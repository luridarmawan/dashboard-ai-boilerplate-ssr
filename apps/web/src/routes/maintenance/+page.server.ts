import { cfgString } from '$lib/server/config';
import { csrfToken } from '$lib/server/session';
import { trappedPath } from '$lib/server/trap';
import type { PageServerLoad } from './$types';

/**
 * The maintenance page (PRD E-10). `hooks.server.ts` renders it on behalf of every blocked
 * request — the visitor's own URL arrives in the forward header and is offered back as "try
 * again" — and answers 503 while maintenance is on. Visited directly while maintenance is OFF it
 * is a preview (200), so an administrator can see what users will get before flipping the switch.
 */
export const load: PageServerLoad = async (event) => {
  const m = event.locals.maintenance;
  const requested = trappedPath(event);
  const path = requested ? requested.pathname + requested.search : null;
  return {
    active: m.active,
    source: m.source,
    exempt: m.exempt,
    signedIn: !!event.locals.session,
    canOpenSettings: event.locals.session?.can('config.read') ?? false,
    /** The address the visitor asked for; null on a direct visit. */
    requestedPath: path,
    home: cfgString(event.locals.config, 'app.home_route', '/dashboard'),
    /** The sign-out form on this page is a POST like everywhere else (A-10). */
    csrf: csrfToken(event),
  };
};

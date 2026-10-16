import { isMaintenanceExempt } from '@core/auth';
import { env } from '@core/config';
import { unsafeAcrossTenants } from '@core/db';
import { Elysia } from 'elysia';
import { maintenanceFailure, maintenanceState } from '../maintenance.ts';
import { authContext } from './auth.ts';
import { requestContext } from './request-context.ts';

/**
 * Maintenance gate (PRD E-10), process-wide, after the session is resolved. Who gets through:
 *
 *   - the allow-list below: liveness, the sign-in flow, signing out, and the reads the web shell
 *     needs to render the sign-in and maintenance pages (who am I, public settings, enabled
 *     modules, custom themes) — a maintenance page that cannot be themed is a broken page
 *   - a superadmin or a member of the Administrator group of the active tenant (`isMaintenanceExempt`)
 *   - under the Settings switch only: anonymous requests. Public pages stay up for visitors; the
 *     modules behind them decide what to switch off. Under `MAINTENANCE_MODE=true` in `.env`
 *     anonymous requests are refused too — the whole deployment is closed.
 *
 * Everyone else: 503 `maintenance`, with `Retry-After`. The exemption is read from the database
 * only while maintenance is on, so the gate costs nothing the rest of the time.
 */
const ALLOWED: readonly { method?: 'GET'; path: string; prefix?: boolean }[] = [
  { method: 'GET', path: '/v1/health' },
  { method: 'GET', path: '/v1/ready' },
  { method: 'GET', path: '/v1/version' },
  { path: '/v1/auth/login' },
  { path: '/v1/auth/login/mfa' },
  { path: '/v1/auth/google-login' },
  { path: '/v1/auth/google/start' },
  { path: '/v1/auth/logout' },
  { method: 'GET', path: '/v1/auth/me' },
  { method: 'GET', path: '/v1/auth/permissions' },
  { method: 'GET', path: '/v1/configuration/public' },
  { method: 'GET', path: '/v1/module/enabled' },
  { method: 'GET', path: '/v1/themes/custom' },
];

/** Exported for the unit test: which requests the gate never refuses. */
export function maintenanceAllows(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  return ALLOWED.some(
    (a) =>
      (a.method === undefined || a.method === m || (a.method === 'GET' && m === 'HEAD')) &&
      (a.prefix ? pathname.startsWith(a.path) : pathname === a.path),
  );
}

export const maintenanceMode = new Elysia({ name: 'maintenance-mode' })
  .use(requestContext)
  .use(authContext)
  .onBeforeHandle({ as: 'global' }, async ({ auth, request, set, requestId }) => {
    const path = new URL(request.url).pathname;
    if (maintenanceAllows(request.method, path)) return;
    // Settings mode never touches anonymous traffic; .env mode refuses it without a database read.
    if (!auth && !env().MAINTENANCE_MODE) return;
    const state = await maintenanceState(auth?.clientId ?? null);
    if (!state.active || !state.source) return;
    if (auth && (await isMaintenanceExempt(unsafeAcrossTenants(), auth.user, auth.clientId)))
      return;
    set.status = 503;
    set.headers['retry-after'] = '300';
    return maintenanceFailure(requestId, state.source);
  });

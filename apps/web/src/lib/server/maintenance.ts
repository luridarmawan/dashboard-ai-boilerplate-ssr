import type { PublicConfig } from './config.ts';
import type { Session } from './session.ts';

/**
 * Maintenance mode on the web side (PRD E-10). Two switches, one door:
 *
 *   - `MAINTENANCE_MODE=true` in `.env` — the whole deployment is closed: every URL renders the
 *     maintenance page (503) except the sign-in flow and what it needs (theme/language forms,
 *     assets). Read from `process.env` like `APP_ORIGIN`, so this module stays unit-testable
 *     and so both processes (web and api) read the same variable.
 *   - `app.maintenance_mode` in Settings — the tenant is closed to everyone outside the
 *     Administrator group, but public pages stay up for anonymous visitors; the modules behind
 *     them read `locals.maintenance.active` to switch their own features off.
 *
 * Who passes: whoever the API says is exempt (`/v1/auth/me` → `maintenance.exempt`: a
 * superadmin or a member of the tenant's Administrator group). The API is the authority — it
 * refuses the calls — this only decides which page the browser gets.
 */
export type MaintenanceSource = 'env' | 'config';

export interface MaintenanceState {
  /** Maintenance is on for this request's tenant (either switch). */
  readonly active: boolean;
  /** Which switch; `env` wins when both are on. Null while inactive. */
  readonly source: MaintenanceSource | null;
  /** The signed-in user may keep working. False for anonymous visitors while active. */
  readonly exempt: boolean;
  /** THIS request gets the maintenance page instead of what it asked for. */
  readonly blocked: boolean;
}

export const MAINTENANCE_PATH = '/maintenance';

/**
 * Paths that stay reachable for everyone while maintenance is on: the sign-in flow (and the
 * forms that keep it usable — theme, language), signing out, the maintenance page itself, and
 * the files browsers ask for regardless. A blocked user can always leave and an administrator
 * can always get in. Matched per path segment: `/auth/login` covers `/auth/login/x`, not
 * `/auth/loginx`.
 */
export const MAINTENANCE_ALLOWED: readonly string[] = [
  MAINTENANCE_PATH,
  '/auth/login',
  '/auth/logout',
  '/auth/google',
  '/auth/stop-impersonate',
  '/theme',
  '/lang',
  '/_app',
  '/favicon.ico',
  '/favicon.svg',
  '/robots.txt',
  '/.well-known',
];

export function isMaintenanceAllowed(pathname: string): boolean {
  return MAINTENANCE_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** `MAINTENANCE_MODE` from the environment, same spelling the API validates (`true` only). */
export function maintenanceEnvFlag(source: Readonly<Record<string, string | undefined>>): boolean {
  return source.MAINTENANCE_MODE?.trim() === 'true';
}

export interface MaintenanceInput {
  readonly pathname: string;
  readonly envFlag: boolean;
  /** `app.maintenance_mode` as the public configuration carries it (unknown when the API is down). */
  readonly configFlag: unknown;
  /** What `/v1/auth/me` said about this session; null for an anonymous visitor. */
  readonly session: Pick<Session, 'maintenance'> | null;
}

/**
 * The decision, pure. Under the `.env` switch anonymous visitors are blocked too; under the
 * Settings switch only signed-in, non-exempt users are — a visitor browsing a shop in
 * maintenance still sees the shop, and is turned away at the sign-in form by the API.
 */
export function resolveMaintenance(input: MaintenanceInput): MaintenanceState {
  const session = input.session;
  // The API's verdict covers both switches for a signed-in user; without a session the web only
  // has the two flags it can read itself.
  const fromApi = session?.maintenance ?? null;
  const source: MaintenanceSource | null = input.envFlag
    ? 'env'
    : fromApi?.active
      ? fromApi.source
      : input.configFlag === true
        ? 'config'
        : null;
  if (!source) return { active: false, source: null, exempt: true, blocked: false };
  const exempt = fromApi ? fromApi.exempt : false;
  const closedToMe = source === 'env' || session !== null;
  const blocked = !exempt && closedToMe && !isMaintenanceAllowed(input.pathname);
  return { active: true, source, exempt, blocked };
}

/** The per-request state, from the request's environment, configuration and session. */
export function requestMaintenance(
  pathname: string,
  config: PublicConfig,
  session: Session | null,
  envSource: Readonly<Record<string, string | undefined>> = process.env,
): MaintenanceState {
  return resolveMaintenance({
    pathname,
    envFlag: maintenanceEnvFlag(envSource),
    configFlag: config.values['app.maintenance_mode'],
    session,
  });
}

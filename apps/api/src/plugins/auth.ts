import {
  type ApiTokenRow,
  defaultTenantOf,
  findApiToken,
  findSession,
  looksLikeToken,
  type SessionRow,
  type UserRow,
} from '@core/auth';
import { fail } from '@core/contracts';
import { newId, unsafeAcrossTenants } from '@core/db';
import { Elysia } from 'elysia';

/**
 * Session resolution (PRD A-3, A-4, B-2). Runs on every request: an `Authorization: Bearer`
 * header names an API token (A-4, non-browser clients such as MCP); otherwise the `crk_session`
 * cookie names a session. Both are looked up in the database (no per-process cache — Decision M
 * / D1), and exposed as `auth` to handlers. Routes that need a user opt in with `requireAuth`;
 * everything else in the API is protected by default because the domain groups mount it
 * (Principle 4). Bearer requests carry no cookie, so the CSRF plugin exempts them structurally.
 *
 * The lookup uses the raw connection on purpose: sessions and users are global tables, and
 * the active tenant is only KNOWN after the session is read.
 */

export const SESSION_COOKIE = 'crk_session';
/**
 * Impersonation (D-6): a second cookie names a session the superadmin opened AS another user. It
 * only counts while the superadmin's own `crk_session` is still valid and matches the session's
 * `impersonator_id`, so the admin never loses their own login and stopping is just dropping it.
 */
export const IMPERSONATE_COOKIE = 'crk_impersonate';

export interface AuthState {
  /** The cookie session; null when the request authenticated with an API token (A-4). */
  readonly session: SessionRow | null;
  /** The API token; null when the request authenticated with a cookie session. */
  readonly token: ApiTokenRow | null;
  readonly user: UserRow;
  /** Active tenant of this session / token; null until the user has one (B-2). */
  readonly clientId: string | null;
  /** Permission strings a token is limited to (A-4); null = the user's full permissions. */
  readonly scopes: readonly string[] | null;
  /** The superadmin behind this request when it is impersonated (D-6); null otherwise. */
  readonly impersonator: UserRow | null;
}

export const authContext = new Elysia({ name: 'auth-context' }).derive(
  { as: 'global' },
  async ({ cookie, request }): Promise<{ auth: AuthState | null }> => {
    const db = unsafeAcrossTenants(); // global tables (sessions, tokens, users): no tenant to scope by yet
    const header = request.headers.get('authorization');
    if (header && /^bearer\s+/i.test(header)) {
      const secret = header.replace(/^bearer\s+/i, '').trim();
      if (!looksLikeToken(secret)) return { auth: null };
      const found = await findApiToken(db, secret);
      if (!found) return { auth: null };
      const scopes = Array.isArray(found.token.scopes)
        ? (found.token.scopes as unknown[]).filter((s): s is string => typeof s === 'string')
        : null;
      return {
        auth: {
          session: null,
          token: found.token,
          user: found.user,
          clientId: found.token.client_id ?? (await defaultTenantOf(db, found.user.id)),
          scopes,
          impersonator: null,
        },
      };
    }
    const token = cookie[SESSION_COOKIE]?.value;
    if (typeof token !== 'string' || !looksLikeToken(token)) return { auth: null };
    const found = await findSession(db, token);
    if (!found) return { auth: null };
    const impToken = cookie[IMPERSONATE_COOKIE]?.value;
    if (typeof impToken === 'string' && looksLikeToken(impToken) && found.user.is_superadmin) {
      const imp = await findSession(db, impToken);
      if (imp && imp.session.impersonator_id === found.user.id)
        return {
          auth: {
            session: imp.session,
            token: null,
            user: imp.user,
            clientId: imp.session.client_id,
            scopes: null,
            impersonator: found.user,
          },
        };
      // Stale or foreign impersonation cookie: ignored — the admin's own session stands.
    }
    return {
      auth: {
        session: found.session,
        token: null,
        user: found.user,
        clientId: found.session.client_id,
        scopes: null,
        impersonator: null,
      },
    };
  },
);

/** Guard: refuse while impersonating — the admin must not change the user's credentials (D-6). */
export function notImpersonating({
  auth,
  set,
  requestId,
}: {
  auth: AuthState | null;
  set: { status?: number | string };
  requestId: string;
}) {
  if (!auth?.impersonator) return;
  set.status = 403;
  return fail('forbidden', 'Tidak tersedia selama impersonasi', requestId, {
    reason: 'impersonating',
  });
}

/**
 * Route guard for actions that only make sense for a cookie session — logout, switching the
 * session's tenant, minting tokens. An API token gets 403 with a reason, not a crash.
 */
export function sessionOnly({
  auth,
  set,
  request,
}: {
  auth: AuthState | null;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
  request: Request;
}) {
  const rid = String(set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId());
  if (!auth) {
    set.status = 401;
    return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', rid);
  }
  if (!auth.session) {
    set.status = 403;
    return fail('forbidden', 'Aksi ini hanya untuk sesi browser, bukan API token', rid, {
      reason: 'session_only',
    });
  }
  return undefined;
}

/** Mount inside a group to make every route in it require a live session. */
export const requireAuth = new Elysia({ name: 'require-auth' })
  .use(authContext)
  .onBeforeHandle({ as: 'scoped' }, ({ auth, set, request }) => {
    if (auth) return;
    set.status = 401;
    const rid = String(
      set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId(),
    );
    return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', rid);
  });

/** Client IP behind the reverse proxy (first hop of X-Forwarded-For), else the socket address. */
export function clientIp(
  request: Request,
  server: { requestIP?: (r: Request) => { address: string } | null } | null,
): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return server?.requestIP?.(request)?.address ?? null;
}

/** Fields of a user row that may leave the server. Never the password hash. */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    avatarUrl: u.avatar_url,
    locale: u.locale,
    theme: u.theme,
    sidebarCollapsed: !!u.sidebar_collapsed,
    isSuperadmin: u.is_superadmin,
    emailVerifiedAt: u.email_verified_at?.toISOString() ?? null,
    lastLoginAt: u.last_login_at?.toISOString() ?? null,
    createdAt: u.created_at.toISOString(),
  };
}

import { findSession, looksLikeToken, type SessionRow, type UserRow } from '@core/auth';
import { fail } from '@core/contracts';
import { newId, unsafeAcrossTenants } from '@core/db';
import { Elysia } from 'elysia';

/**
 * Session resolution (PRD A-3, B-2). Runs on every request: reads the `dab_session` cookie,
 * looks the session up in the database (no per-process cache — Decision M / D1), and exposes
 * `auth` to handlers. Routes that need a user opt in with `requireAuth`; everything else in the
 * API is protected by default because the domain groups mount it (Principle 4).
 *
 * The lookup uses the raw connection on purpose: sessions and users are global tables, and
 * the active tenant is only KNOWN after the session is read.
 */

export const SESSION_COOKIE = 'dab_session';

export interface AuthState {
  readonly session: SessionRow;
  readonly user: UserRow;
  /** Active tenant of this session; null until the user has one (B-2). */
  readonly clientId: string | null;
}

export const authContext = new Elysia({ name: 'auth-context' }).derive(
  { as: 'global' },
  async ({ cookie }): Promise<{ auth: AuthState | null }> => {
    const token = cookie[SESSION_COOKIE]?.value;
    if (typeof token !== 'string' || !looksLikeToken(token)) return { auth: null };
    // Global tables (sessions, users): no tenant to scope by yet.
    const found = await findSession(unsafeAcrossTenants(), token);
    if (!found) return { auth: null };
    return {
      auth: { session: found.session, user: found.user, clientId: found.session.client_id },
    };
  },
);

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
    avatarUrl: u.avatar_url,
    locale: u.locale,
    theme: u.theme,
    isSuperadmin: u.is_superadmin,
    emailVerifiedAt: u.email_verified_at?.toISOString() ?? null,
    lastLoginAt: u.last_login_at?.toISOString() ?? null,
    createdAt: u.created_at.toISOString(),
  };
}

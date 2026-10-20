import {
  consumeRateLimit,
  createApiToken,
  defaultTenantOf,
  extendApiToken,
  findRefreshableToken,
  GOOGLE_TOKENINFO_URL,
  looksLikeToken,
  type OAuthIdentity,
  parseGoogleIdTokenInfo,
  parseRateLimitRule,
  rateLimitHeaders,
  revokeApiToken,
  type UserRow,
  writeAudit,
} from '@core/auth';
import { env } from '@core/config';
import { Email, errorResponses, fail, MfaLoginBody, OkSchema, ok, Password } from '@core/contracts';
import { eq, schema, unsafeAcrossTenants } from '@core/db';
import { Elysia, t } from 'elysia';
import { refuseLoginDuringMaintenance } from '../maintenance.ts';
import { authContext, clientIp, publicUser } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { settings } from '../services.ts';
import { mfaSecondFactor, PublicUser, passwordFirstFactor, startMfaChallenge } from './auth.ts';
import { googleConfig, googleUserOf, refuseGoogle } from './auth-google.ts';

/**
 * Sign-in for apps (PRD A-4): the same checks as the browser sign-in — password with its rate
 * limit, 2FA, Google, maintenance — but the result is a bearer token in the response body, never
 * a cookie. A mobile app keeps the token and sends `Authorization: Bearer …` to every endpoint.
 *
 *   POST   /auth/token          email + password   → token, or an MFA challenge (A-11)
 *   POST   /auth/token/mfa      challenge + code   → token
 *   POST   /auth/token/google   Google ID token    → token, or an MFA challenge
 *   POST   /auth/token/refresh  Bearer (may be expired, within the refresh window) → token
 *   DELETE /auth/token          Bearer             → token revoked
 *
 * The token is an API token of kind `login`: it lives `security.app_token_minutes` (default 60)
 * and, until `security.app_token_refresh_minutes` (default 2160) after it expired, the app may
 * extend it without asking for the password again. A refresh moves the expiry of the SAME token
 * rather than minting a new secret, so two refreshes racing from one app both succeed. Login
 * tokens show up next to the user's own API tokens (Profile → API tokens) and are revoked there
 * like any other.
 *
 * The sign-in routes are ordinary core routes, so CSRF applies (A-10): the app fetches a pair from
 * GET /auth/csrf-token and sends it back with an `Origin` of this deployment. Refresh and revoke
 * carry a bearer token and are exempt structurally.
 */

const DEFAULT_TOKEN_MINUTES = 60;
const DEFAULT_REFRESH_MINUTES = 2160;
const HTTP_TIMEOUT_MS = 10_000;

const TokenGrant = t.Object({
  accessToken: t.String(),
  tokenType: t.Literal('Bearer'),
  expiresAt: t.String(),
  /** Last moment a refresh is accepted; after that the app must sign in again. */
  refreshExpiresAt: t.String(),
  user: PublicUser,
  clientId: t.Nullable(t.String()),
});
const MfaChallenge = t.Object({ mfaRequired: t.Literal(true), challenge: t.String() });
/** What the app calls itself in Profile → API tokens, e.g. "Pixel 8" or "OSA 2.0.1 (iOS)". */
const Device = t.Optional(t.String({ minLength: 1, maxLength: 80 }));

async function tokenPolicy(): Promise<{ ttlMs: number; windowMs: number }> {
  const minutes = async (key: string, fallback: number) => {
    const v = await settings.get<number | null>(null, key);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    ttlMs: (await minutes('security.app_token_minutes', DEFAULT_TOKEN_MINUTES)) * 60_000,
    windowMs:
      (await minutes('security.app_token_refresh_minutes', DEFAULT_REFRESH_MINUTES)) * 60_000,
  };
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header || !/^bearer\s+/i.test(header)) return null;
  const secret = header.replace(/^bearer\s+/i, '').trim();
  return looksLikeToken(secret) ? secret : null;
}

function grant(p: {
  token: string;
  expiresAt: Date;
  windowMs: number;
  user: UserRow;
  clientId: string | null;
}) {
  return {
    accessToken: p.token,
    tokenType: 'Bearer' as const,
    expiresAt: p.expiresAt.toISOString(),
    refreshExpiresAt: new Date(p.expiresAt.getTime() + p.windowMs).toISOString(),
    user: publicUser(p.user),
    clientId: p.clientId,
  };
}

/** A verified sign-in becomes a `login` token: last_login_at and the audit row as for a session. */
async function issueAppToken(p: {
  db: ReturnType<typeof unsafeAcrossTenants>;
  user: UserRow;
  ip: string;
  request: Request;
  requestId: string;
  device?: string | undefined;
  mfa?: 'totp' | 'recovery';
  sso?: 'google';
}) {
  const { ttlMs, windowMs } = await tokenPolicy();
  const clientId = await defaultTenantOf(p.db, p.user.id);
  const label = p.device ?? p.request.headers.get('user-agent') ?? 'App';
  const created = await createApiToken(p.db, {
    userId: p.user.id,
    // NULL: the token follows the user's default tenant; the app picks another per request.
    clientId: null,
    name: `App: ${label}`.slice(0, 100),
    scopes: null,
    expiresAt: new Date(Date.now() + ttlMs),
    kind: 'login',
  });
  const now = new Date();
  await p.db
    .update(schema.users)
    .set({
      last_login_at: now,
      last_login_ip: p.ip || null,
      last_active_at: now,
      last_active_ip: p.ip || null,
    })
    .where(eq(schema.users.id, p.user.id));
  await writeAudit(p.db, {
    clientId,
    actorId: p.user.id,
    action: 'auth.login',
    resource: 'user',
    resourceId: p.user.id,
    ip: p.ip,
    requestId: p.requestId,
    after: {
      token: created.id,
      ...(p.mfa ? { mfa: p.mfa } : {}),
      ...(p.sso ? { sso: p.sso } : {}),
    },
  });
  return grant({
    token: created.token,
    expiresAt: created.expiresAt as Date,
    windowMs,
    user: p.user,
    clientId,
  });
}

/** ID token → claims, via Google's tokeninfo endpoint. Any failure is one null to the caller. */
async function identityFromIdToken(
  idToken: string,
  audiences: readonly string[],
): Promise<OAuthIdentity | null> {
  const url = new URL(env().GOOGLE_OAUTH_TOKENINFO_URL ?? GOOGLE_TOKENINFO_URL);
  url.searchParams.set('id_token', idToken);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseGoogleIdTokenInfo(await res.json().catch(() => null), audiences);
  } catch {
    return null;
  }
}

export const authToken = new Elysia({ name: 'auth-token', prefix: '/auth', tags: ['auth'] })
  .use(requestContext)
  .use(authContext)

  // ---- email + password ------------------------------------------------------------------
  .post(
    '/token',
    async ({ body, set, request, requestId, server }) => {
      const db = unsafeAcrossTenants();
      const ip = clientIp(request, server) ?? 'unknown';
      const first = await passwordFirstFactor({
        db,
        email: body.email,
        password: body.password,
        ip,
        requestId,
        set,
      });
      if ('refused' in first) return first.refused;
      const { user } = first;
      const challenge = await startMfaChallenge({ db, userId: user.id, ip, requestId });
      if (challenge) return ok(challenge);
      return ok(await issueAppToken({ db, user, ip, request, requestId, device: body.device }));
    },
    {
      body: t.Object({ email: Email, password: Password, device: Device }),
      response: { 200: OkSchema(t.Union([TokenGrant, MfaChallenge])), ...errorResponses },
      detail: {
        summary: 'Sign in an app',
        description:
          'Email and password sign-in for apps: returns a bearer token instead of a cookie, or an MFA challenge when the account has 2FA. Same rate limit as the browser sign-in.',
      },
    },
  )
  .post(
    '/token/mfa',
    async ({ body, set, request, requestId, server }) => {
      const db = unsafeAcrossTenants();
      const ip = clientIp(request, server) ?? 'unknown';
      const second = await mfaSecondFactor({
        db,
        challenge: body.challenge,
        code: body.code,
        ip,
        requestId,
        set,
      });
      if ('refused' in second) return second.refused;
      return ok(
        await issueAppToken({
          db,
          user: second.user,
          ip,
          request,
          requestId,
          device: body.device,
          mfa: second.method,
        }),
      );
    },
    {
      body: t.Composite([MfaLoginBody, t.Object({ device: Device })]),
      response: { 200: OkSchema(TokenGrant), ...errorResponses },
      detail: {
        summary: 'Complete a 2FA app sign-in',
        description:
          'Exchanges the challenge from `/auth/token` plus a TOTP or recovery code for a bearer token.',
      },
    },
  )

  // ---- Google ID token -------------------------------------------------------------------
  .post(
    '/token/google',
    async ({ body, set, request, requestId, server }) => {
      const e = env();
      const db = unsafeAcrossTenants();
      const ip = clientIp(request, server) ?? 'unknown';
      const cfg = await googleConfig();
      // No client secret needed here: the app already holds an ID token, nothing is exchanged.
      if (!cfg.enabled || !cfg.clientId) {
        set.status = 403;
        return fail('sso_disabled', 'Masuk dengan Google tidak diaktifkan', requestId);
      }
      const rule = parseRateLimitRule(
        (await settings.get<string | null>(null, 'security.login_rate_limit')) ??
          e.LOGIN_RATE_LIMIT,
      );
      const limit = await consumeRateLimit(db, `oauth:ip:${ip}`, rule);
      Object.assign(set.headers, rateLimitHeaders(limit));
      if (!limit.allowed) {
        set.status = 429;
        return fail('rate_limited', 'Terlalu banyak percobaan masuk — coba lagi nanti', requestId);
      }
      const ctx = { db, ip, requestId, set };
      const identity = await identityFromIdToken(body.idToken, [cfg.clientId, ...cfg.appClientIds]);
      if (!identity)
        return (
          await refuseGoogle(ctx, 401, 'sso_failed', 'Masuk dengan Google gagal — coba lagi', {
            reason: 'id_token',
          })
        ).refused;
      const signedIn = await googleUserOf({ ...ctx, identity, cfg });
      if ('refused' in signedIn) return signedIn.refused;
      const { user } = signedIn;
      const challenge = await startMfaChallenge({ db, userId: user.id, ip, requestId });
      if (challenge) return ok(challenge);
      return ok(
        await issueAppToken({
          db,
          user,
          ip,
          request,
          requestId,
          device: body.device,
          sso: 'google',
        }),
      );
    },
    {
      body: t.Object({ idToken: t.String({ minLength: 20, maxLength: 4096 }), device: Device }),
      response: { 200: OkSchema(t.Union([TokenGrant, MfaChallenge])), ...errorResponses },
      detail: {
        summary: 'Sign in an app with Google',
        description:
          'Takes the ID token the app got from Google Sign-In. Its audience must be the web client id or one of the app client ids in Settings. Links or creates the user like the browser flow.',
      },
    },
  )

  // ---- refresh ---------------------------------------------------------------------------
  .post(
    '/token/refresh',
    async ({ set, request, requestId, server }) => {
      const db = unsafeAcrossTenants();
      const secret = bearerOf(request);
      if (!secret) {
        set.status = 401;
        return fail('token_invalid', 'Token tidak ada', requestId, { reason: 'token_invalid' });
      }
      const { ttlMs, windowMs } = await tokenPolicy();
      const found = await findRefreshableToken(db, secret, windowMs);
      if (!found.ok) {
        set.status = 401;
        // `token_expired`: too old to refresh — the app signs in again. `token_invalid`: unknown,
        // revoked, not a login token, or its user is gone or disabled.
        return found.reason === 'refresh_expired'
          ? fail('token_expired', 'Sesi berakhir — masuk lagi', requestId, {
              reason: found.reason,
            })
          : fail('token_invalid', 'Token tidak valid', requestId, { reason: found.reason });
      }
      const clientId = await defaultTenantOf(db, found.user.id);
      // E-10: a refresh is a quiet re-entry; a closed door stays closed for it too.
      const refused = await refuseLoginDuringMaintenance({
        db,
        user: found.user,
        clientId,
        ip: clientIp(request, server) ?? 'unknown',
        requestId,
        set,
      });
      if (refused) return refused;
      const expiresAt = new Date(Date.now() + ttlMs);
      await extendApiToken(db, found.token.id, expiresAt);
      return ok(grant({ token: secret, expiresAt, windowMs, user: found.user, clientId }));
    },
    {
      response: { 200: OkSchema(TokenGrant), ...errorResponses },
      detail: {
        summary: 'Refresh an app token',
        description:
          'Send the token as `Authorization: Bearer`, even when it has just expired. Extends the same token while it is inside the refresh window; afterwards answers `token_expired` and the app must sign in again.',
      },
    },
  )

  // ---- sign out --------------------------------------------------------------------------
  .delete(
    '/token',
    async ({ auth, set, request, requestId, server }) => {
      if (!auth) {
        set.status = 401;
        return fail('unauthorized', 'Sesi tidak ada atau sudah berakhir', requestId);
      }
      if (!auth.token) {
        set.status = 403;
        return fail('forbidden', 'Aksi ini hanya untuk token aplikasi', requestId, {
          reason: 'token_only',
        });
      }
      const db = unsafeAcrossTenants();
      await revokeApiToken(db, auth.user.id, auth.token.id);
      await writeAudit(db, {
        clientId: auth.clientId,
        actorId: auth.user.id,
        action: 'auth.logout',
        resource: 'user',
        resourceId: auth.user.id,
        ip: clientIp(request, server),
        requestId,
        after: { token: auth.token.id },
      });
      return ok({ loggedOut: true as const });
    },
    {
      response: { 200: OkSchema(t.Object({ loggedOut: t.Literal(true) })), ...errorResponses },
      detail: {
        summary: 'Sign out an app',
        description: 'Revokes the bearer token the request is made with.',
      },
    },
  );

import {
  consumeRateLimit,
  emailDomainAllowed,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  googleAuthorizeUrl,
  invalidateUserSessions,
  type OAuthIdentity,
  parseDomainList,
  parseGoogleUserinfo,
  parseRateLimitRule,
  pkcePair,
  randomToken,
  rateLimitHeaders,
  writeAudit,
} from '@core/auth';
import { env } from '@core/config';
import { errorResponses, fail, OkSchema, ok } from '@core/contracts';
import { and, eq, isNull, newId, STATUS, schema, unsafeAcrossTenants } from '@core/db';
import { Elysia, t } from 'elysia';
import { authContext, clientIp } from '../plugins/auth.ts';
import { allowedOrigins } from '../plugins/csrf.ts';
import { requestContext } from '../plugins/request-context.ts';
import { emit, settings } from '../services.ts';
import { attachDefaultTenant, issueSession, PublicUser, startMfaChallenge } from './auth.ts';

/**
 * Sign in with Google (PRD A-8) — authorization code + PKCE, server-side, no JavaScript needed
 * in the browser:
 *
 *   1. GET  /auth/google/start?redirect_uri=…   → the Google URL plus a fresh `state` and PKCE
 *      verifier; the WEB app keeps both in an httpOnly cookie and redirects the browser.
 *   2. Google sends the browser back to the web app's /auth/google/callback?code&state.
 *   3. POST /auth/google-login { code, codeVerifier, redirectUri } → this API exchanges the code
 *      (client secret never leaves the API), reads the identity, links or creates the user, and
 *      answers exactly like POST /auth/login: a session cookie, or an MFA challenge (A-11).
 *
 * The link key is Google's `sub`, stored in `oauth_accounts`. An unknown `sub` whose verified
 * e-mail matches an existing user links to that user; otherwise a user is created only when
 * `security.google_auto_create` is on (the A-8 flag). `security.google_allowed_domains` restricts
 * which e-mail domains may sign in at all. Settings win over the .env bootstrap (E-6).
 */

const PROVIDER = 'google';
const HTTP_TIMEOUT_MS = 10_000;

interface GoogleConfig {
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  autoCreate: boolean;
  allowedDomains: string[];
}

async function googleConfig(): Promise<GoogleConfig> {
  const e = env();
  const str = async (key: string) => {
    const v = await settings.get(null, key);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  return {
    enabled: (await settings.get(null, 'security.google_enabled')) === true,
    clientId: (await str('security.google_client_id')) ?? e.GOOGLE_CLIENT_ID ?? null,
    clientSecret: (await str('security.google_client_secret')) ?? e.GOOGLE_CLIENT_SECRET ?? null,
    autoCreate: (await settings.get(null, 'security.google_auto_create')) === true,
    allowedDomains: parseDomainList(await str('security.google_allowed_domains')),
  };
}

/** The redirect URI must point back at one of OUR public origins (Decision E), never elsewhere. */
function redirectUriAllowed(raw: string, request: Request): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return allowedOrigins(request).includes(u.origin);
}

/** Code → tokens → identity. Any deviation (network, non-2xx, malformed) is one failure to the caller. */
async function fetchIdentity(p: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthIdentity | null> {
  const e = env();
  const tokenRes = await fetch(e.GOOGLE_OAUTH_TOKEN_URL ?? GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      code: p.code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: p.codeVerifier,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null;
  const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : null;
  if (!accessToken) return null;
  const infoRes = await fetch(e.GOOGLE_OAUTH_USERINFO_URL ?? GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!infoRes.ok) return null;
  return parseGoogleUserinfo(await infoRes.json().catch(() => null));
}

export const authGoogle = new Elysia({ name: 'auth-google', prefix: '/auth', tags: ['auth'] })
  .use(requestContext)
  .use(authContext)

  // ---- step 1: where to send the browser ------------------------------------------------
  .get(
    '/google/start',
    async ({ query, set, request, requestId }) => {
      const cfg = await googleConfig();
      if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
        set.status = 403;
        return fail('sso_disabled', 'Masuk dengan Google tidak diaktifkan', requestId);
      }
      if (!redirectUriAllowed(query.redirect_uri, request)) {
        set.status = 422;
        return fail('validation_failed', 'redirect_uri bukan origin aplikasi ini', requestId);
      }
      const state = randomToken();
      const pkce = pkcePair();
      const url = googleAuthorizeUrl({
        clientId: cfg.clientId,
        redirectUri: query.redirect_uri,
        state,
        codeChallenge: pkce.challenge,
        // A single allowed domain doubles as Google's account-picker hint; the check below is what enforces it.
        hostedDomain: cfg.allowedDomains.length === 1 ? cfg.allowedDomains[0] : undefined,
      });
      return ok({ url, state, codeVerifier: pkce.verifier });
    },
    {
      query: t.Object({ redirect_uri: t.String({ minLength: 8, maxLength: 512 }) }),
      response: {
        200: OkSchema(t.Object({ url: t.String(), state: t.String(), codeVerifier: t.String() })),
        ...errorResponses,
      },
      detail: {
        summary:
          'Begin Sign in with Google (A-8): authorization URL + state + PKCE verifier for the web app to hold',
      },
    },
  )

  // ---- step 3: the code comes back ------------------------------------------------------
  .post(
    '/google-login',
    async ({ body, set, request, requestId, cookie, server }) => {
      const e = env();
      const db = unsafeAcrossTenants();
      const ip = clientIp(request, server) ?? 'unknown';
      const cfg = await googleConfig();
      if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
        set.status = 403;
        return fail('sso_disabled', 'Masuk dengan Google tidak diaktifkan', requestId);
      }
      if (!redirectUriAllowed(body.redirectUri, request)) {
        set.status = 422;
        return fail('validation_failed', 'redirectUri bukan origin aplikasi ini', requestId);
      }

      // The same budget as password logins (A-2), on its own counter: a callback storm from one
      // address must not lock out password users of that address, and vice versa.
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

      const refuse = async (
        status: 401 | 403,
        code: 'sso_failed' | 'sso_not_allowed' | 'invalid_credentials',
        message: string,
        detail: Record<string, unknown>,
      ) => {
        await writeAudit(db, {
          clientId: null,
          actorId: null,
          action: 'auth.login_failed',
          resource: 'user',
          resourceId: typeof detail.email === 'string' ? detail.email : PROVIDER,
          ip,
          requestId,
          after: { sso: PROVIDER, ...detail },
        });
        set.status = status;
        return fail(code, message, requestId);
      };

      let identity: OAuthIdentity | null = null;
      try {
        identity = await fetchIdentity({
          code: body.code,
          codeVerifier: body.codeVerifier,
          redirectUri: body.redirectUri,
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
        });
      } catch {
        identity = null;
      }
      if (!identity)
        return refuse(401, 'sso_failed', 'Masuk dengan Google gagal — coba lagi', {
          reason: 'exchange',
        });
      if (!identity.emailVerified)
        return refuse(401, 'sso_failed', 'Email akun Google Anda belum terverifikasi', {
          reason: 'email_unverified',
          email: identity.email,
        });
      if (!emailDomainAllowed(identity.email, cfg.allowedDomains))
        return refuse(403, 'sso_not_allowed', 'Domain email ini tidak diizinkan masuk', {
          reason: 'domain',
          email: identity.email,
        });

      // Resolve the user: by link (sub) first, then by verified e-mail, then — flag permitting — create.
      const [link] = await db
        .select()
        .from(schema.oauthAccounts)
        .where(
          and(
            eq(schema.oauthAccounts.provider, PROVIDER),
            eq(schema.oauthAccounts.provider_user_id, identity.sub),
          ),
        )
        .limit(1);
      let user: typeof schema.users.$inferSelect | undefined;
      let created = false;
      if (link) {
        [user] = await db
          .select()
          .from(schema.users)
          .where(and(eq(schema.users.id, link.user_id), isNull(schema.users.deleted_at)))
          .limit(1);
      } else {
        [user] = await db
          .select()
          .from(schema.users)
          .where(and(eq(schema.users.email, identity.email), isNull(schema.users.deleted_at)))
          .limit(1);
        if (!user) {
          if (!cfg.autoCreate)
            return refuse(
              403,
              'sso_not_allowed',
              'Akun dengan email ini belum terdaftar — minta admin membuat akun Anda',
              { reason: 'not_registered', email: identity.email },
            );
          const userId = newId();
          await db.insert(schema.users).values({
            id: userId,
            email: identity.email,
            name: identity.name,
            password_hash: null,
            avatar_url: identity.avatarUrl,
            email_verified_at: new Date(),
          });
          const tenantId = await attachDefaultTenant(db, userId);
          emit('user.created', { userId, clientId: tenantId }, { requestId });
          [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
          created = true;
        }
      }
      if (!user)
        return refuse(401, 'sso_failed', 'Masuk dengan Google gagal — coba lagi', {
          reason: 'dangling_link',
        });
      if (user.status_id !== STATUS.ACTIVE)
        return refuse(401, 'invalid_credentials', 'Akun ini dinonaktifkan', {
          reason: 'inactive',
          email: identity.email,
        });

      const now = new Date();
      if (link) {
        await db
          .update(schema.oauthAccounts)
          .set({ email: identity.email, last_login_at: now })
          .where(eq(schema.oauthAccounts.id, link.id));
      } else {
        await db.insert(schema.oauthAccounts).values({
          id: newId(),
          user_id: user.id,
          provider: PROVIDER,
          provider_user_id: identity.sub,
          email: identity.email,
          last_login_at: now,
        });
      }
      // Google vouched for the address: an unverified local account becomes verified (A-6).
      if (!created && !user.email_verified_at) {
        await db
          .update(schema.users)
          .set({ email_verified_at: now })
          .where(eq(schema.users.id, user.id));
        await invalidateUserSessions(user.id);
        user = { ...user, email_verified_at: now };
      }
      if (!link) {
        await writeAudit(db, {
          clientId: null,
          actorId: user.id,
          action: created ? 'auth.sso_account_created' : 'auth.sso_linked',
          resource: 'user',
          resourceId: user.id,
          ip,
          requestId,
          after: { provider: PROVIDER, email: identity.email },
        });
      }

      const challenge = await startMfaChallenge({ db, userId: user.id, ip, requestId });
      if (challenge) return ok(challenge);
      return ok(await issueSession({ db, user, ip, request, cookie, requestId, sso: PROVIDER }));
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 2048 }),
        codeVerifier: t.String({ minLength: 43, maxLength: 128 }),
        redirectUri: t.String({ minLength: 8, maxLength: 512 }),
      }),
      response: {
        200: OkSchema(
          t.Union([
            t.Object({ user: PublicUser, clientId: t.Nullable(t.String()) }),
            t.Object({ mfaRequired: t.Literal(true), challenge: t.String() }),
          ]),
        ),
        ...errorResponses,
      },
      detail: {
        summary:
          'Sign in with Google (A-8): exchange the code, link or auto-create the user, then a session cookie or an MFA challenge',
      },
    },
  );

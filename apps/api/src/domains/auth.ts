import {
  canActInTenant,
  consumeRateLimit,
  createSession,
  effectivePermissions,
  findSession,
  hashPassword,
  hashRecoveryCode,
  hashToken,
  invalidateUserSessions,
  parseRateLimitRule,
  passwordProblems,
  permissionRegistry,
  randomToken,
  rateLimitHeaders,
  revokeAllSessions,
  revokeSession,
  setActiveTenant,
  tenantsOf,
  verifyPassword,
  verifyTotp,
  writeAudit,
} from '@core/auth';
import { env } from '@core/config';
import { Email, errorResponses, fail, MfaLoginBody, OkSchema, ok, Password } from '@core/contracts';
import { and, eq, isNull, newId, STATUS, schema, unsafeAcrossTenants } from '@core/db';
import { Elysia, t } from 'elysia';
import { publicLink, sendTemplate } from '../mail.ts';
import {
  authContext,
  clientIp,
  IMPERSONATE_COOKIE,
  publicUser,
  requireAuth,
  SESSION_COOKIE,
} from '../plugins/auth.ts';
import { cookieAttributes, issueCsrfToken } from '../plugins/csrf.ts';
import { requestContext } from '../plugins/request-context.ts';
import { requirePermission, TENANT_HEADER, tenantContext } from '../plugins/tenancy.ts';
import { emit, settings } from '../services.ts';

/**
 * Authentication (PRD FR-A). Cookie sessions, Argon2id, rate-limited login, verification and
 * reset tokens. All mutations here are CSRF-protected by the global plugin (A-10) — including
 * login. Every read/write below is on GLOBAL tables (users, sessions, tokens), hence the raw
 * connection; tenant-scoped data never appears in this file.
 *
 * Email DELIVERY arrives with the outbox in M4 (J-2). Until then tokens are minted and stored
 * exactly as they will be, and the link is logged at warn level outside production.
 */

const PublicUser = t.Object({
  id: t.String(),
  email: t.String(),
  name: t.String(),
  avatarUrl: t.Nullable(t.String()),
  locale: t.String(),
  theme: t.Nullable(t.String()),
  isSuperadmin: t.Boolean(),
  emailVerifiedAt: t.Nullable(t.String()),
  lastLoginAt: t.Nullable(t.String()),
  createdAt: t.String(),
});

const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;

function _log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));
}

async function defaultTenantFor(userId: string): Promise<string | null> {
  const db = unsafeAcrossTenants();
  const rows = await db
    .select({
      client_id: schema.clientUserMaps.client_id,
      is_default: schema.clientUserMaps.is_default,
    })
    .from(schema.clientUserMaps)
    .where(
      and(eq(schema.clientUserMaps.user_id, userId), isNull(schema.clientUserMaps.deleted_at)),
    );
  return rows.find((r) => r.is_default)?.client_id ?? rows[0]?.client_id ?? null;
}

/** A password-verified login becomes a session: cookie, last_login_at, audit (A-3, A-11). */
async function issueSession(p: {
  db: ReturnType<typeof unsafeAcrossTenants>;
  user: typeof schema.users.$inferSelect;
  ip: string;
  request: Request;
  cookie: Record<string, { set(v: Record<string, unknown>): void } | undefined>;
  requestId: string;
  mfa?: 'totp' | 'recovery';
}) {
  const e = env();
  const clientId = await defaultTenantFor(p.user.id);
  const session = await createSession(p.db, {
    userId: p.user.id,
    clientId,
    ip: p.ip,
    userAgent: p.request.headers.get('user-agent'),
    ttlSeconds:
      ((await settings.get<number | null>(null, 'security.session_hours')) ?? e.SESSION_TTL_HOURS) *
      3600,
  });
  await p.db
    .update(schema.users)
    .set({ last_login_at: new Date() })
    .where(eq(schema.users.id, p.user.id));
  p.cookie[SESSION_COOKIE]?.set({
    value: session.token,
    ...cookieAttributes(p.request),
    expires: session.expiresAt,
  });
  await writeAudit(p.db, {
    clientId,
    actorId: p.user.id,
    action: 'auth.login',
    resource: 'user',
    resourceId: p.user.id,
    ip: p.ip,
    requestId: p.requestId,
    after: p.mfa ? { mfa: p.mfa } : undefined,
  });
  return { user: publicUser(p.user), clientId };
}
/** A challenge lives five minutes and dies after five wrong codes. */
const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const MFA_MAX_ATTEMPTS = 5;

export const auth = new Elysia({ name: 'auth', prefix: '/auth', tags: ['auth'] })
  .use(requestContext)
  .use(authContext)

  // ---- CSRF token for browser clients ------------------------------------------------------
  .get('/csrf-token', ({ cookie, request }) => ok({ token: issueCsrfToken(cookie, request) }), {
    response: OkSchema(t.Object({ token: t.String() })),
    detail: { summary: 'Mint a CSRF token (double-submit cookie + value)' },
  })

  // ---- register --------------------------------------------------------------------------
  .post(
    '/register',
    async ({ body, set, request, requestId, cookie, server }) => {
      const e = env();
      // Runtime configuration wins over the .env bootstrap value when an admin has set it (E-6).
      const signup =
        (await settings.get<boolean | null>(null, 'security.signup_enabled')) ?? e.SIGNUP_ENABLED;
      if (!signup) {
        set.status = 403;
        return fail('signup_disabled', 'Pendaftaran mandiri dimatikan', requestId);
      }
      const problems = passwordProblems(body.password);
      if (problems.length) {
        set.status = 422;
        return fail('weak_password', 'Kata sandi terlalu lemah', requestId, problems);
      }
      const db = unsafeAcrossTenants();
      const email = body.email.trim().toLowerCase();
      const [existing] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing) {
        set.status = 409;
        return fail('email_taken', 'Email sudah terdaftar', requestId);
      }
      const userId = newId();
      await db.insert(schema.users).values({
        id: userId,
        email,
        name: body.name.trim(),
        password_hash: await hashPassword(body.password),
      });
      // Attach to the default tenant when one exists (B-5); the seed creates it.
      const [tenant] = await db
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(eq(schema.clients.code, 'default'))
        .limit(1);
      if (tenant) {
        await db
          .insert(schema.clientUserMaps)
          .values({ id: newId(), client_id: tenant.id, user_id: userId, is_default: true });
      }
      emit('user.created', { userId, clientId: tenant?.id ?? null }, { requestId });
      const verify = randomToken();
      await db.insert(schema.emailVerificationTokens).values({
        id: newId(),
        user_id: userId,
        token_hash: hashToken(verify),
        expires_at: new Date(Date.now() + VERIFY_TTL_MS),
      });
      await sendTemplate(db, {
        to: email,
        toName: body.name.trim(),
        template: 'verify-email',
        locale: 'id',
        clientId: tenant?.id ?? null,
        data: { name: body.name.trim(), link: publicLink(`/auth/verify?token=${verify}`) },
      });

      const session = await createSession(db, {
        userId,
        clientId: tenant?.id ?? null,
        ip: clientIp(request, server),
        userAgent: request.headers.get('user-agent'),
        ttlSeconds:
          ((await settings.get<number | null>(null, 'security.session_hours')) ??
            e.SESSION_TTL_HOURS) * 3600,
      });
      cookie[SESSION_COOKIE]?.set({
        value: session.token,
        ...cookieAttributes(request),
        expires: session.expiresAt,
      });
      await writeAudit(db, {
        clientId: tenant?.id ?? null,
        actorId: userId,
        action: 'auth.register',
        resource: 'user',
        resourceId: userId,
        ip: clientIp(request, server),
        requestId,
      });

      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      set.status = 201;
      return ok({
        user: publicUser(user as NonNullable<typeof user>),
        clientId: tenant?.id ?? null,
      });
    },
    {
      body: t.Object({
        email: Email,
        password: Password,
        name: t.String({ minLength: 1, maxLength: 191 }),
      }),
      response: {
        201: OkSchema(t.Object({ user: PublicUser, clientId: t.Nullable(t.String()) })),
        ...errorResponses,
      },
      detail: { summary: 'Register with email + password (A-1); off when SIGNUP_ENABLED=false' },
    },
  )

  // ---- login -----------------------------------------------------------------------------
  .post(
    '/login',
    async ({ body, set, request, requestId, cookie, server }) => {
      const e = env();
      const db = unsafeAcrossTenants();
      const email = body.email.trim().toLowerCase();
      const ip = clientIp(request, server) ?? 'unknown';
      const rule = parseRateLimitRule(
        (await settings.get<string | null>(null, 'security.login_rate_limit')) ??
          e.LOGIN_RATE_LIMIT,
      );

      // Stricter than the general limit (A-2): per IP and per account, whichever trips first.
      const byIp = await consumeRateLimit(db, `login:ip:${ip}`, rule);
      const byEmail = await consumeRateLimit(db, `login:email:${email}`, rule);
      const tightest = byIp.remaining <= byEmail.remaining ? byIp : byEmail;
      Object.assign(set.headers, rateLimitHeaders(tightest));
      if (!byIp.allowed || !byEmail.allowed) {
        set.status = 429;
        return fail('rate_limited', 'Terlalu banyak percobaan masuk — coba lagi nanti', requestId);
      }

      const [user] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.email, email), isNull(schema.users.deleted_at)))
        .limit(1);
      const valid =
        user?.status_id === STATUS.ACTIVE &&
        (await verifyPassword(body.password, user?.password_hash ?? null));
      if (!user || !valid) {
        await writeAudit(db, {
          clientId: null,
          actorId: user?.id ?? null,
          action: 'auth.login_failed',
          resource: 'user',
          resourceId: user?.id ?? email,
          ip,
          requestId,
        });
        set.status = 401;
        return fail('invalid_credentials', 'Email atau kata sandi salah', requestId);
      }

      // Second factor (A-11): the password alone does not open a session — hand out a short-lived
      // challenge the client completes at POST /auth/login/mfa.
      const [mfa] = await db
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.user_id, user.id))
        .limit(1);
      if (mfa?.enabled_at) {
        const token = randomToken();
        await db.insert(schema.mfaChallenges).values({
          id: newId(),
          user_id: user.id,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + MFA_CHALLENGE_TTL_MS),
          ip,
        });
        await writeAudit(db, {
          clientId: null,
          actorId: user.id,
          action: 'auth.mfa_challenge',
          resource: 'user',
          resourceId: user.id,
          ip,
          requestId,
        });
        return ok({ mfaRequired: true as const, challenge: token });
      }
      return ok(await issueSession({ db, user, ip, request, cookie, requestId }));
    },
    {
      body: t.Object({ email: Email, password: Password }),
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
          'Login (A-2, A-3): rate-limited; sets the httpOnly session cookie, or returns an MFA challenge (A-11)',
      },
    },
  )
  .post(
    '/login/mfa',
    async ({ body, set, request, requestId, cookie, server }) => {
      const db = unsafeAcrossTenants();
      const ip = clientIp(request, server) ?? 'unknown';
      const now = new Date();
      const [ch] = await db
        .select()
        .from(schema.mfaChallenges)
        .where(eq(schema.mfaChallenges.token_hash, hashToken(body.challenge)))
        .limit(1);
      const refuse = (
        message: string,
        code: 'invalid_credentials' | 'rate_limited' = 'invalid_credentials',
      ) => {
        set.status = code === 'rate_limited' ? 429 : 401;
        return fail(code, message, requestId);
      };
      if (!ch || ch.expires_at.getTime() < now.getTime()) {
        if (ch) await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, ch.id));
        return refuse('Tantangan 2FA tidak valid atau kedaluwarsa — masuk lagi');
      }
      if (ch.attempts >= MFA_MAX_ATTEMPTS) {
        await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, ch.id));
        return refuse('Terlalu banyak kode salah — masuk lagi', 'rate_limited');
      }
      const [user] = await db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, ch.user_id), isNull(schema.users.deleted_at)))
        .limit(1);
      const [mfa] = await db
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.user_id, ch.user_id))
        .limit(1);
      if (!user || user.status_id !== STATUS.ACTIVE || !mfa?.enabled_at) {
        await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, ch.id));
        return refuse('Tantangan 2FA tidak valid — masuk lagi');
      }
      // TOTP first (with replay protection), then a single-use recovery code.
      const step = await verifyTotp(mfa.secret, body.code, { now, lastStep: mfa.last_step });
      let method: 'totp' | 'recovery' | null = step !== null ? 'totp' : null;
      if (step !== null) {
        await db
          .update(schema.userMfa)
          .set({ last_step: step })
          .where(eq(schema.userMfa.id, mfa.id));
      } else {
        const hashes = Array.isArray(mfa.recovery_codes)
          ? (mfa.recovery_codes as unknown[]).filter((h): h is string => typeof h === 'string')
          : [];
        const h = hashRecoveryCode(body.code);
        if (hashes.includes(h)) {
          method = 'recovery';
          await db
            .update(schema.userMfa)
            .set({ recovery_codes: hashes.filter((x) => x !== h) })
            .where(eq(schema.userMfa.id, mfa.id));
        }
      }
      if (!method) {
        await db
          .update(schema.mfaChallenges)
          .set({ attempts: ch.attempts + 1 })
          .where(eq(schema.mfaChallenges.id, ch.id));
        await writeAudit(db, {
          clientId: null,
          actorId: user.id,
          action: 'auth.mfa_failed',
          resource: 'user',
          resourceId: user.id,
          ip,
          requestId,
        });
        return refuse('Kode 2FA salah');
      }
      await db.delete(schema.mfaChallenges).where(eq(schema.mfaChallenges.id, ch.id));
      const result = await issueSession({ db, user, ip, request, cookie, requestId, mfa: method });
      return ok(result);
    },
    {
      body: MfaLoginBody,
      response: {
        200: OkSchema(t.Object({ user: PublicUser, clientId: t.Nullable(t.String()) })),
        ...errorResponses,
      },
      detail: {
        summary:
          'Second login step (A-11): challenge from /auth/login + TOTP or recovery code → session cookie',
      },
    },
  )

  // ---- verify email ----------------------------------------------------------------------
  .get(
    '/verify-email',
    async ({ query, set, requestId }) => {
      const db = unsafeAcrossTenants();
      const [row] = await db
        .select()
        .from(schema.emailVerificationTokens)
        .where(eq(schema.emailVerificationTokens.token_hash, hashToken(query.token)))
        .limit(1);
      if (!row || row.used_at) {
        set.status = 422;
        return fail('token_invalid', 'Tautan verifikasi tidak valid atau sudah dipakai', requestId);
      }
      if (row.expires_at < new Date()) {
        set.status = 422;
        return fail('token_expired', 'Tautan verifikasi sudah kedaluwarsa', requestId);
      }
      const now = new Date();
      await db
        .update(schema.emailVerificationTokens)
        .set({ used_at: now })
        .where(eq(schema.emailVerificationTokens.id, row.id));
      await db
        .update(schema.users)
        .set({ email_verified_at: now })
        .where(eq(schema.users.id, row.user_id));
      await invalidateUserSessions(row.user_id);
      return ok({ verified: true as const });
    },
    {
      query: t.Object({ token: t.String({ minLength: 43, maxLength: 43 }) }),
      response: { 200: OkSchema(t.Object({ verified: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Confirm an email address (A-6)' },
    },
  )

  // ---- password reset (A-7) --------------------------------------------------------------
  .post(
    '/reset-password/request',
    async ({ body, request, server, set, requestId }) => {
      const db = unsafeAcrossTenants();
      const email = body.email.trim().toLowerCase();
      const ip = clientIp(request, server) ?? 'unknown';
      const rl = await consumeRateLimit(
        db,
        `reset:ip:${ip}`,
        parseRateLimitRule(env().LOGIN_RATE_LIMIT),
      );
      Object.assign(set.headers, rateLimitHeaders(rl));
      if (!rl.allowed) {
        set.status = 429;
        return fail('rate_limited', 'Terlalu banyak permintaan — coba lagi nanti', requestId);
      }
      const [user] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.email, email), isNull(schema.users.deleted_at)))
        .limit(1);
      if (user) {
        const token = randomToken();
        await db.insert(schema.passwordResetTokens).values({
          id: newId(),
          user_id: user.id,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + RESET_TTL_MS),
        });
        await sendTemplate(db, {
          to: email,
          template: 'reset-password',
          locale: 'id',
          clientId: null,
          data: { name: '', link: publicLink(`/auth/reset?token=${token}`) },
        });
      }
      // Always the same answer: whether the email exists is not for the caller to learn.
      return ok({ requested: true as const });
    },
    {
      body: t.Object({ email: Email }),
      response: { 200: OkSchema(t.Object({ requested: t.Literal(true) })), ...errorResponses },
      detail: {
        summary: 'Request a reset link; identical response whether or not the email exists',
      },
    },
  )
  .post(
    '/reset-password/validate-token',
    async ({ body }) => {
      const [row] = await unsafeAcrossTenants()
        .select({
          used_at: schema.passwordResetTokens.used_at,
          expires_at: schema.passwordResetTokens.expires_at,
        })
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.token_hash, hashToken(body.token)))
        .limit(1);
      const valid = !!row && !row.used_at && row.expires_at > new Date();
      return ok({ valid });
    },
    {
      body: t.Object({ token: t.String({ minLength: 43, maxLength: 43 }) }),
      response: OkSchema(t.Object({ valid: t.Boolean() })),
      detail: { summary: 'Check a reset token before showing the form' },
    },
  )
  .post(
    '/reset-password/confirm',
    async ({ body, set, requestId, request, server }) => {
      const db = unsafeAcrossTenants();
      const [row] = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.token_hash, hashToken(body.token)))
        .limit(1);
      if (!row || row.used_at) {
        set.status = 422;
        return fail('token_invalid', 'Tautan reset tidak valid atau sudah dipakai', requestId);
      }
      if (row.expires_at < new Date()) {
        set.status = 422;
        return fail('token_expired', 'Tautan reset sudah kedaluwarsa', requestId);
      }
      const problems = passwordProblems(body.password);
      if (problems.length) {
        set.status = 422;
        return fail('weak_password', 'Kata sandi terlalu lemah', requestId, problems);
      }
      await db
        .update(schema.users)
        .set({ password_hash: await hashPassword(body.password) })
        .where(eq(schema.users.id, row.user_id));
      await db
        .update(schema.passwordResetTokens)
        .set({ used_at: new Date() })
        .where(eq(schema.passwordResetTokens.id, row.id));
      const revoked = await revokeAllSessions(db, row.user_id); // a reset ends every existing session
      await writeAudit(db, {
        clientId: null,
        actorId: row.user_id,
        action: 'auth.password_reset',
        resource: 'user',
        resourceId: row.user_id,
        ip: clientIp(request, server),
        requestId,
        after: { revokedSessions: revoked },
      });
      return ok({ reset: true as const });
    },
    {
      body: t.Object({ token: t.String({ minLength: 43, maxLength: 43 }), password: Password }),
      response: { 200: OkSchema(t.Object({ reset: t.Literal(true) })), ...errorResponses },
      detail: { summary: 'Set a new password with a one-time token; revokes all sessions' },
    },
  )

  // ---- session-bound -----------------------------------------------------------------------
  .group('', (g) =>
    g
      .use(requireAuth)
      .post(
        '/logout',
        async ({ auth, cookie, request, server, requestId }) => {
          const a = auth as NonNullable<typeof auth>;
          if (a.session) await revokeSession(unsafeAcrossTenants(), a.session.id);
          // Logging out while impersonating (D-6) ends the admin's own session too, not just the mask.
          const own = cookie[SESSION_COOKIE]?.value;
          if (a.impersonator && typeof own === 'string') {
            const base = await findSession(unsafeAcrossTenants(), own);
            if (base) await revokeSession(unsafeAcrossTenants(), base.session.id);
          }
          cookie[SESSION_COOKIE]?.set({ value: '', ...cookieAttributes(request), maxAge: 0 });
          cookie[IMPERSONATE_COOKIE]?.set({ value: '', ...cookieAttributes(request), maxAge: 0 });
          await writeAudit(unsafeAcrossTenants(), {
            clientId: a.clientId,
            actorId: a.user.id,
            action: 'auth.logout',
            resource: 'user',
            resourceId: a.user.id,
            ip: clientIp(request, server),
            requestId,
          });
          return ok({ loggedOut: true as const });
        },
        {
          response: { 200: OkSchema(t.Object({ loggedOut: t.Literal(true) })), ...errorResponses },
          detail: { summary: 'Invalidate the session server-side (A-5)' },
        },
      )
      .get(
        '/me',
        async ({ auth }) => {
          const a = auth as NonNullable<typeof auth>;
          const tenants = await tenantsOf(unsafeAcrossTenants(), a.user.id);
          return ok({
            user: publicUser(a.user),
            clientId: a.clientId,
            tenants,
            impersonator: a.impersonator
              ? { id: a.impersonator.id, name: a.impersonator.name, email: a.impersonator.email }
              : null,
            session: a.session
              ? {
                  id: a.session.id,
                  expiresAt: a.session.expires_at.toISOString(),
                  lastSeenAt: a.session.last_seen_at.toISOString(),
                  ip: a.session.ip,
                  userAgent: a.session.user_agent,
                }
              : null,
            token: a.token
              ? { id: a.token.id, name: a.token.name, scopes: a.scopes ? [...a.scopes] : null }
              : null,
          });
        },
        {
          response: {
            200: OkSchema(
              t.Object({
                user: PublicUser,
                clientId: t.Nullable(t.String()),
                impersonator: t.Nullable(
                  t.Object({ id: t.String(), name: t.String(), email: t.String() }),
                ),
                tenants: t.Array(
                  t.Object({
                    id: t.String(),
                    code: t.String(),
                    name: t.String(),
                    isDefault: t.Boolean(),
                  }),
                ),
                token: t.Nullable(
                  t.Object({
                    id: t.String(),
                    name: t.String(),
                    scopes: t.Nullable(t.Array(t.String())),
                  }),
                ),
                session: t.Nullable(
                  t.Object({
                    id: t.String(),
                    expiresAt: t.String(),
                    lastSeenAt: t.String(),
                    ip: t.Nullable(t.String()),
                    userAgent: t.Nullable(t.String()),
                  }),
                ),
              }),
            ),
            ...errorResponses,
          },
          detail: { summary: 'The current user, active tenant, and reachable tenants' },
        },
      )
      .use(tenantContext)
      .get(
        '/permissions',
        ({ auth, tenantState }) => {
          const a = auth as NonNullable<typeof auth>;
          return ok({
            clientId: tenantState.clientId,
            isSuperadmin: a.user.is_superadmin,
            permissions: [...tenantState.perms],
          });
        },
        {
          response: {
            200: OkSchema(
              t.Object({
                clientId: t.Nullable(t.String()),
                isSuperadmin: t.Boolean(),
                permissions: t.Array(t.String()),
              }),
            ),
            ...errorResponses,
          },
          detail: {
            summary: `Effective permissions in the active tenant (C-7); honours ${TENANT_HEADER}`,
          },
        },
      )
      .post(
        '/switch-tenant',
        async ({ auth, body, set, request, server, requestId }) => {
          const a = auth as NonNullable<typeof auth>;
          const db = unsafeAcrossTenants();
          if (!(await canActInTenant(db, a.user, body.clientId))) {
            set.status = 403;
            return fail('tenant_forbidden', 'Anda bukan anggota tenant tersebut', requestId);
          }
          if (!a.session) {
            set.status = 403;
            return fail(
              'forbidden',
              'API token tidak bisa berganti tenant — pakai X-Client-ID',
              requestId,
              {
                reason: 'session_only',
              },
            );
          }
          await setActiveTenant(db, a.session.id, body.clientId);
          await writeAudit(db, {
            clientId: body.clientId,
            actorId: a.user.id,
            action: 'auth.switch_tenant',
            resource: 'client',
            resourceId: body.clientId,
            ip: clientIp(request, server),
            requestId,
            before: { clientId: a.clientId },
            after: { clientId: body.clientId },
          });
          emit(
            'tenant.switched',
            { userId: a.user.id, fromClientId: a.clientId, toClientId: body.clientId },
            { requestId },
          );
          const permissions = await effectivePermissions(db, a.user, body.clientId);
          return ok({ clientId: body.clientId, permissions });
        },
        {
          body: t.Object({ clientId: t.String({ minLength: 36, maxLength: 36 }) }),
          response: {
            200: OkSchema(t.Object({ clientId: t.String(), permissions: t.Array(t.String()) })),
            ...errorResponses,
          },
          detail: { summary: 'Make another tenant the active one for this session (B-4)' },
        },
      )
      // The first permission-guarded route: the registry the permission editor lists (C-4, C-7).
      .use(requirePermission('group.read'))
      .get(
        '/permission-registry',
        () =>
          ok({
            resources: permissionRegistry().map((r) => ({
              module: r.module,
              resource: r.resource,
              actions: [...r.actions],
              name: r.name,
            })),
          }),
        {
          response: {
            200: OkSchema(
              t.Object({
                resources: t.Array(
                  t.Object({
                    module: t.String(),
                    resource: t.String(),
                    actions: t.Array(t.String()),
                    name: t.Object({ id: t.String(), en: t.String() }),
                  }),
                ),
              }),
            ),
            ...errorResponses,
          },
          detail: { summary: 'Every resource/action that exists (C-4); needs group.read' },
        },
      ),
  );

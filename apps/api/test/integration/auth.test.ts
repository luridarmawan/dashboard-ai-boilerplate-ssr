import { beforeAll, describe, expect, test } from 'bun:test';
import { desc, eq, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration: the real app against a real database (INTEGRATION=1, migrations applied).
 * Run with `bun run test:integration:docker`; CI runs it with a MySQL service container.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.77.${Math.floor(run / 1000) % 250}.${run % 250}`;
const email = `it-${run}@example.test`;
const password = 'a perfectly fine password';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  // A per-run client IP: the login rate limit (A-2) is keyed by IP and lives in the shared dev
  // database for 15 minutes, so repeated local runs must not exhaust each other's budget.
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';

describe.skipIf(!enabled)('auth flow (A-1…A-7, A-10, A-12)', () => {
  let cookie = '';

  beforeAll(async () => {
    if (!enabled) return;
    process.env.SIGNUP_ENABLED = 'true';
  });

  test('register → 201, session cookie set httpOnly/SameSite=Lax', async () => {
    const res = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name: 'Integration' }),
    });
    expect(res.status).toBe(201);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('dab_session='));
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    cookie = sessionCookie(res);
    expect(cookie.length).toBeGreaterThan(20);
  });

  test('duplicate email → 409; weak password → 422', async () => {
    expect(
      (
        await call('/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, name: 'x' }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call('/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email: `w-${run}@x.test`, password: 'short', name: 'x' }),
        })
      ).status,
    ).toBe(422);
  });

  test('/me with the cookie → user; without → 401', async () => {
    const me = await json(await call('/v1/auth/me', {}, [cookie]));
    expect(me.success).toBe(true);
    const user = me.data?.user as { email: string } | undefined;
    expect(user?.email).toBe(email);
    expect((await call('/v1/auth/me')).status).toBe(401);
  });

  test('login: wrong password → 401 with RateLimit headers; right password → 200 + new session', async () => {
    const bad = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'nope-nope-nope' }),
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('ratelimit-limit')).toBe('10');
    const good = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    expect(good.status).toBe(200);
    expect(sessionCookie(good)).not.toBe(cookie);
  });

  test('login is rate limited per email (A-2): 11th attempt in the window → 429 + Retry-After', async () => {
    const victim = `rl-${run}@example.test`;
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await call('/v1/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
        body: JSON.stringify({ email: victim, password: 'x'.repeat(12) }),
      });
    }
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('email verification token from the DB verifies the account (A-6)', async () => {
    const db = unsafeAcrossTenants();
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    // The token itself is never stored; re-mint one the way the app does and verify with it.
    const { hashToken, randomToken } = await import('@core/auth');
    const { newId } = await import('@core/db');
    const raw = randomToken();
    await db.insert(schema.emailVerificationTokens).values({
      id: newId(),
      user_id: user?.id ?? '',
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + 60_000),
    });
    expect((await call(`/v1/auth/verify-email?token=${raw}`)).status).toBe(200);
    expect((await call(`/v1/auth/verify-email?token=${raw}`)).status).toBe(422); // one-time
    const [after] = await db
      .select({ v: schema.users.email_verified_at })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    expect(after?.v).not.toBeNull();
  });

  test('the reset e-mail is written in the language of the request that asked for it (K-2)', async () => {
    const db = unsafeAcrossTenants();
    const queued = async () => {
      const [row] = await db
        .select({ id: schema.outboxEmail.id, locale: schema.outboxEmail.locale })
        .from(schema.outboxEmail)
        .where(eq(schema.outboxEmail.to_address, email))
        .orderBy(desc(schema.outboxEmail.created_at))
        .limit(1);
      return row;
    };
    // The web forwards the locale it resolved for the visitor; anything else falls back to `id`.
    await call('/v1/auth/reset-password/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
      headers: { 'accept-language': 'en' },
    });
    expect((await queued())?.locale).toBe('en');
    await call('/v1/auth/reset-password/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    expect((await queued())?.locale).toBe('id');
  });

  test('password reset: request is uniform, confirm revokes all sessions (A-7)', async () => {
    expect(
      (
        await call('/v1/auth/reset-password/request', {
          method: 'POST',
          body: JSON.stringify({ email: `ghost-${run}@x.test` }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('/v1/auth/reset-password/request', {
          method: 'POST',
          body: JSON.stringify({ email }),
        })
      ).status,
    ).toBe(200);
    const db = unsafeAcrossTenants();
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    const { hashToken, randomToken } = await import('@core/auth');
    const { newId } = await import('@core/db');
    const raw = randomToken();
    await db.insert(schema.passwordResetTokens).values({
      id: newId(),
      user_id: user?.id ?? '',
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + 60_000),
    });
    expect(
      (
        await json(
          await call('/v1/auth/reset-password/validate-token', {
            method: 'POST',
            body: JSON.stringify({ token: raw }),
          }),
        )
      ).data?.valid,
    ).toBe(true);
    const newPw = 'another fine password 2';
    expect(
      (
        await call('/v1/auth/reset-password/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: raw, password: newPw }),
        })
      ).status,
    ).toBe(200);
    expect((await call('/v1/auth/me', {}, [cookie])).status).toBe(401); // old session revoked
    expect(
      (
        await call('/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password: newPw }),
        })
      ).status,
    ).toBe(200);
  });

  test('logout invalidates server-side (A-5)', async () => {
    const login = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'another fine password 2' }),
    });
    const c = sessionCookie(login);
    expect((await call('/v1/auth/logout', { method: 'POST' }, [c])).status).toBe(200);
    expect((await call('/v1/auth/me', {}, [c])).status).toBe(401);
  });
});

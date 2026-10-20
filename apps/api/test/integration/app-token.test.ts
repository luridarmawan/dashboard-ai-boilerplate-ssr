import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApiToken } from '@core/auth';
import { resetEnvCache } from '@core/config';
import { type Db, eq, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import { settings } from '../../src/services.ts';

/**
 * Integration (INTEGRATION=1): sign-in for apps (PRD A-4) — a bearer token in the body instead of
 * a cookie, refreshed within the window, revoked on sign-out; Google through an ID token checked
 * against a local stand-in for Google's tokeninfo endpoint.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const CSRF = 'C'.repeat(43);
const run = Date.now();
let ipSeq = 0;
/** Every call gets its own address: the per-IP login budget must never be what a test trips over. */
const freshIp = () => `10.95.${Math.floor(run / 1000) % 250}.${(run + ipSeq++) % 250}`;
const email = `app-${run}@example.test`;
const password = 'a perfectly fine password';
const CLIENT_ID = `web-${run}.apps.googleusercontent.com`;
const ANDROID_ID = `android-${run}.apps.googleusercontent.com`;

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; details?: { reason?: string } };
}
const json = (r: Response) => r.json() as Promise<Envelope>;

/** A sign-in call the way an app makes it: CSRF pair from /auth/csrf-token plus our Origin. */
const signIn = (path: string, body: unknown) =>
  app.handle(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `crk_csrf=${CSRF}`,
        'x-csrf-token': CSRF,
        'x-forwarded-for': freshIp(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
/** A bearer call: no cookie, no CSRF pair, no Origin — like a native HTTP client. */
const bearer = (path: string, token: string, method = 'GET') =>
  app.handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': freshIp() },
    }),
  );

let tokeninfo: Record<string, unknown> | null = null;
let fake: ReturnType<typeof Bun.serve> | null = null;

describe.skipIf(!enabled)('app sign-in tokens (A-4)', () => {
  let db: Db;
  let token = '';
  const set = (entries: Record<string, unknown>) =>
    settings.save(
      null,
      Object.entries(entries).map(([key, value]) => ({ key, value })),
    );
  const expireBy = async (ms: number) => {
    const [row] = await db
      .select({ id: schema.apiTokens.id })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.name, `App: it-${run}`))
      .limit(1);
    await db
      .update(schema.apiTokens)
      .set({ expires_at: new Date(Date.now() - ms) })
      .where(eq(schema.apiTokens.id, row?.id as string));
  };

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    fake = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (
          u.pathname === '/tokeninfo' &&
          u.searchParams.get('id_token') === 'good-id-token-xxxxxxxx'
        )
          return tokeninfo ? Response.json(tokeninfo) : new Response('bad', { status: 400 });
        return Response.json({ error: 'invalid_token' }, { status: 400 });
      },
    });
    process.env.GOOGLE_OAUTH_TOKENINFO_URL = `http://127.0.0.1:${fake.port}/tokeninfo`;
    process.env.SIGNUP_ENABLED = 'true';
    resetEnvCache();
    await set({
      'security.google_enabled': false,
      'security.google_client_id': '',
      'security.google_app_client_ids': '',
      'security.google_auto_create': false,
      'security.app_token_minutes': 60,
      'security.app_token_refresh_minutes': 2160,
    });
    const reg = await signIn('/v1/auth/register', { email, password, name: 'App user' });
    expect(reg.status).toBe(201);
  });

  afterAll(async () => {
    if (!enabled) return;
    await set({
      'security.google_enabled': false,
      'security.google_client_id': '',
      'security.google_app_client_ids': '',
      'security.google_auto_create': false,
    });
    fake?.stop(true);
  });

  test('password sign-in answers a bearer token and sets no session cookie', async () => {
    const res = await signIn('/v1/auth/token', { email, password, device: `it-${run}` });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('crk_session='))).toBe(false);
    const data = (await json(res)).data as Record<string, unknown>;
    expect(data.tokenType).toBe('Bearer');
    token = String(data.accessToken);
    expect(token.length).toBeGreaterThan(20);
    const expires = Date.parse(String(data.expiresAt));
    const refreshUntil = Date.parse(String(data.refreshExpiresAt));
    expect(expires - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(expires - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(refreshUntil - expires).toBe(2160 * 60_000);
    expect((data.user as Record<string, unknown>).email).toBe(email);
  });

  test('sign-in without the CSRF pair is refused like any other core route', async () => {
    const res = await app.handle(
      new Request(`${ORIGIN}/v1/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).error?.code).toBe('csrf_failed');
  });

  test('wrong password → 401 invalid_credentials', async () => {
    const res = await signIn('/v1/auth/token', { email, password: 'not the right one at all' });
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe('invalid_credentials');
  });

  test('the token opens the API without cookie or CSRF', async () => {
    const res = await bearer('/v1/auth/me', token);
    expect(res.status).toBe(200);
  });

  test('refresh of a live token keeps the secret and moves the expiry', async () => {
    await expireBy(-30 * 60_000); // 30 minutes left
    const res = await bearer('/v1/auth/token/refresh', token, 'POST');
    expect(res.status).toBe(200);
    const data = (await json(res)).data as Record<string, unknown>;
    expect(data.accessToken).toBe(token);
    expect(Date.parse(String(data.expiresAt)) - Date.now()).toBeGreaterThan(55 * 60_000);
  });

  test('an expired token is refused by the API but refreshed within the window', async () => {
    await expireBy(10 * 60_000);
    expect((await bearer('/v1/auth/me', token)).status).toBe(401);
    const res = await bearer('/v1/auth/token/refresh', token, 'POST');
    expect(res.status).toBe(200);
    expect((await bearer('/v1/auth/me', token)).status).toBe(200);
  });

  test('past the refresh window → 401 token_expired', async () => {
    await expireBy(2161 * 60_000);
    const res = await bearer('/v1/auth/token/refresh', token, 'POST');
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error?.code).toBe('token_expired');
    expect(body.error?.details?.reason).toBe('refresh_expired');
  });

  test('a user-minted API token can never be refreshed', async () => {
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    const minted = await createApiToken(db, {
      userId: user?.id as string,
      clientId: null,
      name: `api-${run}`,
      scopes: null,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await bearer('/v1/auth/token/refresh', minted.token, 'POST');
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe('token_invalid');
  });

  test('sign-out revokes the token for good', async () => {
    const signed = await signIn('/v1/auth/token', { email, password });
    const fresh = String(((await json(signed)).data as Record<string, unknown>).accessToken);
    const out = await bearer('/v1/auth/token', fresh, 'DELETE');
    expect(out.status).toBe(200);
    expect((await bearer('/v1/auth/me', fresh)).status).toBe(401);
    const res = await bearer('/v1/auth/token/refresh', fresh, 'POST');
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe('token_invalid');
  });

  test('Google: off by default → sso_disabled', async () => {
    const res = await signIn('/v1/auth/token/google', { idToken: 'good-id-token-xxxxxxxx' });
    expect(res.status).toBe(403);
    expect((await json(res)).error?.code).toBe('sso_disabled');
  });

  test('Google: an ID token for an app client id signs a registered user in', async () => {
    await set({
      'security.google_enabled': true,
      'security.google_client_id': CLIENT_ID,
      'security.google_app_client_ids': ANDROID_ID,
    });
    tokeninfo = {
      iss: 'https://accounts.google.com',
      aud: ANDROID_ID,
      sub: `g-${run}`,
      email,
      email_verified: 'true',
      name: 'App user',
      exp: String(Math.floor(Date.now() / 1000) + 600),
    };
    const res = await signIn('/v1/auth/token/google', { idToken: 'good-id-token-xxxxxxxx' });
    expect(res.status).toBe(200);
    const data = (await json(res)).data as Record<string, unknown>;
    expect(data.tokenType).toBe('Bearer');
    expect((await bearer('/v1/auth/me', String(data.accessToken))).status).toBe(200);
  });

  test('Google: a token for someone else’s client id is refused', async () => {
    tokeninfo = { ...(tokeninfo ?? {}), aud: 'someone-else.apps.googleusercontent.com' };
    const res = await signIn('/v1/auth/token/google', { idToken: 'good-id-token-xxxxxxxx' });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error?.code).toBe('sso_failed');
    expect(body.error?.details?.reason).toBe('id_token');
  });

  test('Google: an unknown e-mail is refused while auto-create is off', async () => {
    tokeninfo = {
      iss: 'accounts.google.com',
      aud: CLIENT_ID,
      sub: `g2-${run}`,
      email: `nobody-${run}@example.test`,
      email_verified: true,
      exp: String(Math.floor(Date.now() / 1000) + 600),
    };
    const res = await signIn('/v1/auth/token/google', { idToken: 'good-id-token-xxxxxxxx' });
    expect(res.status).toBe(403);
    expect((await json(res)).error?.details?.reason).toBe('not_registered');
  });
});

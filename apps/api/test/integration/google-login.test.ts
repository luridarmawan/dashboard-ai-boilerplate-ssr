import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { pkceChallenge } from '@core/auth';
import { resetEnvCache } from '@core/config';
import { type Db, eq, STATUS, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import { settings } from '../../src/services.ts';

/**
 * Integration (INTEGRATION=1): Sign in with Google (PRD A-8) against a local stand-in for Google's
 * token and userinfo endpoints. Off by default; `start` hands out state + PKCE; the callback links
 * by `sub`, falls back to a verified e-mail, creates an account only when the flag is on, refuses
 * unverified e-mails, foreign domains, inactive users and failed exchanges.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
let ipSeq = 0;
/** Every login gets its own address: the per-IP budget must never be what a test trips over. */
const freshIp = () => `10.94.${Math.floor(run / 1000) % 250}.${(run + ipSeq++) % 250}`;
const REDIRECT = `${ORIGIN}/auth/google/callback`;
const VERIFIER = 'v'.repeat(43);

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message?: string };
}
const call = (path: string, init: RequestInit = {}, ip = freshIp()) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', `dab_csrf=${TOKEN}`);
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', ip);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const googleLogin = (code: string) =>
  call('/v1/auth/google-login', {
    method: 'POST',
    body: JSON.stringify({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT }),
  });

/** What the fake Google answers at /userinfo; tests mutate it between calls. */
let profile: Record<string, unknown> = {};
/** The last token exchange the fake Google saw. */
let lastExchange: Record<string, string> | null = null;
let fake: ReturnType<typeof Bun.serve> | null = null;

describe.skipIf(!enabled)('Sign in with Google (A-8)', () => {
  let db: Db;
  const set = (entries: Record<string, unknown>) =>
    settings.save(
      null,
      Object.entries(entries).map(([key, value]) => ({ key, value })),
    );

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    fake = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === '/token' && req.method === 'POST') {
          const form = new URLSearchParams(await req.text());
          lastExchange = Object.fromEntries(form.entries());
          if (form.get('code') === 'bad-code')
            return Response.json({ error: 'invalid_grant' }, { status: 400 });
          return Response.json({ access_token: `at-${form.get('code')}`, token_type: 'Bearer' });
        }
        if (u.pathname === '/userinfo') {
          if (!req.headers.get('authorization')?.startsWith('Bearer at-'))
            return new Response('nope', { status: 401 });
          return Response.json(profile);
        }
        return new Response('not found', { status: 404 });
      },
    });
    process.env.GOOGLE_OAUTH_TOKEN_URL = `http://127.0.0.1:${fake.port}/token`;
    process.env.GOOGLE_OAUTH_USERINFO_URL = `http://127.0.0.1:${fake.port}/userinfo`;
    process.env.SIGNUP_ENABLED = 'true';
    resetEnvCache();
    await set({
      'security.google_enabled': false,
      'security.google_client_id': '',
      'security.google_auto_create': false,
      'security.google_allowed_domains': '',
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    await set({
      'security.google_enabled': false,
      'security.google_auto_create': false,
      'security.google_allowed_domains': '',
    });
    fake?.stop(true);
  });

  test('off by default: start and login answer sso_disabled', async () => {
    const start = await call(`/v1/auth/google/start?redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(start.status).toBe(403);
    expect((await json(start)).error?.code).toBe('sso_disabled');
    const login = await googleLogin('any');
    expect(login.status).toBe(403);
    expect((await json(login)).error?.code).toBe('sso_disabled');
  });

  test('start: authorization URL carries client id, redirect, state and an S256 challenge', async () => {
    await set({
      'security.google_enabled': true,
      'security.google_client_id': `cid-${run}.apps.googleusercontent.com`,
      'security.google_client_secret': 'shh-secret',
    });
    const r = await call(`/v1/auth/google/start?redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(r.status).toBe(200);
    const body = await json(r);
    const data = body.data as { url: string; state: string; codeVerifier: string };
    const u = new URL(data.url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(`cid-${run}.apps.googleusercontent.com`);
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(u.searchParams.get('state')).toBe(data.state);
    expect(data.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('code_challenge')).toBe(pkceChallenge(data.codeVerifier));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('start: a redirect_uri on a foreign origin is refused', async () => {
    const r = await call(
      `/v1/auth/google/start?redirect_uri=${encodeURIComponent('https://evil.test/auth/google/callback')}`,
    );
    expect(r.status).toBe(422);
    expect((await json(r)).error?.code).toBe('validation_failed');
  });

  test('unknown account with auto-create OFF is refused; nothing is created', async () => {
    profile = {
      sub: `sub-new-${run}`,
      email: `google-new-${run}@example.test`,
      email_verified: true,
      name: 'New Person',
    };
    const r = await googleLogin('code-1');
    expect(r.status).toBe(403);
    expect((await json(r)).error?.code).toBe('sso_not_allowed');
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, `google-new-${run}@example.test`));
    expect(rows.length).toBe(0);
  });

  test('auto-create ON: first login creates a verified user, links the sub, opens a session', async () => {
    await set({ 'security.google_auto_create': true });
    profile = {
      sub: `sub-new-${run}`,
      email: `Google-New-${run}@example.test`,
      email_verified: true,
      name: 'New Person',
      picture: 'https://lh3.googleusercontent.com/a/new',
    };
    const r = await googleLogin('code-2');
    expect(r.status).toBe(200);
    const body = await json(r);
    const user = (
      body.data as {
        user: {
          id: string;
          email: string;
          name: string;
          emailVerifiedAt: string | null;
          avatarUrl: string | null;
        };
      }
    ).user;
    expect(user.email).toBe(`google-new-${run}@example.test`);
    expect(user.name).toBe('New Person');
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.avatarUrl).toBe('https://lh3.googleusercontent.com/a/new');
    // PKCE verifier and redirect URI reached the token endpoint untouched.
    expect(lastExchange?.code_verifier).toBe(VERIFIER);
    expect(lastExchange?.redirect_uri).toBe(REDIRECT);
    expect(lastExchange?.grant_type).toBe('authorization_code');
    expect(lastExchange?.client_secret).toBe('shh-secret');
    const cookie = sessionCookie(r);
    expect(cookie).toMatch(/^dab_session=/);
    const me = await app.handle(new Request(`${ORIGIN}/v1/auth/me`, { headers: { cookie } }));
    expect(me.status).toBe(200);
    const [link] = await db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.provider_user_id, `sub-new-${run}`));
    expect(link?.user_id).toBe(user.id);
    expect(link?.email).toBe(`google-new-${run}@example.test`);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row?.password_hash).toBeNull();
  });

  test('the link is by sub: a changed Google e-mail still lands on the same user', async () => {
    profile = {
      sub: `sub-new-${run}`,
      email: `renamed-${run}@example.test`,
      email_verified: true,
      name: 'Renamed',
    };
    const r = await googleLogin('code-3');
    expect(r.status).toBe(200);
    const user = ((await json(r)).data as { user: { id: string; email: string } }).user;
    expect(user.email).toBe(`google-new-${run}@example.test`);
    const [link] = await db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.provider_user_id, `sub-new-${run}`));
    expect(link?.user_id).toBe(user.id);
    expect(link?.email).toBe(`renamed-${run}@example.test`);
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, `renamed-${run}@example.test`));
    expect(users.length).toBe(0);
  });

  test('an existing password account with the same verified e-mail is linked, not duplicated', async () => {
    const email = `google-existing-${run}@example.test`;
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'a perfectly fine password', name: 'Existing' }),
    });
    expect(reg.status).toBe(201);
    const existingId = ((await json(reg)).data as { user: { id: string } }).user.id;
    // Auto-create off: linking to an existing account must not need the flag.
    await set({ 'security.google_auto_create': false });
    profile = {
      sub: `sub-existing-${run}`,
      email,
      email_verified: true,
      name: 'Existing (Google)',
    };
    const r = await googleLogin('code-4');
    expect(r.status).toBe(200);
    const user = (
      (await json(r)).data as { user: { id: string; name: string; emailVerifiedAt: string | null } }
    ).user;
    expect(user.id).toBe(existingId);
    expect(user.name).toBe('Existing');
    // Google vouched for the address: the unverified local account is now verified (A-6).
    expect(user.emailVerifiedAt).not.toBeNull();
    const [link] = await db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.provider_user_id, `sub-existing-${run}`));
    expect(link?.user_id).toBe(existingId);
  });

  test('an unverified Google e-mail is refused', async () => {
    profile = {
      sub: `sub-unverified-${run}`,
      email: `unverified-${run}@example.test`,
      email_verified: false,
    };
    const r = await googleLogin('code-5');
    expect(r.status).toBe(401);
    expect((await json(r)).error?.code).toBe('sso_failed');
  });

  test('a failed code exchange is one clean failure', async () => {
    const r = await googleLogin('bad-code');
    expect(r.status).toBe(401);
    expect((await json(r)).error?.code).toBe('sso_failed');
  });

  test('allowed domains: foreign domain refused even for a linked account, matching domain admitted', async () => {
    await set({
      'security.google_allowed_domains': 'corp.test, other.test',
      'security.google_auto_create': true,
    });
    profile = {
      sub: `sub-new-${run}`,
      email: `google-new-${run}@example.test`,
      email_verified: true,
    };
    const refused = await googleLogin('code-6');
    expect(refused.status).toBe(403);
    expect((await json(refused)).error?.code).toBe('sso_not_allowed');
    profile = {
      sub: `sub-corp-${run}`,
      email: `person-${run}@corp.test`,
      email_verified: true,
      name: 'Corp',
    };
    const admitted = await googleLogin('code-7');
    expect(admitted.status).toBe(200);
    await set({ 'security.google_allowed_domains': '' });
  });

  test('a deactivated user cannot get in through Google', async () => {
    const [link] = await db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.provider_user_id, `sub-corp-${run}`));
    expect(link).toBeDefined();
    await db
      .update(schema.users)
      .set({ status_id: STATUS.INACTIVE })
      .where(eq(schema.users.id, (link as NonNullable<typeof link>).user_id));
    profile = { sub: `sub-corp-${run}`, email: `person-${run}@corp.test`, email_verified: true };
    const r = await googleLogin('code-8');
    expect(r.status).toBe(401);
    expect((await json(r)).error?.code).toBe('invalid_credentials');
  });
});

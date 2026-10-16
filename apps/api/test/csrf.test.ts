import { describe, expect, test } from 'bun:test';
import { resetEnvCache } from '@core/config';
import { Elysia } from 'elysia';
import { app } from '../src/app.ts';
import { authContext } from '../src/plugins/auth.ts';
import { allowedOrigins, checkCsrf } from '../src/plugins/csrf.ts';
import {
  compileCsrfExempt,
  csrfExemptRoutes,
  isCsrfExempt,
  matchCsrfExempt,
} from '../src/plugins/csrf-exempt.ts';

/** M1 gate #2 (PRD §8 #10): a cross-origin state-changing request is rejected. */
const TOKEN = 'A'.repeat(43);
const base = {
  method: 'POST',
  origin: 'https://app.example.com',
  referer: null,
  allowedOrigins: ['https://app.example.com', 'https://apps.other.id'],
  hasBearer: false,
  cookieToken: TOKEN,
  headerToken: TOKEN,
};

describe('checkCsrf — pure decision (A-10)', () => {
  test('same origin + matching double-submit token passes', () => {
    expect(checkCsrf(base)).toEqual({ ok: true });
  });
  test('any origin in the allow-list passes (one installation, several domains)', () => {
    expect(checkCsrf({ ...base, origin: 'https://apps.other.id' })).toEqual({ ok: true });
    expect(checkCsrf({ ...base, origin: 'HTTPS://Apps.Other.ID' })).toEqual({ ok: true });
  });
  test('cross-origin is rejected even with a valid token', () => {
    expect(checkCsrf({ ...base, origin: 'https://evil.example' })).toEqual({
      ok: false,
      reason: 'origin_mismatch',
    });
  });
  test('no Origin and no Referer is rejected; Referer alone is accepted', () => {
    expect(checkCsrf({ ...base, origin: null })).toEqual({ ok: false, reason: 'origin_missing' });
    expect(checkCsrf({ ...base, origin: null, referer: 'https://app.example.com/login' })).toEqual({
      ok: true,
    });
  });
  test('missing or mismatching token is rejected', () => {
    expect(checkCsrf({ ...base, headerToken: null })).toEqual({
      ok: false,
      reason: 'token_missing',
    });
    expect(checkCsrf({ ...base, cookieToken: null })).toEqual({
      ok: false,
      reason: 'token_missing',
    });
    expect(checkCsrf({ ...base, headerToken: 'B'.repeat(43) })).toEqual({
      ok: false,
      reason: 'token_mismatch',
    });
  });
  test('safe methods and Bearer-authenticated requests are exempt — structurally, not per route', () => {
    expect(
      checkCsrf({
        ...base,
        method: 'GET',
        origin: 'https://evil.example',
        cookieToken: null,
        headerToken: null,
      }),
    ).toEqual({ ok: true });
    expect(
      checkCsrf({
        ...base,
        origin: 'https://evil.example',
        hasBearer: true,
        cookieToken: null,
        headerToken: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe('CSRF plugin on the real app — refuses in onRequest, before validation, without a database', () => {
  const post = (path: string, headers: Record<string, string>, body: unknown) =>
    app.handle(
      new Request(`http://api.test${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    );

  test('cross-origin POST /v1/auth/login → 403 csrf_failed', async () => {
    const res = await post(
      '/v1/auth/login',
      { origin: 'https://evil.example', cookie: `crk_csrf=${TOKEN}`, 'x-csrf-token': TOKEN },
      { email: 'attacker@example.com', password: 'x' },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; details?: { reason: string } };
    };
    expect(body.error.code).toBe('csrf_failed');
    expect(body.error.details?.reason).toBe('origin_mismatch');
  });

  test('same-origin POST without the double-submit token → 403', async () => {
    const res = await post(
      '/v1/auth/login',
      { origin: 'http://api.test' },
      { email: 'attacker@example.com', password: 'x' },
    );
    expect(res.status).toBe(403);
  });

  test('GET is never blocked', async () => {
    expect(
      (
        await app.handle(
          new Request('http://api.test/v1/health', { headers: { origin: 'https://evil.example' } }),
        )
      ).status,
    ).toBe(200);
  });
});

describe('ordering: CSRF is decided before body validation', () => {
  test('an invalid body from a cross-origin caller still gets 403, never 422', async () => {
    const res = await app.handle(
      new Request('http://api.test/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: '{"email":"not-an-email"}',
      }),
    );
    expect(res.status).toBe(403);
  });
  test('the same invalid body from the legitimate origin with a token reaches validation (422)', async () => {
    const res = await app.handle(
      new Request('http://api.test/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://api.test',
          cookie: `crk_csrf=${TOKEN}`,
          'x-csrf-token': TOKEN,
        },
        body: '{"email":"not-an-email"}',
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe('allowedOrigins — APP_ORIGIN and the loopback twins', () => {
  const saved = { APP_ORIGIN: process.env.APP_ORIGIN, NODE_ENV: process.env.NODE_ENV };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
  };
  const fromWeb = (host: string) =>
    new Request('http://127.0.0.1:5001/v1/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': host },
    });

  test('development: the origin the request came from joins the configured list', () => {
    process.env.APP_ORIGIN = 'http://localhost:5170';
    process.env.NODE_ENV = 'development';
    resetEnvCache();
    expect(allowedOrigins(fromWeb('127.0.0.1:5170'))).toEqual([
      'http://localhost:5170',
      'http://127.0.0.1:5170',
    ]);
    // Already listed: no duplicate.
    expect(allowedOrigins(fromWeb('localhost:5170'))).toEqual(['http://localhost:5170']);
    restore();
  });

  test('outside development the configured list is the whole truth', () => {
    process.env.APP_ORIGIN = 'http://localhost:5170';
    process.env.NODE_ENV = 'test';
    resetEnvCache();
    expect(allowedOrigins(fromWeb('127.0.0.1:5170'))).toEqual(['http://localhost:5170']);
    restore();
  });

  test('no APP_ORIGIN: the forwarded origin of this request, and only that', () => {
    delete process.env.APP_ORIGIN;
    process.env.NODE_ENV = 'test';
    resetEnvCache();
    expect(allowedOrigins(fromWeb('App.Example.com'))).toEqual(['http://app.example.com']);
    restore();
  });
});

describe('module CSRF exemptions (extension point 17)', () => {
  const list = compileCsrfExempt([
    {
      method: 'POST',
      path: '/v1/m/pay/hooks/:provider',
      module: 'Pay',
      ns: 'pay',
      reason: 'Signed.',
    },
  ]);

  test('method + exact shape match; a param matches one non-empty segment', () => {
    expect(matchCsrfExempt(list, 'post', '/v1/m/pay/hooks/midtrans')?.module).toBe('Pay');
    for (const [method, path] of [
      ['PUT', '/v1/m/pay/hooks/midtrans'],
      ['POST', '/v1/m/pay/hooks'],
      ['POST', '/v1/m/pay/hooks/'],
      ['POST', '/v1/m/pay/hooks/a/b'],
      ['POST', '/v1/m/pay/hooks/midtrans/'],
      ['POST', '/v1/m/pay/hooksx/midtrans'],
      ['POST', '/v1/m/payx/hooks/midtrans'],
    ] as const)
      expect(matchCsrfExempt(list, method, path), `${method} ${path}`).toBeNull();
  });

  test('core declares none: every generated entry lives under /v1/m/<its namespace>/', () => {
    for (const e of csrfExemptRoutes)
      expect(e.path.startsWith(`/v1/m/${e.ns}/`), e.path).toBe(true);
  });

  const inbound = '/v1/m/example/inbound/inquiries';
  const hasExample = csrfExemptRoutes.some((e) => e.path === inbound);

  test.skipIf(!hasExample)(
    'a cross-origin POST to an exempt route is not refused by CSRF',
    async () => {
      const res = await app.handle(
        new Request(`http://api.test${inbound}`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
          body: '{}',
        }),
      );
      // Without a database the handler itself may fail; what matters is who answered.
      const body = (await res.json()) as { error?: { code: string } };
      expect(body.error?.code).not.toBe('csrf_failed');
    },
  );

  test.skipIf(!hasExample)('near misses of an exempt route still get the full check', async () => {
    for (const [method, path] of [
      ['POST', `${inbound}/`],
      ['PUT', inbound],
      ['POST', '/v1/m/example/inquiries'],
    ] as const) {
      const res = await app.handle(
        new Request(`http://api.test${path}`, {
          method,
          headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
          body: '{}',
        }),
      );
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  test.skipIf(!hasExample)(
    'an exempt request is anonymous: the session cookie is never read',
    async () => {
      // A well-formed session token would normally hit the database; on an exempt route the auth
      // plugin returns before that, so this runs without one and still sees `auth === null`.
      const probe = new Elysia()
        .use(authContext)
        .post(inbound, ({ auth }) => ({ anonymous: auth === null }))
        .post('/v1/m/example/other', ({ auth }) => ({ anonymous: auth === null }));
      const req = (path: string) =>
        new Request(`http://api.test${path}`, {
          method: 'POST',
          headers: { cookie: `crk_session=${TOKEN}; crk_impersonate=${TOKEN}` },
        });
      expect(isCsrfExempt(req(inbound))).toBe(true);
      expect(await (await probe.handle(req(inbound))).json()).toEqual({ anonymous: true });
      expect(isCsrfExempt(req('/v1/m/example/other'))).toBe(false);
    },
  );
});

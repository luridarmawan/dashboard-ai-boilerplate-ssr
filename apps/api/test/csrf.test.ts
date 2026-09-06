import { describe, expect, test } from 'bun:test';
import { app } from '../src/app.ts';
import { checkCsrf } from '../src/plugins/csrf.ts';

/** M1 gate #2 (PRD §8 #10): a cross-origin state-changing request is rejected. */
const TOKEN = 'A'.repeat(43);
const base = {
  method: 'POST',
  origin: 'https://app.example.com',
  referer: null,
  expectedOrigin: 'https://app.example.com',
  hasBearer: false,
  cookieToken: TOKEN,
  headerToken: TOKEN,
};

describe('checkCsrf — pure decision (A-10)', () => {
  test('same origin + matching double-submit token passes', () => {
    expect(checkCsrf(base)).toEqual({ ok: true });
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
      { origin: 'https://evil.example', cookie: `dab_csrf=${TOKEN}`, 'x-csrf-token': TOKEN },
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
          cookie: `dab_csrf=${TOKEN}`,
          'x-csrf-token': TOKEN,
        },
        body: '{"email":"not-an-email"}',
      }),
    );
    expect(res.status).toBe(422);
  });
});

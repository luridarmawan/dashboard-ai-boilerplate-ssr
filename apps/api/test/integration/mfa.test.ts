import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';

// `freshCode()` can wait up to one TOTP step (30 s) so a code is never replayed; default is 5 s.
setDefaultTimeout(90_000);

import { runSeed, totpAt, totpStep } from '@core/auth';
import { type Db, eq, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): 2FA TOTP + recovery codes (PRD A-11). Setup issues a secret; enable
 * needs a live code and hands out recovery codes once; from then on the password alone yields an
 * MFA challenge instead of a session; a wrong code counts attempts, a right one (or a recovery
 * code, once) opens the session; codes cannot be replayed; disable needs the password; an admin
 * can reset a locked-out user.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.93.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `mfa-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const userEmail = `mfa-user-${run}@example.test`;
const userPassword = 'a regular member password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: Record<string, unknown> };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const login = (email: string, password: string) =>
  call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

describe.skipIf(!enabled)('2FA TOTP + recovery codes (A-11)', () => {
  let db: Db;
  let admin = '';
  let user = '';
  let userId = '';
  let secret = '';
  let recovery: string[] = [];
  /** Highest TOTP step accepted so far: replay protection refuses it and anything before it. */
  let usedStep = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** A code the server will accept: a step after `usedStep`, still inside the ±1 window. */
  const freshCode = async () => {
    while (totpStep() + 1 <= usedStep) await sleep(1000);
    usedStep = Math.max(totpStep(), usedStep + 1);
    return totpAt(secret, usedStep);
  };

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    await runSeed(db, { adminEmail, adminPassword });
    admin = sessionCookie(await login(adminEmail, adminPassword));
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: userEmail, password: userPassword, name: 'Two Factor' }),
    });
    expect(reg.status).toBe(201);
    user = sessionCookie(reg);
    userId = ((await json(await call('/v1/auth/me', {}, [user]))).data as { user: { id: string } })
      .user.id;
  });

  test('setup issues a base32 secret + otpauth URL; enable rejects a wrong code, accepts a live one and returns 10 recovery codes once', async () => {
    expect((await call('/v1/users/profile/mfa/setup', { method: 'POST' })).status).toBe(401);
    const st = (await json(await call('/v1/users/profile/mfa', {}, [user]))).data as {
      enabled: boolean;
      pending: boolean;
    };
    expect(st).toMatchObject({ enabled: false, pending: false });
    const setup = await call('/v1/users/profile/mfa/setup', { method: 'POST' }, [user]);
    expect(setup.status).toBe(200);
    const s = (await json(setup)).data as { secret: string; otpauthUrl: string; pending: boolean };
    secret = s.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(s.otpauthUrl).toContain(`secret=${secret}`);
    expect(s.otpauthUrl).toContain(encodeURIComponent(userEmail));
    expect(s.pending).toBe(true);
    // Not enforced yet: a plain login still works.
    expect(
      ((await json(await login(userEmail, userPassword))).data as { user?: unknown }).user,
    ).toBeDefined();

    const wrong = await call(
      '/v1/users/profile/mfa/enable',
      { method: 'POST', body: JSON.stringify({ code: '000000' }) },
      [user],
    );
    expect(wrong.status).toBe(422);
    const code = await freshCode();
    const en = await call(
      '/v1/users/profile/mfa/enable',
      { method: 'POST', body: JSON.stringify({ code }) },
      [user],
    );
    expect(en.status).toBe(200);
    const d = (await json(en)).data as { enabled: boolean; recoveryCodes: string[] };
    expect(d.enabled).toBe(true);
    expect(d.recoveryCodes).toHaveLength(10);
    recovery = d.recoveryCodes;
    // Status never carries the codes; the secret is stored, not the codes.
    const after = JSON.stringify(await json(await call('/v1/users/profile/mfa', {}, [user])));
    expect(after).toContain('"recoveryCodesLeft":10');
    for (const c of recovery) expect(after).not.toContain(c);
    const [row] = await db.select().from(schema.userMfa).where(eq(schema.userMfa.user_id, userId));
    expect(JSON.stringify(row?.recovery_codes)).not.toContain(recovery[0] as string);
  });

  test('login now yields a challenge, not a session; wrong codes count; a live TOTP opens the session; replay is refused', async () => {
    const first = await login(userEmail, userPassword);
    expect(first.status).toBe(200);
    expect(sessionCookie(first)).toBe('');
    const body = (await json(first)).data as { mfaRequired?: boolean; challenge?: string };
    expect(body.mfaRequired).toBe(true);
    const challenge = body.challenge as string;
    expect(challenge.length).toBeGreaterThan(20);

    const bad = await call('/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challenge, code: '123456' }),
    });
    expect(bad.status).toBe(401);
    expect((await json(bad)).error?.code).toBe('invalid_credentials');
    expect(
      (
        await call('/v1/auth/login/mfa', {
          method: 'POST',
          body: JSON.stringify({ challenge: 'x'.repeat(43), code: '123456' }),
        })
      ).status,
    ).toBe(401);

    const code = await freshCode();
    const okRes = await call('/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challenge, code }),
    });
    expect(okRes.status).toBe(200);
    const cookie = sessionCookie(okRes);
    expect(cookie).not.toBe('');
    expect((await call('/v1/auth/me', {}, [cookie])).status).toBe(200);
    // The challenge is spent, and the same TOTP step cannot be used again (replay).
    expect(
      (
        await call('/v1/auth/login/mfa', {
          method: 'POST',
          body: JSON.stringify({ challenge, code }),
        })
      ).status,
    ).toBe(401);
    const again = (await json(await login(userEmail, userPassword))).data as { challenge: string };
    const replay = await call('/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challenge: again.challenge, code }),
    });
    expect(replay.status).toBe(401);
  });

  test('a recovery code works exactly once; five wrong codes burn the challenge', async () => {
    const c1 = ((await json(await login(userEmail, userPassword))).data as { challenge: string })
      .challenge;
    const code = recovery[0] as string;
    const ok1 = await call('/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challenge: c1, code: code.toUpperCase() }),
    });
    expect(ok1.status).toBe(200);
    expect(
      (
        (await json(await call('/v1/users/profile/mfa', {}, [sessionCookie(ok1)]))).data as {
          recoveryCodesLeft: number;
        }
      ).recoveryCodesLeft,
    ).toBe(9);
    const c2 = ((await json(await login(userEmail, userPassword))).data as { challenge: string })
      .challenge;
    expect(
      (
        await call('/v1/auth/login/mfa', {
          method: 'POST',
          body: JSON.stringify({ challenge: c2, code }),
        })
      ).status,
    ).toBe(401);
    for (let i = 0; i < 4; i++)
      await call('/v1/auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify({ challenge: c2, code: '999999' }),
      });
    const burnt = await call('/v1/auth/login/mfa', {
      method: 'POST',
      body: JSON.stringify({ challenge: c2, code: await freshCode() }),
    });
    expect(burnt.status).toBe(429);
  });

  test('regenerate recovery codes needs a live code; disable needs the password; admin reset removes 2FA', async () => {
    const c = ((await json(await login(userEmail, userPassword))).data as { challenge: string })
      .challenge;
    const cookie = sessionCookie(
      await call('/v1/auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify({ challenge: c, code: await freshCode() }),
      }),
    );
    expect(cookie).not.toBe('');
    const regen = await call(
      '/v1/users/profile/mfa/recovery-codes',
      { method: 'POST', body: JSON.stringify({ code: await freshCode() }) },
      [cookie],
    );
    expect(regen.status).toBe(200);
    const fresh = ((await json(regen)).data as { recoveryCodes: string[] }).recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recovery[1]);

    const badPw = await call(
      '/v1/users/profile/mfa/disable',
      { method: 'POST', body: JSON.stringify({ password: 'not the password!!' }) },
      [cookie],
    );
    expect(badPw.status).toBe(401);
    const off = await call(
      '/v1/users/profile/mfa/disable',
      { method: 'POST', body: JSON.stringify({ password: userPassword }) },
      [cookie],
    );
    expect(off.status).toBe(200);
    expect(
      ((await json(await login(userEmail, userPassword))).data as { user?: unknown }).user,
    ).toBeDefined();

    // Admin lock-out recovery: set up again, then the admin removes it.
    const s2 = (await json(await call('/v1/users/profile/mfa/setup', { method: 'POST' }, [cookie])))
      .data as { secret: string };
    const enable = await call(
      '/v1/users/profile/mfa/enable',
      { method: 'POST', body: JSON.stringify({ code: await totpAt(s2.secret, totpStep()) }) },
      [cookie],
    );
    expect(enable.status).toBe(200);
    expect(
      ((await json(await login(userEmail, userPassword))).data as { mfaRequired?: boolean })
        .mfaRequired,
    ).toBe(true);
    // Enabling 2FA ended the registration session; the current one is `cookie`. Not an admin → 403.
    expect((await call(`/v1/users/${userId}/mfa`, { method: 'DELETE' }, [cookie])).status).toBe(
      403,
    );
    expect((await call(`/v1/users/${userId}/mfa`, { method: 'DELETE' }, [admin])).status).toBe(200);
    expect(
      ((await json(await login(userEmail, userPassword))).data as { user?: unknown }).user,
    ).toBeDefined();
  });
});

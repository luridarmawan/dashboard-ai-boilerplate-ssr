import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { resetEnvCache } from '@core/config';
import { app } from '../../src/app.ts';
import { clearIpLookupCache } from '../../src/lib/ip-lookup.ts';

/**
 * Integration (INTEGRATION=1): the "?" next to the user list's IP columns — `GET /v1/users/ip-info`
 * answers only for addresses a member of the tenant was seen from, needs `user.read`, and asks
 * the configured service (a local stand-in here) about public addresses only.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
// TEST-NET-3: public as far as isPrivateAddress is concerned, owned by nobody.
const ADMIN_IP = `203.0.113.${run % 250}`;
const USER_IP = `198.51.100.${run % 250}`;
const adminEmail = `ipi-adm-${run}@example.test`;
const adminPassword = 'an admin password for tests';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; details?: unknown };
}
const call = (path: string, ip: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', ip);
  if (init.body) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const login = async (email: string, password: string, ip: string) => {
  const res = await call('/v1/auth/login', ip, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return (
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith('crk_session='))
      ?.split(';')[0] ?? ''
  );
};

describe.skipIf(!enabled)('IP location on the user list', () => {
  let admin = '';
  let plain = '';
  let asked: string[] = [];
  let service: ReturnType<typeof Bun.serve> | null = null;

  beforeAll(async () => {
    if (!enabled) return;
    service = Bun.serve({
      port: 0,
      fetch(req) {
        const ip = new URL(req.url).pathname.slice(1);
        asked.push(ip);
        return Response.json({
          success: true,
          ip,
          city: 'Surabaya',
          region: 'Jawa Timur',
          country: 'Indonesia',
          country_code: 'ID',
          connection: { asn: 7713, isp: 'Telkom' },
        });
      },
    });
    process.env.IP_LOOKUP_URL = `http://127.0.0.1:${service.port}/{ip}`;
    resetEnvCache();
    clearIpLookupCache();
    await runSeed((await import('@core/db')).unsafeAcrossTenants(), { adminEmail, adminPassword });
    admin = await login(adminEmail, adminPassword, ADMIN_IP);
    // A member without any permission: the seeded Regular User group grants nothing.
    const email = `ipi-user-${run}@example.test`;
    const password = 'a password for the plain user';
    const created = await call(
      '/v1/users',
      ADMIN_IP,
      { method: 'POST', body: JSON.stringify({ email, name: 'Plain', password }) },
      [admin],
    );
    expect(created.status).toBe(201);
    plain = await login(email, password, USER_IP);
  });

  afterAll(() => {
    service?.stop(true);
    delete process.env.IP_LOOKUP_URL;
    resetEnvCache();
  });

  test("a member's address is located through the configured service, once", async () => {
    asked = [];
    for (let i = 0; i < 2; i++) {
      const res = await call(`/v1/users/ip-info?ip=${USER_IP}`, ADMIN_IP, {}, [admin]);
      expect(res.status).toBe(200);
      expect((await json(res)).data).toEqual({
        ip: USER_IP,
        private: false,
        city: 'Surabaya',
        region: 'Jawa Timur',
        country: 'Indonesia',
        countryCode: 'ID',
        isp: 'Telkom',
        asn: 'AS7713',
      });
    }
    expect(asked).toEqual([USER_IP]);
  });

  test('an address nobody in the tenant was seen from is not looked up', async () => {
    asked = [];
    const res = await call('/v1/users/ip-info?ip=192.0.2.77', ADMIN_IP, {}, [admin]);
    expect(res.status).toBe(404);
    const bad = await call('/v1/users/ip-info?ip=example.com', ADMIN_IP, {}, [admin]);
    expect(bad.status).toBe(404);
    expect(asked).toEqual([]);
  });

  test('needs user.read', async () => {
    const res = await call(`/v1/users/ip-info?ip=${USER_IP}`, USER_IP, {}, [plain]);
    expect(res.status).toBe(403);
  });

  test('switched off: 503 with the reason, and nobody is asked', async () => {
    process.env.IP_LOOKUP_URL = 'off';
    resetEnvCache();
    clearIpLookupCache();
    asked = [];
    try {
      const res = await call(`/v1/users/ip-info?ip=${USER_IP}`, ADMIN_IP, {}, [admin]);
      expect(res.status).toBe(503);
      expect((await json(res)).error).toMatchObject({
        code: 'service_unavailable',
        details: { reason: 'disabled' },
      });
      expect(asked).toEqual([]);
    } finally {
      process.env.IP_LOOKUP_URL = `http://127.0.0.1:${service?.port}/{ip}`;
      resetEnvCache();
    }
  });
});

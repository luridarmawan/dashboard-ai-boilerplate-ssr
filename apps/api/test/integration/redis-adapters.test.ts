import { describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1 and SESSION_DRIVER=redis / RATELIMIT_DRIVER=redis — the CI gate M7
 * job, or locally with Valkey): the Redis accelerators actually touch Redis. Login puts a session
 * copy and a rate-limit window in Redis; /me is served while the database copy is the truth;
 * logout evicts the cached session so the cookie dies immediately, not after the cache TTL.
 */
const enabled =
  process.env.INTEGRATION === '1' &&
  process.env.SESSION_DRIVER === 'redis' &&
  process.env.RATELIMIT_DRIVER === 'redis' &&
  !!process.env.REDIS_URL;
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.87.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `redis-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';

describe.skipIf(!enabled)('Redis adapters for sessions and rate limits (M7 #4)', () => {
  test('login → session copy + rate-limit window in Redis; logout evicts the copy at once', async () => {
    const redis = new (
      Bun as unknown as {
        RedisClient: new (
          url: string,
        ) => {
          send(c: string, a: string[]): Promise<unknown>;
          close(): void;
        };
      }
    ).RedisClient(process.env.REDIS_URL as string);
    const keys = async (pattern: string) => (await redis.send('KEYS', [pattern])) as string[];

    await runSeed(unsafeAcrossTenants(), { adminEmail, adminPassword });
    const before = (await keys('dab:sess:*')).length;
    const login = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(login.status).toBe(200);
    const cookie = sessionCookie(login);
    // The rate-limit window for this IP lives in Redis (INCR), not only in the table.
    expect((await keys(`dab:rl:login:ip:${RUN_IP}:*`)).length).toBeGreaterThan(0);

    // First authenticated request resolves from the database and caches; the second is a cache hit.
    expect((await call('/v1/auth/me', {}, [cookie])).status).toBe(200);
    const cached = await keys('dab:sess:*');
    expect(cached.length).toBeGreaterThan(before);
    expect((await call('/v1/auth/me', {}, [cookie])).status).toBe(200);

    // Logout evicts: the cookie must be dead immediately, not after the 60 s cache TTL.
    expect((await call('/v1/auth/logout', { method: 'POST' }, [cookie])).status).toBe(200);
    expect((await call('/v1/auth/me', {}, [cookie])).status).toBe(401);
    redis.close();
  });
});

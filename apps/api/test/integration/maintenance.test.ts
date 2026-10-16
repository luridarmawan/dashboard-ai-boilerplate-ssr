import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { resetEnvCache } from '@core/config';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): maintenance mode (E-10) against a real database — the Settings
 * switch shuts out signed-in users outside the Administrator group (and refuses their login),
 * leaves anonymous public reads alone, lets the group membership lift the block on the next
 * request, and the `.env` switch closes anonymous traffic too.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'M'.repeat(43);
const run = Date.now();
const RUN_IP = `10.79.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `mnt-admin-${run}@example.test`;
const adminPassword = 'a maintenance admin password';
const memberEmail = `mnt-member-${run}@example.test`;
const memberPassword = 'a maintenance member password';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; details?: unknown };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const login = (email: string, password: string) =>
  call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const setMaintenance = (on: boolean, cookies: string[]) =>
  call(
    '/v1/configuration',
    {
      method: 'PUT',
      body: JSON.stringify({ scope: 'global', values: { 'app.maintenance_mode': on } }),
    },
    cookies,
  );

describe.skipIf(!enabled)('maintenance mode (E-10)', () => {
  let db: Db;
  let admin = '';
  let member = '';
  let memberId = '';
  let tenantId = '';
  let adminGroupId = '';
  const previousEnv = process.env.MAINTENANCE_MODE;

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    adminGroupId = s.adminGroupId;
    const a = await login(adminEmail, adminPassword);
    expect(a.status).toBe(200);
    admin = sessionCookie(a);
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: memberEmail, password: memberPassword, name: 'Member' }),
    });
    expect(reg.status).toBe(201);
    member = sessionCookie(reg);
    const me = await json(await call('/v1/auth/me', {}, [member]));
    memberId = (me.data as { user: { id: string } }).user.id;
    // Clean slate: another run may have left the switch on.
    expect((await setMaintenance(false, [admin])).status).toBe(200);
  });

  afterAll(async () => {
    if (!enabled) return;
    if (previousEnv === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previousEnv;
    resetEnvCache();
    await setMaintenance(false, [admin]);
  });

  test('off: /me reports it and nobody is blocked', async () => {
    const me = await json(await call('/v1/auth/me', {}, [member]));
    expect(me.data?.maintenance).toEqual({ active: false, source: null, exempt: true });
    expect((await call('/v1/notifications', {}, [member])).status).toBe(200);
  });

  test('Settings switch: a signed-in regular user is shut out on the next request, the superadmin is not', async () => {
    expect((await setMaintenance(true, [admin])).status).toBe(200);

    // The reads the web shell needs keep answering, and say what is going on.
    const me = await json(await call('/v1/auth/me', {}, [member]));
    expect(me.data?.maintenance).toEqual({ active: true, source: 'config', exempt: false });
    expect((await call('/v1/auth/permissions', {}, [member])).status).toBe(200);

    const blocked = await call('/v1/notifications', {}, [member]);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('retry-after')).toBe('300');
    const body = await json(blocked);
    expect(body.error?.code).toBe('maintenance');
    expect(body.error?.details).toEqual({ source: 'config' });

    const adminMe = await json(await call('/v1/auth/me', {}, [admin]));
    expect(adminMe.data?.maintenance).toEqual({ active: true, source: 'config', exempt: true });
    expect((await call('/v1/users', {}, [admin])).status).toBe(200);
  });

  test('Settings switch: anonymous public reads stay up — modules decide what to switch off', async () => {
    expect((await call('/v1/configuration/public')).status).toBe(200);
    const products = await call('/v1/m/example/products');
    expect(products.status).toBe(200);
    // Protected routes answer as usual to anonymous callers: 401, not 503.
    expect((await call('/v1/users')).status).toBe(401);
  });

  test('login of a regular user is refused with 503 and audited; the superadmin signs in', async () => {
    const refused = await login(memberEmail, memberPassword);
    expect(refused.status).toBe(503);
    expect((await json(refused)).error?.code).toBe('maintenance');
    expect(sessionCookie(refused)).toBe('');
    const rows = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actor_id, memberId));
    expect(rows.map((r) => r.action)).toContain('auth.login_refused_maintenance');

    const ok = await login(adminEmail, adminPassword);
    expect(ok.status).toBe(200);
  });

  test('membership of the Administrator group lifts the block on the very next request', async () => {
    await db.insert(schema.groupUserMaps).values({
      id: newId(),
      client_id: tenantId,
      group_id: adminGroupId,
      user_id: memberId,
    });
    expect((await call('/v1/notifications', {}, [member])).status).toBe(200);
    const me = await json(await call('/v1/auth/me', {}, [member]));
    expect(me.data?.maintenance).toEqual({ active: true, source: 'config', exempt: true });
    const signin = await login(memberEmail, memberPassword);
    expect(signin.status).toBe(200);
  });

  test('.env switch: anonymous traffic is refused too, except what the sign-in page needs', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    resetEnvCache();
    try {
      const products = await call('/v1/m/example/products');
      expect(products.status).toBe(503);
      expect((await json(products)).error?.details).toEqual({ source: 'env' });
      expect((await call('/v1/configuration/public')).status).toBe(200);
      expect((await call('/v1/module/enabled')).status).toBe(200);
      expect((await call('/v1/health')).status).toBe(200);
      // The .env switch wins over the Settings value in what the API reports.
      const me = await json(await call('/v1/auth/me', {}, [admin]));
      expect(me.data?.maintenance).toEqual({ active: true, source: 'env', exempt: true });
    } finally {
      if (previousEnv === undefined) delete process.env.MAINTENANCE_MODE;
      else process.env.MAINTENANCE_MODE = previousEnv;
      resetEnvCache();
    }
  });

  test('off again: the regular path is back', async () => {
    expect((await setMaintenance(false, [admin])).status).toBe(200);
    const me = await json(await call('/v1/auth/me', {}, [member]));
    expect(me.data?.maintenance).toEqual({ active: false, source: null, exempt: true });
  });
});

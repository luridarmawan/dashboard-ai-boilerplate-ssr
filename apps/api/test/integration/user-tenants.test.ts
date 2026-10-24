import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): a user's access to several tenants, managed from their detail
 * page (PRD B-2, B-4, D-1) — `GET/POST /v1/users/:id/tenants`, `DELETE /v1/users/:id/tenants/:clientId`.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'T'.repeat(43);
const run = Date.now();
const RUN_IP = `10.78.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `adm-ut-${run}@example.test`;
const adminPassword = 'an admin password for tests';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message?: string; details?: unknown };
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
const post = (path: string, body: unknown, cookies: string[]) =>
  call(path, { method: 'POST', body: JSON.stringify(body) }, cookies);
const del = (path: string, cookies: string[]) => call(path, { method: 'DELETE' }, cookies);
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const login = async (email: string, password: string) => {
  const res = await post('/v1/auth/login', { email, password }, []);
  expect(res.status).toBe(200);
  return sessionCookie(res);
};

interface Access {
  memberships: { id: string; code: string; isDefault: boolean; canRemove: boolean }[];
  hidden: number;
  candidates: { id: string }[];
}
const access = async (userId: string, cookies: string[]) =>
  (await json(await call(`/v1/users/${userId}/tenants`, {}, cookies))).data as unknown as Access;

describe.skipIf(!enabled)('tenant access per user (B-2, B-4, D-1)', () => {
  let admin = '';
  let home = '';
  let acme = '';
  let bobId = '';
  let bob = '';
  const bobEmail = `bob-ut-${run}@example.test`;
  const bobPassword = 'a password for bob 123';

  beforeAll(async () => {
    if (!enabled) return;
    const s = await runSeed((await import('@core/db')).unsafeAcrossTenants(), {
      adminEmail,
      adminPassword,
    });
    home = s.tenantId;
    admin = await login(adminEmail, adminPassword);
    const t = await post('/v1/clients', { code: `acme-ut-${run}`.slice(0, 32), name: 'Acme' }, [
      admin,
    ]);
    expect(t.status).toBe(201);
    acme = ((await json(t)).data as { id: string }).id;
    const u = await post('/v1/users', { email: bobEmail, name: 'Bob', password: bobPassword }, [
      admin,
    ]);
    expect(u.status).toBe(201);
    bobId = ((await json(u)).data as { id: string }).id;
    bob = await login(bobEmail, bobPassword);
  });

  test('list: memberships the caller may see, and the tenants they could add', async () => {
    const a = await access(bobId, [admin]);
    expect(a.memberships.map((m) => m.id)).toEqual([home]);
    expect(a.memberships[0]?.canRemove).toBe(true);
    expect(a.hidden).toBe(0);
    expect(a.candidates.some((c) => c.id === acme)).toBe(true);
    // The admin cannot remove themself; a plain user (no `user.read`) cannot look at all.
    const adminId = (
      (await json(await call('/v1/users/profile/me', {}, [admin]))).data as {
        user: { id: string };
      }
    ).user.id;
    const own = await access(adminId, [admin]);
    expect(own.memberships.every((m) => !m.canRemove)).toBe(true);
    expect((await call(`/v1/users/${bobId}/tenants`, {}, [bob])).status).toBe(403);
  });

  test('add: joins the tenant in its Regular User group; duplicate → 409; unknown tenant → 404', async () => {
    const res = await post(`/v1/users/${bobId}/tenants`, { clientId: acme }, [admin]);
    expect(res.status).toBe(201);
    const d = (await json(res)).data as { tenant: { id: string }; group: { code: string } | null };
    expect(d.tenant.id).toBe(acme);
    expect(d.group?.code).toBe('user');
    const a = await access(bobId, [admin]);
    expect(a.memberships.map((m) => m.id).sort()).toEqual([acme, home].sort());
    expect(a.memberships.find((m) => m.id === acme)?.isDefault).toBe(false);
    expect(a.candidates.some((c) => c.id === acme)).toBe(false);
    expect((await post(`/v1/users/${bobId}/tenants`, { clientId: acme }, [admin])).status).toBe(
      409,
    );
    expect(
      (
        await post(
          `/v1/users/${bobId}/tenants`,
          { clientId: '00000000-0000-7000-8000-000000000000' },
          [admin],
        )
      ).status,
    ).toBe(404);
    // Bob can now switch there and is a member of its `user` group.
    expect((await post('/v1/auth/switch-tenant', { clientId: acme }, [bob])).status).toBe(200);
    const seen = await json(
      await call(`/v1/users/${bobId}`, { headers: { 'x-client-id': acme } }, [admin]),
    );
    expect((seen.data as { groups: { code: string }[] }).groups.map((g) => g.code)).toEqual([
      'user',
    ]);
  });

  test('revoke: one tenant at a time; the account survives while another remains, then goes', async () => {
    const gone = await del(`/v1/users/${bobId}/tenants/${acme}`, [admin]);
    expect(gone.status).toBe(200);
    expect((await json(gone)).data?.accountDeleted).toBe(false);
    expect((await post('/v1/auth/switch-tenant', { clientId: acme }, [bob])).status).toBe(403);
    expect((await del(`/v1/users/${bobId}/tenants/${acme}`, [admin])).status).toBe(404); // no membership
    const a = await access(bobId, [admin]);
    expect(a.memberships.map((m) => m.id)).toEqual([home]);
    // Revoking the last tenant soft-deletes the account, like removing from the active tenant.
    const last = await del(`/v1/users/${bobId}/tenants/${home}`, [admin]);
    expect(last.status).toBe(200);
    expect((await json(last)).data?.accountDeleted).toBe(true);
    expect((await call(`/v1/users/${bobId}`, {}, [admin])).status).toBe(404);
    expect((await call('/v1/users/profile/me', {}, [bob])).status).toBe(401);
  });
});

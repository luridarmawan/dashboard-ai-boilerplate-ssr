import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): the administration surface end to end through the real app —
 * users, groups, permissions, members, tenants, profile (PRD D-1…D-4, C-3, C-4, C-6).
 * This is M1 gate #1 as an API script: login → manage users → set group permissions → switch tenant.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const adminEmail = `adm-${run}@example.test`;
const adminPassword = 'an admin password for tests';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  meta?: { total: number };
  error?: { code: string; details?: unknown };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const post = (path: string, body: unknown, cookies: string[]) =>
  call(path, { method: 'POST', body: JSON.stringify(body) }, cookies);
const put = (path: string, body: unknown, cookies: string[]) =>
  call(path, { method: 'PUT', body: JSON.stringify(body) }, cookies);
const del = (path: string, cookies: string[]) => call(path, { method: 'DELETE' }, cookies);
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const login = async (email: string, password: string) => {
  const res = await post('/v1/auth/login', { email, password }, []);
  expect(res.status).toBe(200);
  return sessionCookie(res);
};

describe.skipIf(!enabled)('administration (D-1…D-4, C-3, C-4, C-6)', () => {
  let admin = '';
  let defaultTenant = '';
  let editorsId = '';
  let bobId = '';
  let bob = '';
  const bobEmail = `bob-${run}@example.test`;
  const bobPassword = 'a password for bob 123';

  beforeAll(async () => {
    process.env.SIGNUP_ENABLED = 'true';
    const s = await runSeed((await import('@core/db')).unsafeAcrossTenants(), {
      adminEmail,
      adminPassword,
    });
    defaultTenant = s.tenantId;
    admin = await login(adminEmail, adminPassword);
  });

  test('group: create with permissions; unknown permission → 422 naming it (C-4)', async () => {
    const bad = await post(
      '/v1/groups',
      { code: `bad-${run}`, name: 'Bad', permissions: ['user.read', 'nonexistent.fly'] },
      [admin],
    );
    expect(bad.status).toBe(422);
    expect((await json(bad)).error?.details).toEqual({ unknown: ['nonexistent.fly'] });

    const res = await post(
      '/v1/groups',
      { code: `editors-${run}`, name: 'Editors', permissions: ['user.read', 'user.edit'] },
      [admin],
    );
    expect(res.status).toBe(201);
    const g = (await json(res)).data as { id: string; permissionCount: number };
    editorsId = g.id;
    expect(g.permissionCount).toBe(2);
    const dup = await post('/v1/groups', { code: `editors-${run}`, name: 'Again' }, [admin]);
    expect(dup.status).toBe(409);
  });

  test('user: create in tenant with a group; the new user gets exactly those permissions', async () => {
    const res = await post(
      '/v1/users',
      { email: bobEmail, name: 'Bob', password: bobPassword, groupIds: [editorsId] },
      [admin],
    );
    expect(res.status).toBe(201);
    const u = (await json(res)).data as { id: string; created: boolean; groups: unknown[] };
    bobId = u.id;
    expect(u.created).toBe(true);
    expect(u.groups).toHaveLength(1);
    bob = await login(bobEmail, bobPassword);
    const perms = await json(await call('/v1/auth/permissions', {}, [bob]));
    expect(perms.data?.permissions).toEqual(['user.edit', 'user.read']);
    // Adding the same account again to this tenant is a conflict, not a duplicate account.
    expect((await post('/v1/users', { email: bobEmail, name: 'Bob' }, [admin])).status).toBe(409);
  });

  test('enforcement is at the API (C-6): editor can list users, cannot delete or manage groups', async () => {
    const list = await json(await call(`/v1/users?q=bob-${run}&limit=5`, {}, [bob]));
    expect(list.success).toBe(true);
    expect(list.meta?.total).toBe(1);
    expect((await del(`/v1/users/${bobId}`, [bob])).status).toBe(403);
    const denied = await post('/v1/groups', { code: `x-${run}`, name: 'x' }, [bob]);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error?.details).toEqual({ permission: 'group.create' });
    expect((await call('/v1/clients', {}, [bob])).status).toBe(403);
    expect((await call('/v1/clients/scope', {}, [bob])).status).toBe(200); // any session
  });

  test('user edit: deactivation ends the session on the next request; reactivation restores', async () => {
    expect((await put(`/v1/users/${bobId}`, { statusId: 0 }, [admin])).status).toBe(200);
    expect((await call('/v1/auth/me', {}, [bob])).status).toBe(401);
    expect((await put(`/v1/users/${bobId}`, { statusId: 1, name: 'Robert' }, [admin])).status).toBe(
      200,
    );
    bob = await login(bobEmail, bobPassword);
    const me = await json(await call('/v1/auth/me', {}, [bob]));
    expect((me.data as { user: { name: string } }).user.name).toBe('Robert');
    // Only a superadmin may touch the flag; nobody may demote themselves.
    expect((await put(`/v1/users/${bobId}`, { isSuperadmin: true }, [bob])).status).toBe(403);
    const adminMe = await json(await call('/v1/auth/me', {}, [admin]));
    const adminId = (adminMe.data as { user: { id: string } }).user.id;
    expect((await put(`/v1/users/${adminId}`, { isSuperadmin: false }, [admin])).status).toBe(409);
  });

  test('group permissions: replace set is audited-in, takes effect immediately; members add/remove', async () => {
    const rep = await put(`/v1/group-permissions/${editorsId}`, { permissions: ['user.read'] }, [
      admin,
    ]);
    expect(rep.status).toBe(200);
    const perms = await json(await call('/v1/auth/permissions', {}, [bob]));
    expect(perms.data?.permissions).toEqual(['user.read']);
    expect((await put(`/v1/users/${bobId}`, { name: 'x' }, [bob])).status).toBe(403); // lost user.edit

    const add = await post(
      '/v1/group-permissions',
      { groupId: editorsId, permission: 'group.read' },
      [admin],
    );
    expect(add.status).toBe(201);
    const permId = ((await json(add)).data as { id: string }).id;
    expect((await del(`/v1/group-permissions/${permId}`, [admin])).status).toBe(200);

    expect((await del(`/v1/group-members/${editorsId}/${bobId}`, [admin])).status).toBe(200);
    expect((await json(await call('/v1/auth/permissions', {}, [bob]))).data?.permissions).toEqual(
      [],
    );
    expect((await post(`/v1/group-members/${editorsId}`, { userId: bobId }, [admin])).status).toBe(
      201,
    );
    expect((await post(`/v1/group-members/${editorsId}`, { userId: bobId }, [admin])).status).toBe(
      409,
    );
    const detail = await json(await call(`/v1/groups/${editorsId}`, {}, [admin]));
    expect((detail.data as { members: unknown[] }).members.length).toBe(1);
  });

  test('system groups keep their code and cannot be deleted', async () => {
    const list = await json(await call('/v1/groups?limit=50', {}, [admin]));
    const groups = list.data as unknown as { id: string; code: string; isSystem: boolean }[];
    const sys = groups.find((g) => g.code === 'admin');
    expect(sys?.isSystem).toBe(true);
    expect((await del(`/v1/groups/${sys?.id}`, [admin])).status).toBe(409);
    expect((await put(`/v1/groups/${sys?.id}`, { code: 'root' }, [admin])).status).toBe(409);
    expect((await put(`/v1/groups/${sys?.id}`, { name: 'Administrators' }, [admin])).status).toBe(
      200,
    );
  });

  test('tenant: create → creator is admin there; switch; users list is per tenant; delete rules', async () => {
    const res = await post('/v1/clients', { code: `acme-${run}`.slice(0, 32), name: 'Acme' }, [
      admin,
    ]);
    expect(res.status).toBe(201);
    const acme = ((await json(res)).data as { id: string }).id;
    const scope = await json(await call('/v1/clients/scope', {}, [admin]));
    const tenants = (scope.data as { tenants: { id: string }[] }).tenants;
    expect(tenants.some((x) => x.id === acme)).toBe(true);
    expect((await post('/v1/auth/switch-tenant', { clientId: acme }, [admin])).status).toBe(200);
    const users = await json(await call('/v1/users', {}, [admin]));
    expect(users.meta?.total).toBe(1); // only the creator — bob belongs to the default tenant
    expect((await json(await call(`/v1/users/${bobId}`, {}, [admin]))).success).toBe(false); // 404 across tenants
    const groups = await json(await call('/v1/groups', {}, [admin]));
    expect((groups.data as unknown as { code: string }[]).map((g) => g.code).sort()).toEqual([
      'admin',
      'user',
    ]);

    expect((await del(`/v1/clients/${defaultTenant}`, [admin])).status).toBe(409); // B-5
    expect((await del(`/v1/clients/${acme}`, [admin])).status).toBe(200);
    // The session parked on the deleted tenant falls back to "no tenant".
    const perms = await json(await call('/v1/auth/permissions', {}, [admin]));
    expect(perms.data?.clientId).toBeNull();
    expect(
      (await post('/v1/auth/switch-tenant', { clientId: defaultTenant }, [admin])).status,
    ).toBe(200);
  });

  test('profile: edit, change password (wrong current → 401), other sessions revoked (D-4)', async () => {
    const bob2 = await login(bobEmail, bobPassword);
    expect(
      (await put('/v1/users/profile/me', { name: 'Bobby', locale: 'en', theme: 'dark' }, [bob]))
        .status,
    ).toBe(200);
    const wrong = await put(
      '/v1/users/profile/password',
      { currentPassword: 'nope nope nope', newPassword: 'a brand new password 9' },
      [bob],
    );
    expect(wrong.status).toBe(401);
    const ok = await put(
      '/v1/users/profile/password',
      { currentPassword: bobPassword, newPassword: 'a brand new password 9' },
      [bob],
    );
    expect(ok.status).toBe(200);
    expect((await call('/v1/auth/me', {}, [bob])).status).toBe(200); // this session stays
    expect((await call('/v1/auth/me', {}, [bob2])).status).toBe(401); // the other is gone
  });

  test('user delete: soft, self-delete refused; account goes with its last tenant', async () => {
    const adminMe = await json(await call('/v1/auth/me', {}, [admin]));
    const adminId = (adminMe.data as { user: { id: string } }).user.id;
    expect((await del(`/v1/users/${adminId}`, [admin])).status).toBe(409);
    const res = await json(await del(`/v1/users/${bobId}`, [admin]));
    expect(res.data?.accountDeleted).toBe(true);
    expect((await call('/v1/auth/me', {}, [bob])).status).toBe(401);
    expect((await call(`/v1/users/${bobId}`, {}, [admin])).status).toBe(404);
  });
});

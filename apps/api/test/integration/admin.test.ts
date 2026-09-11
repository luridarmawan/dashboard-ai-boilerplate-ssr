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
const RUN_IP = `10.77.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `adm-${run}@example.test`;
const adminPassword = 'an admin password for tests';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  meta?: { total: number };
  error?: { code: string; message?: string; details?: unknown };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  // A per-run client IP: the login rate limit (A-2) is keyed by IP and lives in the shared dev
  // database for 15 minutes, so repeated local runs must not exhaust each other's budget.
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
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
    if (!enabled) return;
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
      {
        email: bobEmail,
        name: 'Bob',
        phone: '+62 812-3456-7890',
        password: bobPassword,
        groupIds: [editorsId],
      },
      [admin],
    );
    expect(res.status).toBe(201);
    const u = (await json(res)).data as {
      id: string;
      created: boolean;
      phone: string | null;
      groups: unknown[];
    };
    bobId = u.id;
    expect(u.created).toBe(true);
    // Phone (D-4) is optional on create; spaces and dashes are stripped before it is stored.
    expect(u.phone).toBe('+6281234567890');
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
    const back = await put(
      `/v1/users/${bobId}`,
      { statusId: 1, name: 'Robert', phone: '0812 999' },
      [admin],
    );
    expect(back.status).toBe(200);
    expect(((await json(back)).data as { phone: string | null }).phone).toBe('0812999');
    // An empty phone clears the column instead of being rejected by the pattern.
    const cleared = await json(await put(`/v1/users/${bobId}`, { phone: null }, [admin]));
    expect((cleared.data as { phone: string | null }).phone).toBe(null);
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

  test('group members come back one page at a time, searchable — the roster no longer scales with the tenant', async () => {
    // Three members, asked for two at a time: enough to prove the page boundary without
    // pretending a test tenant is a big one.
    const ids: string[] = [];
    for (const who of ['Ann', 'Bee', 'Cid']) {
      const r = await post(
        '/v1/users',
        {
          email: `member-${who.toLowerCase()}-${run}@example.test`,
          name: `${who} Member ${run}`,
          password: 'a group member password',
          groupIds: [editorsId],
        },
        [admin],
      );
      expect(r.status).toBe(201);
      ids.push(((await json(r)).data as { id: string }).id);
    }
    type Detail = {
      memberCount: number;
      members: { userId: string; name: string }[];
      memberPage: { page: number; limit: number; total: number; totalPages: number };
    };
    const first = (await json(await call(`/v1/groups/${editorsId}?limit=2`, {}, [admin])))
      .data as Detail;
    expect(first.members.length).toBe(2);
    expect(first.memberPage.total).toBe(4); // Bob is a member from the test above
    expect(first.memberPage.totalPages).toBe(2);
    expect(first.memberCount).toBe(4); // the unfiltered total stays whole
    const second = (await json(await call(`/v1/groups/${editorsId}?limit=2&page=2`, {}, [admin])))
      .data as Detail;
    expect(second.members.length).toBe(2);
    expect(second.members.map((m) => m.userId)).not.toEqual(first.members.map((m) => m.userId));
    const found = (
      await json(await call(`/v1/groups/${editorsId}?q=member-bee-${run}`, {}, [admin]))
    ).data as Detail;
    expect(found.members.map((m) => m.userId)).toEqual([ids[1] as string]);
    expect(found.memberPage.total).toBe(1);
    // The dedicated endpoint pages the same way, in the standard envelope.
    const page1 = await json(await call(`/v1/group-members/${editorsId}?limit=1`, {}, [admin]));
    expect((page1.data as unknown as unknown[]).length).toBe(1);
    expect((page1 as unknown as { meta: { total: number } }).meta.total).toBe(4);
    for (const id of ids) expect((await del(`/v1/users/${id}`, [admin])).status).toBe(200);
  });

  test('a deleted group code can be used again; a deleted TENANT code cannot, and says why', async () => {
    // Group: deleting empties it first, so the buried row is a shell — revive it, same id.
    const code = `revive-${run}`;
    const made = await post('/v1/groups', { code, name: 'Revive me' }, [admin]);
    expect(made.status).toBe(201);
    const gid = ((await json(made)).data as { id: string }).id;
    expect((await del(`/v1/groups/${gid}`, [admin])).status).toBe(200);
    const again = await post('/v1/groups', { code, name: 'Revived', permissions: ['user.read'] }, [
      admin,
    ]);
    expect(again.status).toBe(201);
    const back = (await json(again)).data as { id: string; name: string; permissionCount: number };
    expect(back.id).toBe(gid);
    expect(back.name).toBe('Revived');
    expect(back.permissionCount).toBe(1);
    expect((await del(`/v1/groups/${gid}`, [admin])).status).toBe(200);

    // Tenant: its data survives the delete, so the code stays taken — but the refusal explains it.
    const tcode = `rev-t-${run}`.slice(0, 32);
    const t1 = await post('/v1/clients', { code: tcode, name: 'Revive tenant' }, [admin]);
    expect(t1.status).toBe(201);
    const tid = ((await json(t1)).data as { id: string }).id;
    expect((await del(`/v1/clients/${tid}`, [admin])).status).toBe(200);
    const t2 = await post('/v1/clients', { code: tcode, name: 'Second try' }, [admin]);
    expect(t2.status).toBe(409);
    expect((await json(t2)).error?.message).toContain('sudah dihapus');
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
    // F-8: the sidebar rail is a profile preference, so it answers on every session of this user.
    const before = await json(await call('/v1/auth/me', {}, [bob]));
    expect((before.data as { user: { sidebarCollapsed: boolean } }).user.sidebarCollapsed).toBe(
      false,
    );
    expect((await put('/v1/users/profile/me', { sidebarCollapsed: true }, [bob])).status).toBe(200);
    const after = await json(await call('/v1/auth/me', {}, [bob2]));
    expect((after.data as { user: { sidebarCollapsed: boolean } }).user.sidebarCollapsed).toBe(
      true,
    );
    expect((await put('/v1/users/profile/me', { sidebarCollapsed: false }, [bob])).status).toBe(
      200,
    );
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

  test('re-creating a deleted user revives that row: the e-mail is UNIQUE across deleted rows too', async () => {
    const res = await post(
      '/v1/users',
      { email: bobEmail, name: 'Bob Again', password: bobPassword, groupIds: [editorsId] },
      [admin],
    );
    expect(res.status).toBe(201); // used to be 500: "Duplicate entry … for key 'users_email_uq'"
    const u = (await json(res)).data as {
      id: string;
      created: boolean;
      name: string;
      statusId: number;
      groups: unknown[];
    };
    expect(u.id).toBe(bobId); // the soft-deleted row came back — a second row cannot exist
    expect(u.created).toBe(true);
    expect(u.name).toBe('Bob Again');
    expect(u.statusId).toBe(1);
    expect(u.groups).toHaveLength(1);
    // …and the account works again with the details typed now.
    const back = await login(bobEmail, bobPassword);
    expect((await call('/v1/auth/me', {}, [back])).status).toBe(200);
  });
});

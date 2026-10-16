import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { eq, schema, unsafeAcrossTenants } from '@core/db';
import { importRegions } from '@core/db/regions';
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
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
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
    .find((c) => c.startsWith('crk_session='))
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

  test('list filter by group (D-1): ?group= narrows to members of that group in this tenant', async () => {
    const members = await json(
      await call(`/v1/users?group=${editorsId}&q=bob-${run}&limit=5`, {}, [admin]),
    );
    expect(members.success).toBe(true);
    expect(members.meta?.total).toBe(1);
    // An unknown (or another tenant's) group id is not an error, it matches nobody.
    const nobody = await json(
      await call(`/v1/users?group=${crypto.randomUUID()}&q=bob-${run}`, {}, [admin]),
    );
    expect(nobody.success).toBe(true);
    expect(nobody.meta?.total).toBe(0);
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

  test('presence: a signed-in member is online, a brand-new one has never been seen (D-5)', async () => {
    const seen = await json(await call(`/v1/users/${bobId}`, {}, [admin]));
    const bobRow = seen.data as unknown as { online: boolean; lastSeenAt: string | null };
    // Bob has a live session from the tests above, and it was touched on this very request.
    expect(bobRow.online).toBe(true);
    expect(bobRow.lastSeenAt).not.toBeNull();
    expect(Date.now() - new Date(bobRow.lastSeenAt ?? 0).getTime()).toBeLessThan(5 * 60_000);

    const created = await post(
      '/v1/users',
      { email: `ghost-${run}@example.test`, name: 'Ghost', password: 'a password for ghost 1' },
      [admin],
    );
    expect(created.status).toBe(201);
    const ghostId = ((await json(created)).data as { id: string }).id;
    const ghost = await json(await call(`/v1/users/${ghostId}`, {}, [admin]));
    // An account that exists is not a person who is here: no session, no presence.
    expect((ghost.data as unknown as { online: boolean }).online).toBe(false);
    expect((ghost.data as unknown as { lastSeenAt: string | null }).lastSeenAt).toBeNull();

    // …and signing out takes the light off without erasing when they were last around.
    const ghostSession = await login(`ghost-${run}@example.test`, 'a password for ghost 1');
    const on = await json(await call(`/v1/users/${ghostId}`, {}, [admin]));
    expect((on.data as unknown as { online: boolean }).online).toBe(true);
    expect((await post('/v1/auth/logout', {}, [ghostSession])).status).toBe(200);
    const off = await json(await call(`/v1/users/${ghostId}`, {}, [admin]));
    expect((off.data as unknown as { online: boolean }).online).toBe(false);
    expect((off.data as unknown as { lastSeenAt: string | null }).lastSeenAt).not.toBeNull();
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

  test('tenant hierarchy: parent on create/edit, resolved in responses, no loops, no orphaning', async () => {
    const mk = async (code: string, name: string, parentId?: string) => {
      const res = await post('/v1/clients', { code, name, ...(parentId ? { parentId } : {}) }, [
        admin,
      ]);
      expect(res.status).toBe(201);
      return (await json(res)).data as {
        id: string;
        parentId: string | null;
        parent: { id: string; code: string; name: string } | null;
        balance: string;
        totalReceipts: string;
        address: string | null;
      };
    };
    const root = await mk(`hq-${run}`.slice(0, 32), 'Head office');
    expect(root.parentId).toBeNull();
    expect(root.parent).toBeNull();

    // No code given: it is derived from the name; a name with nothing usable is a field error.
    const derived = await post('/v1/clients', { name: `PT. Maju Jaya ${run}` }, [admin]);
    expect(derived.status).toBe(201);
    const derivedRow = (await json(derived)).data as { id: string; code: string };
    expect(derivedRow.code).toBe(`pt_maju_jaya_${run}`.slice(0, 32).replace(/_+$/, ''));
    const unusable = await post('/v1/clients', { name: '***' }, [admin]);
    expect(unusable.status).toBe(422);
    const details = (await json(unusable)).error?.details as { code?: string } | undefined;
    expect(details?.code).toBeDefined();
    expect((await del(`/v1/clients/${derivedRow.id}`, [admin])).status).toBe(200);
    const branch = await mk(`br-${run}`.slice(0, 32), 'Branch', root.id);
    expect(branch.parentId).toBe(root.id);
    expect(branch.parent?.name).toBe('Head office');
    const leaf = await mk(`lf-${run}`.slice(0, 32), 'Leaf', branch.id);

    // The list resolves parents too.
    const list = await json(await call(`/v1/clients?q=${run}&limit=50`, {}, [admin]));
    const rows = list.data as unknown as { id: string; parent: { id: string } | null }[];
    expect(rows.find((r) => r.id === leaf.id)?.parent?.id).toBe(branch.id);

    // Profile block (groundwork): defaults, set, clear; amounts and coordinates stay strings.
    expect(leaf.balance).toBe('0');
    expect(leaf.totalReceipts).toBe('0');
    expect(leaf.address).toBeNull();
    const profiled = await json(
      await put(
        `/v1/clients/${leaf.id}`,
        {
          description: 'Toko cabang',
          balance: '1250000.5',
          address: 'Jl. Merdeka 1',
          rt: '03',
          rw: '07',
          postalCode: '40111',
          referenceId: 'PKS/012/X/2026',
          joinDate: '2024-02-29',
          kelurahan: 'Braga',
          kelurahanId: '32.73.01.1001',
          city: 'Bandung',
          province: 'Jawa Barat',
          countryId: 'ID',
          latitude: '-6.9174639',
          longitude: '107.6191228',
          url: 'https://example.test',
        },
        [admin],
      ),
    );
    const p = profiled.data as Record<string, string | null>;
    expect(p.balance).toBe('1250000.5'); // trailing zeros trimmed, same on every dialect
    expect(p.totalReceipts).toBe('0');
    expect(p.kelurahanId).toBe('32.73.01.1001');
    expect(p.postalCode).toBe('40111');
    expect(p.referenceId).toBe('PKS/012/X/2026');
    expect(p.joinDate).toBe('2024-02-29'); // a leap day survives the round trip unshifted
    expect(p.latitude).toBe('-6.9174639');
    expect(p.longitude).toBe('107.6191228');
    expect(p.url).toBe('https://example.test');
    const clearedProfile = await json(
      await put(`/v1/clients/${leaf.id}`, { address: null, balance: null, latitude: null }, [
        admin,
      ]),
    );
    expect(clearedProfile.data?.address).toBeNull();
    expect(clearedProfile.data?.balance).toBe('0');
    expect(clearedProfile.data?.latitude).toBeNull();
    expect(clearedProfile.data?.city).toBe('Bandung'); // untouched keys stay
    // Out-of-range coordinates and non-decimal amounts never reach the database.
    expect((await put(`/v1/clients/${leaf.id}`, { latitude: '91' }, [admin])).status).toBe(422);
    expect((await put(`/v1/clients/${leaf.id}`, { balance: '1e5' }, [admin])).status).toBe(422);
    expect((await put(`/v1/clients/${leaf.id}`, { postalCode: '40;11' }, [admin])).status).toBe(
      422,
    );
    // Join date: a day the calendar lacks, or another shape, is refused; null clears it alone.
    const feb30 = await put(`/v1/clients/${leaf.id}`, { joinDate: '2026-02-30' }, [admin]);
    expect(feb30.status).toBe(422);
    expect((await json(feb30)).error?.details).toEqual({ joinDate: expect.any(String) });
    expect((await put(`/v1/clients/${leaf.id}`, { joinDate: '30-01-2026' }, [admin])).status).toBe(
      422,
    );
    const noDate = await json(await put(`/v1/clients/${leaf.id}`, { joinDate: null }, [admin]));
    expect(noDate.data?.joinDate).toBeNull();
    expect(noDate.data?.referenceId).toBe('PKS/012/X/2026');

    // Loops are refused: itself, and any of its own descendants.
    expect((await put(`/v1/clients/${root.id}`, { parentId: root.id }, [admin])).status).toBe(409);
    expect((await put(`/v1/clients/${root.id}`, { parentId: leaf.id }, [admin])).status).toBe(409);
    // An unknown parent is a 404, not a silent null.
    expect(
      (
        await put(`/v1/clients/${leaf.id}`, { parentId: '00000000-0000-7000-8000-000000000000' }, [
          admin,
        ])
      ).status,
    ).toBe(404);
    // Re-parenting and clearing both work.
    const moved = await json(await put(`/v1/clients/${leaf.id}`, { parentId: root.id }, [admin]));
    expect((moved.data as { parent: { id: string } }).parent.id).toBe(root.id);
    const cleared = await json(await put(`/v1/clients/${leaf.id}`, { parentId: null }, [admin]));
    expect(cleared.data?.parentId).toBeNull();
    expect(cleared.data?.parent).toBeNull();

    // A parent with live sub-tenants cannot be deleted; children first.
    expect((await del(`/v1/clients/${root.id}`, [admin])).status).toBe(409);
    expect((await del(`/v1/clients/${leaf.id}`, [admin])).status).toBe(200);
    expect((await del(`/v1/clients/${branch.id}`, [admin])).status).toBe(200);
    expect((await del(`/v1/clients/${root.id}`, [admin])).status).toBe(200);
  });

  test('regions: import is idempotent, API lists and resolves, tenant names follow codes', async () => {
    const db = unsafeAcrossTenants();
    // Fixture under a country of its own, so it never mixes with a loaded Indonesian set.
    const p = `Z${run % 10_000}`;
    const fixture = [
      { code: p, parentCode: null, countryCode: 'ZZ', level: 1, name: 'Prov Uji' },
      { code: `${p}.01`, parentCode: p, countryCode: 'ZZ', level: 2, name: 'Kota Uji' },
      { code: `${p}.02`, parentCode: p, countryCode: 'ZZ', level: 2, name: 'Kab. Uji' },
      { code: `${p}.01.01`, parentCode: `${p}.01`, countryCode: 'ZZ', level: 3, name: 'Kec Uji' },
    ];
    try {
      const first = await importRegions(db, fixture);
      expect(first.inserted).toBe(4);
      const again = await importRegions(db, [
        ...fixture.slice(0, 3),
        { ...fixture[3], name: 'Kec Baru' } as (typeof fixture)[number],
      ]);
      expect(again).toEqual({ total: 4, inserted: 0, updated: 1, unchanged: 3 });

      expect((await call('/v1/regions?country=ZZ', {}, [])).status).toBe(401); // session only
      const top = await json(await call('/v1/regions?country=ZZ', {}, [admin]));
      expect((top.data as unknown as { code: string }[]).map((r) => r.code)).toEqual([p]);
      const kids = await json(await call(`/v1/regions?country=ZZ&parent=${p}`, {}, [admin]));
      expect((kids.data as unknown as { name: string }[]).map((r) => r.name)).toEqual([
        'Kab. Uji',
        'Kota Uji',
      ]);
      const found = await json(await call('/v1/regions?country=ZZ&q=baru', {}, [admin]));
      expect((found.data as unknown as { code: string }[]).map((r) => r.code)).toEqual([
        `${p}.01.01`,
      ]);
      const one = await json(await call(`/v1/regions/${p}.01.01`, {}, [admin]));
      const ancestors = (one.data as { ancestors: { code: string }[] }).ancestors;
      expect(ancestors.map((a) => a.code)).toEqual([p, `${p}.01`]);
      expect((await call('/v1/regions/NOPE.1', {}, [admin])).status).toBe(404);

      // A tenant that posts codes only gets the names filled; a cleared code clears its name.
      const res = await post('/v1/clients', { name: `Region test ${run}` }, [admin]);
      const tid = ((await json(res)).data as { id: string }).id;
      const set = await json(
        await put(
          `/v1/clients/${tid}`,
          { provinceId: p, cityId: `${p}.01`, kecamatanId: `${p}.01.01` },
          [admin],
        ),
      );
      expect(set.data?.province).toBe('Prov Uji');
      expect(set.data?.city).toBe('Kota Uji');
      expect(set.data?.kecamatan).toBe('Kec Baru');
      const own = await json(
        await put(`/v1/clients/${tid}`, { cityId: `${p}.02`, city: 'Ditulis sendiri' }, [admin]),
      );
      expect(own.data?.city).toBe('Ditulis sendiri'); // an explicit name wins
      const cleared = await json(await put(`/v1/clients/${tid}`, { kecamatanId: null }, [admin]));
      expect(cleared.data?.kecamatan).toBeNull();
      expect(cleared.data?.province).toBe('Prov Uji');
      expect((await del(`/v1/clients/${tid}`, [admin])).status).toBe(200);
    } finally {
      await db.delete(schema.regions).where(eq(schema.regions.country_code, 'ZZ'));
    }
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

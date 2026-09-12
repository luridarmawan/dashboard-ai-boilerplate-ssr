import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { and, type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): seed, tenancy and RBAC against a real database — M1 gate #1
 * pieces that need real rows: X-Client-ID validation (B-2), tenant switch (B-4), effective
 * permissions per tenant (C-3, C-7), the permission guard (C-3) and superadmin (C-5).
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.77.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `seed-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const userEmail = `member-${run}@example.test`;
const userPassword = 'a regular user password';

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
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
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const login = async (email: string, password: string) => {
  const res = await call('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return sessionCookie(res);
};

describe.skipIf(!enabled)('seed, tenancy and RBAC (O-3, B-2, B-4, C-3, C-5, C-7)', () => {
  let db: Db;
  let defaultTenant = '';
  let userGroupId = '';
  let acmeId = '';
  let admin = '';
  let member = '';
  let memberId = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants(); // only when the suite actually runs (INTEGRATION=1)
    process.env.SIGNUP_ENABLED = 'true';
  });

  test('seed is idempotent: second run creates nothing, superadmin password untouched', async () => {
    const first = await runSeed(db, { adminEmail, adminPassword });
    expect(first.adminUserId).not.toBeNull();
    const second = await runSeed(db, { adminEmail, adminPassword: 'a different password' });
    expect(second.created).toEqual([]);
    expect(second.tenantId).toBe(first.tenantId);
    defaultTenant = first.tenantId;
    // A group of our own with exactly `user.read`: the seeded `user` group is shared state that
    // other proofs (the web flow) legitimately edit, so asserting on it would be flaky.
    userGroupId = newId();
    await db.insert(schema.groups).values({
      id: userGroupId,
      client_id: first.tenantId,
      code: `tenancy-${run}`,
      name: 'Tenancy test group',
    });
    await db.insert(schema.groupPermissions).values({
      id: newId(),
      client_id: first.tenantId,
      group_id: userGroupId,
      permission: 'user.read',
    });
    admin = await login(adminEmail, adminPassword); // the original password still works
  });

  test('superadmin: *.* in the default tenant, registry route allowed', async () => {
    const p = await json(await call('/v1/auth/permissions', {}, [admin]));
    expect(p.data?.clientId).toBe(defaultTenant);
    expect(p.data?.isSuperadmin).toBe(true);
    expect(p.data?.permissions).toEqual(['*.*']);
    const reg = await json(await call('/v1/auth/permission-registry', {}, [admin]));
    const resources = reg.data?.resources as { resource: string; module: string }[];
    expect(resources.some((r) => r.resource === 'user' && r.module === 'core')).toBe(true);
    expect(resources.some((r) => r.module === 'Dummy')).toBe(true); // module permissions arrive via sync
  });

  test('regular user: joins the default tenant on register, no permissions until grouped', async () => {
    const res = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: userEmail, password: userPassword, name: 'Member' }),
    });
    expect(res.status).toBe(201);
    member = sessionCookie(res);
    const me0 = await json(await call('/v1/auth/me', {}, [member]));
    memberId = (me0.data as { user: { id: string } }).user.id;
    const before = await json(await call('/v1/auth/permissions', {}, [member]));
    expect(before.data?.clientId).toBe(defaultTenant);
    expect(before.data?.permissions).toEqual([]);
    // Guarded route: 403 forbidden with the missing permission named; anonymous → 401.
    const denied = await call('/v1/auth/permission-registry', {}, [member]);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error?.code).toBe('forbidden');
    expect((await call('/v1/auth/permission-registry')).status).toBe(401);

    await db
      .insert(schema.groupUserMaps)
      .values({ id: newId(), client_id: defaultTenant, group_id: userGroupId, user_id: memberId });
    // No restart, no cache: the very next request sees the new group (Decision M).
    const after = await json(await call('/v1/auth/permissions', {}, [member]));
    expect(after.data?.permissions).toEqual(['user.read']);
  });

  test('X-Client-ID must name a tenant the user belongs to (B-2)', async () => {
    const forged = await call('/v1/auth/permissions', { headers: { 'x-client-id': newId() } }, [
      member,
    ]);
    expect(forged.status).toBe(403);
    expect((await json(forged)).error?.code).toBe('tenant_forbidden');
    const garbage = await call(
      '/v1/auth/permissions',
      { headers: { 'x-client-id': 'not-a-uuid' } },
      [member],
    );
    expect(garbage.status).toBe(403);
    const own = await call('/v1/auth/permissions', { headers: { 'x-client-id': defaultTenant } }, [
      member,
    ]);
    expect(own.status).toBe(200);
  });

  test('switch tenant: only to a membership; groups do not leak across tenants (B-3, B-4)', async () => {
    acmeId = newId();
    await db
      .insert(schema.clients)
      .values({ id: acmeId, code: `acme-${run}`.slice(0, 32), name: 'Acme' });
    // Not a member yet → 403.
    const early = await call(
      '/v1/auth/switch-tenant',
      { method: 'POST', body: JSON.stringify({ clientId: acmeId }) },
      [member],
    );
    expect(early.status).toBe(403);
    await db
      .insert(schema.clientUserMaps)
      .values({ id: newId(), client_id: acmeId, user_id: memberId, is_default: false });
    const sw = await json(
      await call(
        '/v1/auth/switch-tenant',
        { method: 'POST', body: JSON.stringify({ clientId: acmeId }) },
        [member],
      ),
    );
    expect(sw.success).toBe(true);
    expect(sw.data?.clientId).toBe(acmeId);
    expect(sw.data?.permissions).toEqual([]); // `user` group lives in the default tenant only
    const me = await json(await call('/v1/auth/me', {}, [member]));
    expect(me.data?.clientId).toBe(acmeId);
    const tenantIds = (me.data as { tenants: { id: string }[] }).tenants.map((x) => x.id).sort();
    expect(tenantIds).toEqual([acmeId, defaultTenant].sort());
    // Header overrides the session tenant for one request, when allowed.
    const viaHeader = await json(
      await call('/v1/auth/permissions', { headers: { 'x-client-id': defaultTenant } }, [member]),
    );
    expect(viaHeader.data?.permissions).toEqual(['user.read']);
    // The switch is audited inside the target tenant (M-2).
    const [audit] = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.client_id, acmeId), eq(schema.auditLog.actor_id, memberId)));
    expect(audit?.action).toBe('auth.switch_tenant');
  });

  test('a superadmin acts in any live tenant without membership, and is *.* there (C-5)', async () => {
    const p = await json(
      await call('/v1/auth/permissions', { headers: { 'x-client-id': acmeId } }, [admin]),
    );
    expect(p.data?.clientId).toBe(acmeId);
    expect(p.data?.permissions).toEqual(['*.*']);
    const ghost = await call('/v1/auth/permissions', { headers: { 'x-client-id': newId() } }, [
      admin,
    ]);
    expect(ghost.status).toBe(403); // a tenant that does not exist is still refused
  });
});

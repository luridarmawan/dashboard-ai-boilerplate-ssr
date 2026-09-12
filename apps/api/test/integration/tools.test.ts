import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { and, type Db, desc, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import { allTools, callTool, listTools } from '../../src/tools.ts';

/**
 * Integration (INTEGRATION=1): the tool registry (extension point 8) is not a back door — PRD I-3
 * and I-6 against a real database:
 *   - no session → 401 on list and call;
 *   - a tool is visible/callable only with its permission, and only while its module is enabled;
 *   - arguments are validated against the declared schema;
 *   - a tool sees the ACTIVE tenant's rows only (X-Client-ID switches it, membership required);
 *   - every call is audited.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.78.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `tools-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `tools-member-${run}@example.test`;
const memberPassword = 'a regular member password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; details?: Record<string, unknown> };
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
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const post = (
  path: string,
  body: unknown,
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => call(path, { method: 'POST', body: JSON.stringify(body), headers: extra }, cookies);
const names = (r: Envelope) => ((r.data ?? []) as { name: string }[]).map((t) => t.name).sort();

describe.skipIf(!enabled)('tool registry — RBAC, tenancy, schema, audit (I-3, I-6)', () => {
  let db: Db;
  let tenantId = '';
  let acmeId = '';
  let admin = '';
  let adminId = '';
  let member = '';
  let memberId = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    admin = sessionCookie(
      await post('/v1/auth/login', { email: adminEmail, password: adminPassword }),
    );
    adminId = (
      (await json(await call('/v1/auth/me', {}, [admin]))).data as { user: { id: string } }
    ).user.id;
    const reg = await post('/v1/auth/register', {
      email: memberEmail,
      password: memberPassword,
      name: 'Member',
    });
    expect(reg.status).toBe(201);
    member = sessionCookie(reg);
    memberId = (
      (await json(await call('/v1/auth/me', {}, [member]))).data as { user: { id: string } }
    ).user.id;
  });

  test('the registry holds the built-in modules’ tools, with wire names the model can use', () => {
    const all = allTools().map((t) => t.name);
    expect(all).toContain('dummy.ping');
    expect(all).toContain('dummy.count_notes');
    expect(all).toContain('example.list_products');
    for (const t of allTools()) expect(t.module).toMatch(/^[A-Z]/);
  });

  test('no session → 401 on list and call (I-6)', async () => {
    expect((await call('/v1/tools')).status).toBe(401);
    expect((await post('/v1/tools/call', { name: 'dummy.ping' })).status).toBe(401);
  });

  test('visibility follows the permission: superadmin sees all, a bare member only the free tool (I-3)', async () => {
    const forAdmin = names(await json(await call('/v1/tools', {}, [admin])));
    expect(forAdmin).toEqual(
      expect.arrayContaining(['dummy.ping', 'dummy.count_notes', 'example.list_products']),
    );
    const forMember = names(await json(await call('/v1/tools', {}, [member])));
    expect(forMember).toContain('dummy.ping');
    expect(forMember).not.toContain('dummy.count_notes');
    expect(forMember).not.toContain('example.list_products');
  });

  test('calling without the permission → 403 naming it; unknown tool → 404; bad arguments → 422', async () => {
    const denied = await post('/v1/tools/call', { name: 'dummy.count_notes' }, [member]);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error?.code).toBe('forbidden');
    expect(
      (await json(await post('/v1/tools/call', { name: 'dummy.count_notes' }, [admin]))).success,
    ).toBe(true);

    const missing = await post('/v1/tools/call', { name: 'dummy.nothing' }, [admin]);
    expect(missing.status).toBe(404);

    const bad = await post('/v1/tools/call', { name: 'dummy.ping', input: { message: 123 } }, [
      admin,
    ]);
    expect(bad.status).toBe(422);
    expect((await json(bad)).error?.details?.reason).toBe('invalid_input');

    // The wire name (<ns>_<name>) resolves to the same tool.
    const ok = await json(
      await post('/v1/tools/call', { name: 'dummy_ping', input: { message: 'hi' } }, [member]),
    );
    expect(ok.success).toBe(true);
    expect((ok.data as { name: string; result: { pong: string; tenant: string } }).name).toBe(
      'dummy.ping',
    );
    expect((ok.data as { result: { pong: string; tenant: string } }).result.pong).toBe('hi');
    expect((ok.data as { result: { tenant: string } }).result.tenant).toBe(tenantId);
  });

  test('a tool sees only the active tenant; X-Client-ID switches it and needs membership (I-6)', async () => {
    acmeId = newId();
    await db
      .insert(schema.clients)
      .values({ id: acmeId, code: `acme-t-${run}`.slice(0, 32), name: 'Acme' });
    const mine = `Produk-${run}`;
    const theirs = `Acme-${run}`;
    await db.insert(schema.exampleProducts).values([
      { id: newId(), client_id: tenantId, slug: `p-${run}`, name: mine },
      { id: newId(), client_id: acmeId, slug: `a-${run}`, name: theirs },
    ]);
    // The shared dev tenant accumulates products from earlier runs: filter by this run's name prefix
    // so the 50-row cap never hides ours (the tenancy assertion is unaffected — Acme has no such rows).
    const listNames = async (headers: Record<string, string>, cookies: string[]) => {
      const r = await json(
        await post(
          '/v1/tools/call',
          { name: 'example.list_products', input: { q: `-${run}`, limit: 50 } },
          cookies,
          headers,
        ),
      );
      return ((r.data as { result: { products: { name: string }[] } }).result.products ?? []).map(
        (p) => p.name,
      );
    };
    const inDefault = await listNames({}, [admin]);
    expect(inDefault).toContain(mine);
    expect(inDefault).not.toContain(theirs);
    // Superadmin may act in any live tenant (C-5): the SAME tool now sees Acme's rows only.
    const inAcme = await listNames({ 'x-client-id': acmeId }, [admin]);
    expect(inAcme).toContain(theirs);
    expect(inAcme).not.toContain(mine);
    // A member of the default tenant cannot point the tool at a tenant they do not belong to.
    const foreign = await post('/v1/tools/call', { name: 'dummy.ping' }, [member], {
      'x-client-id': acmeId,
    });
    expect(foreign.status).toBe(403);
    expect((await json(foreign)).error?.code).toBe('tenant_forbidden');
  });

  test('a disabled module hides and refuses its tools for that tenant only (G-8)', async () => {
    expect(
      (
        await call(
          '/v1/module/Dummy/enabled',
          { method: 'PUT', body: JSON.stringify({ enabled: false }) },
          [admin],
        )
      ).status,
    ).toBe(200);
    try {
      const visible = names(await json(await call('/v1/tools', {}, [admin])));
      expect(visible).not.toContain('dummy.ping');
      expect(visible).toContain('example.list_products');
      const refused = await post('/v1/tools/call', { name: 'dummy.ping' }, [admin]);
      expect(refused.status).toBe(403);
      expect((await json(refused)).error?.code).toBe('module_disabled');
      // Another tenant is unaffected.
      const elsewhere = await post('/v1/tools/call', { name: 'dummy.ping' }, [admin], {
        'x-client-id': acmeId,
      });
      expect(elsewhere.status).toBe(200);
    } finally {
      await call(
        '/v1/module/Dummy/enabled',
        { method: 'PUT', body: JSON.stringify({ enabled: null }) },
        [admin],
      );
    }
    expect(names(await json(await call('/v1/tools', {}, [admin])))).toContain('dummy.ping');
  });

  test('the in-process API (used by the AI chat) enforces the same rules, and every call is audited', async () => {
    const asMember = { clientId: tenantId, userId: memberId, can: () => false };
    expect((await listTools(asMember)).map((t) => t.name)).toEqual(['dummy.ping']);
    const denied = await callTool('dummy.count_notes', {}, asMember);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('forbidden');
    const noTenant = await callTool('dummy.ping', {}, { ...asMember, clientId: null });
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.code).toBe('no_tenant');
    const ok = await callTool(
      'dummy_ping',
      { message: 'in-process' },
      { ...asMember, requestId: `req-${run}` },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((ok.result as { pong: string }).pong).toBe('in-process');

    // Audit: both the refusal and the success left a row in the tenant's audit log (M-2). Rows are
    // written off the hot path, so poll briefly.
    const eventually = async (fn: () => Promise<boolean>) => {
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        if (await fn()) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return fn();
    };
    const toolRows = () =>
      db
        .select({ resource: schema.auditLog.resource, action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.client_id, tenantId),
            eq(schema.auditLog.actor_id, memberId),
            eq(schema.auditLog.action, 'tool.call'),
          ),
        )
        .orderBy(desc(schema.auditLog.created_at))
        .limit(20);
    expect(
      await eventually(async () => (await toolRows()).some((r) => r.resource === 'dummy.ping')),
    ).toBe(true);
    expect(
      await eventually(async () =>
        (await toolRows()).some((r) => r.resource === 'dummy.count_notes'),
      ),
    ).toBe(true);
    expect(
      await eventually(async () =>
        (
          await db
            .select({ resource: schema.auditLog.resource })
            .from(schema.auditLog)
            .where(
              and(
                eq(schema.auditLog.client_id, acmeId),
                eq(schema.auditLog.actor_id, adminId),
                eq(schema.auditLog.action, 'tool.call'),
              ),
            )
        ).some((r) => r.resource === 'example.list_products'),
      ),
    ).toBe(true);
  });
});

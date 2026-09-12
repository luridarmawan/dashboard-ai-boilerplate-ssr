import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { and, type Db, desc, eq, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): impersonation (PRD D-6). A second cookie carries a
 * session opened AS the target; requests then act as the target while `/me` names the admin behind
 * it; the admin's own session is untouched, credential changes are refused meanwhile, both ends
 * are audited, and stopping revokes the impersonated session and drops the cookie.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.95.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `imp-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `imp-member-${run}@example.test`;
const memberPassword = 'a regular member password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: Record<string, unknown> };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const cookieOf = (r: Response, name: string) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0] ?? '';
const login = (email: string, password: string) =>
  call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
type Me = { user: { id: string; email: string }; impersonator: { id: string } | null };
const me = async (cookies: string[]) =>
  (await json(await call('/v1/auth/me', {}, cookies))).data as Me;

describe.skipIf(!enabled)('impersonation (D-6)', () => {
  let db: Db;
  let admin = '';
  let adminId = '';
  let member = '';
  let memberId = '';
  let imp = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    await runSeed(db, { adminEmail, adminPassword });
    admin = cookieOf(await login(adminEmail, adminPassword), 'crk_session');
    adminId = (await me([admin])).user.id;
    const reg = await call('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: memberEmail, password: memberPassword, name: 'Target' }),
    });
    expect(reg.status).toBe(201);
    member = cookieOf(reg, 'crk_session');
    memberId = (await me([member])).user.id;
  });

  test('user.impersonate is required to start; not on self, another superadmin, or an unknown user', async () => {
    const asMember = await call(`/v1/users/${adminId}/impersonate`, { method: 'POST' }, [member]);
    expect(asMember.status).toBe(403);
    expect((await call(`/v1/users/${memberId}/impersonate`, { method: 'POST' })).status).toBe(401);
    expect(
      (await call(`/v1/users/${adminId}/impersonate`, { method: 'POST' }, [admin])).status,
    ).toBe(409);
    expect(
      (
        await call(
          `/v1/users/00000000-0000-4000-8000-000000000000/impersonate`,
          { method: 'POST' },
          [admin],
        )
      ).status,
    ).toBe(404);
  });

  test('start: a second cookie makes requests act as the target while /me names the admin; the admin session stands', async () => {
    const r = await call(`/v1/users/${memberId}/impersonate`, { method: 'POST' }, [admin]);
    expect(r.status).toBe(200);
    const d = (await json(r)).data as { user: { id: string }; expiresAt: string };
    expect(d.user.id).toBe(memberId);
    expect(new Date(d.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(3600_000 + 5000);
    imp = cookieOf(r, 'crk_impersonate');
    expect(imp.length).toBeGreaterThan(20);
    expect(cookieOf(r, 'crk_session')).toBe(''); // the admin's own cookie is not touched

    const asTarget = await me([admin, imp]);
    expect(asTarget.user.id).toBe(memberId);
    expect(asTarget.impersonator?.id).toBe(adminId);
    // The impersonation cookie alone is nothing; with someone else's session it is ignored.
    expect((await call('/v1/auth/me', {}, [imp])).status).toBe(401);
    const other = await me([member, imp]);
    expect(other.user.id).toBe(memberId);
    expect(other.impersonator).toBeNull();
    // Admin without the cookie: still just the admin.
    expect((await me([admin])).impersonator).toBeNull();

    const [row] = await db
      .select()
      .from(schema.sessions)
      .where(
        and(eq(schema.sessions.user_id, memberId), eq(schema.sessions.impersonator_id, adminId)),
      )
      .orderBy(desc(schema.sessions.created_at))
      .limit(1);
    expect(row).toBeDefined();
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'user.impersonate_start'),
          eq(schema.auditLog.resource_id, memberId),
        ),
      )
      .orderBy(desc(schema.auditLog.created_at))
      .limit(1);
    expect(audit?.actor_id).toBe(adminId);
  });

  test('while impersonating: credentials and 2FA of the target cannot be changed; no nesting', async () => {
    const pw = await call(
      '/v1/users/profile/password',
      {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: memberPassword,
          newPassword: 'another strong one 42',
        }),
      },
      [admin, imp],
    );
    expect(pw.status).toBe(403);
    expect((await json(pw)).error?.details?.reason).toBe('impersonating');
    expect(
      (await call('/v1/users/profile/mfa/setup', { method: 'POST' }, [admin, imp])).status,
    ).toBe(403);
    expect(
      (await call(`/v1/users/${memberId}/impersonate`, { method: 'POST' }, [admin, imp])).status,
    ).toBe(403);
    // The target's password still works: nothing changed.
    expect(cookieOf(await login(memberEmail, memberPassword), 'crk_session')).not.toBe('');
  });

  test('stop revokes the impersonated session, clears the cookie and audits; a stale cookie is ignored', async () => {
    expect((await call('/v1/users/impersonate/stop', { method: 'POST' }, [admin])).status).toBe(
      409,
    );
    const r = await call('/v1/users/impersonate/stop', { method: 'POST' }, [admin, imp]);
    expect(r.status).toBe(200);
    expect(((await json(r)).data as { user: { id: string } }).user.id).toBe(adminId);
    const cleared = r.headers.getSetCookie().find((c) => c.startsWith('crk_impersonate=')) ?? '';
    expect(cleared.toLowerCase()).toContain('max-age=0');
    // Sending the old cookie again: the session is revoked → plain admin.
    const after = await me([admin, imp]);
    expect(after.user.id).toBe(adminId);
    expect(after.impersonator).toBeNull();
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'user.impersonate_stop'),
          eq(schema.auditLog.resource_id, memberId),
        ),
      )
      .orderBy(desc(schema.auditLog.created_at))
      .limit(1);
    expect(audit?.actor_id).toBe(adminId);
  });

  /**
   * The permission (C-4) opens impersonation to a non-superadmin — but only downwards and only
   * inside the tenant they are acting in, or `user.impersonate` alone would be a ladder into
   * the tenant's admin group and a way out of one's own tenant.
   */
  test('a delegate with user.impersonate acts downwards inside its own tenant only', async () => {
    const post = (
      path: string,
      body: unknown,
      cookies: string[],
      headers?: Record<string, string>,
    ) =>
      call(
        path,
        { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) },
        cookies,
      );
    const idOf = async (r: Response) => ((await json(r)).data as { id: string }).id;
    const mkGroup = async (code: string, permissions: string[]) => {
      const r = await post('/v1/groups', { code, name: code, permissions }, [admin]);
      expect(r.status).toBe(201);
      return idOf(r);
    };
    const mkUser = async (
      email: string,
      extra: Record<string, unknown>,
      headers?: Record<string, string>,
    ) => {
      const r = await post(
        '/v1/users',
        { email, name: email, phone: null, ...extra },
        [admin],
        headers,
      );
      expect(r.status).toBe(201);
      return idOf(r);
    };
    const delegatePassword = 'a delegate account password';
    const delegateEmail = `imp-delegate-${run}@example.test`;
    const delegateId = await mkUser(delegateEmail, {
      password: delegatePassword,
      groupIds: [await mkGroup(`imp-del-${run}`, ['user.read', 'user.impersonate'])],
    });
    const delegate = cookieOf(await login(delegateEmail, delegatePassword), 'crk_session');
    expect(delegate).not.toBe('');

    // Downwards: the member holds nothing the delegate does not.
    const started = await call(`/v1/users/${memberId}/impersonate`, { method: 'POST' }, [delegate]);
    expect(started.status).toBe(200);
    const impCookie = cookieOf(started, 'crk_impersonate');
    const asMember = await me([delegate, impCookie]);
    expect(asMember.user.id).toBe(memberId);
    expect(asMember.impersonator?.id).toBe(delegateId);
    await call('/v1/users/impersonate/stop', { method: 'POST' }, [delegate, impCookie]);

    // A user of another tenant is simply not there (B-3) — a superadmin still reaches them.
    const otherTenant = await post('/v1/clients', { code: `imp-t-${run}`, name: 'Other' }, [admin]);
    expect(otherTenant.status).toBe(201);
    const outsiderId = await mkUser(
      `imp-outsider-${run}@example.test`,
      { password: 'an outsider account password' },
      { 'x-client-id': await idOf(otherTenant) },
    );
    expect(
      (await call(`/v1/users/${outsiderId}/impersonate`, { method: 'POST' }, [delegate])).status,
    ).toBe(404);

    // Upwards: the member now holds a permission the delegate does not.
    const put = await call(
      `/v1/users/${memberId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ groupIds: [await mkGroup(`imp-high-${run}`, ['config.read'])] }),
      },
      [admin],
    );
    expect(put.status).toBe(200);
    const refused = await call(`/v1/users/${memberId}/impersonate`, { method: 'POST' }, [delegate]);
    expect(refused.status).toBe(403);
    expect((await json(refused)).error?.details?.permission).toBe('config.read');
  });

  test('logout drops both cookies', async () => {
    const r2 = await call(`/v1/users/${memberId}/impersonate`, { method: 'POST' }, [admin]);
    const imp2 = cookieOf(r2, 'crk_impersonate');
    const out = await call('/v1/auth/logout', { method: 'POST' }, [admin, imp2]);
    expect(out.status).toBe(200);
    const names = out.headers.getSetCookie().map((c) => c.split('=')[0]);
    expect(names).toContain('crk_session');
    expect(names).toContain('crk_impersonate');
  });
});

import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';
import { notify, usersWithPermission } from '../../src/notifications.ts';
import { runLogRetentionOnce } from '../../src/retention.ts';

/**
 * Integration (INTEGRATION=1): in-app notifications (PRD J-4) — the `notify()` backend (explicit
 * and permission-targeted fan-out, actor excluded), the caller-scoped API (list, count, mark read,
 * read-all, tenancy), the built-in producers (API token minted, module toggled, Example inquiry)
 * and retention of READ notifications only.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.72.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `notif-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `notif-member-${run}@example.test`;
const memberPassword = 'a regular member password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string };
}
const call = (
  path: string,
  init: RequestInit = {},
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const post = (
  path: string,
  body: unknown,
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => call(path, { method: 'POST', body: JSON.stringify(body) }, cookies, extra);
type Item = { id: string; type: string; title: string; link: string | null; readAt: string | null };
const mine = async (cookies: string[], q = '') =>
  (await json(await call(`/v1/notifications${q}`, {}, cookies))).data as {
    items: Item[];
    unread: number;
  };

describe.skipIf(!enabled)('in-app notifications (J-4)', () => {
  let db: Db;
  let tenantId = '';
  let admin = '';
  let adminId = '';
  let member = '';
  let memberId = '';
  let editorsGroup = '';

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
    // A group that may read Example inquiries, with the member in it — the fan-out target.
    editorsGroup = newId();
    await db.insert(schema.groups).values({
      id: editorsGroup,
      client_id: tenantId,
      code: `inq-${run}`.slice(0, 64),
      name: 'Inquiry readers',
    });
    await db.insert(schema.groupPermissions).values({
      id: newId(),
      client_id: tenantId,
      group_id: editorsGroup,
      permission: 'example.inquiry.read',
    });
    await db
      .insert(schema.groupUserMaps)
      .values({ id: newId(), client_id: tenantId, group_id: editorsGroup, user_id: memberId });
  });

  test('no session → 401; an empty inbox reads as zero', async () => {
    expect((await call('/v1/notifications')).status).toBe(401);
    expect((await call('/v1/notifications/count')).status).toBe(401);
    const m = await mine([member]);
    expect(m.items).toEqual([]);
    expect(m.unread).toBe(0);
  });

  test('notify(): explicit recipients, permission fan-out (grants honour manage/*), actor excluded', async () => {
    // The shared dev database holds many admins whose groups grant `*.*`, so the exact set is not
    // stable — but our member (via the concrete grant) must be in it, and a stranger must not.
    const readers = await usersWithPermission(tenantId, 'example.inquiry.read');
    expect(readers).toContain(memberId);
    const outsider = newId();
    expect(readers).not.toContain(outsider);
    const r = await notify({
      clientId: tenantId,
      permission: 'example.inquiry.read',
      userIds: [adminId],
      excludeUserIds: [adminId],
      type: 'test.hello',
      title: `Halo ${run}`,
      body: 'isi',
      link: '/dashboard',
    });
    expect(r.recipients).toBeGreaterThanOrEqual(1); // member via permission; admin excluded although listed explicitly
    const m = await mine([member]);
    expect(m.unread).toBe(1);
    expect(m.items[0]).toMatchObject({
      type: 'test.hello',
      title: `Halo ${run}`,
      link: '/dashboard',
      readAt: null,
    });
    expect((await mine([admin])).items.some((n) => n.title === `Halo ${run}`)).toBe(false);
  });

  test('mark read (idempotent, mine only), read-all, unread filter, count', async () => {
    const [n] = (await mine([member])).items;
    expect(n).toBeDefined();
    if (!n) return;
    // Someone else cannot mark my notification.
    expect((await call(`/v1/notifications/${n.id}/read`, { method: 'PUT' }, [admin])).status).toBe(
      404,
    );
    expect((await call(`/v1/notifications/${n.id}/read`, { method: 'PUT' }, [member])).status).toBe(
      200,
    );
    expect((await call(`/v1/notifications/${n.id}/read`, { method: 'PUT' }, [member])).status).toBe(
      200,
    );
    expect((await mine([member])).unread).toBe(0);
    expect((await mine([member], '?unread=1')).items).toEqual([]);
    await notify({ clientId: tenantId, userIds: [memberId], type: 'test.two', title: 'a' });
    await notify({ clientId: tenantId, userIds: [memberId], type: 'test.two', title: 'b' });
    expect(
      ((await json(await call('/v1/notifications/count', {}, [member]))).data as { unread: number })
        .unread,
    ).toBe(2);
    const all = (await json(await post('/v1/notifications/read-all', {}, [member]))).data as {
      marked: number;
    };
    expect(all.marked).toBe(2);
    expect((await mine([member])).unread).toBe(0);
  });

  test('producers: a minted API token notifies its owner; a module toggle notifies module managers (not the actor); an inquiry notifies readers', async () => {
    await post('/v1/tokens', { name: `bell-${run}` }, [member]);
    const afterToken = await mine([member], '?unread=1');
    expect(
      afterToken.items.some((n) => n.type === 'token.created' && n.title.includes(`bell-${run}`)),
    ).toBe(true);

    // The actor (admin) toggles Dummy: admins are notified EXCEPT the actor; the member has no module.manage.
    await call(
      '/v1/module/Dummy/enabled',
      { method: 'PUT', body: JSON.stringify({ enabled: false }) },
      [admin],
    );
    await call(
      '/v1/module/Dummy/enabled',
      { method: 'PUT', body: JSON.stringify({ enabled: null }) },
      [admin],
    );
    expect((await mine([admin], '?unread=1')).items.some((n) => n.type === 'module.toggled')).toBe(
      false,
    );
    expect((await mine([member], '?unread=1')).items.some((n) => n.type === 'module.toggled')).toBe(
      false,
    );

    // Public contact form (Example, R-5) → readers of inquiries get the bell, with a link to the list.
    const inquiry = await post(
      '/v1/m/example/inquiries',
      {
        name: `Budi ${run}`,
        email: `budi-${run}@example.test`,
        message: 'Halo, saya tertarik dengan produk Anda.',
      },
      [],
      { 'x-client-id': tenantId, 'x-forwarded-for': `10.72.9.${run % 250}` },
    );
    expect([200, 201]).toContain(inquiry.status);
    const inbox = await mine([member], '?unread=1');
    const hit = inbox.items.find((n) => n.type === 'example.inquiry');
    expect(hit?.title).toContain(`Budi ${run}`);
    expect(hit?.link).toBe('/m/example/inquiries');
  });

  test('tenancy: notifications never cross tenants; retention prunes READ rows only', async () => {
    const acme = newId();
    await db
      .insert(schema.clients)
      .values({ id: acme, code: `acme-n-${run}`.slice(0, 32), name: 'Acme' });
    await notify({ clientId: acme, userIds: [adminId], type: 'test.acme', title: 'acme only' });
    expect((await mine([admin])).items.some((n) => n.type === 'test.acme')).toBe(false); // default tenant view
    const viaHeader = (
      await json(await call('/v1/notifications', {}, [admin], { 'x-client-id': acme }))
    ).data as { items: Item[] };
    expect(viaHeader.items.some((n) => n.type === 'test.acme')).toBe(true);

    const old = new Date(Date.now() - 400 * 86_400_000);
    const readOld = newId();
    const unreadOld = newId();
    await db.insert(schema.notifications).values([
      {
        id: readOld,
        client_id: tenantId,
        user_id: memberId,
        type: 'test.old',
        title: 'read old',
        read_at: old,
        created_at: old,
      },
      {
        id: unreadOld,
        client_id: tenantId,
        user_id: memberId,
        type: 'test.old',
        title: 'unread old',
        read_at: null,
        created_at: old,
      },
    ]);
    const r = await runLogRetentionOnce();
    expect(r.days.notifications).toBeGreaterThanOrEqual(7);
    expect(
      await db.select().from(schema.notifications).where(eq(schema.notifications.id, readOld)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.notifications).where(eq(schema.notifications.id, unreadOld)),
    ).toHaveLength(1);
  });
});

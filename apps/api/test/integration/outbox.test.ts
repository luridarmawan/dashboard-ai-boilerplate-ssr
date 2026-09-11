import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, eq, inArray, newId, schema, unsafeAcrossTenants } from '@core/db';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): the outbox monitoring API (J-2). The list is newest first by
 * default, filters by status, template and a calendar-day range, searches recipient address,
 * recipient name and subject case-insensitively, sorts on request, and answers `mail.read`
 * only. The outbox is GLOBAL and other tests write to it, so every assertion is scoped by a
 * per-run marker in `q` rather than by counting the whole table.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'D'.repeat(43);
const run = Date.now();
const RUN_IP = `10.103.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `outbox-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `outbox-member-${run}@example.test`;
/** Appears in every seeded subject, so `?q=` isolates this run's rows from the shared table. */
const MARK = `obxmark${run}`;

interface Envelope {
  success: boolean;
  data?: unknown;
  meta?: { total: number; page: number; totalPages: number };
  error?: { code: string };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';

interface Row {
  id: string;
  to: string;
  toName: string | null;
  subject: string;
  template: string;
  status: string;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}
/** Subjects of a filtered listing, in the order the API returned them. */
const list = async (query: string, cookie: string) => {
  const r = await call(`/v1/outbox?${query}`, {}, [cookie]);
  const body = await json(r);
  expect(body.success).toBe(true);
  return (body.data as Row[]).map((x) => x.subject);
};

/** Days back from now, so the seeded rows straddle a date boundary the filter can cut on. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe.skipIf(!enabled)('outbox monitoring (J-2): order, filter, search, retry', () => {
  let db: Db;
  let admin = '';
  let member = '';
  const ids = { old: newId(), mid: newId(), recent: newId(), failed: newId() };
  const at = { old: daysAgo(10), mid: daysAgo(5), recent: daysAgo(1), failed: daysAgo(3) };

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    await runSeed(db, { adminEmail, adminPassword });
    admin = sessionCookie(
      await call('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }),
    );
    member = sessionCookie(
      await call('/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: memberEmail,
          password: 'a regular member password',
          name: 'O',
        }),
      }),
    );
    const row = (
      id: string,
      when: Date,
      over: Partial<typeof schema.outboxEmail.$inferInsert>,
    ) => ({
      id,
      to_address: `someone-${id.slice(0, 8)}@example.test`,
      subject: `${MARK} base`,
      template: 'contact',
      locale: 'id',
      status: 'sent',
      created_at: when,
      updated_at: when,
      ...over,
    });
    await db.insert(schema.outboxEmail).values([
      row(ids.old, at.old, {
        subject: `${MARK} oldest`,
        to_address: `zulu-${MARK}@example.test`,
        template: 'invite',
      }),
      row(ids.mid, at.mid, {
        subject: `${MARK} MIDDLE ROW`,
        to_address: `alpha-${MARK}@example.test`,
        to_name: 'Budi Santoso',
      }),
      row(ids.recent, at.recent, {
        subject: `${MARK} newest`,
        to_address: `mike-${MARK}@example.test`,
        status: 'pending',
      }),
      row(ids.failed, at.failed, {
        subject: `${MARK} broken`,
        to_address: `kilo-${MARK}@example.test`,
        status: 'failed',
        attempts: 3,
        last_error: 'connection refused',
      }),
    ] as never);
  });

  afterAll(async () => {
    if (!enabled) return;
    await db.delete(schema.outboxEmail).where(inArray(schema.outboxEmail.id, Object.values(ids)));
  });

  test('default order is newest first', async () => {
    expect(await list(`q=${MARK}`, admin)).toEqual([
      `${MARK} newest`,
      `${MARK} broken`,
      `${MARK} MIDDLE ROW`,
      `${MARK} oldest`,
    ]);
  });

  test('search covers subject, recipient address and recipient name, case-insensitively', async () => {
    expect(await list(`q=${MARK}%20middle`, admin)).toEqual([`${MARK} MIDDLE ROW`]);
    expect(await list(`q=ALPHA-${MARK}`, admin)).toEqual([`${MARK} MIDDLE ROW`]);
    expect(await list('q=budi%20santoso', admin)).toEqual([`${MARK} MIDDLE ROW`]);
    expect(await list(`q=${MARK}-no-such-thing`, admin)).toEqual([]);
  });

  test('status and template narrow the listing, and combine with the search', async () => {
    expect(await list(`q=${MARK}&status=failed`, admin)).toEqual([`${MARK} broken`]);
    expect(await list(`q=${MARK}&status=pending`, admin)).toEqual([`${MARK} newest`]);
    expect(await list(`q=${MARK}&template=invite`, admin)).toEqual([`${MARK} oldest`]);
    expect(await list(`q=${MARK}&status=sent&template=invite`, admin)).toEqual([`${MARK} oldest`]);
    expect(await list(`q=${MARK}&status=sent&template=verify-email`, admin)).toEqual([]);
  });

  test('?from/?to cut on calendar days, with `to` inclusive of its whole day', async () => {
    // The window [mid, failed] must keep both edge rows — `to` is a day, not a midnight.
    expect(await list(`q=${MARK}&from=${day(at.mid)}&to=${day(at.failed)}`, admin)).toEqual([
      `${MARK} broken`,
      `${MARK} MIDDLE ROW`,
    ]);
    expect(await list(`q=${MARK}&from=${day(at.recent)}`, admin)).toEqual([`${MARK} newest`]);
    expect(await list(`q=${MARK}&to=${day(at.old)}`, admin)).toEqual([`${MARK} oldest`]);
  });

  test('sort and order are honoured; a bad day is rejected at the contract', async () => {
    expect(await list(`q=${MARK}&sort=to&order=asc`, admin)).toEqual([
      `${MARK} MIDDLE ROW`,
      `${MARK} broken`,
      `${MARK} newest`,
      `${MARK} oldest`,
    ]);
    expect(await list(`q=${MARK}&sort=created&order=asc`, admin)).toEqual([
      `${MARK} oldest`,
      `${MARK} MIDDLE ROW`,
      `${MARK} broken`,
      `${MARK} newest`,
    ]);
    expect((await call(`/v1/outbox?from=11-09-2026`, {}, [admin])).status).toBe(422);
  });

  test('paging walks the filtered set and reports its own total', async () => {
    const r = await call(`/v1/outbox?q=${MARK}&limit=2&page=2`, {}, [admin]);
    const body = await json(r);
    expect(body.meta?.total).toBe(4);
    expect(body.meta?.totalPages).toBe(2);
    expect((body.data as Row[]).map((x) => x.subject)).toEqual([
      `${MARK} MIDDLE ROW`,
      `${MARK} oldest`,
    ]);
  });

  test('stats count per status and list the templates in use', async () => {
    const body = await json(await call('/v1/outbox/stats', {}, [admin]));
    expect(body.success).toBe(true);
    const d = body.data as {
      failed: number;
      total: number;
      templates: { template: string; count: number }[];
    };
    expect(d.failed).toBeGreaterThanOrEqual(1);
    expect(d.total).toBeGreaterThanOrEqual(4);
    expect(d.templates.map((x) => x.template)).toContain('invite');
  });

  test('retry re-queues a failed row; a member without mail.read is refused', async () => {
    const r = await json(await call(`/v1/outbox/${ids.failed}/retry`, { method: 'POST' }, [admin]));
    expect(r.success).toBe(true);
    expect((r.data as { requeued: number }).requeued).toBe(1);
    const [back] = await db
      .select()
      .from(schema.outboxEmail)
      .where(eq(schema.outboxEmail.id, ids.failed));
    expect(back?.status).toBe('pending');
    expect(back?.last_error).toBeNull();

    expect((await call('/v1/outbox', {}, [member])).status).toBe(403);
    expect(
      (await call(`/v1/outbox/${ids.failed}/retry`, { method: 'POST' }, [member])).status,
    ).toBe(403);
  });
});

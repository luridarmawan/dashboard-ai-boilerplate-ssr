import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, eq, schema, unsafeAcrossTenants } from '@core/db';
import { createEventBus } from '@core/runtime';
import { app } from '../../src/app.ts';
import {
  BACKOFF_S,
  backoffMs,
  enqueue,
  registerTask,
  unregisterTask,
  workQueueOnce,
} from '../../src/queue.ts';
import { setBus } from '../../src/services.ts';

/**
 * Integration (INTEGRATION=1): the ad-hoc job queue (PRD P2). Due rows run by priority; a failing
 * handler is retried on the backoff schedule and dead-lettered after maxAttempts; a dedupe key
 * drops duplicates while one is pending; a lease that expires is recovered; every attempt emits
 * `job.started` / `job.finished` on the core bus; the admin API lists in scope, retries dead
 * letters (attempts reset) and deletes; permissions apply.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.101.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `queue-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `queue-member-${run}@example.test`;
const T_OK = `test.qok${run % 1000}`;
const T_FAIL = `test.qfail${run % 1000}`;
const T_SLOW = `test.qslow${run % 1000}`;

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string };
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
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
type Job = { id: string; name: string; status: string; attempts: number; lastError: string | null };
const rowOf = async (db: Db, id: string) =>
  (await db.select().from(schema.queueJobs).where(eq(schema.queueJobs.id, id)))[0];
/**
 * `enqueue` of a due row also nudges an in-process pass, which may win the claim while the
 * test's own `workQueueOnce` runs: wait until the row is no longer `running` before asserting.
 */
const settled = async (db: Db, id: string) => {
  for (let i = 0; i < 60; i++) {
    const row = await rowOf(db, id);
    if (row && row.status !== 'running') return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return rowOf(db, id);
};

describe.skipIf(!enabled)('ad-hoc job queue (P2): priority, retry, dead-letter, admin', () => {
  let db: Db;
  let admin = '';
  let member = '';
  let tenantId = '';
  const ran: string[] = [];

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
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
          name: 'Q',
        }),
      }),
    );
    registerTask(T_OK, async (payload) => {
      ran.push(String((payload as { tag: string }).tag));
      return { echoed: (payload as { tag: string }).tag };
    });
    registerTask(
      T_FAIL,
      async () => {
        throw new Error('boom');
      },
      { maxAttempts: 3 },
    );
    registerTask(T_SLOW, () => new Promise(() => {}), { timeoutMs: 50 });
  });
  afterAll(() => {
    for (const n of [T_OK, T_FAIL, T_SLOW]) unregisterTask(n);
  });

  test('enqueue refuses unknown tasks; due rows run by priority, then run_at; result is stored', async () => {
    await expect(enqueue('test.nope', {})).rejects.toThrow(/belum terdaftar/);
    const past = new Date(Date.now() - 60_000);
    const low = await enqueue(
      T_OK,
      { tag: 'low' },
      { priority: -5, runAt: past, clientId: tenantId },
    );
    const high = await enqueue(
      T_OK,
      { tag: 'high' },
      { priority: 10, runAt: past, clientId: tenantId },
    );
    const mid = await enqueue(T_OK, { tag: 'mid' }, { runAt: past, clientId: tenantId });
    const later = await enqueue(
      T_OK,
      { tag: 'later' },
      { delayMs: 60 * 60_000, clientId: tenantId },
    );
    ran.length = 0;
    // The enqueue nudge may already be running a pass; work explicitly until our three are done.
    for (let i = 0; i < 20 && ran.length < 3; i++) {
      await workQueueOnce(50);
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(ran.slice(0, 3)).toEqual(['high', 'mid', 'low']);
    expect((await rowOf(db, high.id))?.status).toBe('done');
    expect((await rowOf(db, high.id))?.result).toEqual({ echoed: 'high' });
    expect((await rowOf(db, later.id))?.status).toBe('pending'); // not due
    expect((await rowOf(db, low.id))?.attempts).toBe(1);
    expect(mid.deduped).toBe(false);
  });

  test('a failing handler is retried on the backoff schedule, then dead-lettered at maxAttempts', async () => {
    const past = new Date(Date.now() - 60_000);
    const { id } = await enqueue(T_FAIL, { n: 1 }, { runAt: past, clientId: tenantId });
    await workQueueOnce(50);
    let row = await settled(db, id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBe('boom');
    const wait = (row?.run_at.getTime() ?? 0) - Date.now();
    expect(wait).toBeGreaterThan(backoffMs(1) - 5000);
    expect(wait).toBeLessThanOrEqual(backoffMs(1) + 1000);
    expect(BACKOFF_S[0]).toBe(10);
    // Not due yet: a pass leaves it alone.
    await workQueueOnce(50);
    expect((await rowOf(db, id))?.attempts).toBe(1);
    // Pull the schedule forward twice: attempt 2 (retry), attempt 3 (dead).
    for (const expected of ['pending', 'dead']) {
      await db.update(schema.queueJobs).set({ run_at: past }).where(eq(schema.queueJobs.id, id));
      await workQueueOnce(50);
      row = await settled(db, id);
      expect(row?.status).toBe(expected);
    }
    expect(row?.attempts).toBe(3);
    expect(row?.finished_at).not.toBeNull();
  });

  test('dedupe key: a second enqueue while one is pending is dropped; after completion a new one is accepted', async () => {
    const key = `dedupe-${run}`;
    const a = await enqueue(
      T_OK,
      { tag: 'd1' },
      { dedupeKey: key, delayMs: 60_000, clientId: tenantId },
    );
    const b = await enqueue(
      T_OK,
      { tag: 'd2' },
      { dedupeKey: key, delayMs: 60_000, clientId: tenantId },
    );
    expect(b).toEqual({ id: a.id, deduped: true });
    await db
      .update(schema.queueJobs)
      .set({ run_at: new Date(Date.now() - 1000) })
      .where(eq(schema.queueJobs.id, a.id));
    await workQueueOnce(50);
    expect((await settled(db, a.id))?.status).toBe('done');
    const c = await enqueue(
      T_OK,
      { tag: 'd3' },
      { dedupeKey: key, delayMs: 60_000, clientId: tenantId },
    );
    expect(c.deduped).toBe(false);
  });

  test('a handler that overruns its timeout fails that attempt; an expired lease from a dead worker is recovered', async () => {
    const past = new Date(Date.now() - 60_000);
    const { id } = await enqueue(T_SLOW, {}, { runAt: past, clientId: tenantId });
    await workQueueOnce(50);
    let row = await settled(db, id);
    expect(row?.status).toBe('pending');
    expect(row?.last_error).toContain('timeout');
    // Simulate a worker that died mid-run: running with a lease in the past.
    await db
      .update(schema.queueJobs)
      .set({
        status: 'running',
        locked_by: 'ghost',
        locked_until: new Date(Date.now() - 1000),
        attempts: 1,
      })
      .where(eq(schema.queueJobs.id, id));
    await workQueueOnce(50);
    row = await settled(db, id);
    expect(['pending', 'dead']).toContain(row?.status ?? '');
    expect(row?.last_error).toContain('lease habis');
    expect(row?.locked_by).toBeNull();
  });

  test('admin API: list in scope with counts and tasks; retry resets a dead letter; delete; permissions', async () => {
    expect((await call('/v1/queue')).status).toBe(401);
    expect((await call('/v1/queue', {}, [member])).status).toBe(403);
    const list = (await json(await call('/v1/queue?status=dead', {}, [admin]))).data as {
      jobs: Job[];
      counts: Record<string, number>;
      tasks: { name: string }[];
    };
    const dead = list.jobs.find((j) => j.name === T_FAIL);
    expect(dead).toBeDefined();
    expect(list.counts.dead).toBeGreaterThanOrEqual(1);
    expect(list.tasks.map((tk) => tk.name)).toContain(T_OK);
    const retried = await call(`/v1/queue/${dead?.id}/retry`, { method: 'POST' }, [admin]);
    expect(retried.status).toBe(200);
    const row = await rowOf(db, dead?.id as string);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
    // Retrying a pending row again is fine; a done one is not.
    const doneRow = (await json(await call(`/v1/queue?status=done&name=${T_OK}`, {}, [admin])))
      .data as { jobs: Job[] };
    expect(doneRow.jobs.length).toBeGreaterThan(0);
    expect(
      (await call(`/v1/queue/${doneRow.jobs[0]?.id}/retry`, { method: 'POST' }, [admin])).status,
    ).toBe(409);
    expect(
      (await call(`/v1/queue/${doneRow.jobs[0]?.id}`, { method: 'DELETE' }, [admin])).status,
    ).toBe(200);
    expect(await rowOf(db, doneRow.jobs[0]?.id as string)).toBeUndefined();
    expect((await call(`/v1/queue/${dead?.id}/retry`, { method: 'POST' }, [member])).status).toBe(
      403,
    );
  });

  test('every attempt emits job.started and job.finished with what the row became', async () => {
    type Ev = { event: string; jobId: string; status?: string; attempt: number };
    const seen: Ev[] = [];
    const bus = createEventBus({ log: () => {} });
    for (const event of ['job.started', 'job.finished'] as const)
      bus.on(event, (p) => {
        seen.push({ event, ...(p as Omit<Ev, 'event'>) });
      });
    setBus(bus);
    // `emit` is fire-and-forget, so the assertions wait for the bus to catch up with the worker.
    const eventsOf = async (id: string, want: number) => {
      for (let i = 0; i < 40 && seen.filter((e) => e.jobId === id).length < want; i++)
        await new Promise((r) => setTimeout(r, 25));
      return seen.filter((e) => e.jobId === id);
    };
    try {
      const past = new Date(Date.now() - 60_000);
      const okJob = await enqueue(T_OK, { tag: 'evt' }, { runAt: past, clientId: tenantId });
      await workQueueOnce(50);
      await settled(db, okJob.id);
      const okEvents = await eventsOf(okJob.id, 2);
      expect(okEvents.map((e) => e.event)).toEqual(['job.started', 'job.finished']);
      expect(okEvents[0]).toMatchObject({ attempt: 1 });
      expect(okEvents[1]).toMatchObject({ status: 'done', attempt: 1 });
      expect((okEvents[1] as unknown as { clientId: string }).clientId).toBe(tenantId);
      expect((okEvents[1] as unknown as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(
        0,
      );

      // A failing task ends `retried` while attempts remain, `dead` on the last one.
      const bad = await enqueue(T_FAIL, { n: 1 }, { runAt: past, clientId: tenantId });
      for (let i = 0; i < 3; i++) {
        await db
          .update(schema.queueJobs)
          .set({ run_at: past })
          .where(eq(schema.queueJobs.id, bad.id));
        await workQueueOnce(50);
        await settled(db, bad.id);
      }
      const badEvents = await eventsOf(bad.id, 6);
      expect(badEvents.filter((e) => e.event === 'job.started').length).toBe(3);
      expect(badEvents.filter((e) => e.event === 'job.finished').map((e) => e.status)).toEqual([
        'retried',
        'retried',
        'dead',
      ]);
    } finally {
      setBus(createEventBus({ log: () => {} }));
    }
  });

  test('the admin list is paged: page 2 is reachable and the total comes from the database', async () => {
    type Listing = {
      jobs: Job[];
      counts: Record<string, number>;
      meta: { page: number; limit: number; total: number; totalPages: number };
    };
    const p1 = (await json(await call('/v1/queue?limit=1', {}, [admin]))).data as Listing;
    expect(p1.jobs.length).toBe(1);
    // The queue outgrows any single page, so the total is counted, not derived from the rows.
    expect(p1.meta.total).toBeGreaterThan(1);
    expect(p1.meta.totalPages).toBe(p1.meta.total);
    const p2 = (await json(await call('/v1/queue?limit=1&page=2', {}, [admin]))).data as Listing;
    expect(p2.jobs.length).toBe(1);
    expect(p2.jobs[0]?.id).not.toBe(p1.jobs[0]?.id);
    expect(p2.meta.page).toBe(2);
    // Counts are aggregated over the whole scope, not over the page in hand.
    const summed = Object.values(p1.counts).reduce((a, b) => a + b, 0);
    expect(summed).toBe(p1.meta.total);
  });
});

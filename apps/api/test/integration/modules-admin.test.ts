import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { createEventBus } from '@core/runtime';
import { app } from '../../src/app.ts';
import { setBus } from '../../src/services.ts';

/**
 * Integration (INTEGRATION=1): the module admin listing (G-14) — source & version, contributions
 * as counted by modules:sync, per-tenant state, and health from the scheduler table and the
 * event bus's remembered hook failures.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.74.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `modadm-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
interface ModuleView {
  name: string;
  ns: string;
  version: string;
  source: string;
  path: string;
  description: { id: string; en: string } | null;
  contributes: {
    tables: number;
    api: boolean;
    jobs: string[];
    hooks: string[];
    tools: string[];
    permissions: number;
    menu: number;
    pages: number;
    themes: number;
    layouts: number;
    iconSets: number;
  };
  effective: boolean;
  health: {
    status: string;
    jobs: { name: string; lastStatus: string | null; lastError: string | null }[];
    hookFailures: { event: string; error: string }[];
  };
}
const list = async (admin: string) =>
  ((await (await call('/v1/module', {}, [admin])).json()) as { data: ModuleView[] }).data;

describe.skipIf(!enabled)('module admin listing (G-14)', () => {
  let db: Db;
  let admin = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    await runSeed(db, { adminEmail, adminPassword });
    const res = await call('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    admin =
      res.headers
        .getSetCookie()
        .find((c) => c.startsWith('crk_session='))
        ?.split(';')[0] ?? '';
  });

  test('anonymous → 401; each module reports source, version, path, description and what it contributes', async () => {
    expect((await call('/v1/module')).status).toBe(401);
    const mods = await list(admin);
    const ai = mods.find((m) => m.name === 'AI');
    const dummy = mods.find((m) => m.name === 'Dummy');
    const example = mods.find((m) => m.name === 'Example');
    expect(ai && dummy && example).toBeTruthy();
    expect(ai?.source).toBe('local');
    expect(ai?.path).toBe('modules/AI');
    expect(ai?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ai?.description?.id).toContain('AI');
    // Counted by modules:sync, not guessed: tables, jobs, tools, hooks, themes/layouts/icon sets.
    expect(ai?.contributes.tables).toBe(10); // providers, models, conversations, messages, message_attachments, calls, mcps, mcp_tools, credits, credit_ledger
    expect(ai?.contributes.api).toBe(true);
    expect(ai?.contributes.jobs).toEqual(['ai.log_retention']);
    expect(ai?.contributes.tools).toEqual([]);
    expect(ai?.contributes.permissions).toBe(5);
    expect(dummy?.contributes.hooks).toEqual(['system.ping']);
    expect(dummy?.contributes.jobs).toEqual(['dummy.heartbeat']);
    expect(dummy?.contributes.tools).toEqual(['dummy.ping', 'dummy.count_notes']);
    expect(dummy?.contributes.themes).toBe(1);
    expect(dummy?.contributes.layouts).toBe(1);
    expect(dummy?.contributes.iconSets).toBe(1);
    expect(example?.contributes.tools).toEqual([
      'example.list_products',
      'example.count_inquiries',
    ]);
    expect(example?.contributes.pages).toBeGreaterThan(0);
  });

  test('health: a failed job run and a hook that threw surface on the owning module', async () => {
    // Scheduler table is cluster-wide state: seed a failed last run for the Dummy heartbeat.
    const [existing] = await db
      .select({ id: schema.schedulerJobs.id })
      .from(schema.schedulerJobs)
      .where(eq(schema.schedulerJobs.name, 'dummy.heartbeat'))
      .limit(1);
    const before = existing
      ? await db.select().from(schema.schedulerJobs).where(eq(schema.schedulerJobs.id, existing.id))
      : [];
    if (existing) {
      await db
        .update(schema.schedulerJobs)
        .set({ last_status: 'failed', last_error: `boom ${run}`, last_run_at: new Date() })
        .where(eq(schema.schedulerJobs.id, existing.id));
    } else {
      await db.insert(schema.schedulerJobs).values({
        id: newId(),
        name: 'dummy.heartbeat',
        last_status: 'failed',
        last_error: `boom ${run}`,
        last_run_at: new Date(),
      });
    }
    // Hook failures live in the process bus: install one with a throwing Dummy handler.
    const bus = createEventBus({ log: () => {} });
    bus.on(
      'system.ping',
      () => {
        throw new Error(`hook exploded ${run}`);
      },
      'Dummy',
    );
    setBus(bus);
    try {
      await bus.emit('system.ping', { at: new Date().toISOString() } as never, {
        requestId: `req-${run}`,
      });
      const mods = await list(admin);
      const dummy = mods.find((m) => m.name === 'Dummy');
      expect(dummy?.health.status).toBe('failed');
      const hb = dummy?.health.jobs.find((j) => j.name === 'dummy.heartbeat');
      expect(hb?.lastStatus).toBe('failed');
      expect(hb?.lastError).toBe(`boom ${run}`);
      expect(dummy?.health.hookFailures[0]).toMatchObject({
        event: 'system.ping',
        error: `hook exploded ${run}`,
      });
      // Other modules are untouched by Dummy's trouble.
      const ai = mods.find((m) => m.name === 'AI');
      expect(ai?.health.hookFailures).toEqual([]);
    } finally {
      setBus(createEventBus({ log: () => {} }));
      if (existing && before[0]) {
        await db
          .update(schema.schedulerJobs)
          .set({
            last_status: before[0].last_status,
            last_error: before[0].last_error,
            last_run_at: before[0].last_run_at,
          })
          .where(eq(schema.schedulerJobs.id, existing.id));
      } else {
        await db
          .delete(schema.schedulerJobs)
          .where(eq(schema.schedulerJobs.name, 'dummy.heartbeat'));
      }
    }
  });
});

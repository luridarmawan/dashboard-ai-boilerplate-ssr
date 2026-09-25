import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { runSeed } from '@core/auth';
import { type Db, eq, inArray, newId, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Integration (INTEGRATION=1): the call log's filters — user name/e-mail (`q`), model, and an
 * inclusive day range — plus the user name on each row and the distinct-models facet.
 * Rows are planted directly, dated in 2001 with a run-unique model so leftovers never match.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.78.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `ai-logs-${run}@example.test`;
const adminPassword = 'an ai logs password';
const MODEL_A = `logs-a-${run}`;
const MODEL_B = `logs-b-${run}`;

const call = (path: string, cookies: string[] = [], init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
type Log = { id: string; model: string | null; userName: string | null; userId: string | null };
const logs = async (qs: string, cookie: string) => {
  const r = await call(`/v1/m/ai/logs?limit=100&${qs}`, [cookie]);
  expect(r.status).toBe(200);
  return ((await r.json()) as { data: Log[] }).data;
};

describe.skipIf(!enabled)('AI call log filters (H-9)', () => {
  let db: Db;
  let cookie = '';
  const ids: string[] = [];

  beforeAll(async () => {
    db = unsafeAcrossTenants();
    const s = await runSeed(db, { adminEmail, adminPassword });
    const login = await call('/v1/auth/login', [], {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    cookie =
      login.headers
        .getSetCookie()
        .find((c) => c.startsWith('crk_session='))
        ?.split(';')[0] ?? '';
    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail));
    // Noon UTC: the same calendar day on any tenant clock within ±11 h.
    const rows = [
      { model: MODEL_A, user_id: u?.id ?? null, created_at: new Date('2001-02-03T12:00:00Z') },
      { model: MODEL_A, user_id: null, created_at: new Date('2001-02-04T12:00:00Z') },
      { model: MODEL_B, user_id: u?.id ?? null, created_at: new Date('2001-02-05T12:00:00Z') },
    ];
    for (const r of rows) {
      const id = newId();
      ids.push(id);
      await db.insert(schema.aiCalls).values({
        id,
        client_id: s.tenantId,
        endpoint: 'chat',
        status: 'ok',
        ...r,
      });
    }
  });

  afterAll(async () => {
    if (ids.length) await db.delete(schema.aiCalls).where(inArray(schema.aiCalls.id, ids));
  });

  test('model filter narrows to that model; rows carry the user name', async () => {
    const a = await logs(`model=${MODEL_A}`, cookie);
    expect(a.map((l) => l.id).sort()).toEqual([ids[0], ids[1]].sort());
    expect(a.find((l) => l.id === ids[0])?.userName).toBeTruthy();
    expect(a.find((l) => l.id === ids[1])?.userName).toBeNull();
  });

  test('q matches the user name or e-mail, case-insensitively', async () => {
    const hit = await logs(
      `model=${MODEL_A}&q=${encodeURIComponent(adminEmail.toUpperCase())}`,
      cookie,
    );
    expect(hit.map((l) => l.id)).toEqual([ids[0]]);
    expect(await logs(`model=${MODEL_A}&q=nobody-${run}`, cookie)).toEqual([]);
  });

  test('from/to are inclusive calendar days', async () => {
    const both = await logs(`from=2001-02-04&to=2001-02-05`, cookie);
    expect(both.map((l) => l.id).sort()).toEqual([ids[1], ids[2]].sort());
    const one = await logs(`from=2001-02-03&to=2001-02-03`, cookie);
    expect(one.map((l) => l.id)).toEqual([ids[0]]);
  });

  test('a malformed day is refused at the contract', async () => {
    expect((await call('/v1/m/ai/logs?from=03-02-2001', [cookie])).status).toBe(422);
  });

  test('the models facet lists the distinct models of the tenant', async () => {
    const r = await call('/v1/m/ai/logs/models', [cookie]);
    const models = ((await r.json()) as { data: string[] }).data;
    expect(models).toContain(MODEL_A);
    expect(models).toContain(MODEL_B);
    expect(models.filter((m) => m === MODEL_A)).toHaveLength(1);
  });
});

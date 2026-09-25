import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { hashPassword, runSeed } from '@core/auth';
import { type Db, eq, inArray, newId, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Integration (INTEGRATION=1): the call log's filters — user name/e-mail (`q`), model, and an
 * inclusive day range — plus the user name on each row and the distinct-models facet; and its
 * visibility: `ai.log.read` sees only the caller's own calls, `ai.log.manage` (admin) all of them.
 * Rows are planted directly, dated in 2001 with a run-unique model so leftovers never match.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.78.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `ai-logs-${run}@example.test`;
const adminPassword = 'an ai logs password';
const memberEmail = `ai-logs-member-${run}@example.test`;
const memberPassword = 'an ai logs member password';
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
const sessionOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
type Log = { id: string; model: string | null; userName: string | null; userId: string | null };
const logs = async (qs: string, cookie: string) => {
  const r = await call(`/v1/m/ai/logs?limit=100&${qs}`, [cookie]);
  expect(r.status).toBe(200);
  return ((await r.json()) as { data: Log[] }).data;
};

describe.skipIf(!enabled)('AI call log filters (H-9)', () => {
  let db: Db;
  let cookie = '';
  let member = '';
  let memberId = '';
  let groupId = '';
  const ids: string[] = [];
  const id = (n: number) => ids[n] ?? '';

  beforeAll(async () => {
    db = unsafeAcrossTenants();
    const s = await runSeed(db, { adminEmail, adminPassword });
    const login = await call('/v1/auth/login', [], {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    cookie = sessionOf(login);
    // A member of the tenant, created directly: self-service sign-up may be off here.
    memberId = newId();
    await db.insert(schema.users).values({
      id: memberId,
      email: memberEmail,
      name: 'Log Member',
      password_hash: await hashPassword(memberPassword),
    });
    await db.insert(schema.clientUserMaps).values({
      id: newId(),
      client_id: s.tenantId,
      user_id: memberId,
      is_default: true,
    });
    // A plain member that may open the log — `read` only, never `manage`.
    groupId = newId();
    await db.insert(schema.groups).values({
      id: groupId,
      client_id: s.tenantId,
      code: `ailog-${run}`,
      name: 'AI log readers',
    });
    await db.insert(schema.groupPermissions).values({
      id: newId(),
      client_id: s.tenantId,
      group_id: groupId,
      permission: 'ai.log.read',
    });
    await db
      .insert(schema.groupUserMaps)
      .values({ id: newId(), client_id: s.tenantId, group_id: groupId, user_id: memberId });
    member = sessionOf(
      await call('/v1/auth/login', [], {
        method: 'POST',
        body: JSON.stringify({ email: memberEmail, password: memberPassword }),
      }),
    );
    const [u] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail));
    // Noon UTC: the same calendar day on any tenant clock within ±11 h.
    const rows = [
      { model: MODEL_A, user_id: u?.id ?? null, created_at: new Date('2001-02-03T12:00:00Z') },
      { model: MODEL_A, user_id: null, created_at: new Date('2001-02-04T12:00:00Z') },
      { model: MODEL_B, user_id: u?.id ?? null, created_at: new Date('2001-02-05T12:00:00Z') },
      { model: MODEL_A, user_id: memberId, created_at: new Date('2001-02-06T12:00:00Z') },
    ];
    for (const r of rows) {
      const rowId = newId();
      ids.push(rowId);
      await db.insert(schema.aiCalls).values({
        id: rowId,
        client_id: s.tenantId,
        endpoint: 'chat',
        status: 'ok',
        ...r,
      });
    }
  });

  afterAll(async () => {
    if (ids.length) await db.delete(schema.aiCalls).where(inArray(schema.aiCalls.id, ids));
    if (groupId) {
      await db.delete(schema.groupUserMaps).where(eq(schema.groupUserMaps.group_id, groupId));
      await db.delete(schema.groupPermissions).where(eq(schema.groupPermissions.group_id, groupId));
      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    }
  });

  test('model filter narrows to that model; rows carry the user name', async () => {
    const a = await logs(`model=${MODEL_A}`, cookie);
    expect(a.map((l) => l.id).sort()).toEqual([id(0), id(1), id(3)].sort());
    expect(a.find((l) => l.id === id(0))?.userName).toBeTruthy();
    expect(a.find((l) => l.id === id(1))?.userName).toBeNull();
  });

  test('q matches the user name or e-mail, case-insensitively', async () => {
    const hit = await logs(
      `model=${MODEL_A}&q=${encodeURIComponent(adminEmail.toUpperCase())}`,
      cookie,
    );
    expect(hit.map((l) => l.id)).toEqual([id(0)]);
    expect(await logs(`model=${MODEL_A}&q=nobody-${run}`, cookie)).toEqual([]);
  });

  test('from/to are inclusive calendar days', async () => {
    const both = await logs(`from=2001-02-04&to=2001-02-05`, cookie);
    // id(3) (2001-02-06) is outside; the admin sees every user's rows.
    expect(both.map((l) => l.id).sort()).toEqual([id(1), id(2)].sort());
    const one = await logs(`from=2001-02-03&to=2001-02-03`, cookie);
    expect(one.map((l) => l.id)).toEqual([id(0)]);
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

  test('ai.log.read alone: only your own calls — in the log, the models facet, and analytics', async () => {
    const mine = await logs('from=2001-02-01&to=2001-02-28', member);
    expect(mine.map((l) => l.id)).toEqual([id(3)]);
    expect(mine[0]?.userId).toBe(memberId);
    // Searching for someone else cannot reach past the own-rows condition.
    expect(await logs(`q=${encodeURIComponent(adminEmail)}`, member)).toEqual([]);
    const facet = await call('/v1/m/ai/logs/models', [member]);
    const models = ((await facet.json()) as { data: string[] }).data;
    expect(models).toContain(MODEL_A);
    expect(models).not.toContain(MODEL_B);
    const an = await call('/v1/m/ai/analytics?days=365', [member]);
    expect(an.status).toBe(200);
    const byUser = ((await an.json()) as { data: { byUser: { userId: string | null }[] } }).data
      .byUser;
    expect(byUser.every((u) => u.userId === memberId)).toBe(true);
  });

  test('without ai.log.read the log is closed', async () => {
    await db.delete(schema.groupUserMaps).where(eq(schema.groupUserMaps.group_id, groupId));
    const again = sessionOf(
      await call('/v1/auth/login', [], {
        method: 'POST',
        body: JSON.stringify({ email: memberEmail, password: memberPassword }),
      }),
    );
    expect((await call('/v1/m/ai/logs', [again])).status).toBe(403);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { runSeed } from '@core/auth';
import { and, type Db, eq, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Integration (INTEGRATION=1): AI quota & balance (B-6, H-14). Token quotas per tenant and per
 * user (settings, UTC month, from ai_calls) and a prepaid balance charged with each call's cost;
 * an exhausted limit refuses with 429 + reason BEFORE the provider is called; top-ups are
 * ledgered and audited; no limits configured = nothing changes.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.91.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `ai-quota-admin-${run}@example.test`;
const adminPassword = 'an ai quota admin password';

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: Record<string, unknown> };
}
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chat = (cookies: string[], content = 'hi') =>
  call(
    '/v1/m/ai/chat/completions',
    { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content }] }) },
    cookies,
  );
const put = (cookies: string[], values: Record<string, unknown>, scope = 'tenant') =>
  call('/v1/configuration', { method: 'PUT', body: JSON.stringify({ scope, values }) }, cookies);
type Quota = {
  ok: boolean;
  reason: string | null;
  tenant: { used: number; limit: number };
  user: { used: number; limit: number };
  credit: { balanceMicro: number | null; spentMicro: number };
};
const quotaOf = async (cookies: string[]) =>
  (await json(await call('/v1/m/ai/quota', {}, cookies))).data as Quota;

describe.skipIf(!enabled)('AI quota & balance (B-6, H-14)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';
  let calls = 0;
  let mock: ReturnType<typeof Bun.serve>;
  const P = `quota-${run % 100000}`;

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
    admin = sessionCookie(
      await call('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }),
    );
    // Every call = 1000 in + 500 out tokens; priced 1 / 1 per Mtok → 0.0015 → 1500 micro.
    mock = Bun.serve({
      port: 0,
      fetch() {
        calls++;
        return Response.json({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        });
      },
    });
    await put([admin], { 'ai.enable': 'true' }, 'global');
    await resetLimits();
    const prov = await call(
      '/v1/m/ai/providers',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Quota mock',
          code: P,
          baseUrl: `http://127.0.0.1:${mock.port}/v1`,
          apiKey: 'k',
          defaultModel: 'm',
          models: [{ model: 'm', priceIn: 1, priceOut: 1 }],
        }),
      },
      [admin],
    );
    expect(prov.status).toBe(201);
    providerId = ((await json(prov)).data as { id: string }).id;
  });
  /** The seeded default tenant is shared with every other test file: leave no limit behind. */
  const resetLimits = async () => {
    await put([admin], { 'ai.quota_tokens_month': '0', 'ai.quota_tokens_user_month': '0' });
    await call(
      '/v1/m/ai/credit',
      { method: 'POST', body: JSON.stringify({ unlimited: true, note: 'reset uji' }) },
      [admin],
    );
  };
  let providerId = '';
  afterAll(async () => {
    if (enabled) {
      await resetLimits();
      if (providerId) await call(`/v1/m/ai/providers/${providerId}`, { method: 'DELETE' }, [admin]);
    }
    mock?.stop(true);
  });

  /** The call log (and thus usage) is written after the response: poll until it lands. */
  const waitUsage = async (min: number) => {
    for (let i = 0; i < 40; i++) {
      const [row] = await db
        .select()
        .from(schema.aiCalls)
        .where(and(eq(schema.aiCalls.client_id, tenantId), eq(schema.aiCalls.status, 'ok')));
      if (row) {
        const q = await quotaOf([admin]);
        if (q.tenant.used >= min || !q.tenant.limit) return q;
      }
      await sleep(50);
    }
    return quotaOf([admin]);
  };

  test('no limits configured: quota reports unlimited and calls pass', async () => {
    const q = await quotaOf([admin]);
    expect(q).toMatchObject({ ok: true, reason: null, credit: { balanceMicro: null } });
    expect(q.tenant.limit).toBe(0);
    expect((await chat([admin], `p:${P}`)).status).toBe(200);
    expect(calls).toBe(1);
  });

  test('tenant token quota: usage this month counts; the call past the limit is refused with 429 before the provider', async () => {
    // The seeded default tenant carries usage from earlier runs: set the limit relative to it.
    expect((await put([admin], { 'ai.quota_tokens_month': '1' })).status).toBe(200);
    const used0 = (await waitUsage(1500)).tenant.used; // includes this run's first 1500
    // One more call (1500 tokens) must pass the pre-check (used0 < limit) and then push usage over it.
    const limit = used0 + 1000;
    expect((await put([admin], { 'ai.quota_tokens_month': String(limit) })).status).toBe(200);
    const q1 = await quotaOf([admin]);
    expect(q1.tenant).toMatchObject({ limit });
    expect(q1.ok).toBe(true); // used0 < used0 + 1000
    const before = calls;
    expect((await chat([admin])).status).toBe(200); // still under, this one pushes usage past the limit
    expect(calls).toBe(before + 1);
    await waitUsage(used0 + 1500);
    const refused = await chat([admin]);
    expect(refused.status).toBe(429);
    const e = (await json(refused)).error;
    expect(e?.details?.reason).toBe('tenant_quota');
    expect(e?.message).toContain('Kuota token tenant');
    expect(calls).toBe(before + 1); // provider not called
    expect((await quotaOf([admin])).ok).toBe(false);
    await put([admin], { 'ai.quota_tokens_month': '0' });
    expect((await quotaOf([admin])).ok).toBe(true);
  });

  test('per-user token quota applies to the caller only and reads as user_quota', async () => {
    expect((await put([admin], { 'ai.quota_tokens_user_month': '100' })).status).toBe(200);
    const refused = await chat([admin]);
    expect(refused.status).toBe(429);
    expect((await json(refused)).error?.details?.reason).toBe('user_quota');
    const q = await quotaOf([admin]);
    expect(q.user.limit).toBe(100);
    expect(q.user.used).toBeGreaterThanOrEqual(3000);
    await put([admin], { 'ai.quota_tokens_user_month': '0' });
  });

  test('balance: top-ups are ledgered; each call charges its cost; ≤ 0 refuses as credit_exhausted; unlimited lifts it', async () => {
    // Needs ai.credit.manage — the seeded superadmin has everything.
    const top = await call(
      '/v1/m/ai/credit',
      { method: 'POST', body: JSON.stringify({ amount: 0.002, note: 'uji' }) },
      [admin],
    );
    expect(top.status).toBe(200);
    expect(((await json(top)).data as { balanceMicro: number }).balanceMicro).toBe(2000);
    const before = calls;
    expect((await chat([admin])).status).toBe(200); // costs 1500 micro
    // Charge is applied after the response: poll the balance.
    let bal = 2000;
    for (let i = 0; i < 40 && bal === 2000; i++) {
      await sleep(50);
      bal = (await quotaOf([admin])).credit.balanceMicro as number;
    }
    expect(bal).toBe(500);
    expect((await chat([admin])).status).toBe(200); // 500 > 0 still passes, then goes to -1000
    for (let i = 0; i < 40 && bal > 0; i++) {
      await sleep(50);
      bal = (await quotaOf([admin])).credit.balanceMicro as number;
    }
    expect(bal).toBe(-1000);
    const refused = await chat([admin]);
    expect(refused.status).toBe(429);
    expect((await json(refused)).error?.details?.reason).toBe('credit_exhausted');
    expect(calls).toBe(before + 2);
    const ledger = (await json(await call('/v1/m/ai/credit/ledger', {}, [admin]))).data as {
      amountMicro: number;
      note: string | null;
    }[];
    expect(ledger[0]).toMatchObject({ amountMicro: 2000, note: 'uji' });
    // Negative adjustment and removing the cap.
    expect(
      (
        await call(
          '/v1/m/ai/credit',
          { method: 'POST', body: JSON.stringify({ amount: -0.001 }) },
          [admin],
        )
      ).status,
    ).toBe(200);
    expect((await quotaOf([admin])).credit.balanceMicro).toBe(-2000);
    const lift = await call(
      '/v1/m/ai/credit',
      { method: 'POST', body: JSON.stringify({ unlimited: true }) },
      [admin],
    );
    expect(((await json(lift)).data as { balanceMicro: number | null }).balanceMicro).toBeNull();
    expect((await chat([admin])).status).toBe(200);
    // Spent keeps counting even without a cap.
    expect((await quotaOf([admin])).credit.spentMicro).toBeGreaterThanOrEqual(3000);
  });

  test('analytics carries the quota block; credit endpoints need ai.credit.manage', async () => {
    const a = (await json(await call('/v1/m/ai/analytics?days=7', {}, [admin]))).data as {
      quota: Quota;
    };
    expect(a.quota.credit.balanceMicro).toBeNull();
    expect((await call('/v1/m/ai/credit/ledger')).status).toBe(401);
  });
});

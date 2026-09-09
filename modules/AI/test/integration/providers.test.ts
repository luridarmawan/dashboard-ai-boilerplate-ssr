import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { runSeed } from '@core/auth';
import { and, type Db, desc, eq, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Integration (INTEGRATION=1): multi-provider (H-10) + analytics (H-15). Two in-process
 * OpenAI-compatible mocks stand in for two providers; the test proves profiles are tenant data
 * with masked keys, a conversation pins provider + model, the call log records the provider and a
 * cost computed from the model's price row, the picker only offers enabled profiles, the test
 * endpoint proves URL + key via GET /models, and analytics aggregates what was logged.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.83.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `ai-prov-admin-${run}@example.test`;
const adminPassword = 'an ai providers admin password';

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
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
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  pred: (v: T) => boolean,
  timeoutMs = 3000,
): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v && pred(v)) return v;
    if (Date.now() > until) return v ?? null;
    await sleep(50);
  }
}
/**
 * A tiny OpenAI-compatible provider: /models lists ids, /chat/completions echoes with fixed usage.
 * It is a CHAT-ONLY provider on purpose — `/responses` answers 404 — which is what makes it a
 * useful subject for the capability probe (AI-Roadmap §4.1).
 *
 * The pathname check is not decoration: the probe posts a Responses-shaped body (`input`, no
 * `messages`) to `/responses`, so a handler that treats every POST as a chat completion would
 * throw on `body.messages`, kill the connection, and fail every later request to this server.
 */
function mockProvider(
  key: string,
  models: string[],
  usage: { prompt: number; completion: number },
) {
  /** Chat completions only — the probe's own calls are not part of what a test asserts about. */
  const seen: { model: string | undefined }[] = [];
  const notFound = () =>
    new Response('{"error":{"message":"not found"}}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.get('authorization') !== `Bearer ${key}`)
        return new Response('{"error":{"message":"bad key"}}', { status: 401 });
      const url = new URL(req.url);
      if (url.pathname.endsWith('/models'))
        return Response.json({
          object: 'list',
          data: models.map((id) => ({ id, object: 'model' })),
        });
      if (!url.pathname.endsWith('/chat/completions')) return notFound();
      const body = (await req.json()) as {
        model?: string;
        messages?: { content: string }[];
        max_tokens?: number;
      };
      // The probe's own traffic must stay out of `seen`: it is a single 8-token "ping" turn, not
      // a chat a test asked for. (`tools` is no marker — real chat turns carry tools too.)
      const isProbe =
        body.max_tokens === 8 &&
        body.messages?.length === 1 &&
        body.messages[0]?.content === 'ping';
      if (!isProbe) seen.push({ model: body.model });
      return Response.json({
        model: body.model,
        choices: [
          { message: { role: 'assistant', content: `echo ${body.messages?.at(-1)?.content}` } },
        ],
        usage: {
          prompt_tokens: usage.prompt,
          completion_tokens: usage.completion,
          total_tokens: usage.prompt + usage.completion,
        },
      });
    },
  });
  return { server, seen, url: `http://127.0.0.1:${server.port}/v1` };
}
type ProviderView = {
  id: string;
  code: string;
  apiKeySet: boolean;
  isDefault: boolean;
  enabled: boolean;
  models: { model: string; priceIn: number; priceOut: number }[];
};

describe.skipIf(!enabled)('AI providers (H-10) + analytics (H-15)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';
  let alpha: ReturnType<typeof mockProvider>;
  let beta: ReturnType<typeof mockProvider>;
  let alphaId = '';
  let betaId = '';
  const A = `alpha-${run % 100000}`;
  const B = `beta-${run % 100000}`;

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
    alpha = mockProvider('alpha-key', ['a-small', 'a-large'], { prompt: 1000, completion: 500 });
    beta = mockProvider('beta-key', ['b-one'], { prompt: 2000, completion: 1000 });
    await call(
      '/v1/configuration',
      { method: 'PUT', body: JSON.stringify({ scope: 'global', values: { 'ai.enable': 'true' } }) },
      [admin],
    );
  });
  afterAll(() => {
    alpha?.server.stop(true);
    beta?.server.stop(true);
  });

  test('profiles are created with a priced model list; the first becomes default; the key never echoes', async () => {
    expect((await call('/v1/m/ai/providers/options', {}, [admin])).status).toBe(200);
    expect(
      ((await json(await call('/v1/m/ai/providers/options', {}, [admin]))).data as unknown[])
        .length,
    ).toBe(0);
    const r1 = await call(
      '/v1/m/ai/providers',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alpha',
          code: A,
          baseUrl: alpha.url,
          apiKey: 'alpha-key',
          defaultModel: 'a-small',
          models: [
            { model: 'a-small', label: 'Alpha small', priceIn: 0.5, priceOut: 1.5 },
            { model: 'a-large', priceIn: 5, priceOut: 15 },
          ],
        }),
      },
      [admin],
    );
    expect(r1.status).toBe(201);
    const p1 = (await json(r1)).data as ProviderView;
    alphaId = p1.id;
    expect(p1.isDefault).toBe(true);
    expect(p1.apiKeySet).toBe(true);
    expect(JSON.stringify(p1)).not.toContain('alpha-key');
    expect(p1.models.find((m) => m.model === 'a-small')?.priceOut).toBe(1.5);
    const r2 = await call(
      '/v1/m/ai/providers',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Beta',
          code: B,
          baseUrl: beta.url,
          apiKey: 'beta-key',
          defaultModel: 'b-one',
          models: [{ model: 'b-one', priceIn: 1, priceOut: 2 }],
        }),
      },
      [admin],
    );
    expect(r2.status).toBe(201);
    betaId = ((await json(r2)).data as ProviderView).id;
    // Duplicate code → 409; the default model is always present in the list even when omitted.
    expect(
      (
        await call(
          '/v1/m/ai/providers',
          {
            method: 'POST',
            body: JSON.stringify({ name: 'Dup', code: A, baseUrl: alpha.url, defaultModel: 'x' }),
          },
          [admin],
        )
      ).status,
    ).toBe(409);
    const opts = (await json(await call('/v1/m/ai/providers/options', {}, [admin]))).data as {
      code: string;
      isDefault: boolean;
      models: { model: string }[];
    }[];
    expect(opts.map((o) => o.code)).toEqual([A, B]); // default first
    expect(opts[0]?.models.map((m) => m.model)).toEqual(['a-large', 'a-small']);
  });

  test('test endpoint: the capability probe proves URL + key, lists ids and reports the matrix; a wrong key fails clearly', async () => {
    const ok = (
      await json(await call(`/v1/m/ai/providers/${alphaId}/test`, { method: 'POST' }, [admin]))
    ).data as {
      ok: boolean;
      models: string[];
      preferredEndpoint: string | null;
      recommended: boolean;
      capabilities: {
        endpoints: { responses: boolean; chatCompletions: boolean };
        tools: { supported: boolean };
      };
      steps: { step: string; status: string }[];
    };
    expect(ok.ok).toBe(true);
    expect(ok.models).toEqual(['a-large', 'a-small']);
    // This mock is chat-only, so the probe must say so — and must not recommend it (§3 no. 2).
    expect(ok.capabilities.endpoints).toEqual({ responses: false, chatCompletions: true });
    expect(ok.preferredEndpoint).toBe('chat_completions');
    expect(ok.recommended).toBe(false);
    expect(ok.capabilities.tools.supported).toBe(true);
    expect(ok.steps.find((s) => s.step === 'responses')?.status).toBe('unsupported');
    expect(ok.steps.find((s) => s.step === 'reasoning')?.status).toBe('skipped');
    await call(
      `/v1/m/ai/providers/${betaId}`,
      { method: 'PUT', body: JSON.stringify({ apiKey: 'wrong' }) },
      [admin],
    );
    const bad = (
      await json(await call(`/v1/m/ai/providers/${betaId}/test`, { method: 'POST' }, [admin]))
    ).data as {
      ok: boolean;
      error: string | null;
    };
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('401');
    // `***` keeps the (wrong) key; a real value replaces it.
    await call(
      `/v1/m/ai/providers/${betaId}`,
      { method: 'PUT', body: JSON.stringify({ apiKey: '***' }) },
      [admin],
    );
    expect(
      (
        (await json(await call(`/v1/m/ai/providers/${betaId}/test`, { method: 'POST' }, [admin])))
          .data as { ok: boolean }
      ).ok,
    ).toBe(false);
    await call(
      `/v1/m/ai/providers/${betaId}`,
      { method: 'PUT', body: JSON.stringify({ apiKey: 'beta-key' }) },
      [admin],
    );
    expect(
      (
        (await json(await call(`/v1/m/ai/providers/${betaId}/test`, { method: 'POST' }, [admin])))
          .data as { ok: boolean }
      ).ok,
    ).toBe(true);
    const list = (await json(await call('/v1/m/ai/providers', {}, [admin]))).data as {
      code: string;
      lastStatus: string;
    }[];
    expect(list.find((p) => p.code === B)?.lastStatus).toBe('ok');
  });

  test('a conversation pins provider + model; the call is routed there and logged with provider and priced cost', async () => {
    // Default (alpha, a-small): prices are per 1M tokens → 1000 × 0.5/1M + 500 × 1.5/1M = 0.00125 → 1250 micro
    const c1 = await call('/v1/m/ai/conversations', { method: 'POST', body: '{}' }, [admin]);
    expect(c1.status).toBe(201);
    const conv1 = (await json(c1)).data as { id: string; providerId: string | null };
    expect(conv1.providerId).toBeNull();
    const a1 = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hi' }],
          conversation_id: conv1.id,
        }),
      },
      [admin],
    );
    expect(a1.status).toBe(200);
    expect(alpha.seen.at(-1)?.model).toBe('a-small');
    const log1 = await waitFor(
      async () =>
        (
          await db
            .select()
            .from(schema.aiCalls)
            .where(
              and(
                eq(schema.aiCalls.client_id, tenantId),
                eq(schema.aiCalls.conversation_id, conv1.id),
              ),
            )
            .orderBy(desc(schema.aiCalls.created_at))
            .limit(1)
        )[0],
      (r) => r.status === 'ok',
    );
    expect(log1?.provider).toBe(A);
    expect(log1?.model).toBe('a-small');
    expect(log1?.cost_micro).toBe(1250);
    // Once used, the conversation is pinned to what answered it.
    const after1 = (await json(await call(`/v1/m/ai/conversations/${conv1.id}`, {}, [admin])))
      .data as {
      providerId: string | null;
      model: string | null;
    };
    expect(after1.providerId).toBe(alphaId);
    expect(after1.model).toBe('a-small');

    // Pinned to beta/b-one via POST body: 2000 × 1/1M + 1000 × 2/1M = 0.004 → 4000 micro
    const c2 = await call(
      '/v1/m/ai/conversations',
      { method: 'POST', body: JSON.stringify({ provider: B, model: 'b-one' }) },
      [admin],
    );
    expect(c2.status).toBe(201);
    const conv2 = (await json(c2)).data as { id: string; providerId: string };
    expect(conv2.providerId).toBe(betaId);
    const a2 = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'yo' }],
          conversation_id: conv2.id,
        }),
      },
      [admin],
    );
    expect(a2.status).toBe(200);
    expect(beta.seen.at(-1)?.model).toBe('b-one');
    const log2 = await waitFor(
      async () =>
        (
          await db
            .select()
            .from(schema.aiCalls)
            .where(
              and(
                eq(schema.aiCalls.client_id, tenantId),
                eq(schema.aiCalls.conversation_id, conv2.id),
              ),
            )
            .limit(1)
        )[0],
      (r) => r.status === 'ok',
    );
    expect(log2?.provider).toBe(B);
    expect(log2?.cost_micro).toBe(4000);

    // Switch the conversation to alpha/a-large via PATCH; the request may also name a provider directly.
    const patched = await call(
      `/v1/m/ai/conversations/${conv2.id}`,
      { method: 'PATCH', body: JSON.stringify({ provider: A, model: 'a-large' }) },
      [admin],
    );
    expect(patched.status).toBe(200);
    const a3 = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'again' }],
          conversation_id: conv2.id,
        }),
      },
      [admin],
    );
    expect(a3.status).toBe(200);
    expect(alpha.seen.at(-1)?.model).toBe('a-large');
    const direct = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], provider: B }),
      },
      [admin],
    );
    expect(direct.status).toBe(200);
    expect(beta.seen.at(-1)?.model).toBe('b-one');
    // Unknown provider code → 422 with a reason.
    const nope = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], provider: 'ghost' }),
      },
      [admin],
    );
    expect(nope.status).toBe(422);
    expect((await json(nope)).error?.details?.reason).toBe('provider_not_found');
  });

  test('disabled profiles leave the picker and cannot be chosen; no key → actionable 422 naming the profile', async () => {
    await call(
      `/v1/m/ai/providers/${betaId}`,
      { method: 'PUT', body: JSON.stringify({ enabled: false }) },
      [admin],
    );
    const opts = (await json(await call('/v1/m/ai/providers/options', {}, [admin]))).data as {
      code: string;
    }[];
    expect(opts.map((o) => o.code)).toEqual([A]);
    const c = await call(
      '/v1/m/ai/conversations',
      { method: 'POST', body: JSON.stringify({ provider: B }) },
      [admin],
    );
    expect(c.status).toBe(422);
    await call(
      `/v1/m/ai/providers/${betaId}`,
      { method: 'PUT', body: JSON.stringify({ enabled: true, apiKey: '' }) },
      [admin],
    );
    const noKey = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], provider: B }),
      },
      [admin],
    );
    expect(noKey.status).toBe(422);
    const e = (await json(noKey)).error;
    expect(e?.details?.reason).toBe('no_api_key');
    expect(e?.message).toContain(B);
  });

  test('H-15 analytics: totals, per day, per provider/model and per user reflect the logged calls', async () => {
    const r = await call('/v1/m/ai/analytics?days=7', {}, [admin]);
    expect(r.status).toBe(200);
    const s = (await json(r)).data as {
      days: number;
      totals: { calls: number; ok: number; tokensIn: number; costMicro: number };
      byDay: { day: string; calls: number }[];
      byModel: {
        provider: string | null;
        model: string | null;
        calls: number;
        costMicro: number;
      }[];
      byUser: { email: string | null; calls: number }[];
      truncated: boolean;
    };
    expect(s.days).toBe(7);
    expect(s.byDay.length).toBe(7);
    // This file made 4 ok calls: alpha/a-small, beta/b-one, alpha/a-large, beta/b-one (direct);
    // the refused ones (unknown code, no key) are never logged.
    const mine = s.byModel.filter((m) => m.provider === A || m.provider === B);
    expect(mine.reduce((n, m) => n + m.calls, 0)).toBe(4);
    expect(mine.find((m) => m.provider === A && m.model === 'a-small')?.costMicro).toBe(1250);
    expect(mine.find((m) => m.provider === B && m.model === 'b-one')?.calls).toBe(2);
    expect(s.totals.calls).toBeGreaterThanOrEqual(4);
    expect(s.byDay.at(-1)?.calls).toBeGreaterThanOrEqual(4);
    expect(s.byUser.some((u) => u.email === adminEmail && u.calls >= 4)).toBe(true);
    expect(s.truncated).toBe(false);
    // Another tenant sees nothing of this.
    const acme = crypto.randomUUID();
    await db
      .insert(schema.clients)
      .values({ id: acme, code: `acme-ai-${run}`.slice(0, 32), name: 'Acme' });
    const other = await call('/v1/m/ai/providers', {}, [admin]);
    expect(other.status).toBe(200);
    const headers = new Headers({ 'x-client-id': acme });
    const foreign = await call('/v1/m/ai/providers/options', { headers }, [admin]);
    // The superadmin may enter any tenant; there the profile list is empty.
    if (foreign.status === 200) expect(((await json(foreign)).data as unknown[]).length).toBe(0);
  });

  test('deleting a profile unpins its conversations and removes it from the picker', async () => {
    const del = await call(`/v1/m/ai/providers/${betaId}`, { method: 'DELETE' }, [admin]);
    expect(del.status).toBe(200);
    const opts = (await json(await call('/v1/m/ai/providers/options', {}, [admin]))).data as {
      code: string;
    }[];
    expect(opts.map((o) => o.code)).toEqual([A]);
    const pinned = await db
      .select()
      .from(schema.aiConversations)
      .where(
        and(
          eq(schema.aiConversations.client_id, tenantId),
          eq(schema.aiConversations.provider_id, betaId),
        ),
      );
    expect(pinned.length).toBe(0);
    await call(`/v1/m/ai/providers/${alphaId}`, { method: 'DELETE' }, [admin]);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { runSeed } from '@core/auth';
import { and, type Db, desc, eq, schema, unsafeAcrossTenants } from '@core/db';

/**
 * Integration (INTEGRATION=1): lives INSIDE the module so removing the module leaves no AI trace in
 * core (gate M5 #4). Runs against a mock OpenAI-compatible provider started in-process — M5 gates: streaming end to end with cancellation (#1), every call logged with tokens
 * and latency without holding the hot path (#2), disable per tenant (#3), plus H-4/H-5/H-6.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.79.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `ai-admin-${run}@example.test`;
const adminPassword = 'an ai admin password';

const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cookie', [`dab_csrf=${TOKEN}`, ...cookies].join('; '));
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) =>
  r.json() as Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; details?: unknown };
  }>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('dab_session='))
    ?.split(';')[0] ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!enabled)('AI module (H-2…H-9, gates M5 #1 #2 #3)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';
  let mock: ReturnType<typeof Bun.serve> | null = null;
  let mockAborted = 0;

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
    // In-process mock provider: streams 20 chunks, 25 ms apart; counts aborted requests.
    mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (!req.headers.get('authorization')?.includes('test-key'))
          return new Response('{"error":{"message":"bad key"}}', { status: 401 });
        const body = (await req.json()) as {
          stream?: boolean;
          messages: { role: string; content: string }[];
        };
        const hasSystem = body.messages.some((m) => m.role === 'system');
        const text = `${hasSystem ? 'SYS ' : ''}echo: ${body.messages.at(-1)?.content} with **md** and \`code\``;
        if (!body.stream)
          return Response.json({
            choices: [{ message: { role: 'assistant', content: text } }],
            usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
          });
        const enc = new TextEncoder();
        return new Response(
          new ReadableStream({
            async start(c) {
              const parts = text.split(' ');
              for (let i = 0; i < parts.length; i++) {
                if (req.signal.aborted) {
                  mockAborted++;
                  c.close();
                  return;
                }
                c.enqueue(
                  enc.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: `${parts[i]} ` } }] })}\n\n`,
                  ),
                );
                await sleep(25);
              }
              c.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: parts.length, total_tokens: 11 + parts.length } })}\n\ndata: [DONE]\n\n`,
                ),
              );
              c.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const put = (values: Record<string, unknown>) =>
      call(
        '/v1/configuration',
        { method: 'PUT', body: JSON.stringify({ scope: 'global', values }) },
        [admin],
      );
    expect(
      (
        await put({
          'ai.baseurl': `http://127.0.0.1:${mock.port}/v1`,
          'ai.key': 'test-key',
          'ai.enable': 'true',
          'ai.system_prompt': 'Be brief.',
        })
      ).status,
    ).toBe(200);
  });
  afterAll(() => mock?.stop(true));

  test('H-4: without an API key the answer is actionable, not generic', async () => {
    await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({ scope: 'global', values: { 'ai.key': '__clear__' } }),
      },
      [admin],
    );
    const res = await call(
      '/v1/m/ai/chat/completions',
      { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) },
      [admin],
    );
    expect(res.status).toBe(422);
    expect(
      (((await json(res)).error ?? {}) as { details?: { reason: string } }).details?.reason,
    ).toBe('no_api_key');
    await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({ scope: 'global', values: { 'ai.key': 'test-key' } }),
      },
      [admin],
    );
  });

  test('H-2/H-5/H-6: non-streaming completion, system prompt injected, persisted into a conversation', async () => {
    const conv = await json(await call('/v1/m/ai/conversations', { method: 'POST' }, [admin]));
    const id = String(conv.data?.id);
    const res = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'What is Gayo?' }],
          conversation_id: id,
        }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0]?.message.content.startsWith('SYS ')).toBe(true); // injected (H-5)
    await sleep(150); // the log write is asynchronous (H-9)
    const one = await json(await call(`/v1/m/ai/conversations/${id}`, {}, [admin]));
    const msgs = one.data?.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(one.data?.title).toBe('What is Gayo?'); // auto title from first message (H-6)
    const [log] = await db
      .select()
      .from(schema.aiCalls)
      .where(and(eq(schema.aiCalls.client_id, tenantId), eq(schema.aiCalls.conversation_id, id)))
      .orderBy(desc(schema.aiCalls.created_at))
      .limit(1);
    expect(log?.status).toBe('ok');
    expect(log?.tokens_in).toBe(11);
    expect(log?.tokens_out).toBe(7);
    expect((log?.latency_ms ?? -1) >= 0).toBe(true);
  });

  test('#1 streaming: SSE flows through token by token; #2 the call is logged with usage and first-token latency', async () => {
    const started = performance.now();
    const res = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'stream please' }],
          stream: true,
        }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let text = '';
    let firstChunkAt = 0;
    let chunks = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks++;
      if (!firstChunkAt) firstChunkAt = performance.now() - started;
      text += dec.decode(value, { stream: true });
    }
    expect(chunks).toBeGreaterThan(3); // not buffered into one blob
    expect(text).toContain('data: ');
    expect(text).toContain('[DONE]');
    expect(firstChunkAt).toBeLessThan(500); // first token reached us long before the stream ended
    await sleep(150);
    const [log] = await db
      .select()
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.client_id, tenantId))
      .orderBy(desc(schema.aiCalls.created_at))
      .limit(1);
    expect(log?.streamed).toBe(true);
    expect(log?.status).toBe('ok');
    expect(log?.tokens_out).toBeGreaterThan(0);
    expect((log?.first_token_ms ?? 9999) < (log?.latency_ms ?? 0)).toBe(true);
  });

  test('#1 cancellation: aborting the client request aborts the provider call and logs `cancelled`', async () => {
    const before = mockAborted;
    const ac = new AbortController();
    const headers = new Headers({
      origin: ORIGIN,
      cookie: `dab_csrf=${TOKEN}; ${admin}`,
      'x-csrf-token': TOKEN,
      'content-type': 'application/json',
      'x-forwarded-for': RUN_IP,
    });
    const res = await app.handle(
      new Request(`${ORIGIN}/v1/m/ai/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'a long long long long long long long long answer' }],
          stream: true,
        }),
        signal: ac.signal,
      }),
    );
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // one chunk arrived
    ac.abort();
    await reader.cancel().catch(() => undefined);
    await sleep(400);
    expect(mockAborted).toBeGreaterThan(before);
    const [log] = await db
      .select()
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.client_id, tenantId))
      .orderBy(desc(schema.aiCalls.created_at))
      .limit(1);
    expect(log?.status).toBe('cancelled');
  });

  test('#3 disabling the AI module for the tenant removes its routes and menu; ai.enable=false refuses too', async () => {
    expect((await call('/v1/m/ai/conversations', {}, [admin])).status).toBe(200);
    expect(
      (
        await call(
          '/v1/module/AI/enabled',
          { method: 'PUT', body: JSON.stringify({ enabled: false }) },
          [admin],
        )
      ).status,
    ).toBe(200);
    const blocked = await call('/v1/m/ai/conversations', {}, [admin]);
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).error?.code).toBe('module_disabled');
    const menu = await json(await call('/v1/menu', {}, [admin]));
    expect((menu.data as unknown as { id: string }[]).some((m) => m.id.startsWith('ai.'))).toBe(
      false,
    );
    expect(
      (
        await call(
          '/v1/module/AI/enabled',
          { method: 'PUT', body: JSON.stringify({ enabled: null }) },
          [admin],
        )
      ).status,
    ).toBe(200);
    expect((await call('/v1/m/ai/conversations', {}, [admin])).status).toBe(200);
    await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({ scope: 'global', values: { 'ai.enable': 'false' } }),
      },
      [admin],
    );
    const off = await call(
      '/v1/m/ai/chat/completions',
      { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) },
      [admin],
    );
    expect(off.status).toBe(403);
    expect(
      (((await json(off)).error ?? {}) as { details?: { reason: string } }).details?.reason,
    ).toBe('ai_disabled');
    await call(
      '/v1/configuration',
      { method: 'PUT', body: JSON.stringify({ scope: 'global', values: { 'ai.enable': 'true' } }) },
      [admin],
    );
  });
});

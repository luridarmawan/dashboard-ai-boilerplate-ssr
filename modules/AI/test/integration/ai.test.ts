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
/** The call log is written AFTER the response (H-9): poll for it instead of guessing a delay. */
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

describe.skipIf(!enabled)('AI module (H-2…H-9, gates M5 #1 #2 #3)', () => {
  let db: Db;
  let admin = '';
  let tenantId = '';
  let mock: ReturnType<typeof Bun.serve> | null = null;
  let mockAborted = 0;
  /** Wire names of the tools the last request offered to the "model" (null = no `tools` field). */
  let mockToolsSeen: string[] | null = null;
  let mockLastMessages: { role: string; content: string | null }[] = [];
  /** F2: which upstream endpoint the last call went to, and whether /responses exists at all. */
  let mockLastPath = '';
  let mockHasResponses = true;
  /** F2: the `input[]` of the last /responses call, so tests can inspect the translation. */
  let mockLastInput: { type?: string; role?: string; content?: unknown; call_id?: string }[] = [];

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
    /**
     * The same mock, speaking the MODERN endpoint (F2). It mirrors the chat behaviour — echo,
     * system prompt marker, PING tool round-trip — through Responses shapes, and its stream
     * deliberately emits `response.reasoning_summary_text.delta` BEFORE the answer: a real
     * provider does (§12 no. 2), and forwarding it would pour reasoning into the answer bubble.
     */
    const respondResponses = async (req: Request): Promise<Response> => {
      const body = (await req.json()) as {
        stream?: boolean;
        instructions?: string;
        input?: {
          type?: string;
          role?: string;
          content?: unknown;
          call_id?: string;
          output?: string;
        }[];
        tools?: { type: string; name: string }[];
      };
      const input = body.input ?? [];
      mockLastInput = input;
      mockToolsSeen = body.tools ? body.tools.map((t) => t.name) : null;
      const plain = (c: unknown): string =>
        typeof c === 'string'
          ? c
          : Array.isArray(c)
            ? c.map((x) => (x as { text?: string }).text ?? '').join('')
            : '';
      const lastUser = [...input].reverse().find((i) => i.type === 'message' && i.role === 'user');
      const fnOut = input.find((i) => i.type === 'function_call_output');
      const usage = {
        input_tokens: 11,
        output_tokens: 7,
        output_tokens_details: { reasoning_tokens: 3, text_tokens: 7 },
      };
      if (body.tools && plain(lastUser?.content).includes('PING') && !fnOut) {
        const call = {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'dummy_ping',
          arguments: JSON.stringify({ message: 'from-model' }),
        };
        if (!body.stream)
          return Response.json({ id: 'resp_1', output: [call], output_text: '', usage });
        return new Response(
          `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_1', error: null } })}\n\n` +
            `data: ${JSON.stringify({ type: 'response.output_item.done', item: call })}\n\n` +
            `data: ${JSON.stringify({ type: 'response.completed', response: { usage } })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      const text = fnOut
        ? `TOOL SAID ${fnOut.output}`
        : `${body.instructions ? 'SYS ' : ''}echo: ${plain(lastUser?.content)} with **md** and \`code\``;
      if (!body.stream)
        return Response.json({
          id: 'resp_1',
          output: [
            { type: 'reasoning', id: 'rs_1', summary: [] },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text }],
            },
          ],
          output_text: text,
          usage,
        });
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream({
          async start(c) {
            const f = (o: unknown) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
            f({ type: 'response.created', response: { id: 'resp_1', error: null } });
            // The poison: if this reaches the client, the assembled answer is wrong.
            f({ type: 'response.reasoning_summary_text.delta', delta: 'JANGAN-TAMPIL ' });
            for (const word of text.split(' ')) {
              if (req.signal.aborted) {
                mockAborted++;
                c.close();
                return;
              }
              f({ type: 'response.output_text.delta', item_id: 'm1', delta: `${word} ` });
              await sleep(25);
            }
            f({ type: 'response.output_text.done', item_id: 'm1', text });
            f({ type: 'response.completed', response: { usage } });
            c.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    };
    // In-process mock provider: streams 20 chunks, 25 ms apart; counts aborted requests.
    mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (!req.headers.get('authorization')?.includes('test-key'))
          return new Response('{"error":{"message":"bad key"}}', { status: 401 });
        // The pathname check matters: the probe and the F2 chat path post a Responses-shaped body
        // (`input`, no `messages`). A handler that treats every POST as a chat completion throws
        // on `body.messages`, kills the connection, and fails everything after it.
        const path = new URL(req.url).pathname;
        mockLastPath = path;
        const notFound = () =>
          new Response('{"error":{"message":"not found"}}', {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        if (path.endsWith('/models'))
          return Response.json({ object: 'list', data: [{ id: 'mock-1', object: 'model' }] });
        if (path.endsWith('/responses')) {
          if (!mockHasResponses) return notFound();
          return respondResponses(req);
        }
        if (!path.endsWith('/chat/completions')) return notFound();
        const body = (await req.json()) as {
          stream?: boolean;
          messages: { role: string; content: string | null; tool_call_id?: string }[];
          tools?: { type: string; function: { name: string; parameters: unknown } }[];
        };
        const hasSystem = body.messages.some((m) => m.role === 'system');
        mockLastMessages = body.messages;
        // ---- tool round-trip (I-3): offered tools must carry OpenAI-legal names; a user turn
        // containing PING makes the "model" call dummy_ping first, then answer from its result.
        mockToolsSeen = body.tools ? body.tools.map((t) => t.function.name) : null;
        for (const t of body.tools ?? [])
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.function.name))
            return new Response(`{"error":{"message":"bad tool name ${t.function.name}"}}`, {
              status: 400,
            });
        const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
        const toolMsg = body.messages.find((m) => m.role === 'tool');
        if (body.tools && lastUser?.content?.includes('PING') && !toolMsg) {
          const args = JSON.stringify({ message: 'from-model' });
          if (!body.stream)
            return Response.json({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'dummy_ping', arguments: args },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
            });
          const f = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
          // The arguments arrive split across two deltas, as real providers do.
          const sse =
            f({
              choices: [
                {
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'dummy_ping', arguments: args.slice(0, 8) },
                      },
                    ],
                  },
                },
              ],
            }) +
            f({
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(8) } }] } },
              ],
            }) +
            f({
              choices: [{ delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
            }) +
            'data: [DONE]\n\n';
          return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
        }
        const text = toolMsg
          ? `TOOL SAID ${toolMsg.content}`
          : `${hasSystem ? 'SYS ' : ''}echo: ${body.messages.at(-1)?.content} with **md** and \`code\``;
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
    // Quota/balance (H-14) live on the shared default tenant: make sure nothing from another test
    // file (or an aborted run) limits this one.
    await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({
          scope: 'tenant',
          values: { 'ai.quota_tokens_month': '0', 'ai.quota_tokens_user_month': '0' },
        }),
      },
      [admin],
    );
    await call(
      '/v1/m/ai/credit',
      { method: 'POST', body: JSON.stringify({ unlimited: true, note: 'reset uji' }) },
      [admin],
    );
    // Provider profiles (H-10) take precedence over the ai.* settings this file relies on: remove
    // any left on the shared tenant by other files or aborted runs.
    const profiles = (await json(await call('/v1/m/ai/providers', {}, [admin]))).data as unknown as
      | { id: string }[]
      | undefined;
    for (const p of profiles ?? [])
      await call(`/v1/m/ai/providers/${p.id}`, { method: 'DELETE' }, [admin]);
    expect(
      (
        await put({
          'ai.baseurl': `http://127.0.0.1:${mock.port}/v1`,
          'ai.key': 'test-key',
          'ai.enable': 'true',
          'ai.system_prompt': 'Be brief.',
          // Pin the classic endpoint: everything below this line was written against
          // /chat/completions and must keep proving THAT path. The Responses path has its own
          // cases at the end of the file, which flip this setting.
          'ai.preferred_endpoint': 'chat_completions',
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
    const one = await json(await call(`/v1/m/ai/conversations/${id}`, {}, [admin]));
    const msgs = one.data?.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(one.data?.title).toBe('What is Gayo?'); // auto title from first message (H-6)
    const log = await waitFor(
      async () =>
        (
          await db
            .select()
            .from(schema.aiCalls)
            .where(
              and(eq(schema.aiCalls.client_id, tenantId), eq(schema.aiCalls.conversation_id, id)),
            )
            .orderBy(desc(schema.aiCalls.created_at))
            .limit(1)
        )[0],
      (l) => l.status === 'ok',
    );
    expect(log?.status).toBe('ok');
    expect(log?.tokens_in).toBe(11);
    expect(log?.tokens_out).toBe(7);
    expect((log?.latency_ms ?? -1) >= 0).toBe(true);
  });

  test('H-13: `context` reaches the provider as a second system message behind the tenant prompt and is never persisted', async () => {
    const conv = await json(await call('/v1/m/ai/conversations', { method: 'POST' }, [admin]));
    const id = String(conv.data?.id);
    const res = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Apa isi halaman ini?' }],
          conversation_id: id,
          context: 'Halaman: Pengguna › Detail\nURL path: /users/abc',
        }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    const roles = mockLastMessages.map((m) => m.role);
    expect(roles).toEqual(['system', 'system', 'user']);
    expect(mockLastMessages[1]?.content).toContain('/users/abc');
    expect(mockLastMessages[1]?.content).toContain('Konteks halaman');
    const one = await json(await call(`/v1/m/ai/conversations/${id}`, {}, [admin]));
    const msgs = one.data?.messages as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(msgs)).not.toContain('/users/abc');
    // Over the cap → 422 at the contract, before any provider call.
    expect(
      (
        await call(
          '/v1/m/ai/chat/completions',
          {
            method: 'POST',
            body: JSON.stringify({
              messages: [{ role: 'user', content: 'x' }],
              context: 'y'.repeat(4001),
            }),
          },
          [admin],
        )
      ).status,
    ).toBe(422);
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
    const log = await waitFor(
      async () =>
        (
          await db
            .select()
            .from(schema.aiCalls)
            .where(eq(schema.aiCalls.client_id, tenantId))
            .orderBy(desc(schema.aiCalls.created_at))
            .limit(1)
        )[0],
      (l) => l.streamed && l.status === 'ok',
    );
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
    const log = await waitFor(
      async () =>
        (
          await db
            .select()
            .from(schema.aiCalls)
            .where(eq(schema.aiCalls.client_id, tenantId))
            .orderBy(desc(schema.aiCalls.created_at))
            .limit(1)
        )[0],
      (l) => l.status === 'cancelled',
    );
    expect(mockAborted).toBeGreaterThan(before);
    expect(log?.status).toBe('cancelled');
  });

  test('I-3 tools, non-streaming: the model calls dummy_ping, the registry runs it, the answer uses the result', async () => {
    const res = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'PING the tool please' }] }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      x_tools: { name: string; ok: boolean; ms: number }[];
    };
    // Every tool the superadmin may use was offered, under its wire name (no dots).
    expect(mockToolsSeen).toEqual(
      expect.arrayContaining(['dummy_ping', 'dummy_count_notes', 'example_list_products']),
    );
    expect(body.choices[0]?.message.content.startsWith('TOOL SAID ')).toBe(true);
    expect(body.choices[0]?.message.content).toContain('"pong":"from-model"');
    expect(body.choices[0]?.message.content).toContain(tenantId); // ran in the caller's tenant
    expect(body.x_tools.map((t) => [t.name, t.ok])).toEqual([['dummy.ping', true]]);
  });

  test('I-3 tools, streaming: tool-call deltas stay server-side, dab.tool frames show progress, one [DONE]', async () => {
    const res = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'PING via stream' }],
          stream: true,
        }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const raw = await res.text();
    const frames = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim());
    expect(frames.filter((f) => f === '[DONE]')).toHaveLength(1);
    expect(frames.at(-1)).toBe('[DONE]');
    expect(raw).not.toContain('tool_calls'); // the model's tool request never reaches the browser
    const parsed = frames.filter((f) => f !== '[DONE]').map((f) => JSON.parse(f));
    const toolFrames = parsed
      .map((f) => (f as { dab?: { tool?: { name: string; status: string } } }).dab?.tool)
      .filter((x): x is { name: string; status: string } => !!x);
    expect(toolFrames.map((t) => [t.name, t.status])).toEqual([
      ['dummy.ping', 'running'],
      ['dummy.ping', 'ok'],
    ]);
    const content = parsed
      .map(
        (f) =>
          (f as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ??
          '',
      )
      .join('');
    expect(content).toContain('TOOL SAID');
    expect(content).toContain('"pong":"from-model"');
  });

  test('I-3 tools: `tools: false` on the request (or ai.tools_enable=false) offers nothing to the model', async () => {
    mockToolsSeen = ['sentinel'];
    const res = await call(
      '/v1/m/ai/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'PING but no tools' }],
          tools: false,
        }),
      },
      [admin],
    );
    expect(res.status).toBe(200);
    expect(mockToolsSeen).toBeNull();
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0]?.message.content).toContain('echo: PING but no tools');

    await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({ scope: 'global', values: { 'ai.tools_enable': 'false' } }),
      },
      [admin],
    );
    try {
      mockToolsSeen = ['sentinel'];
      await call(
        '/v1/m/ai/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({ messages: [{ role: 'user', content: 'PING again' }] }),
        },
        [admin],
      );
      expect(mockToolsSeen).toBeNull();
    } finally {
      await call(
        '/v1/configuration',
        {
          method: 'PUT',
          body: JSON.stringify({ scope: 'global', values: { 'ai.tools_enable': 'true' } }),
        },
        [admin],
      );
    }
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

  // ---- F2: the same chat over the modern endpoint (AI-Roadmap §5.2, §12) ----
  describe('dual endpoint (F2)', () => {
    const setEndpoint = async (v: string) => {
      const r = await call(
        '/v1/configuration',
        {
          method: 'PUT',
          body: JSON.stringify({ scope: 'global', values: { 'ai.preferred_endpoint': v } }),
        },
        [admin],
      );
      expect(r.status).toBe(200);
      return r;
    };
    /**
     * The newest ok call log. `logCall` inserts in a microtask, so waiting for "any ok row" would
     * happily return the PREVIOUS test's row: the predicate has to name the endpoint expected.
     */
    const lastCall = (upstream: string) =>
      waitFor(
        async () =>
          (
            await db
              .select()
              .from(schema.aiCalls)
              .where(eq(schema.aiCalls.client_id, tenantId))
              .orderBy(desc(schema.aiCalls.created_at))
              .limit(1)
          )[0],
        (l) => l.status === 'ok' && l.upstream_endpoint === upstream,
      );

    beforeAll(async () => {
      mockHasResponses = true;
      await setEndpoint('responses');
    });
    afterAll(async () => {
      mockHasResponses = true;
      await setEndpoint('chat_completions');
    });

    test('non-stream: the turn goes to /responses and comes back chat-shaped', async () => {
      mockLastPath = '';
      const res = await call(
        '/v1/m/ai/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({ messages: [{ role: 'user', content: 'halo responses' }] }),
        },
        [admin],
      );
      expect(res.status).toBe(200);
      expect(mockLastPath).toBe('/v1/responses');
      const j = (await json(res)) as {
        choices?: { message?: { content?: string } }[];
        usage?: { completion_tokens?: number };
      };
      // The client contract does not change with the endpoint.
      expect(j.choices?.[0]?.message?.content).toContain('echo: halo responses');
      // The system prompt travelled as `instructions`, not as a message.
      expect(j.choices?.[0]?.message?.content).toContain('SYS ');
      expect(mockLastInput.some((i) => i.role === 'system')).toBe(false);
      // §5.1a: the mock reports text_tokens == output_tokens, so reasoning is added on top.
      expect(j.usage?.completion_tokens).toBe(10);
      const log = await lastCall('responses');
      expect(log?.upstream_endpoint).toBe('responses');
      expect(log?.reasoning_tokens).toBe(3);
      expect(log?.tokens_out).toBe(10);
    });

    test('stream: the answer assembles, and the reasoning summary never reaches the client', async () => {
      mockLastPath = '';
      const res = await call(
        '/v1/m/ai/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'stream responses' }],
            stream: true,
          }),
        },
        [admin],
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      let raw = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
      }
      // Reassemble the way the browser does: chat-shaped deltas, whatever served them.
      let assembled = '';
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        const frame = JSON.parse(line.slice(6)) as {
          choices?: { delta?: { content?: string } }[];
        };
        assembled += frame.choices?.[0]?.delta?.content ?? '';
      }
      expect(assembled).toContain('echo: stream responses');
      // The regression this exists for (§12 no. 2).
      expect(assembled).not.toContain('JANGAN-TAMPIL');
      expect(raw).not.toContain('reasoning_summary');
      expect(raw).toContain('[DONE]');
      const log = await waitFor(
        async () =>
          (
            await db
              .select()
              .from(schema.aiCalls)
              .where(eq(schema.aiCalls.client_id, tenantId))
              .orderBy(desc(schema.aiCalls.created_at))
              .limit(1)
          )[0],
        (l) => l.streamed && l.status === 'ok',
      );
      expect(log?.upstream_endpoint).toBe('responses');
      expect(log?.reasoning_tokens).toBe(3);
    });

    test('tool round-trip over /responses: function_call out, function_call_output back', async () => {
      mockLastPath = '';
      const res = await call(
        '/v1/m/ai/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify({ messages: [{ role: 'user', content: 'PING lewat responses' }] }),
        },
        [admin],
      );
      expect(res.status).toBe(200);
      const j = (await json(res)) as {
        choices?: { message?: { content?: string } }[];
        x_tools?: { name: string; ok: boolean }[];
      };
      expect(j.choices?.[0]?.message?.content).toContain('TOOL SAID');
      expect(j.x_tools?.[0]?.ok).toBe(true);
      // The second round carried the Responses tool items, not a `tool` role.
      expect(mockLastInput.some((i) => i.type === 'function_call')).toBe(true);
      const out = mockLastInput.find((i) => i.type === 'function_call_output');
      expect(out?.call_id).toBe('call_1');
      expect(mockLastInput.some((i) => i.role === 'tool')).toBe(false);
    });

    test('a provider without /responses falls back to /chat/completions instead of failing', async () => {
      mockHasResponses = false;
      mockLastPath = '';
      try {
        const res = await call(
          '/v1/m/ai/chat/completions',
          {
            method: 'POST',
            body: JSON.stringify({ messages: [{ role: 'user', content: 'tanpa responses' }] }),
          },
          [admin],
        );
        expect(res.status).toBe(200);
        const j = (await json(res)) as { choices?: { message?: { content?: string } }[] };
        expect(j.choices?.[0]?.message?.content).toContain('echo: tanpa responses');
        expect(mockLastPath).toBe('/v1/chat/completions');
        const log = await lastCall('chat_completions');
        expect(log?.upstream_endpoint).toBe('chat_completions');
      } finally {
        mockHasResponses = true;
      }
    });
  });
});

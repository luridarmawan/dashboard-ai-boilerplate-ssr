import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from '@app/api/app';
import { runSeed } from '@core/auth';
import { type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Integration (INTEGRATION=1): the AI module as an MCP CLIENT (I-4, I-5) against a real database
 * and a real in-process MCP server. What is proven:
 *   - registering a server, testing it (tools discovered and stored), masked headers;
 *   - discovered tools appear in the core registry as `ext.<code>__<tool>` for callers with
 *     `ai.mcp.use` only, and only in the tenant that registered the server;
 *   - calling one proxies to the remote server with the stored (secret) headers;
 *   - the AI chat loop can call an external tool like a module tool;
 *   - disabling or deleting the server removes its tools.
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.75.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `mcpc-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `mcpc-member-${run}@example.test`;
const memberPassword = 'a regular member password';
const CODE = `remote-${run % 100000}`;

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; details?: Record<string, unknown> };
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
const toolNames = async (cookies: string[], extra: Record<string, string> = {}) =>
  (((await json(await call('/v1/tools', {}, cookies, extra))).data ?? []) as { name: string }[])
    .map((t) => t.name)
    .sort();

/** A real MCP server (official SDK, stateless Streamable HTTP) that demands an API key header. */
function startRemote(): {
  server: ReturnType<typeof Bun.serve>;
  calls: { name: string; args: unknown }[];
} {
  const calls: { name: string; args: unknown }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.get('x-api-key') !== 'remote-secret')
        return new Response('{"error":"missing key"}', { status: 401 });
      const mcp = new Server(
        { name: 'remote-test', version: '0.0.0' },
        { capabilities: { tools: {} } },
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'echo',
            description: 'Echo the text back, uppercased',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
          {
            name: 'weird name/v2',
            description: 'Has characters OpenAI forbids in tool names',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async (r) => {
        calls.push({ name: r.params.name, args: r.params.arguments });
        if (r.params.name === 'echo') {
          const text = String((r.params.arguments as { text?: unknown })?.text ?? '');
          return {
            content: [{ type: 'text', text: `ECHO ${text.toUpperCase()}` }],
            structuredContent: { echoed: text.toUpperCase() },
          };
        }
        return { content: [{ type: 'text', text: 'weird ok' }] };
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await mcp.connect(transport);
      try {
        return await transport.handleRequest(req);
      } finally {
        void transport.close();
      }
    },
  });
  return { server, calls };
}

describe.skipIf(!enabled)('AI module as MCP client (I-4, I-5)', () => {
  let db: Db;
  let acmeId = '';
  let admin = '';
  let member = '';
  let remote: ReturnType<typeof startRemote> | null = null;
  let provider: ReturnType<typeof Bun.serve> | null = null;
  let mcpId = '';
  let providerToolsSeen: string[] | null = null;

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    await runSeed(db, { adminEmail, adminPassword });
    admin = sessionCookie(
      await post('/v1/auth/login', { email: adminEmail, password: adminPassword }),
    );
    const reg = await post('/v1/auth/register', {
      email: memberEmail,
      password: memberPassword,
      name: 'Member',
    });
    expect(reg.status).toBe(201);
    member = sessionCookie(reg);
    acmeId = newId();
    await db
      .insert(schema.clients)
      .values({ id: acmeId, code: `acme-c-${run}`.slice(0, 32), name: 'Acme' });
    remote = startRemote();
    // OpenAI-compatible provider mock: when offered an ext_* tool and asked to REMOTE, call it.
    provider = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          messages: { role: string; content: string | null }[];
          tools?: { function: { name: string } }[];
        };
        providerToolsSeen = body.tools?.map((t) => t.function.name) ?? null;
        const ext = body.tools?.find((t) => t.function.name.startsWith(`ext_${CODE}__echo`));
        const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
        const toolMsg = body.messages.find((m) => m.role === 'tool');
        if (ext && lastUser?.content?.includes('REMOTE') && !toolMsg)
          return Response.json({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'c1',
                      type: 'function',
                      function: {
                        name: ext.function.name,
                        arguments: JSON.stringify({ text: 'hello' }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          });
        return Response.json({
          choices: [
            {
              message: {
                role: 'assistant',
                content: toolMsg ? `TOOL SAID ${toolMsg.content}` : 'plain',
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        });
      },
    });
    const cfg = await call(
      '/v1/configuration',
      {
        method: 'PUT',
        body: JSON.stringify({
          scope: 'global',
          values: {
            'ai.baseurl': `http://127.0.0.1:${provider.port}/v1`,
            'ai.key': 'test-key',
            'ai.enable': 'true',
            'ai.tools_enable': 'true',
          },
        }),
      },
      [admin],
    );
    expect(cfg.status).toBe(200);
  });
  afterAll(() => {
    remote?.server.stop(true);
    provider?.stop(true);
  });

  test('register a server: secrets masked in every view; member without ai.mcp.read is refused', async () => {
    expect((await call('/v1/m/ai/mcps', {}, [member])).status).toBe(403);
    const created = await post(
      '/v1/m/ai/mcps',
      {
        name: 'Remote test',
        code: CODE,
        transport: 'http',
        url: `http://127.0.0.1:${remote?.server.port}/mcp`,
        headers: { 'x-api-key': 'remote-secret' },
      },
      [admin],
    );
    expect(created.status).toBe(201);
    const c = (await json(created)).data as {
      id: string;
      headers: Record<string, string>;
      toolsCount: number;
      lastStatus: string | null;
    };
    mcpId = c.id;
    expect(c.headers).toEqual({ 'x-api-key': '***' });
    expect(c.toolsCount).toBe(0);
    expect(c.lastStatus).toBeNull();
    // Duplicate code in the same tenant → 409; same code in another tenant is fine (tenant data).
    expect(
      (
        await post(
          '/v1/m/ai/mcps',
          { name: 'dup', code: CODE, transport: 'http', url: 'http://x.test/mcp' },
          [admin],
        )
      ).status,
    ).toBe(409);
    const elsewhere = await post(
      '/v1/m/ai/mcps',
      { name: 'acme', code: CODE, transport: 'http', url: 'http://x.test/mcp' },
      [admin],
      { 'x-client-id': acmeId },
    );
    expect(elsewhere.status).toBe(201);
    const list = (await json(await call('/v1/m/ai/mcps', {}, [admin]))).data as { id: string }[];
    expect(list.map((m) => m.id)).toEqual([mcpId]); // Acme's registration is not in the default tenant
  });

  test('test: connects with the stored header, stores the discovered tools with wire-safe names, records status', async () => {
    const r = await json(await post(`/v1/m/ai/mcps/${mcpId}/test`, {}, [admin]));
    const d = r.data as {
      ok: boolean;
      error: string | null;
      tools: { name: string; wire: string; wireName: string }[];
    };
    expect(d.ok).toBe(true);
    expect(d.tools.map((t) => t.name).sort()).toEqual(['echo', 'weird name/v2']);
    expect(d.tools.find((t) => t.name === 'weird name/v2')?.wireName).toBe(
      `ext_${CODE}__weird_name_v2`,
    );
    const one = (await json(await call(`/v1/m/ai/mcps/${mcpId}`, {}, [admin]))).data as {
      lastStatus: string;
      toolsCount: number;
      tools: unknown[];
    };
    expect(one.lastStatus).toBe('ok');
    expect(one.toolsCount).toBe(2);
    expect(one.tools).toHaveLength(2);

    // A wrong header → status error, tools kept from the last good sync.
    await call(
      `/v1/m/ai/mcps/${mcpId}`,
      { method: 'PUT', body: JSON.stringify({ headers: { 'x-api-key': 'wrong' } }) },
      [admin],
    );
    const bad = (await json(await post(`/v1/m/ai/mcps/${mcpId}/test`, {}, [admin]))).data as {
      ok: boolean;
      error: string | null;
    };
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
    // `***` keeps the stored value: restore the good secret without retyping it… by retyping it here,
    // then prove `***` is a no-op on the next update.
    await call(
      `/v1/m/ai/mcps/${mcpId}`,
      { method: 'PUT', body: JSON.stringify({ headers: { 'x-api-key': 'remote-secret' } }) },
      [admin],
    );
    await call(
      `/v1/m/ai/mcps/${mcpId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ headers: { 'x-api-key': '***' }, name: 'Remote test (renamed)' }),
      },
      [admin],
    );
    const again = (await json(await post(`/v1/m/ai/mcps/${mcpId}/test`, {}, [admin]))).data as {
      ok: boolean;
    };
    expect(again.ok).toBe(true);
  });

  test('external tools enter the core registry for `ai.mcp.use` holders, in the owning tenant only; calls proxy with the secret', async () => {
    const forAdmin = await toolNames([admin]);
    expect(forAdmin).toContain(`ext.${CODE}__echo`);
    expect(forAdmin).toContain(`ext.${CODE}__weird_name_v2`);
    expect(await toolNames([member])).not.toContain(`ext.${CODE}__echo`); // no ai.mcp.use
    expect(await toolNames([admin], { 'x-client-id': acmeId })).not.toContain(`ext.${CODE}__echo`); // Acme never synced

    const res = await json(
      await post('/v1/tools/call', { name: `ext_${CODE}__echo`, input: { text: 'hi' } }, [admin]),
    );
    expect(res.success).toBe(true);
    expect((res.data as { result: { echoed: string } }).result).toEqual({ echoed: 'HI' });
    expect(remote?.calls.at(-1)).toEqual({ name: 'echo', args: { text: 'hi' } });

    const denied = await post(
      '/v1/tools/call',
      { name: `ext_${CODE}__echo`, input: { text: 'hi' } },
      [member],
    );
    expect(denied.status).toBe(403);
    expect((await json(denied)).error?.details?.reason).toBe('forbidden');
  });

  test('the AI chat loop calls an external tool exactly like a module tool', async () => {
    const res = await post(
      '/v1/m/ai/chat/completions',
      { messages: [{ role: 'user', content: 'please REMOTE echo' }] },
      [admin],
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
      x_tools: { name: string; ok: boolean; ms: number }[];
    };
    expect(providerToolsSeen).toContain(`ext_${CODE}__echo`);
    expect(body.x_tools).toEqual([{ name: `ext.${CODE}__echo`, ok: true, ms: expect.any(Number) }]);
    expect(body.choices[0]?.message.content).toContain('TOOL SAID');
    expect(body.choices[0]?.message.content).toContain('HELLO');
  });

  test('disabling hides the tools; deleting forgets them', async () => {
    await call(
      `/v1/m/ai/mcps/${mcpId}`,
      { method: 'PUT', body: JSON.stringify({ enabled: false }) },
      [admin],
    );
    expect(await toolNames([admin])).not.toContain(`ext.${CODE}__echo`);
    const gone = await post('/v1/tools/call', { name: `ext_${CODE}__echo`, input: { text: 'x' } }, [
      admin,
    ]);
    expect(gone.status).toBe(404);
    await call(
      `/v1/m/ai/mcps/${mcpId}`,
      { method: 'PUT', body: JSON.stringify({ enabled: true }) },
      [admin],
    );
    expect(await toolNames([admin])).toContain(`ext.${CODE}__echo`);

    expect((await call(`/v1/m/ai/mcps/${mcpId}`, { method: 'DELETE' }, [admin])).status).toBe(200);
    expect((await call(`/v1/m/ai/mcps/${mcpId}`, {}, [admin])).status).toBe(404);
    expect(await toolNames([admin])).not.toContain(`ext.${CODE}__echo`);
    const rows = await db
      .select()
      .from(schema.aiMcpTools)
      .where(eq(schema.aiMcpTools.mcp_id, mcpId));
    expect(rows).toHaveLength(0);
  });
});

import { beforeAll, describe, expect, test } from 'bun:test';
import { runSeed } from '@core/auth';
import { and, type Db, eq, newId, schema, unsafeAcrossTenants } from '@core/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { app } from '../../src/app.ts';

/**
 * Integration (INTEGRATION=1): API tokens (A-4) and the MCP server (FR-I) against a real database.
 * I-6 is the point: the MCP endpoint is not a back door —
 *   - no bearer / session → 401; expired or revoked token → 401;
 *   - a token acts as its user in ONE tenant, and its scopes only narrow permissions;
 *   - tools/list shows what the caller may use; tools/call runs through the same registry
 *     (tenant facade, audit) as the dashboard;
 *   - the official SDK client talks to it end to end (initialize → list → call → resources → prompts).
 */
const enabled = process.env.INTEGRATION === '1';
const ORIGIN = 'http://api.test';
const TOKEN = 'C'.repeat(43);
const run = Date.now();
const RUN_IP = `10.76.${Math.floor(run / 1000) % 250}.${run % 250}`;
const adminEmail = `mcp-admin-${run}@example.test`;
const adminPassword = 'a bootstrap admin password';
const memberEmail = `mcp-member-${run}@example.test`;
const memberPassword = 'a regular member password';

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; details?: Record<string, unknown> };
}
const call = (path: string, init: RequestInit = {}, cookies: string[] = []) => {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  if (cookies.length) headers.set('cookie', [`crk_csrf=${TOKEN}`, ...cookies].join('; '));
  else if (!headers.has('authorization')) headers.set('cookie', `crk_csrf=${TOKEN}`);
  headers.set('x-csrf-token', TOKEN);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', RUN_IP);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.handle(new Request(`${ORIGIN}${path}`, { ...init, headers }));
};
const json = (r: Response) => r.json() as Promise<Envelope>;
const sessionCookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('crk_session='))
    ?.split(';')[0] ?? '';
const post = (
  path: string,
  body: unknown,
  cookies: string[] = [],
  extra: Record<string, string> = {},
) => call(path, { method: 'POST', body: JSON.stringify(body), headers: extra }, cookies);
const bearer = (token: string, path: string, init: RequestInit = {}) =>
  call(path, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
  });

/** Audit rows are written off the hot path; poll briefly instead of asserting immediately. */
async function eventually(fn: () => Promise<boolean>, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
}

/** SDK client wired straight into `app.handle` — no sockets, real protocol. */
async function mcpClient(token: string, extraHeaders: Record<string, string> = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/v1/mcp`), {
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('x-forwarded-for', RUN_IP);
      return app.handle(new Request(String(url), { ...init, headers }));
    },
    requestInit: { headers: { authorization: `Bearer ${token}`, ...extraHeaders } },
  });
  const client = new Client({ name: 'mcp-test', version: '0.0.0' });
  // The SDK's own types disagree under exactOptionalPropertyTypes; the object is the right one.
  await client.connect(transport as unknown as Transport);
  return client;
}

describe.skipIf(!enabled)('API tokens (A-4) and MCP server (I-1, I-2, I-3, I-6)', () => {
  let db: Db;
  let tenantId = '';
  let acmeId = '';
  let admin = '';
  let member = '';
  let memberId = '';
  let adminToken = '';
  let adminTokenId = '';
  let memberToken = '';

  beforeAll(async () => {
    if (!enabled) return;
    db = unsafeAcrossTenants();
    process.env.SIGNUP_ENABLED = 'true';
    const s = await runSeed(db, { adminEmail, adminPassword });
    tenantId = s.tenantId;
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
    memberId = (
      (await json(await call('/v1/auth/me', {}, [member]))).data as { user: { id: string } }
    ).user.id;
    acmeId = newId();
    await db
      .insert(schema.clients)
      .values({ id: acmeId, code: `acme-m-${run}`.slice(0, 32), name: 'Acme' });
    await db.insert(schema.exampleProducts).values([
      { id: newId(), client_id: tenantId, slug: `mp-${run}`, name: `Mine-${run}` },
      { id: newId(), client_id: acmeId, slug: `ma-${run}`, name: `Acme-${run}` },
    ]);
  });

  test('tokens: minted from a session only, listed without the secret, revocable; bearer authenticates', async () => {
    expect((await call('/v1/tokens')).status).toBe(401);
    const created = await post('/v1/tokens', { name: 'Claude Desktop', expiresInDays: 30 }, [
      admin,
    ]);
    expect(created.status).toBe(201);
    const c = (await json(created)).data as { id: string; token: string; expiresAt: string | null };
    expect(c.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.expiresAt).not.toBeNull();
    adminToken = c.token;
    adminTokenId = c.id;

    const list = (await json(await call('/v1/tokens', {}, [admin]))).data as {
      id: string;
      name: string;
    }[];
    expect(list.some((t) => t.id === c.id && t.name === 'Claude Desktop')).toBe(true);
    expect(JSON.stringify(list)).not.toContain(c.token);

    // Bearer works without any cookie or CSRF token, and reports itself in /me.
    const me = await json(await bearer(adminToken, '/v1/auth/me'));
    expect(me.success).toBe(true);
    expect((me.data as { session: unknown; token: { id: string } }).session).toBeNull();
    expect((me.data as { token: { id: string } }).token.id).toBe(c.id);
    expect((me.data as { clientId: string }).clientId).toBe(tenantId);

    // A token cannot mint tokens, log out, or switch tenant (session-only actions).
    const viaToken = await bearer(adminToken, '/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'nested' }),
    });
    expect(viaToken.status).toBe(403);
    expect((await json(viaToken)).error?.details?.reason).toBe('session_only');

    // Unknown scope → 422 naming it.
    const badScope = await post('/v1/tokens', { name: 'x', scopes: ['nothing.here'] }, [admin]);
    expect(badScope.status).toBe(422);

    // Garbage and revoked tokens are anonymous.
    expect((await bearer('x'.repeat(43), '/v1/auth/me')).status).toBe(401);
    const throwaway = (await json(await post('/v1/tokens', { name: 'tmp' }, [admin]))).data as {
      id: string;
      token: string;
    };
    expect((await bearer(throwaway.token, '/v1/auth/me')).status).toBe(200);
    expect((await call(`/v1/tokens/${throwaway.id}`, { method: 'DELETE' }, [admin])).status).toBe(
      200,
    );
    expect((await bearer(throwaway.token, '/v1/auth/me')).status).toBe(401);
    // Another user's token id → 404, never a cross-user revoke.
    expect((await call(`/v1/tokens/${c.id}`, { method: 'DELETE' }, [member])).status).toBe(404);
    // Expired token → anonymous (expiry is checked on every request, no cache).
    const shortLived = (
      await json(await post('/v1/tokens', { name: 'short', expiresInDays: 1 }, [admin]))
    ).data as { id: string; token: string };
    expect((await bearer(shortLived.token, '/v1/auth/me')).status).toBe(200);
    await db
      .update(schema.apiTokens)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(schema.apiTokens.id, shortLived.id));
    expect((await bearer(shortLived.token, '/v1/auth/me')).status).toBe(401);
  });

  test('scopes only narrow: a scoped token sees just those permissions; a member token sees only the free tool', async () => {
    const scoped = (
      await json(await post('/v1/tokens', { name: 'scoped', scopes: ['dummy.note.read'] }, [admin]))
    ).data as { token: string };
    const perms = await json(await bearer(scoped.token, '/v1/auth/permissions'));
    expect((perms.data as { permissions: string[] }).permissions).toEqual(['dummy.note.read']);
    const tools = (await json(await bearer(scoped.token, '/v1/tools'))).data as { name: string }[];
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('dummy.count_notes'); // scoped in
    expect(names).toContain('dummy.ping'); // no permission needed
    expect(names).not.toContain('example.list_products'); // scoped out, although the admin may
    const refused = await bearer(scoped.token, '/v1/tools/call', {
      method: 'POST',
      body: JSON.stringify({ name: 'example.list_products' }),
    });
    expect(refused.status).toBe(403);

    memberToken = (
      (await json(await post('/v1/tokens', { name: 'member-token' }, [member]))).data as {
        token: string;
      }
    ).token;
    const memberTools = (await json(await bearer(memberToken, '/v1/tools'))).data as {
      name: string;
    }[];
    expect(memberTools.map((t) => t.name)).toEqual(['dummy.ping']);
  });

  test('MCP: no bearer → 401 before any JSON-RPC (I-6)', async () => {
    const anon = await call('/v1/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(anon.status).toBe(401);
    expect((await json(anon)).error?.code).toBe('unauthorized');
    const bad = await bearer('x'.repeat(43), '/v1/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(bad.status).toBe(401);
  });

  test('MCP: the official SDK client initializes, lists tools (wire names), calls one in the caller’s tenant, reads crk://me, gets the prompt (I-1, I-2, I-3)', async () => {
    const client = await mcpClient(adminToken);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toEqual(
        expect.arrayContaining(['dummy_ping', 'dummy_count_notes', 'example_list_products']),
      );
      for (const t of tools.tools) {
        expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
        expect(t.inputSchema.type).toBe('object');
      }
      expect(
        tools.tools.find((t) => t.name === 'example_list_products')?.annotations?.readOnlyHint,
      ).toBe(true);

      const ping = await client.callTool({ name: 'dummy_ping', arguments: { message: 'via mcp' } });
      expect(ping.isError).toBeFalsy();
      const text = (ping.content as { type: string; text: string }[])[0]?.text ?? '';
      expect(JSON.parse(text)).toMatchObject({ pong: 'via mcp', tenant: tenantId });
      expect((ping.structuredContent as { pong: string }).pong).toBe('via mcp');

      // Tenant boundary: the default tenant's product is visible, Acme's is not.
      const list = await client.callTool({
        name: 'example_list_products',
        arguments: { limit: 50 },
      });
      const products = (
        (list.structuredContent as { products: { name: string }[] }).products ?? []
      ).map((p) => p.name);
      expect(products).toContain(`Mine-${run}`);
      expect(products).not.toContain(`Acme-${run}`);

      // Bad arguments come back as a tool error, never as a transport failure.
      const bad = await client.callTool({ name: 'dummy_ping', arguments: { message: 42 } });
      expect(bad.isError).toBe(true);
      const unknown = await client.callTool({ name: 'nothing_here', arguments: {} });
      expect(unknown.isError).toBe(true);

      const resources = await client.listResources();
      expect(resources.resources.map((r) => r.uri)).toEqual(['crk://me']);
      const me = await client.readResource({ uri: 'crk://me' });
      const meJson = JSON.parse((me.contents[0] as { text: string }).text) as {
        via: string;
        clientId: string;
        permissions: string[];
      };
      expect(meJson.via).toBe('token');
      expect(meJson.clientId).toBe(tenantId);
      expect(meJson.permissions).toEqual(['*.*']);

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((p) => p.name)).toEqual(['dashboard_context']);
      const prompt = await client.getPrompt({ name: 'dashboard_context' });
      const briefing = prompt.messages[0]?.content as { text?: string } | undefined;
      expect(briefing?.text).toContain('dummy_ping');
    } finally {
      await client.close();
    }
  });

  test('MCP: a member token only lists/calls what the member may; a superadmin token may switch tenant via X-Client-ID, a member may not (I-3, I-6)', async () => {
    const asMember = await mcpClient(memberToken);
    try {
      const tools = await asMember.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(['dummy_ping']);
      const denied = await asMember.callTool({ name: 'dummy_count_notes', arguments: {} });
      expect(denied.isError).toBe(true);
      expect((denied.content as { text: string }[])[0]?.text).toContain('dummy.note.read');
    } finally {
      await asMember.close();
    }

    const inAcme = await mcpClient(adminToken, { 'x-client-id': acmeId });
    try {
      const list = await inAcme.callTool({
        name: 'example_list_products',
        arguments: { limit: 50 },
      });
      const products = (
        (list.structuredContent as { products: { name: string }[] }).products ?? []
      ).map((p) => p.name);
      expect(products).toContain(`Acme-${run}`);
      expect(products).not.toContain(`Mine-${run}`);
    } finally {
      await inAcme.close();
    }

    // A member's token pointed at a foreign tenant is refused by the tenancy plugin (403), so the
    // SDK sees a transport error rather than a tool result.
    const foreign = await bearer(memberToken, '/v1/mcp', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream', 'x-client-id': acmeId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(foreign.status).toBe(403);
    expect((await json(foreign)).error?.code).toBe('tenant_forbidden');

    // Every MCP tool call landed in the audit log of the tenant it ran in (M-2).
    const audited = (where: ReturnType<typeof and>, resource: string) =>
      eventually(async () =>
        (
          await db.select({ resource: schema.auditLog.resource }).from(schema.auditLog).where(where)
        ).some((r) => r.resource === resource),
      );
    expect(
      await audited(
        and(eq(schema.auditLog.client_id, acmeId), eq(schema.auditLog.action, 'tool.call')),
        'example.list_products',
      ),
    ).toBe(true);
    expect(
      await audited(
        and(
          eq(schema.auditLog.client_id, tenantId),
          eq(schema.auditLog.actor_id, memberId),
          eq(schema.auditLog.action, 'tool.call'),
        ),
        'dummy.count_notes',
      ),
    ).toBe(true);

    // Revoking the admin token ends MCP access immediately.
    expect((await call(`/v1/tokens/${adminTokenId}`, { method: 'DELETE' }, [admin])).status).toBe(
      200,
    );
    expect((await bearer(adminToken, '/v1/auth/me')).status).toBe(401);
  });
});

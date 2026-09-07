import { tenantsOf } from '@core/auth';
import { errorResponses, fail } from '@core/contracts';
import { newId, unsafeAcrossTenants } from '@core/db';
import { toolInputJsonSchema, toolWireName } from '@core/module-kit';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Elysia, t } from 'elysia';
import { type AuthState, clientIp } from '../plugins/auth.ts';
import { requestContext } from '../plugins/request-context.ts';
import { type TenantState, tenantContext } from '../plugins/tenancy.ts';
import { callTool, listTools, type ToolCaller, toolResultText } from '../tools.ts';

/**
 * MCP server (PRD FR-I: I-1, I-2, I-3, I-6) at `/v1/mcp` — Streamable HTTP with the official SDK,
 * never a hand-rolled JSON-RPC (I-1). It is a thin shell over the core tool registry: `tools/list`
 * and `tools/call` are `listTools` / `callTool` for the authenticated caller, so an MCP client can
 * do exactly what that user could do in the dashboard — nothing more (I-3, I-6):
 *
 *   - no session or bearer token → 401 before any JSON-RPC is read;
 *   - the active tenant comes from the token (or `X-Client-ID` when the user is a member);
 *   - tools not visible to the caller are absent from the list and refused on call;
 *   - `resources/read dab://me` tells the client who it is acting as.
 *
 * Stateless: one `Server` per request, JSON responses (no server-side session table), which is
 * what `--scale api=3` needs. Cookie-session callers must pass CSRF like any other mutation;
 * bearer callers are exempt structurally (see csrf.ts).
 */

const SERVER_INFO = { name: 'dashboard-ai-boilerplate', version: '0.0.0' };
const ME_URI = 'dab://me';

function callerOf(
  a: AuthState,
  tenantState: TenantState | undefined,
  request: Request,
  server: { requestIP?: (r: Request) => { address: string } | null } | null,
  requestId: string,
): ToolCaller {
  return {
    clientId: tenantState?.clientId ?? null,
    userId: a.user.id,
    can: (p) => tenantState?.can(p) ?? false,
    locale: a.user.locale ?? 'id',
    requestId,
    signal: request.signal,
    ip: clientIp(request, server),
  };
}

/** Build a per-request MCP server bound to this caller's permissions and tenant. */
export function buildMcpServer(
  a: AuthState,
  tenantState: TenantState | undefined,
  caller: ToolCaller,
) {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions:
      'Tools act as the authenticated dashboard user, inside their active tenant, under their permissions. Read dab://me to learn who that is.',
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await listTools(caller)).map((tool) => ({
      name: toolWireName(tool.name),
      title: caller.locale === 'en' ? tool.description.en : tool.description.id,
      description: caller.locale === 'en' ? tool.description.en : tool.description.id,
      inputSchema: toolInputJsonSchema(tool.input) as { type: 'object'; [k: string]: unknown },
      annotations: { readOnlyHint: tool.readOnly ?? false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await callTool(req.params.name, req.params.arguments ?? {}, caller);
    if (r.ok) {
      const text = toolResultText(r.result);
      return {
        content: [{ type: 'text', text }],
        ...(r.result !== null && typeof r.result === 'object' && !Array.isArray(r.result)
          ? { structuredContent: r.result as Record<string, unknown> }
          : {}),
      };
    }
    return { content: [{ type: 'text', text: r.message }], isError: true };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: ME_URI,
        name: 'me',
        title: 'Who am I',
        description: 'The user, tenant and permissions this MCP connection acts with',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== ME_URI) throw new Error(`Resource tidak dikenal: ${req.params.uri}`);
    const tenants = await tenantsOf(unsafeAcrossTenants(), a.user.id);
    const me = {
      user: { id: a.user.id, name: a.user.name, email: a.user.email, locale: a.user.locale },
      via: a.token ? 'token' : 'session',
      tenant: tenants.find((x) => x.id === tenantState?.clientId) ?? null,
      clientId: tenantState?.clientId ?? null,
      permissions: a.user.is_superadmin ? ['*.*'] : [...(tenantState?.perms ?? [])],
      scopes: a.scopes ? [...a.scopes] : null,
    };
    return {
      contents: [{ uri: ME_URI, mimeType: 'application/json', text: JSON.stringify(me, null, 2) }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'dashboard_context',
        title: 'Dashboard context',
        description: 'System-style briefing: who the assistant acts as and which tools exist',
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== 'dashboard_context')
      throw new Error(`Prompt tidak dikenal: ${req.params.name}`);
    const tools = await listTools(caller);
    const list = tools
      .map(
        (tool) =>
          `- ${toolWireName(tool.name)}: ${caller.locale === 'en' ? tool.description.en : tool.description.id}`,
      )
      .join('\n');
    const text =
      caller.locale === 'en'
        ? `You assist ${a.user.name} inside their dashboard tenant. Every tool runs with their permissions and sees only their tenant's data.\nAvailable tools:\n${list || '- (none)'}`
        : `Anda membantu ${a.user.name} di tenant dasbor mereka. Setiap tool berjalan dengan izin mereka dan hanya melihat data tenant itu.\nTool yang tersedia:\n${list || '- (tidak ada)'}`;
    return { messages: [{ role: 'user', content: { type: 'text', text } }] };
  });

  return server;
}

const guard = ({
  auth,
  set,
  request,
  tenantState,
}: {
  auth: AuthState | null;
  set: { status?: number | string; headers: Record<string, string | number | undefined> };
  request: Request;
  tenantState?: TenantState;
}) => {
  const rid = String(set.headers['x-request-id'] ?? request.headers.get('x-request-id') ?? newId());
  if (!auth) {
    set.status = 401;
    return fail('unauthorized', 'MCP membutuhkan Authorization: Bearer <API token>', rid);
  }
  if (!tenantState?.clientId) {
    set.status = 409;
    return fail('conflict', 'Tidak ada tenant aktif untuk koneksi MCP ini', rid);
  }
  return undefined;
};

async function handle(
  ctx: {
    auth: unknown;
    tenantState?: TenantState;
    request: Request;
    server: { requestIP?: (r: Request) => { address: string } | null } | null;
    requestId: string;
  },
  parsedBody?: unknown,
): Promise<Response> {
  const a = ctx.auth as AuthState;
  const caller = callerOf(a, ctx.tenantState, ctx.request, ctx.server, ctx.requestId);
  const server = buildMcpServer(a, ctx.tenantState, caller);
  // Stateless: no sessionIdGenerator → every request stands alone (multi-instance safe).
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(
      ctx.request,
      parsedBody === undefined ? undefined : { parsedBody },
    );
  } finally {
    void transport.close();
  }
}

export const mcpDomain = new Elysia({ name: 'mcp', prefix: '/mcp', tags: ['mcp'] })
  .use(requestContext)
  .use(tenantContext)
  .post('/', (ctx) => handle(ctx, ctx.body), {
    beforeHandle: guard,
    body: t.Unknown(),
    response: { 200: t.Unknown(), ...errorResponses },
    detail: {
      summary:
        'MCP Streamable HTTP endpoint (JSON-RPC: initialize, tools/list, tools/call, resources/*, prompts/*) — bearer token or session required',
    },
  })
  .get('/', (ctx) => handle(ctx), {
    beforeHandle: guard,
    response: { 200: t.Unknown(), ...errorResponses },
    detail: { summary: 'MCP Streamable HTTP: server-initiated stream (stateless mode: 405)' },
  })
  .delete('/', (ctx) => handle(ctx), {
    beforeHandle: guard,
    response: { 200: t.Unknown(), ...errorResponses },
    detail: { summary: 'MCP Streamable HTTP: end session (stateless mode: 405)' },
  });

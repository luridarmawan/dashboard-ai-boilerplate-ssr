import { type RegistryTool, registerToolSource, type ToolCaller } from '@app/api/tools';
import { and, eq, forTenant, isNull, schema } from '@core/db';
import { callRemoteTool, headersOf } from './mcp-client.ts';

/**
 * External MCP tools as a core tool source (I-4). Every enabled tool of every enabled MCP server
 * of the caller's tenant becomes a registry tool named `ext.<code>__<wire>` (wire name
 * `ext_<code>__<wire>`), guarded by `ai.mcp.use`, executed by proxying to the remote server.
 *
 * Because it is a *source* of the core registry, the AI chat loop, `/v1/tools` and the MCP server
 * all see these tools with exactly the same permission/tenant/audit rules as module tools. The
 * remote server validates arguments (`external: true`); we validate who may call and where.
 */

export const EXT_NS = 'ext';
export const MCP_USE = 'ai.mcp.use';

interface Enabled {
  readonly mcp: typeof schema.aiMcps.$inferSelect;
  readonly tool: typeof schema.aiMcpTools.$inferSelect;
}

async function enabledTools(clientId: string): Promise<Enabled[]> {
  const tenant = forTenant(clientId);
  const mcps = await tenant.select(
    schema.aiMcps,
    and(eq(schema.aiMcps.enabled, true), isNull(schema.aiMcps.deleted_at)),
  );
  if (!mcps.length) return [];
  const byId = new Map(mcps.map((m) => [m.id, m]));
  const tools = await tenant.select(schema.aiMcpTools, eq(schema.aiMcpTools.enabled, true));
  return tools
    .filter((t) => byId.has(t.mcp_id))
    .map((t) => ({ mcp: byId.get(t.mcp_id) as Enabled['mcp'], tool: t }));
}

export function toolNameFor(code: string, wire: string): string {
  return `${EXT_NS}.${code}__${wire}`;
}

function toRegistryTool(e: Enabled): RegistryTool {
  const description = e.tool.description?.trim() || `${e.tool.name} (${e.mcp.name})`;
  const inputSchema =
    e.tool.input_schema && typeof e.tool.input_schema === 'object'
      ? (e.tool.input_schema as { type: 'object'; [k: string]: unknown })
      : { type: 'object' as const };
  const row = { transport: e.mcp.transport, url: e.mcp.url, headers: e.mcp.headers };
  return {
    name: toolNameFor(e.mcp.code, e.tool.wire),
    description: { id: description, en: description },
    permission: MCP_USE,
    input: inputSchema,
    readOnly: false,
    external: true,
    module: 'AI',
    ns: EXT_NS,
    run: async (input, ctx) => {
      const r = await callRemoteTool(row, e.tool.name, input, ctx.signal);
      if (r.isError) throw new Error(r.text || `tool ${e.tool.name} gagal di ${e.mcp.name}`);
      return r.structured ?? r.text;
    },
  };
}

/** Parse `ext.<code>__<wire>` or `ext_<code>__<wire>`; null for anything else. */
export function parseExtName(nameOrWire: string): { code: string; wire: string } | null {
  const m = /^ext[._]([a-z0-9]+(?:-[a-z0-9]+)*)__([A-Za-z0-9_-]{1,40})$/.exec(nameOrWire);
  return m?.[1] && m[2] ? { code: m[1], wire: m[2] } : null;
}

export const mcpToolSource = {
  id: 'ai.mcp',
  async list(caller: ToolCaller): Promise<readonly RegistryTool[]> {
    if (!caller.clientId || !caller.can(MCP_USE)) return [];
    return (await enabledTools(caller.clientId)).map(toRegistryTool);
  },
  async find(nameOrWire: string, caller: ToolCaller): Promise<RegistryTool | undefined> {
    const parsed = parseExtName(nameOrWire);
    if (!parsed || !caller.clientId) return undefined;
    // Resolve even without `ai.mcp.use`: the registry then refuses with `forbidden`, which is
    // more honest to the model than `not_found`.
    const hit = (await enabledTools(caller.clientId)).find(
      (e) => e.mcp.code === parsed.code && e.tool.wire === parsed.wire,
    );
    return hit ? toRegistryTool(hit) : undefined;
  },
};

registerToolSource(mcpToolSource);

/** Header view for the admin UI: names kept, values masked (they are secrets). */
export function maskedHeaders(row: { headers: unknown }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(headersOf(row as { headers: unknown }))) out[k] = '***';
  return out;
}

/** Merge an update: `***` (or missing key) keeps the stored secret; a new value replaces it. */
export function mergeHeaders(
  current: unknown,
  incoming: Record<string, string> | undefined,
): Record<string, string> | null {
  if (incoming === undefined) return headersOf({ headers: current }) || null;
  const before = headersOf({ headers: current });
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = v === '***' ? (before[key] ?? '') : v;
  }
  return Object.keys(out).length ? out : null;
}

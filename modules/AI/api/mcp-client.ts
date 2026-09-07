import type { schema } from '@core/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/**
 * Outbound MCP client (I-4): connect to an external MCP server a tenant registered, list its
 * tools, call one. Transports: `http` (Streamable HTTP, the current spec) and `sse` (legacy).
 * `stdio` is deliberately absent — the API runs as one compiled binary in a container and must
 * not spawn arbitrary processes on behalf of a tenant admin.
 *
 * Every operation opens a fresh connection and closes it: no per-process state, so `--scale
 * api=3` needs nothing shared, and a server that went away is noticed on the next call rather
 * than poisoning a cached client. The cost (one `initialize` handshake) is paid per tool call.
 */

export type McpRow = typeof schema.aiMcps.$inferSelect;

export interface RemoteTool {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown>;
}

/** Wall-clock budget for connect + one request. */
export const MCP_TIMEOUT_MS = 20_000;

export function headersOf(row: Pick<McpRow, 'headers'>): Record<string, string> {
  const raw = row.headers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === 'string' && k.trim()) out[k.trim()] = v;
  return out;
}

async function open(
  row: Pick<McpRow, 'transport' | 'url' | 'headers'>,
  signal: AbortSignal,
): Promise<Client> {
  const headers = headersOf(row);
  const url = new URL(row.url);
  const withSignal = (init?: RequestInit): RequestInit => ({ ...init, signal });
  const fetchWithSignal = (u: string | URL, init?: RequestInit) => fetch(u, withSignal(init));
  const transport: Transport =
    row.transport === 'sse'
      ? (new SSEClientTransport(url, {
          requestInit: { headers },
          eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers }) },
          fetch: fetchWithSignal,
        }) as unknown as Transport)
      : (new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
          fetch: fetchWithSignal,
        }) as unknown as Transport);
  const client = new Client({ name: 'dashboard-ai-boilerplate', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/** Connect and list the server's tools. Throws with a readable message on any failure. */
export async function discoverRemoteTools(
  row: Pick<McpRow, 'transport' | 'url' | 'headers'>,
): Promise<RemoteTool[]> {
  const signal = AbortSignal.timeout(MCP_TIMEOUT_MS);
  const client = await open(row, signal);
  try {
    const out: RemoteTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: MCP_TIMEOUT_MS,
      });
      for (const t of page.tools)
        out.push({
          name: t.name,
          description: t.description ?? t.title ?? null,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
        });
      cursor = page.nextCursor;
    } while (cursor && out.length < 500);
    return out;
  } finally {
    await client.close().catch(() => {});
  }
}

export interface RemoteCallResult {
  readonly text: string;
  readonly structured: unknown;
  readonly isError: boolean;
}

/** Call one remote tool; content text parts are joined, `structuredContent` passed through. */
export async function callRemoteTool(
  row: Pick<McpRow, 'transport' | 'url' | 'headers'>,
  name: string,
  args: Record<string, unknown>,
  outer?: AbortSignal,
): Promise<RemoteCallResult> {
  const timeout = AbortSignal.timeout(MCP_TIMEOUT_MS);
  const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;
  const client = await open(row, signal);
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      signal,
      timeout: MCP_TIMEOUT_MS,
    });
    const parts = (r.content ?? []) as { type: string; text?: string }[];
    const text = parts
      .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : `[${p.type}]`))
      .join('\n');
    return { text, structured: r.structuredContent ?? null, isError: r.isError === true };
  } finally {
    await client.close().catch(() => {});
  }
}

/** `<remote tool name>` → OpenAI/MCP-legal suffix (`^[a-zA-Z0-9_-]+$`), at most 40 chars. */
export function wireSuffix(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
  return cleaned.slice(0, 40);
}

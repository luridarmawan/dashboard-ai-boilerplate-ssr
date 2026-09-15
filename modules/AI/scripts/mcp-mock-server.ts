#!/usr/bin/env bun
/**
 * Mock remote MCP server for proofs and manual runs (official SDK, stateless Streamable HTTP):
 *   POST /mcp   — JSON-RPC: `tools/list` offers two tools, `tools/call` answers them
 *   GET  /ready — liveness, so a harness can wait for it
 *
 *   PORT=4020 bun run mcp:mock
 *
 * It lives in the module, not in core `scripts/`, because the official SDK is the AI module's
 * dependency (core's own MCP server has its own copy in `apps/api`) — the mock must resolve it
 * from `modules/AI/node_modules`.
 *
 * It exists so the MCP admin page (`/m/ai/mcps/[id]`) has something real to connect to when the
 * E2E pass drives it in a browser: testing the connection must actually discover tools, otherwise
 * "reload the tool list" proves nothing. `MOCK_MCP_TOOLS` changes how many tools it offers, so a
 * restart between two tests shows by hand that a re-test REPLACES the stored list, never appends.
 *
 * NOTE: the integration tests do NOT use this script; they start their own in-process server
 * (`modules/AI/test/integration/mcp-client.test.ts`). This is for the E2E harness and for driving
 * the app by hand.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const port = Number(process.env.PORT ?? 4020);
/** How many of the tools below to offer; a smaller number on a re-test proves the list is replaced. */
const count = Number(process.env.MOCK_MCP_TOOLS ?? 2);

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the text back, uppercased',
    inputSchema: {
      type: 'object' as const,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'ping',
    description: 'Answer pong, with no arguments at all',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/ready') return new Response('ok');
    const mcp = new Server({ name: 'mock-mcp', version: '0.0.0' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.slice(0, Math.max(0, count)),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (r) => {
      if (r.params.name === 'echo') {
        const text = String((r.params.arguments as { text?: unknown })?.text ?? '');
        return {
          content: [{ type: 'text', text: `ECHO ${text.toUpperCase()}` }],
          structuredContent: { echoed: text.toUpperCase() },
        };
      }
      return { content: [{ type: 'text', text: 'pong' }] };
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

console.log(`mock MCP server: http://${server.hostname}:${server.port}/mcp (${count} tool)`);

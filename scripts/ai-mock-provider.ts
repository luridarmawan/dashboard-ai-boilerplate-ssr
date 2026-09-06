#!/usr/bin/env bun
/**
 * Mock OpenAI-compatible provider for proofs and tests (no real key, no network):
 *   POST /v1/chat/completions  — streams `data:` SSE chunks (stream: true) or answers at once.
 * It echoes the last user message word by word with a small delay, so streaming and cancellation
 * are observable, and reports `usage` like a real provider.
 *   PORT=4010 bun run scripts/ai-mock-provider.ts
 */
const port = Number(process.env.PORT ?? 4010);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 40);

function reply(messages: { role: string; content: string }[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const sys = messages.find((m) => m.role === 'system')?.content;
  return `Echo${sys ? ' (with system prompt)' : ''}: ${last} — dan ini **markdown** dengan \`kode\`.\n\n\`\`\`ts\nconst ok = true;\n\`\`\``;
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }
    if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: { message: 'Missing API key', type: 'invalid_request_error' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }
    const body = (await req.json()) as {
      model?: string;
      stream?: boolean;
      messages: { role: string; content: string }[];
    };
    const text = reply(body.messages ?? []);
    const id = `chatcmpl-mock-${Date.now()}`;
    const model = body.model ?? 'mock-1';
    const promptTokens = body.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
    const completionTokens = Math.ceil(text.length / 4);
    if (!body.stream) {
      return Response.json({
        id,
        object: 'chat.completion',
        model,
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      });
    }
    const words = text.split(/(?<= )/);
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (o: unknown) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
        for (const w of words) {
          if (req.signal.aborted) break;
          send({
            id,
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: { content: w }, finish_reason: null }],
          });
          await Bun.sleep(DELAY_MS);
        }
        if (!req.signal.aborted) {
          send({
            id,
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          });
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
  },
});
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'ai mock provider listening',
    url: `http://127.0.0.1:${port}/v1`,
  }),
);

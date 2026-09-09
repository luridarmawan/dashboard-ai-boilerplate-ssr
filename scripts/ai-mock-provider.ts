#!/usr/bin/env bun
/**
 * Mock OpenAI-compatible provider for proofs and manual runs (no real key, no network):
 *   GET  /v1/models             — model ids, so the capability probe's step 1 has something to read
 *   POST /v1/chat/completions   — streams `data:` SSE chunks (stream: true) or answers at once
 *   POST /v1/responses          — the modern endpoint: `input`/`max_output_tokens`, SSE
 *                                 `response.output_text.delta`, plus `reasoning` and `tools` echoes
 * It echoes the last user message word by word with a small delay, so streaming and cancellation
 * are observable, and reports `usage` like a real provider.
 *   PORT=4010 bun run scripts/ai-mock-provider.ts
 *
 * `MOCK_ENDPOINTS` picks which endpoints exist, to prove the probe classifies all three shapes:
 *   both (default) | chat — only /chat/completions | responses — only /responses
 *
 * NOTE: the integration tests do NOT use this script; they fake upstream in-process with their
 * own `Bun.serve` (`modules/AI/test/integration/providers.test.ts`, `ai.test.ts`). This is for
 * `bun run ai:test` and for driving the app by hand.
 */
const port = Number(process.env.PORT ?? 4010);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 40);
const MODE = (process.env.MOCK_ENDPOINTS ?? 'both') as 'both' | 'chat' | 'responses';
const hasChat = MODE === 'both' || MODE === 'chat';
const hasResponses = MODE === 'both' || MODE === 'responses';
const MODELS = ['mock-1', 'mock-reasoning-1'];

function reply(messages: { role: string; content: string }[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const sys = messages.find((m) => m.role === 'system')?.content;
  return `Echo${sys ? ' (with system prompt)' : ''}: ${last} — dan ini **markdown** dengan \`kode\`.\n\n\`\`\`ts\nconst ok = true;\n\`\`\``;
}

const notFound = (msg = 'not found') =>
  new Response(JSON.stringify({ error: { message: msg, type: 'invalid_request_error' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

const est = (s: string) => Math.ceil(s.length / 4);

/** `input` is either a bare string or the Responses item array; flatten it to chat messages. */
type ResponsesInput =
  | string
  | {
      role?: string;
      type?: string;
      content?: string | { type?: string; text?: string }[];
    }[];

function inputToMessages(input: ResponsesInput, instructions?: string) {
  const out: { role: string; content: string }[] = [];
  if (instructions) out.push({ role: 'system', content: instructions });
  if (typeof input === 'string') {
    out.push({ role: 'user', content: input });
    return out;
  }
  for (const item of input ?? []) {
    const text =
      typeof item.content === 'string'
        ? item.content
        : (item.content ?? [])
            .map((c) => c.text ?? '')
            .filter(Boolean)
            .join('');
    out.push({ role: item.role ?? 'user', content: text });
  }
  return out;
}

function sse(frames: () => AsyncGenerator<string>) {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      for await (const frame of frames()) controller.enqueue(enc.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/v1/models' && req.method === 'GET') {
      if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: { message: 'Missing API key', type: 'invalid_request_error' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        );
      }
      return Response.json({
        object: 'list',
        data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'mock' })),
      });
    }

    const isChat = url.pathname === '/v1/chat/completions';
    const isResponses = url.pathname === '/v1/responses';
    if (!isChat && !isResponses) return notFound();
    if (req.method !== 'POST') return notFound('only POST');
    // Mode gating is what lets one script play chat-only / responses-only / both providers.
    if (isChat && !hasChat) return notFound('/chat/completions disabled (MOCK_ENDPOINTS)');
    if (isResponses && !hasResponses) return notFound('/responses disabled (MOCK_ENDPOINTS)');

    if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: { message: 'Missing API key', type: 'invalid_request_error' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }

    const body = (await req.json()) as {
      model?: string;
      stream?: boolean;
      messages?: { role: string; content: string }[];
      input?: ResponsesInput;
      instructions?: string;
      reasoning?: { effort?: string };
      reasoning_effort?: string;
      tools?: ({ name?: string } & { function?: { name?: string } })[];
    };
    const model = body.model ?? 'mock-1';
    const messages = isResponses
      ? inputToMessages(body.input ?? '', body.instructions)
      : (body.messages ?? []);
    const text = reply(messages);
    const promptTokens = messages.reduce((n, m) => n + est(m.content ?? ''), 0);
    const completionTokens = est(text);
    const wantsReasoning = !!(body.reasoning || body.reasoning_effort);
    const reasoningTokens = wantsReasoning ? 7 : 0;
    const toolName = body.tools?.length
      ? (body.tools[0].name ?? body.tools[0].function?.name ?? 'probe_noop')
      : null;

    // ---- /responses ----
    if (isResponses) {
      const id = `resp-mock-${Date.now()}`;
      const usage = {
        input_tokens: promptTokens,
        output_tokens: completionTokens + reasoningTokens,
        total_tokens: promptTokens + completionTokens + reasoningTokens,
        ...(wantsReasoning ? { output_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
      };
      // A tool was offered and the turn asks for it: answer with a function call, like the real API.
      const wantsToolCall = toolName && /PING/i.test(messages.at(-1)?.content ?? '');
      const output = [
        ...(wantsReasoning ? [{ type: 'reasoning', id: `${id}-rs`, summary: [] }] : []),
        ...(wantsToolCall
          ? [
              {
                type: 'function_call',
                id: `${id}-fc`,
                call_id: `call_mock_${Date.now()}`,
                name: toolName,
                arguments: '{}',
              },
            ]
          : [
              {
                type: 'message',
                id: `${id}-msg`,
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text, annotations: [] }],
              },
            ]),
      ];
      if (!body.stream) {
        return Response.json({
          id,
          object: 'response',
          status: 'completed',
          model,
          output,
          output_text: wantsToolCall ? '' : text,
          usage,
        });
      }
      const words = text.split(/(?<= )/);
      return sse(async function* () {
        const frame = (type: string, data: Record<string, unknown>) =>
          `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
        yield frame('response.created', { response: { id, status: 'in_progress', model } });
        for (const w of words) {
          if (req.signal.aborted) break;
          yield frame('response.output_text.delta', {
            item_id: `${id}-msg`,
            output_index: 0,
            delta: w,
          });
          await Bun.sleep(DELAY_MS);
        }
        if (!req.signal.aborted) {
          yield frame('response.output_text.done', { item_id: `${id}-msg`, text });
          yield frame('response.completed', {
            response: { id, status: 'completed', model, output, output_text: text, usage },
          });
        }
      });
    }

    // ---- /chat/completions ----
    const id = `chatcmpl-mock-${Date.now()}`;
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
    endpoints: MODE,
  }),
);

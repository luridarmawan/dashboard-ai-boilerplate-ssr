import { describe, expect, test } from 'bun:test';
import { isRecommended, probeCapabilities } from '../api/probe.ts';

/**
 * Unit (no DB, no app): the capability probe of AI-Roadmap §4.1. Each case stands up a tiny
 * in-process provider that answers the way a real one would, and asserts the matrix the admin
 * would see. What matters here is the CLASSIFICATION rules, because everything downstream
 * (badge, preferred endpoint, chat runtime) is derived from them:
 *   - `GET /models` is informational: missing it must not veto the run, a 401 on it must stop it
 *   - 404/405 means "endpoint absent"; a 400 about a model or parameter does NOT
 *   - the stream probe hangs up after the first frame instead of draining the completion
 */

type Handler = (req: Request, url: URL) => Response | null | Promise<Response | null>;

/** A provider that only serves what the case gives it; anything else is 404, like a real proxy. */
function provider(handler: Handler) {
  const server = Bun.serve({
    port: 0,
    // `await` first: an async handler returning null would otherwise be a pending promise here,
    // and Bun would tear the connection down instead of serving the 404 the case intends.
    fetch: async (req) => (await handler(req, new URL(req.url))) ?? json404(),
  });
  return { server, url: `http://127.0.0.1:${server.port}/v1` };
}
const json404 = () =>
  new Response('{"error":{"message":"not found"}}', {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
const jsonErr = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const models = (ids: string[]) =>
  Response.json({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) });
const responsesOk = (extra: Record<string, unknown> = {}) =>
  Response.json({
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    ...extra,
  });
const chatOk = () =>
  Response.json({
    id: 'chatcmpl_1',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

const probe = (url: string, key: string | null = 'k') =>
  probeCapabilities(url, key, 'model-x', { stepTimeoutMs: 2_000, budgetMs: 8_000 });

describe('AI capability probe (§4.1)', () => {
  test('both endpoints: /responses wins and the provider is recommended', async () => {
    const p = provider((_req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x', 'o3-mini']);
      if (url.pathname.endsWith('/responses')) return responsesOk();
      if (url.pathname.endsWith('/chat/completions')) return chatOk();
      return null;
    });
    try {
      const r = await probe(p.url);
      expect(r.ok).toBe(true);
      expect(r.endpoints).toEqual({ responses: true, chatCompletions: true });
      expect(r.preferredEndpoint).toBe('responses');
      expect(r.modelsTested).toEqual(['model-x', 'o3-mini'].sort());
      expect(r.error).toBeNull();
      // Nothing claims reasoning here, so the badge must stay off.
      expect(r.reasoning.supported).toBe(false);
      expect(isRecommended(r)).toBe(true); // tools were accepted, which is enough
    } finally {
      p.server.stop(true);
    }
  });

  test('chat-only provider: preferred falls back and the reasoning step is skipped', async () => {
    const p = provider((_req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (url.pathname.endsWith('/chat/completions')) return chatOk();
      return null; // /responses → 404
    });
    try {
      const r = await probe(p.url);
      expect(r.ok).toBe(true);
      expect(r.endpoints).toEqual({ responses: false, chatCompletions: true });
      expect(r.preferredEndpoint).toBe('chat_completions');
      expect(isRecommended(r)).toBe(false);
      expect(r.steps.find((s) => s.step === 'reasoning')?.status).toBe('skipped');
    } finally {
      p.server.stop(true);
    }
  });

  test('responses-only provider works, and a missing GET /models does not veto the run', async () => {
    const p = provider((_req, url) => {
      if (url.pathname.endsWith('/responses')) return responsesOk();
      return null; // no /models, no /chat/completions
    });
    try {
      const r = await probe(p.url);
      expect(r.ok).toBe(true);
      expect(r.preferredEndpoint).toBe('responses');
      expect(r.modelsTested).toEqual([]);
      expect(r.steps.find((s) => s.step === 'models')?.status).toBe('unsupported');
    } finally {
      p.server.stop(true);
    }
  });

  test('401 on GET /models stops the run with an actionable message', async () => {
    let hits = 0;
    const p = provider((_req, url) => {
      hits++;
      if (url.pathname.endsWith('/models')) return jsonErr(401, 'invalid api key');
      return responsesOk();
    });
    try {
      const r = await probe(p.url);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('API key ditolak');
      expect(r.preferredEndpoint).toBeNull();
      expect(hits).toBe(1); // no point probing endpoints with a rejected key
    } finally {
      p.server.stop(true);
    }
  });

  test('400 "unknown field input" means /responses is absent, not merely unhappy', async () => {
    const p = provider((_req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (url.pathname.endsWith('/responses'))
        return jsonErr(400, 'Unrecognized request argument supplied: input');
      if (url.pathname.endsWith('/chat/completions')) return chatOk();
      return null;
    });
    try {
      const r = await probe(p.url);
      expect(r.endpoints.responses).toBe(false);
      expect(r.preferredEndpoint).toBe('chat_completions');
    } finally {
      p.server.stop(true);
    }
  });

  test('400 about the model still proves /responses exists (§8 tolerance)', async () => {
    const p = provider((_req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (url.pathname.endsWith('/responses'))
        return jsonErr(400, 'The model `model-x` does not exist');
      return null;
    });
    try {
      const r = await probe(p.url);
      expect(r.endpoints.responses).toBe(true);
      expect(r.preferredEndpoint).toBe('responses');
      expect(r.ok).toBe(true);
    } finally {
      p.server.stop(true);
    }
  });

  test('no endpoint answers: not ok, with both statuses in the message', async () => {
    const p = provider(() => null);
    try {
      const r = await probe(p.url);
      expect(r.ok).toBe(false);
      expect(r.preferredEndpoint).toBeNull();
      expect(r.error).toContain('tidak ada endpoint yang menjawab');
    } finally {
      p.server.stop(true);
    }
  });

  test('reasoning: nested `reasoning` param reported, then `reasoning_effort` as fallback', async () => {
    const nested = provider((req, url) => {
      if (url.pathname.endsWith('/models')) return models(['o3-mini']);
      if (!url.pathname.endsWith('/responses')) return null;
      return req.headers.get('accept') === 'text/event-stream'
        ? new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })
        : responsesOk({ usage: { output_tokens_details: { reasoning_tokens: 5 } } });
    });
    try {
      const r = await probe(nested.url);
      expect(r.reasoning).toEqual({ supported: true, param: 'reasoning', via: 'responses' });
      expect(isRecommended(r)).toBe(true);
    } finally {
      nested.server.stop(true);
    }

    // A provider that only knows the flat spelling: the nested attempt is rejected as unknown.
    const flat = provider(async (req, url) => {
      if (url.pathname.endsWith('/models')) return models(['o3-mini']);
      if (!url.pathname.endsWith('/responses')) return null;
      if (req.headers.get('accept') === 'text/event-stream')
        return new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      const body = (await req.json()) as { reasoning?: unknown; reasoning_effort?: unknown };
      if (body.reasoning) return jsonErr(400, 'Unknown parameter: reasoning');
      if (body.reasoning_effort)
        return responsesOk({ usage: { output_tokens_details: { reasoning_tokens: 5 } } });
      return responsesOk();
    });
    try {
      const r = await probe(flat.url);
      expect(r.reasoning).toEqual({
        supported: true,
        param: 'reasoning_effort',
        via: 'responses',
      });
    } finally {
      flat.server.stop(true);
    }
  });

  test('tools rejected by the provider: supported=false, everything else still reported', async () => {
    const p = provider(async (req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (!url.pathname.endsWith('/chat/completions')) return null;
      if (req.headers.get('accept') === 'text/event-stream')
        return new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
      const body = (await req.json()) as { tools?: unknown[] };
      if (body.tools?.length) return jsonErr(400, 'tools are not supported by this model');
      return chatOk();
    });
    try {
      const r = await probe(p.url);
      expect(r.ok).toBe(true);
      expect(r.stream.supported).toBe(true);
      expect(r.tools).toEqual({ supported: false, functionCalling: false, via: null });
    } finally {
      p.server.stop(true);
    }
  });

  test('a `response.created` frame carrying "error": null is a working stream, not a failure', async () => {
    // Exactly what a live Responses proxy sends first. Reading `error` as "any mention = broken"
    // reported a perfectly good streaming provider as non-streaming.
    const created =
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress","error":null,"output":[]}}\n\n';
    const p = provider((req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (!url.pathname.endsWith('/responses')) return null;
      return req.headers.get('accept') === 'text/event-stream'
        ? new Response(created, { headers: { 'content-type': 'text/event-stream' } })
        : responsesOk();
    });
    try {
      const r = await probe(p.url);
      expect(r.stream.supported).toBe(true);
      expect(r.stream.responsesStream).toBe(true);
      expect(r.steps.find((s) => s.step === 'stream')?.status).toBe('ok');
    } finally {
      p.server.stop(true);
    }
  });

  test('a real error frame is still reported as no stream', async () => {
    const p = provider((req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (!url.pathname.endsWith('/responses')) return null;
      return req.headers.get('accept') === 'text/event-stream'
        ? new Response('data: {"error":{"message":"streaming not enabled for this key"}}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          })
        : responsesOk();
    });
    try {
      const r = await probe(p.url);
      expect(r.stream.supported).toBe(false);
      expect(r.steps.find((s) => s.step === 'stream')?.note).toContain('streaming not enabled');
    } finally {
      p.server.stop(true);
    }
  });

  test('stream probe hangs up after the first frame instead of draining the completion', async () => {
    let sent = 0;
    const p = provider((req, url) => {
      if (url.pathname.endsWith('/models')) return models(['model-x']);
      if (!url.pathname.endsWith('/chat/completions')) return null;
      if (req.headers.get('accept') !== 'text/event-stream') return chatOk();
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          for (let i = 0; i < 200; i++) {
            if (req.signal.aborted) break;
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`),
            );
            sent++;
            await Bun.sleep(5);
          }
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    try {
      const r = await probe(p.url);
      expect(r.stream.supported).toBe(true);
      expect(r.stream.sse).toBe(true);
      await Bun.sleep(120); // give an un-cancelled upstream time to keep going
      expect(sent).toBeLessThan(30); // 200 frames would mean we drained (and paid for) it all
    } finally {
      p.server.stop(true);
    }
  });

  test('an aborted probe is a result, not a thrown error', async () => {
    const p = provider(async (_req, url) => {
      if (url.pathname.endsWith('/models')) {
        await Bun.sleep(500);
        return models(['model-x']);
      }
      return null;
    });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    try {
      const r = await probeCapabilities(p.url, 'k', 'model-x', {
        signal: ctrl.signal,
        stepTimeoutMs: 2_000,
      });
      expect(r.ok).toBe(false);
      expect(r.error).toBe('probe dibatalkan');
    } finally {
      p.server.stop(true);
    }
  });
});

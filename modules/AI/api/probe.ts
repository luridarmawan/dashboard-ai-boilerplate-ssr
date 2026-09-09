/**
 * Capability probe (AI-Roadmap F0). One sequential run against an OpenAI-compatible base URL
 * answers what the provider can actually do — `/responses` vs `/chat/completions`, streaming,
 * reasoning, function calling — so the admin learns it at setup instead of at the first failed
 * chat, and chat runtime can pick the right endpoint without probing per request.
 *
 * DELIBERATELY DEPENDENCY-FREE: no `@app/api/services`, no `@core/db`, nothing but `fetch`. The
 * "test" route and the `bun run ai:test` CLI both call it, and the CLI has no API service graph
 * to lean on. Everything it needs arrives as arguments.
 */

export type Endpoint = 'responses' | 'chat_completions';
export type ReasoningParam = 'reasoning' | 'reasoning_effort';

export interface Capabilities {
  endpoints: { responses: boolean; chatCompletions: boolean };
  stream: { supported: boolean; sse: boolean; responsesStream: boolean };
  reasoning: { supported: boolean; param: ReasoningParam | null; via: Endpoint | null };
  tools: { supported: boolean; functionCalling: boolean; via: Endpoint | null };
  /** Model ids the provider offered on `GET /models` (empty when it has no such route). */
  modelsTested: string[];
  preferredEndpoint: Endpoint | null;
}

/** One line of the probe, for `--verbose` and the admin's "test" card. */
export interface ProbeStep {
  step: 'models' | 'responses' | 'chat_completions' | 'stream' | 'reasoning' | 'tools';
  status: 'ok' | 'unsupported' | 'error' | 'skipped';
  ms: number;
  note: string | null;
}

export interface ProbeResult extends Capabilities {
  /** At least one endpoint answered — i.e. the provider is usable for chat. */
  ok: boolean;
  error: string | null;
  ms: number;
  steps: ProbeStep[];
}

export interface ProbeOptions {
  /** Per-step timeout. §4.1 asks for 3s. */
  stepTimeoutMs?: number;
  /** Hard ceiling for the whole run so an admin request can never hang on a slow provider. */
  budgetMs?: number;
  /** Cancels the whole run (the caller's request going away). */
  signal?: AbortSignal;
}

/**
 * §4.1 proposed 3s per step. Measured against a real provider that is not pathological, the
 * `/responses` step alone takes 1.4–2.5s, and from a container over a WAN link 3s expires — at
 * which point the step reads as an error and the matrix reports the endpoint as ABSENT. A
 * provider with `/responses` then gets pinned to chat until someone tests it again. 8s leaves
 * real headroom while still bounding an admin request.
 */
const STEP_TIMEOUT_MS = 8_000;
const BUDGET_MS = 25_000;
/** Probe bodies stay tiny: 8 output tokens is enough to prove an endpoint answers. */
const PROBE_TOKENS = 8;
/** Reasoning is the one genuinely billed step (reasoning tokens are not capped like output). */
const REASONING_TOKENS = 16;
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,120}$/;

const clip = (s: string, n = 300) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** True when the body reads like "this API has never heard of that field", not "bad value". */
const unknownField = (text: string, field: string) => {
  const t = text.toLowerCase();
  return (
    t.includes(field) &&
    /unknown|unrecognized|unsupported|not supported|extra inputs|unexpected|invalid_type/.test(t)
  );
};

interface Attempt {
  status: number;
  text: string;
  json: Record<string, unknown> | null;
  ms: number;
  error: string | null;
}

/**
 * Verdict for "does this endpoint exist at all". Tolerant on purpose (§8): a `400` about a model
 * or a parameter still proves the route is there, so only 404/405 — and a body that rejects the
 * endpoint's own signature field — count as absent.
 */
type Presence = 'present' | 'absent' | 'auth' | 'error';

function presenceOf(a: Attempt, signatureField: string): Presence {
  if (a.error) return 'error';
  if (a.status === 401 || a.status === 403) return 'auth';
  if (a.status === 404 || a.status === 405 || a.status === 501) return 'absent';
  if (a.status === 200 || a.status === 201) return 'present';
  if (a.status === 400 || a.status === 422) {
    return unknownField(a.text, signatureField) ? 'absent' : 'present';
  }
  // 402/429/5xx: the route answered, it just would not serve us now.
  return 'present';
}

/**
 * First complete `data:` payload in an SSE buffer, or null while none has arrived yet. A frame is
 * only complete once its blank-line terminator is in the buffer — returning early would truncate
 * the JSON and make it unparseable.
 */
function firstDataPayload(buf: string): string | null {
  for (const frame of buf.split(/\n\n|\r\n\r\n/).slice(0, -1)) {
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('data:')) return line.slice(5).trim();
    }
  }
  return null;
}

/**
 * Is this first frame an actual failure? Beware `"error": null` — a real Responses
 * `response.created` frame carries it, and treating any mention of `error` as a failure reports
 * a perfectly good streaming provider as non-streaming (seen on a live proxy, 2026-09-10).
 */
function frameFailure(payload: string): boolean {
  if (payload === '[DONE]') return false;
  try {
    const j = JSON.parse(payload) as { error?: unknown; type?: unknown };
    if (j.type === 'error') return true;
    return 'error' in j && j.error !== null && j.error !== undefined;
  } catch {
    // Not JSON: fall back to text, but still ignore an explicitly null error.
    return /"error"\s*:\s*(?!null)/.test(payload);
  }
}

export class ProbeAborted extends Error {}

/** Sequential probe runner: shared deadline, per-step timeout, every step recorded. */
class Runner {
  readonly steps: ProbeStep[] = [];
  private readonly deadline: number;
  constructor(
    private readonly stepTimeoutMs: number,
    budgetMs: number,
    private readonly outer?: AbortSignal,
  ) {
    this.deadline = performance.now() + budgetMs;
  }

  get spent(): boolean {
    return performance.now() >= this.deadline;
  }

  record(step: ProbeStep['step'], status: ProbeStep['status'], ms: number, note: string | null) {
    this.steps.push({ step, status, ms, note: note ? clip(note) : null });
  }

  skip(step: ProbeStep['step'], why: string) {
    this.record(step, 'skipped', 0, why);
  }

  /** One HTTP call. Never throws for HTTP status; throws only when the caller cancelled. */
  async call(url: string, key: string | null, body: unknown | null): Promise<Attempt> {
    if (this.outer?.aborted) throw new ProbeAborted('probe dibatalkan');
    const started = performance.now();
    const budgetLeft = Math.max(0, this.deadline - started);
    const timeout = AbortSignal.timeout(Math.min(this.stepTimeoutMs, budgetLeft || 1));
    const signal = this.outer ? AbortSignal.any([timeout, this.outer]) : timeout;
    try {
      const res = await fetch(url, {
        method: body === null ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          ...(body === null ? {} : { 'content-type': 'application/json' }),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal,
      });
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      let json: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
      } catch {
        /* not JSON — the status and text still decide */
      }
      return {
        status: res.status,
        text,
        json,
        ms: Math.round(performance.now() - started),
        error: null,
      };
    } catch (err) {
      if (this.outer?.aborted) throw new ProbeAborted('probe dibatalkan');
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 0,
        text: '',
        json: null,
        ms: Math.round(performance.now() - started),
        error: /timeout|timed out|aborted/i.test(msg) ? 'timeout' : clip(msg),
      };
    }
  }

  /**
   * Streaming probe: read the first frame, then hang up. The reader is cancelled explicitly —
   * a bare `break` would leave the upstream generating (and billing) the whole completion.
   */
  async firstFrame(
    url: string,
    key: string | null,
    body: unknown,
  ): Promise<{ ok: boolean; sse: boolean; status: number; note: string | null; ms: number }> {
    if (this.outer?.aborted) throw new ProbeAborted('probe dibatalkan');
    const started = performance.now();
    const ctrl = new AbortController();
    const budgetLeft = Math.max(0, this.deadline - started);
    const timeout = AbortSignal.timeout(Math.min(this.stepTimeoutMs, budgetLeft || 1));
    const stop = () => ctrl.abort();
    timeout.addEventListener('abort', stop, { once: true });
    this.outer?.addEventListener('abort', stop, { once: true });
    const ms = () => Math.round(performance.now() - started);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const sse = (res.headers.get('content-type') ?? '').includes('text/event-stream');
      if (!res.ok || !res.body) {
        return { ok: false, sse, status: res.status, note: `HTTP ${res.status}`, ms: ms() };
      }
      const reader = res.body.getReader();
      try {
        const dec = new TextDecoder();
        let buf = '';
        // A frame may straddle chunks; a couple of reads is plenty to see the first `data:`.
        for (let i = 0; i < 4; i++) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const payload = firstDataPayload(buf);
          if (payload !== null) {
            const failure = frameFailure(payload);
            return {
              ok: !failure,
              sse: true,
              status: res.status,
              note: failure ? clip(payload) : null,
              ms: ms(),
            };
          }
        }
        return { ok: false, sse, status: res.status, note: 'tidak ada frame `data:`', ms: ms() };
      } finally {
        await reader.cancel().catch(() => {});
        ctrl.abort();
      }
    } catch (err) {
      if (this.outer?.aborted) throw new ProbeAborted('probe dibatalkan');
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        sse: false,
        status: 0,
        note: /timeout|timed out|aborted/i.test(msg) ? 'timeout' : clip(msg),
        ms: ms(),
      };
    } finally {
      timeout.removeEventListener('abort', stop);
      this.outer?.removeEventListener('abort', stop);
    }
  }
}

const empty = (): Capabilities => ({
  endpoints: { responses: false, chatCompletions: false },
  stream: { supported: false, sse: false, responsesStream: false },
  reasoning: { supported: false, param: null, via: null },
  tools: { supported: false, functionCalling: false, via: null },
  modelsTested: [],
  preferredEndpoint: null,
});

/** Did a Responses reply actually account for reasoning? */
function sawReasoning(a: Attempt): boolean {
  if (/reasoning_tokens|"reasoning"|reasoning_content/.test(a.text)) return true;
  const usage = a.json?.usage as Record<string, unknown> | undefined;
  const details = usage?.output_tokens_details as Record<string, unknown> | undefined;
  return typeof details?.reasoning_tokens === 'number';
}

/** Did a reply carry a tool/function call? */
const sawToolCall = (a: Attempt) => /tool_calls|function_call|"arguments"\s*:/.test(a.text);

/**
 * Run the §4.1 sequence against `baseUrl`. Cheap (a handful of 8-token calls), idempotent, and
 * it never touches the `ai_*` tables — no conversation, no attachments, no history.
 *
 * `GET /models` is INFORMATIONAL: it fills `modelsTested` and can prove a bad key, but it never
 * vetoes the run. Anthropic-compat proxies and some Azure deployments legitimately lack it.
 */
async function runSequence(
  baseUrl: string,
  key: string | null,
  model: string,
  opts: ProbeOptions,
): Promise<ProbeResult> {
  const base = baseUrl.replace(/\/$/, '');
  const started = performance.now();
  const r = new Runner(
    opts.stepTimeoutMs ?? STEP_TIMEOUT_MS,
    opts.budgetMs ?? BUDGET_MS,
    opts.signal,
  );
  const caps = empty();
  const done = (ok: boolean, error: string | null): ProbeResult => ({
    ...caps,
    ok,
    error,
    ms: Math.round(performance.now() - started),
    steps: r.steps,
  });

  // ---- 1. GET /models — informational only ----
  const models = await r.call(`${base}/models`, key, null);
  if (models.error) {
    r.record('models', 'error', models.ms, models.error);
  } else if (models.status === 401 || models.status === 403) {
    // The one fatal case: the key is rejected, so every later step would lie.
    r.record('models', 'error', models.ms, `HTTP ${models.status} — API key ditolak`);
    return done(false, `${models.status} — API key ditolak: periksa API key penyedia`);
  } else if (models.status === 200) {
    const data = (models.json?.data ?? []) as { id?: string }[];
    caps.modelsTested = data
      .map((m) => m.id ?? '')
      .filter((id) => MODEL_ID.test(id))
      .sort();
    r.record('models', 'ok', models.ms, `${caps.modelsTested.length} model`);
  } else {
    r.record('models', 'unsupported', models.ms, `HTTP ${models.status} — tanpa daftar model`);
  }

  // ---- 2. POST /responses ----
  const responsesBody = {
    model,
    input: 'ping',
    max_output_tokens: PROBE_TOKENS,
    stream: false,
  };
  const resp = await r.call(`${base}/responses`, key, responsesBody);
  const respPresence = presenceOf(resp, 'input');
  if (respPresence === 'auth') {
    r.record('responses', 'error', resp.ms, `HTTP ${resp.status} — API key ditolak`);
    return done(false, `${resp.status} — API key ditolak: periksa API key penyedia`);
  }
  caps.endpoints.responses = respPresence === 'present';
  r.record(
    'responses',
    respPresence === 'present' ? 'ok' : respPresence === 'absent' ? 'unsupported' : 'error',
    resp.ms,
    respPresence === 'present'
      ? null
      : (resp.error ?? `HTTP ${resp.status} ${clip(resp.text, 120)}`),
  );

  // ---- 3. POST /chat/completions ----
  const chatBody = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: PROBE_TOKENS,
    temperature: 0,
    stream: false,
  };
  const chat = await r.call(`${base}/chat/completions`, key, chatBody);
  const chatPresence = presenceOf(chat, 'messages');
  if (chatPresence === 'auth') {
    r.record('chat_completions', 'error', chat.ms, `HTTP ${chat.status} — API key ditolak`);
    return done(false, `${chat.status} — API key ditolak: periksa API key penyedia`);
  }
  caps.endpoints.chatCompletions = chatPresence === 'present';
  r.record(
    'chat_completions',
    chatPresence === 'present' ? 'ok' : chatPresence === 'absent' ? 'unsupported' : 'error',
    chat.ms,
    chatPresence === 'present'
      ? null
      : (chat.error ?? `HTTP ${chat.status} ${clip(chat.text, 120)}`),
  );

  caps.preferredEndpoint = caps.endpoints.responses
    ? 'responses'
    : caps.endpoints.chatCompletions
      ? 'chat_completions'
      : null;

  if (!caps.preferredEndpoint) {
    const why =
      resp.error ??
      chat.error ??
      `tidak ada endpoint yang menjawab (responses: ${resp.status}, chat: ${chat.status})`;
    return done(false, why);
  }

  // ---- 4. stream probe, on the preferred endpoint ----
  if (r.spent) {
    r.skip('stream', 'anggaran waktu habis');
  } else if (caps.preferredEndpoint === 'responses') {
    const f = await r.firstFrame(`${base}/responses`, key, { ...responsesBody, stream: true });
    caps.stream.supported = f.ok;
    caps.stream.sse = f.sse;
    caps.stream.responsesStream = f.ok;
    r.record('stream', f.ok ? 'ok' : 'unsupported', f.ms, f.note);
  } else {
    const f = await r.firstFrame(`${base}/chat/completions`, key, {
      ...chatBody,
      stream: true,
      stream_options: { include_usage: true },
    });
    caps.stream.supported = f.ok;
    caps.stream.sse = f.sse;
    r.record('stream', f.ok ? 'ok' : 'unsupported', f.ms, f.note);
  }

  // ---- 5. reasoning probe — only meaningful on /responses ----
  // No `temperature` here: o1/o3-class models reject anything but the default.
  if (!caps.endpoints.responses) {
    r.skip('reasoning', 'butuh /responses');
  } else if (r.spent) {
    r.skip('reasoning', 'anggaran waktu habis');
  } else {
    const nested = await r.call(`${base}/responses`, key, {
      model,
      input: 'ping',
      max_output_tokens: REASONING_TOKENS,
      reasoning: { effort: 'low' },
    });
    if (nested.status === 200 && sawReasoning(nested)) {
      caps.reasoning = { supported: true, param: 'reasoning', via: 'responses' };
      r.record('reasoning', 'ok', nested.ms, 'param `reasoning`');
    } else if (nested.status === 200) {
      // Accepted the field but reported nothing: the model simply is not a reasoning model.
      r.record('reasoning', 'unsupported', nested.ms, 'diterima tetapi tanpa reasoning_tokens');
    } else if (unknownField(nested.text, 'reasoning') && !r.spent) {
      const flat = await r.call(`${base}/responses`, key, {
        model,
        input: 'ping',
        max_output_tokens: REASONING_TOKENS,
        reasoning_effort: 'low',
      });
      const ok = flat.status === 200 && sawReasoning(flat);
      if (ok) caps.reasoning = { supported: true, param: 'reasoning_effort', via: 'responses' };
      r.record(
        'reasoning',
        ok ? 'ok' : 'unsupported',
        nested.ms + flat.ms,
        ok ? 'param `reasoning_effort`' : 'kedua bentuk param ditolak',
      );
    } else {
      r.record(
        'reasoning',
        'unsupported',
        nested.ms,
        nested.error ?? `HTTP ${nested.status} ${clip(nested.text, 120)}`,
      );
    }
  }

  // ---- 6. tools probe, on the preferred endpoint ----
  if (r.spent) {
    r.skip('tools', 'anggaran waktu habis');
  } else if (caps.preferredEndpoint === 'responses') {
    const a = await r.call(`${base}/responses`, key, {
      ...responsesBody,
      tools: [
        {
          type: 'function',
          name: 'probe_noop',
          description: 'noop',
          parameters: { type: 'object', properties: {} },
        },
      ],
      tool_choice: 'auto',
    });
    const supported = a.status === 200 && !unknownField(a.text, 'tools');
    caps.tools = {
      supported,
      functionCalling: supported && sawToolCall(a),
      via: supported ? 'responses' : null,
    };
    r.record(
      'tools',
      supported ? 'ok' : 'unsupported',
      a.ms,
      supported ? null : (a.error ?? `HTTP ${a.status} ${clip(a.text, 120)}`),
    );
  } else {
    const a = await r.call(`${base}/chat/completions`, key, {
      ...chatBody,
      tools: [
        {
          type: 'function',
          function: {
            name: 'probe_noop',
            description: 'noop',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });
    const supported = a.status === 200 && !unknownField(a.text, 'tools');
    caps.tools = {
      supported,
      functionCalling: supported && sawToolCall(a),
      via: supported ? 'chat_completions' : null,
    };
    r.record(
      'tools',
      supported ? 'ok' : 'unsupported',
      a.ms,
      supported ? null : (a.error ?? `HTTP ${a.status} ${clip(a.text, 120)}`),
    );
  }

  return done(true, null);
}

/**
 * Public entry point. A cancelled probe (the admin closed the tab, the CLI was interrupted) is a
 * normal outcome, not an exception the callers should each have to catch.
 */
export async function probeCapabilities(
  baseUrl: string,
  key: string | null,
  model: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  try {
    return await runSequence(baseUrl, key, model, opts);
  } catch (err) {
    if (err instanceof ProbeAborted) {
      return { ...empty(), ok: false, error: 'probe dibatalkan', ms: 0, steps: [] };
    }
    throw err;
  }
}

/**
 * Read a stored `ai_providers.capabilities` value back into the type. The column is JSON, but a
 * stored matrix is only ever as trustworthy as the version that wrote it — an older release, or
 * MariaDB handing back the raw longtext — so every field is checked and anything unrecognised
 * degrades to null (which callers treat as "never probed", i.e. the pre-F1 behaviour).
 */
export function capabilitiesOf(raw: unknown): Capabilities | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const obj = (k: string) =>
    o[k] && typeof o[k] === 'object' ? (o[k] as Record<string, unknown>) : {};
  const bool = (src: Record<string, unknown>, k: string) => src[k] === true;
  const endpoints = obj('endpoints');
  const stream = obj('stream');
  const reasoning = obj('reasoning');
  const tools = obj('tools');
  const param = reasoning.param;
  const endpoint = (x: unknown): Endpoint | null =>
    x === 'responses' || x === 'chat_completions' ? x : null;
  return {
    endpoints: {
      responses: bool(endpoints, 'responses'),
      chatCompletions: bool(endpoints, 'chatCompletions'),
    },
    stream: {
      supported: bool(stream, 'supported'),
      sse: bool(stream, 'sse'),
      responsesStream: bool(stream, 'responsesStream'),
    },
    reasoning: {
      supported: bool(reasoning, 'supported'),
      param: param === 'reasoning' || param === 'reasoning_effort' ? param : null,
      via: endpoint(reasoning.via),
    },
    tools: {
      supported: bool(tools, 'supported'),
      functionCalling: bool(tools, 'functionCalling'),
      via: endpoint(tools.via),
    },
    modelsTested: Array.isArray(o.modelsTested)
      ? o.modelsTested.filter((m): m is string => typeof m === 'string' && MODEL_ID.test(m))
      : [],
    preferredEndpoint: endpoint(o.preferredEndpoint),
  };
}

/** The matrix as it is stored and exposed — the probe's own bookkeeping stays out of the column. */
export const toStored = (r: ProbeResult): Capabilities => ({
  endpoints: r.endpoints,
  stream: r.stream,
  reasoning: r.reasoning,
  tools: r.tools,
  modelsTested: r.modelsTested,
  preferredEndpoint: r.preferredEndpoint,
});

/**
 * §3 rule 2: modern endpoint plus something to use it for. Presentation only — never let this
 * reorder `enabledProviders`, or the tenant's default provider would drift (§3, §7.6).
 */
export const isRecommended = (c: Capabilities): boolean =>
  c.preferredEndpoint === 'responses' && (c.reasoning.supported || c.tools.supported);

/**
 * Translation between the chat-completions shape the AI module speaks internally and the modern
 * Responses API (AI-Roadmap F2). The conversation, the tool loop and the outward SSE frames all
 * stay chat-shaped: only the wire to the provider changes, so neither the web client nor the
 * stored messages know which endpoint served a turn.
 *
 * Shapes here were verified against a live provider on 2026-09-10 (AI-Roadmap §12), not taken
 * from memory. What was NOT verified is marked at its definition.
 *
 * Dependency-free like `probe.ts`: pure data in, pure data out.
 */

/** OpenAI content parts: text plus images (H-11 attachments reach vision models this way). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Provider-side message: OpenAI chat shape, including the tool round-trip (I-3). */
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** Chat-shaped tool definition, as `toOpenAiTools` produces it. */
export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

/** Responses flattens the function definition one level — no nested `function` object. */
export interface ResponsesTool {
  type: 'function';
  name: string;
  description: string;
  parameters: unknown;
}

export type ResponsesItem =
  | { type: 'message'; role: 'user' | 'assistant'; content: string | ResponsesContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string };

const textOf = (content: ProviderMessage['content']): string => {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('');
};

/**
 * Chat messages → the Responses request. `system` turns become `instructions`; everything else
 * becomes an `input[]` item.
 *
 * The tool round-trip is the part that does NOT map one-to-one: Responses has no `tool` role.
 * An assistant turn's `tool_calls` become `function_call` items and each `tool` reply becomes a
 * `function_call_output` keyed by the same `call_id` — verified end to end (§12 no. 3).
 */
export function toResponsesInput(messages: readonly ProviderMessage[]): {
  instructions: string | null;
  input: ResponsesItem[];
} {
  const instructions =
    messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .filter(Boolean)
      .join('\n\n') || null;
  const input: ResponsesItem[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      // A tool reply with no call id cannot be addressed; dropping it is better than sending an
      // item the provider will reject and losing the whole turn.
      if (m.tool_call_id) {
        input.push({
          type: 'function_call_output',
          call_id: m.tool_call_id,
          output: textOf(m.content),
        });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const text = textOf(m.content);
      if (text) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
      }
      for (const c of m.tool_calls ?? []) {
        input.push({
          type: 'function_call',
          call_id: c.id,
          name: c.function.name,
          arguments: c.function.arguments || '{}',
        });
      }
      continue;
    }
    // user
    if (typeof m.content === 'string' || m.content === null) {
      input.push({ type: 'message', role: 'user', content: m.content ?? '' });
      continue;
    }
    // H-11 attachments. Half verified (2026-09-10, §12.3): the content-parts form with
    // `input_text` is accepted by a live provider, but `input_image` is rejected with a 400 by
    // that gateway before the API ever sees it — for a data URI and an https URL alike. So the
    // shape below is still the documented one, not a proven one, and an attachment sent to such
    // a gateway surfaces as an upstream 400.
    const parts: ResponsesContentPart[] = m.content.map((c) =>
      c.type === 'text'
        ? { type: 'input_text', text: c.text }
        : { type: 'input_image', image_url: c.image_url.url },
    );
    input.push({ type: 'message', role: 'user', content: parts });
  }
  return { instructions, input };
}

export const toResponsesTools = (tools: readonly ChatTool[]): ResponsesTool[] =>
  tools.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Responses `usage` → the chat-shaped `Usage` the call log already speaks, applying the
 * inclusive/exclusive rule of AI-Roadmap §5.1a.
 *
 * Providers disagree on whether `output_tokens` already contains the reasoning tokens, and the
 * numbers they send say which convention they follow: when `text + reasoning == output` the
 * reasoning is already counted, when `text == output` it is not and must be added. Billing the
 * raw `output_tokens` on an exclusive provider undercounts by roughly half on a reasoning model.
 */
export function normalizeUsage(raw: unknown): {
  usage: Usage | null;
  reasoningTokens: number | null;
} {
  if (!raw || typeof raw !== 'object') return { usage: null, reasoningTokens: null };
  const u = raw as Record<string, unknown>;
  const details = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  const input = num(u.input_tokens) ?? num(u.prompt_tokens);
  const output = num(u.output_tokens) ?? num(u.completion_tokens);
  const reasoning = num(details.reasoning_tokens);
  const text = num(details.text_tokens);
  let completion = output;
  // Exclusive convention: the provider's own `text_tokens` equals its `output_tokens`, so the
  // reasoning it reports is on top of that and must be added. Every other case — including no
  // `text_tokens` at all — keeps `output_tokens`, the documented (inclusive) convention and the
  // provider's own headline number.
  if (output !== null && reasoning !== null && reasoning > 0 && text === output) {
    completion = output + reasoning;
  }
  if (input === null && completion === null) return { usage: null, reasoningTokens: reasoning };
  return {
    usage: {
      ...(input === null ? {} : { prompt_tokens: input }),
      ...(completion === null ? {} : { completion_tokens: completion }),
    },
    reasoningTokens: reasoning,
  };
}

export interface ResponsesReply {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  reasoningTokens: number | null;
}

interface OutputItem {
  type?: string;
  role?: string;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string }[];
}

/** A non-streaming Responses body → the pieces the chat loop needs. */
export function readResponsesReply(body: unknown): ResponsesReply {
  const j = (body ?? {}) as { output?: OutputItem[]; output_text?: unknown; usage?: unknown };
  const output = Array.isArray(j.output) ? j.output : [];
  // `output_text` is a convenience field the provider fills with the answer text (§12 no. 1);
  // fall back to walking `output[]` for providers that omit it.
  const content =
    typeof j.output_text === 'string' && j.output_text
      ? j.output_text
      : output
          .filter((o) => o.type === 'message')
          .flatMap((o) => o.content ?? [])
          .filter((c) => c.type === 'output_text')
          .map((c) => c.text ?? '')
          .join('');
  const toolCalls: ToolCall[] = output
    .filter((o) => o.type === 'function_call' && o.name)
    .map((o) => ({
      id: o.call_id || o.id || '',
      type: 'function' as const,
      function: { name: o.name ?? '', arguments: o.arguments ?? '{}' },
    }))
    .filter((c) => c.id);
  const { usage, reasoningTokens } = normalizeUsage(j.usage);
  return { content, toolCalls, usage, reasoningTokens };
}

/** What one Responses SSE event contributes. Everything unrecognised contributes nothing. */
export interface ResponsesEvent {
  /** Answer text to append and forward to the client. */
  text?: string;
  /** A completed function call. */
  toolCall?: ToolCall;
  usage?: Usage | null;
  reasoningTokens?: number | null;
  /** The provider reported a failure mid-stream. */
  error?: string;
  done?: boolean;
}

/**
 * One Responses SSE payload → what it means for us.
 *
 * The filtering is the point. A real turn emits `response.reasoning_summary_text.delta` BEFORE
 * the answer (§12 no. 2): forwarding every `*.delta` would pour the model's reasoning summary
 * into the answer bubble. Only `response.output_text.delta` is answer text.
 */
export function parseResponsesEvent(payload: string): ResponsesEvent {
  if (!payload || payload === '[DONE]') return { done: payload === '[DONE]' };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
  const type = typeof j.type === 'string' ? j.type : '';
  switch (type) {
    case 'response.output_text.delta':
      return typeof j.delta === 'string' ? { text: j.delta } : {};
    case 'response.output_item.done': {
      const item = (j.item ?? {}) as OutputItem;
      if (item.type !== 'function_call' || !item.name) return {};
      const id = item.call_id || item.id || '';
      return id
        ? {
            toolCall: {
              id,
              type: 'function',
              function: { name: item.name, arguments: item.arguments ?? '{}' },
            },
          }
        : {};
    }
    case 'response.completed':
    case 'response.incomplete': {
      const response = (j.response ?? {}) as { usage?: unknown };
      const { usage, reasoningTokens } = normalizeUsage(response.usage);
      return { usage, reasoningTokens, done: true };
    }
    case 'error':
    case 'response.failed': {
      const response = (j.response ?? {}) as { error?: { message?: string } };
      const err = (j.error ?? response.error ?? {}) as { message?: string };
      return { error: err.message || 'penyedia melaporkan kegagalan' };
    }
    default:
      // response.created / in_progress / content_part.* / output_item.added /
      // reasoning_summary_*.* / output_text.done — bookkeeping, not answer text.
      return {};
  }
}

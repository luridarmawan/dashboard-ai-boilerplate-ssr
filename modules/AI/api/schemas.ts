import { t } from 'elysia';

/** OpenAI-compatible request body (H-2) — the subset we validate; unknown fields pass through. */
export const ChatMessage = t.Object({
  role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant')]),
  content: t.String({ maxLength: 200000 }),
});
export const ChatCompletionBody = t.Object({
  model: t.Optional(t.String({ maxLength: 120 })),
  messages: t.Array(ChatMessage, { minItems: 1, maxItems: 200 }),
  stream: t.Optional(t.Boolean()),
  temperature: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
  max_tokens: t.Optional(t.Integer({ minimum: 1, maximum: 128000 })),
  /** Our extension: persist into this conversation (H-6). Omit for a stateless call. */
  conversation_id: t.Optional(t.String({ maxLength: 36 })),
  /**
   * Our extension (H-10): the provider profile `code` to call. Omit to use the conversation's
   * provider, else the tenant's default profile, else the legacy `ai.*` settings.
   */
  provider: t.Optional(t.String({ maxLength: 40 })),
  /**
   * Our extension (I-3): offer the tools the caller may use to the model and run its tool calls
   * server-side. Defaults to the `ai.tools_enable` setting. Client-supplied `tools` arrays are
   * not accepted — tools are declared by modules, never by the request.
   */
  tools: t.Optional(t.Boolean()),
});
/** External MCP server registration (I-4, I-5). `headers` values are secrets: never echoed back. */
export const McpBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 191 }),
  code: t.String({ minLength: 2, maxLength: 40, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
  transport: t.Union([t.Literal('http'), t.Literal('sse')]),
  url: t.String({ minLength: 8, maxLength: 512, pattern: '^https?://' }),
  headers: t.Optional(t.Record(t.String({ maxLength: 100 }), t.String({ maxLength: 4000 }))),
  enabled: t.Optional(t.Boolean()),
});
export const McpUpdateBody = t.Partial(McpBody);
/** Provider + model selection for a conversation (H-10); `null` provider = tenant default. */
export const ConversationCreate = t.Object({
  provider: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  model: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
});
export const ConversationPatch = t.Object({
  title: t.Optional(t.String({ minLength: 1, maxLength: 191 })),
  archived: t.Optional(t.Boolean()),
  provider: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  model: t.Optional(t.Nullable(t.String({ maxLength: 120 }))),
});
/** One priced model of a provider profile (H-10). Prices are per 1M tokens in currency units. */
export const ModelBody = t.Object({
  model: t.String({ minLength: 1, maxLength: 120 }),
  label: t.Optional(t.Nullable(t.String({ maxLength: 191 }))),
  priceIn: t.Optional(t.Number({ minimum: 0, maximum: 1_000_000 })),
  priceOut: t.Optional(t.Number({ minimum: 0, maximum: 1_000_000 })),
  enabled: t.Optional(t.Boolean()),
});
/** Provider profile (H-10). `apiKey` is a secret: omitted or `***` keeps the stored one. */
export const ProviderBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 191 }),
  code: t.String({ minLength: 2, maxLength: 40, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
  baseUrl: t.String({ minLength: 8, maxLength: 512, pattern: '^https?://' }),
  apiKey: t.Optional(t.String({ maxLength: 4000 })),
  defaultModel: t.String({ minLength: 1, maxLength: 120 }),
  enabled: t.Optional(t.Boolean()),
  isDefault: t.Optional(t.Boolean()),
  models: t.Optional(t.Array(ModelBody, { maxItems: 100 })),
});
export const ProviderUpdateBody = t.Partial(ProviderBody);

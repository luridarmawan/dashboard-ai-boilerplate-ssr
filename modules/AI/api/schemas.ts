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
});
export const ConversationPatch = t.Object({
  title: t.Optional(t.String({ minLength: 1, maxLength: 191 })),
  archived: t.Optional(t.Boolean()),
});

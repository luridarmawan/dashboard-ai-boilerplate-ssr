import { publicLink } from '@app/api/mail';
import { type AuthState, clientIp } from '@app/api/plugins/auth';
import { requestContext } from '@app/api/plugins/request-context';
import { permission, tenantContext } from '@app/api/plugins/tenancy';
import { settings } from '@app/api/services';
import { writeAudit } from '@core/auth';
import {
  errorResponses,
  fail,
  Id,
  OkSchema,
  ok,
  PageSchema,
  page,
  pageMeta,
} from '@core/contracts';
import { and, count, desc, eq, isNull, newId, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { defineApiRoutes } from '@core/module-kit';
import { Elysia, t } from 'elysia';
import { ChatCompletionBody, ConversationPatch } from './schemas.ts';

/**
 * AI module API (H-1…H-9), mounted at /v1/m/ai. The provider is configuration (`ai.baseurl`,
 * `ai.key`, `ai.model`) — any OpenAI-compatible endpoint. `POST /chat/completions` proxies the
 * request; with `stream: true` the provider's SSE bytes flow straight through (provider → API →
 * SvelteKit → UI) and the upstream request is aborted when the client goes away (H-3). Every call
 * is logged AFTER the response is done, never on the hot path (H-9).
 */

type Row = typeof schema.aiConversations.$inferSelect;
const Conversation = t.Object({
  id: t.String(),
  title: t.String(),
  model: t.Nullable(t.String()),
  archivedAt: t.Nullable(t.String()),
  lastMessageAt: t.Nullable(t.String()),
  createdAt: t.String(),
});
const Message = t.Object({
  id: t.String(),
  role: t.String(),
  content: t.String(),
  createdAt: t.String(),
});
const view = (c: Row) => ({
  id: c.id,
  title: c.title,
  model: c.model,
  archivedAt: c.archived_at?.toISOString() ?? null,
  lastMessageAt: c.last_message_at?.toISOString() ?? null,
  createdAt: c.created_at.toISOString(),
});

interface Provider {
  baseurl: string;
  key: string | null;
  model: string;
  systemPrompt: string | null;
  maxTokens: number;
  priceIn: number;
  priceOut: number;
}
async function providerFor(clientId: string | null): Promise<Provider> {
  return {
    baseurl: (
      (await settings.get<string | null>(clientId, 'ai.baseurl')) ?? 'https://api.openai.com/v1'
    ).replace(/\/$/, ''),
    key: (await settings.get<string | null>(clientId, 'ai.key')) || null,
    model: (await settings.get<string | null>(clientId, 'ai.model')) ?? 'gpt-4o-mini',
    systemPrompt: (await settings.get<string | null>(clientId, 'ai.system_prompt')) || null,
    maxTokens: (await settings.get<number | null>(clientId, 'ai.max_tokens')) ?? 1024,
    priceIn: (await settings.get<number | null>(clientId, 'ai.price_in_per_mtok')) ?? 0,
    priceOut: (await settings.get<number | null>(clientId, 'ai.price_out_per_mtok')) ?? 0,
  };
}

interface CallLog {
  clientId: string;
  userId: string | null;
  conversationId: string | null;
  endpoint: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  firstTokenMs: number | null;
  status: 'ok' | 'error' | 'cancelled';
  error?: string | null;
  streamed: boolean;
  priceIn: number;
  priceOut: number;
}
/** H-9: fire-and-forget — the response is already on its way; a failed log line is logged, never thrown. */
function logCall(c: CallLog): void {
  const cost =
    c.tokensIn !== null && c.tokensOut !== null && (c.priceIn || c.priceOut)
      ? Math.round(((c.tokensIn * c.priceIn + c.tokensOut * c.priceOut) / 1_000_000) * 1_000_000)
      : null;
  queueMicrotask(() => {
    unsafeAcrossTenants()
      .insert(schema.aiCalls)
      .values({
        id: newId(),
        client_id: c.clientId,
        user_id: c.userId,
        conversation_id: c.conversationId,
        endpoint: c.endpoint,
        model: c.model,
        tokens_in: c.tokensIn,
        tokens_out: c.tokensOut,
        tokens_total: c.tokensIn !== null && c.tokensOut !== null ? c.tokensIn + c.tokensOut : null,
        latency_ms: c.latencyMs,
        first_token_ms: c.firstTokenMs,
        status: c.status,
        error: c.error ?? null,
        cost_micro: cost,
        streamed: c.streamed,
      })
      .catch((err) =>
        logger.warn('ai: call log failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  });
}

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export default defineApiRoutes(
  'AI',
  new Elysia({ name: 'module:ai', tags: ['module:ai'] })
    .use(requestContext)
    .use(tenantContext)

    // ---- chat (H-2, H-3, H-4, H-5, H-6, H-9) ----
    .post(
      '/chat/completions',
      async ({ auth, body, set, request, requestId, tenantState }) => {
        const a = auth as AuthState;
        const clientId = tenantState?.clientId ?? null;
        if (!clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        if ((await settings.get<boolean | null>(clientId, 'ai.enable')) === false) {
          set.status = 403;
          return fail(
            'forbidden',
            'Asisten AI dimatikan lewat konfigurasi (ai.enable)',
            requestId,
            { reason: 'ai_disabled' },
          );
        }
        const p = await providerFor(clientId);
        if (!p.key) {
          // H-4: actionable, not generic.
          set.status = 422;
          return fail(
            'validation_failed',
            'API key AI belum diisi — isi ai.key di Pengaturan → AI',
            requestId,
            { reason: 'no_api_key', settings: publicLink('/settings') },
          );
        }
        const messages = [...body.messages];
        if (p.systemPrompt && !messages.some((m) => m.role === 'system'))
          messages.unshift({ role: 'system', content: p.systemPrompt });
        const model = body.model ?? p.model;
        const tenant = tenantState?.tenant;

        // Persistence (H-6): the user's message now; the assistant's when the reply is complete.
        let conversationId: string | null = null;
        if (body.conversation_id && tenant) {
          const conv = await tenant.selectOne(
            schema.aiConversations,
            and(
              eq(schema.aiConversations.id, body.conversation_id),
              eq(schema.aiConversations.user_id, a.user.id),
              isNull(schema.aiConversations.deleted_at),
            ),
          );
          if (!conv) {
            set.status = 404;
            return fail('not_found', 'Percakapan tidak ditemukan', requestId);
          }
          conversationId = conv.id;
          const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
          if (lastUser) {
            await tenant.insert(schema.aiMessages, {
              id: newId(),
              conversation_id: conv.id,
              role: 'user',
              content: lastUser.content,
              tokens_in: estimateTokens(lastUser.content),
            });
            const patch: Partial<typeof schema.aiConversations.$inferInsert> = {
              last_message_at: new Date(),
              model,
            };
            if (conv.title === 'Percakapan baru' || conv.title === 'New conversation')
              patch.title = lastUser.content.replace(/\s+/g, ' ').trim().slice(0, 80) || conv.title;
            await tenant.update(
              schema.aiConversations,
              patch,
              eq(schema.aiConversations.id, conv.id),
            );
          }
        }

        const started = performance.now();
        const upstream = new AbortController();
        // H-3: when the browser goes away, the upstream request goes away.
        request.signal.addEventListener('abort', () => upstream.abort(), { once: true });
        let res: Response;
        try {
          res = await fetch(`${p.baseurl}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${p.key}`,
              accept: body.stream ? 'text/event-stream' : 'application/json',
            },
            body: JSON.stringify({
              model,
              messages,
              stream: !!body.stream,
              temperature: body.temperature,
              max_tokens: body.max_tokens ?? p.maxTokens,
              ...(body.stream ? { stream_options: { include_usage: true } } : {}),
            }),
            signal: upstream.signal,
          });
        } catch (err) {
          const cancelled = upstream.signal.aborted;
          logCall({
            clientId,
            userId: a.user.id,
            conversationId,
            endpoint: 'chat.completions',
            model,
            tokensIn: null,
            tokensOut: null,
            latencyMs: Math.round(performance.now() - started),
            firstTokenMs: null,
            status: cancelled ? 'cancelled' : 'error',
            error: err instanceof Error ? err.message : String(err),
            streamed: !!body.stream,
            priceIn: p.priceIn,
            priceOut: p.priceOut,
          });
          set.status = 502;
          return fail(
            'service_unavailable',
            `Penyedia AI tidak terjangkau (${p.baseurl})`,
            requestId,
          );
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          logCall({
            clientId,
            userId: a.user.id,
            conversationId,
            endpoint: 'chat.completions',
            model,
            tokensIn: null,
            tokensOut: null,
            latencyMs: Math.round(performance.now() - started),
            firstTokenMs: null,
            status: 'error',
            error: `${res.status} ${text.slice(0, 500)}`,
            streamed: !!body.stream,
            priceIn: p.priceIn,
            priceOut: p.priceOut,
          });
          set.status = res.status === 401 || res.status === 403 ? 422 : 502;
          return fail(
            res.status === 401 || res.status === 403 ? 'validation_failed' : 'service_unavailable',
            res.status === 401 || res.status === 403
              ? 'API key AI ditolak penyedia — periksa ai.key'
              : `Penyedia AI menjawab ${res.status}`,
            requestId,
            { upstream: text.slice(0, 300) },
          );
        }

        const finish = async (
          assistant: string,
          usage: { prompt_tokens?: number; completion_tokens?: number } | null,
          status: 'ok' | 'cancelled',
          firstTokenMs: number | null,
        ) => {
          const tokensIn =
            usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join('\n'));
          const tokensOut = usage?.completion_tokens ?? estimateTokens(assistant);
          if (conversationId && tenant && assistant) {
            await tenant
              .insert(schema.aiMessages, {
                id: newId(),
                conversation_id: conversationId,
                role: 'assistant',
                content: assistant,
                tokens_out: tokensOut,
              })
              .catch((err) => logger.warn('ai: persist reply failed', { error: String(err) }));
          }
          logCall({
            clientId,
            userId: a.user.id,
            conversationId,
            endpoint: 'chat.completions',
            model,
            tokensIn,
            tokensOut,
            latencyMs: Math.round(performance.now() - started),
            firstTokenMs,
            status,
            streamed: !!body.stream,
            priceIn: p.priceIn,
            priceOut: p.priceOut,
          });
        };

        if (!body.stream) {
          const json = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const content = json.choices?.[0]?.message?.content ?? '';
          void finish(content, json.usage ?? null, 'ok', null);
          return json as unknown as Record<string, unknown>;
        }

        // Streaming: pass the SSE bytes through untouched while tee-ing them to assemble the reply.
        const decoder = new TextDecoder();
        let assistant = '';
        let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
        let firstTokenMs: number | null = null;
        let buffer = '';
        const body_ = res.body as ReadableStream<Uint8Array>;
        const tapped = body_.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(chunk);
              buffer += decoder.decode(chunk, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                try {
                  const j = JSON.parse(data) as {
                    choices?: { delta?: { content?: string } }[];
                    usage?: typeof usage;
                  };
                  const delta = j.choices?.[0]?.delta?.content;
                  if (delta) {
                    if (firstTokenMs === null)
                      firstTokenMs = Math.round(performance.now() - started);
                    assistant += delta;
                  }
                  if (j.usage) usage = j.usage;
                } catch {
                  /* partial or non-JSON line */
                }
              }
            },
            flush() {
              void finish(assistant, usage, 'ok', firstTokenMs);
            },
          }),
        );
        upstream.signal.addEventListener(
          'abort',
          () => void finish(assistant, usage, 'cancelled', firstTokenMs),
          { once: true },
        );
        set.headers['content-type'] = 'text/event-stream';
        set.headers['cache-control'] = 'no-cache';
        set.headers['x-accel-buffering'] = 'no';
        return new Response(tapped, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'x-accel-buffering': 'no',
            'x-request-id': requestId,
          },
        });
      },
      {
        beforeHandle: permission('ai.chat.create'),
        body: ChatCompletionBody,
        // The body is the provider's own shape (JSON, or an SSE stream): documented as opaque.
        response: { 200: t.Unknown(), ...errorResponses },
        detail: {
          summary:
            'OpenAI-compatible chat completions proxied to the configured provider; stream: true streams SSE (H-2, H-3)',
        },
      },
    )

    // ---- conversations (H-6, H-7) ----
    .get(
      '/conversations',
      async ({ auth, query, tenantState }) => {
        const a = auth as AuthState;
        if (!tenantState?.tenant) return page([], pageMeta(1, 50, 0));
        const rows = await tenantState.tenant.select(
          schema.aiConversations,
          and(
            eq(schema.aiConversations.user_id, a.user.id),
            isNull(schema.aiConversations.deleted_at),
            query.archived === '1' ? undefined : isNull(schema.aiConversations.archived_at),
          ),
        );
        const q = query.q?.toLowerCase();
        const list = rows
          .filter((r) => !q || r.title.toLowerCase().includes(q))
          .sort(
            (x, y) =>
              (y.last_message_at?.getTime() ?? y.created_at.getTime()) -
              (x.last_message_at?.getTime() ?? x.created_at.getTime()),
          );
        return page(list.map(view), pageMeta(1, Math.max(1, list.length), list.length));
      },
      {
        beforeHandle: permission('ai.chat.read'),
        query: t.Object({
          q: t.Optional(t.String({ maxLength: 191 })),
          archived: t.Optional(t.String()),
        }),
        response: { 200: PageSchema(Conversation), ...errorResponses },
        detail: {
          summary:
            'My conversations, newest first; ?q= searches titles; ?archived=1 includes archived',
        },
      },
    )
    .post(
      '/conversations',
      async ({ auth, set, requestId, tenantState }) => {
        const a = auth as AuthState;
        if (!tenantState?.tenant) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const id = newId();
        await tenantState.tenant.insert(schema.aiConversations, {
          id,
          user_id: a.user.id,
          title: 'Percakapan baru',
          model: null,
        });
        const row = (await tenantState.tenant.selectOne(
          schema.aiConversations,
          eq(schema.aiConversations.id, id),
        )) as Row;
        set.status = 201;
        return ok(view(row));
      },
      {
        beforeHandle: permission('ai.chat.create'),
        response: { 201: OkSchema(Conversation), ...errorResponses },
        detail: { summary: 'Start a conversation (title is set from the first message)' },
      },
    )
    .get(
      '/conversations/:id',
      async ({ auth, params, set, requestId, tenantState }) => {
        const a = auth as AuthState;
        const conv = tenantState?.tenant
          ? await tenantState.tenant.selectOne(
              schema.aiConversations,
              and(
                eq(schema.aiConversations.id, params.id),
                eq(schema.aiConversations.user_id, a.user.id),
                isNull(schema.aiConversations.deleted_at),
              ),
            )
          : null;
        if (!conv || !tenantState?.tenant) {
          set.status = 404;
          return fail('not_found', 'Percakapan tidak ditemukan', requestId);
        }
        const msgs = await tenantState.tenant.select(
          schema.aiMessages,
          eq(schema.aiMessages.conversation_id, conv.id),
        );
        return ok({
          ...view(conv),
          messages: msgs
            .sort((x, y) => x.created_at.getTime() - y.created_at.getTime())
            .map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.created_at.toISOString(),
            })),
        });
      },
      {
        beforeHandle: permission('ai.chat.read'),
        params: t.Object({ id: Id }),
        response: {
          200: OkSchema(t.Intersect([Conversation, t.Object({ messages: t.Array(Message) })])),
          ...errorResponses,
        },
        detail: { summary: 'One conversation with its messages' },
      },
    )
    .patch(
      '/conversations/:id',
      async ({ auth, params, body, set, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const conv = tenant
          ? await tenant.selectOne(
              schema.aiConversations,
              and(
                eq(schema.aiConversations.id, params.id),
                eq(schema.aiConversations.user_id, a.user.id),
                isNull(schema.aiConversations.deleted_at),
              ),
            )
          : null;
        if (!conv || !tenant) {
          set.status = 404;
          return fail('not_found', 'Percakapan tidak ditemukan', requestId);
        }
        const patch: Partial<typeof schema.aiConversations.$inferInsert> = {};
        if (body.title !== undefined) patch.title = body.title;
        if (body.archived !== undefined) patch.archived_at = body.archived ? new Date() : null;
        if (Object.keys(patch).length)
          await tenant.update(
            schema.aiConversations,
            patch,
            eq(schema.aiConversations.id, conv.id),
          );
        return ok(
          view(
            (await tenant.selectOne(
              schema.aiConversations,
              eq(schema.aiConversations.id, conv.id),
            )) as Row,
          ),
        );
      },
      {
        beforeHandle: permission('ai.chat.create'),
        params: t.Object({ id: Id }),
        body: ConversationPatch,
        response: { 200: OkSchema(Conversation), ...errorResponses },
        detail: { summary: 'Rename or (un)archive a conversation' },
      },
    )
    .delete(
      '/conversations/:id',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const n = tenant
          ? await tenant.update(
              schema.aiConversations,
              { deleted_at: new Date() },
              and(
                eq(schema.aiConversations.id, params.id),
                eq(schema.aiConversations.user_id, a.user.id),
                isNull(schema.aiConversations.deleted_at),
              ),
            )
          : 0;
        if (!n || !tenantState?.clientId) {
          set.status = 404;
          return fail('not_found', 'Percakapan tidak ditemukan', requestId);
        }
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.conversation.delete',
          resource: 'ai.chat',
          resourceId: params.id,
          ip: clientIp(request, server),
          requestId,
        });
        return ok({ deleted: true as const });
      },
      {
        beforeHandle: permission('ai.chat.create'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
        detail: { summary: 'Soft-delete a conversation' },
      },
    )

    // ---- call log (H-9) ----
    .get(
      '/logs',
      async ({ query, tenantState }) => {
        if (!tenantState?.clientId) return page([], pageMeta(1, 20, 0));
        const db = unsafeAcrossTenants(); // paging; tenant condition explicit
        const p = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
        const where = eq(schema.aiCalls.client_id, tenantState.clientId);
        const [tot] = await db.select({ n: count() }).from(schema.aiCalls).where(where);
        const rows = await db
          .select()
          .from(schema.aiCalls)
          .where(where)
          .orderBy(desc(schema.aiCalls.created_at))
          .limit(limit)
          .offset((p - 1) * limit);
        return page(
          rows.map((r) => ({
            id: r.id,
            endpoint: r.endpoint,
            model: r.model,
            tokensIn: r.tokens_in,
            tokensOut: r.tokens_out,
            tokensTotal: r.tokens_total,
            latencyMs: r.latency_ms,
            firstTokenMs: r.first_token_ms,
            status: r.status,
            error: r.error,
            costMicro: r.cost_micro,
            streamed: r.streamed,
            createdAt: r.created_at.toISOString(),
          })),
          pageMeta(p, limit, Number(tot?.n ?? 0)),
        );
      },
      {
        beforeHandle: permission('ai.log.read'),
        query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }),
        response: {
          200: PageSchema(
            t.Object({
              id: t.String(),
              endpoint: t.String(),
              model: t.Nullable(t.String()),
              tokensIn: t.Nullable(t.Integer()),
              tokensOut: t.Nullable(t.Integer()),
              tokensTotal: t.Nullable(t.Integer()),
              latencyMs: t.Nullable(t.Integer()),
              firstTokenMs: t.Nullable(t.Integer()),
              status: t.String(),
              error: t.Nullable(t.String()),
              costMicro: t.Nullable(t.Integer()),
              streamed: t.Boolean(),
              createdAt: t.String(),
            }),
          ),
          ...errorResponses,
        },
        detail: { summary: 'AI call log of the active tenant (tokens, latency, status, cost)' },
      },
    ),
);

import { type FileRow, fileUrl, findFile, readFile, storeUpload } from '@app/api/files';
import { publicLink } from '@app/api/mail';
import { metrics } from '@app/api/metrics';
import { type AuthState, clientIp } from '@app/api/plugins/auth';
import { requestContext } from '@app/api/plugins/request-context';
import { permission, type TenantState, tenantContext } from '@app/api/plugins/tenancy';
import { settings } from '@app/api/services';
import {
  callTool,
  listTools,
  type ToolCaller,
  toOpenAiTools,
  toolResultText,
} from '@app/api/tools';
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
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  newId,
  schema,
  type TenantDb,
  unsafeAcrossTenants,
} from '@core/db';
import { logger } from '@core/logger';
import { defineApiRoutes, toolNameFromWire } from '@core/module-kit';
import { Elysia, t } from 'elysia';
import { discoverRemoteTools, wireSuffix } from './mcp-client.ts';
import { maskedHeaders, mcpToolSource, mergeHeaders, toolNameFor } from './mcp-tools.ts';
import {
  capabilitiesOf,
  isRecommended,
  type ProbeResult,
  probeCapabilities,
  toStored,
} from './probe.ts';
import {
  costMicro,
  enabledProviders,
  modelsOf,
  noteResponsesMissing,
  ProviderNotFound,
  type ProviderRow,
  resolveProvider,
  toPriceMicro,
} from './providers.ts';
import { adjustCredit, chargeCredit, checkQuota, creditLedger, creditOf } from './quota.ts';
import {
  type ProviderMessage,
  parseResponsesEvent,
  readResponsesReply,
  type ToolCall,
  toResponsesInput,
  toResponsesTools,
  type Usage,
} from './responses.ts';
import {
  ChatCompletionBody,
  ConversationCreate,
  ConversationPatch,
  McpBody,
  McpUpdateBody,
  ProviderBody,
  ProviderUpdateBody,
} from './schemas.ts';

/** What the UI is told about each tool call (`crk.tool` frames in the stream, `x_tools` in JSON). */
interface ToolTrace {
  name: string;
  ok: boolean;
  ms: number;
}
/** Rounds = provider calls per user turn; the last one is issued without tools so it must answer. */
const MAX_TOOL_ROUNDS = 5;
/** A tool result longer than this is truncated before it reaches the model's context. */
const TOOL_RESULT_MAX = 32_000;

/**
 * AI module API (H-1…H-9), mounted at /v1/m/ai. The provider is configuration (`ai.baseurl`,
 * `ai.key`, `ai.model`) — any OpenAI-compatible endpoint. `POST /chat/completions` proxies the
 * request; with `stream: true` the provider's SSE frames flow through (provider → API → SvelteKit
 * → UI) and the upstream request is aborted when the client goes away (H-3). Every call is logged
 * AFTER the response is done, never on the hot path (H-9).
 *
 * Tools (extension point 8, I-3): the tools the caller may see — module enabled for the tenant,
 * permission held — are offered to the model; a `tool_calls` reply is executed through the core
 * registry (`callTool`: permission + tenancy + schema, audited), the results are appended as
 * `tool` messages and the provider is called again, at most MAX_TOOL_ROUNDS times. Streaming
 * hides the intermediate `[DONE]`s and adds `crk.tool` frames so the UI can show what ran.
 */

type Row = typeof schema.aiConversations.$inferSelect;
const Conversation = t.Object({
  id: t.String(),
  title: t.String(),
  providerId: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  archivedAt: t.Nullable(t.String()),
  lastMessageAt: t.Nullable(t.String()),
  createdAt: t.String(),
});
const Attachment = t.Object({
  id: t.String(),
  fileId: t.String(),
  name: t.String(),
  mime: t.String(),
  size: t.Integer(),
  url: t.String(),
});
const Message = t.Object({
  id: t.String(),
  role: t.String(),
  content: t.String(),
  /** H-12: null at a root; siblings share a parent (regenerate / edit-branch). */
  parentId: t.Nullable(t.String()),
  attachments: t.Array(Attachment),
  createdAt: t.String(),
});
/** Attachments (H-11): what a chat user may send along; a text-like file is quoted, an image is shown. */
const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
] as const;
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_TEXT_MAX = 20_000;
const attachmentView = (r: typeof schema.aiAttachments.$inferSelect) => ({
  id: r.id,
  fileId: r.file_id,
  name: r.name,
  mime: r.mime,
  size: r.size,
  url: `/v1/files/${r.file_id}/content`,
});
/** What the model gets for the attachments: quoted text, and images as data URLs (H-11). */
async function attachmentContent(rows: FileRow[]): Promise<{ text: string; images: string[] }> {
  let text = '';
  const images: string[] = [];
  for (const row of rows) {
    const obj = await readFile(row);
    if (!obj) continue;
    if (row.mime.startsWith('image/')) {
      images.push(`data:${row.mime};base64,${Buffer.from(obj.bytes).toString('base64')}`);
    } else {
      const body = new TextDecoder().decode(obj.bytes);
      text += `\n\n[Lampiran: ${row.name}]\n${body.length > ATTACHMENT_TEXT_MAX ? `${body.slice(0, ATTACHMENT_TEXT_MAX)}… [dipotong]` : body}`;
    }
  }
  return { text, images };
}
const view = (c: Row) => ({
  id: c.id,
  title: c.title,
  providerId: c.provider_id,
  model: c.model,
  archivedAt: c.archived_at?.toISOString() ?? null,
  lastMessageAt: c.last_message_at?.toISOString() ?? null,
  createdAt: c.created_at.toISOString(),
});

interface CallLog {
  clientId: string;
  userId: string | null;
  conversationId: string | null;
  endpoint: string;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  firstTokenMs: number | null;
  status: 'ok' | 'error' | 'cancelled';
  error?: string | null;
  streamed: boolean;
  priceInMicro: number;
  priceOutMicro: number;
  /** Which UPSTREAM endpoint served it (F2) — not the local route named by `endpoint`. */
  upstreamEndpoint?: string | null;
  reasoningTokens?: number | null;
}
// Operational counters (M-6) beside the per-call log rows (H-9): provider/model/status only —
// never a user or tenant label.
const aiCallsTotal = metrics.counter(
  'ai_calls_total',
  'AI provider calls, by provider, model and status.',
  ['provider', 'model', 'status'],
);
const aiTokensTotal = metrics.counter('ai_tokens_total', 'Tokens exchanged with AI providers.', [
  'provider',
  'model',
  'direction',
]);
const aiCostMicroTotal = metrics.counter(
  'ai_cost_micro_total',
  'Estimated AI spend in micro-units of the configured currency.',
  ['provider', 'model'],
);

/** H-9: fire-and-forget — the response is already on its way; a failed log line is logged, never thrown. */
function logCall(c: CallLog): void {
  const cost = costMicro(c.tokensIn, c.tokensOut, c.priceInMicro, c.priceOutMicro);
  const labels = { provider: c.provider ?? 'settings', model: c.model ?? '' };
  aiCallsTotal.inc({ ...labels, status: c.status });
  if (c.tokensIn) aiTokensTotal.inc({ ...labels, direction: 'in' }, c.tokensIn);
  if (c.tokensOut) aiTokensTotal.inc({ ...labels, direction: 'out' }, c.tokensOut);
  if (cost) aiCostMicroTotal.inc(labels, cost);
  if (cost && c.status === 'ok')
    chargeCredit(c.clientId, cost).catch((err) =>
      logger.warn('ai: credit charge failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  queueMicrotask(() => {
    unsafeAcrossTenants()
      .insert(schema.aiCalls)
      .values({
        id: newId(),
        client_id: c.clientId,
        user_id: c.userId,
        conversation_id: c.conversationId,
        endpoint: c.endpoint,
        provider: c.provider,
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
        upstream_endpoint: c.upstreamEndpoint ?? null,
        reasoning_tokens: c.reasoningTokens ?? null,
      })
      .catch((err) =>
        logger.warn('ai: call log failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  });
}

const estimateTokens = (s: string) => Math.ceil(s.length / 4);

// ---- external MCP servers (I-4, I-5) ----
void mcpToolSource; // importing mcp-tools.ts registers the tool source with the core registry
type McpRow = typeof schema.aiMcps.$inferSelect;
type McpToolRow = typeof schema.aiMcpTools.$inferSelect;
const McpView = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  transport: t.String(),
  url: t.String(),
  /** Header names with masked values — secrets never leave the server. */
  headers: t.Record(t.String(), t.String()),
  enabled: t.Boolean(),
  lastStatus: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  lastSyncedAt: t.Nullable(t.String()),
  toolsCount: t.Integer(),
  createdAt: t.String(),
});
const McpToolView = t.Object({
  id: t.String(),
  name: t.String(),
  wire: t.String(),
  /** What the assistant / MCP clients see: `ext_<code>__<wire>`. */
  wireName: t.String(),
  description: t.Nullable(t.String()),
  enabled: t.Boolean(),
});
const mcpView = (m: McpRow) => ({
  id: m.id,
  code: m.code,
  name: m.name,
  transport: m.transport,
  url: m.url,
  headers: maskedHeaders(m),
  enabled: m.enabled,
  lastStatus: m.last_status,
  lastError: m.last_error,
  lastSyncedAt: m.last_synced_at?.toISOString() ?? null,
  toolsCount: m.tools_count,
  createdAt: m.created_at.toISOString(),
});
const mcpToolView = (code: string) => (r: McpToolRow) => ({
  id: r.id,
  name: r.name,
  wire: r.wire,
  wireName: toolNameFor(code, r.wire).replace('.', '_'),
  description: r.description,
  enabled: r.enabled,
});

// ---- provider profiles (H-10) + analytics (H-15) ----
/** Capability matrix from the probe (AI-Roadmap §3), as stored and exposed. */
const CapabilitiesView = t.Object({
  endpoints: t.Object({ responses: t.Boolean(), chatCompletions: t.Boolean() }),
  stream: t.Object({ supported: t.Boolean(), sse: t.Boolean(), responsesStream: t.Boolean() }),
  reasoning: t.Object({
    supported: t.Boolean(),
    param: t.Nullable(t.String()),
    via: t.Nullable(t.String()),
  }),
  tools: t.Object({
    supported: t.Boolean(),
    functionCalling: t.Boolean(),
    via: t.Nullable(t.String()),
  }),
  modelsTested: t.Array(t.String()),
  preferredEndpoint: t.Nullable(t.String()),
});
const ModelView = t.Object({
  id: t.String(),
  model: t.String(),
  label: t.Nullable(t.String()),
  /** Currency units per 1M tokens (stored as micro-units). */
  priceIn: t.Number(),
  priceOut: t.Number(),
  enabled: t.Boolean(),
  /**
   * The §4.1 matrix probed with THIS model id, null until someone tests it. Provider-level
   * capabilities answer "what does this base URL speak"; these answer "what can this model do",
   * which is the question an admin picking a model actually has.
   */
  capabilities: t.Nullable(CapabilitiesView),
  capabilitiesAt: t.Nullable(t.String()),
  preferredEndpoint: t.Nullable(t.String()),
  lastStatus: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  lastTestedAt: t.Nullable(t.String()),
  lastProbeMs: t.Nullable(t.Integer()),
  /** Derived from this model's own matrix, never stored (§3 no. 2). */
  recommended: t.Boolean(),
});
const ProviderView = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  baseUrl: t.String(),
  /** Whether a key is stored; the key itself never leaves the server. */
  apiKeySet: t.Boolean(),
  defaultModel: t.String(),
  enabled: t.Boolean(),
  isDefault: t.Boolean(),
  lastStatus: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  lastTestedAt: t.Nullable(t.String()),
  /** Null until the provider has been probed once (pre-F1 rows stay null and behave as before). */
  capabilities: t.Nullable(CapabilitiesView),
  capabilitiesAt: t.Nullable(t.String()),
  preferredEndpoint: t.Nullable(t.String()),
  lastProbeError: t.Nullable(t.String()),
  lastProbeMs: t.Nullable(t.Integer()),
  /** Derived, never stored: §3 no. 2. */
  recommended: t.Boolean(),
  models: t.Array(ModelView),
  createdAt: t.String(),
});
const ProviderOption = t.Object({
  id: t.String(),
  code: t.String(),
  name: t.String(),
  isDefault: t.Boolean(),
  defaultModel: t.String(),
  recommended: t.Boolean(),
  preferredEndpoint: t.Nullable(t.String()),
  capabilities: t.Nullable(CapabilitiesView),
  models: t.Array(t.Object({ model: t.String(), label: t.Nullable(t.String()) })),
});
/**
 * §3 no. 2 for a stored row. PRESENTATION ONLY: this must never reach `enabledProviders`, whose
 * order decides which profile serves a chat that names none (§7.6).
 */
function recommendedRow(r: ProviderRow): boolean {
  const caps = capabilitiesOf(r.capabilities);
  return !!caps && isRecommended(caps);
}
/** Recommended first, then the caller's own tie-breaker. View layer only, per §3 no. 2. */
function byRecommended<T extends ProviderRow>(rows: T[], tie: (a: T, b: T) => number): T[] {
  return [...rows].sort(
    (a, b) => Number(recommendedRow(b)) - Number(recommendedRow(a)) || tie(a, b),
  );
}
async function providerView(r: ProviderRow) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    baseUrl: r.base_url,
    apiKeySet: !!r.api_key,
    defaultModel: r.default_model,
    enabled: r.enabled,
    isDefault: r.is_default,
    lastStatus: r.last_status,
    lastError: r.last_error,
    lastTestedAt: r.last_tested_at?.toISOString() ?? null,
    capabilities: capabilitiesOf(r.capabilities),
    capabilitiesAt: r.capabilities_at?.toISOString() ?? null,
    preferredEndpoint: r.preferred_endpoint,
    lastProbeError: r.last_probe_error,
    lastProbeMs: r.last_probe_ms,
    recommended: recommendedRow(r),
    models: (await modelsOf(r.id)).map((m) => {
      const caps = capabilitiesOf(m.capabilities);
      return {
        id: m.id,
        model: m.model,
        label: m.label,
        priceIn: Number(m.price_in_micro) / 1_000_000,
        priceOut: Number(m.price_out_micro) / 1_000_000,
        enabled: m.enabled,
        capabilities: caps,
        capabilitiesAt: m.capabilities_at?.toISOString() ?? null,
        preferredEndpoint: m.preferred_endpoint,
        lastStatus: m.last_status,
        lastError: m.last_error,
        lastTestedAt: m.last_tested_at?.toISOString() ?? null,
        lastProbeMs: m.last_probe_ms,
        recommended: !!caps && isRecommended(caps),
      };
    }),
    createdAt: r.created_at.toISOString(),
  };
}
async function findProvider(
  state: TenantState | undefined,
  id: string,
): Promise<ProviderRow | null> {
  const tenant = state?.tenant;
  if (!tenant) return null;
  return tenant.selectOne(
    schema.aiProviders,
    and(eq(schema.aiProviders.id, id), isNull(schema.aiProviders.deleted_at)),
  );
}
/**
 * Record a probe on one price-list row. Mirrors what the provider-level test writes, including its
 * rule that a FAILED probe keeps the last known matrix: an expired key or a provider having a bad
 * minute should not erase what the model was proven to support. The failure is recorded beside it.
 */
async function writeModelProbe(
  tenant: TenantDb,
  providerId: string,
  model: string,
  r: ProbeResult,
  now: Date,
) {
  await tenant.update(
    schema.aiModels,
    {
      last_status: r.ok ? 'ok' : 'error',
      last_error: r.error,
      last_tested_at: now,
      last_probe_ms: r.ms,
      ...(r.ok
        ? {
            capabilities: toStored(r),
            capabilities_at: now,
            preferred_endpoint: r.preferredEndpoint,
          }
        : {}),
    },
    and(eq(schema.aiModels.provider_id, providerId), eq(schema.aiModels.model, model)),
  );
}

/** Replace the price list; the default model is always present so the picker can offer it. */
async function replaceModels(
  tenant: TenantDb,
  providerId: string,
  models: (typeof ProviderBody.static)['models'],
  defaultModel: string,
) {
  const list = [...(models ?? [])];
  if (!list.some((m) => m.model === defaultModel)) list.push({ model: defaultModel });
  // The list is rewritten wholesale, but a model's probe belongs to the MODEL ID, not to the row
  // that happened to hold it: editing a price would otherwise erase what the model was proven to
  // support. Rows keyed by the same model id carry their matrix across the rewrite.
  const probed = new Map(
    (await modelsOf(providerId)).map((m) => [
      m.model,
      {
        capabilities: m.capabilities,
        capabilities_at: m.capabilities_at,
        preferred_endpoint: m.preferred_endpoint,
        last_status: m.last_status,
        last_error: m.last_error,
        last_tested_at: m.last_tested_at,
        last_probe_ms: m.last_probe_ms,
      },
    ]),
  );
  await tenant.delete(schema.aiModels, eq(schema.aiModels.provider_id, providerId));
  const seen = new Set<string>();
  for (const m of list) {
    if (seen.has(m.model)) continue;
    seen.add(m.model);
    await tenant.insert(schema.aiModels, {
      id: newId(),
      provider_id: providerId,
      model: m.model,
      label: m.label ?? null,
      price_in_micro: toPriceMicro(m.priceIn),
      price_out_micro: toPriceMicro(m.priceOut),
      enabled: m.enabled ?? true,
      ...probed.get(m.model),
    });
  }
}
interface Stat {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /**
   * Reasoning tokens, as a SUBSET of `tokensOut` (§5.1a normalises them into it). Reported apart
   * because a reasoning model can spend most of a turn's output on thinking — a 10-token answer
   * costing 261 reasoning tokens is invisible otherwise, and it is billed.
   */
  tokensReasoning: number;
  costMicro: number;
}
interface DayStat extends Stat {
  day: string;
}
interface ModelStat extends Stat {
  provider: string | null;
  model: string | null;
}
interface UserStat extends Stat {
  userId: string | null;
  name: string | null;
  email: string | null;
}
/** Analytics aggregate in memory over at most this many rows of the window (dialect-neutral). */
const ANALYTICS_ROW_CAP = 100_000;

// ---- quota & balance (B-6, H-14) ----
const QuotaSideView = t.Object({ used: t.Integer(), limit: t.Integer() });
const QuotaView = t.Object({
  ok: t.Boolean(),
  reason: t.Nullable(t.String()),
  tenant: QuotaSideView,
  user: QuotaSideView,
  credit: t.Object({ balanceMicro: t.Nullable(t.Number()), spentMicro: t.Number() }),
  monthStart: t.String(),
});
function quotaView(q: Awaited<ReturnType<typeof checkQuota>> | null) {
  return (
    q ?? {
      ok: true,
      reason: null,
      tenant: { used: 0, limit: 0 },
      user: { used: 0, limit: 0 },
      credit: { balanceMicro: null, spentMicro: 0 },
      monthStart: new Date(0).toISOString(),
    }
  );
}

export default defineApiRoutes(
  'AI',
  new Elysia({ name: 'module:ai', tags: ['module:ai'] })
    .use(requestContext)
    .use(tenantContext)

    // ---- chat (H-2, H-3, H-4, H-5, H-6, H-9) ----
    .post(
      '/chat/completions',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
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
        // Quota & balance (H-14): refused before the provider is called; usage lands after.
        const quota = await checkQuota(clientId, a.user.id);
        if (!quota.ok) {
          set.status = 429;
          return fail(
            'rate_limited',
            quota.reason === 'credit_exhausted'
              ? 'Saldo AI tenant habis — hubungi administrator untuk menambah saldo'
              : quota.reason === 'tenant_quota'
                ? `Kuota token tenant bulan ini habis (${quota.tenant.used.toLocaleString('id-ID')} / ${quota.tenant.limit.toLocaleString('id-ID')})`
                : `Kuota token Anda bulan ini habis (${quota.user.used.toLocaleString('id-ID')} / ${quota.user.limit.toLocaleString('id-ID')})`,
            requestId,
            { reason: quota.reason, tenant: quota.tenant, user: quota.user },
          );
        }
        const tenant = tenantState?.tenant;
        // The conversation decides provider + model unless the request names them (H-10).
        let conv: Row | null = null;
        if (body.conversation_id && tenant) {
          conv = await tenant.selectOne(
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
        }
        let p: Awaited<ReturnType<typeof resolveProvider>>;
        try {
          p = await resolveProvider(clientId, {
            code: body.provider ?? null,
            providerId: conv?.provider_id ?? null,
            model: body.model ?? conv?.model ?? null,
          });
        } catch (err) {
          if (!(err instanceof ProviderNotFound)) throw err;
          set.status = 422;
          return fail('validation_failed', err.message, requestId, {
            reason: 'provider_not_found',
          });
        }
        if (!p.key) {
          // H-4: actionable, not generic.
          set.status = 422;
          return fail(
            'validation_failed',
            p.code
              ? `API key penyedia "${p.code}" belum diisi — lengkapi di Penyedia AI`
              : 'API key AI belum diisi — isi ai.key di Pengaturan → AI',
            requestId,
            {
              reason: 'no_api_key',
              settings: publicLink(p.code ? '/m/ai/providers' : '/settings'),
            },
          );
        }
        const messages = [...body.messages];
        if (p.systemPrompt && !messages.some((m) => m.role === 'system'))
          messages.unshift({ role: 'system', content: p.systemPrompt });
        // H-13: page context rides behind the (tenant or caller) system prompt; history stays clean.
        const pageContext = body.context?.trim();
        if (pageContext) {
          const at = messages[0]?.role === 'system' ? 1 : 0;
          messages.splice(at, 0, {
            role: 'system',
            content: `Konteks halaman yang sedang dibuka pengguna (gunakan bila relevan):\n${pageContext}`,
          });
        }
        const model = p.model;

        // Attachments (H-11): the sender's own uploads of kind ai.attachment, nothing else.
        const attachmentRows: FileRow[] = [];
        for (const fid of body.attachments ?? []) {
          const row = clientId ? await findFile(clientId, fid) : null;
          if (!row || row.user_id !== a.user.id || row.kind !== 'ai.attachment') {
            set.status = 422;
            return fail('validation_failed', 'Lampiran tidak dikenal', requestId, {
              reason: 'attachment_invalid',
              id: fid,
            });
          }
          attachmentRows.push(row);
        }

        // Persistence (H-6): the user's message now; the assistant's when the reply is complete.
        // Threading (H-12): every stored message knows its parent; regenerate/edit make siblings.
        let conversationId: string | null = null;
        let userMsgId: string | null = null;
        const assistantMsgId = newId();
        let assistantParent: string | null = null;
        if (conv && tenant) {
          conversationId = conv.id;
          const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
          const stored = await tenant.select(
            schema.aiMessages,
            eq(schema.aiMessages.conversation_id, conv.id),
          );
          stored.sort((x, y) => x.created_at.getTime() - y.created_at.getTime());
          if (body.parent_id) {
            const parent = stored.find((m) => m.id === body.parent_id);
            if (!parent || (body.regenerate && parent.role !== 'user')) {
              set.status = 422;
              return fail(
                'validation_failed',
                'Pesan induk tidak ada di percakapan ini',
                requestId,
                {
                  reason: 'parent_not_found',
                },
              );
            }
          } else if (body.regenerate) {
            set.status = 422;
            return fail(
              'validation_failed',
              'regenerate membutuhkan parent_id pesan pengguna',
              requestId,
              {
                reason: 'parent_not_found',
              },
            );
          }
          if (body.regenerate) {
            // A second answer to the same user message: no new user row.
            assistantParent = body.parent_id ?? null;
          } else if (lastUser) {
            userMsgId = newId();
            const userParent =
              body.parent_id === undefined ? (stored.at(-1)?.id ?? null) : body.parent_id;
            assistantParent = userMsgId;
            await tenant.insert(schema.aiMessages, {
              id: userMsgId,
              conversation_id: conv.id,
              parent_id: userParent,
              role: 'user',
              content: lastUser.content,
              tokens_in: estimateTokens(lastUser.content),
            });
            if (attachmentRows.length)
              await tenant.insert(
                schema.aiAttachments,
                attachmentRows.map((r) => ({
                  id: newId(),
                  message_id: userMsgId as string,
                  conversation_id: conv.id,
                  file_id: r.id,
                  name: r.name,
                  mime: r.mime,
                  size: r.size,
                })),
              );
          }
          if (lastUser) {
            const patch: Partial<typeof schema.aiConversations.$inferInsert> = {
              last_message_at: new Date(),
              model,
              provider_id: p.id,
              // A message brings the conversation back out of the archive — the archive is a shelf,
              // not a lock, and a conversation that is being written in has no business hiding from
              // its own list. Every path that stores a message comes through here.
              archived_at: null,
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

        // ---- tools the caller may use (extension point 8, I-3) ----
        const toolsWanted =
          body.tools ?? (await settings.get<boolean | null>(clientId, 'ai.tools_enable')) !== false;
        const caller: ToolCaller = {
          clientId,
          userId: a.user.id,
          can: (perm) => tenantState?.can(perm) ?? false,
          locale: a.user.locale ?? 'id',
          requestId,
          signal: request.signal,
          ip: clientIp(request, server),
        };
        const tools = toolsWanted ? await listTools(caller) : [];
        const openAiTools = tools.length ? toOpenAiTools(tools, caller.locale) : null;
        const convo: ProviderMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        if (attachmentRows.length) {
          const { text, images } = await attachmentContent(attachmentRows);
          const last = [...convo].reverse().find((m) => m.role === 'user');
          if (last) {
            const base = `${typeof last.content === 'string' ? last.content : ''}${text}`;
            last.content = images.length
              ? [
                  { type: 'text', text: base },
                  ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
                ]
              : base;
          }
        }
        const traces: ToolTrace[] = [];

        const started = performance.now();
        const upstream = new AbortController();
        // H-3: when the browser goes away, the upstream request goes away.
        request.signal.addEventListener('abort', () => upstream.abort(), { once: true });

        // F2: which upstream endpoint serves this turn. Starts from the resolved provider and
        // can drop to chat mid-turn when `/responses` turns out not to exist (see `callProvider`).
        let endpoint = p.endpoint;
        const maxTokens = body.max_tokens ?? p.maxTokens;

        const send = (stream: boolean, withTools: boolean) => {
          const responses = endpoint === 'responses';
          const url = responses ? `${p.baseurl}/responses` : `${p.baseurl}/chat/completions`;
          let payload: Record<string, unknown>;
          if (responses) {
            const { instructions, input } = toResponsesInput(convo);
            payload = {
              model,
              input,
              stream,
              ...(instructions ? { instructions } : {}),
              // Responses names the cap differently, and reasoning models reject a temperature
              // other than the default — so it only goes out when the caller asked for one.
              max_output_tokens: maxTokens,
              ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
              // F3: only when an effort was chosen — the default sends nothing, so a provider
              // that has never heard of the parameter keeps working untouched. The spelling is
              // the one the probe saw this provider accept.
              ...(p.reasoningEffort
                ? p.reasoningParam === 'reasoning_effort'
                  ? { reasoning_effort: p.reasoningEffort }
                  : { reasoning: { effort: p.reasoningEffort } }
                : {}),
              ...(withTools && openAiTools ? { tools: toResponsesTools(openAiTools) } : {}),
            };
          } else {
            payload = {
              model,
              messages: convo,
              stream,
              temperature: body.temperature,
              max_tokens: maxTokens,
              ...(withTools && openAiTools ? { tools: openAiTools } : {}),
              ...(stream ? { stream_options: { include_usage: true } } : {}),
            };
          }
          return fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${p.key}`,
              accept: stream ? 'text/event-stream' : 'application/json',
            },
            body: JSON.stringify(payload),
            signal: upstream.signal,
          });
        };

        /**
         * One upstream call, with the §8 safety net: a provider whose `preferred_endpoint` says
         * `responses` but answers 404/405 is not broken, it simply does not have that route — so
         * drop to `/chat/completions` for the rest of this turn and remember it for the next
         * requests, instead of failing a chat the user is waiting on.
         */
        const callProvider = async (stream: boolean, withTools: boolean) => {
          const res = await send(stream, withTools);
          if (endpoint === 'responses' && (res.status === 404 || res.status === 405)) {
            await res.body?.cancel().catch(() => {});
            logger.info('ai: /responses missing, falling back to /chat/completions', {
              baseurl: p.baseurl,
              provider: p.code,
              requestId,
            });
            noteResponsesMissing(p.baseurl);
            endpoint = 'chat_completions';
            return send(stream, withTools);
          }
          return res;
        };

        const log = (
          roundStart: number,
          usage: Usage | null,
          assistant: string,
          status: 'ok' | 'error' | 'cancelled',
          firstTokenMs: number | null,
          error?: string,
          reasoningTokens?: number | null,
        ) => {
          const tokensIn =
            usage?.prompt_tokens ??
            (status === 'ok' ? estimateTokens(convo.map((m) => m.content ?? '').join('\n')) : null);
          const tokensOut =
            usage?.completion_tokens ?? (status === 'ok' ? estimateTokens(assistant) : null);
          logCall({
            clientId,
            userId: a.user.id,
            conversationId,
            endpoint: 'chat.completions',
            provider: p.code,
            model,
            tokensIn,
            tokensOut,
            latencyMs: Math.round(performance.now() - roundStart),
            firstTokenMs,
            status,
            error: error ?? null,
            streamed: !!body.stream,
            priceInMicro: p.priceInMicro,
            priceOutMicro: p.priceOutMicro,
            upstreamEndpoint: endpoint,
            reasoningTokens: reasoningTokens ?? null,
          });
        };

        /** Map a provider failure to our envelope (H-4: actionable, never generic). */
        const providerFailure = (res: Response | null, detail: string) => {
          const denied = res !== null && (res.status === 401 || res.status === 403);
          return {
            status: res === null ? 502 : denied ? 422 : 502,
            code: denied ? ('validation_failed' as const) : ('service_unavailable' as const),
            message:
              res === null
                ? `Penyedia AI tidak terjangkau (${p.baseurl})`
                : denied
                  ? p.code
                    ? `API key penyedia "${p.code}" ditolak — periksa di Penyedia AI`
                    : 'API key AI ditolak penyedia — periksa ai.key'
                  : `Penyedia AI menjawab ${res.status}`,
            details: res === null ? undefined : { upstream: detail.slice(0, 300) },
          };
        };

        /** Run the model's tool calls through the core registry and produce the `tool` messages. */
        const runToolCalls = async (
          calls: readonly ToolCall[],
          onTrace?: (t: ToolTrace, phase: 'start' | 'end') => void,
        ): Promise<ProviderMessage[]> => {
          const out: ProviderMessage[] = [];
          for (const c of calls) {
            const trace: ToolTrace = {
              name: toolNameFromWire(c.function.name) ?? c.function.name,
              ok: false,
              ms: 0,
            };
            onTrace?.(trace, 'start');
            let args: unknown = {};
            let parseError = false;
            try {
              args = c.function.arguments?.trim() ? JSON.parse(c.function.arguments) : {};
            } catch {
              parseError = true;
            }
            let content: string;
            if (parseError) content = 'ERROR: argumen tool bukan JSON yang valid';
            else {
              const r = await callTool(c.function.name, args, caller);
              trace.name = r.name;
              trace.ok = r.ok;
              trace.ms = r.ms;
              content = r.ok ? toolResultText(r.result) : `ERROR: ${r.message}`;
            }
            if (content.length > TOOL_RESULT_MAX)
              content = `${content.slice(0, TOOL_RESULT_MAX)}… [dipotong]`;
            traces.push(trace);
            onTrace?.(trace, 'end');
            out.push({ role: 'tool', tool_call_id: c.id, content });
          }
          return out;
        };

        const persist = async (assistant: string, tokensOut: number) => {
          if (!(conversationId && tenant && assistant)) return;
          await tenant
            .insert(schema.aiMessages, {
              id: assistantMsgId,
              conversation_id: conversationId,
              parent_id: assistantParent,
              role: 'assistant',
              content: assistant,
              tokens_out: tokensOut,
            })
            .catch((err) => logger.warn('ai: persist reply failed', { error: String(err) }));
        };

        // ---- non-streaming: loop until the model answers in text ----
        if (!body.stream) {
          let transcript = '';
          for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
            const roundStart = performance.now();
            let res: Response;
            try {
              res = await callProvider(false, round < MAX_TOOL_ROUNDS);
            } catch (err) {
              const cancelled = upstream.signal.aborted;
              log(roundStart, null, '', cancelled ? 'cancelled' : 'error', null, String(err));
              const f = providerFailure(null, '');
              set.status = f.status;
              return fail(f.code, f.message, requestId);
            }
            if (!res.ok) {
              const text = await res.text().catch(() => '');
              log(roundStart, null, '', 'error', null, `${res.status} ${text.slice(0, 500)}`);
              const f = providerFailure(res, text);
              set.status = f.status;
              return fail(f.code, f.message, requestId, f.details);
            }
            const json = (await res.json()) as {
              choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
              usage?: Usage;
            };
            // Both shapes reduce to the same three things; the client only ever sees the chat one.
            const reply =
              endpoint === 'responses'
                ? readResponsesReply(json)
                : {
                    content: json.choices?.[0]?.message?.content ?? '',
                    toolCalls: (json.choices?.[0]?.message?.tool_calls ?? []).filter(
                      (c) => c?.type === 'function' && c.id,
                    ),
                    usage: json.usage ?? null,
                    reasoningTokens: null as number | null,
                  };
            const content = reply.content;
            log(roundStart, reply.usage, content, 'ok', null, undefined, reply.reasoningTokens);
            const calls = reply.toolCalls;
            if (calls.length && round < MAX_TOOL_ROUNDS) {
              if (content) transcript += `${content}\n\n`;
              convo.push({ role: 'assistant', content: content || null, tool_calls: calls });
              convo.push(...(await runToolCalls(calls)));
              continue;
            }
            transcript += content;
            // Awaited on purpose: the no-JS page reloads the conversation right after this reply.
            await persist(transcript, reply.usage?.completion_tokens ?? estimateTokens(transcript));
            // A Responses body is not what the client's contract promises, so it is rendered as a
            // chat completion; a chat body passes through as before.
            const envelope =
              endpoint === 'responses'
                ? {
                    id: (json as { id?: string }).id ?? assistantMsgId,
                    object: 'chat.completion',
                    model,
                    choices: [
                      {
                        index: 0,
                        message: { role: 'assistant', content },
                        finish_reason: calls.length ? 'tool_calls' : 'stop',
                      },
                    ],
                    ...(reply.usage
                      ? {
                          usage: {
                            prompt_tokens: reply.usage.prompt_tokens ?? 0,
                            completion_tokens: reply.usage.completion_tokens ?? 0,
                            total_tokens:
                              (reply.usage.prompt_tokens ?? 0) +
                              (reply.usage.completion_tokens ?? 0),
                          },
                        }
                      : {}),
                  }
                : json;
            return {
              ...envelope,
              x_tools: traces,
              // H-12: the stored ids, so a client can regenerate / branch from them.
              ...(conversationId
                ? {
                    x_messages: {
                      user: userMsgId ?? body.parent_id ?? null,
                      assistant: assistantMsgId,
                    },
                  }
                : {}),
            } as unknown as Record<string, unknown>;
          }
          // unreachable: the last round is issued without tools
          set.status = 502;
          return fail('service_unavailable', 'Penyedia AI tidak menjawab', requestId);
        }

        // ---- streaming: forward the provider's frames, run tools between rounds (H-3, I-3) ----
        const encoder = new TextEncoder();
        const out = new ReadableStream<Uint8Array>({
          async start(controller) {
            const raw = (line: string) => controller.enqueue(encoder.encode(`${line}\n\n`));
            const frame = (obj: unknown) => raw(`data: ${JSON.stringify(obj)}`);
            let transcript = '';
            let transcriptTokens: number | null = null;
            try {
              for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
                const roundStart = performance.now();
                let res: Response;
                try {
                  res = await callProvider(true, round < MAX_TOOL_ROUNDS);
                } catch (err) {
                  if (upstream.signal.aborted) {
                    log(roundStart, null, '', 'cancelled', null);
                    return;
                  }
                  log(roundStart, null, '', 'error', null, String(err));
                  const f = providerFailure(null, '');
                  frame({ error: { code: f.code, message: f.message } });
                  return;
                }
                if (!res.ok || !res.body) {
                  const text = await res.text().catch(() => '');
                  log(roundStart, null, '', 'error', null, `${res.status} ${text.slice(0, 500)}`);
                  const f = providerFailure(res, text);
                  frame({ error: { code: f.code, message: f.message } });
                  return;
                }
                let assistant = '';
                let usage: Usage | null = null;
                let reasoningTokens: number | null = null;
                let firstTokenMs: number | null = null;
                const calls = new Map<number, ToolCall>();
                const decoder = new TextDecoder();
                let buffer = '';
                const reader = res.body.getReader();
                try {
                  for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';
                    for (const rawLine of lines) {
                      const line = rawLine.replace(/\r$/, '');
                      if (!line.startsWith('data:')) continue;
                      const data = line.slice(5).trim();
                      if (!data || data === '[DONE]') continue; // ours to send, once, at the end

                      // ---- Responses (F2): translate, never forward. Its frames are a different
                      // wire format, and one of them — `response.reasoning_summary_text.delta` —
                      // arrives BEFORE the answer, so forwarding blindly would pour the model's
                      // reasoning summary into the answer bubble (§12 no. 2).
                      if (endpoint === 'responses') {
                        const ev = parseResponsesEvent(data);
                        if (ev.error) {
                          log(roundStart, usage, assistant, 'error', firstTokenMs, ev.error);
                          frame({
                            error: {
                              code: 'service_unavailable',
                              message: `Penyedia AI: ${ev.error}`,
                            },
                          });
                          return;
                        }
                        if (ev.text) {
                          if (firstTokenMs === null)
                            firstTokenMs = Math.round(performance.now() - started);
                          assistant += ev.text;
                          frame({ choices: [{ index: 0, delta: { content: ev.text } }] });
                        }
                        if (ev.toolCall) calls.set(calls.size, ev.toolCall);
                        if (ev.usage) usage = ev.usage;
                        if (ev.reasoningTokens !== undefined && ev.reasoningTokens !== null)
                          reasoningTokens = ev.reasoningTokens;
                        continue;
                      }

                      let j: {
                        choices?: {
                          finish_reason?: string | null;
                          delta?: {
                            content?: string | null;
                            tool_calls?: {
                              index?: number;
                              id?: string;
                              type?: string;
                              function?: { name?: string; arguments?: string };
                            }[];
                          };
                        }[];
                        usage?: Usage;
                      };
                      try {
                        j = JSON.parse(data);
                      } catch {
                        continue; // partial or non-JSON line
                      }
                      const delta = j.choices?.[0]?.delta;
                      if (delta?.content) {
                        if (firstTokenMs === null)
                          firstTokenMs = Math.round(performance.now() - started);
                        assistant += delta.content;
                      }
                      for (const tc of delta?.tool_calls ?? []) {
                        const idx = tc.index ?? 0;
                        const cur = calls.get(idx) ?? {
                          id: '',
                          type: 'function' as const,
                          function: { name: '', arguments: '' },
                        };
                        if (tc.id) cur.id = tc.id;
                        if (tc.function?.name) cur.function.name += tc.function.name;
                        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
                        calls.set(idx, cur);
                      }
                      if (j.usage) usage = j.usage;
                      // Tool-call deltas and the `tool_calls` finish stay server-side; everything
                      // else reaches the client as-is.
                      const toolOnly =
                        (delta?.tool_calls && !delta.content) ||
                        j.choices?.[0]?.finish_reason === 'tool_calls';
                      if (!toolOnly) raw(line);
                    }
                  }
                } catch (err) {
                  if (upstream.signal.aborted) {
                    transcript += assistant;
                    log(
                      roundStart,
                      usage,
                      assistant,
                      'cancelled',
                      firstTokenMs,
                      undefined,
                      reasoningTokens,
                    );
                    return;
                  }
                  throw err;
                }
                log(roundStart, usage, assistant, 'ok', firstTokenMs, undefined, reasoningTokens);
                transcript += assistant;
                transcriptTokens = usage?.completion_tokens ?? null;
                const list = [...calls.values()].filter((c) => c.id && c.function.name);
                if (list.length && round < MAX_TOOL_ROUNDS) {
                  if (assistant) {
                    transcript += '\n\n';
                    raw('data: {"choices":[{"index":0,"delta":{"content":"\\n\\n"}}]}');
                  }
                  convo.push({ role: 'assistant', content: assistant || null, tool_calls: list });
                  convo.push(
                    ...(await runToolCalls(list, (t, phase) =>
                      frame({
                        choices: [{ index: 0, delta: {} }],
                        crk: {
                          tool:
                            phase === 'start'
                              ? { name: t.name, status: 'running' }
                              : { name: t.name, status: t.ok ? 'ok' : 'error', ms: t.ms },
                        },
                      }),
                    )),
                  );
                  continue;
                }
                if (conversationId)
                  frame({
                    choices: [{ index: 0, delta: {} }],
                    crk: {
                      messages: {
                        user: userMsgId ?? body.parent_id ?? null,
                        assistant: assistantMsgId,
                      },
                    },
                  });
                raw('data: [DONE]');
                return;
              }
            } catch (err) {
              logger.warn('ai: stream failed', { error: String(err), requestId });
              frame({
                error: { code: 'service_unavailable', message: 'Aliran dari penyedia AI terputus' },
              });
            } finally {
              // Before close(): when the client sees the stream end, the reply is already stored.
              await persist(transcript, transcriptTokens ?? estimateTokens(transcript));
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
          cancel() {
            upstream.abort();
          },
        });
        set.headers['content-type'] = 'text/event-stream';
        set.headers['cache-control'] = 'no-cache';
        set.headers['x-accel-buffering'] = 'no';
        return new Response(out, {
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

    // ---- attachments (H-11): upload first, then name the ids in chat/completions ----
    .post(
      '/attachments',
      async ({ auth, body, set, requestId, tenantState }) => {
        const a = auth as AuthState;
        const clientId = tenantState?.clientId ?? null;
        if (!clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const r = await storeUpload({
          clientId,
          userId: a.user.id,
          file: body.file,
          kind: 'ai.attachment',
          visibility: 'private',
          allowedTypes: ATTACHMENT_TYPES,
          maxBytes: ATTACHMENT_MAX_BYTES,
        });
        if (!r.ok) {
          set.status = r.code === 'too_large' ? 413 : 422;
          return fail('validation_failed', r.message, requestId, { reason: r.code });
        }
        set.status = 201;
        return ok({
          id: r.row.id,
          name: r.row.name,
          mime: r.row.mime,
          size: r.row.size,
          url: fileUrl(r.row),
        });
      },
      {
        beforeHandle: permission('ai.chat.create'),
        body: t.Object({ file: t.File() }),
        response: {
          201: OkSchema(
            t.Object({
              id: t.String(),
              name: t.String(),
              mime: t.String(),
              size: t.Integer(),
              url: t.String(),
            }),
          ),
          ...errorResponses,
        },
        detail: {
          summary:
            'Upload a chat attachment (images, text, csv, json, markdown; 5 MB) owned by me; private (H-11)',
        },
      },
    )

    // ---- conversations (H-6, H-7) ----
    .get(
      '/conversations',
      async ({ auth, query, tenantState }) => {
        const a = auth as AuthState;
        if (!tenantState?.tenant) return page([], pageMeta(1, 50, 0));
        // The archive is a view of its own, not a longer list: `only` is what the sidebar filter
        // asks for, `1` keeps the older "everything at once" meaning.
        const archived = query.archived;
        const rows = await tenantState.tenant.select(
          schema.aiConversations,
          and(
            eq(schema.aiConversations.user_id, a.user.id),
            isNull(schema.aiConversations.deleted_at),
            archived === '1'
              ? undefined
              : archived === 'only'
                ? isNotNull(schema.aiConversations.archived_at)
                : isNull(schema.aiConversations.archived_at),
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
            'My conversations, newest first; ?q= searches titles; ?archived=1 includes archived, ?archived=only lists just the archive',
        },
      },
    )
    .post(
      '/conversations',
      async ({ auth, body, set, requestId, tenantState }) => {
        const a = auth as AuthState;
        if (!tenantState?.tenant || !tenantState.clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        // H-10: pin the chosen profile (validated) — or leave null so the tenant default applies.
        let providerId: string | null = null;
        if (body?.provider) {
          try {
            providerId = (await resolveProvider(tenantState.clientId, { code: body.provider })).id;
          } catch (err) {
            if (!(err instanceof ProviderNotFound)) throw err;
            set.status = 422;
            return fail('validation_failed', err.message, requestId, {
              reason: 'provider_not_found',
            });
          }
        }
        const id = newId();
        await tenantState.tenant.insert(schema.aiConversations, {
          id,
          user_id: a.user.id,
          title: 'Percakapan baru',
          provider_id: providerId,
          model: body?.model || null,
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
        body: t.Optional(ConversationCreate),
        response: { 201: OkSchema(Conversation), ...errorResponses },
        detail: {
          summary:
            'Start a conversation (title is set from the first message); optional provider code + model (H-10)',
        },
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
        const msgs = (
          await tenantState.tenant.select(
            schema.aiMessages,
            eq(schema.aiMessages.conversation_id, conv.id),
          )
        ).sort((x, y) => x.created_at.getTime() - y.created_at.getTime());
        // Pre-threading rows (H-12) have no parents: link them once, in order, so the tree invariant
        // (every assistant reply has a parent) holds for every conversation from here on.
        if (msgs.some((m) => m.role === 'assistant' && !m.parent_id)) {
          let prev: string | null = null;
          for (const m of msgs) {
            if (!m.parent_id && prev) {
              await tenantState.tenant.update(
                schema.aiMessages,
                { parent_id: prev },
                eq(schema.aiMessages.id, m.id),
              );
              m.parent_id = prev;
            }
            prev = m.id;
          }
        }
        const atts = await tenantState.tenant.select(
          schema.aiAttachments,
          eq(schema.aiAttachments.conversation_id, conv.id),
        );
        return ok({
          ...view(conv),
          messages: msgs.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            parentId: m.parent_id,
            attachments: atts.filter((x) => x.message_id === m.id).map(attachmentView),
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
        if (body.provider !== undefined) {
          if (body.provider === null) patch.provider_id = null;
          else {
            try {
              patch.provider_id = (
                await resolveProvider(tenantState?.clientId ?? '', { code: body.provider })
              ).id;
            } catch (err) {
              if (!(err instanceof ProviderNotFound)) throw err;
              set.status = 422;
              return fail('validation_failed', err.message, requestId, {
                reason: 'provider_not_found',
              });
            }
          }
        }
        if (body.model !== undefined) patch.model = body.model || null;
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
        detail: { summary: 'Rename, (un)archive, or switch provider/model of a conversation' },
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
            provider: r.provider,
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
              provider: t.Nullable(t.String()),
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
    )

    // ---- provider profiles + price list (H-10): secrets never echo; every chat user sees options ----
    .get(
      '/providers/options',
      async ({ tenantState }) => {
        if (!tenantState?.clientId) return ok([]);
        // `enabledProviders` order (default → code) is the tenant's resolution order and must not
        // change; this only reorders the COPY the picker displays, recommended first (§3 no. 2).
        const rows = byRecommended(await enabledProviders(tenantState.clientId), () => 0);
        return ok(
          await Promise.all(
            rows.map(async (p) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              isDefault: p.is_default,
              defaultModel: p.default_model,
              recommended: recommendedRow(p),
              preferredEndpoint: p.preferred_endpoint,
              capabilities: capabilitiesOf(p.capabilities),
              models: (await modelsOf(p.id))
                .filter((m) => m.enabled)
                .map((m) => ({ model: m.model, label: m.label })),
            })),
          ),
        );
      },
      {
        beforeHandle: permission('ai.chat.read'),
        response: { 200: OkSchema(t.Array(ProviderOption)), ...errorResponses },
        detail: {
          summary:
            'Enabled provider profiles + models a chat user may pick (H-10); empty = legacy ai.* settings apply',
        },
      },
    )
    .get(
      '/providers',
      async ({ tenantState }) => {
        const tenant = tenantState?.tenant;
        if (!tenant) return ok([]);
        const rows = await tenant.select(schema.aiProviders, isNull(schema.aiProviders.deleted_at));
        return ok(
          await Promise.all(
            byRecommended(rows, (a, b) => a.name.localeCompare(b.name)).map((r) => providerView(r)),
          ),
        );
      },
      {
        beforeHandle: permission('ai.provider.read'),
        response: { 200: OkSchema(t.Array(ProviderView)), ...errorResponses },
        detail: { summary: 'Provider profiles of the active tenant with their price lists (H-10)' },
      },
    )
    .get(
      '/providers/:id',
      async ({ params, set, requestId, tenantState }) => {
        const row = await findProvider(tenantState, params.id);
        if (!row) {
          set.status = 404;
          return fail('not_found', 'Penyedia AI tidak ditemukan', requestId);
        }
        return ok(await providerView(row));
      },
      {
        beforeHandle: permission('ai.provider.read'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(ProviderView), ...errorResponses },
        detail: { summary: 'One provider profile (API key masked)' },
      },
    )
    .post(
      '/providers',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        if (!tenant || !tenantState.clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const dup = await tenant.selectOne(
          schema.aiProviders,
          and(eq(schema.aiProviders.code, body.code), isNull(schema.aiProviders.deleted_at)),
        );
        if (dup) {
          set.status = 409;
          return fail('conflict', `Kode "${body.code}" sudah dipakai`, requestId, {
            code: 'sudah dipakai',
          });
        }
        const others = await tenant.select(
          schema.aiProviders,
          isNull(schema.aiProviders.deleted_at),
        );
        // The first profile becomes the default; asking for default demotes the others.
        const isDefault = body.isDefault === true || others.length === 0;
        if (isDefault && others.length)
          await tenant.update(
            schema.aiProviders,
            { is_default: false },
            isNull(schema.aiProviders.deleted_at),
          );
        /**
         * Deleting a profile only sets `deleted_at`, and the unique key `(client_id, code)` counts
         * buried rows too — so re-adding a code that was removed reached the database as a raw
         * constraint violation instead of an answer. Resurrect that row instead (the `users`
         * create path does the same for a deleted account): the id comes back, so audit entries
         * and anything else pointing at it stay meaningful.
         */
        const buried = await tenant.selectOne(
          schema.aiProviders,
          and(eq(schema.aiProviders.code, body.code), isNotNull(schema.aiProviders.deleted_at)),
        );
        const id = buried?.id ?? newId();
        const values = {
          code: body.code,
          name: body.name,
          base_url: body.baseUrl.replace(/\/$/, ''),
          api_key: body.apiKey && body.apiKey !== '***' ? body.apiKey : null,
          default_model: body.defaultModel,
          enabled: body.enabled ?? true,
          is_default: isDefault,
        };
        if (buried) {
          // What the old profile learned about ITS endpoint says nothing about this one: the base
          // URL and the key may be different, so the probe starts from "never tested" again.
          await tenant.update(
            schema.aiProviders,
            {
              ...values,
              deleted_at: null,
              last_status: null,
              last_error: null,
              last_tested_at: null,
              capabilities: null,
              capabilities_at: null,
              preferred_endpoint: null,
              last_probe_error: null,
              last_probe_ms: null,
            },
            eq(schema.aiProviders.id, id),
          );
        } else {
          await tenant.insert(schema.aiProviders, { id, ...values });
        }
        await replaceModels(tenant, id, body.models, body.defaultModel);
        const row = (await tenant.selectOne(
          schema.aiProviders,
          eq(schema.aiProviders.id, id),
        )) as ProviderRow;
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.provider.create',
          resource: 'ai.provider',
          resourceId: id,
          ip: clientIp(request, server),
          requestId,
          after: {
            code: row.code,
            name: row.name,
            baseUrl: row.base_url,
            apiKey: '***',
            ...(buried ? { restored: true } : {}),
          },
        });
        set.status = 201;
        return ok(await providerView(row));
      },
      {
        beforeHandle: permission('ai.provider.manage'),
        body: ProviderBody,
        response: { 201: OkSchema(ProviderView), ...errorResponses },
        detail: {
          summary:
            'Create a provider profile with its priced model list (H-10); the first one becomes the default',
        },
      },
    )
    .put(
      '/providers/:id',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const row = await findProvider(tenantState, params.id);
        if (!row || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Penyedia AI tidak ditemukan', requestId);
        }
        if (body.code && body.code !== row.code) {
          const dup = await tenant.selectOne(
            schema.aiProviders,
            and(eq(schema.aiProviders.code, body.code), isNull(schema.aiProviders.deleted_at)),
          );
          if (dup) {
            set.status = 409;
            return fail('conflict', `Kode "${body.code}" sudah dipakai`, requestId, {
              code: 'sudah dipakai',
            });
          }
        }
        if (body.isDefault === true && !row.is_default)
          await tenant.update(
            schema.aiProviders,
            { is_default: false },
            isNull(schema.aiProviders.deleted_at),
          );
        const patch: Partial<typeof schema.aiProviders.$inferInsert> = {};
        if (body.name !== undefined) patch.name = body.name;
        if (body.code !== undefined) patch.code = body.code;
        if (body.baseUrl !== undefined) patch.base_url = body.baseUrl.replace(/\/$/, '');
        // Secret semantics like MCP headers: omitted or `***` keeps, '' clears, anything else replaces.
        if (body.apiKey !== undefined && body.apiKey !== '***') patch.api_key = body.apiKey || null;
        if (body.defaultModel !== undefined) patch.default_model = body.defaultModel;
        if (body.enabled !== undefined) patch.enabled = body.enabled;
        if (body.isDefault !== undefined) patch.is_default = body.isDefault || row.is_default;
        if (Object.keys(patch).length)
          await tenant.update(schema.aiProviders, patch, eq(schema.aiProviders.id, row.id));
        if (body.models !== undefined)
          await replaceModels(tenant, row.id, body.models, body.defaultModel ?? row.default_model);
        const after = (await tenant.selectOne(
          schema.aiProviders,
          eq(schema.aiProviders.id, row.id),
        )) as ProviderRow;
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.provider.update',
          resource: 'ai.provider',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          before: { code: row.code, baseUrl: row.base_url, enabled: row.enabled },
          after: { code: after.code, baseUrl: after.base_url, enabled: after.enabled },
        });
        return ok(await providerView(after));
      },
      {
        beforeHandle: permission('ai.provider.manage'),
        params: t.Object({ id: Id }),
        body: ProviderUpdateBody,
        response: { 200: OkSchema(ProviderView), ...errorResponses },
        detail: {
          summary:
            'Update a provider profile; apiKey omitted/*** keeps the stored secret; models replaces the price list',
        },
      },
    )
    .delete(
      '/providers/:id',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const row = await findProvider(tenantState, params.id);
        if (!row || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Penyedia AI tidak ditemukan', requestId);
        }
        await tenant.update(
          schema.aiProviders,
          { deleted_at: new Date(), enabled: false, is_default: false },
          eq(schema.aiProviders.id, row.id),
        );
        // Conversations pinned to it fall back to the tenant default.
        await tenant.update(
          schema.aiConversations,
          { provider_id: null },
          eq(schema.aiConversations.provider_id, row.id),
        );
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.provider.delete',
          resource: 'ai.provider',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          before: { code: row.code, name: row.name },
        });
        return ok({ deleted: true as const });
      },
      {
        beforeHandle: permission('ai.provider.manage'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
        detail: {
          summary: 'Remove a provider profile; pinned conversations fall back to the default',
        },
      },
    )
    // ---- settings-based provider: the same probe, for the section that has no profile row ----
    .post(
      '/settings/test',
      async ({ auth, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const clientId = tenantState?.clientId ?? null;
        if (!clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        // Resolve exactly what a chat would use when no profile is picked, so the button tests
        // the configuration the operator is looking at — env → global → tenant (§10.1).
        const p = await resolveProvider(clientId, {});
        if (p.id) {
          // A profile exists and wins; testing the settings here would mislead.
          set.status = 409;
          return fail(
            'conflict',
            `Tenant ini memakai profil "${p.code}" di Penyedia AI — uji koneksinya di halaman itu`,
            requestId,
          );
        }
        const r = await probeCapabilities(p.baseurl, p.key, p.model, { signal: request.signal });
        await writeAudit(unsafeAcrossTenants(), {
          clientId,
          actorId: a.user.id,
          action: 'ai.settings.test',
          resource: 'ai.settings',
          resourceId: null,
          ip: clientIp(request, server),
          requestId,
          after: {
            ok: r.ok,
            ms: r.ms,
            preferredEndpoint: r.preferredEndpoint,
            recommended: isRecommended(r),
          },
        });
        // The generic `ConfigActionResult` the settings page knows how to render.
        const flag = (on: boolean, name: string) => `${on ? '✓' : '—'} ${name}`;
        return ok({
          ok: r.ok,
          message: r.ok
            ? `Terhubung lewat ${r.preferredEndpoint === 'responses' ? '/responses' : '/chat/completions'} — ${p.model} · ${r.ms} ms${isRecommended(r) ? ' · direkomendasikan' : ''}`
            : `Gagal terhubung: ${r.error ?? 'penyedia tidak menjawab'}`,
          details: [
            `${p.baseurl} · ${p.key ? 'key tersimpan' : 'tanpa key'}`,
            [
              flag(r.endpoints.responses, '/responses'),
              flag(r.endpoints.chatCompletions, '/chat/completions'),
              flag(r.stream.supported, 'stream'),
              flag(r.reasoning.supported, 'reasoning'),
              flag(r.tools.supported, 'tools'),
            ].join(' · '),
            ...r.steps
              .filter((x) => x.status === 'error')
              .map((x) => `${x.step}: ${x.note ?? 'gagal'}`),
            ...(r.modelsTested.length ? [`model: ${r.modelsTested.slice(0, 8).join(', ')}`] : []),
          ],
        });
      },
      {
        beforeHandle: permission('ai.provider.manage'),
        response: {
          200: OkSchema(
            t.Object({
              ok: t.Boolean(),
              message: t.String(),
              details: t.Array(t.String()),
            }),
          ),
          ...errorResponses,
        },
        detail: {
          summary:
            'Capability probe for the settings-based provider (Pengaturan → AI); answers the generic config-action shape',
        },
      },
    )
    .post(
      '/providers/:id/test',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const row = await findProvider(tenantState, params.id);
        if (!row || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Penyedia AI tidak ditemukan', requestId);
        }
        // F0: the probe answers the whole §4.1 matrix; nothing of it is persisted yet — only the
        // existing last_status/last_error/last_tested_at columns are written, as before.
        const r = await probeCapabilities(row.base_url, row.api_key, row.default_model, {
          signal: request.signal,
        });
        const now = new Date();
        // The provider probe IS a probe of `default_model`, so the matching price-list row learns
        // the same verdict — otherwise the default model reads "never tested" right after a
        // successful provider test, which is the one thing an admin just disproved.
        await writeModelProbe(tenant, row.id, row.default_model, r, now);
        await tenant.update(
          schema.aiProviders,
          {
            last_status: r.ok ? 'ok' : 'error',
            last_error: r.error,
            last_tested_at: now,
            // A failed probe keeps the last known matrix: an expired key should not erase what the
            // provider was proven to support. The failure is recorded next to it instead.
            ...(r.ok
              ? {
                  capabilities: toStored(r),
                  capabilities_at: now,
                  preferred_endpoint: r.preferredEndpoint,
                }
              : {}),
            last_probe_error: r.error,
            last_probe_ms: r.ms,
          },
          eq(schema.aiProviders.id, row.id),
        );
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.provider.test',
          resource: 'ai.provider',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          after: {
            ok: r.ok,
            models: r.modelsTested.length,
            ms: r.ms,
            preferredEndpoint: r.preferredEndpoint,
            responses: r.endpoints.responses,
            stream: r.stream.supported,
            reasoning: r.reasoning.supported,
            tools: r.tools.supported,
            recommended: isRecommended(r),
          },
        });
        // `models` stays in the payload under its old name so the existing admin card keeps
        // rendering while F1 grows the UI into the full matrix.
        return ok({
          ok: r.ok,
          error: r.error,
          models: r.modelsTested,
          ms: r.ms,
          capabilities: {
            endpoints: r.endpoints,
            stream: r.stream,
            reasoning: r.reasoning,
            tools: r.tools,
            modelsTested: r.modelsTested,
            preferredEndpoint: r.preferredEndpoint,
          },
          preferredEndpoint: r.preferredEndpoint,
          recommended: isRecommended(r),
          steps: r.steps,
        });
      },
      {
        beforeHandle: permission('ai.provider.manage'),
        params: t.Object({ id: Id }),
        response: {
          200: OkSchema(
            t.Object({
              ok: t.Boolean(),
              error: t.Nullable(t.String()),
              models: t.Array(t.String()),
              ms: t.Integer(),
              capabilities: CapabilitiesView,
              preferredEndpoint: t.Nullable(t.String()),
              recommended: t.Boolean(),
              steps: t.Array(
                t.Object({
                  step: t.String(),
                  status: t.String(),
                  ms: t.Integer(),
                  note: t.Nullable(t.String()),
                }),
              ),
            }),
          ),
          ...errorResponses,
        },
        detail: {
          summary:
            'Capability probe with the stored key (AI-Roadmap §4.1): endpoints, stream, reasoning, tools + model ids to price (H-10)',
        },
      },
    )

    /**
     * The same §4.1 probe, run against ONE model of the price list. Two models behind one base URL
     * routinely disagree — a reasoning model and a chat-only one, a model with function calling and
     * one without — and the provider-level answer describes only `default_model`. The verdict is
     * stored on the model's own row, so the list keeps every model's matrix side by side.
     */
    .post(
      '/providers/:id/models/test',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const row = await findProvider(tenantState, params.id);
        if (!row || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Penyedia AI tidak ditemukan', requestId);
        }
        // Only a model this provider actually lists: the probe spends the tenant's own key, so the
        // model id is never taken from the request as free text.
        const model = (await modelsOf(row.id)).find((m) => m.model === body.model);
        if (!model) {
          set.status = 404;
          return fail('not_found', 'Model tidak ada di daftar penyedia ini', requestId);
        }
        const r = await probeCapabilities(row.base_url, row.api_key, model.model, {
          signal: request.signal,
        });
        const now = new Date();
        await writeModelProbe(tenant, row.id, model.model, r, now);
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.provider.model.test',
          resource: 'ai.provider',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          after: {
            model: model.model,
            ok: r.ok,
            ms: r.ms,
            preferredEndpoint: r.preferredEndpoint,
            responses: r.endpoints.responses,
            stream: r.stream.supported,
            reasoning: r.reasoning.supported,
            tools: r.tools.supported,
            recommended: isRecommended(r),
          },
        });
        return ok({
          model: model.model,
          ok: r.ok,
          error: r.error,
          ms: r.ms,
          capabilities: {
            endpoints: r.endpoints,
            stream: r.stream,
            reasoning: r.reasoning,
            tools: r.tools,
            modelsTested: r.modelsTested,
            preferredEndpoint: r.preferredEndpoint,
          },
          preferredEndpoint: r.preferredEndpoint,
          recommended: isRecommended(r),
          testedAt: now.toISOString(),
          steps: r.steps,
        });
      },
      {
        beforeHandle: permission('ai.provider.manage'),
        params: t.Object({ id: Id }),
        body: t.Object({ model: t.String({ minLength: 1, maxLength: 120 }) }),
        response: {
          200: OkSchema(
            t.Object({
              model: t.String(),
              ok: t.Boolean(),
              error: t.Nullable(t.String()),
              ms: t.Integer(),
              capabilities: CapabilitiesView,
              preferredEndpoint: t.Nullable(t.String()),
              recommended: t.Boolean(),
              testedAt: t.String(),
              steps: t.Array(
                t.Object({
                  step: t.String(),
                  status: t.String(),
                  ms: t.Integer(),
                  note: t.Nullable(t.String()),
                }),
              ),
            }),
          ),
          ...errorResponses,
        },
        detail: {
          summary:
            'Capability probe for ONE model of a provider (AI-Roadmap §4.1): each model has its own reasoning / tools / endpoint verdict',
        },
      },
    )

    // ---- analytics (H-15): tokens & cost per day / model / user over a window ----
    .get(
      '/analytics',
      async ({ query, tenantState }) => {
        const days = Math.min(365, Math.max(1, Number(query.days ?? 30) || 30));
        // The window is `days` calendar days (UTC) ending today, so the chart's last bar is today.
        const from = new Date(Date.now() - (days - 1) * 86_400_000);
        from.setUTCHours(0, 0, 0, 0);
        const empty = {
          days,
          from: from.toISOString(),
          totals: {
            calls: 0,
            ok: 0,
            errors: 0,
            cancelled: 0,
            tokensIn: 0,
            tokensOut: 0,
            tokensReasoning: 0,
            costMicro: 0,
          },
          byDay: [] as DayStat[],
          byModel: [] as ModelStat[],
          byUser: [] as UserStat[],
          truncated: false,
          quota: quotaView(null),
        };
        if (!tenantState?.clientId) return ok(empty);
        const db = unsafeAcrossTenants(); // aggregate over the tenant's rows; condition explicit
        const rows = await db
          .select({
            created_at: schema.aiCalls.created_at,
            provider: schema.aiCalls.provider,
            model: schema.aiCalls.model,
            user_id: schema.aiCalls.user_id,
            tokens_in: schema.aiCalls.tokens_in,
            tokens_out: schema.aiCalls.tokens_out,
            reasoning_tokens: schema.aiCalls.reasoning_tokens,
            cost_micro: schema.aiCalls.cost_micro,
            status: schema.aiCalls.status,
          })
          .from(schema.aiCalls)
          .where(
            and(
              eq(schema.aiCalls.client_id, tenantState.clientId),
              gte(schema.aiCalls.created_at, from),
            ),
          )
          .orderBy(desc(schema.aiCalls.created_at))
          .limit(ANALYTICS_ROW_CAP + 1);
        const truncated = rows.length > ANALYTICS_ROW_CAP;
        if (truncated) rows.length = ANALYTICS_ROW_CAP;
        const totals = { ...empty.totals };
        const byDay = new Map<string, DayStat>();
        const byModel = new Map<string, ModelStat>();
        const byUser = new Map<string, UserStat>();
        const bump = (s: Stat, r: (typeof rows)[number]) => {
          s.calls++;
          s.tokensIn += r.tokens_in ?? 0;
          s.tokensOut += r.tokens_out ?? 0;
          s.tokensReasoning += r.reasoning_tokens ?? 0;
          s.costMicro += r.cost_micro ?? 0;
        };
        for (const r of rows) {
          bump(totals, r);
          if (r.status === 'ok') totals.ok++;
          else if (r.status === 'cancelled') totals.cancelled++;
          else totals.errors++;
          const day = r.created_at.toISOString().slice(0, 10);
          const d = byDay.get(day) ?? {
            day,
            calls: 0,
            tokensIn: 0,
            tokensOut: 0,
            tokensReasoning: 0,
            costMicro: 0,
          };
          bump(d, r);
          byDay.set(day, d);
          const mk = `${r.provider ?? ''}|${r.model ?? ''}`;
          const m = byModel.get(mk) ?? {
            provider: r.provider,
            model: r.model,
            calls: 0,
            tokensIn: 0,
            tokensOut: 0,
            tokensReasoning: 0,
            costMicro: 0,
          };
          bump(m, r);
          byModel.set(mk, m);
          const uk = r.user_id ?? '';
          const u = byUser.get(uk) ?? {
            userId: r.user_id,
            name: null,
            email: null,
            calls: 0,
            tokensIn: 0,
            tokensOut: 0,
            tokensReasoning: 0,
            costMicro: 0,
          };
          bump(u, r);
          byUser.set(uk, u);
        }
        // Fill the empty days so the chart has a bar per day.
        for (let i = 0; i < days; i++) {
          const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
          if (!byDay.has(day))
            byDay.set(day, {
              day,
              calls: 0,
              tokensIn: 0,
              tokensOut: 0,
              tokensReasoning: 0,
              costMicro: 0,
            });
        }
        const userIds = [...byUser.keys()].filter(Boolean);
        if (userIds.length) {
          const users = await db
            .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, userIds));
          for (const u of users) {
            const s = byUser.get(u.id);
            if (s) {
              s.name = u.name;
              s.email = u.email;
            }
          }
        }
        const byCost = (a: Stat, b: Stat) =>
          b.costMicro - a.costMicro || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut);
        const quota = await checkQuota(tenantState.clientId, null);
        return ok({
          days,
          from: from.toISOString(),
          totals,
          byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
          byModel: [...byModel.values()].sort(byCost),
          byUser: [...byUser.values()].sort(byCost).slice(0, 50),
          truncated,
          quota: quotaView(quota),
        });
      },
      {
        beforeHandle: permission('ai.log.read'),
        query: t.Object({ days: t.Optional(t.String()) }),
        response: {
          200: OkSchema(
            t.Object({
              days: t.Integer(),
              from: t.String(),
              totals: t.Object({
                calls: t.Integer(),
                ok: t.Integer(),
                errors: t.Integer(),
                cancelled: t.Integer(),
                tokensIn: t.Integer(),
                tokensOut: t.Integer(),
                tokensReasoning: t.Integer(),
                costMicro: t.Integer(),
              }),
              byDay: t.Array(
                t.Object({
                  day: t.String(),
                  calls: t.Integer(),
                  tokensIn: t.Integer(),
                  tokensOut: t.Integer(),
                  tokensReasoning: t.Integer(),
                  costMicro: t.Integer(),
                }),
              ),
              byModel: t.Array(
                t.Object({
                  provider: t.Nullable(t.String()),
                  model: t.Nullable(t.String()),
                  calls: t.Integer(),
                  tokensIn: t.Integer(),
                  tokensOut: t.Integer(),
                  tokensReasoning: t.Integer(),
                  costMicro: t.Integer(),
                }),
              ),
              byUser: t.Array(
                t.Object({
                  userId: t.Nullable(t.String()),
                  name: t.Nullable(t.String()),
                  email: t.Nullable(t.String()),
                  calls: t.Integer(),
                  tokensIn: t.Integer(),
                  tokensOut: t.Integer(),
                  tokensReasoning: t.Integer(),
                  costMicro: t.Integer(),
                }),
              ),
              truncated: t.Boolean(),
              quota: QuotaView,
            }),
          ),
          ...errorResponses,
        },
        detail: {
          summary:
            'AI usage analytics of the active tenant: totals, per day, per provider/model, per user (H-15). ?days=7|30|90',
        },
      },
    )

    // ---- quota & balance (B-6, H-14) ----
    .get(
      '/quota',
      async ({ auth, tenantState }) => {
        const a = auth as AuthState;
        if (!tenantState?.clientId) return ok(quotaView(null));
        return ok(quotaView(await checkQuota(tenantState.clientId, a.user.id)));
      },
      {
        beforeHandle: permission('ai.chat.read'),
        response: { 200: OkSchema(QuotaView), ...errorResponses },
        detail: {
          summary: 'My AI quota this month: tenant + user token usage vs limits, tenant balance',
        },
      },
    )
    .post(
      '/credit',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        if (!tenantState?.clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const before = await creditOf(tenantState.clientId);
        const after = await adjustCredit(
          tenantState.clientId,
          body.unlimited
            ? { unlimited: true }
            : { amountMicro: Math.round((body.amount ?? 0) * 1_000_000) },
          body.note ?? null,
          a.user.id,
        );
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.credit.adjust',
          resource: 'ai.credit',
          resourceId: tenantState.clientId,
          ip: clientIp(request, server),
          requestId,
          before,
          after: { ...after, note: body.note ?? null },
        });
        return ok(after);
      },
      {
        beforeHandle: permission('ai.credit.manage'),
        body: t.Object({
          /** Currency units; positive tops up, negative adjusts down. */
          amount: t.Optional(t.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 })),
          /** Remove the balance limit (back to "unlimited"). */
          unlimited: t.Optional(t.Boolean()),
          note: t.Optional(t.String({ maxLength: 255 })),
        }),
        response: {
          200: OkSchema(t.Object({ balanceMicro: t.Nullable(t.Number()), spentMicro: t.Number() })),
          ...errorResponses,
        },
        detail: { summary: 'Top up or adjust the tenant’s AI balance (B-6); ledgered and audited' },
      },
    )
    .get(
      '/credit/ledger',
      async ({ tenantState }) => {
        if (!tenantState?.clientId) return ok([]);
        return ok(
          (await creditLedger(tenantState.clientId)).map((r) => ({
            id: r.id,
            amountMicro: Number(r.amount_micro),
            balanceAfterMicro:
              r.balance_after_micro === null ? null : Number(r.balance_after_micro),
            note: r.note,
            actorId: r.actor_id,
            createdAt: r.created_at.toISOString(),
          })),
        );
      },
      {
        beforeHandle: permission('ai.credit.manage'),
        response: {
          200: OkSchema(
            t.Array(
              t.Object({
                id: t.String(),
                amountMicro: t.Number(),
                balanceAfterMicro: t.Nullable(t.Number()),
                note: t.Nullable(t.String()),
                actorId: t.Nullable(t.String()),
                createdAt: t.String(),
              }),
            ),
          ),
          ...errorResponses,
        },
        detail: { summary: 'Last 50 balance changes (top-ups, adjustments)' },
      },
    )

    // ---- external MCP servers (I-4, I-5): registrations are tenant data; secrets never echo ----
    .get(
      '/mcps',
      async ({ tenantState }) => {
        if (!tenantState?.tenant) return ok([]);
        const rows = await tenantState.tenant.select(
          schema.aiMcps,
          isNull(schema.aiMcps.deleted_at),
        );
        return ok(rows.sort((a, b) => a.name.localeCompare(b.name)).map(mcpView));
      },
      {
        beforeHandle: permission('ai.mcp.read'),
        response: { 200: OkSchema(t.Array(McpView)), ...errorResponses },
        detail: { summary: 'External MCP servers registered for the active tenant (I-4)' },
      },
    )
    .get(
      '/mcps/:id',
      async ({ params, set, requestId, tenantState }) => {
        const tenant = tenantState?.tenant;
        const row = tenant
          ? await tenant.selectOne(
              schema.aiMcps,
              and(eq(schema.aiMcps.id, params.id), isNull(schema.aiMcps.deleted_at)),
            )
          : null;
        if (!row || !tenant) {
          set.status = 404;
          return fail('not_found', 'Server MCP tidak ditemukan', requestId);
        }
        const tools = await tenant.select(schema.aiMcpTools, eq(schema.aiMcpTools.mcp_id, row.id));
        return ok({
          ...mcpView(row),
          tools: tools.sort((a, b) => a.name.localeCompare(b.name)).map(mcpToolView(row.code)),
        });
      },
      {
        beforeHandle: permission('ai.mcp.read'),
        params: t.Object({ id: Id }),
        response: {
          200: OkSchema(t.Intersect([McpView, t.Object({ tools: t.Array(McpToolView) })])),
          ...errorResponses,
        },
        detail: { summary: 'One MCP server with the tools discovered on it' },
      },
    )
    .post(
      '/mcps',
      async ({ auth, body, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        if (!tenant || !tenantState.clientId) {
          set.status = 409;
          return fail('conflict', 'Tidak ada tenant aktif', requestId);
        }
        const dup = await tenant.selectOne(
          schema.aiMcps,
          and(eq(schema.aiMcps.code, body.code), isNull(schema.aiMcps.deleted_at)),
        );
        if (dup) {
          set.status = 409;
          return fail('conflict', `Kode "${body.code}" sudah dipakai`, requestId, {
            code: body.code,
          });
        }
        const id = newId();
        await tenant.insert(schema.aiMcps, {
          id,
          code: body.code,
          name: body.name.trim(),
          transport: body.transport,
          url: body.url.trim(),
          headers: mergeHeaders(null, body.headers),
          enabled: body.enabled ?? true,
          last_status: null,
          last_error: null,
          last_synced_at: null,
          tools_count: 0,
        });
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.mcp.create',
          resource: 'ai.mcp',
          resourceId: id,
          ip: clientIp(request, server),
          requestId,
          after: { code: body.code, url: body.url, transport: body.transport },
        });
        const row = (await tenant.selectOne(schema.aiMcps, eq(schema.aiMcps.id, id))) as McpRow;
        set.status = 201;
        return ok(mcpView(row));
      },
      {
        beforeHandle: permission('ai.mcp.manage'),
        body: McpBody,
        response: { 201: OkSchema(McpView), ...errorResponses },
        detail: {
          summary: 'Register an external MCP server (http or sse); headers are stored as secrets',
        },
      },
    )
    .put(
      '/mcps/:id',
      async ({ auth, params, body, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const row = tenant
          ? await tenant.selectOne(
              schema.aiMcps,
              and(eq(schema.aiMcps.id, params.id), isNull(schema.aiMcps.deleted_at)),
            )
          : null;
        if (!row || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Server MCP tidak ditemukan', requestId);
        }
        if (body.code && body.code !== row.code) {
          const dup = await tenant.selectOne(
            schema.aiMcps,
            and(eq(schema.aiMcps.code, body.code), isNull(schema.aiMcps.deleted_at)),
          );
          if (dup) {
            set.status = 409;
            return fail('conflict', `Kode "${body.code}" sudah dipakai`, requestId, {
              code: body.code,
            });
          }
        }
        const patch: Partial<typeof schema.aiMcps.$inferInsert> = {};
        if (body.name !== undefined) patch.name = body.name.trim();
        if (body.code !== undefined) patch.code = body.code;
        if (body.transport !== undefined) patch.transport = body.transport;
        if (body.url !== undefined) patch.url = body.url.trim();
        if (body.headers !== undefined) patch.headers = mergeHeaders(row.headers, body.headers);
        if (body.enabled !== undefined) patch.enabled = body.enabled;
        if (Object.keys(patch).length)
          await tenant.update(schema.aiMcps, patch, eq(schema.aiMcps.id, row.id));
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.mcp.edit',
          resource: 'ai.mcp',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          after: { ...patch, headers: patch.headers ? Object.keys(patch.headers) : undefined },
        });
        const after = (await tenant.selectOne(
          schema.aiMcps,
          eq(schema.aiMcps.id, row.id),
        )) as McpRow;
        return ok(mcpView(after));
      },
      {
        beforeHandle: permission('ai.mcp.manage'),
        params: t.Object({ id: Id }),
        body: McpUpdateBody,
        response: { 200: OkSchema(McpView), ...errorResponses },
        detail: { summary: 'Update an MCP server; a header value of *** keeps the stored secret' },
      },
    )
    .delete(
      '/mcps/:id',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const n = tenant
          ? await tenant.update(
              schema.aiMcps,
              { deleted_at: new Date(), enabled: false },
              and(eq(schema.aiMcps.id, params.id), isNull(schema.aiMcps.deleted_at)),
            )
          : 0;
        if (!n || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Server MCP tidak ditemukan', requestId);
        }
        await tenant.delete(schema.aiMcpTools, eq(schema.aiMcpTools.mcp_id, params.id));
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.mcp.delete',
          resource: 'ai.mcp',
          resourceId: params.id,
          ip: clientIp(request, server),
          requestId,
        });
        return ok({ deleted: true as const });
      },
      {
        beforeHandle: permission('ai.mcp.manage'),
        params: t.Object({ id: Id }),
        response: { 200: OkSchema(t.Object({ deleted: t.Literal(true) })), ...errorResponses },
        detail: { summary: 'Remove an MCP server and forget its tools' },
      },
    )
    .post(
      '/mcps/:id/test',
      async ({ auth, params, set, request, server, requestId, tenantState }) => {
        const a = auth as AuthState;
        const tenant = tenantState?.tenant;
        const row = tenant
          ? await tenant.selectOne(
              schema.aiMcps,
              and(eq(schema.aiMcps.id, params.id), isNull(schema.aiMcps.deleted_at)),
            )
          : null;
        if (!row || !tenant || !tenantState.clientId) {
          set.status = 404;
          return fail('not_found', 'Server MCP tidak ditemukan', requestId);
        }
        const started = performance.now();
        let discovered: Awaited<ReturnType<typeof discoverRemoteTools>> = [];
        let error: string | null = null;
        try {
          discovered = await discoverRemoteTools(row);
        } catch (err) {
          error = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
        }
        const ms = Math.round(performance.now() - started);
        if (error === null) {
          // Replace the discovered set: tools that vanished upstream vanish here too.
          const existing = await tenant.select(
            schema.aiMcpTools,
            eq(schema.aiMcpTools.mcp_id, row.id),
          );
          const wasDisabled = new Set(existing.filter((x) => !x.enabled).map((x) => x.wire));
          await tenant.delete(schema.aiMcpTools, eq(schema.aiMcpTools.mcp_id, row.id));
          const seen = new Set<string>();
          for (const rt of discovered) {
            let wire = wireSuffix(rt.name);
            for (let i = 2; seen.has(wire); i++) wire = `${wireSuffix(rt.name).slice(0, 36)}_${i}`;
            seen.add(wire);
            await tenant.insert(schema.aiMcpTools, {
              id: newId(),
              mcp_id: row.id,
              name: rt.name.slice(0, 191),
              wire,
              description: rt.description,
              input_schema: rt.inputSchema,
              enabled: !wasDisabled.has(wire),
            });
          }
        }
        await tenant.update(
          schema.aiMcps,
          {
            last_status: error === null ? 'ok' : 'error',
            last_error: error,
            last_synced_at: new Date(),
            ...(error === null ? { tools_count: discovered.length } : {}),
          },
          eq(schema.aiMcps.id, row.id),
        );
        await writeAudit(unsafeAcrossTenants(), {
          clientId: tenantState.clientId,
          actorId: a.user.id,
          action: 'ai.mcp.test',
          resource: 'ai.mcp',
          resourceId: row.id,
          ip: clientIp(request, server),
          requestId,
          after: { ok: error === null, tools: discovered.length, ms },
        });
        const tools = await tenant.select(schema.aiMcpTools, eq(schema.aiMcpTools.mcp_id, row.id));
        return ok({
          ok: error === null,
          error,
          ms,
          tools: tools.sort((x, y) => x.name.localeCompare(y.name)).map(mcpToolView(row.code)),
        });
      },
      {
        beforeHandle: permission('ai.mcp.manage'),
        params: t.Object({ id: Id }),
        response: {
          200: OkSchema(
            t.Object({
              ok: t.Boolean(),
              error: t.Nullable(t.String()),
              ms: t.Integer(),
              tools: t.Array(McpToolView),
            }),
          ),
          ...errorResponses,
        },
        detail: {
          summary: 'Connect to the MCP server, (re)load its tool list, record status (I-5)',
        },
      },
    ),
);

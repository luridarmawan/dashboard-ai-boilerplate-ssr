import { col, defineTable } from '@core/db';
import { defineTables } from '@core/module-kit';

/**
 * AI tables (extension point 1): conversations + messages (H-6), the call log (H-9, M-3), the
 * external MCP servers a tenant connects to with the tools discovered on them (I-4), and the
 * provider profiles with their per-model price list (H-10).
 */
export default defineTables('AI', [
  defineTable({
    name: 'ai_providers',
    tenant: true,
    columns: {
      /** Slug shown in the picker and stored on each call log row. Unique per tenant. */
      code: col.identifier(40),
      name: col.varchar(191),
      /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
      base_url: col.varchar(512),
      /** Secret: masked in every view, never echoed back. */
      api_key: col.text().nullable(),
      default_model: col.identifier(120),
      enabled: col.boolean().default(true),
      /** Exactly one enabled profile per tenant is the default the picker starts on. */
      is_default: col.boolean().default(false),
      /** ok | error | null (never tested) */
      last_status: col.identifier(16).nullable(),
      last_error: col.text().nullable(),
      last_tested_at: col.datetime().nullable(),
    },
    indexes: [{ columns: ['client_id', 'code'], unique: true }],
  }),
  defineTable({
    name: 'ai_models',
    tenant: true,
    softDelete: false,
    columns: {
      provider_id: col.uuid().references('ai_providers', 'cascade'),
      model: col.identifier(120),
      label: col.varchar(191).nullable(),
      /** Price per 1M tokens in micro-units of the currency (0.15 USD → 150000). 0 = free/unknown. */
      price_in_micro: col.bigint().default(0),
      price_out_micro: col.bigint().default(0),
      enabled: col.boolean().default(true),
    },
    indexes: [{ columns: ['client_id', 'provider_id', 'model'], unique: true }],
  }),
  defineTable({
    name: 'ai_conversations',
    tenant: true,
    columns: {
      user_id: col.uuid().references('users', 'cascade'),
      title: col.varchar(191),
      /** Provider profile chosen for this conversation (H-10); null = the tenant's default. */
      provider_id: col.uuid().references('ai_providers', 'set null').nullable(),
      model: col.identifier(120).nullable(),
      archived_at: col.datetime().nullable(),
      last_message_at: col.datetime().nullable(),
    },
    indexes: [{ columns: ['client_id', 'user_id', 'last_message_at'] }],
  }),
  defineTable({
    name: 'ai_messages',
    tenant: true,
    softDelete: false,
    columns: {
      conversation_id: col.uuid().references('ai_conversations', 'cascade'),
      role: col.identifier(16),
      content: col.text(),
      tokens_in: col.int().nullable(),
      tokens_out: col.int().nullable(),
    },
    indexes: [{ columns: ['client_id', 'conversation_id', 'created_at'] }],
  }),
  defineTable({
    name: 'ai_calls',
    tenant: true,
    softDelete: false,
    columns: {
      user_id: col.uuid().nullable(),
      conversation_id: col.uuid().nullable(),
      endpoint: col.identifier(64),
      /** Provider profile code (H-10); null = the legacy `ai.*` settings provider. */
      provider: col.identifier(40).nullable(),
      model: col.identifier(120).nullable(),
      tokens_in: col.int().nullable(),
      tokens_out: col.int().nullable(),
      tokens_total: col.int().nullable(),
      latency_ms: col.int().nullable(),
      first_token_ms: col.int().nullable(),
      /** ok | error | cancelled */
      status: col.identifier(16),
      error: col.text().nullable(),
      /** Estimated cost in micro-units of the configured currency; null when no price is known. */
      cost_micro: col.int().nullable(),
      streamed: col.boolean().default(false),
    },
    indexes: [{ columns: ['client_id', 'created_at'] }, { columns: ['client_id', 'user_id'] }],
  }),
  defineTable({
    name: 'ai_mcps',
    tenant: true,
    columns: {
      /** Slug used in wire names: `ext_<code>__<tool>`. Unique per tenant. */
      code: col.identifier(40),
      name: col.varchar(191),
      /** http (Streamable HTTP) | sse */
      transport: col.identifier(16).default('http'),
      url: col.varchar(512),
      /** Extra request headers (e.g. Authorization). Values are secrets: masked in every view. */
      headers: col.json().nullable(),
      enabled: col.boolean().default(true),
      /** ok | error | null (never tested) */
      last_status: col.identifier(16).nullable(),
      last_error: col.text().nullable(),
      last_synced_at: col.datetime().nullable(),
      tools_count: col.int().default(0),
    },
    indexes: [{ columns: ['client_id', 'code'], unique: true }],
  }),
  defineTable({
    name: 'ai_mcp_tools',
    tenant: true,
    softDelete: false,
    columns: {
      mcp_id: col.uuid().references('ai_mcps', 'cascade'),
      /** The tool's name on the remote server, verbatim. */
      name: col.varchar(191),
      /** OpenAI/MCP-legal suffix derived from `name`; the wire name is `ext_<code>__<wire>`. */
      wire: col.identifier(64),
      description: col.text().nullable(),
      input_schema: col.json().nullable(),
      enabled: col.boolean().default(true),
    },
    indexes: [{ columns: ['client_id', 'mcp_id', 'wire'], unique: true }],
  }),
  defineTable({
    name: 'ai_credits',
    tenant: true,
    softDelete: false,
    columns: {
      /** Prepaid balance in micro-units of the currency; NULL = no balance limit (B-6, H-14). */
      balance_micro: col.bigint().nullable(),
      /** Lifetime spend charged against this tenant, micro-units. */
      spent_micro: col.bigint().default(0),
    },
    indexes: [{ columns: ['client_id'], unique: true }],
  }),
  defineTable({
    name: 'ai_credit_ledger',
    tenant: true,
    softDelete: false,
    columns: {
      /** Positive = top-up, negative = adjustment; charges from calls are not ledgered (see ai_calls.cost_micro). */
      amount_micro: col.bigint(),
      balance_after_micro: col.bigint().nullable(),
      note: col.varchar(255).nullable(),
      actor_id: col.uuid().nullable(),
    },
    indexes: [{ columns: ['client_id', 'created_at'] }],
  }),
]);

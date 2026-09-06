import { col, defineTable } from '@core/db';
import { defineTables } from '@core/module-kit';

/** AI tables (extension point 1): conversations + messages (H-6) and the call log (H-9, M-3). */
export default defineTables('AI', [
  defineTable({
    name: 'ai_conversations',
    tenant: true,
    columns: {
      user_id: col.uuid().references('users', 'cascade'),
      title: col.varchar(191),
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
]);

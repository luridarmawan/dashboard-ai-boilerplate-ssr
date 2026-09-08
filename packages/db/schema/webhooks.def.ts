import { col, defineTable } from '../src/descriptor.ts';

/**
 * Outgoing webhooks (PRD J-5). A tenant registers URLs that receive core events as signed JSON
 * POSTs; every attempt is a `webhook_deliveries` row so operators can see what was sent, retry a
 * failure, and audit what left the system. The secret signs each payload (HMAC-SHA256) and is
 * shown once at creation, like API tokens.
 */
export const webhooks = defineTable({
  name: 'webhooks',
  tenant: true,
  columns: {
    name: col.varchar(191),
    url: col.varchar(512),
    /** HMAC key; never returned after creation. */
    secret: col.text(),
    /** Event names (`user.created`, …) or `["*"]` for everything the tenant can see. */
    events: col.json(),
    enabled: col.boolean().default(true),
    /** ok | error | null (never delivered) */
    last_status: col.identifier(16).nullable(),
    last_error: col.text().nullable(),
    last_delivered_at: col.datetime().nullable(),
  },
  indexes: [{ columns: ['client_id', 'enabled'] }],
});

export const webhookDeliveries = defineTable({
  name: 'webhook_deliveries',
  tenant: true,
  softDelete: false,
  columns: {
    webhook_id: col.uuid().references('webhooks', 'cascade'),
    event: col.identifier(64),
    payload: col.json(),
    /** pending | delivered | failed (gave up after the retry schedule) */
    status: col.identifier(16).default('pending'),
    attempts: col.int().default(0),
    next_attempt_at: col.datetime().nullable(),
    response_status: col.int().nullable(),
    last_error: col.text().nullable(),
    delivered_at: col.datetime().nullable(),
  },
  indexes: [
    { columns: ['client_id', 'webhook_id', 'created_at'] },
    { columns: ['client_id', 'status', 'next_attempt_at'] },
  ],
});

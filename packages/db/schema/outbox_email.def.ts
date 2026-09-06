import { col, defineTable } from '../src/descriptor.ts';

/**
 * Email outbox (PRD J-2): a request only WRITES a row; the scheduler's worker sends it with
 * retries. `client_id` is informational (an inquiry belongs to a tenant, a password reset does
 * not), so the table is global for the facade. Status: pending → sending → sent | failed.
 */
export const outboxEmail = defineTable({
  name: 'outbox_email',
  tenant: false,
  softDelete: false,
  columns: {
    client_id: col.uuid().references('clients', 'set null').nullable(),
    to_address: col.varchar(191),
    to_name: col.varchar(191).nullable(),
    subject: col.varchar(255),
    /** Template id (`verify-email`, `reset-password`, `invite`, `contact`) — rendering happens at send time. */
    template: col.identifier(64),
    locale: col.identifier(8).default('id'),
    /** Template data; never contains secrets other than one-time tokens that are useless after use. */
    payload: col.json().nullable(),
    status: col.identifier(16).default('pending'),
    attempts: col.int().default(0),
    next_attempt_at: col.datetime().nullable(),
    sent_at: col.datetime().nullable(),
    last_error: col.text().nullable(),
    /** Which transport delivered it: `smtp` or `log` (development stand-in). */
    transport: col.identifier(16).nullable(),
  },
  indexes: [
    { columns: ['status', 'next_attempt_at'] },
    { columns: ['to_address'] },
    { columns: ['created_at'] },
  ],
});

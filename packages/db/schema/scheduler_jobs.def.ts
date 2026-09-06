import { col, defineTable } from '../src/descriptor.ts';

/**
 * Lease row per scheduled job (G-18). Global — jobs are process-level, not per tenant.
 * Claimed with one conditional UPDATE; see packages/runtime/src/scheduler.ts.
 */
export const schedulerJobs = defineTable({
  name: 'scheduler_jobs',
  tenant: false,
  softDelete: false,
  columns: {
    /** `<ns>.<name>`, unique — the identity the lease is taken on. */
    name: col.identifier(128),
    locked_by: col.identifier(128).nullable(),
    locked_until: col.datetime().nullable(),
    run_started_at: col.datetime().nullable(),
    last_run_at: col.datetime().nullable(),
    last_status: col.enum(['ok', 'failed'], 8).nullable(),
    last_error: col.text().nullable(),
  },
  indexes: [{ columns: ['name'], unique: true }],
});

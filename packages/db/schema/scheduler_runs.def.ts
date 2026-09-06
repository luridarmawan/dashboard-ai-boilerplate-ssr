import { col, defineTable } from '../src/descriptor.ts';

/** One row per job execution (G-18). Append-only; the exactly-once proof and the admin UI read it. */
export const schedulerRuns = defineTable({
  name: 'scheduler_runs',
  tenant: false,
  softDelete: false,
  columns: {
    job: col.identifier(128),
    instance_id: col.identifier(128),
    started_at: col.datetime(),
    finished_at: col.datetime().nullable(),
    duration_ms: col.int().nullable(),
    status: col.enum(['running', 'ok', 'failed'], 8),
    error: col.text().nullable(),
  },
  indexes: [{ columns: ['job', 'started_at'] }],
});

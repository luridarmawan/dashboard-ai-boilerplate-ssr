import { col, defineTable } from '../src/descriptor.ts';

/**
 * Ad-hoc job queue (PRD P2 "queue pekerjaan ad-hoc"): one row per unit of work handed to a
 * registered task — retries with backoff, priority, and a dead-letter state for what keeps
 * failing. Global with an informational `client_id` (like the outbox): the worker is process-
 * level and claims rows with one conditional UPDATE, so `--scale api=N` runs each job once.
 * Status: pending → running → done | pending (retry) | dead.
 */
export const queueJobs = defineTable({
  name: 'queue_jobs',
  tenant: false,
  softDelete: false,
  columns: {
    /** `<ns>.<task>` — the handler registered with `registerTask()`. */
    name: col.identifier(128),
    payload: col.json().nullable(),
    client_id: col.uuid().references('clients', 'set null').nullable(),
    /** Higher runs first among due rows; ties by `run_at`, then creation order. */
    priority: col.int().default(0),
    status: col.identifier(16).default('pending'),
    attempts: col.int().default(0),
    max_attempts: col.int().default(5),
    /** Not before this moment (delayed jobs, retry backoff). */
    run_at: col.datetime(),
    locked_by: col.identifier(128).nullable(),
    locked_until: col.datetime().nullable(),
    last_error: col.text().nullable(),
    /** Optional key: a second enqueue with the same key while one is pending/running is dropped. */
    dedupe_key: col.varchar(191).nullable(),
    request_id: col.identifier(64).nullable(),
    started_at: col.datetime().nullable(),
    finished_at: col.datetime().nullable(),
    /** JSON-safe return value of the handler, truncated; for humans, not for coupling. */
    result: col.json().nullable(),
  },
  indexes: [
    { columns: ['status', 'run_at', 'priority'] },
    { columns: ['name', 'status'] },
    { columns: ['client_id', 'created_at'] },
    { columns: ['dedupe_key'] },
  ],
});

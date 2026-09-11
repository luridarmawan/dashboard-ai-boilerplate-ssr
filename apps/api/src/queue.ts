import { and, asc, desc, eq, inArray, lt, lte, newId, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { metrics } from './metrics.ts';
import { emit } from './services.ts';

/**
 * Ad-hoc job queue (PRD P2): run a named task later, off the request path, with retries.
 *
 *   registerTask   core and modules declare handlers at boot (`@app/api/queue`); every instance
 *                  registers the same set, so any instance may pick any row
 *   enqueue        write one row (payload, priority, run_at, dedupe key) — the request never waits
 *   work           `core.queue.work` (every 10 s) and a nudge right after enqueue claim due rows
 *                  with a conditional UPDATE (pending → running, one winner under --scale api=N),
 *                  run the handler under a timeout, then mark done / schedule a retry
 *                  (10 s, 1 m, 5 m, 30 m, 2 h) / move to `dead` after `maxAttempts` — the
 *                  dead-letter state an admin inspects, retries or deletes at /queue
 *
 * Unlike scheduled jobs (G-18, periodic, no payload) this is for work that happens because of
 * something: an import, a report, a bulk email, a slow third-party call.
 *
 * Every attempt emits `job.started` and then `job.finished` (`done` / `retried` / `dead`) on the
 * core bus (G-17), so modules can hook them and rows carrying a `clientId` reach that tenant's
 * outgoing webhooks (J-5).
 */
export type QueueRow = typeof schema.queueJobs.$inferSelect;
export type QueueStatus = 'pending' | 'running' | 'done' | 'dead';

export interface TaskContext {
  readonly id: string;
  readonly name: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly clientId: string | null;
  readonly requestId: string | null;
  readonly instanceId: string;
  readonly signal: AbortSignal;
}
export type TaskHandler = (payload: unknown, ctx: TaskContext) => unknown | Promise<unknown>;
export interface TaskOptions {
  /** Attempts before the row goes to `dead`. Default 5. */
  readonly maxAttempts?: number;
  /** Per-attempt time limit; the lease is this plus a grace period. Default 60 s. */
  readonly timeoutMs?: number;
  readonly description?: { id: string; en: string };
}
export interface RegisteredTask extends TaskOptions {
  readonly name: string;
  readonly handler: TaskHandler;
  readonly module: string;
}
export interface EnqueueOptions {
  readonly clientId?: string | null;
  /** -100 … 100, higher first. Default 0. */
  readonly priority?: number;
  readonly runAt?: Date;
  readonly delayMs?: number;
  readonly maxAttempts?: number;
  /** Drop this enqueue when a pending/running row with the same key exists. */
  readonly dedupeKey?: string;
  readonly requestId?: string | null;
}

export const BACKOFF_S: readonly number[] = [10, 60, 300, 1800, 7200];
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_TIMEOUT_MS = 60_000;
const LEASE_GRACE_MS = 30_000;
const RESULT_MAX = 4000;
const NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;

const jobsTotal = metrics.counter('queue_jobs_total', 'Queue job outcomes by task.', [
  'name',
  'status',
]);
const jobDuration = metrics.histogram(
  'queue_job_duration_seconds',
  'Queue job handler duration by task.',
  ['name'],
);

const tasks = new Map<string, RegisteredTask>();

/** Declare a task handler. Names carry the owner's namespace (`core.` or `<ns>.`). */
export function registerTask(
  name: string,
  handler: TaskHandler,
  opts: TaskOptions & { module?: string } = {},
): void {
  if (!NAME_RE.test(name)) throw new Error(`queue: nama task "${name}" tidak valid`);
  if (tasks.has(name)) throw new Error(`queue: task "${name}" sudah terdaftar`);
  tasks.set(name, {
    name,
    handler,
    module: opts.module ?? name.split('.')[0] ?? 'core',
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.description ? { description: opts.description } : {}),
  });
}
/** Tests and module unload. */
export function unregisterTask(name: string): void {
  tasks.delete(name);
}
export function listTasks(): RegisteredTask[] {
  return [...tasks.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function enqueue(
  name: string,
  payload: unknown,
  opts: EnqueueOptions = {},
): Promise<{ id: string; deduped: boolean }> {
  const task = tasks.get(name);
  if (!task) throw new Error(`queue: task "${name}" belum terdaftar`);
  const db = unsafeAcrossTenants();
  if (opts.dedupeKey) {
    const [dup] = await db
      .select({ id: schema.queueJobs.id })
      .from(schema.queueJobs)
      .where(
        and(
          eq(schema.queueJobs.dedupe_key, opts.dedupeKey),
          inArray(schema.queueJobs.status, ['pending', 'running']),
        ),
      )
      .limit(1);
    if (dup) return { id: dup.id, deduped: true };
  }
  const id = newId();
  const runAt = opts.runAt ?? new Date(Date.now() + Math.max(0, opts.delayMs ?? 0));
  await db.insert(schema.queueJobs).values({
    id,
    name,
    payload: payload === undefined ? null : (payload as Record<string, unknown>),
    client_id: opts.clientId ?? null,
    priority: Math.max(-100, Math.min(100, Math.trunc(opts.priority ?? 0))),
    status: 'pending',
    attempts: 0,
    max_attempts: Math.max(1, opts.maxAttempts ?? task.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    run_at: runAt,
    dedupe_key: opts.dedupeKey ?? null,
    request_id: opts.requestId ?? null,
  });
  jobsTotal.inc({ name, status: 'enqueued' });
  if (runAt.getTime() <= Date.now()) nudgeQueue();
  return { id, deduped: false };
}

/** Put a dead (or stuck) job back in line, attempts reset. */
export async function retryJob(id: string): Promise<boolean> {
  const db = unsafeAcrossTenants();
  const r = await db
    .update(schema.queueJobs)
    .set({
      status: 'pending',
      attempts: 0,
      run_at: new Date(),
      locked_by: null,
      locked_until: null,
      last_error: null,
      finished_at: null,
    })
    .where(and(eq(schema.queueJobs.id, id), inArray(schema.queueJobs.status, ['dead', 'pending'])));
  const ok = affected(r) === 1;
  if (ok) nudgeQueue();
  return ok;
}

function affected(r: unknown): number {
  if (Array.isArray(r)) return Number((r[0] as { affectedRows?: number })?.affectedRows ?? 0);
  return Number(
    (r as { count?: number; rowCount?: number })?.rowCount ?? (r as { count?: number })?.count ?? 0,
  );
}
function safeResult(v: unknown): Record<string, unknown> | null {
  if (v === undefined || v === null) return null;
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return null;
    return s.length > RESULT_MAX
      ? { truncated: true, preview: s.slice(0, RESULT_MAX) }
      : (JSON.parse(s) as Record<string, unknown>);
  } catch {
    return { unserializable: true };
  }
}

export interface WorkResult {
  picked: number;
  done: number;
  retried: number;
  dead: number;
  requeued: number;
}

let instance = `${process.pid}@${(process.env.HOSTNAME ?? 'local').slice(0, 60)}`;
export function setQueueInstanceId(id: string): void {
  instance = id;
}

/** One pass: recover expired leases, then claim and run due rows by priority. */
export async function workQueueOnce(limit = 20, now = new Date()): Promise<WorkResult> {
  const db = unsafeAcrossTenants();
  const out: WorkResult = { picked: 0, done: 0, retried: 0, dead: 0, requeued: 0 };
  // A worker that died mid-run left `running` rows past their lease: give them back (or bury them).
  const stale = await db
    .select()
    .from(schema.queueJobs)
    .where(and(eq(schema.queueJobs.status, 'running'), lt(schema.queueJobs.locked_until, now)))
    .limit(limit);
  for (const row of stale) {
    const dead = row.attempts >= row.max_attempts;
    const r = await db
      .update(schema.queueJobs)
      .set({
        status: dead ? 'dead' : 'pending',
        locked_by: null,
        locked_until: null,
        last_error: `lease habis (instance ${row.locked_by ?? '?'} tidak selesai)`,
        run_at: dead ? row.run_at : new Date(now.getTime() + backoffMs(row.attempts)),
        finished_at: dead ? now : null,
      })
      .where(and(eq(schema.queueJobs.id, row.id), eq(schema.queueJobs.status, 'running')));
    if (affected(r) === 1) {
      out.requeued++;
      if (dead) {
        out.dead++;
        jobsTotal.inc({ name: row.name, status: 'dead' });
      }
      // The instance that started this attempt is gone, so nobody emitted its end: do it here,
      // otherwise a listener that saw `job.started` would wait forever for a job that is `dead`.
      emit('job.finished', {
        jobId: row.id,
        name: row.name,
        clientId: row.client_id,
        attempt: row.attempts,
        maxAttempts: row.max_attempts,
        status: dead ? 'dead' : 'retried',
        durationMs: row.started_at ? now.getTime() - row.started_at.getTime() : 0,
        error: `lease habis (instance ${row.locked_by ?? '?'} tidak selesai)`,
      });
    }
  }
  const due = await db
    .select()
    .from(schema.queueJobs)
    .where(and(eq(schema.queueJobs.status, 'pending'), lte(schema.queueJobs.run_at, now)))
    .orderBy(
      desc(schema.queueJobs.priority),
      asc(schema.queueJobs.run_at),
      asc(schema.queueJobs.created_at),
    )
    .limit(limit);
  for (const row of due) {
    const task = tasks.get(row.name);
    if (!task) continue; // another instance (or a newer build) may know it
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const claimed = await db
      .update(schema.queueJobs)
      .set({
        status: 'running',
        locked_by: instance,
        locked_until: new Date(Date.now() + timeoutMs + LEASE_GRACE_MS),
        attempts: row.attempts + 1,
        started_at: new Date(),
      })
      .where(and(eq(schema.queueJobs.id, row.id), eq(schema.queueJobs.status, 'pending')));
    if (affected(claimed) !== 1) continue; // someone else won
    out.picked++;
    const attempt = row.attempts + 1;
    const started = performance.now();
    // Events (G-17): one `job.started` per attempt, one `job.finished` with what the row became.
    // Rows with a `clientId` also reach that tenant's webhooks (J-5); global rows stay internal.
    emit('job.started', {
      jobId: row.id,
      name: row.name,
      clientId: row.client_id,
      attempt,
      maxAttempts: row.max_attempts,
    });
    // One timer drives both the handler's signal and the race; cleared in `finally` so a handler
    // that finished in time never leaves a rejecting promise behind.
    const ac = new AbortController();
    let timedOut: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timedOut = setTimeout(() => {
        const err = new Error(`timeout ${timeoutMs} ms`);
        ac.abort(err);
        rej(err);
      }, timeoutMs);
    });
    const ctx: TaskContext = {
      id: row.id,
      name: row.name,
      attempt,
      maxAttempts: row.max_attempts,
      clientId: row.client_id,
      requestId: row.request_id,
      instanceId: instance,
      signal: ac.signal,
    };
    try {
      const result = await Promise.race([Promise.resolve(task.handler(row.payload, ctx)), timeout]);
      await db
        .update(schema.queueJobs)
        .set({
          status: 'done',
          locked_by: null,
          locked_until: null,
          finished_at: new Date(),
          last_error: null,
          result: safeResult(result),
        })
        .where(eq(schema.queueJobs.id, row.id));
      out.done++;
      jobsTotal.inc({ name: row.name, status: 'done' });
      emit('job.finished', {
        jobId: row.id,
        name: row.name,
        clientId: row.client_id,
        attempt,
        maxAttempts: row.max_attempts,
        status: 'done',
        durationMs: Math.round(performance.now() - started),
        error: null,
      });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
      const dead = attempt >= row.max_attempts;
      await db
        .update(schema.queueJobs)
        .set({
          status: dead ? 'dead' : 'pending',
          locked_by: null,
          locked_until: null,
          last_error: message,
          run_at: dead ? row.run_at : new Date(Date.now() + backoffMs(attempt)),
          finished_at: dead ? new Date() : null,
        })
        .where(eq(schema.queueJobs.id, row.id));
      if (dead) {
        out.dead++;
        jobsTotal.inc({ name: row.name, status: 'dead' });
        logger.error('queue: job dead-lettered', {
          id: row.id,
          name: row.name,
          attempt,
          error: message,
        });
      } else {
        out.retried++;
        jobsTotal.inc({ name: row.name, status: 'retried' });
        logger.warn('queue: job failed, will retry', {
          id: row.id,
          name: row.name,
          attempt,
          error: message,
        });
      }
      emit('job.finished', {
        jobId: row.id,
        name: row.name,
        clientId: row.client_id,
        attempt,
        maxAttempts: row.max_attempts,
        status: dead ? 'dead' : 'retried',
        durationMs: Math.round(performance.now() - started),
        error: message,
      });
    } finally {
      clearTimeout(timedOut);
      jobDuration.observeMs({ name: row.name }, performance.now() - started);
    }
  }
  return out;
}

/** Delay before attempt `attempt + 1`, after `attempt` failures. */
export function backoffMs(attempt: number): number {
  return (BACKOFF_S[Math.min(Math.max(attempt, 1), BACKOFF_S.length) - 1] ?? 7200) * 1000;
}

// ---- nudge: run a pass soon after an enqueue, single-flight per process ----------------------
let nudged = false;
let working = false;
export function nudgeQueue(): void {
  if (nudged) return;
  nudged = true;
  setTimeout(async () => {
    nudged = false;
    if (working) return;
    working = true;
    try {
      await workQueueOnce();
    } catch (err) {
      logger.warn('queue: nudge pass failed', { error: String(err) });
    } finally {
      working = false;
    }
  }, 50);
}

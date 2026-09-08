import { and, type Db, eq, isNull, lt, lte, newId, or, schema } from '@core/db';
import { type JobDef, type ResolvedJob, resolveJob } from '@core/module-kit';

/**
 * The core scheduler (PRD G-18, Decision M, anti-pattern D1).
 *
 * Every API instance runs a scheduler; each tick it tries to CLAIM every due job with one
 * conditional UPDATE on `scheduler_jobs`:
 *
 *   UPDATE scheduler_jobs
 *      SET locked_by = me, locked_until = now + lease
 *    WHERE name = ?
 *      AND (locked_until IS NULL OR locked_until < now)          -- no live lease
 *      AND (last_run_at IS NULL OR last_run_at <= now - every)    -- interval elapsed
 *
 * Row locking makes that atomic on MySQL, MariaDB and PostgreSQL alike, with no RETURNING
 * or ON CONFLICT (§4.3). Exactly one instance sees affectedRows = 1 per interval; the rest
 * see 0 and skip. That is the whole exactly-once story — provable with `--scale api=3`.
 *
 * Time is the app's clock (UTC). Modest skew between instances only shifts who wins a
 * claim; the lease and the interval window still prevent double runs. A run that outlives
 * its lease may be started again elsewhere — keep runs short or split them.
 */

export interface SchedulerOptions {
  readonly db: Db;
  /** Stable per-process identity, e.g. `${hostname}:${pid}`. */
  readonly instanceId: string;
  /** How often to look for due jobs. Default 5 s; tests use less. */
  readonly tickMs?: number;
  readonly log?: (entry: Record<string, unknown>) => void;
  /** Clock override for tests. */
  readonly now?: () => Date;
  /** Observer for every run on this instance — metrics (M-6). Must not throw. */
  readonly onRun?: (run: {
    job: string;
    module: string;
    status: 'ok' | 'failed';
    durationMs: number;
  }) => void;
}

export interface Scheduler {
  register(job: JobDef, module?: string): void;
  /** Ensure lease rows exist, then start ticking. Idempotent. */
  start(): Promise<void>;
  /** Stop ticking and signal running jobs to abort; resolves when in-flight runs finish. */
  stop(): Promise<void>;
  /** One pass over all jobs — exposed for tests and the proof script. Returns names that ran here. */
  tick(): Promise<string[]>;
  jobs(): readonly { name: string; module: string; everySeconds: number; leaseSeconds: number }[];
}

interface Registered {
  job: ResolvedJob;
  module: string;
}

/** Affected-row count across drivers: mysql2 → [ResultSetHeader], postgres-js → RowList.count. */
function affected(result: unknown): number {
  if (Array.isArray(result))
    return Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0);
  return Number(
    (result as { count?: number; rowCount?: number })?.count ??
      (result as { rowCount?: number })?.rowCount ??
      0,
  );
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const { db, instanceId } = opts;
  const tickMs = opts.tickMs ?? 5_000;
  const now = opts.now ?? (() => new Date());
  const log =
    opts.log ??
    ((entry: Record<string, unknown>) =>
      console.log(JSON.stringify({ t: new Date().toISOString(), ...entry })));

  const registry = new Map<string, Registered>();
  const controller = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let ensured = false;
  const lastClaimLog = new Map<string, number>();

  /** Log a per-job problem at most once a minute — a DB outage must not flood the logs. */
  function logThrottled(job: string, entry: Record<string, unknown>): void {
    const t = Date.now();
    if (t - (lastClaimLog.get(job) ?? 0) < 60_000) return;
    lastClaimLog.set(job, t);
    log(entry);
  }

  /** Create missing lease rows. Retried on every tick until it succeeds, so a DB that is down
   *  at boot does not take the API down with it (the process still serves /health). */
  async function ensureRows(): Promise<boolean> {
    if (ensured) return true;
    try {
      for (const name of registry.keys()) await ensureRow(name);
      ensured = true;
      return true;
    } catch (err) {
      logThrottled('*', {
        level: 'error',
        msg: 'scheduler cannot reach the database yet',
        instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async function ensureRow(name: string): Promise<void> {
    const [row] = await db
      .select({ name: schema.schedulerJobs.name })
      .from(schema.schedulerJobs)
      .where(eq(schema.schedulerJobs.name, name))
      .limit(1);
    if (row) return;
    try {
      await db.insert(schema.schedulerJobs).values({ id: newId(), name });
    } catch {
      // Another instance inserted it first — that is fine, the row exists now.
    }
  }

  async function claim(r: Registered): Promise<boolean> {
    const t = now();
    const leaseUntil = new Date(t.getTime() + r.job.leaseSeconds * 1000);
    const dueBefore = new Date(t.getTime() - r.job.everySeconds * 1000);
    const result = await db
      .update(schema.schedulerJobs)
      .set({ locked_by: instanceId, locked_until: leaseUntil, run_started_at: t })
      .where(
        and(
          eq(schema.schedulerJobs.name, r.job.name),
          or(isNull(schema.schedulerJobs.locked_until), lt(schema.schedulerJobs.locked_until, t)),
          or(
            isNull(schema.schedulerJobs.last_run_at),
            lte(schema.schedulerJobs.last_run_at, dueBefore),
          ),
        ),
      );
    return affected(result) === 1;
  }

  async function runClaimed(r: Registered): Promise<void> {
    const startedAt = now();
    const runId = newId();
    await db.insert(schema.schedulerRuns).values({
      id: runId,
      job: r.job.name,
      instance_id: instanceId,
      started_at: startedAt,
      status: 'running',
    });
    let status: 'ok' | 'failed' = 'ok';
    let error: string | null = null;
    try {
      await r.job.run({ job: r.job.name, instanceId, startedAt, signal: controller.signal });
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
      log({
        level: 'error',
        msg: 'job failed',
        job: r.job.name,
        module: r.module,
        instanceId,
        error,
      });
    }
    const finishedAt = now();
    try {
      opts.onRun?.({
        job: r.job.name,
        module: r.module,
        status,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
    } catch {
      /* an observer must never break a run */
    }
    await db
      .update(schema.schedulerRuns)
      .set({
        finished_at: finishedAt,
        status,
        error,
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      })
      .where(eq(schema.schedulerRuns.id, runId));
    // Release the lease and stamp the run; last_run_at is what gates the next interval.
    await db
      .update(schema.schedulerJobs)
      .set({
        last_run_at: startedAt,
        last_status: status,
        last_error: error,
        locked_until: null,
        locked_by: null,
        run_started_at: null,
      })
      .where(eq(schema.schedulerJobs.name, r.job.name));
  }

  async function tick(): Promise<string[]> {
    if (ticking) return [];
    ticking = true;
    const ran: string[] = [];
    try {
      if (!(await ensureRows())) return [];
      for (const r of registry.values()) {
        if (controller.signal.aborted) break;
        let won = false;
        try {
          won = await claim(r);
        } catch (err) {
          logThrottled(r.job.name, {
            level: 'error',
            msg: 'claim failed',
            job: r.job.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (!won) continue;
        ran.push(r.job.name);
        const p = runClaimed(r).finally(() => inFlight.delete(p));
        inFlight.add(p);
        await p;
      }
    } finally {
      ticking = false;
    }
    return ran;
  }

  return {
    register(job, module = 'core') {
      const resolved = resolveJob(job);
      if (registry.has(resolved.name)) throw new Error(`job "${resolved.name}" sudah terdaftar`);
      registry.set(resolved.name, { job: resolved, module });
    },
    async start() {
      if (timer) return;
      await ensureRows(); // best effort; ticks keep retrying
      timer = setInterval(() => {
        void tick();
      }, tickMs);
      log({
        level: 'info',
        msg: 'scheduler started',
        instanceId,
        jobs: [...registry.keys()],
        tickMs,
      });
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      controller.abort();
      await Promise.allSettled([...inFlight]);
    },
    tick,
    jobs() {
      return [...registry.values()].map(({ job, module }) => ({
        name: job.name,
        module,
        everySeconds: job.everySeconds,
        leaseSeconds: job.leaseSeconds,
      }));
    },
  };
}

import { ModuleContractError } from './contract.ts';
import { namespaceOf } from './manifest.ts';

/**
 * Scheduled-job contract (PRD G-18, extension point 12).
 *
 * A job is a named, periodic unit of work. The core scheduler guarantees that for each
 * job at most ONE instance runs it per interval, even with `--scale api=3`, by taking a
 * lease in the database (Decision M: the default path needs no Redis). Modules declare
 * jobs in `jobs.ts`; they never start timers themselves.
 */

export interface JobContext {
  readonly job: string;
  /** Identifier of the process that won the lease for this run. */
  readonly instanceId: string;
  readonly startedAt: Date;
  /** Cooperative cancellation when the process is shutting down. */
  readonly signal: AbortSignal;
}

export interface JobDef {
  /** `<ns>.<name>` — stable identity, also the primary key of the lease row. */
  readonly name: string;
  /** Interval: a number of seconds, or a string like `30s`, `5m`, `1h`, `1d`. */
  readonly every: number | string;
  /**
   * How long the lease lasts (seconds). If a run exceeds it another instance may start the
   * job; keep runs well under it or split the work. Defaults to max(5 min, 2 × every).
   */
  readonly lease?: number;
  readonly description?: { id: string; en: string };
  readonly run: (ctx: JobContext) => void | Promise<void>;
}

export interface ResolvedJob extends JobDef {
  readonly everySeconds: number;
  readonly leaseSeconds: number;
}

const NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/;
const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Parse `every`: `90` → 90s, `'30s'`, `'5m'`, `'1h'`, `'1d'`. Minimum 1 second. */
export function parseEvery(every: number | string): number {
  let seconds: number;
  if (typeof every === 'number') seconds = every;
  else {
    const m = /^(\d+)\s*([smhd])$/.exec(every.trim());
    if (!m)
      throw new ModuleContractError(
        `interval "${every}" tidak valid — pakai detik, atau 30s/5m/1h/1d`,
      );
    seconds = Number(m[1]) * (UNITS[m[2] ?? 's'] ?? 1);
  }
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new ModuleContractError(`interval ${String(every)} harus bilangan bulat ≥ 1 detik`);
  }
  return seconds;
}

export function resolveJob(job: JobDef): ResolvedJob {
  const everySeconds = parseEvery(job.every);
  const leaseSeconds = job.lease ?? Math.max(300, everySeconds * 2);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new ModuleContractError(`job ${job.name}: lease harus bilangan bulat ≥ 1 detik`);
  }
  return { ...job, everySeconds, leaseSeconds };
}

/** Declare a module's periodic jobs (`jobs.ts`). Names must carry the module namespace. */
export function defineJobs(moduleName: string, jobs: readonly JobDef[]): readonly JobDef[] {
  const ns = namespaceOf(moduleName);
  const seen = new Set<string>();
  for (const j of jobs) {
    if (!NAME_RE.test(j.name)) throw new ModuleContractError(`nama job "${j.name}" tidak valid`);
    if (!j.name.startsWith(`${ns}.`)) {
      throw new ModuleContractError(`nama job "${j.name}" harus diawali "${ns}." (G-9)`);
    }
    if (seen.has(j.name)) throw new ModuleContractError(`job "${j.name}" duplikat`);
    seen.add(j.name);
    if (typeof j.run !== 'function')
      throw new ModuleContractError(`job "${j.name}": run bukan fungsi`);
    resolveJob(j); // validates every/lease eagerly
  }
  return jobs;
}

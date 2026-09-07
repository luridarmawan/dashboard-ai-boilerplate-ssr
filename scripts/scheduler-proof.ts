#!/usr/bin/env bun
/**
 * `bun scheduler:proof` — M0 gate 6: a scheduled job runs EXACTLY ONCE per interval when
 * several instances share one database (G-18, D1, Decision M).
 *
 * Launches N scheduler instances against DATABASE_URL, lets them compete for a probe job
 * for a fixed duration, then judges from `scheduler_runs` alone:
 *   - no two runs of the job may overlap in time
 *   - consecutive runs must be ≥ (every − tolerance) apart
 *   - the total must be about duration / every (not N × that)
 * Exits 1 on any violation. Expects migrations applied (`bun db:migrate`).
 */
import { fileURLToPath } from 'node:url';

const N = Number(process.env.PROBE_INSTANCES ?? 3);
const every = Number(process.env.PROBE_EVERY ?? 3);
const duration = Number(process.env.PROBE_DURATION ?? 12);
const tickMs = Number(process.env.PROBE_TICK_MS ?? 250);
const job = `core.probe_${Date.now()}`;

const root = fileURLToPath(new URL('..', import.meta.url));

// The generated schema must match DB_DIALECT (a previous matrix run may have left another
// dialect active); getDb() would refuse otherwise. Regenerate for this run's dialect.
const gen = Bun.spawnSync(['bun', 'run', 'scripts/codegen.ts'], {
  cwd: `${root}packages/db`,
  env: process.env,
  stdout: 'pipe',
  stderr: 'pipe',
});
if (gen.exitCode !== 0) {
  console.error(`scheduler:proof: codegen gagal\n${gen.stderr.toString()}`);
  process.exit(1);
}

const startedAt = new Date();

console.log(
  `scheduler:proof: ${N} instance × ${duration}s, job "${job}" every ${every}s, tick ${tickMs}ms`,
);

const procs = Array.from({ length: N }, (_, i) =>
  Bun.spawn(['bun', 'run', 'packages/runtime/scripts/scheduler-instance.ts'], {
    cwd: root,
    env: {
      ...process.env,
      INSTANCE_ID: `api-${i + 1}`,
      PROBE_JOB: job,
      PROBE_EVERY: String(every),
      PROBE_DURATION: String(duration),
      PROBE_TICK_MS: String(tickMs),
      SCHEDULER_ENABLED: 'true',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }),
);

// Watchdog: an instance that outlives duration + 30 s is stuck (e.g. a driver waiting on a
// handshake that never comes). Kill it and fail loudly rather than hang the proof.
const watchdog = setTimeout(
  () => {
    for (const p of procs) p.kill();
    console.error(`scheduler:proof: instance tidak selesai dalam ${duration + 30}s — dibunuh`);
  },
  (duration + 30) * 1000,
);

const results = await Promise.all(
  procs.map(async (p) => {
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { code, out: out.trim(), err: err.trim() };
  }),
);
clearTimeout(watchdog);

let exit = 0;
for (const r of results) {
  if (r.code !== 0) {
    exit = 1;
    console.log(
      `  ✗ instance keluar dengan kode ${r.code}\n${r.err
        .split('\n')
        .slice(-6)
        .map((l) => `      ${l}`)
        .join('\n')}`,
    );
  } else {
    console.log(`  ${r.out}`);
  }
}

// ---- judge from the database ----
// Imported only now: a static import would be hoisted above the codegen step and could load a
// schema generated for another dialect (the guard in getDb() would then rightly refuse).
const { and, asc, eq, getDb, gte, schema } = await import('@core/db');
const db = getDb();
const runs = await db
  .select()
  .from(schema.schedulerRuns)
  .where(and(eq(schema.schedulerRuns.job, job), gte(schema.schedulerRuns.started_at, startedAt)))
  .orderBy(asc(schema.schedulerRuns.started_at));

const problems: string[] = [];
const toleranceMs = tickMs * 2 + 250; // one tick of jitter each side, plus clock granularity
for (let i = 1; i < runs.length; i++) {
  const prev = runs[i - 1];
  const cur = runs[i];
  if (!prev || !cur) continue;
  const gap = cur.started_at.getTime() - prev.started_at.getTime();
  if (prev.finished_at && cur.started_at < prev.finished_at) {
    problems.push(
      `run #${i} (${cur.instance_id}) mulai sebelum run #${i - 1} (${prev.instance_id}) selesai — tumpang tindih`,
    );
  }
  if (gap < every * 1000 - toleranceMs) {
    problems.push(
      `run #${i} hanya ${gap} ms setelah run #${i - 1} (interval ${every}s) — dijalankan dua kali dalam satu jendela`,
    );
  }
}
const expectedMax = Math.ceil(duration / every) + 1;
if (runs.length > expectedMax)
  problems.push(
    `${runs.length} run untuk ${duration}s / ${every}s — maksimum wajar ${expectedMax}`,
  );
if (runs.length < Math.floor(duration / every) - 1)
  problems.push(`hanya ${runs.length} run — penjadwal tidak berjalan sebagaimana mestinya`);
for (const r of runs)
  if (r.status !== 'ok') problems.push(`run ${r.id} status ${r.status}: ${r.error ?? ''}`);

const byInstance = new Map<string, number>();
for (const r of runs) byInstance.set(r.instance_id, (byInstance.get(r.instance_id) ?? 0) + 1);

console.log(`\n  run tercatat : ${runs.length} (harapan ≈ ${Math.floor(duration / every)})`);
console.log(`  per instance : ${[...byInstance].map(([k, v]) => `${k}=${v}`).join(', ') || '-'}`);
console.log(
  `  jarak antar run (ms): ${
    runs
      .slice(1)
      .map((r, i) => r.started_at.getTime() - (runs[i]?.started_at.getTime() ?? 0))
      .join(', ') || '-'
  }`,
);

await db.$client.end();

if (problems.length || exit) {
  console.error(`\nscheduler:proof GAGAL:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  '\nscheduler:proof OK — setiap interval tepat satu run, tanpa tumpang tindih, dengan 3 instance berbagi satu database',
);

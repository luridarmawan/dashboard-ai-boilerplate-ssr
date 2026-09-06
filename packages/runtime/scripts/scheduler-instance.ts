#!/usr/bin/env bun
/**
 * One scheduler instance for the exactly-once proof (M0 gate 6, G-18).
 *
 * Registers a probe job and ticks against the shared database for a fixed duration, then
 * exits. `scripts/scheduler-proof.ts` launches several of these at once and inspects
 * `scheduler_runs` afterwards. Env: PROBE_JOB, PROBE_EVERY (s), PROBE_TICK_MS, PROBE_DURATION (s).
 */
import { getDb } from '@core/db';
import { createScheduler } from '../src/scheduler.ts';

const instanceId = process.env.INSTANCE_ID ?? `probe:${process.pid}`;
const job = process.env.PROBE_JOB ?? 'core.probe';
const every = Number(process.env.PROBE_EVERY ?? 3);
const tickMs = Number(process.env.PROBE_TICK_MS ?? 250);
const duration = Number(process.env.PROBE_DURATION ?? 12);

let runs = 0;
const scheduler = createScheduler({
  db: getDb(),
  instanceId,
  tickMs,
  log: () => {}, // the proof reads the database, not the logs
});
scheduler.register({
  name: job,
  every,
  lease: 30,
  run: async () => {
    runs++;
    // Simulate a short unit of work so overlapping claims (if the lock were broken) would show.
    await new Promise((r) => setTimeout(r, 200));
  },
});

await scheduler.start();
await new Promise((r) => setTimeout(r, duration * 1000));
await scheduler.stop();
await getDb().$client.end();
console.log(JSON.stringify({ instanceId, runs }));

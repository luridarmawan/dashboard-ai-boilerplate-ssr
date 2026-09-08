import { cleanupExpiredSessions } from '@core/auth';
import { env } from '@core/config';
import { getDb, unsafeAcrossTenants } from '@core/db';
import { CORE_EVENTS } from '@core/module-kit';
import { createEventBus, createScheduler, type EventBus, type Scheduler } from '@core/runtime';
import { moduleHooks, moduleJobs } from './generated/modules.ts';
import { instanceId } from './instance.ts';
import { runOutboxOnce } from './mail.ts';
import { hookRunsTotal, jobDuration, jobRunsTotal } from './metrics.ts';
import { setQueueInstanceId, workQueueOnce } from './queue.ts';
import { runLogRetentionOnce } from './retention.ts';
import { deliverWebhooksOnce, enqueueEvent, nudgeDelivery } from './webhooks.ts';

/**
 * Process-level runtime services, assembled once per API process:
 *   - the event bus, with every module's `hooks.ts` registered in init order (G-17)
 *   - the scheduler, with core jobs and every module's `jobs.ts` (G-18)
 *
 * Kept out of `app.ts` so `app.handle()` in tests never starts timers or touches the DB.
 */

export interface Runtime {
  readonly bus: EventBus;
  readonly scheduler: Scheduler;
  readonly instanceId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createRuntime(): Runtime {
  const e = env();

  const bus = createEventBus({
    onHook: (h) =>
      hookRunsTotal.inc({ event: h.event, module: h.module, status: h.ok ? 'ok' : 'failed' }),
  });
  for (const hooks of moduleHooks) bus.register(hooks);
  // Outgoing webhooks (J-5): every tenant event is queued for the tenant's webhooks, then nudged.
  for (const event of CORE_EVENTS)
    bus.on(
      event,
      async (payload, ctx) => {
        const n = await enqueueEvent(event, payload, { requestId: ctx.requestId });
        if (n) nudgeDelivery();
      },
      'core',
    );

  setQueueInstanceId(instanceId);
  const scheduler = createScheduler({
    db: getDb(),
    instanceId,
    onRun: (r) => {
      jobRunsTotal.inc({ job: r.job, status: r.status });
      jobDuration.observeMs({ job: r.job }, r.durationMs);
    },
  });
  // Core jobs: outbox delivery (M4), session cleanup, log retention (M7).
  scheduler.register({
    name: 'core.outbox.deliver',
    every: '1m',
    lease: 300,
    description: { id: 'Kirim email dari outbox', en: 'Deliver queued emails' },
    run: async () => {
      const r = await runOutboxOnce();
      if (r.picked)
        console.log(
          JSON.stringify({
            t: new Date().toISOString(),
            level: 'info',
            msg: 'outbox delivered',
            ...r,
          }),
        );
    },
  });
  scheduler.register({
    name: 'core.webhooks.deliver',
    every: '1m',
    lease: 300,
    description: { id: 'Kirim ulang webhook yang tertunda', en: 'Deliver pending webhooks' },
    run: async () => {
      const r = await deliverWebhooksOnce();
      if (r.picked)
        console.log(
          JSON.stringify({
            t: new Date().toISOString(),
            level: 'info',
            msg: 'webhooks delivered',
            ...r,
          }),
        );
    },
  });
  scheduler.register({
    name: 'core.queue.work',
    every: '10s',
    lease: 120,
    description: { id: 'Jalankan pekerjaan antrean yang jatuh tempo', en: 'Run due queue jobs' },
    run: async () => {
      const r = await workQueueOnce();
      if (r.picked || r.requeued)
        console.log(
          JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'queue worked', ...r }),
        );
    },
  });
  scheduler.register({
    name: 'core.sessions.cleanup',
    every: '1h',
    description: { id: 'Hapus sesi kedaluwarsa', en: 'Purge expired sessions' },
    run: async () => {
      // Sessions are a global table; no tenant in scope.
      const n = await cleanupExpiredSessions(unsafeAcrossTenants());
      if (n)
        console.log(
          JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'sessions purged', n }),
        );
    },
  });
  scheduler.register({
    name: 'core.logs.retention',
    every: '1d',
    lease: 900,
    description: {
      id: 'Pangkas audit log, riwayat job, dan outbox sesuai retensi (M-3)',
      en: 'Prune audit log, job history and outbox per retention policy (M-3)',
    },
    run: async () => {
      await runLogRetentionOnce();
    },
  });
  for (const { module, jobs } of moduleJobs)
    for (const job of jobs) scheduler.register(job, module);

  return {
    bus,
    scheduler,
    instanceId,
    async start() {
      if (e.SCHEDULER_ENABLED) await scheduler.start();
      else
        console.log(
          JSON.stringify({
            t: new Date().toISOString(),
            level: 'info',
            msg: 'scheduler disabled',
            instanceId,
          }),
        );
    },
    async stop() {
      await scheduler.stop();
    },
  };
}

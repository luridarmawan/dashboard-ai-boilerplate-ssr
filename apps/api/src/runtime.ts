import { cleanupExpiredSessions } from '@core/auth';
import { env } from '@core/config';
import { getDb, unsafeAcrossTenants } from '@core/db';
import { CORE_EVENTS } from '@core/module-kit';
import { createEventBus, createScheduler, type EventBus, type Scheduler } from '@core/runtime';
import { moduleHooks, moduleJobs, moduleMqtt } from './generated/modules.ts';
import { instanceId } from './instance.ts';
import { runOutboxOnce } from './mail.ts';
import { hookRunsTotal, jobDuration, jobRunsTotal } from './metrics.ts';
import { MqttService, publishEventsEnabled, setMqttService } from './mqtt.ts';
import { setQueueInstanceId, workQueueOnce } from './queue.ts';
import { runLogRetentionOnce } from './retention.ts';
import { deliverWebhooksOnce, enqueueEvent, nudgeDelivery } from './webhooks.ts';

/**
 * Process-level runtime services, assembled once per API process:
 *   - the event bus, with every module's `hooks.ts` registered in init order (G-17)
 *   - the scheduler, with core jobs and every module's `jobs.ts` (G-18)
 *   - the MQTT client, with every module's `mqtt.ts` (extension point 18), when switched on
 *
 * Kept out of `app.ts` so `app.handle()` in tests never starts timers or touches the DB.
 */

export interface Runtime {
  readonly bus: EventBus;
  readonly scheduler: Scheduler;
  readonly mqtt: MqttService;
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

  // MQTT (extension point 18): one client per process, following Settings → MQTT without a
  // restart. The core-event bridge is the MQTT counterpart of outgoing webhooks: every core event
  // goes to `events/<name>` under the deployment prefix when `mqtt.publish_events` is on.
  const mqtt = new MqttService({ modules: moduleMqtt });
  setMqttService(mqtt);
  bus.on(
    'config.saved',
    (payload) => {
      if (payload.section === 'mqtt' && payload.clientId === null) void mqtt.reload();
    },
    'core',
  );
  for (const event of CORE_EVENTS)
    bus.on(
      event,
      async (payload, ctx) => {
        if (!(await publishEventsEnabled())) return;
        await mqtt.publish(
          `events/${event}`,
          JSON.stringify({
            event,
            occurredAt: new Date().toISOString(),
            instanceId,
            requestId: ctx.requestId ?? null,
            data: payload ?? null,
          }),
        );
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
      id: 'Pangkas audit log, riwayat job, dan outbox sesuai retensi',
      en: 'Prune audit log, job history and outbox per retention policy',
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
    mqtt,
    instanceId,
    async start() {
      await mqtt.start();
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
      await mqtt.stop();
      setMqttService(null);
    },
  };
}

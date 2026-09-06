import { env } from '@core/config';
import { getDb } from '@core/db';
import { createEventBus, createScheduler, type EventBus, type Scheduler } from '@core/runtime';
import { moduleHooks, moduleJobs } from './generated/modules.ts';
import { instanceId } from './instance.ts';

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

  const bus = createEventBus();
  for (const hooks of moduleHooks) bus.register(hooks);

  const scheduler = createScheduler({ db: getDb(), instanceId });
  // Core jobs live here. Session cleanup, outbox delivery and log retention arrive with
  // their features (M1, M4, M7); the scheduler itself is proven now so they can rely on it.
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

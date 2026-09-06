import { count, schema, unsafeAcrossTenants } from '@core/db';
import { defineJobs } from '@core/module-kit';

/** Periodic work (extension point 12). The core scheduler runs each job once per interval across all instances. */
export default defineJobs('Dummy', [
  {
    name: 'dummy.heartbeat',
    every: '5m',
    description: { id: 'Menghitung catatan', en: 'Counts notes' },
    run: async ({ instanceId }) => {
      const [row] = await unsafeAcrossTenants().select({ n: count() }).from(schema.dummyNotes);
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          level: 'info',
          msg: 'dummy heartbeat',
          notes: Number(row?.n ?? 0),
          instanceId,
        }),
      );
    },
  },
]);

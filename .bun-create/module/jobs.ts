import { count, isNull, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { defineJobs } from '@core/module-kit';

/** Scheduled job (extension point 12): runs once per interval across all instances. */
export default defineJobs('Hello', [
  {
    name: 'hello.heartbeat',
    every: '1h',
    description: { id: 'Menghitung notes', en: 'Counts notes' },
    run: async ({ instanceId }) => {
      const [row] = await unsafeAcrossTenants()
        .select({ n: count() })
        .from(schema.helloNotes)
        .where(isNull(schema.helloNotes.deleted_at));
      logger.info('hello: heartbeat', { notes: Number(row?.n ?? 0), instanceId });
    },
  },
]);

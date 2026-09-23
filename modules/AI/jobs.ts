import { settings } from '@app/api/services';
import { affectedRows, and, lt, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { defineJobs } from '@core/module-kit';

/** M-3: the AI call log must not grow without bound — prune rows older than the configured retention. */
export default defineJobs('AI', [
  {
    name: 'ai.log_retention',
    every: '1d',
    lease: 900,
    description: {
      id: 'Hapus log AI yang lebih tua dari retensi',
      en: 'Prune AI call logs past retention',
    },
    run: async () => {
      const days = (await settings.get<number | null>(null, 'ai.log_retention_days')) ?? 30;
      const cutoff = new Date(Date.now() - days * 86_400_000);
      // Retention is a global policy here; a per-tenant value would need one DELETE per tenant.
      const n = affectedRows(
        await unsafeAcrossTenants()
          .delete(schema.aiCalls)
          .where(and(lt(schema.aiCalls.created_at, cutoff))),
      );
      if (n) logger.info('ai: log retention pruned', { deleted: n, days });
    },
  },
]);

import { settings } from '@app/api/services';
import { and, lt, schema, unsafeAcrossTenants } from '@core/db';
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
      const r = await unsafeAcrossTenants()
        .delete(schema.aiCalls)
        .where(and(lt(schema.aiCalls.created_at, cutoff)));
      const n = Array.isArray(r)
        ? Number((r[0] as { affectedRows?: number })?.affectedRows ?? 0)
        : Number((r as { count?: number })?.count ?? 0);
      if (n) logger.info('ai: log retention pruned', { deleted: n, days });
    },
  },
]);

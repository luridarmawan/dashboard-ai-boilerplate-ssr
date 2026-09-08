import { and, inArray, isNotNull, lt, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { settings } from './services.ts';

/**
 * Log retention (PRD M-3): audit log, scheduler run history and delivered/failed outbox rows are
 * pruned past the configured age. The policy is global (one number per installation) — a
 * per-tenant policy would need one DELETE per tenant; the schema allows it later.
 * Pending emails and running jobs are never touched.
 */
export interface RetentionResult {
  readonly audit: number;
  readonly schedulerRuns: number;
  readonly outbox: number;
  readonly notifications: number;
  readonly webhooks: number;
  readonly days: {
    audit: number;
    schedulerRuns: number;
    outbox: number;
    notifications: number;
    webhooks: number;
  };
}

function affected(r: unknown): number {
  if (Array.isArray(r)) return Number((r[0] as { affectedRows?: number })?.affectedRows ?? 0);
  return Number(
    (r as { count?: number; rowCount?: number })?.rowCount ?? (r as { count?: number })?.count ?? 0,
  );
}
const clamp = (v: number | null | undefined, def: number, min: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : def;

export async function runLogRetentionOnce(now = new Date()): Promise<RetentionResult> {
  const db = unsafeAcrossTenants();
  const days = {
    audit: clamp(await settings.get<number | null>(null, 'logs.audit_retention_days'), 365, 30),
    schedulerRuns: clamp(
      await settings.get<number | null>(null, 'logs.scheduler_runs_retention_days'),
      14,
      1,
    ),
    outbox: clamp(await settings.get<number | null>(null, 'logs.outbox_retention_days'), 30, 1),
    notifications: clamp(
      await settings.get<number | null>(null, 'logs.notification_retention_days'),
      90,
      7,
    ),
    webhooks: clamp(await settings.get<number | null>(null, 'logs.webhook_retention_days'), 30, 1),
  };
  const at = (d: number) => new Date(now.getTime() - d * 86_400_000);

  const audit = affected(
    await db.delete(schema.auditLog).where(lt(schema.auditLog.created_at, at(days.audit))),
  );
  const schedulerRuns = affected(
    await db
      .delete(schema.schedulerRuns)
      .where(
        and(
          isNotNull(schema.schedulerRuns.finished_at),
          lt(schema.schedulerRuns.started_at, at(days.schedulerRuns)),
        ),
      ),
  );
  const outbox = affected(
    await db
      .delete(schema.outboxEmail)
      .where(
        and(
          inArray(schema.outboxEmail.status, ['sent', 'failed']),
          lt(schema.outboxEmail.created_at, at(days.outbox)),
        ),
      ),
  );
  // Read notifications only (J-4): an unread one is still a message for its owner.
  const notifications = affected(
    await db
      .delete(schema.notifications)
      .where(
        and(
          isNotNull(schema.notifications.read_at),
          lt(schema.notifications.created_at, at(days.notifications)),
        ),
      ),
  );
  // Delivered/failed webhook attempts are history; pending ones are still owed.
  const webhooks = affected(
    await db
      .delete(schema.webhookDeliveries)
      .where(
        and(
          inArray(schema.webhookDeliveries.status, ['delivered', 'failed']),
          lt(schema.webhookDeliveries.created_at, at(days.webhooks)),
        ),
      ),
  );
  if (audit || schedulerRuns || outbox || notifications || webhooks)
    logger.info('logs: retention pruned', {
      audit,
      schedulerRuns,
      outbox,
      notifications,
      webhooks,
      days,
    });
  return { audit, schedulerRuns, outbox, notifications, webhooks, days };
}

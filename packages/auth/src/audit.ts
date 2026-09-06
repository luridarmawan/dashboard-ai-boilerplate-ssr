import { type Db, newId, schema } from '@core/db';
import { logger } from '@core/logger';

/**
 * Audit trail for sensitive actions (PRD M-2): actor, tenant, IP, before/after. `audit_log` is
 * tenant-scoped with `client_id NOT NULL`; events that happen before a tenant is known (a failed
 * login for an unknown email, a password reset) are logged as structured log lines instead, so
 * nothing is silently dropped.
 */
export interface AuditEntry {
  readonly clientId: string | null;
  readonly actorId: string | null;
  /** `resource.action`, same shape as permissions (C-1), e.g. `auth.login`, `user.edit`. */
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string | null;
  readonly ip?: string | null;
  readonly requestId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly note?: string | null;
}

export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  if (!e.clientId) {
    logger.info('audit (no tenant)', {
      action: e.action,
      resource: e.resource,
      resourceId: e.resourceId ?? null,
      actorId: e.actorId,
      ip: e.ip ?? null,
      requestId: e.requestId ?? null,
    });
    return;
  }
  await db.insert(schema.auditLog).values({
    id: newId(),
    client_id: e.clientId,
    actor_id: e.actorId,
    action: e.action.slice(0, 64),
    resource: e.resource.slice(0, 64),
    resource_id: e.resourceId?.slice(0, 64) ?? null,
    ip: e.ip?.slice(0, 45) ?? null,
    request_id: e.requestId?.slice(0, 64) ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    note: e.note ?? null,
  });
}

import { and, desc, eq, isNull } from 'drizzle-orm';
import { type Db, schema } from '../generated/active.ts';

/**
 * Sample queries — not a feature. They exist so `bun check` has real domain code to
 * typecheck TWICE (DB_DIALECT=mysql, then =postgres). If Drizzle's query builder stops
 * being portable in some version, this file fails — not production.
 * Query builder only; raw SQL is forbidden in domain code (§4.3).
 */
export async function findClientByCode(db: Db, code: string) {
  const rows = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(and(eq(schema.clients.code, code), isNull(schema.clients.deleted_at)))
    .limit(1);
  return rows[0] ?? null;
}

export async function recentAuditForTenant(db: Db, clientId: string, limit = 50) {
  return db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.client_id, clientId))
    .orderBy(desc(schema.auditLog.id)) // UUIDv7 is time-ordered — the id itself is the cursor (N-5)
    .limit(limit);
}

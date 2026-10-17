import { activeDialect, type Db } from './generated/active.ts';
import { type TenantDb, tenantScope } from './tenant.ts';

/**
 * Run `fn` in ONE database transaction, with the tenant facade bound to it — for writes that must
 * land together or not at all (a permalink change and its redirect, a row and its registry
 * entry). MySQL, MariaDB and PostgreSQL roll everything back when `fn` throws. bun:sqlite cannot
 * hold a transaction open across `await`, so on SQLite (a single-process development database)
 * the statements run in sequence without one: checks still run before anything is written, but
 * a write that fails halfway is not undone there.
 */
export async function inTenantTransaction<T>(
  db: Db,
  clientId: string,
  fn: (tenant: TenantDb) => Promise<T>,
): Promise<T> {
  if ((activeDialect as string) === 'sqlite') return fn(tenantScope(db, clientId));
  const tx = db as unknown as {
    transaction<R>(run: (handle: unknown) => Promise<R>): Promise<R>;
  };
  return tx.transaction((handle) => fn(tenantScope(handle as Db, clientId)));
}

/** True when a driver error (or its cause) is a unique-index violation, on any supported dialect. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    const x = e as { code?: unknown; errno?: unknown; cause?: unknown };
    if (x.code === 'ER_DUP_ENTRY' || x.errno === 1062 || x.code === '23505') return true;
    if (typeof x.code === 'string' && x.code.startsWith('SQLITE_CONSTRAINT')) return true;
    e = x.cause;
  }
  return false;
}

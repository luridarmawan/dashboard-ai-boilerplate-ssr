/**
 * `@core/db` — the package's public surface.
 *
 * Domain code and modules import ONLY from here (G-3). Available:
 *   - `getDb()`      one connection instance for the whole process (P-6, anti-pattern D3)
 *   - `schema`       Drizzle tables for the active dialect (chosen by codegen from DB_DIALECT)
 *   - `newId()`      UUIDv7 — the only ID generator (O-6)
 *   - `defineTable`  dialect-neutral descriptor for module tables (§4.3, §4.5)
 *   - `STATUS`       status_id semantics, defined once (O-4)
 */
import { env } from '@core/config';
import { activeDialect, createDb, type Db } from './generated/active.ts';

export type { SQL, Table } from 'drizzle-orm';
/**
 * Query operators, re-exported so core and modules import them from ONE place. Modules never
 * depend on drizzle-orm directly: one ORM version across the workspace, and swapping the
 * query layer later (§10 names Kysely as the fallback) touches this file, not every module.
 */
export {
  and,
  asc,
  avg,
  between,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notInArray,
  or,
  sql,
  sum,
} from 'drizzle-orm';
export {
  Col,
  type ColumnDef,
  type ColumnType,
  col,
  DescriptorError,
  defineTable,
  type IndexDef,
  RESERVED_COLUMNS,
  STATUS,
  type Status,
  type TableDef,
} from './descriptor.ts';
export { activeDialect, type Db, schema, tenantTables } from './generated/active.ts';
export { createUuidV7Generator, isUuidV7, newId, uuidV7Time } from './id.ts';

import { type TenantDb, tenantScope } from './tenant.ts';

export { type TenantDb, TenantGuardError, tenantScope } from './tenant.ts';

let instance: Db | undefined;

/**
 * This process's single database instance. Created lazily on first call from the
 * already-validated `DATABASE_URL`. Lint forbids instantiating a DB client anywhere else.
 */
export function getDb(): Db {
  if (!instance) {
    const e = env();
    // The generated schema binds a driver at codegen time. Connecting the postgres driver to a
    // MySQL URL (or vice versa) does not fail — it hangs on the handshake. Refuse up front.
    const family = (d: string): 'pg' | 'mysql' => (d === 'postgres' ? 'pg' : 'mysql');
    if (family(e.DB_DIALECT) !== family(activeDialect)) {
      throw new Error(
        `@core/db: skema ter-generate untuk ${activeDialect}, tapi DB_DIALECT=${e.DB_DIALECT} — jalankan \`bun db:codegen\` dengan DB_DIALECT yang sama`,
      );
    }
    instance = createDb(e.DATABASE_URL);
  }
  return instance;
}

/** Connection-pool numbers for metrics (M-6); null before the first connection or when the driver hides them. */
export function poolStats(): {
  max: number;
  open: number | null;
  idle: number | null;
  queued: number | null;
} | null {
  if (!instance) return null;
  const client = (instance as unknown as { $client?: unknown }).$client as
    | {
        pool?: {
          config?: { connectionLimit?: number };
          _allConnections?: { length: number };
          _freeConnections?: { length: number };
          _connectionQueue?: { length: number };
        };
        options?: { max?: number };
      }
    | undefined;
  if (!client) return null;
  if (client.pool) {
    // mysql2: the promise wrapper exposes the callback pool, whose internals hold the counts.
    return {
      max: client.pool.config?.connectionLimit ?? 10,
      open: client.pool._allConnections?.length ?? null,
      idle: client.pool._freeConnections?.length ?? null,
      queued: client.pool._connectionQueue?.length ?? null,
    };
  }
  // postgres.js publishes only its configured maximum.
  return { max: client.options?.max ?? 10, open: null, idle: null, queued: null };
}

/**
 * The connection scoped to ONE tenant (B-3): every query on a tenant table carries
 * `client_id = clientId`. This is what domain code and modules use.
 */
export function forTenant(clientId: string): TenantDb {
  return tenantScope(getDb(), clientId);
}

/**
 * The raw connection — no tenant filter. Deliberately verbose and greppable: an audit lists every
 * cross-tenant query with `grep unsafeAcrossTenants`. Justify each use in a comment.
 */
export function unsafeAcrossTenants(): Db {
  return getDb();
}

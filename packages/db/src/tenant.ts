import { and, eq, getTableName, type SQL, type Table } from 'drizzle-orm';
import { type Db, tenantTables } from './generated/active.ts';

/**
 * The tenant guard at the data layer (PRD B-3, Decision N).
 *
 * All tenants share one database, so nothing physical prevents a query from reading another
 * tenant's rows — only code does. This facade is that code: every operation on a table listed
 * in `tenantTables` gets `client_id = <this tenant>` injected, inserts get it filled in, and a
 * value that names another tenant is rejected. Global tables (users, clients, sessions…) pass
 * through untouched.
 *
 * Domain code and modules receive ONLY this facade (a lint rule forbids importing `getDb`
 * there). The one way around it is `unsafeAcrossTenants()` — named so that `grep` finds every
 * cross-tenant query during an audit.
 */

// biome-ignore lint/suspicious/noExplicitAny: dialect-generic facade — the concrete Db type is chosen at codegen time
type AnyDb = any;
type Row<T extends Table> = T['$inferSelect'];
type Insert<T extends Table> = T['$inferInsert'];

export class TenantGuardError extends Error {
  override name = 'TenantGuardError';
}

export interface TenantDb {
  readonly clientId: string;
  /** Rows of `table` belonging to this tenant, optionally narrowed further. */
  select<T extends Table>(table: T, where?: SQL): Promise<Row<T>[]>;
  /** First matching row or null. */
  selectOne<T extends Table>(table: T, where?: SQL): Promise<Row<T> | null>;
  /** Insert with `client_id` filled in; a different `client_id` in `values` is an error. */
  insert<T extends Table>(table: T, values: Insert<T> | Insert<T>[]): Promise<void>;
  /** Update rows of this tenant only. `where` is required — an unbounded update is never intended. */
  update<T extends Table>(table: T, set: Partial<Insert<T>>, where: SQL): Promise<number>;
  /** Delete rows of this tenant only. `where` is required. */
  delete<T extends Table>(table: T, where: SQL): Promise<number>;
  /** The tenant condition for hand-built queries (joins, aggregates). Null for global tables. */
  scope<T extends Table>(table: T): SQL | null;
}

function isTenantTable(table: Table): boolean {
  return tenantTables.has(getTableName(table));
}

function clientIdColumn(table: Table): unknown {
  const col = (table as unknown as Record<string, unknown>).client_id;
  if (!col) {
    throw new TenantGuardError(
      `tabel ${getTableName(table)} terdaftar ber-tenant tapi tidak punya kolom client_id`,
    );
  }
  return col;
}

function affected(result: unknown): number {
  if (Array.isArray(result))
    return Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0);
  return Number((result as { count?: number })?.count ?? 0);
}

/** Build a facade bound to one tenant over an existing connection. */
export function tenantScope(db: Db, clientId: string): TenantDb {
  if (!clientId) throw new TenantGuardError('forTenant(): clientId kosong');
  const raw: AnyDb = db;

  const scope = <T extends Table>(table: T): SQL | null =>
    // biome-ignore lint/suspicious/noExplicitAny: column type is dialect-specific
    isTenantTable(table) ? eq(clientIdColumn(table) as any, clientId) : null;

  const guard = (table: Table, where?: SQL): SQL | undefined => {
    const s = scope(table);
    if (!s) return where;
    return where ? and(s, where) : s;
  };

  return {
    clientId,
    scope,
    async select(table, where) {
      const w = guard(table, where);
      const q = raw.select().from(table);
      return (w ? await q.where(w) : await q) as Row<typeof table>[];
    },
    async selectOne(table, where) {
      const w = guard(table, where);
      const q = raw.select().from(table);
      const rows = (w ? await q.where(w).limit(1) : await q.limit(1)) as Row<typeof table>[];
      return rows[0] ?? null;
    },
    async insert(table, values) {
      const list = Array.isArray(values) ? values : [values];
      if (isTenantTable(table)) {
        for (const v of list as Record<string, unknown>[]) {
          if (v.client_id !== undefined && v.client_id !== clientId) {
            throw new TenantGuardError(
              `insert ke ${getTableName(table)} menyebut client_id lain (${String(v.client_id)}) dari tenant aktif`,
            );
          }
          v.client_id = clientId;
        }
      }
      await raw.insert(table).values(list);
    },
    async update(table, set, where) {
      if (!where) throw new TenantGuardError(`update ${getTableName(table)} tanpa kondisi`);
      if (isTenantTable(table) && (set as Record<string, unknown>).client_id !== undefined) {
        throw new TenantGuardError(`update ${getTableName(table)} tidak boleh mengubah client_id`);
      }
      return affected(await raw.update(table).set(set).where(guard(table, where)));
    },
    async delete(table, where) {
      if (!where) throw new TenantGuardError(`delete ${getTableName(table)} tanpa kondisi`);
      return affected(await raw.delete(table).where(guard(table, where)));
    },
  };
}

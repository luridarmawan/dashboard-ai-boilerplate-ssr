import { describe, expect, test } from 'bun:test';
import { eq, getTableName, type SQL, type Table } from 'drizzle-orm';
import { createDb } from '../src/dialect/mysql-client.ts';
import * as mysqlSchema from '../src/generated/schema.mysql.ts';
import { TenantGuardError, tenantScope } from '../src/tenant.ts';

/**
 * M1 gate #3: a query on a tenant table cannot slip through without its tenant filter (B-3).
 *
 * No database is needed: a recording stand-in captures the WHERE the facade builds, and a real
 * (never-connecting) Drizzle instance renders it to SQL so the assertion is on the actual
 * `client_id = ?` clause — not on the facade's good intentions.
 */

// A Drizzle instance for rendering SQL only. mysql2 does not open a connection until a query runs.
const render = createDb('mysql://none:none@127.0.0.1:1/none');
const toSql = (table: Table, where: SQL | undefined) =>
  // biome-ignore lint/suspicious/noExplicitAny: test helper over a dialect-specific builder
  (render as any).select().from(table).where(where).toSQL() as { sql: string; params: unknown[] };

interface Captured {
  op: 'select' | 'insert' | 'update' | 'delete';
  table: Table;
  where?: SQL;
  values?: unknown;
  set?: unknown;
}

/** Records what the facade asks for instead of touching a database. */
function recordingDb(log: Captured[]) {
  const chain = (entry: Captured) => {
    const q = {
      where: (w: SQL) => {
        entry.where = w;
        return q;
      },
      limit: () => q,
      // biome-ignore lint/suspicious/noThenProperty: the stand-in must be awaitable like a Drizzle query
      then: (res: (v: unknown) => void) => res(entry.op === 'select' ? [] : [{ affectedRows: 1 }]),
    };
    return q;
  };
  return {
    select: () => ({
      from: (table: Table) => {
        const e: Captured = { op: 'select', table };
        log.push(e);
        return chain(e);
      },
    }),
    insert: (table: Table) => ({
      values: (values: unknown) => {
        log.push({ op: 'insert', table, values });
        return Promise.resolve();
      },
    }),
    update: (table: Table) => ({
      set: (set: unknown) => {
        const e: Captured = { op: 'update', table, set };
        log.push(e);
        return chain(e);
      },
    }),
    delete: (table: Table) => {
      const e: Captured = { op: 'delete', table };
      log.push(e);
      return chain(e);
    },
  };
}

const TENANT = '01900000-0000-7000-8000-000000000001';
const OTHER = '01900000-0000-7000-8000-000000000002';
const { clientUserMaps, groups, users, clients, auditLog } = mysqlSchema;

describe('tenant guard — tenant tables always carry client_id (B-3)', () => {
  test('select without a where still filters by the active tenant', async () => {
    const log: Captured[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: recording stand-in
    const t = tenantScope(recordingDb(log) as any, TENANT);
    await t.select(groups);
    const { sql, params } = toSql(groups, log[0]?.where);
    expect(sql).toMatch(/`groups`\.`client_id` = \?/);
    expect(params).toEqual([TENANT]);
  });

  test('a caller-supplied where is AND-ed with the tenant filter, never replaces it', async () => {
    const log: Captured[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: recording stand-in
    const t = tenantScope(recordingDb(log) as any, TENANT);
    await t.select(groups, eq(groups.code, 'admin'));
    const { sql, params } = toSql(groups, log[0]?.where);
    expect(sql).toMatch(/`groups`\.`client_id` = \? and `groups`\.`code` = \?/);
    expect(params).toEqual([TENANT, 'admin']);
  });

  test('global tables (users, clients) pass through without a client_id clause', async () => {
    const log: Captured[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: recording stand-in
    const t = tenantScope(recordingDb(log) as any, TENANT);
    await t.select(users, eq(users.email, 'a@b.c'));
    await t.select(clients);
    expect(toSql(users, log[0]?.where).sql).not.toContain('client_id');
    expect(log[1]?.where).toBeUndefined();
    expect(t.scope(users)).toBeNull();
    expect(t.scope(auditLog)).not.toBeNull();
  });

  test('insert fills client_id, and refuses a row that names another tenant', async () => {
    const log: Captured[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: recording stand-in
    const t = tenantScope(recordingDb(log) as any, TENANT);
    await t.insert(clientUserMaps, { id: 'x', user_id: 'u' } as never);
    const inserted = log[0]?.values as Record<string, unknown>[] | undefined;
    expect(inserted?.[0]?.client_id).toBe(TENANT);
    await expect(
      t.insert(clientUserMaps, { id: 'y', user_id: 'u', client_id: OTHER } as never),
    ).rejects.toBeInstanceOf(TenantGuardError);
  });

  test('update and delete are scoped, require a where, and cannot move rows between tenants', async () => {
    const log: Captured[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: recording stand-in
    const t = tenantScope(recordingDb(log) as any, TENANT);
    await t.update(groups, { name: 'x' } as never, eq(groups.code, 'admin'));
    expect(toSql(groups, log[0]?.where).sql).toMatch(/`groups`\.`client_id` = \? and/);
    await t.delete(groups, eq(groups.code, 'admin'));
    expect(toSql(groups, log[1]?.where).sql).toMatch(/`groups`\.`client_id` = \? and/);
    await expect(
      t.update(groups, { name: 'x' } as never, undefined as never),
    ).rejects.toBeInstanceOf(TenantGuardError);
    await expect(t.delete(groups, undefined as never)).rejects.toBeInstanceOf(TenantGuardError);
    await expect(
      t.update(groups, { client_id: OTHER } as never, eq(groups.code, 'a')),
    ).rejects.toBeInstanceOf(TenantGuardError);
  });

  test('an empty tenant id is refused up front', () => {
    // biome-ignore lint/suspicious/noExplicitAny: recording stand-in
    expect(() => tenantScope(recordingDb([]) as any, '')).toThrow(TenantGuardError);
  });

  test('schema invariant: every table listed as tenant-scoped has a client_id column', () => {
    for (const table of Object.values(mysqlSchema.schema) as Table[]) {
      if (mysqlSchema.tenantTables.has(getTableName(table))) {
        expect((table as unknown as Record<string, unknown>).client_id).toBeDefined();
      }
    }
    expect(mysqlSchema.tenantTables.has('groups')).toBe(true);
    expect(mysqlSchema.tenantTables.has('users')).toBe(false);
    expect(mysqlSchema.tenantTables.has('sessions')).toBe(false); // client_id there = active tenant, not ownership
  });
});

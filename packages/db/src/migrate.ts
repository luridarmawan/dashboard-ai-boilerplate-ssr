/**
 * Apply the committed migrations for the active dialect (O-1, Q-4).
 *
 * This is the ONLY production path to a schema change. It is an explicit, separate step —
 * never run automatically on container start — so two instances booting together cannot race
 * to migrate (Q-4). Drizzle's migrator takes an advisory lock / journal table itself, but the
 * operational rule stands: one operator, one command, one time.
 *
 * Two callers, one code path: `bun db:migrate` (scripts/migrate.ts, codegen first) and the
 * compiled api binary (`api migrate`, Q-2). The binary ships no `migrations/` folder, so the
 * SQL comes from `generated/migrations.ts` (embedded by codegen) and is materialised into a
 * temp folder for Drizzle — the same place TABLE_PREFIX (O-2) rewrites it.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '@core/config';
import { activeDialect } from './generated/active.ts';
import { family as embeddedFamily, files, journal } from './generated/migrations.ts';
import { collectTableNames, migrationsTableFor, prefixSql } from './migrate-prefix.ts';

export type Family = 'mysql' | 'pg';
export const familyOf = (dialect: string): Family => (dialect === 'postgres' ? 'pg' : 'mysql');

export interface MigrateResult {
  dialect: string;
  family: Family;
  prefix: string;
  /** Migrations applied by this run. */
  applied: number;
  /** Rows in the journal table afterwards. */
  total: number;
  ms: number;
}

/**
 * Write the embedded migrations (rewritten for `prefix` when set) into a fresh temp folder laid
 * out the way Drizzle expects: `<dir>/*.sql` + `<dir>/meta/_journal.json`. Journal hashes are
 * per rewritten content, i.e. per prefix — consistent across runs of the same prefix.
 */
export function materializeMigrations(prefix = ''): string {
  const out = mkdtempSync(join(tmpdir(), `crk-migrations-${prefix || 'core'}-`));
  mkdirSync(join(out, 'meta'), { recursive: true });
  const tables = prefix ? collectTableNames(files.map((f) => f.sql)) : new Set<string>();
  for (const f of files) {
    writeFileSync(join(out, f.name), prefix ? prefixSql(f.sql, prefix, tables) : f.sql);
  }
  writeFileSync(join(out, 'meta', '_journal.json'), journal);
  return out;
}

/** Rows in Drizzle's journal table = migrations applied so far; 0 when the table does not exist yet. */
async function journalCountWith(
  run: (sqlText: string) => Promise<unknown>,
  family: Family,
  migrationsTable: string,
): Promise<number> {
  try {
    const rows = (await run(
      family === 'pg'
        ? `select count(*)::int as n from drizzle."${migrationsTable}"`
        : `select count(*) as n from \`${migrationsTable}\``,
    )) as unknown;
    const first = Array.isArray(rows)
      ? Array.isArray(rows[0])
        ? (rows[0] as Record<string, unknown>[])[0]
        : (rows[0] as Record<string, unknown>)
      : (rows as { rows?: Record<string, unknown>[] }).rows?.[0];
    return Number(first?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface MigrationStatus {
  readonly family: Family;
  /** Migrations embedded in this build. */
  readonly embedded: number;
  /** Rows in the journal table (0 = never migrated). */
  readonly applied: number;
  readonly pending: number;
}

/** Race a driver call against a deadline: a wrong host must fail fast, not hang the preflight. */
async function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: tidak menjawab dalam ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `select 1` over a FRESH connection to `databaseUrl` — for `api preflight` (Q-13), which must probe
 * the URL it was given rather than the process-wide pool. Throws with the driver's message.
 */
export async function probeDatabase(
  databaseUrl: string,
  dialect: string,
  timeoutMs = 5000,
): Promise<void> {
  if (familyOf(dialect) === 'pg') {
    const { createDb } = await import('./dialect/pg-client.ts');
    const db = createDb(databaseUrl);
    try {
      await withDeadline(db.$client.unsafe('select 1'), timeoutMs, 'database');
    } finally {
      await db.$client.end({ timeout: 1 }).catch(() => undefined);
    }
  } else {
    const { createDb } = await import('./dialect/mysql-client.ts');
    const db = createDb(databaseUrl);
    try {
      await withDeadline(db.$client.query('select 1'), timeoutMs, 'database');
    } finally {
      await db.$client.end().catch(() => undefined);
    }
  }
}

/**
 * Compare the embedded migrations with the journal — read-only, for `api preflight` (Q-13). Pass
 * `override` to inspect a database other than the process env's (preflight probes what it is given).
 */
export async function migrationStatus(
  override?: Pick<ReturnType<typeof env>, 'DB_DIALECT' | 'DATABASE_URL' | 'TABLE_PREFIX'>,
): Promise<MigrationStatus> {
  const e = override ?? env();
  const family = familyOf(e.DB_DIALECT);
  const migrationsTable = migrationsTableFor(e.TABLE_PREFIX);
  let applied = 0;
  if (family === 'pg') {
    const { createDb } = await import('./dialect/pg-client.ts');
    const db = createDb(e.DATABASE_URL);
    applied = await journalCountWith((q) => db.$client.unsafe(q), family, migrationsTable);
    await db.$client.end();
  } else {
    const { createDb } = await import('./dialect/mysql-client.ts');
    const db = createDb(e.DATABASE_URL);
    applied = await journalCountWith((q) => db.$client.query(q), family, migrationsTable);
    await db.$client.end();
  }
  return { family, embedded: files.length, applied, pending: Math.max(0, files.length - applied) };
}

export async function runMigrations(): Promise<MigrateResult> {
  const e = env();
  const family = familyOf(e.DB_DIALECT);
  // Widen the generated literal (assignment narrowing would otherwise pin `family` to one dialect).
  const embedded = embeddedFamily as Family;
  if (family !== familyOf(activeDialect) || family !== embedded) {
    throw new Error(
      `db:migrate: skema ter-generate untuk ${activeDialect} (migrasi ${embeddedFamily}), tapi DB_DIALECT=${e.DB_DIALECT}. Jalankan \`bun db:codegen\` dulu (atau build ulang image dengan DB_DIALECT yang benar).`,
    );
  }
  const started = performance.now();
  const prefix = e.TABLE_PREFIX;
  const migrationsTable = migrationsTableFor(prefix);
  const migrationsFolder = materializeMigrations(prefix);

  const journalCount = (run: (sqlText: string) => Promise<unknown>) =>
    journalCountWith(run, family, migrationsTable);

  let before = 0;
  let after = 0;
  if (family === 'pg') {
    const { createDb } = await import('./dialect/pg-client.ts');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const db = createDb(e.DATABASE_URL);
    const raw = (q: string) => db.$client.unsafe(q);
    before = await journalCount(raw);
    await migrate(db, { migrationsFolder, migrationsTable });
    after = await journalCount(raw);
    await db.$client.end();
  } else {
    const { createDb } = await import('./dialect/mysql-client.ts');
    const { migrate } = await import('drizzle-orm/mysql2/migrator');
    const db = createDb(e.DATABASE_URL);
    const raw = (q: string) => db.$client.query(q);
    before = await journalCount(raw);
    await migrate(db, { migrationsFolder, migrationsTable });
    after = await journalCount(raw);
    await db.$client.end();
  }

  return {
    dialect: e.DB_DIALECT,
    family,
    prefix,
    applied: Math.max(0, after - before),
    total: after,
    ms: Math.round(performance.now() - started),
  };
}

/** One-line human summary, shared by the script and the binary. */
export function describeMigrateResult(r: MigrateResult): string {
  return `db:migrate: ${r.dialect} mutakhir — ${r.applied} migrasi diterapkan sekarang, ${r.total} total (migrations/${r.family}${r.prefix ? `, TABLE_PREFIX=${r.prefix}` : ''}, ${r.ms} ms)`;
}

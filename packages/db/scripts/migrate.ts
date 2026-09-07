#!/usr/bin/env bun
/**
 * `bun db:migrate` — apply versioned migrations for the active dialect (O-1, Q-4).
 *
 * This is the ONLY production path to a schema change. It is an explicit, separate step —
 * never run automatically on container start — so two instances booting together cannot
 * race to migrate (Q-4). Drizzle's migrator takes an advisory lock / journal table itself,
 * but the operational rule stands: one operator, one command, one time.
 *
 * Reads DB_DIALECT and DATABASE_URL through the validated env loader; the schema family
 * chosen at codegen time must match the env, otherwise we would migrate with the wrong SQL.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '@core/config';
import { activeDialect } from '../src/generated/active.ts';
import { collectTableNames, migrationsTableFor, prefixSql } from '../src/migrate-prefix.ts';

const e = env();
const family = (d: string): 'mysql' | 'pg' => (d === 'postgres' ? 'pg' : 'mysql');

if (family(e.DB_DIALECT) !== family(activeDialect)) {
  console.error(
    `db:migrate: skema ter-generate untuk ${activeDialect}, tapi DB_DIALECT=${e.DB_DIALECT}. Jalankan \`bun db:codegen\` dulu.`,
  );
  process.exit(1);
}

const committedFolder = join(import.meta.dir, '..', 'migrations', family(e.DB_DIALECT));
const started = performance.now();
const prefix = e.TABLE_PREFIX;
const migrationsTable = migrationsTableFor(prefix);

/**
 * TABLE_PREFIX (O-2): the committed SQL is for an empty prefix. Rewrite every file into a temp
 * folder with prefixed table/constraint/index names and migrate from there. Hashes in the journal
 * table are per rewritten content, i.e. per prefix — consistent across runs of the same prefix.
 */
function prefixedFolder(source: string): string {
  if (!prefix) return source;
  const files = readdirSync(source)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const contents = files.map((f) => readFileSync(join(source, f), 'utf8'));
  const tables = collectTableNames(contents);
  const out = mkdtempSync(join(tmpdir(), `dab-migrations-${prefix}`));
  mkdirSync(join(out, 'meta'), { recursive: true });
  files.forEach((f, i) =>
    writeFileSync(join(out, f), prefixSql(contents[i] ?? '', prefix, tables)),
  );
  writeFileSync(
    join(out, 'meta', '_journal.json'),
    readFileSync(join(source, 'meta', '_journal.json')),
  );
  return out;
}
const migrationsFolder = prefixedFolder(committedFolder);

/** Rows in Drizzle's journal table = migrations applied so far; 0 when the table does not exist yet. */
async function journalCount(run: (sqlText: string) => Promise<unknown>): Promise<number> {
  try {
    const rows = (await run(
      family(e.DB_DIALECT) === 'pg'
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

let before = 0;
let after = 0;
if (family(e.DB_DIALECT) === 'pg') {
  const { createDb } = await import('../src/dialect/pg-client.ts');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const db = createDb(e.DATABASE_URL);
  const raw = (q: string) => db.$client.unsafe(q);
  before = await journalCount(raw);
  await migrate(db, { migrationsFolder, migrationsTable });
  after = await journalCount(raw);
  await db.$client.end();
} else {
  const { createDb } = await import('../src/dialect/mysql-client.ts');
  const { migrate } = await import('drizzle-orm/mysql2/migrator');
  const db = createDb(e.DATABASE_URL);
  const raw = (q: string) => db.$client.query(q);
  before = await journalCount(raw);
  await migrate(db, { migrationsFolder, migrationsTable });
  after = await journalCount(raw);
  await db.$client.end();
}

const applied = Math.max(0, after - before);
console.log(
  `db:migrate: ${e.DB_DIALECT} mutakhir — ${applied} migrasi diterapkan sekarang, ${after} total (${committedFolder.split('/').slice(-2).join('/')}${prefix ? `, TABLE_PREFIX=${prefix}` : ''}, ${Math.round(performance.now() - started)} ms)`,
);

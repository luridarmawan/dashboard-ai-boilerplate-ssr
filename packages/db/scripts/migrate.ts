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
import { join } from 'node:path';
import { env } from '@core/config';
import { activeDialect } from '../src/generated/active.ts';

const e = env();
const family = (d: string): 'mysql' | 'pg' => (d === 'postgres' ? 'pg' : 'mysql');

if (family(e.DB_DIALECT) !== family(activeDialect)) {
  console.error(
    `db:migrate: skema ter-generate untuk ${activeDialect}, tapi DB_DIALECT=${e.DB_DIALECT}. Jalankan \`bun db:codegen\` dulu.`,
  );
  process.exit(1);
}

const migrationsFolder = join(import.meta.dir, '..', 'migrations', family(e.DB_DIALECT));
const started = performance.now();

if (family(e.DB_DIALECT) === 'pg') {
  const { createDb } = await import('../src/dialect/pg-client.ts');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const db = createDb(e.DATABASE_URL);
  await migrate(db, { migrationsFolder });
  await db.$client.end();
} else {
  const { createDb } = await import('../src/dialect/mysql-client.ts');
  const { migrate } = await import('drizzle-orm/mysql2/migrator');
  const db = createDb(e.DATABASE_URL);
  await migrate(db, { migrationsFolder });
  await db.$client.end();
}

console.log(
  `db:migrate: ${e.DB_DIALECT} mutakhir (${migrationsFolder.split('/').slice(-2).join('/')}, ${Math.round(performance.now() - started)} ms)`,
);

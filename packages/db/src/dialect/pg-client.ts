import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../generated/schema.pg.ts';

/**
 * Concrete database type for PostgreSQL. Re-exported as `Db` through `generated/active.ts`.
 * `$client` is the underlying connection pool — for infrastructure scripts (migrate, smoke)
 * to close cleanly; domain code never touches it.
 */
export type Db = PostgresJsDatabase<typeof schema> & { $client: Sql };

/**
 * Creates ONE connection pool + Drizzle instance. Never call this from domain code — use
 * `getDb()` from `@core/db`, which guarantees a single instance (P-6, anti-pattern D3).
 */
export function createDb(url: string): Db {
  const client = postgres(url, {
    max: 10,
    // timestamptz values come back as UTC Dates; presentation converts them (§4.3).
    transform: { undefined: null },
  });
  return drizzle(client, { schema });
}

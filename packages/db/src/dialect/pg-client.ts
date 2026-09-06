import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../generated/schema.pg.ts';

/** Concrete database type for PostgreSQL. Re-exported as `Db` through `generated/active.ts`. */
export type Db = PostgresJsDatabase<typeof schema>;

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

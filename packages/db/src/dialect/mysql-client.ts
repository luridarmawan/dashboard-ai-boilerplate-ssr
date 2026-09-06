import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql, { type Pool } from 'mysql2/promise';
import * as schema from '../generated/schema.mysql.ts';

/**
 * Concrete database type for MySQL/MariaDB. Re-exported as `Db` through `generated/active.ts`.
 * `$client` is the underlying pool — for infrastructure scripts (migrate, smoke) to close
 * cleanly; domain code never touches it.
 */
export type Db = MySql2Database<typeof schema> & { $client: Pool };

/**
 * Creates ONE pool + Drizzle instance. Never call this from domain code — use `getDb()`
 * from `@core/db`, which guarantees a single instance (P-6, anti-pattern D3).
 */
export function createDb(url: string): Db {
  const pool = mysql.createPool({
    uri: url,
    // Always UTC on the wire; time-zone conversion is a presentation concern (§4.3).
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    connectionLimit: 10,
  });
  return drizzle(pool, { schema, mode: 'default' });
}

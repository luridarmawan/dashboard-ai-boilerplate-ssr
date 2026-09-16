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
  /**
   * …and always UTC on the SERVER side of that wire. The option above only decides how the driver
   * converts the values it sends and receives; `created_at`/`updated_at` default to
   * `CURRENT_TIMESTAMP(3)`, which the server evaluates in ITS session zone. On a host that does
   * not run in UTC that writes a local wall clock which the driver then reads back as UTC — every
   * row an hour-offset wrong (seven hours in Asia/Jakarta), invisible in CI because containers run
   * UTC. Pinning every pooled connection keeps "timestamps are always UTC" (§4.3) true anywhere.
   * A numeric offset is used deliberately: named zones need the server's time-zone tables loaded.
   */
  pool.on('connection', (connection) => {
    // The promise wrapper types this argument as its own connection but forwards the CALLBACK-style
    // one, so the cast is the honest description of what actually arrives. The statement is queued
    // on this connection before any caller can use it — mysql2 serialises commands per connection.
    const raw = connection as unknown as {
      query: (sql: string, cb: (err: Error | null) => void) => void;
    };
    raw.query("SET time_zone = '+00:00'", (err) => {
      if (err) {
        console.error(
          `[db] SET time_zone gagal: ${err.message} — stempel waktu baris baru bisa meleset dari UTC`,
        );
      }
    });
  });
  return drizzle(pool, { schema, mode: 'default' });
}

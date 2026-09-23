import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fromProjectRoot } from '@core/config';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../generated/schema.sqlite.ts';

/**
 * Concrete database type for SQLite. Re-exported as `Db` through `generated/active.ts`.
 * `$client` is the underlying handle — for infrastructure scripts (migrate, smoke) to close
 * cleanly; domain code never touches it.
 */
export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

const IN_MEMORY = ':memory:';

/**
 * `DATABASE_URL` → a filesystem path.
 *
 * The value is validated as a URL (E-6), so it always carries a `file:`/`sqlite:` scheme even
 * though SQLite only ever names a file. Parsing it with `new URL()` would be wrong: the WHATWG
 * parser normalises `file:./data/app.db` to `file:///data/app.db`, turning a project-relative
 * path into an absolute one at the filesystem root — silently, because SQLite creates whatever
 * file it is handed. So the scheme is stripped textually and the remainder resolved the same way
 * `UPLOADS_DIR` is: relative to the project root, so every process of one installation means the
 * same file whatever its cwd.
 */
export function sqlitePath(url: string): string {
  const stripped = url.replace(/^(?:file|sqlite):(\/\/)?/i, '').replace(/\?.*$/, '');
  if (stripped === IN_MEMORY || stripped === '') return IN_MEMORY;
  // `file:///C:/app.db` leaves a leading slash in front of a Windows drive letter.
  const path = /^\/[A-Za-z]:/.test(stripped) ? stripped.slice(1) : stripped;
  return fromProjectRoot(decodeURIComponent(path));
}

/**
 * Opens THE database handle + Drizzle instance. Never call this from domain code — use
 * `getDb()` from `@core/db`, which guarantees a single instance (P-6, anti-pattern D3).
 *
 * The PRAGMAs are not tuning, they are correctness. `foreign_keys` is OFF by default in
 * SQLite, which would silently ignore every `onDelete` the descriptors declare — the same
 * class of surprise `SET time_zone` guards against on MySQL. `journal_mode=WAL` lets readers
 * work while one writer commits; without it a single write blocks the whole process, and SSR
 * reads a page per request. `busy_timeout` makes a concurrent writer wait instead of failing
 * with SQLITE_BUSY at once.
 */
export function createDb(url: string): Db {
  const path = sqlitePath(url);
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true });
  client.exec('PRAGMA journal_mode = WAL');
  client.exec('PRAGMA foreign_keys = ON');
  client.exec('PRAGMA busy_timeout = 5000');
  client.exec('PRAGMA synchronous = NORMAL');
  return drizzle(client, { schema });
}

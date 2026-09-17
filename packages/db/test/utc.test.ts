import { describe, expect, test } from 'bun:test';
import {
  activeDialect,
  eq,
  newId,
  type SQL,
  schema,
  sql,
  unsafeAcrossTenants,
} from '../src/index.ts';

/**
 * Integration (INTEGRATION=1): the connection speaks UTC on BOTH sides (§4.3).
 *
 * The driver option `timezone: 'Z'` only covers the values the driver itself converts.
 * `created_at` / `updated_at` default to `CURRENT_TIMESTAMP(3)` / `now()`, which the SERVER
 * evaluates in its own session zone — so on a host that does not run in UTC (the owner's box is
 * Asia/Jakarta) every row would be stored as a local wall clock and read back as UTC, seven hours
 * off. CI containers run UTC, which is exactly why this has to be asserted rather than assumed.
 *
 * The row is written the way the application writes rows: nothing supplies `created_at`, so the
 * value under test is the one the database put there.
 */
const enabled = process.env.INTEGRATION === '1';
/** Widened on purpose: the generated type is the literal of whichever dialect this build targets. */
const dialect: string = activeDialect;

describe.skipIf(!enabled)('database clock is UTC (§4.3)', () => {
  test('a DB-default created_at is the real UTC instant, not a local wall clock', async () => {
    const db = unsafeAcrossTenants();
    const id = newId();
    const key = `utc-probe:${id}`;
    const before = Date.now();
    await db
      .insert(schema.rateLimits)
      .values({ id, key, window_start: new Date(before), count: 1 });
    try {
      const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.id, id));
      if (!row) throw new Error('baris uji tidak ditemukan');
      expect(row.created_at).toBeInstanceOf(Date);
      // A minute of tolerance: this is about a time-zone offset (hours), never about clock drift.
      expect(Math.abs(row.created_at.getTime() - before)).toBeLessThan(60_000);
      // The value the application itself wrote round-trips too — that half was never in doubt,
      // and it is what makes a failure above unambiguously about the server's zone.
      expect(Math.abs(row.window_start.getTime() - before)).toBeLessThan(1_000);
    } finally {
      await db.delete(schema.rateLimits).where(eq(schema.rateLimits.id, id));
    }
  });

  /**
   * The check above only bites on a host that is NOT in UTC — CI containers are, so this one says
   * the same thing in a way that fails there too: the session must be pinned, whatever the host.
   * The cast is because `activeDialect` is a runtime value; it cannot narrow the database type,
   * which is generated per dialect.
   */
  test.skipIf(dialect === 'postgres')('the MySQL session is pinned to UTC', async () => {
    const db = unsafeAcrossTenants() as unknown as {
      execute: (q: SQL) => Promise<unknown>;
    };
    const raw = await db.execute(sql`select @@session.time_zone as tz`);
    const rows = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>[];
    expect(rows[0]?.tz).toBe('+00:00');
  });
});

/**
 * How many rows the last INSERT/UPDATE/DELETE touched — the ONE place that knows how each
 * driver reports it. Drizzle does not normalise this: the value arrives in a different shape
 * per dialect, and the shape is not always what the types say.
 *
 *   mysql2        `[ResultSetHeader, FieldPacket[]]` — a real tuple; the count is `affectedRows`
 *                 on the first element.
 *   postgres.js   a `RowList`, which is an Array SUBCLASS that also carries `count`. Testing
 *                 `Array.isArray` before the named properties would therefore read row 0 and
 *                 report 0, so the named properties are checked first.
 *   bun:sqlite    `{ changes, lastInsertRowid }`. Drizzle types this as `void` (the bun-sqlite
 *                 driver declares no run result), but the object is really there — hence the
 *                 `unknown` parameter rather than a typed one.
 *
 * This is not cosmetic. The scheduler lease (G-18) decides who owns an interval from exactly
 * this number: a driver whose count came back 0 would make every instance skip every job, and
 * nothing would ever run. Rate limiting (A-5) and the tenant guard (B-3) read it too.
 */
export function affectedRows(result: unknown): number {
  if (result === null || result === undefined) return 0;
  const r = result as {
    changes?: number | bigint;
    rowCount?: number;
    count?: number;
    affectedRows?: number;
  };
  if (typeof r.changes === 'number' || typeof r.changes === 'bigint') return Number(r.changes);
  if (typeof r.rowCount === 'number') return r.rowCount;
  if (typeof r.count === 'number') return r.count;
  if (Array.isArray(result)) {
    return Number((result[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  }
  return Number(r.affectedRows ?? 0);
}

#!/usr/bin/env bun
/**
 * `bun db:smoke` — a real round-trip through the query builder against a live database.
 *
 * Written exactly like domain code (only `@core/db`'s public surface, no raw SQL) so that
 * it exercises the same path modules will. It proves, per dialect, the things §4.3 worries
 * about: utf8mb4 survives, JSON round-trips (MariaDB stores it as longtext), datetimes come
 * back as UTC Dates, and UUIDv7 ids sort in insertion order. Cleans up after itself.
 */
import { desc, eq } from 'drizzle-orm';
import { activeDialect, getDb, newId, STATUS, schema } from '../src/index.ts';

const db = getDb();
const failures: string[] = [];
const check = (cond: boolean, what: string) => {
  if (!cond) failures.push(what);
};

const stamp = Date.now();
const code = `smoke_${stamp}`;
const clientId = newId();
const settings = { locale: 'id', nested: { ok: true, n: 3 }, list: [1, 'two'] };

try {
  // --- insert + read back a global table (utf8mb4, JSON, datetime) ---
  await db.insert(schema.clients).values({
    id: clientId,
    code,
    name: 'Smoke ✓ ünïcödé — 日本語 — 🚀',
    settings,
  });

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.code, code));
  check(client !== undefined, 'client not found after insert');
  if (client) {
    check(client.id === clientId, `id mismatch: ${client.id}`);
    check(client.name === 'Smoke ✓ ünïcödé — 日本語 — 🚀', `utf8mb4 mangled: ${client.name}`);
    // Structural comparison on purpose: MySQL 8 (binary json) and PostgreSQL (jsonb) normalize
    // key order, MariaDB (longtext) preserves it — never rely on JSON key order (§4.3).
    check(
      Bun.deepEquals(client.settings, settings),
      `json round-trip mismatch: ${JSON.stringify(client.settings)}`,
    );
    check(client.status_id === STATUS.ACTIVE, `status default: ${client.status_id}`);
    check(client.created_at instanceof Date, `created_at not a Date: ${typeof client.created_at}`);
    if (client.created_at instanceof Date) {
      const skew = Math.abs(client.created_at.getTime() - stamp);
      check(skew < 60_000, `created_at skew ${skew} ms — timezone not UTC?`);
    }
    check(client.deleted_at === null, 'deleted_at should be NULL');
  }

  // --- tenant-scoped table: ids sort in insertion order (UUIDv7) ---
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = newId();
    ids.push(id);
    await db.insert(schema.auditLog).values({
      id,
      client_id: clientId,
      action: 'smoke.run',
      resource: 'smoke',
      resource_id: String(i),
      before: { i },
      after: { i: i + 1 },
    });
  }
  const rows = await db
    .select({ id: schema.auditLog.id, after: schema.auditLog.after })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.client_id, clientId))
    .orderBy(desc(schema.auditLog.id));
  check(rows.length === 5, `expected 5 audit rows, got ${rows.length}`);
  check(
    rows.map((r) => r.id).join() === [...ids].reverse().join(),
    'ORDER BY id does not follow insertion order — UUIDv7 ordering broken on this dialect',
  );
  check(
    Bun.deepEquals(rows[0]?.after, { i: 5 }),
    `json in tenant table mismatch: ${JSON.stringify(rows[0]?.after)}`,
  );
} catch (err) {
  failures.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // Cleanup so the dev database does not accumulate smoke rows.
  try {
    await db.delete(schema.auditLog).where(eq(schema.auditLog.client_id, clientId));
    await db.delete(schema.clients).where(eq(schema.clients.id, clientId));
  } catch (err) {
    failures.push(`cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await db.$client.end();
}

if (failures.length) {
  console.error(
    `db:smoke [${activeDialect}] GAGAL:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`db:smoke [${activeDialect}] OK — utf8mb4, JSON, UTC datetime, urutan UUIDv7`);

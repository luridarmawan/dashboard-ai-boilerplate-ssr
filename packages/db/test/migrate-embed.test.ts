import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { activeDialect } from '../src/generated/active.ts';
import { family, files, journal } from '../src/generated/migrations.ts';
import { type Family, familyOf, materializeMigrations } from '../src/migrate.ts';

// The compiled api binary migrates from SQL embedded by codegen (Q-2, Q-4). If the embedded
// copy ever drifts from packages/db/migrations/, production would apply different DDL than CI.
const active: Family = familyOf(activeDialect);
const embedded = family as Family;
const committed = join(import.meta.dir, '..', 'migrations', active);

describe('embedded migrations (Q-2)', () => {
  test('embedded family follows the active dialect', () => {
    expect(embedded).toBe(active);
  });

  test('embedded files are byte-identical to the committed folder', () => {
    const onDisk = readdirSync(committed)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files.map((f) => f.name)).toEqual(onDisk);
    for (const f of files) {
      expect(f.sql).toBe(readFileSync(join(committed, f.name), 'utf8'));
    }
    expect(journal).toBe(readFileSync(join(committed, 'meta', '_journal.json'), 'utf8'));
    expect(files.length).toBeGreaterThan(0);
  });

  test('materialize without prefix reproduces the Drizzle folder layout', () => {
    const dir = materializeMigrations();
    try {
      expect(existsSync(join(dir, 'meta', '_journal.json'))).toBe(true);
      const names = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(names).toEqual(files.map((f) => f.name));
      const first = files[0];
      if (first) expect(readFileSync(join(dir, first.name), 'utf8')).toBe(first.sql);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('materialize with TABLE_PREFIX rewrites table names (O-2)', () => {
    const dir = materializeMigrations('t9_');
    try {
      const all = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join(dir, f), 'utf8'))
        .join('\n');
      const q = active === 'pg' ? '"' : '`';
      expect(all).toContain(`CREATE TABLE ${q}t9_`);
      expect(all).not.toMatch(new RegExp(`CREATE TABLE ${q}(?!t9_)`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

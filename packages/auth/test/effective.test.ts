import { describe, expect, test } from 'bun:test';
import { effectivePermissions } from '../src/effective.ts';
import { isRegistered } from '../src/registry.ts';
import { SYSTEM_GROUPS } from '../src/seed.ts';

describe('effective permissions (C-3, C-5)', () => {
  test('superadmin is *.* without touching the database', async () => {
    const db = new Proxy(
      {},
      {
        get: () => {
          throw new Error('db touched');
        },
      },
    );
    // biome-ignore lint/suspicious/noExplicitAny: proxy stand-in
    expect(await effectivePermissions(db as any, { id: 'u', is_superadmin: true }, 'c')).toEqual([
      '*.*',
    ]);
  });
  test('no active tenant → no permissions', async () => {
    const db = new Proxy(
      {},
      {
        get: () => {
          throw new Error('db touched');
        },
      },
    );
    // biome-ignore lint/suspicious/noExplicitAny: proxy stand-in
    expect(await effectivePermissions(db as any, { id: 'u', is_superadmin: false }, null)).toEqual(
      [],
    );
  });
  test('seeded system groups only grant wildcards or registered permissions (C-4)', () => {
    for (const g of SYSTEM_GROUPS)
      for (const p of g.permissions) expect(p.includes('*') || isRegistered(p)).toBe(true);
  });
});

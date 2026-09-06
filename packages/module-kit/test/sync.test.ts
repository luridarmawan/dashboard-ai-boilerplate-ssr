import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { satisfiesCore } from '../src/manifest.ts';
import { SyncError, syncModules } from '../src/sync.ts';

const fixtures = join(import.meta.dir, 'fixtures');
const CORE_ICONS = ['menu', 'edit', 'save'];

describe('syncModules — happy path (G-2, G-9, G-11)', () => {
  test('loads modules, orders by dependency, collects tables/permissions/menu', async () => {
    const r = await syncModules({
      root: join(fixtures, 'good'),
      write: false,
      coreIcons: CORE_ICONS,
    });

    // Alpha depends on Beta → Beta first, even though Alpha sorts first alphabetically.
    expect(r.modules.map((m) => m.name)).toEqual(['Beta', 'Alpha']);
    expect(r.modules[1]?.ns).toBe('alpha');
    expect(r.modules[0]?.path).toBe('modules/Beta');

    expect(r.tables.map((t) => t.name)).toEqual(['alpha_items']);
    expect(r.tables[0]?.tenant).toEqual({ nullable: false });

    expect(r.permissions).toEqual([
      {
        resource: 'alpha.item',
        actions: ['read', 'manage'],
        name: { id: 'Item', en: 'Item' },
        module: 'Alpha',
      },
    ]);
    expect(r.menu.map((m) => m.id).sort()).toEqual(['alpha.items', 'beta.home']);
    expect(r.files).toEqual([]); // write: false
  });

  test('module-namespaced icon (`beta.rocket`) is accepted without being a core icon', async () => {
    const r = await syncModules({
      root: join(fixtures, 'good'),
      write: false,
      coreIcons: CORE_ICONS,
    });
    expect(r.menu.find((m) => m.id === 'beta.home')?.icon).toBe('beta.rocket');
  });

  test('engines.core is checked against the host core version', async () => {
    // Fixture core is 1.2.3; Alpha wants ^1.0.0 and Beta >=1.0.0 <2.0.0 — both fine.
    await expect(
      syncModules({ root: join(fixtures, 'good'), write: false, coreIcons: CORE_ICONS }),
    ).resolves.toBeDefined();
    // Pretend core is 2.0.0 → both modules must be rejected, naming the versions.
    await expect(
      syncModules({
        root: join(fixtures, 'good'),
        write: false,
        coreIcons: CORE_ICONS,
        coreVersion: '2.0.0',
      }),
    ).rejects.toThrow(/butuh core \^1\.0\.0, terpasang 2\.0\.0/);
  });
});

describe('syncModules — every violation reported at once, naming the module', () => {
  test('bad fixture: all problems in one SyncError', async () => {
    let err: SyncError | undefined;
    try {
      await syncModules({ root: join(fixtures, 'bad'), write: false, coreIcons: CORE_ICONS });
    } catch (e) {
      err = e as SyncError;
    }
    expect(err).toBeInstanceOf(SyncError);
    const p = err?.problems ?? [];
    const has = (re: RegExp) => expect(p.some((x) => re.test(x))).toBe(true);

    has(/modules\.json: modul "Old" terdaftar dua kali/);
    has(/modul Ghost .*folder tidak ada/);
    has(/modul Old .*butuh core \^2\.0\.0, terpasang 1\.2\.3/);
    has(/Naughty.*tabel "notes" harus diawali "naughty_"/);
    has(/Naughty.*resource izin "user\.read" harus diawali "naughty\."/);
    has(/Naughty.*href menu "naughty\.a" harus di bawah \/m\/naughty/);
    // Nothing valid slipped through.
    expect(p.length).toBeGreaterThanOrEqual(6);
  });

  test('unknown icon is rejected with the L-5 reference', async () => {
    let err: SyncError | undefined;
    try {
      await syncModules({ root: join(fixtures, 'bad'), write: false, coreIcons: CORE_ICONS });
    } catch (e) {
      err = e as SyncError;
    }
    // The bad menu entry fails on href first; make icon the only defect via a coreIcons that
    // lacks it and confirm the message shape from the good fixture instead.
    expect(err).toBeInstanceOf(SyncError);
    let iconErr: SyncError | undefined;
    try {
      await syncModules({ root: join(fixtures, 'good'), write: false, coreIcons: [] }); // 'menu' no longer core
    } catch (e) {
      iconErr = e as SyncError;
    }
    expect(iconErr?.problems.some((x) => /ikon "menu".*\(L-5\)/.test(x))).toBe(true);
  });

  test('missing modules.json fails clearly', async () => {
    await expect(syncModules({ root: join(fixtures, 'nowhere'), write: false })).rejects.toThrow(
      /modules\.json tidak ditemukan/,
    );
  });
});

describe('satisfiesCore — the four range shapes modules use', () => {
  test('exact, >=, ^, ~, *, conjunction', () => {
    expect(satisfiesCore('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesCore('1.2.3', '>=1.0.0')).toBe(true);
    expect(satisfiesCore('0.9.0', '>=1.0.0')).toBe(false);
    expect(satisfiesCore('1.9.9', '^1.2.0')).toBe(true);
    expect(satisfiesCore('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesCore('0.1.5', '^0.1.0')).toBe(true);
    expect(satisfiesCore('0.2.0', '^0.1.0')).toBe(false);
    expect(satisfiesCore('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesCore('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfiesCore('9.9.9', '*')).toBe(true);
    expect(satisfiesCore('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesCore('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfiesCore('garbage', '^1.0.0')).toBe(false);
  });
});

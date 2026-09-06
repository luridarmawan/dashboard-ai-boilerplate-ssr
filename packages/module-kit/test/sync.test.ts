import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { satisfiesCore } from '../src/manifest.ts';
import { emitApiModules, SyncError, svelteShim, syncModules, tsShim } from '../src/sync.ts';

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

  test('collects widgets (G-19) with the module path of their component, and module i18n keys (K-6)', async () => {
    const r = await syncModules({
      root: join(fixtures, 'good'),
      write: false,
      coreIcons: CORE_ICONS,
    });
    expect(r.widgets.map((w) => w.id)).toEqual(['alpha.summary']);
    expect(r.widgets[0]?.path).toBe('modules/Alpha/web/widgets/Summary.svelte');
    expect(r.widgets[0]?.module).toBe('Alpha');
    expect(r.i18nKeys).toBe(2);
    // en is missing one key → a warning, not an error (K-4)
    expect(r.warnings.some((w) => w.includes('i18n/en.json') && w.includes('1 kunci'))).toBe(true);
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
    has(/Naughty.*widget "naughty\.ghost": komponen web\/widgets\/Missing\.svelte tidak ada/);
    has(/Naughty.*id widget "other\.widget" harus diawali "naughty\."/);
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

describe('syncModules — API routes & web pages (extension points 2 & 3)', () => {
  test('api/routes.ts with an Elysia-shaped default export is registered under its namespace', async () => {
    const r = await syncModules({
      root: join(fixtures, 'good'),
      write: false,
      coreIcons: CORE_ICONS,
    });
    expect(r.apiModules).toEqual([{ name: 'Alpha', ns: 'alpha', file: 'api/routes.ts' }]);
  });

  test('a non-Elysia default export is rejected, naming the module', async () => {
    let err: SyncError | undefined;
    try {
      await syncModules({ root: join(fixtures, 'bad'), write: false, coreIcons: CORE_ICONS });
    } catch (e) {
      err = e as SyncError;
    }
    expect(
      err?.problems.some((x) =>
        /Naughty.*api\/routes\.ts harus meng-export default instance Elysia/.test(x),
      ),
    ).toBe(true);
  });

  test('web/routes/** is mirrored to apps/web/src/routes/m/<ns>/** with the right shim kind', async () => {
    const r = await syncModules({
      root: join(fixtures, 'good'),
      write: false,
      coreIcons: CORE_ICONS,
    });
    expect(r.webRoutes).toEqual([
      {
        module: 'Alpha',
        ns: 'alpha',
        from: 'modules/Alpha/web/routes/items/+page.server.ts',
        to: 'apps/web/src/routes/m/alpha/items/+page.server.ts',
        kind: 'ts',
      },
      {
        module: 'Alpha',
        ns: 'alpha',
        from: 'modules/Alpha/web/routes/items/+page.svelte',
        to: 'apps/web/src/routes/m/alpha/items/+page.svelte',
        kind: 'svelte',
      },
    ]);
  });

  test('emitApiModules mounts each module under /v1/m/<ns> with a relative import', () => {
    const out = emitApiModules(
      [{ name: 'Alpha', ns: 'alpha', file: 'api/routes.ts' }],
      [
        {
          name: 'Alpha',
          ns: 'alpha',
          version: '0.1.0',
          source: 'local',
          path: 'modules/Alpha',
          manifest: { name: 'Alpha', version: '0.1.0', engines: { core: '*' }, dependencies: [] },
        },
      ],
      '/repo',
      '/repo/apps/api/src/generated/modules.ts',
    );
    expect(out).toContain("import mod_alpha from '../../../../modules/Alpha/api/routes.ts';");
    expect(out).toContain(".group('/m/alpha', (g) => g.use(mod_alpha))");
    expect(out).toContain('export const mountedModules = ["alpha"] as const;');
  });

  test('shims import the module file relatively and forward props / re-export load', () => {
    const s = svelteShim(
      '/repo/modules/Alpha/web/routes/items/+page.svelte',
      '/repo/apps/web/src/routes/m/alpha/items/+page.svelte',
    );
    expect(s).toContain(
      "import Component from '../../../../../../../modules/Alpha/web/routes/items/+page.svelte';",
    );
    expect(s).toContain('<Component {...props} />');
    const l = svelteShim(
      '/repo/modules/Alpha/web/routes/+layout.svelte',
      '/repo/apps/web/src/routes/m/alpha/+layout.svelte',
    );
    expect(l).toContain('{@render props.children?.()}');
    const ts = tsShim(
      '/repo/modules/Alpha/web/routes/items/+page.server.ts',
      '/repo/apps/web/src/routes/m/alpha/items/+page.server.ts',
    );
    expect(ts).toContain(
      "export * from '../../../../../../../modules/Alpha/web/routes/items/+page.server.ts';",
    );
  });
});

describe('syncModules — hooks & jobs (extension points 9 & 12)', () => {
  test('hooks.ts and jobs.ts are registered with their declared names', async () => {
    const r = await syncModules({
      root: join(fixtures, 'good'),
      write: false,
      coreIcons: CORE_ICONS,
    });
    expect(r.hookModules).toEqual([
      { name: 'Alpha', ns: 'alpha', file: 'hooks.ts', items: ['user.created', 'system.ping'] },
    ]);
    expect(r.jobModules).toEqual([
      { name: 'Alpha', ns: 'alpha', file: 'jobs.ts', items: ['alpha.sweep'] },
    ]);
  });

  test('unknown event, unprefixed job and sub-second interval are all reported', async () => {
    let err: SyncError | undefined;
    try {
      await syncModules({ root: join(fixtures, 'bad'), write: false, coreIcons: CORE_ICONS });
    } catch (e) {
      err = e as SyncError;
    }
    const p = err?.problems ?? [];
    expect(p.some((x) => /Naughty.*event "invoice\.paid" yang tidak dikenal/.test(x))).toBe(true);
    expect(p.some((x) => /Naughty.*job "cleanup" harus diawali "naughty\."/.test(x))).toBe(true);
    expect(p.some((x) => /Naughty.*job "naughty\.fast".*≥ 1 detik/.test(x))).toBe(true);
  });

  test('emitApiModules exports moduleHooks and moduleJobs from the module files', () => {
    const mods = [
      {
        name: 'Alpha',
        ns: 'alpha',
        version: '0.1.0',
        source: 'local' as const,
        path: 'modules/Alpha',
        manifest: { name: 'Alpha', version: '0.1.0', engines: { core: '*' }, dependencies: [] },
      },
    ];
    const out = emitApiModules(
      [],
      mods,
      '/repo',
      '/repo/apps/api/src/generated/modules.ts',
      [{ name: 'Alpha', ns: 'alpha', file: 'hooks.ts', items: ['system.ping'] }],
      [{ name: 'Alpha', ns: 'alpha', file: 'jobs.ts', items: ['alpha.sweep'] }],
    );
    expect(out).toContain("import hooks_alpha from '../../../../modules/Alpha/hooks.ts';");
    expect(out).toContain("import jobs_alpha from '../../../../modules/Alpha/jobs.ts';");
    expect(out).toContain('export const moduleHooks = [hooks_alpha];');
    expect(out).toContain("{ module: 'Alpha', jobs: jobs_alpha },");
  });
});

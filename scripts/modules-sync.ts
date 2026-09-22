#!/usr/bin/env bun
/**
 * `bun modules:sync` — assemble installed modules into the generated registries (G-2).
 *
 * Runs automatically before `dev`, `build`, `check` and `test`. Adding a module means
 * editing modules.json and running this — no core file changes (G-6).
 */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncError, syncModules } from '@core/module-kit/sync';

const root = fileURLToPath(new URL('..', import.meta.url));

// A module's files import `@core/db`, and that package binds to `src/generated/active.ts`, which
// only `db:codegen` writes. On a clone that has never run migrate/bootstrap (the first thing a
// host does after `bun install` may well be `modules:add`, which ends in this sync), every module
// then fails to load with "Cannot find module './generated/active.ts'". Run codegen once here in
// that case — the same step `bootstrap` and `db:migrate` run first — instead of failing.
if (!existsSync(join(root, 'packages', 'db', 'src', 'generated', 'active.ts'))) {
  console.log('modules:sync: registri db belum di-generate — menjalankan db:codegen dulu');
  const p = Bun.spawnSync(['bun', 'run', 'scripts/codegen.ts'], {
    cwd: join(root, 'packages', 'db'),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (p.exitCode !== 0) {
    console.error('modules:sync: db:codegen gagal — tidak bisa memuat modul tanpa registri');
    process.exit(p.exitCode ?? 1);
  }
}

// Module routes import `@core/settings`, which imports `publicWebRoutes`/`webRoutes` from
// `src/generated/routes.ts` — written only by `layout:variants`. That file is gitignored, so a
// fresh clone lacks it and an older checkout keeps a stale copy a `git pull` never refreshes
// (e.g. one predating `publicWebRoutes`); either way every module fails to load. Unlike the
// check above, run it unconditionally: it only walks page files, so it is cheap, and "exists"
// does not mean "current". Module pages are not shimmed yet, so this list is partial —
// `bootstrap` runs `layout:variants` again after the sync for the full one.
{
  const p = Bun.spawnSync(['bun', 'run', 'scripts/layout-variants.ts'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (p.exitCode !== 0) {
    console.error(
      'modules:sync: layout:variants gagal — tidak bisa memuat modul tanpa daftar route',
    );
    process.exit(p.exitCode ?? 1);
  }
}

try {
  const result = await syncModules({ root });
  const names = result.modules.map((m) => `${m.name}@${m.version}`).join(', ') || '(tidak ada)';
  console.log(
    `modules:sync: ${result.modules.length} modul [${names}] → ${result.tables.length} tabel, ${result.permissions.length} izin, ${result.menu.length} menu`,
  );
  for (const f of result.files) console.log(`  ↳ ${relative(root, f)}`);
  for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
} catch (err) {
  if (err instanceof SyncError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

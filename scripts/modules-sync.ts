#!/usr/bin/env bun
/**
 * `bun modules:sync` — assemble installed modules into the generated registries (G-2).
 *
 * Runs automatically before `dev`, `build`, `check` and `test`. Adding a module means
 * editing modules.json and running this — no core file changes (G-6).
 */
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncError, syncModules } from '@core/module-kit/sync';

const root = fileURLToPath(new URL('..', import.meta.url));

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

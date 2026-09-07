#!/usr/bin/env bun
/**
 * `bun run theme:validate` — validates EVERY theme (core + module, extension point 14) with
 * packages/ui-theme/validate.mjs, telling it which module layouts and icon sets exist so a
 * module theme may reference them (extension points 15, 16). Then the icon-coverage and
 * layout-contract guards. Runs after modules:sync (bootstrap) in CI.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleIconSets, moduleLayouts } from '@core/ui-theme/generated';

const root = fileURLToPath(new URL('../..', import.meta.url));
const themeDirs: string[] = [];
const modulesDir = join(root, 'modules');
if (existsSync(modulesDir)) {
  for (const m of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const d = join(modulesDir, m.name, 'themes');
    if (existsSync(d)) themeDirs.push(d);
  }
}
const args = ['node', join(root, 'packages/ui-theme/validate.mjs')];
for (const d of themeDirs) args.push('--themes-from', d);
const run = (cmd: string[], env: Record<string, string> = {}) =>
  Bun.spawnSync(cmd, {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  }).exitCode;

let code = run(args, {
  THEME_EXTRA_LAYOUTS: JSON.stringify(moduleLayouts),
  THEME_EXTRA_ICON_SETS: JSON.stringify((moduleIconSets as { id: string }[]).map((s) => s.id)),
});
code ||= run(['bun', 'run', join(root, 'scripts/ci/icon-coverage.ts')]);
code ||= run(['bun', 'run', join(root, 'scripts/ci/layout-contract.ts')]);
process.exit(code);

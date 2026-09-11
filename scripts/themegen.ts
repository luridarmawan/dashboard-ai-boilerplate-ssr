#!/usr/bin/env bun
/**
 * `bun themegen <id> [--from base] [--module Billing] [--name "Senja"] [--icons outline-24] …`
 *
 * Theme generator (PRD P-11). Derives a new theme from one that already passes the contract, then
 * REGISTERS it — which is the part a `cp -r` cannot do: a core theme needs its manifest imported in
 * `packages/ui-theme/src/registry.ts` and its tokens imported in `apps/web/src/app.css`, or it is
 * invisible at runtime and unstyled in the bundle. A module theme needs neither: `modules:sync`
 * collects it (extension point 14), and no core file is touched.
 *
 * Whatever it writes must pass the same gate a hand-written theme does, so the last thing it does
 * is run `theme:validate` (L-5, L-8, L-21) and fail loudly if the result does not hold up.
 *
 * Flags:
 *   --from <id>          core theme to derive from (default: base)
 *   --module <Name>      write it into modules/<Name>/themes/<id> as `<ns>.<id>` (extension point 14)
 *   --name  <s>          display name (Indonesian); --name-en for English
 *   --description <s>    description; --description-en for English
 *   --icons <id>         registered icon set (default: the source theme's)
 *   --layout-dashboard <id> / --layout-public <id> / --layout-auth <id>
 *                        override the `default` layout for that shell kind
 *   --dir <path>         target directory (default: derived from --module)
 *   --no-register        write files only: no registry/app.css edit, no sync, no validate
 *   --dry-run            print what would be written and changed, write nothing
 *   --force              overwrite an existing theme folder
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addAppCssImport,
  addRegistryImport,
  makeSpec,
  renderManifest,
  renderTokens,
  type ShellKind,
  type ThemeSpec,
} from './themegen/plan.ts';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set([
  'from',
  'module',
  'name',
  'name-en',
  'description',
  'description-en',
  'icons',
  'layout-dashboard',
  'layout-public',
  'layout-auth',
  'dir',
]);
const flag = (k: string) => args.includes(`--${k}`);
const opt = (k: string): string | undefined => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined;
};

function usage(msg?: string): never {
  if (msg) console.error(`themegen: ${msg}\n`);
  console.error(
    'Pemakaian: bun themegen <id> [--from base] [--module Nama] [--name "Senja"] [--icons outline-24]\n' +
      '           [--layout-dashboard sidebar-classic] [--layout-public marketing-wide] [--layout-auth centered-card]\n' +
      '           [--dir path] [--no-register] [--dry-run] [--force]',
  );
  process.exit(1);
}

function positional(): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a.slice(2))) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

const CORE_THEMES = join(root, 'packages/ui-theme/themes');
const REGISTRY = join(root, 'packages/ui-theme/src/registry.ts');
const APP_CSS = join(root, 'apps/web/src/app.css');

interface Manifest {
  icons: string;
  layouts: Record<ShellKind, Record<string, string>>;
}

/** Icon sets and layouts are a closed registry (L-5, L-8): say so before writing, not after. */
function assertRegistered(spec: ThemeSpec): void {
  const icons = JSON.parse(
    readFileSync(join(root, 'packages/ui-theme/icons/registry.json'), 'utf8'),
  ) as { sets: Record<string, unknown> };
  const layouts = JSON.parse(
    readFileSync(join(root, 'packages/ui-theme/layouts/registry.json'), 'utf8'),
  ) as { layouts: { id: string; kind: ShellKind }[] };
  // A dotted id belongs to a module; only `modules:sync` can see those, so let it do the checking.
  if (!spec.icons.includes('.') && !(spec.icons in icons.sets))
    usage(
      `set ikon "${spec.icons}" tidak terdaftar — pilih: ${Object.keys(icons.sets).join(', ')}`,
    );
  for (const kind of ['dashboard', 'public', 'auth'] as const) {
    for (const [variant, id] of Object.entries(spec.layouts[kind])) {
      if (id.includes('.')) continue;
      const found = layouts.layouts.find((l) => l.id === id);
      if (!found) usage(`layout "${id}" (${kind}.${variant}) tidak terdaftar`);
      else if (found.kind !== kind) usage(`layout "${id}" berjenis ${found.kind}, bukan ${kind}`);
    }
  }
}

function run(cmd: string[], label: string): void {
  console.log(`→ ${label}`);
  const p = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) {
    console.error(`themegen: "${cmd.join(' ')}" gagal (exit ${p.exitCode})`);
    process.exit(p.exitCode ?? 1);
  }
}

if (import.meta.main) {
  const id = positional();
  if (!id) usage('id tema wajib (huruf kecil, mis. "senja")');
  const from = opt('from') ?? 'base';
  const sourceDir = join(CORE_THEMES, from);
  if (!existsSync(join(sourceDir, 'theme.json')))
    usage(`tema sumber "${from}" tidak ada di packages/ui-theme/themes`);
  const source = JSON.parse(readFileSync(join(sourceDir, 'theme.json'), 'utf8')) as Manifest;

  const layouts: Partial<Record<ShellKind, Record<string, string>>> = {};
  for (const kind of ['dashboard', 'public', 'auth'] as const) {
    const override = opt(`layout-${kind}`);
    if (override) layouts[kind] = { default: override };
  }

  let spec: ThemeSpec;
  try {
    spec = makeSpec(
      {
        id,
        from,
        module: opt('module') ?? null,
        name: opt('name') ?? '',
        nameEn: opt('name-en') ?? '',
        description: opt('description') ?? '',
        descriptionEn: opt('description-en') ?? '',
        icons: opt('icons') || source.icons,
        layouts,
      },
      source.layouts,
    );
  } catch (err) {
    usage((err as Error).message);
  }
  assertRegistered(spec);

  const dir = join(
    root,
    opt('dir') ??
      (spec.module
        ? `modules/${spec.module}/themes/${spec.id}`
        : `packages/ui-theme/themes/${spec.id}`),
  );
  const dry = flag('dry-run');
  if (existsSync(dir) && !dry) {
    if (!flag('force')) usage(`${relative(root, dir)} sudah ada — pakai --force untuk menimpa`);
    rmSync(dir, { recursive: true, force: true });
  }

  const files: Record<string, string> = {
    'theme.json': renderManifest(spec),
    'tokens.css': renderTokens(readFileSync(join(sourceDir, 'tokens.css'), 'utf8'), spec),
  };
  console.log(
    `themegen: tema ${spec.fullId} (dari ${spec.from}, ikon ${spec.icons}${spec.module ? `, modul ${spec.module}` : ''})`,
  );
  for (const [rel, content] of Object.entries(files)) {
    console.log(`  ${dry ? '·' : '+'} ${relative(root, join(dir, rel))}`);
    if (dry) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, rel), content);
  }

  if (flag('no-register')) process.exit(0);

  if (spec.module) {
    // Extension point 14: sync discovers, validates and bundles it — no core file changes.
    console.log(`  ${dry ? '·' : '~'} modules:sync (tema modul, tanpa menyentuh core)`);
    if (!dry) run(['bun', 'run', 'modules:sync'], 'modules:sync');
  } else {
    for (const [file, patch] of [
      [REGISTRY, addRegistryImport],
      [APP_CSS, addAppCssImport],
    ] as const) {
      const before = readFileSync(file, 'utf8');
      const after = patch(before, spec);
      const changed = after !== before;
      console.log(`  ${dry ? '·' : changed ? '~' : '='} ${relative(root, file)}`);
      if (!dry && changed) writeFileSync(file, after);
    }
  }
  if (dry) process.exit(0);
  run(['bun', 'run', 'theme:validate'], 'theme:validate (kontras AA, ikon & layout terdaftar)');

  console.log(`
Selesai. Berikutnya:
  1. sunting ${relative(root, join(dir, 'tokens.css'))} — warnanya masih salinan ${spec.from}
  2. bun run theme:validate                 # wajib hijau: kontras AA terang & gelap
  3. bun dev → /theme                       # tema "${spec.fullId}" sudah ada di pemilih
${spec.module ? '' : '  4. tambahkan ke Pengaturan → Aplikasi (app.allowed_themes) bila memakai allowlist\n'}Dokumentasi: docs/THEMES.md §5`);
}

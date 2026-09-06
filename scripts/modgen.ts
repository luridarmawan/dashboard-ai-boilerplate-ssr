#!/usr/bin/env bun
/**
 * `bun modgen <Name> [--resource item] [--fields "name:string!,qty:number"] [--public]`
 *
 * Module generator (PRD G-4). Produces a COMPLETE, working module under modules/<Name> — tables,
 * permissions, menu, configuration, i18n, API with shared schemas, list/new/edit pages, a
 * dashboard widget, an event hook, a scheduled job, an idempotent seed and an integration test —
 * then registers it in modules.json, links the workspace, runs `modules:sync` and `db:generate`.
 *
 * Nothing in core changes (G-6): the only files touched are modules/<Name>/**, modules.json,
 * bun.lock (workspace link), the generated registries and packages/db/migrations/**. CI proves
 * that with scripts/ci/modgen-guard.sh.
 *
 * Interactive when a TTY is attached and --fields is missing; fully non-interactive otherwise.
 *
 * Flags:
 *   --resource <name>   singular resource (default: the namespace)
 *   --fields  <spec>    `name:string!,price:number,active:boolean,notes:text,kind:select(a|b)`
 *                       trailing `!` = required; types: string text number boolean date select
 *   --public            also generate a public page at /<ns> (extension point 13)
 *   --description <s>   module description (both locales)
 *   --dir <path>        target directory (default modules/<Name>)
 *   --no-register       write files only (no modules.json / install / sync / db:generate)
 *   --dry-run           print the file list, write nothing
 *   --force             overwrite an existing directory
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { type ModuleSpec, makeSpec } from './modgen/spec.ts';
import { renderModule } from './modgen/templates.ts';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(`--${k}`);
const opt = (k: string): string | undefined => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined;
};

function usage(msg?: string): never {
  if (msg) console.error(`modgen: ${msg}\n`);
  console.error(
    'Pemakaian: bun modgen <Name> [--resource item] [--fields "name:string!,qty:number"] [--public] [--dir modules/Name] [--no-register] [--dry-run] [--force]',
  );
  process.exit(1);
}

async function ask(q: string, def: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim();
    return a || def;
  } finally {
    rl.close();
  }
}

export async function resolveSpec(): Promise<ModuleSpec> {
  let name = args.find(
    (a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true,
  );
  // positional after a value-taking flag is that flag's value — re-scan properly
  const valueFlags = new Set(['resource', 'fields', 'description', 'dir']);
  name = undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a.startsWith('--')) {
      if (valueFlags.has(a.slice(2))) i++;
      continue;
    }
    name = a;
    break;
  }
  const interactive = process.stdin.isTTY && !flag('no-interactive');
  if (!name) {
    if (!interactive) usage('nama modul wajib (PascalCase)');
    name = await ask('Nama modul (PascalCase)', '');
  }
  let fields = opt('fields');
  let resource = opt('resource');
  let withPublic = flag('public');
  if (!fields) {
    if (!interactive) usage('--fields wajib dalam mode non-interaktif');
    resource =
      resource ?? (await ask('Nama resource (tunggal, snake_case)', (name ?? '').toLowerCase()));
    fields = await ask('Field (nama:tipe[!], koma)', 'name:string!,notes:text,active:boolean');
    withPublic = withPublic || /^y/i.test(await ask('Buat halaman publik /<ns>? (y/N)', 'N'));
  }
  return makeSpec({
    name: name ?? '',
    fields,
    ...(resource ? { resource } : {}),
    withPublic,
    ...(opt('description') ? { description: opt('description') ?? '' } : {}),
  });
}

function run(cmd: string[], label: string): void {
  console.log(`→ ${label}`);
  const p = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) {
    console.error(`modgen: "${cmd.join(' ')}" gagal (exit ${p.exitCode})`);
    process.exit(p.exitCode ?? 1);
  }
}

function register(spec: ModuleSpec, dir: string): boolean {
  const file = join(root, 'modules.json');
  const json = JSON.parse(readFileSync(file, 'utf8')) as {
    modules: { name: string; source: string; path: string }[];
  };
  if (json.modules.some((m) => m.name === spec.name)) return false;
  json.modules.push({ name: spec.name, source: 'local', path: relative(root, dir) });
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return true;
}

if (import.meta.main) {
  let spec: ModuleSpec;
  try {
    spec = await resolveSpec();
  } catch (err) {
    usage((err as Error).message);
  }
  const dir = join(root, opt('dir') ?? `modules/${spec.name}`);
  const files = renderModule(spec);
  const dry = flag('dry-run');

  if (existsSync(dir) && !dry) {
    if (!flag('force')) usage(`${relative(root, dir)} sudah ada — pakai --force untuk menimpa`);
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `modgen: modul ${spec.name} (ns "${spec.ns}", resource "${spec.resource}" → /m/${spec.ns}/${spec.plural})`,
  );
  for (const [rel, content] of Object.entries(files)) {
    console.log(`  ${dry ? '·' : '+'} ${relative(root, join(dir, rel))}`);
    if (dry) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  if (dry || flag('no-register')) process.exit(0);

  const added = register(spec, dir);
  console.log(added ? '→ terdaftar di modules.json' : '→ sudah ada di modules.json');
  run(['bun', 'install', '--no-summary'], 'bun install (tautkan workspace)');
  run(['bun', 'run', 'modules:sync'], 'modules:sync');
  run(['bunx', 'biome', 'check', '--write', relative(root, dir)], 'biome check --write');
  run(['bun', 'run', 'db:generate'], 'db:generate (migrasi untuk tabel baru)');
  console.log(`
Selesai. Berikutnya:
  bun run --cwd packages/db migrate     # terapkan migrasi (atau: bun run db:migrate:docker)
  bun run db:seed                       # izin, menu, dan baris contoh (${spec.ns})
  bun dev                               # /m/${spec.ns}/${spec.plural} muncul di menu
  INTEGRATION=1 bun test ${relative(root, dir)}/test   # tes CRUD modul
Dokumentasi: docs/FIRST-MODULE.md`);
}

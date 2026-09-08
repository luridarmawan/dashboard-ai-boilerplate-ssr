#!/usr/bin/env bun
/**
 * `bun modules:add <git-url> --ref <tag|commit> [--name <Name>] [--path modules/<Name>]`
 *
 * Installs a module that lives in another repository as a git submodule (PRD §4.9,
 * Decision L; G-10), pins it to `ref`, records the source in modules.json, and runs
 * `modules:sync`. The ref is mandatory and must be a tag or commit — never a branch —
 * so a build is reproducible from modules.json alone (Q-5).
 *
 * Nothing in core changes: the only files touched are modules.json, .gitmodules and the
 * new modules/<Name> directory (G-6).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_NAME_RE, modulesFileSchema } from '@core/module-kit';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

function usage(msg?: string): never {
  if (msg) console.error(`modules:add: ${msg}\n`);
  console.error(
    'Pemakaian: bun modules:add <git-url> --ref <tag|commit> [--name <Name>] [--path modules/<Name>]',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (k: string): string | undefined => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const ref = opt('ref');
let name = opt('name');

if (!url) usage('git-url wajib');
if (!ref) usage('--ref wajib dan harus tag atau commit, bukan branch (Keputusan L)');

const sh = (cmd: string[], cwd = root): string => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) {
    throw new Error(
      `${cmd.join(' ')}\n${p.stderr.toString().trim() || p.stdout.toString().trim()}`,
    );
  }
  return p.stdout.toString().trim();
};

// file:// transport is blocked by default since git 2.38.1; allow it only for local URLs.
const gitBase =
  url.startsWith('file://') || url.startsWith('/')
    ? ['git', '-c', 'protocol.file.allow=always']
    : ['git'];

// ---- 1. discover the module name when not given: read module.json from a throwaway clone ----
if (!name) {
  const tmp = join(root, '.tmp-modules-add');
  sh(['rm', '-rf', tmp]);
  sh([...gitBase, 'clone', '--quiet', '--depth', '1', '--branch', ref, url, tmp]);
  const manifestPath = join(tmp, 'module.json');
  if (!existsSync(manifestPath)) {
    sh(['rm', '-rf', tmp]);
    usage(`repo tidak punya module.json di root pada ref ${ref}`);
  }
  name = String(JSON.parse(readFileSync(manifestPath, 'utf8')).name ?? '');
  sh(['rm', '-rf', tmp]);
}
if (!MODULE_NAME_RE.test(name)) usage(`nama modul "${name}" tidak valid`);

const path = opt('path') ?? `modules/${name}`;
const absPath = join(root, path);

// ---- 2. guard against duplicates ----
const modulesFile = join(root, 'modules.json');
const parsed = modulesFileSchema.parse(JSON.parse(readFileSync(modulesFile, 'utf8')));
if (parsed.modules.some((m) => m.name === name))
  usage(`modul "${name}" sudah terdaftar di modules.json`);
if (existsSync(absPath)) usage(`${path} sudah ada`);

// ---- 3. add the submodule and pin it ----
console.log(`modules:add: menambahkan submodule ${url} → ${path}`);
sh([...gitBase, 'submodule', 'add', '--quiet', '--', url, path]);
sh(['git', 'checkout', '--quiet', '--detach', ref], absPath);
const commit = sh(['git', 'rev-parse', 'HEAD'], absPath);

// ---- 4. record the source ----
const entry = { name, source: 'submodule' as const, repo: url, ref, path };
const raw = JSON.parse(readFileSync(modulesFile, 'utf8')) as { modules: unknown[] };
raw.modules.push(entry);
writeFileSync(modulesFile, `${JSON.stringify(raw, null, 2)}\n`);
console.log(`modules:add: modules.json += ${JSON.stringify(entry)}`);
console.log(`modules:add: ${name} terkunci pada ${ref} (${commit.slice(0, 12)})`);

// ---- 5. keep the host's formatter/linter out of code that is owned by another repository ----
// External modules are linted and formatted in their own repo (§4.9 point 2); the host only
// checks its own code and its local modules. Biome has no per-directory config, so exclude.
const biomePath = join(root, 'biome.json');
if (existsSync(biomePath)) {
  const biome = JSON.parse(readFileSync(biomePath, 'utf8')) as { files?: { includes?: string[] } };
  const pattern = `!${path}/**`;
  biome.files ??= {};
  biome.files.includes ??= ['**'];
  if (!biome.files.includes.includes(pattern)) {
    biome.files.includes.push(pattern);
    writeFileSync(biomePath, `${JSON.stringify(biome, null, 2)}\n`);
    sh(['bunx', 'biome', 'format', '--write', 'biome.json']);
    console.log(`modules:add: biome.json: ${pattern} (modul eksternal di-lint di reponya sendiri)`);
  }
}

// ---- 6. link the module's dependencies BEFORE sync — sync imports the module's files ----
const install = Bun.spawnSync(['bun', 'install'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
if (install.exitCode !== 0) {
  console.error(`modules:add: bun install gagal\n${install.stderr.toString()}`);
  process.exit(1);
}
console.log('modules:add: bun install selesai');

// ---- 7. sync ----
const sync = Bun.spawnSync(['bun', 'run', 'modules:sync'], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (sync.exitCode !== 0) {
  console.error(
    `modules:add: sync gagal — modul terpasang tapi belum dirakit. Perbaiki lalu \`bun modules:sync\`, atau batalkan dengan:\n  git submodule deinit -f ${path} && git rm -f ${path} && git checkout -- modules.json`,
  );
  process.exit(1);
}

console.log(`
Selesai. Langkah berikutnya:
  bun db:generate      # bila modul membawa tabel
  bun db:migrate
  git add modules.json .gitmodules biome.json ${relative(root, absPath)}
`);

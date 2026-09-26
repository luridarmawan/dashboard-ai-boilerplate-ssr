#!/usr/bin/env bun
/**
 * `bun modules:add <git-url> --ref <tag|commit> [--name <Name>] [--path modules/<Name>]`
 *
 * Installs a module that lives in another repository as a git submodule (PRD §4.9,
 * Decision L; G-10), pins it to `ref`, records the source in modules.json, and runs
 * `modules:sync`. The ref is mandatory and must be a tag or commit — never a branch —
 * so a build is reproducible from modules.json alone (Q-5).
 *
 * No core source changes: the only files touched are modules.json, .gitmodules, biome.json
 * (the exclusion that keeps foreign code out of the host's lint), bun.lock and the new
 * modules/<Name> directory (G-6) — the same list scripts/ci/cross-repo-proof.sh enforces.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_NAME_RE, modulesFileSchema } from '@core/module-kit';
import { removeDir } from './lib/remove-dir.ts';

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

// ---- 0. every refusal that can be decided here, before the first network call ----
const modulesFile = join(root, 'modules.json');
const installed = modulesFileSchema.parse(JSON.parse(readFileSync(modulesFile, 'utf8')));

/**
 * Refuse on the name alone: wrong casing, already installed, or a directory already in the way.
 *
 * A caller who passed `--name` gets this verdict before anything is asked of the remote. Asking
 * a remote about a module the host already has is a slow way to say no, and when the remote is
 * unreachable it says the wrong thing entirely — "tidak bisa membaca ref" about a name that was
 * never going to be accepted. Without `--name` there is nothing to check yet: the name lives in
 * the module's own manifest, which is why the clone below has to happen first.
 */
function refuseByName(candidate: string): void {
  if (!MODULE_NAME_RE.test(candidate)) usage(`nama modul "${candidate}" tidak valid`);
  if (installed.modules.some((m) => m.name === candidate))
    usage(`modul "${candidate}" sudah terdaftar di modules.json`);
  const candidatePath = opt('path') ?? `modules/${candidate}`;
  if (existsSync(join(root, candidatePath))) usage(`${candidatePath} sudah ada`);
}
if (name) refuseByName(name);

// ---- 1. the ref must name a tag or a commit, never a branch (Decision L, Q-5) ----
// Until here this was only a sentence in the docs: the pin below is `git checkout --detach`,
// which accepts a branch name just as happily as a tag and records it in modules.json — where
// it silently stops describing one build, because the branch moves on. The remote itself is
// the only authority on what a name is, so ask it. A name that is a branch there is rejected
// even when a tag of the same name also exists: ambiguous is not pinned.
let heads = '';
try {
  heads = sh([...gitBase, 'ls-remote', '--heads', '--', url, ref]);
} catch (err) {
  console.error(
    `modules:add: tidak bisa membaca ref dari ${url} — periksa URL dan akses baca\n${err}`,
  );
  process.exit(1);
}
if (heads) {
  usage(
    `--ref ${ref} adalah nama branch di ${url}, bukan tag atau commit (Keputusan L).\n` +
      '  Branch berpindah, sehingga modules.json berhenti menggambarkan satu build tertentu.\n' +
      `  Pakai tag (mis. --ref v1.4.2) atau commit: git ls-remote --tags ${url}`,
  );
}

// ---- 2. discover the module name when not given: read module.json from a throwaway clone ----
// The clone goes to the system temp dir, not into the repo: this runs before anything is
// installed, so a checkout the host could not delete afterwards must not be left in its tree.
if (!name) {
  const tmp = mkdtempSync(join(tmpdir(), 'modules-add-'));
  let failure = '';
  try {
    sh([...gitBase, 'clone', '--quiet', '--depth', '1', '--branch', ref, url, tmp]);
    const manifestPath = join(tmp, 'module.json');
    if (existsSync(manifestPath)) {
      name = String(JSON.parse(readFileSync(manifestPath, 'utf8')).name ?? '');
    } else {
      failure = `repo tidak punya module.json di root pada ref ${ref}`;
    }
  } catch (err) {
    failure = `tidak bisa meng-clone ${url} pada ref ${ref} — pastikan ref itu tag atau commit yang ada di remote, dan Anda punya akses baca\n${err}`;
  } finally {
    // Cleaning up must not become the error the user sees: the clone is outside the repo.
    try {
      removeDir(tmp);
    } catch (err) {
      console.warn(`modules:add: sisa klon sementara di ${tmp} tidak bisa dihapus — ${err}`);
    }
  }
  if (failure) usage(failure);
}
// The same refusals again, now for the name the clone reported. Cheap, and it keeps one place
// that decides what an acceptable name is.
refuseByName(name);

const path = opt('path') ?? `modules/${name}`;
const absPath = join(root, path);

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

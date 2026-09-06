#!/usr/bin/env bun
/**
 * Standalone module harness (PRD §4.9 point 2, G-12): build, lint, typecheck and test THIS module
 * in its own repository, without a hand-made core checkout.
 *
 *   bun run harness                 # clone core (package.json → "core": { repo, ref }) into .core/
 *   CORE_DIR=../core bun run harness  # or reuse an existing core checkout (the dev loop: `bun dev` there)
 *   DATABASE_URL=mysql://… bun run harness   # + migrations and the module's integration tests
 *   bun run harness --web           # + svelte-check of the module's pages
 *
 * What it does: copies this folder into <core>/modules/<Name>, registers it in modules.json when
 * missing, `bun install`, `bun run bootstrap` (codegen + modules:sync), `tsc`, `biome check`, `db:generate`, tests. Nothing
 * else in the core checkout is modified — that is the whole point of the module contract (G-6).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const here = resolve(import.meta.dir);
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as {
  core?: { repo?: string; ref?: string };
};
const manifest = JSON.parse(readFileSync(join(here, 'module.json'), 'utf8')) as { name: string };
const NAME = manifest.name;
const args = new Set(process.argv.slice(2));

const CORE_REPO = process.env.CORE_REPO ?? pkg.core?.repo ?? '';
const CORE_REF = process.env.CORE_REF ?? pkg.core?.ref ?? 'main';
const coreDir = resolve(process.env.CORE_DIR ?? join(here, '.core'));

function sh(cmd: string[], cwd: string, env: Record<string, string> = {}): void {
  console.log(`\n$ ${cmd.join(' ')}   (in ${cwd})`);
  const p = Bun.spawnSync(cmd, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...env },
  });
  if (p.exitCode !== 0) {
    console.error(`harness: "${cmd.join(' ')}" gagal (exit ${p.exitCode})`);
    process.exit(p.exitCode ?? 1);
  }
}

// ---- 1. a core checkout ----
if (!existsSync(join(coreDir, 'modules.json'))) {
  if (process.env.CORE_DIR) {
    console.error(`harness: CORE_DIR=${coreDir} bukan checkout core (tidak ada modules.json)`);
    process.exit(1);
  }
  if (!CORE_REPO) {
    console.error('harness: isi "core": { "repo", "ref" } di package.json atau CORE_REPO/CORE_REF');
    process.exit(1);
  }
  const local = CORE_REPO.startsWith('file://') || CORE_REPO.startsWith('/');
  const git = local ? ['git', '-c', 'protocol.file.allow=always'] : ['git'];
  console.log(`harness: clone core ${CORE_REPO}@${CORE_REF} → ${coreDir}`);
  // A ref may be a branch, tag or commit: clone then checkout so all three work.
  sh([...git, 'clone', '--quiet', '--no-checkout', CORE_REPO, coreDir], here);
  sh(['git', 'checkout', '--quiet', '--detach', CORE_REF], coreDir);
  sh(['git', 'submodule', 'update', '--init', '--quiet'], coreDir);
} else {
  console.log(`harness: memakai core di ${coreDir}`);
}

// ---- 2. copy this module into <core>/modules/<Name> and register it ----
const target = join(coreDir, 'modules', NAME);
rmSync(target, { recursive: true, force: true });
/** Copy this module into core, skipping .git, node_modules and .core (which may live inside this folder). */
function copyModule(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (/^(\.git|node_modules|\.core)$/.test(entry)) continue;
    const from = join(src, entry);
    const to = join(dst, entry);
    if (statSync(from).isDirectory()) copyModule(from, to);
    else copyFileSync(from, to);
  }
}
copyModule(here, target);
const modulesFile = join(coreDir, 'modules.json');
const modules = JSON.parse(readFileSync(modulesFile, 'utf8')) as {
  modules: { name: string; source: string; path: string }[];
};
if (!modules.modules.some((m) => m.name === NAME)) {
  modules.modules.push({ name: NAME, source: 'local', path: `modules/${NAME}` });
  writeFileSync(modulesFile, `${JSON.stringify(modules, null, 2)}\n`);
  console.log(`harness: ${NAME} ditambahkan ke ${modulesFile}`);
}

// ---- 3. assemble, check, test ----
const env: Record<string, string> = {};
sh(['bun', 'install'], coreDir);
sh(['bun', 'run', 'bootstrap'], coreDir); // db codegen → modules:sync → codegen (fresh clone has no generated files)
sh(['bunx', 'tsc', '-p', 'tsconfig.json'], target);
sh(['bunx', 'biome', 'check', `modules/${NAME}`], coreDir);
sh(['bun', 'run', 'db:generate'], coreDir);
if (args.has('--web')) {
  sh(['bunx', 'svelte-kit', 'sync'], join(coreDir, 'apps/web'));
  sh(
    ['bunx', 'svelte-check', '--tsconfig', './tsconfig.json', '--threshold', 'error'],
    join(coreDir, 'apps/web'),
  );
}
if (process.env.DATABASE_URL) {
  sh(['bun', 'run', '--cwd', 'packages/db', 'migrate'], coreDir);
  env.INTEGRATION = '1';
}
sh(['bun', 'test', `modules/${NAME}/test`], coreDir, env);
console.log(
  `\nharness: ${NAME} OK${process.env.DATABASE_URL ? ' (termasuk tes integrasi)' : ' (tanpa DATABASE_URL: tes integrasi dilewati)'}`,
);
if (!process.env.CORE_DIR)
  console.log(
    `Untuk mencoba di browser: cd .core && bun run --cwd packages/db migrate && bun run db:seed && bun dev`,
  );

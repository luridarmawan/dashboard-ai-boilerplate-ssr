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
import { join, relative, resolve } from 'node:path';

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

/** Commit id for a branch, tag or commit — `null` when the ref does not resolve here. */
function revParse(ref: string, cwd: string): string | null {
  const p = Bun.spawnSync(['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = p.stdout.toString().trim();
  return p.exitCode === 0 && out !== '' ? out : null;
}

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
  // A half-finished clone from an earlier run would make `git clone` refuse the directory, and it
  // is worthless anyway: no modules.json means no usable core.
  rmSync(coreDir, { recursive: true, force: true });
  sh([...git, 'clone', '--quiet', '--no-checkout', CORE_REPO, coreDir], here);
  // A ref may be a branch, tag or commit. `git checkout --detach <name>` refuses a branch that
  // exists only on the remote: git's DWIM would first create a tracking branch, which --detach
  // forbids ("'--detach' cannot be used with '-b/-B/--orphan'"). Only the clone's default branch
  // is local here, so "development" fails where "main" happens to work. Resolving the ref to a
  // commit id first removes the guess, and keeps all three kinds of ref working.
  const commit = revParse(CORE_REF, coreDir) ?? revParse(`origin/${CORE_REF}`, coreDir);
  if (!commit) {
    console.error(
      `harness: ref "${CORE_REF}" tidak ada di ${CORE_REPO} (bukan branch, tag, atau commit)`,
    );
    process.exit(1);
  }
  sh(['git', 'checkout', '--quiet', '--detach', commit], coreDir);
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

/**
 * Format the module where Biome actually lives. `bun run rename` changes identifier lengths, so
 * the formatter's line breaks drift from the ones the template was generated with, and the module
 * repo has no Biome of its own — its dependencies only resolve inside a core. `bun modgen` formats
 * what it generates for the same reason; this is that step for a standalone module. The result is
 * written back here, so what the author commits is what the check right after this accepts.
 */
function formatModule(): void {
  // `--write` exits non-zero when something is left that it cannot fix: that is the checker's job
  // to report, with its own message, right after this.
  Bun.spawnSync(['bunx', 'biome', 'check', '--write', `modules/${NAME}`], {
    cwd: coreDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const rewritten: string[] = [];
  const back = (src: string, dst: string): void => {
    for (const entry of readdirSync(src)) {
      // `bun install` in core links workspace dependencies into the copy: never bring those back.
      if (/^(\.git|node_modules|\.core)$/.test(entry)) continue;
      const from = join(src, entry);
      const to = join(dst, entry);
      if (statSync(from).isDirectory()) {
        back(from, to);
        continue;
      }
      if (!existsSync(to) || readFileSync(from, 'utf8') !== readFileSync(to, 'utf8')) {
        copyFileSync(from, to);
        rewritten.push(relative(here, to));
      }
    }
  };
  back(target, here);
  if (rewritten.length > 0) {
    console.log(`\nharness: diformat ulang di repo ini — ${rewritten.join(', ')}`);
  }
}

// ---- 3. assemble, check, test ----
const env: Record<string, string> = {};
sh(['bun', 'install'], coreDir);
sh(['bun', 'run', 'bootstrap'], coreDir); // db codegen → modules:sync → codegen (fresh clone has no generated files)
sh(['bunx', 'tsc', '-p', 'tsconfig.json'], target);
formatModule();
sh(['bunx', 'biome', 'check', `modules/${NAME}`], coreDir);
// `db:generate` diffs the generated schema against the committed snapshots. The generated schema
// applies TABLE_PREFIX (O-2) while the snapshots never carry it, so with a prefix set drizzle-kit
// sees every table renamed and stops for an interactive answer nobody is there to give — and the
// module's migration is silently never written. `bun modgen` strips it for the same reason; the
// migration below is applied WITH the prefix, which is where it belongs.
sh(['bun', 'run', 'db:generate'], coreDir, { TABLE_PREFIX: '' });
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
// The generated integration tests speak to the app as `http://api.test` (modgen templates.ts).
// When the core's .env sets APP_ORIGIN, that list becomes the CSRF allow-list (apps/api csrf.ts,
// `allowedOrigins`) and the request origin is no longer trusted: every mutation in the test —
// the login first — comes back 403 origin_mismatch, which reads like a permission bug and is not.
// So the test step names its own origin, the way db:generate above names its own TABLE_PREFIX.
// An author testing against a different origin sets APP_ORIGIN and keeps it.
if (!process.env.APP_ORIGIN) env.APP_ORIGIN = 'http://api.test';
sh(['bun', 'test', `modules/${NAME}/test`], coreDir, env);
console.log(
  `\nharness: ${NAME} OK${process.env.DATABASE_URL ? ' (termasuk tes integrasi)' : ' (tanpa DATABASE_URL: tes integrasi dilewati)'}`,
);
if (!process.env.CORE_DIR)
  console.log(
    `Untuk mencoba di browser: cd .core && bun run --cwd packages/db migrate && bun run db:seed && bun dev`,
  );

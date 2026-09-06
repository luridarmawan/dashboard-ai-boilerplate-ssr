#!/usr/bin/env bun
/**
 * Build the `bun create module` template (PRD G-12) at .bun-create/module/ from the SAME templates
 * `bun modgen` uses, plus the standalone extras (harness, rename, CI workflow, README). Bun picks
 * local templates up from `<repo>/.bun-create/<name>`, so inside this repo:
 *
 *   bun create module ../my-module      # copies the template, git init, bun install
 *
 * Outside the repo, point BUN_CREATE_DIR at a checkout's .bun-create, or `git clone` the template
 * folder. The template is committed; `bun run starter:build --check` (CI) fails when it drifts
 * from the generator, so both paths always produce the same module.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { makeSpec } from './modgen/spec.ts';
import { renderModule } from './modgen/templates.ts';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const out = join(root, '.bun-create', 'module');
const check = process.argv.includes('--check');
const starterDir = join(root, 'scripts', 'modgen', 'starter');

/**
 * Clone URL the standalone harness uses. Deterministic on purpose: it must not depend on how the
 * local checkout's remote is spelled (ssh vs https, with or without .git), or `ci:starter-check`
 * would disagree between machines. Override with CORE_REPO when building for a fork.
 */
const CORE_REPO =
  process.env.CORE_REPO ?? 'https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git';

const spec = makeSpec({
  name: 'Hello',
  resource: 'note',
  fields: 'title:string!,body:text,pinned:boolean',
  withPublic: true,
  description: 'Starter module — rename me (bun run rename <Name>)',
});
const files = renderModule(spec);

// ---- standalone extras ----
const pkg = JSON.parse(files['package.json'] ?? '{}') as Record<string, unknown> & {
  scripts?: Record<string, string>;
};
pkg.scripts = {
  harness: 'bun run harness.ts',
  rename: 'bun run rename.ts',
  typecheck: 'bun run harness.ts',
  test: 'bun run harness.ts',
};
pkg.core = { repo: CORE_REPO, ref: 'main' };
files['package.json'] = `${JSON.stringify(pkg, null, 2)}\n`;
files['harness.ts'] = readFileSync(join(starterDir, 'harness.ts'), 'utf8');
files['rename.ts'] = readFileSync(join(starterDir, 'rename.ts'), 'utf8');
files['.github/workflows/ci.yml'] = readFileSync(join(starterDir, 'ci.yml'), 'utf8');
files['.gitignore'] = readFileSync(join(starterDir, 'gitignore'), 'utf8');
files['README.md'] = `# Hello — modul standalone

Dibuat dengan \`bun create module\`. Folder ini adalah **repositori modul yang berdiri sendiri**: bisa di-build,
di-lint, dan dites tanpa meng-clone core secara manual (PRD §4.9 poin 2). Strukturnya sama persis dengan
modul lokal di \`modules/<Nama>\` pada core — hanya lokasinya yang berbeda.

## Mulai

\`\`\`bash
bun run rename Billing        # sekali: Hello → Billing (namespace billing, tabel billing_*, /m/billing/*)
bun run harness               # clone core ke .core/ (ref di package.json → "core"), tautkan, sync, tsc, lint, migrasi, tes
DATABASE_URL=mysql://app:app@127.0.0.1:3306/app bun run harness   # + tes integrasi terhadap MySQL nyata
bun run harness --web         # + svelte-check halaman modul
\`\`\`

Untuk siklus dev di browser, arahkan harness ke checkout core yang sudah ada — modul ditautkan ke sana dan
\`bun dev\` di core menyajikannya di \`/m/<ns>/…\`:

\`\`\`bash
CORE_DIR=../dashboard-ai-boilerplate-ssr bun run harness
\`\`\`

## Rilis & pemasangan di host

\`\`\`bash
git tag v0.1.0 && git push --tags
# di core mana pun:
bun modules:add <git-url> --ref v0.1.0
\`\`\`

\`ref\` wajib tag atau commit (Keputusan L). Host tidak me-lint kode Anda — CI di repo ini yang melakukannya
(\`.github/workflows/ci.yml\` menjalankan harness dengan MySQL).

## Isi

Semua titik perluasan yang dipakai berjalan: \`db/tables.ts\`, \`permissions.ts\`, \`menu.ts\`, \`config.ts\`, \`i18n/\`,
\`api/\` (route + skema bersama), \`web/routes/\` (list, baru, ubah), \`web/public/\` (halaman publik), \`widgets.ts\`,
\`hooks.ts\`, \`jobs.ts\`, \`seed.ts\`, \`test/\`. Panduan lengkap: \`docs/MODULES.md\` di core.
`;

function walk(dir: string, base = dir, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p));
  }
  return acc;
}

// Render + format into a staging dir (inside the repo so the repo's Biome config applies), then
// either compare with the committed template (--check) or move it into place.
const stage = join(root, '.bun-create', '.module-stage');
rmSync(stage, { recursive: true, force: true });
for (const [rel, content] of Object.entries(files)) {
  mkdirSync(dirname(join(stage, rel)), { recursive: true });
  writeFileSync(join(stage, rel), content);
}
const fmt = Bun.spawnSync(['bunx', 'biome', 'check', '--write', relative(root, stage)], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'pipe',
});
if (fmt.exitCode !== 0) {
  console.error(fmt.stdout.toString(), fmt.stderr.toString());
  rmSync(stage, { recursive: true, force: true });
  process.exit(1);
}

if (check) {
  const want = walk(stage).sort();
  const have = new Set(walk(out));
  const drift: string[] = [];
  for (const rel of want) {
    const p = join(out, rel);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== readFileSync(join(stage, rel), 'utf8'))
      drift.push(rel);
    have.delete(rel);
  }
  for (const stale of have) drift.push(`${stale} (stale)`);
  rmSync(stage, { recursive: true, force: true });
  if (drift.length) {
    console.error(
      `starter:build --check: .bun-create/module tidak sinkron dengan generator:\n  ${drift.join('\n  ')}\nJalankan: bun run starter:build`,
    );
    process.exit(1);
  }
  console.log('starter:build --check: .bun-create/module sinkron');
  process.exit(0);
}

rmSync(out, { recursive: true, force: true });
renameSync(stage, out);
console.log(
  `starter:build: ${Object.keys(files).length} berkas → ${relative(root, out)} (core ${CORE_REPO}@main)`,
);

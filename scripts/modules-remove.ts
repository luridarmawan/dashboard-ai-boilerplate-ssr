#!/usr/bin/env bun
/**
 * `bun modules:remove <Name> [--yes] [--keep-files] [--dry-run]`
 *
 * Clean module uninstall (PRD G-15) — the inverse of `modules:add` / `modgen`, in one command:
 *
 *   1. the entry leaves modules.json; a submodule is deinit-ed and removed (with its
 *      `.gitmodules` section, `.git/modules/…` copy and the biome.json exclusion), a local
 *      module's folder is deleted (`--keep-files` keeps it);
 *   2. `bun install` + `bun run bootstrap`: every generated registry, route shim, menu entry,
 *      permission, i18n key, theme, widget, job and tool disappears (G-2, criterion 14);
 *   3. the database. Module tables that were RELEASED (their CREATE lives in a committed
 *      migration) get a new migration — drizzle-kit's diff, rewritten in FK-safe order with the
 *      purge of the rows the module left in core tables (see `@core/module-kit` remove.ts).
 *      Tables that were never released (their migration is still untracked) are simply
 *      forgotten: the uncommitted migration files are restored to HEAD.
 *
 * Nothing touches a database here. The migration is applied like any other — reviewed, after a
 * backup, with `bun db:migrate` / `dc run --rm migrate` (Q-4) — which is also why the command
 * asks for the module name back before it changes anything (`--yes` for scripts).
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type DrizzleSnapshotLike,
  modulesFileSchema,
  moduleTablesFromSnapshot,
  namespaceOf,
  orderForDrop,
  type RemovalDialect,
  renderRemovalMigration,
  unrelatedStatements,
} from '@core/module-kit';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const name = args.find((a) => !a.startsWith('--')) ?? '';
const yes = flag('--yes') || flag('-y');
const keepFiles = flag('--keep-files');
const dryRun = flag('--dry-run');

function usage(msg?: string): never {
  if (msg) console.error(`modules:remove: ${msg}`);
  console.error(
    'Pemakaian: bun modules:remove <Name> [--yes] [--keep-files] [--dry-run]\n' +
      '  --yes         tanpa konfirmasi interaktif (CI)\n' +
      '  --keep-files  jangan hapus folder modul lokal (hanya lepas registrasinya)\n' +
      '  --dry-run     tampilkan rencana, jangan ubah apa pun',
  );
  process.exit(1);
}
if (!name) usage();

// `bun run scripts/…` loads .env into THIS process. Children must not inherit runtime-only values:
// with TABLE_PREFIX set, drizzle-kit would see every table renamed and stop for an interactive
// rename prompt. Codegen and generate are meant to run against the empty prefix (O-2).
const childEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env))
  if (v !== undefined && k !== 'TABLE_PREFIX' && k !== 'DATABASE_URL') childEnv[k] = v;

const sh = (cmd: string[], opts: { cwd?: string; ok?: boolean } = {}): string => {
  const p = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? root,
    env: childEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (p.exitCode !== 0 && !opts.ok) {
    throw new Error(
      `${cmd.join(' ')}\n${p.stderr.toString().trim() || p.stdout.toString().trim()}`,
    );
  }
  return p.stdout.toString().trim();
};
const run = (cmd: string[], label: string) => {
  console.log(`→ ${label}`);
  const p = Bun.spawnSync(cmd, { cwd: root, env: childEnv, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) {
    console.error(`modules:remove: ${label} gagal (exit ${p.exitCode})`);
    process.exit(p.exitCode ?? 1);
  }
};

// ---- 1. the entry ----------------------------------------------------------------------------
const modulesFile = join(root, 'modules.json');
const parsed = modulesFileSchema.parse(JSON.parse(readFileSync(modulesFile, 'utf8')));
const entry = parsed.modules.find((m) => m.name === name);
if (!entry) usage(`modul "${name}" tidak terdaftar di modules.json`);
const source = entry.source;
const path = (entry.source === 'package' ? undefined : entry.path) ?? `modules/${name}`;
const absPath = join(root, path);
const ns = namespaceOf(name);

// ---- 2. what the database holds for it: the latest snapshot per dialect ----------------------
const DIALECTS: RemovalDialect[] = ['mysql', 'pg'];
const migrationsDir = (d: RemovalDialect) => join(root, 'packages/db/migrations', d);
function latestSnapshot(d: RemovalDialect): DrizzleSnapshotLike | null {
  const journalPath = join(migrationsDir(d), 'meta/_journal.json');
  if (!existsSync(journalPath)) return null;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.at(-1);
  if (!last) return null;
  const idx = last.tag.split('_')[0] ?? '';
  const file = join(migrationsDir(d), `meta/${idx}_snapshot.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DrizzleSnapshotLike) : null;
}
const planned = new Map<RemovalDialect, string[]>();
for (const d of DIALECTS) {
  const snap = latestSnapshot(d);
  planned.set(d, snap ? orderForDrop(moduleTablesFromSnapshot(snap, ns)) : []);
}
const tables = planned.get('mysql') ?? [];

// The module's own declaration, when the folder is still there: a table declared but not yet
// migrated has nothing to drop; a table migrated but no longer declared is dropped all the same.
let declared: string[] | null = null;
const tablesTs = join(absPath, 'db/tables.ts');
if (existsSync(tablesTs)) {
  try {
    const mod = (await import(tablesTs)) as { default?: readonly { name: string }[] };
    declared = (mod.default ?? []).map((t) => t.name).sort();
  } catch {
    declared = null;
  }
}

// ---- 3. released or not? ---------------------------------------------------------------------
// Migration files still untracked = the module was never released: forgetting them is the right
// "down migration" (the tree returns to HEAD); a committed CREATE needs a committed DROP.
const untrackedMigrations = sh(
  ['git', 'ls-files', '--others', '--exclude-standard', 'packages/db/migrations'],
  { ok: true },
)
  .split('\n')
  .filter((f) => f.endsWith('.sql'));
const createsOwnTable = (sql: string) =>
  tables.some((t) =>
    new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:"public"\\.)?[\`"]${t}[\`"]`, 'i').test(sql),
  );
const fresh =
  tables.length > 0 &&
  untrackedMigrations.some((f) => createsOwnTable(readFileSync(join(root, f), 'utf8')));

// ---- 4. the plan -------------------------------------------------------------------------------
console.log(`modules:remove ${name} (${ns}) — sumber ${source}, ${path}`);
console.log(
  tables.length
    ? `  tabel di snapshot (urutan drop): ${tables.join(', ')}`
    : '  tabel di snapshot: tidak ada',
);
if (declared && declared.join() !== [...tables].sort().join()) {
  const onlyDeclared = declared.filter((t) => !tables.includes(t));
  const onlyMigrated = tables.filter((t) => !declared?.includes(t));
  if (onlyDeclared.length)
    console.log(
      `  ! dideklarasikan tapi belum bermigrasi (tidak ada yang dijatuhkan): ${onlyDeclared.join(', ')}`,
    );
  if (onlyMigrated.length)
    console.log(
      `  ! bermigrasi tapi tidak lagi dideklarasikan (tetap dijatuhkan): ${onlyMigrated.join(', ')}`,
    );
}
console.log(
  fresh
    ? '  migrasi: belum pernah dirilis → berkas migrasi yang belum ter-commit dikembalikan ke HEAD'
    : tables.length
      ? `  migrasi: satu migrasi baru per dialect — DROP TABLE anak→induk + pembersihan baris core (modules, configurations ${ns}.*, group_permissions, scheduler_*, queue_jobs, notifications, users.theme, cache_versions)`
      : '  migrasi: tidak ada tabel — hanya pembersihan registrasi',
);
console.log(
  source === 'submodule'
    ? `  git: submodule deinit + rm ${path}, .gitmodules, .git/modules, pengecualian biome.json`
    : keepFiles
      ? `  berkas: ${path} DIPERTAHANKAN (--keep-files)`
      : `  berkas: ${path} dihapus`,
);
console.log(
  '  lalu: bun install → bun run bootstrap → ' +
    (fresh ? 'bun run db:codegen' : 'bun run db:generate'),
);
if (dryRun) {
  console.log('modules:remove: --dry-run, tidak ada yang diubah');
  process.exit(0);
}

// ---- 5. explicit confirmation ------------------------------------------------------------------
if (!yes) {
  if (!process.stdin.isTTY) usage('bukan terminal interaktif — tambahkan --yes untuk melanjutkan');
  const answer = prompt(`Ketik "${name}" untuk mencabut modul ini (tidak bisa dibatalkan):`);
  if (answer?.trim() !== name) {
    console.log('modules:remove: dibatalkan');
    process.exit(1);
  }
}

// ---- 6. modules.json ---------------------------------------------------------------------------
const raw = JSON.parse(readFileSync(modulesFile, 'utf8')) as { modules: { name: string }[] };
raw.modules = raw.modules.filter((m) => m.name !== name);
writeFileSync(modulesFile, `${JSON.stringify(raw, null, 2)}\n`);
console.log(`→ modules.json -= ${name}`);

// ---- 7. git / files ----------------------------------------------------------------------------
if (source === 'submodule') {
  console.log(`→ git submodule deinit + rm ${path}`);
  sh(['git', 'submodule', 'deinit', '-f', '-q', '--', path], { ok: true });
  sh(['git', 'rm', '-f', '-q', '--', path], { ok: true });
  rmSync(join(root, '.git/modules', path), { recursive: true, force: true });
  rmSync(absPath, { recursive: true, force: true });
  // .gitmodules: `git rm` drops the section; an empty file goes back to HEAD's version, or away.
  const gm = join(root, '.gitmodules');
  if (existsSync(gm) && !/\[submodule /.test(readFileSync(gm, 'utf8'))) {
    const inHead =
      Bun.spawnSync(['git', 'cat-file', '-e', 'HEAD:.gitmodules'], { cwd: root }).exitCode === 0;
    if (inHead) {
      sh(['git', 'checkout', 'HEAD', '--', '.gitmodules']);
    } else {
      sh(['git', 'rm', '-q', '-f', '--cached', '.gitmodules'], { ok: true });
      rmSync(gm, { force: true });
    }
  }
} else if (!keepFiles && existsSync(absPath)) {
  const tracked = sh(['git', 'ls-files', '--', path], { ok: true });
  if (tracked) {
    console.log(`→ git rm -r ${path}`);
    sh(['git', 'rm', '-r', '-q', '-f', '--', path]);
  }
  rmSync(absPath, { recursive: true, force: true });
  console.log(`→ ${path} dihapus`);
}
// biome.json: the exclusion modules:add wrote for foreign code
const biomePath = join(root, 'biome.json');
if (existsSync(biomePath)) {
  const biome = JSON.parse(readFileSync(biomePath, 'utf8')) as { files?: { includes?: string[] } };
  const pattern = `!${path}/**`;
  const before = biome.files?.includes?.length ?? 0;
  if (biome.files?.includes)
    biome.files.includes = biome.files.includes.filter((p) => p !== pattern);
  if ((biome.files?.includes?.length ?? 0) !== before) {
    writeFileSync(biomePath, `${JSON.stringify(biome, null, 2)}\n`);
    console.log(`→ biome.json: ${pattern} dicabut`);
  }
}

// ---- 8. relink, regenerate ---------------------------------------------------------------------
run(['bun', 'install', '--no-summary'], 'bun install (lepaskan tautan workspace)');
run(['bun', 'run', 'bootstrap'], 'bootstrap (codegen + modules:sync tanpa modul)');

// ---- 9. the database side ----------------------------------------------------------------------
if (fresh) {
  console.log('→ migrasi belum dirilis: kembalikan packages/db/migrations ke HEAD');
  sh(['git', 'checkout', '--', 'packages/db/migrations']);
  sh(['git', 'clean', '-fdq', 'packages/db/migrations']);
  run(['bun', 'run', 'db:codegen'], 'db:codegen (segarkan migrasi tersemat)');
} else if (tables.length) {
  const before = new Map(DIALECTS.map((d) => [d, new Set(sqlFiles(d))]));
  run(['bun', 'run', 'db:generate'], 'db:generate (drizzle-kit menghitung diff skema)');
  for (const d of DIALECTS) {
    const fresh = sqlFiles(d).filter((f) => !before.get(d)?.has(f));
    const own = planned.get(d) ?? [];
    if (fresh.length !== 1) {
      console.log(
        `  ! ${d}: ${fresh.length === 0 ? 'drizzle-kit tidak membuat migrasi baru' : `ada ${fresh.length} migrasi baru`} — periksa packages/db/migrations/${d} secara manual`,
      );
      continue;
    }
    const file = join(migrationsDir(d), fresh[0] as string);
    const generated = readFileSync(file, 'utf8');
    const keep = unrelatedStatements(generated, own);
    writeFileSync(file, `${renderRemovalMigration({ dialect: d, name, ns, tables: own }, keep)}\n`);
    console.log(
      `  ${d}: ${fresh[0]} — ${own.length} DROP TABLE terurut + pembersihan baris core${keep.length ? ` (+${keep.length} pernyataan lain yang tertunda)` : ''}`,
    );
  }
  run(['bun', 'run', 'db:codegen'], 'db:codegen (sematkan migrasi yang ditulis ulang)');
} else {
  console.log('→ tidak ada tabel modul di snapshot; tidak ada migrasi yang dibuat');
}

function sqlFiles(d: RemovalDialect): string[] {
  try {
    return readdirSync(migrationsDir(d))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
}

// ---- 10. what is left for the operator ---------------------------------------------------------
console.log(`\nmodules:remove: ${name} dicabut dari registrasi.`);
if (!fresh && tables.length) {
  console.log(
    'Langkah berikutnya:\n' +
      '  1. Tinjau migrasi baru di packages/db/migrations/{mysql,pg} — ia menjatuhkan tabel dan membersihkan baris core.\n' +
      '  2. Backup dulu (dc run --rm backup-once / deploy/backup.sh), lalu terapkan: bun db:migrate (dev) atau\n' +
      '     dc run --rm migrate (produksi) — sesudah image baru tanpa modul ini di-deploy, karena kode lama\n' +
      '     masih membaca tabelnya sampai rollout selesai (DEPLOY.md §8).\n' +
      '  3. Commit modules.json, migrasi, dan penghapusan foldernya dalam satu perubahan.\n' +
      'Yang sengaja tidak disentuh: audit_log (append-only, retensi M-3), baris `files` dan objeknya di storage\n' +
      `(kind '${ns}.*'), app.allowed_themes dan tema kustom yang merujuk set ikon/layout modul (L-14 sudah\n` +
      'menurunkannya ke baku saat hilang).',
  );
}

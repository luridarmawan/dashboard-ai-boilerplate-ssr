#!/usr/bin/env sh
# Simulation of docs/Build-Module-for-Your-Apps.md, end to end, for a module named "Contact":
# a work directory, a clone of this boilerplate used as the SDK, a generated .env, the module's
# own repository, its harness, and finally the host installing it from a git URL pinned to a tag.
#
# It is both a test and a tutorial: every step prints the exact command a reader would type before
# running it, and every step is checked, so a documented promise that stops being true fails here
# rather than in someone's afternoon.
#
#   bun run sim:module                       # work dir under /tmp, core cloned from this checkout
#   SIM_DIR=~/kerja bun run sim:module       # somewhere you can keep looking at afterwards
#   CORE_REPO=https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git bun run sim:module
#   SIM_DATABASE_URL=mysql://… bun run sim:module     # database steps (default: this repo's .env)
#   SIM_NO_DB=1 bun run sim:module           # skip everything that needs a database
#   SIM_WEB=1 bun run sim:module             # + svelte-check of the module's pages (slow)
#   SIM_CLEAN=1 bun run sim:module           # delete the work dir when it passes
set -eu

cd "$(dirname "$0")/.."
ROOT="$PWD"
NAME=Contact
NS=contact
PREFIX="${SIM_TABLE_PREFIX:-sim_}"
WORK="${SIM_DIR:-$(mktemp -d)/kerja}"
CORE_REPO="${CORE_REPO:-file://$ROOT}"
CORE_REF="${CORE_REF:-$(git -C "$ROOT" rev-parse HEAD)}"
LOG="$(mktemp -d)/sim.log"
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-sim}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-sim@example.test}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

# ---- narration -------------------------------------------------------------------------------
step() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
say() { printf '   %s\n' "$*"; }
cmd() { printf '   \033[2m$ %s\033[0m\n' "$*"; }
ok() { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die() {
  printf '\n\033[31m✗ SIMULASI GAGAL:\033[0m %s\n' "$*"
  [ -f "$LOG" ] && { echo '--- 40 baris terakhir:'; tail -40 "$LOG"; }
  echo "   Direktori kerja ditinggalkan untuk diperiksa: $WORK"
  exit 1
}
# Run a command quietly; on failure show the tail of its output. $1 is what to say when it breaks.
run() {
  what="$1"
  shift
  if ! "$@" >"$LOG" 2>&1; then die "$what"; fi
}

# ---- 0. prerequisites ------------------------------------------------------------------------
step "§0 · Prasyarat dan direktori kerja"
command -v bun >/dev/null || die 'bun tidak ada di PATH (butuh Bun 1.4+)'
say "bun $(bun --version), git $(git --version | awk '{print $3}')"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  say '⚠ pohon kerja core ini kotor — klon di bawah memakai HEAD, bukan perubahan yang belum di-commit'
fi
cmd "mkdir -p $WORK && cd $WORK"
mkdir -p "$WORK"
cd "$WORK"
[ -e core ] && die "$WORK/core sudah ada — hapus dulu atau pakai SIM_DIR lain"
[ -e "mod-$NS" ] && die "$WORK/mod-$NS sudah ada — hapus dulu atau pakai SIM_DIR lain"
ok "direktori kerja: $WORK"

step "§0 · Clone boilerplate — dipakai sebagai alat, bukan di-fork"
cmd 'git clone https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git core'
[ "$CORE_REPO" = "file://$ROOT" ] && say "(simulasi ini meng-clone checkout lokal: $CORE_REPO @ $(echo "$CORE_REF" | cut -c1-12))"
run 'clone core gagal' git -c protocol.file.allow=always clone --quiet "$CORE_REPO" core
run 'checkout ref core gagal' git -C core checkout --quiet --detach "$CORE_REF"
cmd 'cd core && bun install'
run 'bun install di core gagal' bun install --cwd core
ok "core siap di $WORK/core ($(git -C core rev-parse --short HEAD))"

# ---- 0b. .env --------------------------------------------------------------------------------
step "§0 · Generate .env core"
cmd 'cp .env.example .env'
cp core/.env.example core/.env
DB_URL=""
if [ -n "${SIM_DATABASE_URL:-}" ]; then
  DB_URL="$SIM_DATABASE_URL"
elif [ -z "${SIM_NO_DB:-}" ] && [ -f "$ROOT/.env" ]; then
  # The developer running this already has a working database in their own .env; borrow it and
  # keep the simulation's tables apart with TABLE_PREFIX (O-2) instead of a second server.
  DB_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')"
fi
DB_DIALECT="$(grep -E '^DB_DIALECT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d ' ' || true)"
[ -n "$DB_DIALECT" ] || DB_DIALECT=mysql
sed -i \
  -e "s|^DB_DIALECT=.*|DB_DIALECT=$DB_DIALECT|" \
  -e "s|^TABLE_PREFIX=.*|TABLE_PREFIX=$PREFIX|" \
  -e 's|^WEB_PORT=.*|WEB_PORT=5370|' \
  -e 's|^API_PORT=.*|API_PORT=5371|' \
  -e 's|^API_URL=.*|API_URL=http://127.0.0.1:5371|' \
  core/.env
[ -n "$DB_URL" ] && sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" core/.env
say "DB_DIALECT=$DB_DIALECT · TABLE_PREFIX=$PREFIX · port web 5370 / api 5371"
say 'TABLE_PREFIX memisahkan tabel simulasi dari tabel Anda sendiri di database yang sama (O-2)'

# Does that database actually answer? Everything DB-dependent below hangs off this one answer.
DB_OK=0
if [ -n "$DB_URL" ]; then
  cat >core/.sim-db.ts <<'TS'
// Throwaway helper: probe the database, then drop the simulation's own tables when it is over.
import { sql } from 'drizzle-orm';
import { activeDialect, getDb } from '@core/db';
const [op, prefix = ''] = process.argv.slice(2);
const db = getDb();
if (op === 'probe') {
  await db.execute(sql`select 1`);
  console.log('ok');
} else if (op === 'drop') {
  if (!prefix) throw new Error('drop needs a table prefix');
  const pg = activeDialect === 'postgres';
  const rows = (await db.execute(
    pg
      ? sql`select tablename as name from pg_tables where schemaname = 'public' and tablename like ${`${prefix}%`}`
      : sql`select table_name as name from information_schema.tables where table_schema = database() and table_name like ${`${prefix}%`}`,
  )) as unknown as { name?: string }[] | [{ name?: string }[]];
  const list = (Array.isArray(rows[0]) ? rows[0] : rows) as { name?: string }[];
  const names = list.map((r) => r.name).filter((n): n is string => Boolean(n));
  if (!pg) await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const name of names) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${pg ? `"${name}" CASCADE` : `\`${name}\``}`));
  }
  if (!pg) await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  console.log(`${names.length}`);
}
process.exit(0);
TS
  if (cd core && bun run .sim-db.ts probe) >"$LOG" 2>&1; then
    DB_OK=1
    ok "database menjawab — migrasi, seed dan tes integrasi ikut dijalankan"
  else
    say '⚠ database tidak menjawab — langkah DB dilewati (perintahnya tetap dicetak)'
    say "   $(tail -3 "$LOG" | head -1)"
  fi
else
  say 'ℹ tanpa DATABASE_URL — langkah DB dilewati (SIM_DATABASE_URL=… untuk mengaktifkannya)'
fi
cleanup_db() {
  [ "$DB_OK" = 1 ] || return 0
  [ -z "${SIM_KEEP_DB:-}" ] || return 0
  dropped="$( (cd core && bun run .sim-db.ts drop "$PREFIX") 2>/dev/null || echo '?')"
  rm -f core/.sim-db.ts
  say "tabel simulasi dihapus dari database: $dropped tabel berawalan $PREFIX"
}
rm -f core/.sim-db.ts

# ---- 1. the module's own repository -----------------------------------------------------------
step "§1 · Bikin repo modul $NAME — bersebelahan dengan core, bukan di dalamnya"
cmd "bun create module ../mod-$NS"
run 'bun create module gagal' sh -c "cd '$WORK/core' && bun create module '../mod-$NS'"
[ -f "mod-$NS/module.json" ] || die 'template tidak tersalin (module.json tidak ada)'
say '(saran penutup "cd … && bun dev" dari bun create diabaikan — repo modul tidak punya skrip dev)'
cmd "cd ../mod-$NS && bun run rename $NAME"
run 'rename gagal' sh -c "cd '$WORK/mod-$NS' && bun run rename $NAME"
grep -q "\"name\": \"$NAME\"" "mod-$NS/module.json" || die "rename tidak mengubah module.json menjadi $NAME"
grep -q "${NS}_notes" "mod-$NS/db/tables.ts" || die "tabel belum ber-namespace ${NS}_"
ok "namespace $NS: tabel ${NS}_*, izin $NS.*, route /m/$NS/*"
say 'kata sumber daya (note/notes) tetap bawaan template — menggantinya urusan editor Anda (§1)'

step "§1a · Repo modul punya remote dan tag sendiri"
cmd 'git init -b main && git add -A && git commit -m "modul Contact dari template"'
run 'git init/commit di repo modul gagal' sh -c "cd '$WORK/mod-$NS' && { git init -q -b main 2>/dev/null || true; } && git add -A && git commit -qm 'modul $NAME dari template'"
cmd 'git remote add origin git@github.com:<akun-anda>/mod-contact.git && git push -u origin main'
say '(simulasi tidak punya remote; di kehidupan nyata inilah repo ANDA — bukan remote core)'
cmd 'git tag v0.1.0 && git push origin v0.1.0'
run 'git tag gagal' sh -c "cd '$WORK/mod-$NS' && git tag v0.1.0"
ok "rilis v0.1.0 ditandai — inilah ref yang dipasang host (§5)"

# ---- 2. harness ------------------------------------------------------------------------------
step "§2 · Build, lint, typecheck, migrasi, tes — semuanya lewat harness"
cmd 'CORE_DIR=../core bun run harness'
[ "$DB_OK" = 1 ] && cmd 'DATABASE_URL=… CORE_DIR=../core bun run harness   # + migrasi & tes integrasi'
[ -n "${SIM_WEB:-}" ] && cmd 'CORE_DIR=../core bun run harness --web        # + svelte-check halaman modul'
HARNESS_ENV="CORE_DIR=../core"
if [ "$DB_OK" = 1 ]; then
  HARNESS_ENV="$HARNESS_ENV DATABASE_URL='$DB_URL' DB_DIALECT='$DB_DIALECT' TABLE_PREFIX='$PREFIX'"
fi
run 'harness gagal' sh -c "cd '$WORK/mod-$NS' && env $HARNESS_ENV bun run harness ${SIM_WEB:+--web}"
grep -q "harness: $NAME OK" "$LOG" || die 'harness selesai tanpa baris "OK"'
if [ "$DB_OK" = 1 ]; then
  grep -q '1 pass' "$LOG" || die 'tes integrasi modul tidak jalan padahal DATABASE_URL ada'
  ok 'harness hijau: install → bootstrap → tsc → biome → db:generate → migrasi → tes integrasi (CRUD nyata)'
else
  ok 'harness hijau: install → bootstrap → tsc → biome → db:generate → tes unit'
fi
[ -f "core/modules/$NAME/module.json" ] || die 'harness tidak menyalin modul ke core'
say "harness menyalin modul ke core/modules/$NAME — itu sisa kerja, bukan tempat Anda menulis kode (§3)"

step "§3 · Lingkaran kerja di browser"
cmd 'cd ../core && bun dev            # terminal 1, biarkan hidup'
cmd 'cd ../mod-contact && CORE_DIR=../core bun run harness   # terminal 2, tiap kali kode berubah'
say "halaman modul tersaji di http://127.0.0.1:5370/m/$NS/notes setelah login"
[ -f "core/apps/web/src/routes/(app)/m/$NS/notes/+page.svelte" ] || die 'shim halaman modul tidak dibuat oleh sync'
ok "shim halaman ada: apps/web/src/routes/(app)/m/$NS/notes/+page.svelte"

# ---- 6. the host installs it from a git URL ----------------------------------------------------
step "§6 · Host memasang modul dari git URL, terkunci di tag"
say 'sisa kerja harness dibersihkan dulu supaya host memasang dari nol, seperti instalasi lain'
run 'reset core gagal' sh -c "cd '$WORK/core' && rm -rf 'modules/$NAME' && git checkout -- modules.json && git clean -fdq packages/db/migrations && bun install"
cmd "bun modules:add git@github.com:<akun-anda>/mod-$NS.git --ref v0.1.0"
run 'modules:add gagal' sh -c "cd '$WORK/core' && bun run modules:add 'file://$WORK/mod-$NS' --ref v0.1.0"
grep -q "\"name\": \"$NAME\"" core/modules.json || die 'modules.json tidak mencatat modul'
grep -q '"source": "submodule"' core/modules.json || die 'modules.json tidak mencatat sumber submodule'
grep -q '"ref": "v0.1.0"' core/modules.json || die 'modules.json tidak mengunci ref v0.1.0'
grep -q "\"!modules/$NAME/\*\*\"" core/biome.json || die 'biome.json tidak mengecualikan modul eksternal'
grep -q "$NS" core/apps/api/src/generated/modules.ts || die 'registry API tidak memuat modul'
ok 'submodule terpasang, modules.json mencatat {source, repo, ref, path}, Biome host mengecualikannya'

if [ "$DB_OK" = 1 ]; then
  cmd 'bun db:generate && bun run --cwd packages/db migrate'
  run 'db:generate gagal' sh -c "cd '$WORK/core' && bun run db:generate"
  ls core/packages/db/migrations/mysql/*.sql core/packages/db/migrations/pg/*.sql >/dev/null 2>&1 || true
  grep -rql "${NS}_notes" core/packages/db/migrations >/dev/null 2>&1 || die "migrasi untuk tabel ${NS}_notes tidak dibuat"
  run 'migrate gagal' sh -c "cd '$WORK/core' && bun run --cwd packages/db migrate"
  ok "migrasi tabel ${NS}_notes dibuat dan diterapkan (dengan TABLE_PREFIX=$PREFIX)"
  cmd 'INTEGRATION=1 bun test modules/Contact/test'
  run 'tes integrasi modul terpasang gagal' sh -c "cd '$WORK/core' && INTEGRATION=1 bun test modules/$NAME/test"
  grep -q '1 pass' "$LOG" || die 'tes integrasi tidak menghasilkan satu pun test yang lewat'
  ok 'modul yang dipasang dari git melayani CRUD sungguhan di database ini'
else
  say 'dilewati (tanpa database): bun db:generate && bun run --cwd packages/db migrate'
fi

step "§6 · Mencabut — host harus kembali bersih"
cmd "bun modules:remove $NAME --yes"
run 'modules:remove gagal' sh -c "cd '$WORK/core' && bun run modules:remove $NAME --yes"
(cd core && git checkout -- bun.lock 2>/dev/null || true)
LEFT="$(cd core && git status --porcelain --untracked-files=all | grep -v '^?? \.env$' || true)"
[ -z "$LEFT" ] || die "sisa setelah uninstall: $(echo "$LEFT" | tr '\n' ' ')"
ok 'pohon core identik dengan HEAD lagi — tidak ada berkas core yang tersentuh (G-6, G-15)'

cleanup_db

step 'Selesai'
say "9 langkah dokumen terbukti: direktori kerja → clone core → .env → repo modul → rename $NAME → tag → harness → modules:add terkunci tag → modules:remove"
if [ -n "${SIM_CLEAN:-}" ]; then
  cd "$ROOT" && rm -rf "$WORK"
  say 'direktori kerja dihapus (SIM_CLEAN=1)'
else
  say "direktori kerja ditinggalkan untuk diperiksa: $WORK"
  say "   core/        ← klon boilerplate + .env (hapus dengan: rm -rf $WORK)"
  say "   mod-$NS/  ← repo modul Anda, sudah ber-tag v0.1.0"
fi
printf '\n\033[32mSIMULASI MODUL %s: LOLOS\033[0m\n' "$NAME"

#!/usr/bin/env sh
# Simulation of docs/Build-Module-for-Your-Apps.md, end to end, for a module named "Contact":
# a work directory, a clone of this boilerplate used as the SDK, a generated .env, the module's
# own repository, its harness, and finally the host installing it from a git URL pinned to a tag.
#
# It is both a test and a tutorial: every step prints the exact command a reader would type before
# running it, and every step is checked, so a documented promise that stops being true fails here
# rather than in someone's afternoon.
#
# On a terminal it first asks two things: which work directory, and whether to clone this local
# checkout (fast, offline, HEAD) or the repository on GitHub (then: which branch). Both answers can
# be given in advance — a set variable is never asked about, and SIM_YES=1 asks nothing at all.
#
#   bun run sim:module                       # asks; defaults to a work dir under /tmp + this checkout
#   SIM_DIR=~/kerja bun run sim:module       # somewhere you can keep looking at afterwards
#   SIM_YES=1 bun run sim:module             # no questions (CI)
#   CORE_REPO=https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git CORE_REF=main \
#     bun run sim:module                     # straight from GitHub, no questions
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
UPSTREAM='https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git'
# Empty means "not decided yet": the questions below fill these in, and an env var set by the
# caller answers the matching question in advance (so CI and scripts never see a prompt).
WORK="${SIM_DIR:-}"
CORE_REPO="${CORE_REPO:-}"
CORE_REF="${CORE_REF:-}"
CORE_BRANCH="${CORE_BRANCH:-}"
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

# ---- 0. two questions, then everything else runs by itself -------------------------------------
# Only asked on a terminal, and only for what the caller has not already decided with SIM_DIR /
# CORE_REPO / CORE_REF. SIM_YES=1 takes the defaults without asking.
answer=''
ask() {
  printf '   \033[1m%s\033[0m [%s]: ' "$1" "$2"
  answer=''
  read -r answer || answer=''
  [ -n "$answer" ] || answer="$2"
  case "$answer" in '~'*) answer="$HOME${answer#\~}" ;; esac
}

DEFAULT_WORK="$(mktemp -d)/kerja"
if [ -t 0 ] && [ -z "${SIM_YES:-}" ]; then
  step 'Pilihan simulasi'
  if [ -z "$WORK" ]; then
    say 'Di mana simulasi ini dibuat? Isinya: klon core + repo modul Contact.'
    ask 'Direktori kerja' "$DEFAULT_WORK"
    WORK="$answer"
  fi
  if [ -z "$CORE_REPO" ]; then
    say 'Core-nya diambil dari mana?'
    say "  1) klon repo lokal ini — $(git -C "$ROOT" rev-parse --short HEAD) (cepat, tanpa jaringan, memakai HEAD)"
    say "  2) klon dari GitHub — $UPSTREAM"
    ask 'Pilih' '1'
    if [ "$answer" = '2' ]; then
      CORE_REPO="$UPSTREAM"
      ask 'Branch (main / development)' 'development'
      CORE_BRANCH="$answer"
    fi
  fi
fi
[ -n "$WORK" ] || WORK="$DEFAULT_WORK"
[ -n "$CORE_REPO" ] || CORE_REPO="file://$ROOT"
if [ -z "$CORE_REF" ] && [ -z "$CORE_BRANCH" ] && [ "$CORE_REPO" = "file://$ROOT" ]; then
  CORE_REF="$(git -C "$ROOT" rev-parse HEAD)"
fi

# ---- 0. prerequisites ------------------------------------------------------------------------
step "§0 · Prasyarat dan direktori kerja"
command -v bun >/dev/null || die 'bun tidak ada di PATH (butuh Bun 1.4+)'
say "bun $(bun --version), git $(git --version | awk '{print $3}')"
if [ "$CORE_REPO" = "file://$ROOT" ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  say '⚠ pohon kerja core ini kotor — klon di bawah memakai HEAD, bukan perubahan yang belum di-commit'
fi
cmd "mkdir -p $WORK && cd $WORK"
mkdir -p "$WORK"
cd "$WORK"
[ -e core ] && die "$WORK/core sudah ada — hapus dulu atau pakai SIM_DIR lain"
[ -e "mod-$NS" ] && die "$WORK/mod-$NS sudah ada — hapus dulu atau pakai SIM_DIR lain"
ok "direktori kerja: $WORK"

step "§0 · Clone boilerplate — dipakai sebagai alat, bukan di-fork"
cmd "git clone ${CORE_BRANCH:+--branch $CORE_BRANCH }$UPSTREAM core"
if [ "$CORE_REPO" = "file://$ROOT" ]; then
  say "(simulasi ini meng-clone checkout lokal: $CORE_REPO @ $(echo "$CORE_REF" | cut -c1-12) — bukan salinan folder: git clone, jadi hanya yang sudah di-commit)"
else
  say "(klon sungguhan dari $CORE_REPO${CORE_BRANCH:+ @ $CORE_BRANCH})"
fi
if [ -n "$CORE_BRANCH" ]; then
  run "clone core gagal (branch $CORE_BRANCH ada di remote?)" git -c protocol.file.allow=always clone --quiet --branch "$CORE_BRANCH" "$CORE_REPO" core
else
  run 'clone core gagal' git -c protocol.file.allow=always clone --quiet "$CORE_REPO" core
  # A CORE_REF given by hand may be a commit, a tag, or a branch that only exists as a remote
  # branch in the fresh clone — try it as written, then as origin/<ref>.
  if [ -n "$CORE_REF" ] && ! git -C core checkout --quiet --detach "$CORE_REF" >"$LOG" 2>&1; then
    run "checkout ref core gagal: $CORE_REF" git -C core checkout --quiet --detach "origin/$CORE_REF"
  fi
fi
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
  # The helper lives in packages/db: that is where drizzle-orm and @core/db resolve, and where
  # the repo's own scripts read ../../.env from.
  cat >core/packages/db/.sim-db.ts <<'TS'
// Throwaway helper of the simulation: answer whether the database is reachable, and drop the
// tables the simulation created when it is over. Talks to the driver directly on purpose — a
// fresh clone has no generated schema yet, so @core/db cannot be imported this early.
const url = process.env.DATABASE_URL ?? '';
const [op, prefix = ''] = process.argv.slice(2);
const pg = url.startsWith('postgres');
const list = pg
  ? `select tablename as name from pg_tables where schemaname = 'public' and tablename like '${prefix}%'`
  : `select table_name as name from information_schema.tables where table_schema = database() and table_name like '${prefix}%'`;

if (pg) {
  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { max: 1 });
  if (op === 'probe') await sql`select 1`;
  else if (op === 'drop') {
    const rows = (await sql.unsafe(list)) as unknown as { name: string }[];
    for (const r of rows) await sql.unsafe(`DROP TABLE IF EXISTS "${r.name}" CASCADE`);
    console.log(String(rows.length));
  }
  await sql.end();
} else {
  const mysql = (await import('mysql2/promise')).default;
  const c = await mysql.createConnection(url);
  if (op === 'probe') await c.query('select 1');
  else if (op === 'drop') {
    const [rows] = await c.query(list);
    const names = (rows as { name: string }[]).map((r) => r.name);
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of names) await c.query(`DROP TABLE IF EXISTS \`${name}\``);
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(String(names.length));
  }
  await c.end();
}
if (op === 'probe') console.log('ok');
TS
  if (cd core/packages/db && bun --env-file=../../.env run .sim-db.ts probe) >"$LOG" 2>&1; then
    DB_OK=1
    ok "database menjawab — migrasi, seed dan tes integrasi ikut dijalankan"
    # A simulation that died half-way leaves its tables behind; start from a clean slate so the
    # next run is not blocked by its predecessor's CREATE TABLE.
    stale="$( (cd core/packages/db && bun --env-file=../../.env run .sim-db.ts drop "$PREFIX") 2>/dev/null | tail -1 || echo 0)"
    [ "${stale:-0}" -gt 0 ] 2>/dev/null && say "sisa simulasi sebelumnya dihapus: $stale tabel berawalan $PREFIX"
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
  dropped="$( (cd core/packages/db && bun --env-file=../../.env run .sim-db.ts drop "$PREFIX") 2>/dev/null | tail -1 || echo '?')"
  rm -f core/packages/db/.sim-db.ts
  say "tabel simulasi dihapus dari database: $dropped tabel berawalan $PREFIX"
}

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
if [ "$DB_OK" = 1 ]; then
  # In real life the author's core and the host are two different installations with two different
  # databases; here they share one, so empty it and let the host migrate from scratch.
  (cd core/packages/db && bun --env-file=../../.env run .sim-db.ts drop "$PREFIX") >/dev/null 2>&1 || true
  say "database dikosongkan (tabel $PREFIX*) — host berangkat sebagai instalasi baru"
fi
# Back to HEAD, all of it: the harness left the module copy, its entry in modules.json, its
# workspace in bun.lock and a generated migration behind. bun.lock matters most — a lockfile that
# still names a workspace no longer on disk makes `bun install` refuse outright (Bun 1.4.0).
# `git clean` without -x so the gitignored generated registries and node_modules stay put.
run 'reset core gagal' sh -c "cd '$WORK/core' && rm -rf 'modules/$NAME' && git checkout -- . && git clean -fdq -e .env -e packages/db/.sim-db.ts && bun install"
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
# .env and the throwaway database helper are the simulation's own files, not the module's trace.
LEFT="$(cd core && git status --porcelain --untracked-files=all | grep -vE '^\?\? (\.env|packages/db/\.sim-db\.ts)$' || true)"
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

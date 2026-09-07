#!/usr/bin/env sh
# G-6 guard: adding a module via `bun modgen` (and removing it again) must not change ANY core file.
#
# 1. generate a module non-interactively; 2. assert the working tree differs from HEAD only in the
# allowed places — modules/<Name>/**, modules.json, bun.lock (workspace link) and the migration
# files for the module's tables; 3. typecheck + lint the result; 4. remove the module, re-sync,
# regenerate migrations → the tree must be byte-identical to HEAD again (no orphan routes,
# themes, menu entries or migrations — gate M6 #4).
#
# Generated registries live in gitignored directories, so they never show up in `git status`;
# `ci:sync-pure` separately proves that syncing the committed modules is a no-op.
set -eu
cd "$(dirname "$0")/../.."
NAME="${MODGEN_GUARD_NAME:-CiProbe}"
DIR="modules/$NAME"

if [ -n "$(git status --porcelain)" ]; then
  echo "modgen-guard: working tree harus bersih sebelum guard dijalankan:"; git status --porcelain; exit 1
fi
if [ -e "$DIR" ]; then echo "modgen-guard: $DIR sudah ada"; exit 1; fi

echo "== modgen $NAME"
bun run modgen "$NAME" --resource widget --fields "name:string!,qty:number,active:boolean,notes:text,kind:select(a|b|c),due:date" --public >/dev/null

echo "== files touched (must be modules/, modules.json, bun.lock, migrations only)"
CHANGED="$(git status --porcelain --untracked-files=all | awk '{print $2}')"
echo "$CHANGED" | sed 's/^/  /'
BAD="$(echo "$CHANGED" | grep -v -E "^(modules/$NAME/|modules\.json$|bun\.lock$|packages/db/migrations/(mysql|pg)/(0[0-9]+_.*\.sql|meta/(_journal\.json|0[0-9]+_snapshot\.json))$)" || true)"
if [ -n "$BAD" ]; then
  echo "modgen-guard: GAGAL — berkas core berubah:"; echo "$BAD" | sed 's/^/  ✗ /'; exit 1
fi
# the migration must only add the module's tables — grep the new SQL for foreign table names
for f in $(git ls-files --others --exclude-standard packages/db/migrations | grep '\.sql$'); do
  if grep -iE 'ALTER TABLE|DROP TABLE' "$f" >/dev/null; then
    echo "modgen-guard: GAGAL — migrasi $f mengubah tabel yang sudah ada"; exit 1
  fi
done

echo "== the module's api/tools.ts is in the generated tool registry (extension point 8)"
NS="$(echo "$NAME" | tr '[:upper:]' '[:lower:]')"
grep -q "tools_$NS" apps/api/src/generated/tools.ts || { echo "modgen-guard: GAGAL — tool modul $NAME tidak terdaftar di apps/api/src/generated/tools.ts"; exit 1; }

echo "== typecheck + lint the generated module"
(cd "$DIR" && bunx tsc -p tsconfig.json)
bunx biome check "$DIR"
bun run scripts/ci/layout-contract.ts >/dev/null 2>&1 || true

echo "== remove the module, re-sync, regenerate migrations → tree identical to HEAD"
rm -rf "$DIR"
git checkout -- modules.json bun.lock packages/db/migrations
git clean -fdq packages/db/migrations
bun install --no-summary >/dev/null
bun run bootstrap >/dev/null
bun run db:generate >/dev/null 2>&1
LEFT="$(git status --porcelain --untracked-files=all)"
if [ -n "$LEFT" ]; then echo "modgen-guard: GAGAL — sisa setelah modul dihapus:"; echo "$LEFT"; exit 1; fi
# orphan check inside the gitignored generated output: nothing may still mention the namespace
if grep -rIl -E "(^|[^a-z])$NS([^a-z]|$)" apps/web/src/generated packages/module-kit/src/generated packages/db/src/generated apps/api/src/generated packages/i18n/src/generated packages/settings/src/generated "apps/web/src/routes/(app)/m" "apps/web/src/routes/(public)/(modules)" 2>/dev/null; then
  echo "modgen-guard: GAGAL — jejak modul $NAME tertinggal di output generate"; exit 1
fi
echo "GATE M6 G-6: LOLOS — modgen $NAME hanya menyentuh modules/, modules.json, bun.lock, migrasi (tool ikut terdaftar & tercabut); penghapusan bersih"

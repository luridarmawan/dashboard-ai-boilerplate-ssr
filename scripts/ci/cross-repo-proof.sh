#!/usr/bin/env sh
# M6 gate #2 / PRD §8 #13: a module born in ANOTHER repository works end to end.
#   1. `bun create module` → a standalone repo (template at .bun-create/module), renamed to Xrepo
#   2. its own harness builds, lints, typechecks and tests it against a clone of core — no core
#      checkout made by hand (§4.9 point 2). With DATABASE_URL the module's integration test runs.
#   3. the host installs it from a git URL pinned to a tag: `bun modules:add <url> --ref v0.1.0`
#      → tables, routes, menu, permissions, i18n assembled; only modules.json, .gitmodules,
#      biome.json (exclusion of foreign code), bun.lock, modules/Xrepo and migrations change (G-6)
#   4. uninstall → the tree is identical to HEAD again.
# Needs a committed tree (the harness clones HEAD) and network for `bun install` in the clone.
set -eu
cd "$(dirname "$0")/../.."
ROOT="$PWD"
NAME="${XREPO_NAME:-Xrepo}"
NS="$(echo "$NAME" | tr '[:upper:]' '[:lower:]')"
TMP="$(mktemp -d)"
REPO="$TMP/mod-$NS"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@example.test GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@example.test

if [ -n "$(git status --porcelain)" ]; then
  echo "cross-repo: working tree harus bersih (harness meng-clone HEAD):"; git status --porcelain; exit 1
fi

echo "== 1. bun create module → $REPO"
bun create module "$REPO" >/dev/null 2>&1 || bun create module "$REPO"
[ -f "$REPO/module.json" ] || { echo "cross-repo: template tidak tersalin"; exit 1; }
(cd "$REPO" && bun run rename "$NAME" && git init -q 2>/dev/null; git add -A && git commit -qm "init $NAME" && git tag v0.1.0)
[ "$(cd "$REPO" && git tag)" = "v0.1.0" ] || { echo "cross-repo: tag gagal"; exit 1; }

echo "== 2. harness in the module repo (clone core from file://$ROOT @ HEAD)"
(cd "$REPO" && CORE_REPO="file://$ROOT" CORE_REF="$(git -C "$ROOT" rev-parse HEAD)" bun run harness ${HARNESS_FLAGS:-} >"$TMP/harness.log" 2>&1) || { tail -60 "$TMP/harness.log"; echo "cross-repo: harness GAGAL"; exit 1; }
grep -q "harness: $NAME OK" "$TMP/harness.log" || { tail -30 "$TMP/harness.log"; exit 1; }
tail -2 "$TMP/harness.log"

echo "== 3. install into the host from the git URL, pinned to v0.1.0"
bun run modules:add "file://$REPO" --ref v0.1.0 >"$TMP/add.log" 2>&1 || { cat "$TMP/add.log"; exit 1; }
bun run db:generate >/dev/null 2>&1
(cd "modules/$NAME" && bunx tsc -p tsconfig.json)
bun run modules:sync >/dev/null
CHANGED="$(git status --porcelain --untracked-files=all | awk '{print $2}')"
echo "$CHANGED" | sed 's/^/  /'
BAD="$(echo "$CHANGED" | grep -v -E "^(modules/$NAME/?|modules\.json$|\.gitmodules$|biome\.json$|bun\.lock$|packages/db/migrations/(mysql|pg)/(0[0-9]+_.*\.sql|meta/(_journal\.json|0[0-9]+_snapshot\.json))$)" || true)"
[ -z "$BAD" ] || { echo "cross-repo: GAGAL — berkas core berubah:"; echo "$BAD" | sed 's/^/  ✗ /'; exit 1; }
grep -q "\"name\": \"$NAME\"" modules.json && grep -q "\"source\": \"submodule\"" modules.json || { echo "cross-repo: modules.json tidak mencatat submodule"; exit 1; }
grep -q "$NS" apps/api/src/generated/modules.ts && grep -q "${NS}_notes" packages/db/src/generated/module-tables.ts || { echo "cross-repo: registry tidak memuat $NS"; exit 1; }
ls "apps/web/src/routes/(app)/m/$NS/notes/+page.svelte" >/dev/null || { echo "cross-repo: shim halaman tidak dibuat"; exit 1; }
echo "  modul $NAME terpasang dari git, terkunci v0.1.0 — registry, tabel, shim halaman hadir"

echo "== 4. uninstall → tree identical to HEAD"
git submodule deinit -f -q "modules/$NAME"
git rm -f -q "modules/$NAME"
rm -rf ".git/modules/modules/$NAME" "modules/$NAME"
git checkout -- modules.json biome.json bun.lock packages/db/migrations 2>/dev/null || true
git ls-files --error-unmatch .gitmodules >/dev/null 2>&1 && git checkout -- .gitmodules || rm -f .gitmodules
git clean -fdq packages/db/migrations
bun install --no-summary >/dev/null
bun run modules:sync >/dev/null
LEFT="$(git status --porcelain --untracked-files=all)"
[ -z "$LEFT" ] || { echo "cross-repo: GAGAL — sisa setelah uninstall:"; echo "$LEFT"; exit 1; }
echo "GATE M6 #2: LOLOS — modul dari repositori terpisah dibangun & dites sendiri, dipasang lewat git URL, dicabut bersih"

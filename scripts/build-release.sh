#!/usr/bin/env sh
# Build the two production artefacts WITHOUT Docker (PRD Q-11, systemd mode) — the same steps the
# Dockerfile runs, into ./dist:
#   dist/api          one compiled executable (bun build --compile): `dist/api serve|migrate|seed|preflight|…`
#   dist/web/         adapter-node server bundled into index.js + client/ (+ prerendered/), run with `bun index.js`
#
#   DB_DIALECT=mysql sh scripts/build-release.sh
#   → copy dist/ to /opt/dab on the server (see deploy/systemd/ and DEPLOY.md §8c)
set -eu
cd "$(dirname "$0")/.."
export DB_DIALECT="${DB_DIALECT:-mysql}" NODE_ENV=production
export APP_COMMIT="${APP_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
export APP_BUILT_AT="${APP_BUILT_AT:-$(date -u +%FT%TZ)}"
OUT="${OUT:-dist}"

echo "== install + bootstrap (registri modul, skema $DB_DIALECT, migrasi tersemat)"
bun install --frozen-lockfile
bun run bootstrap
echo "== build web"
bun run --cwd apps/web build
rm -rf "$OUT" && mkdir -p "$OUT/web"
echo "== compile api → $OUT/api"
bun build --compile --minify-whitespace --minify-syntax apps/api/src/index.ts --outfile "$OUT/api"
echo "== bundle web → $OUT/web"
bun build --target=bun --minify-whitespace --minify-syntax apps/web/build/index.js --outfile "$OUT/web/index.js"
cp -r apps/web/build/client "$OUT/web/client"
[ ! -d apps/web/build/prerendered ] || cp -r apps/web/build/prerendered "$OUT/web/prerendered"
printf '%s\n' "$APP_COMMIT" > "$OUT/COMMIT"
echo "build-release: selesai — $(du -sh "$OUT/api" | cut -f1) api, $(du -sh "$OUT/web" | cut -f1) web (commit $APP_COMMIT, $DB_DIALECT)"

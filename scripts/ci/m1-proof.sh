#!/usr/bin/env sh
# Web proof runner (M1 gate #1/#2 at the web layer, M2 gates #1/#2/#3/#5/#6, M3 gates #1/#3): starts the API and the BUILT web app against an
# already-migrated + seeded database, runs scripts/m1-gate1-proof.ts, then stops both.
# Needs DATABASE_URL, DB_DIALECT, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD in the env.
set -eu
cd "$(dirname "$0")/../.."
export API_HOST=127.0.0.1 API_PORT=3001 API_URL=http://127.0.0.1:3001 SCHEDULER_ENABLED=false
export SIGNUP_ENABLED=true
LOG="$PWD/.proof-logs"; mkdir -p "$LOG"

echo "== build web (adapter-node)"
(cd apps/web && bun run build >"$LOG/m1-web-build.log" 2>&1) || { tail -30 "$LOG/m1-web-build.log"; exit 1; }

echo "== start api + web"
(cd apps/api && exec bun src/index.ts >"$LOG/m1-api.log" 2>&1) &
API_PID=$!
(cd apps/web && HOST=127.0.0.1 PORT=5173 ORIGIN=http://127.0.0.1:5173 exec bun build/index.js >"$LOG/m1-web.log" 2>&1) &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT

# Readiness via bun itself: the oven/bun image has no curl.
i=0
until bun -e 'const ok = async (u) => (await fetch(u)).ok; process.exit((await ok("http://127.0.0.1:3001/v1/ready")) && (await ok("http://127.0.0.1:5173/auth/login")) ? 0 : 1)' 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "api/web tidak siap"; tail -20 "$LOG/m1-api.log" "$LOG/m1-web.log"; exit 1; }
  sleep 1
done

echo "== proof M1"
WEB_URL=http://127.0.0.1:5173 bun run scripts/m1-gate1-proof.ts
echo "== proof M2"
WEB_URL=http://127.0.0.1:5173 ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" bun run scripts/m2-gate-proof.ts
echo "== proof M3"
WEB_URL=http://127.0.0.1:5173 ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" bun run scripts/m3-gate-proof.ts

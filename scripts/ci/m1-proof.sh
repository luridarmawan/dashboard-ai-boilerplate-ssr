#!/usr/bin/env sh
# Web proof runner (M1 gate #1/#2 at the web layer, M2 gates #1/#2/#3/#5/#6, M3 gates #1/#3): starts the API and the BUILT web app against an
# already-migrated + seeded database, runs scripts/m1-gate1-proof.ts, then stops both.
# Needs DATABASE_URL, DB_DIALECT, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD in the env.
set -eu
cd "$(dirname "$0")/../.."
export API_HOST=127.0.0.1 API_PORT=3001 API_URL=http://127.0.0.1:3001 SCHEDULER_ENABLED=false
export SIGNUP_ENABLED=true
# Every proof request comes from one IP; the login limit (A-2) is tested by the integration suite, not here.
export LOGIN_RATE_LIMIT=1000/900
LOG="$PWD/.proof-logs"; mkdir -p "$LOG"

echo "== build web (adapter-node)"
(cd apps/web && bunx svelte-kit sync >/dev/null 2>&1; bun run build >"$LOG/m1-web-build.log" 2>&1) || { tail -30 "$LOG/m1-web-build.log"; exit 1; }

echo "== start mock AI provider + api + web"
(PORT=4010 exec bun run scripts/ai-mock-provider.ts >"$LOG/m1-mock.log" 2>&1) &
MOCK_PID=$!
(cd apps/api && exec bun src/index.ts >"$LOG/m1-api.log" 2>&1) &
API_PID=$!
(cd apps/web && HOST=127.0.0.1 PORT=5173 ORIGIN=http://127.0.0.1:5173 exec bun build/index.js >"$LOG/m1-web.log" 2>&1) &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID $MOCK_PID 2>/dev/null || true' EXIT

# Readiness via bun itself: the oven/bun image has no curl.
i=0
until bun -e 'const ok = async (u) => (await fetch(u)).ok; process.exit((await ok("http://127.0.0.1:3001/v1/ready")) && (await ok("http://127.0.0.1:5173/auth/login")) ? 0 : 1)' 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "api/web tidak siap"; tail -20 "$LOG/m1-api.log" "$LOG/m1-web.log"; exit 1; }
  sleep 1
done

# PROOF_ONLY=M2,M6 limits the run to those proofs (local iteration); CI runs all of them.
wants() { [ -z "${PROOF_ONLY:-}" ] || echo ",$PROOF_ONLY," | grep -qi ",$1,"; }
export WEB_URL=http://127.0.0.1:5173 ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD"
if wants M1; then echo "== proof M1"; bun run scripts/m1-gate1-proof.ts; fi
if wants M2; then echo "== proof M2"; bun run scripts/m2-gate-proof.ts; fi
if wants M3; then echo "== proof M3"; bun run scripts/m3-gate-proof.ts; fi
if wants M4; then echo "== proof M4"; API_URL=http://127.0.0.1:3001 bun run scripts/m4-gate-proof.ts; fi
if wants M5; then echo "== proof M5"; MOCK_URL=http://127.0.0.1:4010/v1 bun run scripts/m5-gate-proof.ts; fi
if [ -d "modules/${MODGEN_GUARD_NAME:-CiProbe}" ] && wants M6; then
  echo "== proof M6 (modul hasil modgen: ${MODGEN_GUARD_NAME:-CiProbe})"
  API_URL=http://127.0.0.1:3001 API_LOG="$LOG/m1-api.log" MODULE_NS="$(echo "${MODGEN_GUARD_NAME:-CiProbe}" | tr '[:upper:]' '[:lower:]')" MODULE_PLURAL=widgets MODULE_RES=widget bun run scripts/m6-gate-proof.ts
elif wants M6; then
  echo "== proof M6 dilewati (tidak ada modules/${MODGEN_GUARD_NAME:-CiProbe} — jalankan: bun run modgen:ci)"
fi
if [ "${E2E:-}" = "1" ] && wants E2E; then
  echo "== E2E Playwright (P-8): landing → login → CRUD → chat, JavaScript aktif"
  (cd apps/web && bun x playwright test)
fi

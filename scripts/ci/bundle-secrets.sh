#!/usr/bin/env sh
# PRD §8 #6: no secret value reaches the client bundle. Build the web app with canary secrets in the
# environment, then grep every client-side artefact for the canaries and for secret-shaped strings.
# Server-only code (apps/web/build/server) may legitimately reference env NAMES; the client must not
# contain the VALUES.
set -eu
cd "$(dirname "$0")/../.."
CANARY="CANARY_$(date +%s)"
export DATABASE_URL="mysql://app:${CANARY}_DBPASS@127.0.0.1:3306/app"
export BOOTSTRAP_ADMIN_PASSWORD="${CANARY}_ADMINPASS"
export SMTP_PASSWORD="${CANARY}_SMTP"
export AI_API_KEY="sk-${CANARY}_AIKEY"
export MYSQL_PASSWORD="${CANARY}_MYSQL"
export SESSION_SECRET="${CANARY}_SESSION"
if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "== build web dengan rahasia kenari di lingkungan"
  (cd apps/web && bunx svelte-kit sync >/dev/null 2>&1 && bun run build >/dev/null 2>&1) || { echo "build web gagal"; exit 1; }
fi
CLIENT="apps/web/build/client"
[ -d "$CLIENT" ] || { echo "tidak ada $CLIENT"; exit 1; }
echo "== grep artefak klien ($(find "$CLIENT" -type f | wc -l) berkas)"
fail=0
for needle in "$CANARY" "mysql://" "postgres://" "DATABASE_URL" "BOOTSTRAP_ADMIN_PASSWORD" "SMTP_PASSWORD" "sk-[A-Za-z0-9_]\{12,\}"; do
  if grep -rIl -e "$needle" "$CLIENT" >/dev/null 2>&1; then
    echo "  ✗ '$needle' ditemukan di:"; grep -rIl -e "$needle" "$CLIENT" | sed 's/^/      /'; fail=1
  else
    echo "  ✓ tidak ada '$needle'"
  fi
done
# Server bundle: values must not be inlined at build time either (only read from process.env at runtime).
if grep -rIl -e "$CANARY" apps/web/build/server >/dev/null 2>&1; then
  echo "  ✗ nilai kenari ter-inline di bundle server:"; grep -rIl -e "$CANARY" apps/web/build/server | sed 's/^/      /'; fail=1
else
  echo "  ✓ bundle server tidak meng-inline nilai env"
fi
[ "$fail" = 0 ] || { echo "GATE §8 #6: GAGAL"; exit 1; }
echo "GATE §8 #6: LOLOS — tidak ada nilai rahasia di bundle klien"

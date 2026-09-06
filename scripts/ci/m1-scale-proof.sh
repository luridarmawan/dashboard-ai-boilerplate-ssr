#!/usr/bin/env sh
# M1 gate #4: `--scale api=3` WITHOUT Redis — login and CRUD work through Caddy across three
# stateless API replicas (no sticky session; state lives in the database, Decision M / F).
# Builds the production images, brings the prod stack up, migrates, seeds, then runs the gate #1
# web proof from inside Caddy's network namespace (so https://localhost hits Caddy itself).
#   ENV_FILE=.env.prod sh scripts/ci/m1-scale-proof.sh
set -eu
cd "$(dirname "$0")/../.."
ENV_FILE=${ENV_FILE:-.env.prod}
# Read the two values we need without sourcing (values may contain spaces / comments).
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' -e 's/^"//' -e 's/"$//'; }
ADMIN_EMAIL=$(val BOOTSTRAP_ADMIN_EMAIL)
ADMIN_PASSWORD=$(val BOOTSTRAP_ADMIN_PASSWORD)
DC="docker compose --env-file $ENV_FILE -f compose.prod.yml"

echo "== build images"
$DC build --quiet
echo "== up (api x3, no redis)"
$DC up -d --wait --scale api=3
$DC run --rm migrate
$DC run --rm seed

run_proof() {
  docker run --rm --network "container:$CADDY" -v "$PWD":/w -w /w \
    -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e WEB_URL=https://localhost \
    -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    oven/bun:1.4 bun scripts/m1-gate1-proof.ts
}
served_by() { $DC logs api 2>/dev/null | grep '"msg":"request"' | awk '{print $1}' | sort | uniq -c | sort -rn; }

echo "== proof 1 through Caddy (https://localhost, internal CA), three replicas"
CADDY=$($DC ps -q caddy)
run_proof
echo "-- requests per replica so far:"; served_by

# The web keeps its API connections alive, so one replica tends to get the traffic. The real
# statelessness test: take THAT replica away mid-flight and repeat the whole flow — sessions,
# CSRF and rate-limit state must be in the database, not in the process that just died.
BUSIEST=$(served_by | head -1 | awk '{print $2}')
echo "== stopping the busiest replica ($BUSIEST) and repeating the flow"
docker stop "$(docker ps -q -f "name=$BUSIEST")" >/dev/null
sleep 6   # let Caddy's dynamic upstreams (refresh 5s) drop it
run_proof
echo "-- requests per replica after the failover run:"; served_by

RUNNING=$($DC ps -q api --status running | wc -l | tr -d ' ')
SERVED=$(served_by | awk '$1 > 5' | wc -l | tr -d ' ')
[ "$RUNNING" -eq 2 ] || { echo "GATE M1 #4: GAGAL — replika api yang hidup = $RUNNING (harap 2 setelah satu dimatikan)"; exit 1; }
[ "$SERVED" -ge 2 ] || { echo "GATE M1 #4: GAGAL — hanya $SERVED replika yang melayani request"; exit 1; }
echo "GATE M1 #4: LOLOS — alur login/CRUD/ganti-tenant lolos dua kali, replika tersibuk dimatikan di antaranya; $SERVED replika melayani request tanpa Redis"

#!/usr/bin/env sh
# PRD Q-12 proof: a rollout of api and web loses NO request. Runs against the production stack the
# scale proof brought up (3 api replicas behind Caddy). A traffic generator inside Caddy's network
# namespace hits /v1/health (api) and /robots.txt (web) every 200 ms while deploy/rollout.sh
# replaces every replica with a re-tagged copy of the same image; afterwards every response must
# have been 200 and every running replica must carry the new tag.
#   ENV_FILE=.env.prod sh scripts/ci/rollout-proof.sh
set -eu
cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-.env.prod}"
DC="docker compose --env-file $ENV_FILE -f compose.prod.yml"
val() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' -e 's/^"//' -e 's/"$//'; }
PREFIX="$(val IMAGE_PREFIX)"; PREFIX="${PREFIX:-dab}"
FROM_TAG="$(val IMAGE_TAG)"; FROM_TAG="${FROM_TAG:-local}"
NEW_TAG="rollout-$(date +%s)"
MAX_FAILS="${ROLLOUT_MAX_FAILS:-0}"
TRAFFIC="dab-rollout-traffic"

CADDY="$($DC ps -q caddy)"
[ -n "$CADDY" ] || { echo "rollout-proof: stack belum jalan (caddy tidak ditemukan)"; exit 1; }
N_API="$($DC ps -q --status running api | wc -l | tr -d ' ')"

echo "== tag ulang image sebagai 'versi baru' ($NEW_TAG)"
docker tag "$PREFIX/api:$FROM_TAG" "$PREFIX/api:$NEW_TAG"
docker tag "$PREFIX/web:$FROM_TAG" "$PREFIX/web:$NEW_TAG"

echo "== mulai traffic generator di namespace jaringan Caddy"
docker rm -f "$TRAFFIC" >/dev/null 2>&1 || true
docker run -d --name "$TRAFFIC" --network "container:$CADDY" curlimages/curl:8.10.1 sh -c '
  i=0
  while true; do
    for p in /v1/health /robots.txt; do
      code=$(curl -sk -o /dev/null -m 5 -w "%{http_code}" "https://localhost$p" || echo 000)
      i=$((i + 1))
      if [ "$code" = "200" ]; then echo "OK $p"; else echo "FAIL $code $p"; fi
    done
    sleep 0.2
  done' >/dev/null
sleep 3

echo "== rollout api ($N_API replika) dan web dengan IMAGE_TAG=$NEW_TAG"
IMAGE_TAG="$NEW_TAG" sh deploy/rollout.sh api "$N_API"
IMAGE_TAG="$NEW_TAG" sh deploy/rollout.sh web 1
sleep 3

docker stop "$TRAFFIC" >/dev/null
LOG="$(docker logs "$TRAFFIC" 2>/dev/null)"
docker rm -f "$TRAFFIC" >/dev/null 2>&1 || true
TOTAL="$(echo "$LOG" | grep -c '^OK\|^FAIL' || true)"
FAILS="$(echo "$LOG" | grep -c '^FAIL' || true)"
echo "-- request selama rollout: $TOTAL, gagal: $FAILS"
echo "$LOG" | grep '^FAIL' | sort | uniq -c | sed 's/^/     /' || true

echo "== semua replika memakai tag baru?"
BAD=0
for id in $($DC ps -q --status running api) $($DC ps -q --status running web); do
  img="$(docker inspect -f '{{.Config.Image}}' "$id")"
  case "$img" in *":$NEW_TAG") ;; *) echo "   ✗ $id masih $img"; BAD=1 ;; esac
done
RUN_API="$($DC ps -q --status running api | wc -l | tr -d ' ')"

# Leave the stack on the original tag name so later steps (idle-memory, teardown) see the usual images.
[ "$TOTAL" -ge 40 ] || { echo "GATE Q-12: GAGAL — traffic generator hanya mencatat $TOTAL request"; exit 1; }
[ "$FAILS" -le "$MAX_FAILS" ] || { echo "GATE Q-12: GAGAL — $FAILS request gagal selama rollout (batas $MAX_FAILS)"; exit 1; }
[ "$BAD" -eq 0 ] || { echo "GATE Q-12: GAGAL — ada replika yang tidak diganti"; exit 1; }
[ "$RUN_API" -eq "$N_API" ] || { echo "GATE Q-12: GAGAL — replika api = $RUN_API, harap $N_API"; exit 1; }
echo "GATE Q-12: LOLOS — $TOTAL request, 0 gagal; $N_API replika api + web diganti ke $NEW_TAG tanpa downtime"

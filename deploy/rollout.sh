#!/usr/bin/env sh
# Zero-downtime rollout of ONE stateless service on a single host (PRD Q-12).
#
#   sh deploy/rollout.sh api 3        # api → 3 replicas of the image compose currently resolves
#   sh deploy/rollout.sh web          # web → same replica count as now
#
# How: new replicas of the CURRENT image tag are started NEXT TO the old ones (`--no-recreate`
# leaves the old containers untouched), each must report `healthy` (the image HEALTHCHECK), Caddy is
# given time to see them (dynamic upstreams, refresh 5s), then the old replicas are stopped one by
# one with SIGTERM and a grace period so in-flight requests finish. Caddy retries a request whose
# upstream just vanished on another replica (lb_try_duration), so the client never sees it.
#
# Requires: the image tag to deploy already built and selected (IMAGE_TAG in the environment or in
# .env.prod), migrations applied, `preflight` green — deploy/upgrade.sh does all of that in order.
set -eu
cd "$(dirname "$0")/.."
SVC="${1:?pemakaian: rollout.sh <api|web> [replika]}"
ENV_FILE="${ENV_FILE:-.env.prod}"
DC="docker compose --env-file $ENV_FILE -f compose.prod.yml"
GRACE="${ROLLOUT_GRACE:-20}"
SETTLE="${ROLLOUT_SETTLE:-7}"

running() { $DC ps -q --status running "$SVC"; }
# The image compose resolves for this service right now (IMAGE_TAG from the environment or .env.prod).
wanted_image() { $DC config --images 2>/dev/null | grep -E "/${SVC}:" | head -1; }
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo gone; }
image_of() { docker inspect -f '{{.Config.Image}}' "$1" 2>/dev/null; }

OLD="$(running | tr '\n' ' ')"
N_OLD="$(echo "$OLD" | wc -w | tr -d ' ')"
N="${2:-$N_OLD}"
[ "$N" -ge 1 ] 2>/dev/null || N=1

if [ "$N_OLD" -eq 0 ]; then
  echo "rollout $SVC: belum ada replika yang berjalan — start biasa dengan $N replika"
  $DC up -d --no-deps --wait --scale "$SVC=$N" "$SVC"
  exit 0
fi

WANT="$(wanted_image)"
echo "== rollout $SVC: $N_OLD replika lama ($(image_of "$(echo "$OLD" | awk '{print $1}')")) → $N replika baru ($WANT) berdampingan"
# A stopped replica of the OLD version (crash, manual stop) would be restarted by `up` and counted as
# new — remove exited containers of this service first so every new one is created from $WANT.
$DC rm -f "$SVC" >/dev/null 2>&1 || true
$DC up -d --no-deps --no-recreate --scale "$SVC=$((N_OLD + N))" "$SVC"

NEW=""
for id in $($DC ps -q "$SVC"); do
  case " $OLD " in *" $id "*) ;; *) NEW="$NEW $id" ;; esac
done
[ -n "$(echo "$NEW" | tr -d ' ')" ] || { echo "rollout $SVC: GAGAL — tidak ada replika baru yang dibuat"; exit 1; }
if [ -n "$WANT" ]; then
  for id in $NEW; do
    if [ "$(image_of "$id")" != "$WANT" ]; then
      echo "rollout $SVC: GAGAL — replika $id memakai $(image_of "$id"), bukan $WANT; replika lama tetap melayani"
      docker rm -f $NEW >/dev/null 2>&1 || true
      exit 1
    fi
  done
fi

echo "== menunggu replika baru sehat"
for id in $NEW; do
  i=0
  while [ "$(health "$id")" != "healthy" ]; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      echo "rollout $SVC: GAGAL — $id tidak sehat setelah 180 dtk ($(health "$id")). Replika lama tetap melayani; log:"
      docker logs --tail 60 "$id" 2>&1 | sed 's/^/    /'
      docker rm -f $NEW >/dev/null 2>&1 || true
      exit 1
    fi
    sleep 2
  done
  echo "   ✓ $id sehat ($(image_of "$id"))"
done

echo "== memberi Caddy waktu menemukan upstream baru (${SETTLE}s)"
sleep "$SETTLE"

for id in $OLD; do
  echo "-- mematikan replika lama $id (SIGTERM, grace ${GRACE}s)"
  docker stop -t "$GRACE" "$id" >/dev/null
  docker rm "$id" >/dev/null
  sleep 2
done

# Normalise the desired count without touching the new containers.
$DC up -d --no-deps --no-recreate --scale "$SVC=$N" "$SVC" >/dev/null
echo "rollout $SVC: selesai — $(running | wc -l | tr -d ' ') replika berjalan, image $(image_of "$(running | head -1)")"

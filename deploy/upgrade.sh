#!/usr/bin/env sh
# Upgrade the single-VPS stack to the checked-out version WITHOUT downtime (PRD Q-12, Q-13).
#
#   sh deploy/upgrade.sh              # git pull, build, backup, migrate, seed, preflight, rollout api + web
#   sh deploy/upgrade.sh --no-pull    # same, from the code already checked out
#   API_REPLICAS=5 sh deploy/upgrade.sh
#
# Order matters: the database is backed up first; migrations run BEFORE the new code (so they must
# be additive — expand now, contract in a later release, see DEPLOY.md §8); preflight refuses to
# continue on a half-configured host; then api and web are rolled one service at a time
# (deploy/rollout.sh). The deployed tag is written back to .env.prod so a later plain `dc up -d`
# keeps this version instead of silently recreating the old one.
set -eu
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.prod}"
[ -f "$ENV_FILE" ] || { echo "upgrade: $ENV_FILE tidak ada (cp .env.prod.example .env.prod)"; exit 1; }
DC="docker compose --env-file $ENV_FILE -f compose.prod.yml"

if [ "${1:-}" != "--no-pull" ]; then
  echo "== git pull"
  git pull --ff-only --recurse-submodules
fi

COMMIT="$(git rev-parse --short HEAD)"
export APP_COMMIT="$COMMIT"
export APP_BUILT_AT="$(date -u +%FT%TZ)"
export IMAGE_TAG="${IMAGE_TAG:-$COMMIT}"
API_REPLICAS="${API_REPLICAS:-$($DC ps -q --status running api 2>/dev/null | wc -l | tr -d ' ')}"
[ "$API_REPLICAS" -ge 1 ] 2>/dev/null || API_REPLICAS=3

echo "== build image $IMAGE_TAG (commit $COMMIT)"
$DC build --quiet

echo "== backup sebelum menyentuh database (Q-8)"
$DC run --rm backup-once

echo "== migrate — migrasi harus aditif: kode lama masih berjalan di atasnya sampai rollout selesai"
$DC run --rm migrate

echo "== seed (idempoten)"
$DC run --rm seed

echo "== preflight (Q-13)"
$DC run --rm preflight

echo "== rollout api ($API_REPLICAS replika) lalu web"
sh deploy/rollout.sh api "$API_REPLICAS"
sh deploy/rollout.sh web 1

if grep -q '^IMAGE_TAG=' "$ENV_FILE"; then
  sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
  printf '\nIMAGE_TAG=%s\n' "$IMAGE_TAG" >> "$ENV_FILE"
fi
echo "== IMAGE_TAG=$IMAGE_TAG ditulis ke $ENV_FILE"

echo "== bersihkan image lama yang tidak dipakai"
docker image prune -f >/dev/null 2>&1 || true

$DC ps
echo "upgrade: selesai — versi $COMMIT berjalan; cek https://\$DOMAIN/v1/version"

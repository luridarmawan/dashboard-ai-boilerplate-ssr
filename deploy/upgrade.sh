#!/usr/bin/env sh
# Upgrade the single-VPS stack to the checked-out version WITHOUT downtime (PRD Q-12, Q-13).
#
#   sh deploy/upgrade.sh              # git pull, build, backup, migrate, seed, preflight, rollout api + web
#   sh deploy/upgrade.sh --no-pull    # same, from the code already checked out
#   sh deploy/upgrade.sh --pull <tag> # CD mode (Q-15): no build — pull IMAGE_PREFIX/{api,web}:<tag> from a
#                                     # registry (IMAGE_PREFIX from the environment or .env.prod), then the
#                                     # same backup → migrate → seed → preflight → rollout
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

MODE="build"
case "${1:-}" in
  --no-pull) ;;
  --pull)
    MODE="pull"
    [ -n "${2:-}" ] || { echo "upgrade: --pull membutuhkan tag image, mis. sh deploy/upgrade.sh --pull $(git rev-parse --short HEAD)"; exit 1; }
    export IMAGE_TAG="$2"
    # The registry prefix (ghcr.io/<owner>/<repo>) comes from the environment or .env.prod.
    export IMAGE_PREFIX="${IMAGE_PREFIX:-$(grep '^IMAGE_PREFIX=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' )}"
    [ -n "$IMAGE_PREFIX" ] || { echo "upgrade: IMAGE_PREFIX kosong — isi di $ENV_FILE (mis. ghcr.io/owner/repo) atau lewat environment"; exit 1; }
    ;;
  '') echo "== git pull"; git pull --ff-only --recurse-submodules ;;
  *) echo "upgrade: opsi tidak dikenal: $1"; exit 1 ;;
esac

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export APP_COMMIT="$COMMIT"
export APP_BUILT_AT="$(date -u +%FT%TZ)"
export IMAGE_TAG="${IMAGE_TAG:-$COMMIT}"
API_REPLICAS="${API_REPLICAS:-$($DC ps -q --status running api 2>/dev/null | wc -l | tr -d ' ')}"
[ "$API_REPLICAS" -ge 1 ] 2>/dev/null || API_REPLICAS=3

if [ "$MODE" = "pull" ]; then
  echo "== pull image $IMAGE_PREFIX/{api,web}:$IMAGE_TAG"
  $DC pull --quiet api web
else
  echo "== build image $IMAGE_TAG (commit $COMMIT)"
  $DC build --quiet
fi

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

persist() { # persist KEY VALUE → .env.prod, so a later plain `dc up -d` keeps this version
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i.bak "s|^$1=.*|$1=$2|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '\n%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
persist IMAGE_TAG "$IMAGE_TAG"
[ "$MODE" = "pull" ] && persist IMAGE_PREFIX "$IMAGE_PREFIX"
echo "== IMAGE_TAG=$IMAGE_TAG${IMAGE_PREFIX:+ IMAGE_PREFIX=$IMAGE_PREFIX} ditulis ke $ENV_FILE"

echo "== bersihkan image lama yang tidak dipakai"
docker image prune -f >/dev/null 2>&1 || true

$DC ps
echo "upgrade: selesai — versi $COMMIT berjalan; cek https://\$DOMAIN/v1/version"

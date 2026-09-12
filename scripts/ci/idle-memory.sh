#!/usr/bin/env sh
# PRD §8 #25: the whole stack must idle under 1.5 GB RAM on a 2 vCPU / 4 GB VPS. Sums the memory of
# every container of a compose project (default: the production stack, crk-prod) and fails above
# the budget. Run after the stack has settled (CI: right after the scale proof, 3 api replicas).
#
#   sh scripts/ci/idle-memory.sh            # project crk-prod, budget 1500 MB
#   PROJECT=crk-prod BUDGET_MB=1500 SETTLE_SECONDS=30 sh scripts/ci/idle-memory.sh
set -eu
PROJECT="${PROJECT:-crk-prod}"
BUDGET_MB="${BUDGET_MB:-1500}"
sleep "${SETTLE_SECONDS:-15}"
ids="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")"
[ -n "$ids" ] || { echo "idle-memory: tidak ada container proyek $PROJECT"; exit 1; }
# MemUsage looks like "123.4MiB / 3.8GiB"; normalise to MB
total=0
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' $ids | while read -r name used _ _; do
  num="$(echo "$used" | sed 's/[A-Za-z]*$//')"
  unit="$(echo "$used" | sed 's/^[0-9.]*//')"
  # awk instead of bc: present on every base image and stock VPS
  case "$unit" in
    GiB) mb="$(awk -v n="$num" 'BEGIN { printf "%.1f", n * 1024 }')" ;;
    MiB) mb="$num" ;;
    KiB) mb="$(awk -v n="$num" 'BEGIN { printf "%.3f", n / 1024 }')" ;;
    B) mb=0 ;;
    *) mb="$num" ;;
  esac
  printf '  %-28s %8.1f MB\n' "$name" "$mb"
  echo "$mb" >> /tmp/idle-memory.$$
done
total="$(awk '{s+=$1} END {printf "%.0f", s}' /tmp/idle-memory.$$)"; rm -f /tmp/idle-memory.$$
echo "  total: $total MB (anggaran $BUDGET_MB MB, §8 #25)"
[ "$total" -lt "$BUDGET_MB" ] || { echo "idle-memory: GAGAL — di atas anggaran"; exit 1; }
echo "GATE §8 #25 (runner CI): LOLOS — $total MB < $BUDGET_MB MB"

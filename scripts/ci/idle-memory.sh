#!/usr/bin/env sh
# PRD §8 #25: the whole stack must idle under 1.5 GB RAM on a 2 vCPU / 4 GB VPS. Sums the memory of
# every container of a compose project (default: the production stack, dab-prod) and fails above
# the budget. Run after the stack has settled (CI: right after the scale proof, 3 api replicas).
#
#   sh scripts/ci/idle-memory.sh            # project dab-prod, budget 1500 MB
#   PROJECT=dab-prod BUDGET_MB=1500 SETTLE_SECONDS=30 sh scripts/ci/idle-memory.sh
set -eu
PROJECT="${PROJECT:-dab-prod}"
BUDGET_MB="${BUDGET_MB:-1500}"
sleep "${SETTLE_SECONDS:-15}"
ids="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")"
[ -n "$ids" ] || { echo "idle-memory: tidak ada container proyek $PROJECT"; exit 1; }
# MemUsage looks like "123.4MiB / 3.8GiB"; normalise to MB
total=0
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' $ids | while read -r name used _ _; do
  num="$(echo "$used" | sed 's/[A-Za-z]*$//')"
  unit="$(echo "$used" | sed 's/^[0-9.]*//')"
  case "$unit" in
    GiB) mb="$(echo "$num * 1024" | bc)" ;;
    MiB) mb="$num" ;;
    KiB) mb="$(echo "$num / 1024" | bc -l)" ;;
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

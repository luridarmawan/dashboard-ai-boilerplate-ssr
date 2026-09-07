#!/usr/bin/env sh
# Scheduled backups inside the compose stack (Q-8): dump now, then every BACKUP_INTERVAL_SECONDS.
# `restart: unless-stopped` keeps it alive across crashes and reboots like every other service.
set -eu
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
while :; do
  sh "$(dirname "$0")/backup.sh" || echo "backup: GAGAL pada $(date -u +%FT%TZ) — dicoba lagi dalam $interval detik" >&2
  sleep "$interval"
done

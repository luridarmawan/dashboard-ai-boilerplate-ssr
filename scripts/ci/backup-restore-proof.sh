#!/usr/bin/env sh
# PRD §8 #24: backup taken → database dropped → restore → the application is whole again. Run, not assumed.
#
# Two ways to reach the database:
#   PROOF_MODE=native  (CI)   mysql/mysqldump on this machine, bun on this machine
#   PROOF_MODE=docker  (dev)  the compose `mysql` service; clients run in a mysql:8 container on the
#                             compose network, bun steps in oven/bun — nothing installed on the host
# Needs an already migrated + seeded database and BOOTSTRAP_ADMIN_EMAIL/PASSWORD for the app check.
set -eu
cd "$(dirname "$0")/../.."
MODE="${PROOF_MODE:-native}"
CODE="bkp-$(date +%s)"
if [ "$MODE" = "docker" ]; then
  NET="${PROOF_NETWORK:-dashboard-ai-boilerplate_default}"
  export DATABASE_URL="${DATABASE_URL:-mysql://app:app@mysql:3306/app}"
  BACKUP_DIR="/w/.proof-logs/backups"
  DBC="docker run --rm --network $NET --user $(id -u):$(id -g) -v $PWD:/w -w /w -e DATABASE_URL -e DB_DIALECT=${DB_DIALECT:-mysql} -e BACKUP_DIR=$BACKUP_DIR -e BACKUP_KEEP_DAYS=1 -e CONFIRM_RESTORE=yes mysql:8"
  APP="docker run --rm --network $NET --user $(id -u):$(id -g) -e HOME=/tmp -v $PWD:/w -w /w -e DATABASE_URL -e DB_DIALECT=${DB_DIALECT:-mysql} -e SCHEDULER_ENABLED=false -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD oven/bun:1.4"
else
  : "${DATABASE_URL:?DATABASE_URL wajib}"
  BACKUP_DIR="${BACKUP_DIR:-$PWD/.proof-logs/backups}"
  export BACKUP_DIR BACKUP_KEEP_DAYS=1 CONFIRM_RESTORE=yes
  DBC=""
  APP="env SCHEDULER_ENABLED=false"
fi
mkdir -p .proof-logs/backups
export BOOTSTRAP_ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@example.test}" BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-bootstrap admin password}"

echo "== 1. marker tenant $CODE"
$APP bun run scripts/backup-marker.ts write "$CODE"
echo "== 2. backup"
$DBC sh deploy/backup.sh
FILE="$(ls -1t .proof-logs/backups/app-*.sql.gz | head -1)"
[ -s "$FILE" ] || { echo "backup kosong"; exit 1; }
gunzip -c "$FILE" | grep -q "CREATE TABLE" || { echo "dump tidak berisi DDL"; exit 1; }
echo "  $FILE ($(du -h "$FILE" | cut -f1))"
echo "== 3. destroy: DROP DATABASE"
$DBC sh -c '. deploy/db-env.sh; mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -e "DROP DATABASE \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\`;"'
if $APP bun run scripts/backup-marker.ts check "$CODE" >/dev/null 2>&1; then echo "database seharusnya kosong"; exit 1; fi
echo "  database kosong — penanda hilang, seperti seharusnya"
echo "== 4. restore without confirmation is refused"
if $DBC sh -c 'CONFIRM_RESTORE= sh deploy/restore.sh latest' >/dev/null 2>&1; then echo "restore tanpa CONFIRM_RESTORE seharusnya ditolak"; exit 1; fi
echo "== 5. restore latest"
$DBC sh -c 'CONFIRM_RESTORE=yes sh deploy/restore.sh latest'
echo "== 6. the application is whole again (login, /v1/me, tenant list incl. marker)"
$APP bun run scripts/backup-marker.ts verify "$CODE"
echo "GATE §8 #24: LOLOS — backup → hapus database → restore → aplikasi utuh"

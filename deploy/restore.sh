#!/usr/bin/env sh
# Database restore (PRD O-7, Q-8) — DESTRUCTIVE: the target database is emptied first, then the
# dump is replayed. Requires an explicit confirmation so it can never run by accident.
#
#   docker compose --env-file .env.prod -f compose.prod.yml run --rm restore latest      # or a file name
#   CONFIRM_RESTORE=yes DATABASE_URL=… BACKUP_DIR=./backups sh deploy/restore.sh app-mysql-20260907T000000Z.sql.gz
#
# Stop the app first (`docker compose … stop api web`) unless you accept a few failed requests
# while tables are missing; migrations are part of the dump, so no `migrate` is needed afterwards.
set -eu
. "$(dirname "$0")/db-env.sh"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
target="${1:-latest}"
case "$target" in
  latest) file="$BACKUP_DIR/latest.sql.gz" ;;
  /*) file="$target" ;;
  *) file="$BACKUP_DIR/$target" ;;
esac
[ -f "$file" ] || { echo "restore: berkas tidak ada: $file" >&2; ls -1 "$BACKUP_DIR" 2>/dev/null >&2; exit 1; }
if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "restore: ini MENGHAPUS isi database '$DB_NAME' di $DB_HOST lalu memuat $(basename "$file")." >&2
  echo "restore: jalankan lagi dengan CONFIRM_RESTORE=yes bila yakin." >&2
  exit 3
fi
gzip -t "$file"
case "$DB_DIALECT" in
  mysql|mariadb)
    mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    gunzip -c "$file" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" ;;
  postgres)
    # The dump was taken with --clean --if-exists, so objects are dropped before being recreated.
    gunzip -c "$file" | psql -q -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" >/dev/null ;;
esac
echo "restore: $(basename "$file") dimuat ke $DB_NAME@$DB_HOST"

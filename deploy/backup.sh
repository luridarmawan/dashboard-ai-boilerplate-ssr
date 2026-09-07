#!/usr/bin/env sh
# Database backup (PRD O-7, Q-8): one compressed logical dump per run into BACKUP_DIR, then prune
# dumps older than BACKUP_KEEP_DAYS. Works for MySQL/MariaDB (mysqldump) and PostgreSQL (pg_dump).
#
#   docker compose --env-file .env.prod -f compose.prod.yml run --rm backup-once
#   DATABASE_URL=mysql://app:pw@127.0.0.1:3306/app BACKUP_DIR=./backups sh deploy/backup.sh
#
# Output: $BACKUP_DIR/app-<dialect>-<UTC timestamp>.sql.gz and a `latest.sql.gz` symlink.
set -eu
. "$(dirname "$0")/db-env.sh"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/app-$DB_DIALECT-$stamp.sql.gz"
tmp="$file.part"
case "$DB_DIALECT" in
  mysql|mariadb)
    # --single-transaction: consistent InnoDB snapshot without locking the app out.
    mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" --single-transaction --quick --routines --triggers \
      --set-gtid-purged=OFF --no-tablespaces "$DB_NAME" | gzip -6 > "$tmp" ;;
  postgres)
    pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --no-owner --no-privileges --clean --if-exists "$DB_NAME" | gzip -6 > "$tmp" ;;
esac
mv "$tmp" "$file"
ln -sfn "$(basename "$file")" "$BACKUP_DIR/latest.sql.gz"
# Retention: keep BACKUP_KEEP_DAYS days of dumps (never the symlink, never partial files of a running dump).
find "$BACKUP_DIR" -name "app-*.sql.gz" -type f -mtime +"$BACKUP_KEEP_DAYS" -delete 2>/dev/null || true
size="$(du -h "$file" | cut -f1)"
echo "backup: $file ($size), retensi $BACKUP_KEEP_DAYS hari, $(find "$BACKUP_DIR" -name 'app-*.sql.gz' -type f | wc -l) berkas tersimpan"

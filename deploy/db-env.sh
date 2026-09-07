#!/usr/bin/env sh
# Shared by backup.sh / restore.sh: derive DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME from
# DATABASE_URL (mysql://user:pass@host:port/db or postgres://…). DB_DIALECT decides the tools.
# Passwords reach the client through MYSQL_PWD / PGPASSWORD, never on the command line (ps-safe).
set -eu
: "${DATABASE_URL:?DATABASE_URL wajib diisi}"
DB_DIALECT="${DB_DIALECT:-mysql}"
url_no_scheme="${DATABASE_URL#*://}"
creds="${url_no_scheme%%@*}"
hostpart="${url_no_scheme#*@}"
DB_USER="${creds%%:*}"
DB_PASS="${creds#*:}"; [ "$DB_PASS" = "$creds" ] && DB_PASS=""
hostport="${hostpart%%/*}"
DB_NAME="${hostpart#*/}"; DB_NAME="${DB_NAME%%\?*}"
DB_HOST="${hostport%%:*}"
DB_PORT="${hostport#*:}"; [ "$DB_PORT" = "$hostport" ] && DB_PORT=""
case "$DB_DIALECT" in
  mysql|mariadb) DB_PORT="${DB_PORT:-3306}"; export MYSQL_PWD="$DB_PASS" ;;
  postgres) DB_PORT="${DB_PORT:-5432}"; export PGPASSWORD="$DB_PASS" ;;
  *) echo "DB_DIALECT tidak dikenal: $DB_DIALECT" >&2; exit 2 ;;
esac
# URL-decoded password is out of scope: keep passwords URL-safe (documented in .env.prod.example).
export DB_DIALECT DB_HOST DB_PORT DB_USER DB_NAME

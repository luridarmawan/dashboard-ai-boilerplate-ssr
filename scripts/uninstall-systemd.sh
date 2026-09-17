#!/usr/bin/env bash
# Copot checkout ini dari systemd user service — kebalikan scripts/install-systemd.sh.
# Aplikasinya berhenti, unitnya dihapus; checkout, database, dan berkas env tidak disentuh.
#
#   bun run systemd:uninstall
#   SERVICE_NAME=staging bun run systemd:uninstall   # nama unit selain baku 'crk'
#
# Sesudah ini jalankan aplikasinya manual lagi dengan `bun run start` (DEPLOY.md §8e).
set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opsi tidak dikenal: $arg (lihat --help)" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

SERVICE_NAME="${SERVICE_NAME:-crk}"
UNIT_FILE="$HOME/.config/systemd/user/$SERVICE_NAME.service"

# Nama unit masuk ke nama berkas dan ke argumen systemctl.
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] ||
  die "SERVICE_NAME='$SERVICE_NAME' tidak sah — pakai huruf, angka, '-', '_', '.', '@'."

if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  echo "ERROR: tidak ada session systemd --user (XDG_RUNTIME_DIR kosong)." >&2
  echo "  Masuk sebagai user ini (ssh/login, bukan 'su') lalu ulangi." >&2
  exit 1
fi

# Unit yang tidak ada bukan galat: perintah ini harus aman diulang.
systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true

# Dibaca sebelum unitnya hilang: berkas lognya sengaja TIDAK dihapus — biasanya justru
# itu yang dicari sesudah sebuah service dicopot.
LOG_PATH="$(sed -n 's|^StandardOutput=append:||p' "$UNIT_FILE" 2>/dev/null | head -1)"

if [[ -f "$UNIT_FILE" ]]; then
  rm "$UNIT_FILE"
  echo "Unit $UNIT_FILE dihapus."
else
  echo "Unit $UNIT_FILE tidak ada, dilewati."
fi

systemctl --user daemon-reload
systemctl --user reset-failed "$SERVICE_NAME" 2>/dev/null || true

echo "OK — service '$SERVICE_NAME' sudah dicopot. Aplikasi tidak lagi berjalan otomatis;"
echo "jalankan manual dengan 'bun run start' bila perlu."
[[ -z "$LOG_PATH" || ! -f "$LOG_PATH" ]] || echo "Log lama dibiarkan di $LOG_PATH (hapus sendiri bila tidak perlu)."

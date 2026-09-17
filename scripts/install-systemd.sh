#!/usr/bin/env bash
# Pasang checkout ini sebagai systemd *user* service, supaya `bun run start`
# (DEPLOY.md §8e — api + web di balik satu port) tetap hidup sesudah SSH ditutup
# dan menyala lagi sesudah reboot, tanpa perlu root:
#
#   systemctl --user status  crk
#   systemctl --user restart crk
#   tail -f logs/crk.log
#
# Deploy manual Anda tidak berubah, hanya baris terakhirnya:
#   git pull && bun run build && systemctl --user restart crk
#
# Pilihan (semuanya opsional):
#   SERVICE_NAME=nama   nama unit (baku: crk) — dua checkout berarti dua nama
#   ENV_FILE=.env.prod  berkas env yang dibaca bun (baku: .env, lalu .env.prod)
#   BUILD=1             paksa `bun run build` walau artefaknya sudah ada
#   LOG_FILE=path.log   berkas log (baku: logs/<nama-unit>.log di checkout ini);
#                       LOG_FILE=journal mengembalikannya ke journald
#   --dry-run           cetak unit yang akan ditulis, jangan sentuh systemd
#
# Sengaja "user service", bukan /etc/systemd/system: aplikasinya toh berjalan sebagai
# akun biasa dari checkout di $HOME, jadi start/stop/restart dan `git pull` tidak butuh
# sudo, dan beberapa checkout (staging, produksi) bisa hidup berdampingan dengan nama
# unit berbeda. Instalasi ber-root dengan binary terkompilasi dan dua unit terpisah ada
# di deploy/systemd/crk-api.service + crk-web.service (DEPLOY.md §8c).
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opsi tidak dikenal: $arg (lihat --help)" >&2; exit 2 ;;
  esac
done

SERVICE_NAME="${SERVICE_NAME:-crk}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO_DIR/deploy/systemd/user-app.service.template"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME.service"

die() { echo "ERROR: $*" >&2; exit 1; }

# Nama unit masuk ke nama berkas dan ke argumen systemctl.
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] ||
  die "SERVICE_NAME='$SERVICE_NAME' tidak sah — pakai huruf, angka, '-', '_', '.', '@'."

[[ -f "$TEMPLATE" ]] || die "template $TEMPLATE tidak ada."

# ExecStart= dipecah systemd pada spasi; path ber-spasi akan jadi dua argumen.
case "$REPO_DIR" in
  *" "*) die "path checkout mengandung spasi ($REPO_DIR) — pindahkan ke path tanpa spasi." ;;
esac

if [[ $DRY_RUN -eq 0 && -z "${XDG_RUNTIME_DIR:-}" ]]; then
  die "tidak ada session systemd --user (XDG_RUNTIME_DIR kosong).
  Biasanya karena login lewat 'su'. Masuk sebagai user ini (ssh/login) lalu ulangi,
  atau minta admin: sudo loginctl enable-linger $USER"
fi

BUN_BIN="$(command -v bun || true)"
[[ -n "$BUN_BIN" ]] || die "'bun' tidak ada di PATH. Pasang dari https://bun.sh/install lalu ulangi."

# --- berkas env ------------------------------------------------------------
# Service harus membaca env yang SAMA dengan yang Anda pakai waktu menjalankan
# `bun run start` dengan tangan, kalau tidak "jalan di terminal, aneh di service".
# Karena itu .env (yang dimuat bun sendiri) menang; .env.prod dipakai bila memang
# hanya itu yang ada (alur DEPLOY.md §8e), dan ENV_FILE= mengalahkan keduanya.
# Berkasnya selalu diteruskan eksplisit ke bun supaya tidak bergantung pada cwd.
ENV_ARG=""
if [[ -n "${ENV_FILE:-}" ]]; then
  case "$ENV_FILE" in /*) ENV_PATH="$ENV_FILE" ;; *) ENV_PATH="$REPO_DIR/$ENV_FILE" ;; esac
  [[ -f "$ENV_PATH" ]] || die "ENV_FILE=$ENV_FILE tidak ditemukan ($ENV_PATH)."
elif [[ -f "$REPO_DIR/.env" ]]; then
  ENV_PATH="$REPO_DIR/.env"
  [[ ! -f "$REPO_DIR/.env.prod" ]] ||
    echo "Catatan: ada .env dan .env.prod — dipakai .env (sama seperti 'bun run start')." \
      "Untuk yang satunya: ENV_FILE=.env.prod bun run systemd:install"
elif [[ -f "$REPO_DIR/.env.prod" ]]; then
  ENV_PATH="$REPO_DIR/.env.prod"
else
  ENV_PATH=""
  echo "WARNING: $REPO_DIR/.env(.prod) belum ada — aplikasi butuh DATABASE_URL dan" \
    "APP_ORIGIN untuk jalan (lihat .env.prod.example). Isi dulu sebelum service dinyalakan." >&2
fi
[[ -z "$ENV_PATH" ]] || ENV_ARG="--env-file=$ENV_PATH"
case "$ENV_PATH" in
  *" "*) die "path berkas env mengandung spasi ($ENV_PATH)." ;;
esac

# --- port ------------------------------------------------------------------
# HOST + tiga port yang dipakai `bun start` (gateway, api, web internal), dibaca dari env
# yang sama supaya pemeriksaan ini tidak menebak angka baku.
read -r APP_HOST APP_PORT API_PORT_V WEB_PORT_V <<<"$("$BUN_BIN" ${ENV_ARG:+"$ENV_ARG"} -e '
  const h = process.env.HOST ?? "127.0.0.1";
  const host = h === "0.0.0.0" || h === "::" ? "127.0.0.1" : h;
  const ports = [process.env.PORT ?? 3000, process.env.API_PORT ?? 3001, process.env.WEB_PORT_INTERNAL ?? 3010];
  process.stdout.write([host, ...ports].join(" "));
' 2>/dev/null || true)"

APP_URL=""
if [[ "$APP_PORT$API_PORT_V$WEB_PORT_V" =~ ^[0-9]+$ && "$APP_HOST" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
  APP_URL="http://$APP_HOST:$APP_PORT"
fi

answers() { # 0 = ada yang menjawab /v1/health di APP_URL
  [[ -n "$APP_URL" ]] || return 1
  "$BUN_BIN" -e "
    const res = await fetch('$APP_URL/v1/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
    process.exit(res?.ok ? 0 : 1);
  " 2>/dev/null
}

# Port yang sudah dipakai TETANGGA (`bun run start` manual di screen, unit lain, checkout
# kedua dengan env yang sama) adalah jebakan paling licik di sini, dan tidak selalu berbunyi
# keras: di host ini gateway-nya memang gagal bind dan crash-loop, tetapi proses api-nya
# justru BERBAGI port dengan instance tetangga (SO_REUSEPORT) — dua instance menjawab
# bergantian di port yang sama, jadi yang terlihat hanya perilaku aneh separuh waktu.
# Karena itu ketiga port diperiksa, dan yang dilihat bukan cuma "terpakai" melainkan
# "terpakai oleh siapa": port yang dipegang unit ini sendiri berarti ini re-install biasa.
if [[ -n "$APP_URL" ]]; then
  BUSY="$("$BUN_BIN" -e "
    const busy = [];
    for (const port of [$APP_PORT, $API_PORT_V, $WEB_PORT_V]) {
      try {
        (await Bun.connect({ hostname: '$APP_HOST', port, socket: { data() {} } })).end();
        busy.push(port);
      } catch { /* tidak ada yang mendengarkan = bebas */ }
    }
    process.stdout.write(busy.join(' '));
  " 2>/dev/null || true)"

  FOREIGN=""
  if [[ -n "$BUSY" ]] && command -v ss >/dev/null 2>&1; then
    for port in $BUSY; do
      # ss hanya menyebut pid untuk proses milik user ini — cukup, karena service ini pun
      # berjalan sebagai user ini. Tanpa pid (proses user lain) → anggap asing.
      owners="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
      mine=0
      if [[ -n "$owners" ]]; then
        mine=1
        for pid in $owners; do
          grep -qF "/$SERVICE_NAME.service" "/proc/$pid/cgroup" 2>/dev/null || mine=0
        done
      fi
      [[ $mine -eq 1 ]] || FOREIGN="${FOREIGN:+$FOREIGN }$port"
    done
  elif [[ -n "$BUSY" ]]; then
    # Tanpa `ss` tidak ada cara murah menanyakan pemiliknya: unit yang sedang jalan
    # dianggap pemilik portnya sendiri.
    systemctl --user is-active --quiet "$SERVICE_NAME" || FOREIGN="$BUSY"
  fi

  if [[ -n "$FOREIGN" ]]; then
    MSG="port $FOREIGN di $APP_HOST dipegang proses LAIN (\`bun run start\` manual? unit
  systemd lain? checkout kedua?). Dibiarkan, instalasi ini akan bentrok diam-diam: gateway
  crash-loop, atau dua api berbagi port dan membelah trafik. Hentikan proses itu dulu, atau
  beri instalasi ini PORT / API_PORT / WEB_PORT_INTERNAL sendiri di ${ENV_PATH:-berkas env}."
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "(dry-run) PERINGATAN: $MSG"
    else
      die "$MSG Belum ada yang ditulis atau dibangun."
    fi
  fi
fi

# --- artefak build ---------------------------------------------------------
# `bun start` menolak jalan tanpa build web (dist/web dari build-release.sh, atau
# apps/web/build dari `bun run build`).
if [[ "${BUILD:-0}" = "1" ]] ||
  { [[ ! -f "$REPO_DIR/dist/web/index.js" ]] && [[ ! -f "$REPO_DIR/apps/web/build/index.js" ]]; }; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "(dry-run) build web belum ada — instalasi sungguhan akan menjalankan 'bun run build'"
  else
    echo "== build belum ada (atau BUILD=1), menjalankan 'bun run build'..."
    (cd "$REPO_DIR" && bun run build)
  fi
fi

# --- tujuan log ------------------------------------------------------------
# Baku: berkas di dalam checkout. Journal terdengar lebih "systemd", tetapi ada host
# (termasuk yang dipakai pemilik repo ini) yang tidak memberi akun biasa akses baca ke
# journal-nya sendiri — di sana `journalctl --user` menjawab "insufficient permissions"
# dan log aplikasi praktis hilang. Berkas selalu bisa dibaca pemiliknya. `LOG_FILE=journal`
# mengembalikannya ke journald bagi yang memang punya aksesnya.
LOG_PATH=""
if [[ "${LOG_FILE:-}" = "journal" ]]; then
  STDOUT=journal
  STDERR=journal
else
  LOG_FILE="${LOG_FILE:-logs/$SERVICE_NAME.log}"
  case "$LOG_FILE" in /*) LOG_PATH="$LOG_FILE" ;; *) LOG_PATH="$REPO_DIR/$LOG_FILE" ;; esac
  case "$LOG_PATH" in *" "*) die "path LOG_FILE mengandung spasi ($LOG_PATH)." ;; esac
  # `append:` gagal bila direktorinya belum ada, dan unit yang gagal start karena itu
  # adalah kegagalan yang paling membingungkan: tidak ada log untuk menjelaskannya.
  [[ $DRY_RUN -eq 1 ]] || mkdir -p "$(dirname "$LOG_PATH")"
  STDOUT="append:$LOG_PATH"
  STDERR="append:$LOG_PATH"
fi

# --- unit ------------------------------------------------------------------
# PATH service: direktori bun lebih dulu, lalu yang biasa — unit systemd tidak
# membaca ~/.bashrc, jadi PATH login tidak otomatis berlaku di sini.
SERVICE_PATH="$(dirname "$BUN_BIN"):/usr/local/bin:/usr/bin:/bin"

UNIT_TEXT="$(sed \
  -e "s|__SERVICE_NAME__|$SERVICE_NAME|g" \
  -e "s|__REPO_DIR__|$REPO_DIR|g" \
  -e "s|__BUN_BIN__|$BUN_BIN|g" \
  -e "s|__ENV_ARG__|$ENV_ARG|g" \
  -e "s|__PATH__|$SERVICE_PATH|g" \
  -e "s|__STDOUT__|$STDOUT|g" \
  -e "s|__STDERR__|$STDERR|g" \
  "$TEMPLATE")"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "== $UNIT_FILE (dry-run, tidak ditulis)"
  echo "$UNIT_TEXT"
  exit 0
fi

mkdir -p "$UNIT_DIR"
printf '%s\n' "$UNIT_TEXT" > "$UNIT_FILE"
echo "Unit ditulis ke $UNIT_FILE"
echo "  checkout : $REPO_DIR"
echo "  bun      : $BUN_BIN"
echo "  env      : ${ENV_PATH:-(tidak ada — bun akan memakai .env bila muncul nanti)}"
echo "  log      : ${LOG_PATH:-journald (journalctl --user -u $SERVICE_NAME)}"

# Kesiapan lingkungan (Q-13). Hanya laporan: migrasi tetap langkah eksplisit (Q-4),
# dan service yang gagal karena database belum siap akan dicoba lagi oleh Restart=always.
if [[ -n "$ENV_PATH" ]]; then
  echo
  echo "== preflight (periksa env, database, migrasi, volume — tidak mengubah apa pun)"
  (cd "$REPO_DIR" && "$BUN_BIN" --env-file="$ENV_PATH" apps/api/src/index.ts preflight) || {
    echo "preflight belum hijau. Biasanya: 'bun --env-file=${ENV_PATH##*/} run db:migrate'" \
      "(lalu db:seed pada instalasi baru). Service tetap dipasang." >&2
  }
fi

echo
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME" >/dev/null
systemctl --user restart "$SERVICE_NAME"
# Dibaca SESUDAH restart: systemd menolkan NRestarts pada start manual, jadi angka sebelum
# restart (sisa crash-loop pemasangan lama) akan terbaca sebagai "mati sendiri" yang palsu.
# Dari sini ke atas berarti prosesnya benar-benar mati lalu dinyalakan lagi Restart=always.
RESTARTS_BEFORE="$(systemctl --user show -p NRestarts --value "$SERVICE_NAME" 2>/dev/null || echo 0)"

# `restart` untuk Type=simple pulang begitu proses dijalankan, bukan begitu siap. Yang ingin
# diketahui pemasang bukan "prosesnya ada", melainkan "aplikasinya menjawab" — dan bukan
# "ada yang menjawab", melainkan "unit ini masih hidup DAN ada yang menjawab".
READY=0
CRASHED=0
for _ in $(seq 1 45); do
  systemctl --user is-active --quiet "$SERVICE_NAME" || { CRASHED=1; break; } # keluar sendiri
  if [[ "$(systemctl --user show -p NRestarts --value "$SERVICE_NAME" 2>/dev/null || echo 0)" \
    != "$RESTARTS_BEFORE" ]]; then
    CRASHED=1 # mati lalu dinyalakan lagi oleh Restart=always — jangan tunggu 45 detik
    break
  fi
  if [[ -z "$APP_URL" ]] || answers; then
    READY=1
    break
  fi
  sleep 1
done

# Jawaban pertama belum tentu jawaban service ini: gateway-nya bisa sudah mengangkat
# telepon sementara proses api-nya baru saja gagal bind (mis. API_PORT dipakai tetangga) —
# 200-nya datang dari upstream milik orang lain, dan sedetik kemudian unit ini mati.
# Karena itu ditahan sebentar lalu diperiksa lagi sebelum dinyatakan berhasil.
if [[ $READY -eq 1 ]]; then
  sleep 3
  if ! systemctl --user is-active --quiet "$SERVICE_NAME" ||
    [[ "$(systemctl --user show -p NRestarts --value "$SERVICE_NAME" 2>/dev/null || echo 0)" \
      != "$RESTARTS_BEFORE" ]]; then
    READY=0
    CRASHED=1
  fi
fi

if [[ $READY -eq 1 ]] && systemctl --user is-active --quiet "$SERVICE_NAME"; then
  echo "OK — service '$SERVICE_NAME' terpasang & menjawab di ${APP_URL:-(HOST:PORT dari env)}"
  echo "     (arahkan nginx/apache ke sana; /metrics tetap privat di port api)"
else
  if [[ $CRASHED -eq 1 ]]; then
    echo "Service '$SERVICE_NAME' MATI SENDIRI sesudah start (systemd menyalakannya lagi)" >&2
  else
    echo "Service '$SERVICE_NAME' belum menjawab${APP_URL:+ di $APP_URL} dalam 45 detik" >&2
  fi
  echo "— 20 baris log terakhir:" >&2
  if [[ -n "${LOG_PATH:-}" ]]; then
    tail -n 20 "$LOG_PATH" >&2 || true
  else
    journalctl --user -u "$SERVICE_NAME" -n 20 --no-pager >&2 || true
  fi
fi
systemctl --user status "$SERVICE_NAME" --no-pager -n 5 || true

echo
echo "Perintah sehari-hari:"
echo "  systemctl --user status  $SERVICE_NAME"
echo "  systemctl --user restart $SERVICE_NAME"
if [[ -n "$LOG_PATH" ]]; then
  echo "  tail -f $LOG_PATH"
  echo "  rotasi log (systemd tidak merotasi sendiri): deploy/systemd/logrotate.example"
else
  echo "  journalctl --user -u $SERVICE_NAME -f"
fi
echo "  deploy berikutnya: cd $REPO_DIR && git pull && bun run build && systemctl --user restart $SERVICE_NAME"

# Mode journal dipilih sendiri, tapi belum tentu bisa dibaca di host ini — lebih baik
# dikatakan sekarang daripada saat sesuatu rusak dan log-nya ternyata kosong.
if [[ -z "$LOG_PATH" ]] && ! journalctl --user -u "$SERVICE_NAME" -n 1 --no-pager >/dev/null 2>&1; then
  echo
  echo "Catatan: journal user tidak bisa dibaca di host ini, jadi 'journalctl --user' kosong."
  echo "  Pasang ulang tanpa LOG_FILE=journal supaya log masuk ke logs/$SERVICE_NAME.log,"
  echo "  atau minta admin menambahkan akun ini ke grup 'systemd-journal'."
fi

if [[ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  echo
  echo "Supaya service tetap hidup sesudah logout dan menyala lagi sesudah reboot," \
    "aktifkan linger sekali saja:"
  echo "  sudo loginctl enable-linger $USER"
fi

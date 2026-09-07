# Deployment Single-VPS — dari VPS kosong sampai HTTPS

| | |
|---|---|
| **Status** | Versi 2 — M7. Panduan berurutan (Q-10), backup terjadwal + restore teruji (Q-8, O-7), operasi harian |
| **Berkas** | [`compose.prod.yml`](../compose.prod.yml) · [`Dockerfile`](../Dockerfile) · [`deploy/Caddyfile`](../deploy/Caddyfile) · [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) · [`deploy/backup.sh`](../deploy/backup.sh) · [`deploy/restore.sh`](../deploy/restore.sh) · [`.env.prod.example`](../.env.prod.example) |
| **Kontrak** | [`PRD.md` §4.4](./PRD.md) (Keputusan D, E, F, M), FR-Q; kriteria terima §8 #23–#25 |
| **Target** | Satu VPS **2 vCPU / 4 GB**, Ubuntu LTS, hanya Docker terpasang. Tidak ada layanan vendor, tidak ada serverless |

Ikuti §2 **secara berurutan**; setiap langkah menyebut apa yang harus terlihat sebelum lanjut. Kalau Anda menemukan langkah yang tidak tertulis, itu cacat dokumen — laporkan.

---

## 1. Topologi

```
:80/:443 ─► caddy ──► /            ─► web  (SvelteKit SSR, adapter-node di atas Bun)
                  └─► /v1/*, /docs, /openapi.json ─► api (Elysia) ×N ──► mysql
                                                                   └──► valkey (opsional)
backup ──► mysqldump harian ──► ./backups (host)
```

- **Satu origin** (Keputusan E): web dan API dari domain yang sama lewat path. Tidak ada CORS, tidak ada cookie lintas-domain.
- **Caddy** (Keputusan D): TLS otomatis Let's Encrypt untuk `DOMAIN` sungguhan; untuk `localhost` Caddy memakai CA internalnya. Replika `api` diresolusi lewat DNS Docker (*dynamic upstream*).
- **`api` stateless** (Keputusan F): `--scale api=N` langsung bekerja; state bersama di database, Valkey hanya percepatan opsional (`--profile redis`).
- **Migrasi eksplisit** (Q-4): service `migrate` dijalankan operator, tidak pernah otomatis saat container start.
- **Konfigurasi runtime di database** (E-6): tema, bahasa, landing, SMTP, retensi log, modul — dari halaman **Pengaturan**, berlaku ke semua replika tanpa restart.

## 2. Dari VPS kosong ke HTTPS — 9 langkah, < 15 menit

Prasyarat yang harus sudah ada **sebelum** mulai (tidak dihitung): VPS Ubuntu 22.04/24.04 dengan Docker Engine + plugin Compose (`docker compose version` menjawab), akses `sudo`, sebuah domain dengan **record A** menunjuk ke IP VPS (cek `dig +short app.example.com`), dan port **80 + 443** terbuka di firewall penyedia.

```bash
# 1. Ambil kode (≈ 30 dtk)
sudo apt-get install -y git   # bila belum ada
git clone --recurse-submodules https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr.git app && cd app

# 2. Buat .env.prod dari contoh dan isi EMPAT nilai (≈ 1 mnt)
cp .env.prod.example .env.prod
nano .env.prod
#    Alias untuk semua perintah berikutnya — berlaku di bash maupun zsh (tambahkan ke ~/.zshrc / ~/.bashrc):
alias dc='docker compose --env-file .env.prod -f compose.prod.yml'
#   DOMAIN=app.example.com            ← domain Anda (record A sudah mengarah ke sini)
#   ACME_EMAIL=ops@example.com        ← untuk pemberitahuan sertifikat Let's Encrypt
#   MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD ← acak, HANYA huruf/angka (dipakai di URL)
#   DATABASE_NAME=app                 ← opsional; nama database di service mysql, mis. app_boilerplate
#   BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD ← akun superadmin pertama
#   (jangan pakai @ : / ? # % di kata sandi database — dipakai di DATABASE_URL dan diparse skrip backup)
#   Kata sandi dan DATABASE_NAME HANYA diterapkan saat volume mysql-data dibuat pertama kali. Mengubahnya belakangan
#   = `dc run --rm db-init` (membuat database + hak user app, idempoten) atau `down -v` (hapus data).
#    Cek cepat: nilai yang benar-benar diterima compose (DATABASE_NAME, kata sandi, origin, port) — lakukan
#    SEBELUM langkah 4, karena setelah volume dibuat nama database dan kata sandi terkunci:
dc config | grep -E 'MYSQL_DATABASE|DATABASE_URL|APP_ORIGIN|ORIGIN:|HTTP_PORT|published' | sort -u
#    → MYSQL_DATABASE dan akhiran DATABASE_URL harus sama dengan DATABASE_NAME Anda; APP_ORIGIN memuat
#      semua domain; tidak ada baris yang masih berisi nilai contoh (change-me-…, example.com).

# 3. Build image api + web (≈ 3–5 mnt tergantung CPU; sekali per versi)
export APP_COMMIT=$(git rev-parse --short HEAD) APP_BUILT_AT=$(date -u +%FT%TZ)
dc build
#   → terlihat: "dab/api" dan "dab/web" di `docker image ls`

# 4. Nyalakan database dan tunggu sehat (≈ 30 dtk)
dc up -d --wait mysql
#   → terlihat: "Container dab-prod-mysql-1 Healthy"

# 5. Migrasi skema — langkah eksplisit, bukan otomatis (≈ 10 dtk)
dc run --rm migrate
#   → baris terakhir menyebut jumlah migrasi yang diterapkan; tidak ada "error"

# 6. Seed: tenant default, grup sistem, superadmin pertama (≈ 5 dtk, idempoten)
dc run --rm seed
#   → "db:seed: selesai — tenant …"

# 7. Nyalakan seluruh stack: 3 replika api, web, caddy, backup harian (≈ 30 dtk)
dc up -d --wait --scale api=3
#   → semua service "Healthy"/"Started"; Caddy mengambil sertifikat dalam ± 10–30 dtk

# 8. Verifikasi HTTPS (ulangi bila sertifikat belum keluar)
curl -sI https://$(grep ^DOMAIN= .env.prod | cut -d= -f2)/ | head -1        # HTTP/2 200
curl -s  https://$(grep ^DOMAIN= .env.prod | cut -d= -f2)/v1/ready            # {"success":true,…}
curl -s  https://$(grep ^DOMAIN= .env.prod | cut -d= -f2)/v1/version          # commit & modul terpasang

# 9. Masuk di browser: https://DOMAIN/auth/login dengan BOOTSTRAP_ADMIN_*; landing ada di https://DOMAIN/
#    Lalu di Pengaturan: ganti kata sandi admin (Profil), isi SMTP, dan (opsional) hapus BOOTSTRAP_* dari .env.prod.
```

Selesai. Backup pertama sudah berjalan saat langkah 7 (service `backup` men-dump segera lalu tiap 24 jam ke `./backups/`).

**Bila langkah 8 gagal:**

| Gejala | Penyebab umum | Periksa |
|---|---|---|
| `curl: (60) SSL certificate problem` / sertifikat internal | DNS belum mengarah ke VPS atau port 80 tertutup (tantangan ACME gagal) | `docker compose … logs caddy \| tail`, `dig +short DOMAIN` |
| `502` | `api`/`web` belum sehat | `docker compose … ps`, `docker compose … logs api --tail 50` |
| `/v1/ready` merah | database tidak terjangkau / migrasi belum jalan | ulangi langkah 4–5 |
| `permission denied` di `./backups` | folder dibuat root oleh Docker | `sudo chown -R $USER ./backups` (dump ditulis oleh user image mysql) |
| `migrate`/`seed`: `Access denied for user 'app'@'%' to database '<nama>'` (errno 1044) | `DATABASE_NAME` diubah setelah volume `mysql-data` dibuat — database baru belum ada / user `app` belum punya hak | `dc run --rm db-init` lalu `migrate` + `seed`; atau `dc down -v` bila data belum penting |
| `migrate`/`seed`: `Access denied for user 'app'@'172.…' (using password: YES)` (errno 1045) | `MYSQL_PASSWORD` di `.env.prod` diubah setelah volume `mysql-data` dibuat (image MySQL hanya memakainya saat inisialisasi pertama), atau `DATABASE_URL` eksplisit berbeda, atau kata sandi berisi karakter URL | `dc config \| grep DATABASE_URL`; `dc run --rm db-init` menyamakan kata sandi user `app` dengan `.env.prod` (butuh root password yang berlaku di volume), atau bila data belum penting `dc down -v && dc up -d --wait mysql` |

### 2b. Port 80/443 sudah dipakai Apache/Nginx di host yang sama

Caddy butuh port 80 untuk tantangan Let's Encrypt, jadi bila Apache (atau Nginx) sudah memegang 80/443, **biarkan server itu yang mengakhiri TLS** untuk (sub)domain Anda dan meneruskan ke Caddy di port loopback. Semua di dalam stack tetap sama; hanya sertifikat dan HSTS yang pindah ke server depan.

```bash
# 1. .env.prod — tambahkan/ubah empat baris ini (contoh sudah ada di .env.prod.example)
CADDYFILE=./deploy/Caddyfile.behind-proxy     # Caddy tanpa TLS, auto_https off, mempercayai X-Forwarded-* dari host
HTTP_PORT=127.0.0.1:8080                      # hanya loopback; tidak ada port publik dari Docker
HTTPS_PORT=127.0.0.1:8443                     # tidak dipakai di mode ini
XFF_DEPTH=2                                   # IP klien = 2 hop di belakang (Apache → Caddy → web)
#    DOMAIN = nama publik utama; APP_ORIGIN (daftar) menentukan origin yang lolos pemeriksaan CSRF

# 2. Apache: aktifkan modul, pasang vhost dari contoh, minta sertifikat
sudo a2enmod ssl proxy proxy_http headers rewrite
sudo cp deploy/apache.conf.example /etc/apache2/sites-available/app.conf   # ganti app.example.com
sudo a2ensite app && sudo apachectl configtest && sudo systemctl reload apache2
sudo certbot --apache -d app.example.com

# 3. Stack seperti §2 langkah 3–7 (perintahnya identik). Verifikasi (pengganti langkah 8) TANPA TLS dulu:
curl -sI http://127.0.0.1:8080/ -H 'Host: app.example.com' | head -1        # 200 dari Caddy langsung
curl -s  http://127.0.0.1:8080/v1/ready -H 'Host: app.example.com'           # database menjawab
curl -s  http://127.0.0.1:8080/v1/version -H 'Host: app.example.com'         # commit & modul terpasang
# 4. Setelah vhost + sertifikat di server depan siap:
curl -sI https://app.example.com/ | head -1                                  # 200 lewat Apache + TLS
```

`APP_ORIGIN` adalah **daftar** origin publik yang boleh mengirim form/login (pemeriksaan CSRF), dipisah koma; host tanpa skema berarti http dan https. Satu instalasi yang dilayani beberapa (sub)domain cukup mendaftarkan semuanya, mis. `APP_ORIGIN=https://apps.carik.id,https://xxx.domain.com,localhost,http://localhost:8080`. Selama sertifikat belum ada, sertakan varian `http://` domainnya agar login lewat vhost HTTP tidak ditolak; hapus lagi begitu certbot selesai. Web tidak memakai `ORIGIN` tetap: origin tiap request diturunkan dari `X-Forwarded-Proto/Host`, sehingga semua domain di daftar itu bekerja tanpa konfigurasi tambahan. GET (halaman, `/v1/ready`) tidak pernah terpengaruh. Kriteria §8 #23 untuk pola ini adalah "sampai server depan menyajikan HTTPS", sertifikatnya milik certbot di Apache/Nginx, bukan Caddy.

Nginx: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) dengan `proxy_pass http://127.0.0.1:8080` dan `proxy_buffering off` (streaming AI).

Cara kerja hop ganda: Apache menulis `X-Forwarded-Proto: https` dan menambahkan IP klien ke `X-Forwarded-For`; Caddy mempercayainya (`trusted_proxies private_ranges`) dan meneruskan; web mengambil IP klien dari kedalaman `XFF_DEPTH=2`, API memakai entri pertama. Tanpa `XFF_DEPTH=2`, rate limit login dan audit log akan mencatat `127.0.0.1` untuk semua orang.

Uji di laptop tanpa domain tetap memakai §2 dengan `DOMAIN=localhost` (Caddy memakai CA internalnya; terima peringatan sertifikat di browser).

## 3. Operasi harian

```bash
alias dc='docker compose --env-file .env.prod -f compose.prod.yml'   # sekali per shell (bash & zsh)

# Upgrade versi
git pull --recurse-submodules
export APP_COMMIT=$(git rev-parse --short HEAD) APP_BUILT_AT=$(date -u +%FT%TZ)
dc run --rm backup-once                       # dump sebelum menyentuh apa pun
dc build && dc run --rm migrate && dc run --rm seed
dc up -d --wait --scale api=3                 # replika lama diganti satu per satu oleh compose

# Skala / status / log
dc up -d --scale api=5                        # SELALU sertakan --scale pada setiap `up`, kalau tidak api kembali ke 1
dc ps && dc logs -f --tail 100 api           # log JSON, request id ikut mengalir (M-1)
docker stats --no-stream                        # RAM per container (§8 #25: total idle < 1,5 GB)

# Backup & restore (Q-8, O-7) — lihat §4
dc run --rm backup-once
dc run --rm -e CONFIRM_RESTORE=yes restore latest

# Redis/Valkey opsional (Keputusan M) — percepatan cache konfigurasi, bukan kebutuhan
#   di .env.prod: CACHE_DRIVER=redis, REDIS_URL=redis://valkey:6379
dc --profile redis up -d --wait --scale api=3
```

**Rotasi log (Q-7):** semua service memakai driver `json-file` dengan `max-size 10m`, `max-file 5` — maksimum ±50 MB per container. Log audit dan log aplikasi di database dipangkas job `core.logs.retention` sesuai **Pengaturan → Log & retensi** (M-3).

**Restart otomatis (Q-6):** `restart: unless-stopped` di semua service; Docker menyalakannya kembali saat proses mati dan saat host reboot (pastikan `systemctl is-enabled docker` = `enabled`).

**Berkas unggahan (Q-9):** volume `uploads` → `/data/uploads` di `api` (`UPLOADS_DIR`). Sertakan dalam backup host bila modul Anda menyimpan berkas: `docker run --rm -v dab-prod_uploads:/u -v $PWD/backups:/b alpine tar czf /b/uploads-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /u .`

## 4. Backup & restore

| Apa | Bagaimana |
|---|---|
| Terjadwal | service `backup` (selalu hidup): `mysqldump --single-transaction` (atau `pg_dump`) → `./backups/app-<dialect>-<UTC>.sql.gz`, segera saat start lalu tiap `BACKUP_INTERVAL_SECONDS` (baku 24 jam). `latest.sql.gz` adalah **hard link** ke dump terbaru: ukurannya nyata di semua alat, aman disalin lewat SFTP/rsync, tanpa ruang tambahan |
| Retensi | dump lebih tua dari `BACKUP_KEEP_DAYS` (baku 14) dihapus setelah setiap dump |
| Sekarang juga | `dc run --rm backup-once` |
| Restore | `dc run --rm -e CONFIRM_RESTORE=yes restore latest` atau nama berkas di `./backups`. **Destruktif**: database dikosongkan lalu dump dimuat; tanpa `CONFIRM_RESTORE=yes` perintah menolak dan menjelaskan. Hentikan `api`/`web` dulu bila tidak ingin ada request gagal selama beberapa detik |
| Off-site | salin `./backups` keluar VPS (rclone/rsync/objek storage) — ini di luar cakupan stack |
| PostgreSQL | `DB_DIALECT=postgres`, `BACKUP_IMAGE=postgres:16`, `DATABASE_URL` eksternal; skrip yang sama memakai `pg_dump`/`psql` |

Alur "backup → hapus database → restore → aplikasi utuh" dijalankan CI pada setiap push (`scripts/ci/backup-restore-proof.sh`, kriteria §8 #24) dan bisa diulang lokal dengan `bun run proof:backup:docker`. Di VPS, ulangi sekali sebelum rilis mengikuti [`RELEASE-CHECKLIST.md`](./RELEASE-CHECKLIST.md).

## 5. Image

Satu `Dockerfile`, dua target: install penuh → `bun run bootstrap` + build web → install produksi bersih → runtime `oven/bun:alpine`, user `bun`, `HEALTHCHECK`. Dialect dipilih saat build (`--build-arg DB_DIALECT=postgres`) karena skema ter-generate mengikat satu driver (§4.3).

| Image | Ukuran | Isi utama |
|---|---|---|
| `dab/api` | ±212 MB | bun 70 MB · `node_modules` produksi 67 MB (`typescript` 23 MB adalah dependensi runtime `elysia`) · alpine · kode < 1 MB |
| `dab/web` | ±213 MB | serupa; `build/` adapter-node 1,8 MB |

PRD Q-2 menargetkan < 150 MB; lantai realistis dengan runtime Bun ±190 MB. Ini keputusan produk yang masih terbuka: merevisi Q-2, atau `bun build --compile` (binary ±90 MB tanpa `node_modules`).

## 6. Nginx

Bagi yang punya standar Nginx sendiri: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) memetakan aturan yang sama (`/v1`, `/docs`, `/openapi.json` → api; sisanya → web; `proxy_buffering off` untuk streaming AI). TLS diserahkan ke certbot Anda; matikan service `caddy` dengan override compose.

## 7. Batas sumber daya & pengukuran (§8 #25)

Stack baku (caddy + web + 3×api + mysql + backup) idle di sekitar 600–900 MB pada mesin CI; anggaran §8 adalah **< 1,5 GB**. Ukur di VPS setelah 10 menit idle:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' && free -m
```

CI menjalankan pengukuran yang sama pada stack `--scale api=3` (`scripts/ci/idle-memory.sh`). Batas per service (`deploy.resources`), systemd tanpa Docker, deploy tanpa downtime, dan `preflight` (Q-11…Q-14) adalah P1 — lihat ROADMAP §8.

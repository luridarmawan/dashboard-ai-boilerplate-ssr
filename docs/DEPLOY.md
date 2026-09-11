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
#   TABLE_PREFIX=dab_                 ← opsional; prefiks semua tabel bila satu database dipakai beberapa aplikasi (O-2).
#                                       Tetapkan SEBELUM migrate pertama; mengubahnya = database baru + migrate ulang.
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
#    Lalu di Pengaturan: ganti kata sandi admin (Profil) dan (opsional) hapus BOOTSTRAP_* dari .env.prod.
#    Email: isi SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/MAIL_FROM_ADDRESS di .env.prod (lalu `dc up -d`),
#    atau lewat Pengaturan → Email; nilai di Pengaturan menang per kolom.
#    Uji kredensial .env.prod: `bun --env-file=.env.prod run mail:test --to anda@contoh.id`
#    (koneksi + autentikasi + satu email uji, tanpa database); lalu ujung-ke-ujung: minta reset kata sandi dari /auth/forgot.
```

Selesai. Backup pertama sudah berjalan saat langkah 7 (service `backup` men-dump segera lalu tiap 24 jam ke `./backups/`).

**Bila langkah 8 gagal:**

| Gejala | Penyebab umum | Periksa |
|---|---|---|
| `curl: (60) SSL certificate problem` / sertifikat internal | DNS belum mengarah ke VPS atau port 80 tertutup (tantangan ACME gagal) | `docker compose … logs caddy \| tail`, `dig +short DOMAIN` |
| `502` | `api`/`web` belum sehat | `docker compose … ps`, `docker compose … logs api --tail 50` |
| `/v1/ready` merah (`ready:false`, 503) dengan `Failed query: select id from clients` | tabel belum ada: `dc up -d` tidak menjalankan migrasi — langkah 4–5 terlewat | `dc run --rm preflight` lalu `dc run --rm migrate && dc run --rm seed` |
| `/v1/ready` merah dengan galat koneksi (`ECONNREFUSED`, `Access denied`) | database tidak terjangkau atau kredensial berubah | periksa `dc ps mysql`, `DATABASE_URL`; baris di bawah |
| Setelah **restore** (atau `DROP DATABASE` manual) setiap kueri gagal, log `cause: ER_NO_DB_ERROR/1046: No database selected` | koneksi pool api/web dibuka sebelum database dibuat ulang dan kehilangan schema bawaannya | `dc up -d --force-recreate --scale api=3 web` — `restore.sh` juga mengingatkannya |
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

`APP_ORIGIN` adalah **daftar** origin publik yang boleh mengirim form/login (pemeriksaan CSRF), dipisah koma; host tanpa skema berarti http dan https. Satu instalasi yang dilayani beberapa (sub)domain cukup mendaftarkan semuanya, mis. `APP_ORIGIN=https://apps.carik.id,https://xxx.domain.com,localhost,http://localhost:8080`. Selama sertifikat belum ada, sertakan varian `http://` domainnya agar login lewat vhost HTTP tidak ditolak; hapus lagi begitu certbot selesai. **Daftar ini mengatur api DAN web**: keduanya membacanya saat runtime, jadi domain yang tidak terdaftar akan ditolak 403 meski proxy sudah benar — dan sebaliknya, domain yang terdaftar tetap diterima walau proxy depan lupa meneruskan `X-Forwarded-Proto/Host` (apps/web/src/lib/server/origin.ts; pemeriksaan Origin bawaan SvelteKit dimatikan karena ia terbakar ke dalam build). Bila `APP_ORIGIN` kosong, web jatuh ke origin hasil rekonstruksi dari `X-Forwarded-Proto/Host` seperti sebelumnya. GET (halaman, `/v1/ready`) tidak pernah terpengaruh. Kriteria §8 #23 untuk pola ini adalah "sampai server depan menyajikan HTTPS", sertifikatnya milik certbot di Apache/Nginx, bukan Caddy.

Nginx: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) dengan `proxy_pass http://127.0.0.1:8080` dan `proxy_buffering off` (streaming AI).

Cara kerja hop ganda: Apache menulis `X-Forwarded-Proto: https` dan menambahkan IP klien ke `X-Forwarded-For`; Caddy mempercayainya (`trusted_proxies private_ranges`) dan meneruskan; web mengambil IP klien dari kedalaman `XFF_DEPTH=2`, API memakai entri pertama. Tanpa `XFF_DEPTH=2`, rate limit login dan audit log akan mencatat `127.0.0.1` untuk semua orang.

Uji di laptop tanpa domain tetap memakai §2 dengan `DOMAIN=localhost` (Caddy memakai CA internalnya; terima peringatan sertifikat di browser).

## 3. Operasi harian

```bash
alias dc='docker compose --env-file .env.prod -f compose.prod.yml'   # sekali per shell (bash & zsh)

# Upgrade versi — TANPA downtime (Q-12; rincian di §8a)
sh deploy/upgrade.sh                          # pull → build → backup → migrate → seed → preflight → rollout api lalu web
API_REPLICAS=5 sh deploy/upgrade.sh --no-pull # dari kode yang sudah di-checkout, 5 replika api
dc run --rm preflight                         # kapan saja: cek kesiapan, keluar 0/1 (Q-13; §8b)

# Skala / status / log
dc up -d --scale api=5                        # SELALU sertakan --scale pada setiap `up`, kalau tidak api kembali ke 1
dc ps && dc logs -f --tail 100 api           # log JSON, request id ikut mengalir (M-1)
docker stats --no-stream                        # RAM per container (§8 #25: total idle < 1,5 GB)

# Backup & restore (Q-8, O-7) — lihat §4
dc run --rm backup-once
dc run --rm -e CONFIRM_RESTORE=yes restore latest

# Redis/Valkey opsional (Keputusan M) — percepatan, bukan kebutuhan; database tetap sumber kebenaran
#   di .env.prod: REDIS_URL=redis://valkey:6379 lalu pilih per jenis state:
#     CACHE_DRIVER=redis      cache konfigurasi/tema/modul (versi di Redis, bukan tabel cache_versions)
#     SESSION_DRIVER=redis    sesi yang sudah di-resolve di-cache 60 s di depan tabel sessions (login,
#                             logout, ganti tenant tetap ke database dan mengusir salinannya)
#     RATELIMIT_DRIVER=redis  jendela rate limit dihitung INCR+PEXPIREAT, tabel rate_limits tidak tumbuh
#   Redis mati = perilaku database biasa (fail-open ke database, satu peringatan per menit di log).
dc --profile redis up -d --wait --scale api=3
```

**Rotasi log (Q-7):** semua service memakai driver `json-file` dengan `max-size 10m`, `max-file 5` — maksimum ±50 MB per container. Log audit dan log aplikasi di database dipangkas job `core.logs.retention` sesuai **Pengaturan → Log & retensi** (M-3).

**Restart otomatis (Q-6):** `restart: unless-stopped` di semua service; Docker menyalakannya kembali saat proses mati dan saat host reboot (pastikan `systemctl is-enabled docker` = `enabled`).

**Berkas unggahan (Q-9, Q-16):** bawaan `STORAGE_DRIVER=local` — volume `uploads` → `/data/uploads` di `api` (`UPLOADS_DIR`); dengan `--scale api=N` semua replika berbagi volume yang sama di satu host. Sertakan dalam backup host bila ada berkas: `docker run --rm -v dab-prod_uploads:/u -v $PWD/backups:/b alpine tar czf /b/uploads-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /u .`

Untuk lebih dari satu host, atau agar bucket yang menanggung penyimpanan: `STORAGE_DRIVER=s3` + `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` di `.env.prod` (blok contoh ada di `.env.prod.example`; bekerja dengan AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces — path-style bawaan, `S3_VIRTUAL_HOSTED_STYLE=true` bila provider menolaknya). Metadata tetap di tabel `files`, jadi backup database + bucket adalah backup lengkap. `S3_PUBLIC_URL` opsional: berkas **publik** (logo tema) ditautkan langsung ke bucket/CDN alih-alih lewat API; berkas privat selalu lewat API dengan pemeriksaan izin. Berpindah driver tidak memindahkan objek lama — tiap baris `files` mengingat `storage`-nya, jadi lakukan `aws s3 sync` dari volume ke bucket dulu bila ingin berpindah dengan data. Preflight memeriksa driver yang aktif: volume bisa ditulis, atau bucket terjangkau dengan kredensial itu.

## 4. Backup & restore

| Apa | Bagaimana |
|---|---|
| Terjadwal | service `backup` (selalu hidup): `mysqldump --single-transaction` (atau `pg_dump`) → `./backups/app-<dialect>-<UTC>.sql.gz`, segera saat start lalu tiap `BACKUP_INTERVAL_SECONDS` (baku 24 jam). `latest.sql.gz` adalah **hard link** ke dump terbaru: ukurannya nyata di semua alat, aman disalin lewat SFTP/rsync, tanpa ruang tambahan |
| Retensi | dump lebih tua dari `BACKUP_KEEP_DAYS` (baku 14) dihapus setelah setiap dump |
| Sekarang juga | `dc run --rm backup-once` |
| Restore | `dc run --rm -e CONFIRM_RESTORE=yes restore latest` atau nama berkas di `./backups`. **Destruktif**: database dikosongkan lalu dump dimuat; tanpa `CONFIRM_RESTORE=yes` perintah menolak dan menjelaskan. Hentikan `api`/`web` dulu, dan **buat ulang** sesudahnya (`dc up -d --force-recreate --scale api=3 web`): koneksi pool yang dibuka sebelum restore kehilangan schema bawaannya dan setiap kueri gagal dengan 1046 |
| Off-site | salin `./backups` keluar VPS (rclone/rsync/objek storage) — ini di luar cakupan stack |
| PostgreSQL | `DB_DIALECT=postgres`, `BACKUP_IMAGE=postgres:16`, `DATABASE_URL` eksternal; skrip yang sama memakai `pg_dump`/`psql` |

Alur "backup → hapus database → restore → aplikasi utuh" dijalankan CI pada setiap push (`scripts/ci/backup-restore-proof.sh`, kriteria §8 #24) dan bisa diulang lokal dengan `bun run proof:backup:docker`. Di VPS, ulangi sekali sebelum rilis mengikuti [`RELEASE-CHECKLIST.md`](./RELEASE-CHECKLIST.md).

## 5. Image

Satu `Dockerfile`, dua target. Tahap `build` (image `oven/bun:alpine`) melakukan install penuh → `bun run bootstrap` (registri modul, skema per dialect, **migrasi disematkan**) → build web → lalu mengompilasi api dan membundel web. Tidak ada `node_modules` yang keluar dari tahap itu. Dialect dipilih saat build (`--build-arg DB_DIALECT=postgres`) karena skema ter-generate dan migrasi yang disematkan mengikat satu driver (§4.3).

| Image | Ukuran | Isi | Runtime |
|---|---|---|---|
| `dab/api` | ±92 MB terpasang (±40 MB saat pull) | **satu binary** `/app/api` (`bun build --compile`, ±80 MB — runtime Bun + kode + dependensi) · alpine + `ca-certificates`, `libstdc++`, `libgcc` | tanpa `bun`, tanpa sumber, tanpa `node_modules`; user `app` (uid 1000) |
| `dab/web` | ±94 MB terpasang (±45 MB saat pull) | `index.js` (adapter-node + seluruh dependensinya dibundel jadi satu berkas, ±2 MB) · `client/` aset statis · runtime `oven/bun:alpine` | `bun index.js`, user `bun` |

Keduanya memenuhi PRD Q-2 (< 150 MB); job CI `docker-build` gagal bila salah satu melewati batas itu.

**Subperintah binary api.** Karena image tidak berisi `bun`, perintah operasional adalah subperintah dari binary yang sama ([`apps/api/src/cli.ts`](../apps/api/src/cli.ts)); `dc run --rm migrate` dan `dc run --rm seed` di §2 memanggilnya lewat `command:` di `compose.prod.yml`:

| Perintah | Fungsi |
|---|---|
| `api` / `api serve` | server HTTP + scheduler (baku, `CMD` image) |
| `api migrate` | terapkan migrasi yang disematkan saat build — langkah eksplisit, tidak pernah otomatis saat start (Q-4); menghormati `TABLE_PREFIX` (O-2) |
| `api seed` | seed bootstrap idempoten: tenant baku, grup sistem, superadmin dari `BOOTSTRAP_ADMIN_*` (O-3) |
| `api health` | GET `/v1/health` di port lokal, keluar 0/1 — inilah `HEALTHCHECK` image |
| `api version` | cetak nama, versi, `APP_COMMIT`, `APP_BUILT_AT` — mis. `dc run --rm --no-deps api version` |

Pengembangan tetap memakai sumber: `bun apps/api/src/index.ts [perintah]` menerima subperintah yang sama, dan `bun db:migrate` / `bun db:seed` memanggil fungsi yang sama (`runMigrations`, `runSeedAll`). Yang **tidak** ada di dalam image: `bun run mail:test`, `db:smoke`, `modules:sync` — jalankan dari checkout repo dengan `.env` yang menunjuk ke server yang sama.

**Yang berubah dari image lama (±212 MB):** migrasi tidak lagi dibaca dari folder `packages/db/migrations` saat runtime tetapi dari `packages/db/src/generated/migrations.ts` yang ditulis `db:codegen`; `/v1/version` membaca `package.json` lewat import statis, bukan `readFileSync`. Volume `uploads` tetap dimiliki uid 1000, sama seperti user `bun` sebelumnya — tidak perlu `chown` saat upgrade.

## 6. Nginx

Bagi yang punya standar Nginx sendiri: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) memetakan aturan yang sama (`/v1`, `/docs`, `/openapi.json` → api; sisanya → web; `proxy_buffering off` untuk streaming AI). TLS diserahkan ke certbot Anda; matikan service `caddy` dengan override compose.

## 7. Batas sumber daya & pengukuran (§8 #25)

Stack baku (caddy + web + 3×api + mysql + backup) idle di sekitar 600–900 MB pada mesin CI; anggaran §8 adalah **< 1,5 GB**. Ukur di VPS setelah 10 menit idle:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' && free -m
```

CI menjalankan pengukuran yang sama pada stack `--scale api=3` (`scripts/ci/idle-memory.sh`).

**Batas per service (Q-14):** setiap service di `compose.prod.yml` punya `mem_limit` dan `cpus` yang bisa diubah lewat `.env.prod` (`API_MEM_LIMIT`, `API_CPUS`, `WEB_*`, `MYSQL_*`, `CADDY_*`, `BACKUP_*`, `VALKEY_*`). Bakunya untuk 2 vCPU / 4 GB dengan 3 replika api: api 384 MB × 3, web 384 MB, mysql 1 GB, caddy 128 MB, backup 256 MB — total pagu ± 2,9 GB, jadi satu container yang bocor tidak bisa menjatuhkan host. Container yang menyentuh pagunya di-OOM-kill dan dinyalakan ulang Docker (`restart: unless-stopped`); `dc ps` dan `docker inspect --format '{{.State.OOMKilled}}'` memperlihatkannya.

---

## 7a. Metrik Prometheus (M-6)

Setiap proses api mengekspos `GET /metrics` (format teks Prometheus) di port api-nya — **bukan** di bawah `/v1`, jadi Caddy tidak pernah meneruskannya ke internet; yang bisa mengambilnya hanya sesuatu di dalam jaringan Docker (atau `127.0.0.1:3001` di mode systemd). Jalankan Prometheus di sampingnya:

```bash
dc --profile monitoring up -d          # prom/prometheus, konfigurasi deploy/prometheus.yml, retensi 15 hari
ssh -L 9090:127.0.0.1:9090 <vps>       # UI di http://localhost:9090 dari laptop Anda
```

`deploy/prometheus.yml` memakai DNS Docker (`dns_sd_configs` ke `api`) sehingga **setiap replika** `--scale api=N` ter-scrape dan dibedakan lewat label `instance`. Bila port api bisa dijangkau lebih luas dari jaringan stack, isi `METRICS_TOKEN` di `.env.prod` dan nilai yang sama di `prometheus.yml` (`authorization: Bearer`); `METRICS_ENABLED=false` mematikan endpoint-nya.

Yang tersedia (nama Prometheus baku, tanpa label user/tenant — kardinalitasnya terjaga; route adalah pola yang cocok seperti `/v1/users/:id`, bukan path mentah):

| Metrik | Arti |
|---|---|
| `http_requests_total{method,route,status}` | laju request; error rate = `status=~"5.."` ÷ total |
| `http_request_duration_seconds_bucket{method,route,le}` | latensi — p50/p95/p99 lewat `histogram_quantile` |
| `http_requests_in_flight`, `http_request_errors_total{class}` | beban saat ini; 4xx vs 5xx |
| `db_pool_connections{state}`, `db_pool_max_connections` | koneksi pool DB (open/idle/queued di MySQL; PostgreSQL hanya maksimum) |
| `scheduler_job_runs_total{job,status}`, `scheduler_job_duration_seconds` | job berkala (G-18) per instance |
| `event_hook_runs_total{event,module,status}` | hook modul yang jalan/gagal (G-17) |
| `ai_calls_total{provider,model,status}`, `ai_tokens_total{…,direction}`, `ai_cost_micro_total` | dari modul AI — contoh metrik yang didaftarkan modul |
| `app_info{version,commit,dialect,instance}`, `process_*` | identitas build, memori, CPU, uptime |

Contoh PromQL: `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))`, `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`.

Modul mendaftarkan metriknya sendiri lewat registry yang sama: `import { metrics } from '@app/api/metrics'` lalu `metrics.counter('<ns>_x_total', '…', ['kind'])` — lihat [`MODULES.md` §3](./MODULES.md).

**Grafana & alert.** Profil `monitoring` juga menjalankan Grafana (`127.0.0.1:3300`, login `admin` / `GRAFANA_ADMIN_PASSWORD`) dengan datasource Prometheus dan dashboard **Dashboard AI Boilerplate — API** sudah ter-provision dari `deploy/grafana/` (laju request per route, error rate, p50/p95/p99, in-flight, pool DB, RSS per replika, job & hook, token dan biaya AI). Aturan alert ada di `deploy/prometheus-rules.yml` dan tampil di tab *Alerts* Prometheus serta di Grafana: replika tidak ter-scrape 2 menit, 5xx > 5%, p95 > 1 s, antrean pool DB, job atau hook gagal, RSS > 320 MB.

**Alertmanager.** Profil yang sama menjalankan Alertmanager (`127.0.0.1:9093`); Prometheus sudah mengirim alert ke sana. Kanalnya Anda pilih di `deploy/alertmanager.yml`: blok `email_configs`, `slack_configs`, `telegram_configs`, dan `webhook_configs` tersedia dalam komentar — isi satu, salin berkasnya ke `deploy/alertmanager.local.yml` (di luar git, karena Alertmanager tidak membaca variabel env dan kredensial ada di dalamnya), lalu `ALERTMANAGER_CONFIG=./deploy/alertmanager.local.yml` di `.env.prod` dan `dc --profile monitoring up -d alertmanager`. Tanpa itu alert tetap terlihat di UI Prometheus/Alertmanager tetapi tidak dikirim ke mana pun. `inhibit_rules` meredam alert error-rate dan latensi sebuah replika yang memang sedang mati. Validasi berkas: `docker run --rm -v $PWD/deploy/alertmanager.yml:/a.yml prom/alertmanager:v0.28.1 amtool check-config /a.yml`.

---

## 8. Operasi lanjutan: upgrade tanpa downtime, preflight, systemd

### 8a. Upgrade tanpa downtime (Q-12)

`sh deploy/upgrade.sh` menjalankan urutan yang aman, satu langkah gagal = berhenti di situ dan versi lama tetap melayani:

1. `git pull` (lewati dengan `--no-pull`), lalu **build** image dengan `IMAGE_TAG=<commit>` — versi lama tidak disentuh.
2. **Backup** (`backup-once`), lalu **migrate**. Karena kode lama masih berjalan di atas skema baru sampai rollout selesai, migrasi harus **aditif** (tambah tabel/kolom/indeks, isi default). Menghapus atau mengganti nama kolom dilakukan di rilis berikutnya setelah tidak ada kode yang memakainya (pola *expand → migrate code → contract*).
3. **seed** (idempoten) dan **preflight** (§8b) — bila preflight merah, tidak ada yang di-rollout.
4. **Rollout** `api` lalu `web` lewat `deploy/rollout.sh`: replika baru dinyalakan **berdampingan** dengan yang lama (`--no-recreate`), masing-masing harus `healthy` menurut `HEALTHCHECK` image, Caddy diberi waktu menemukan upstream baru (`dynamic a`, refresh 5 s), baru replika lama dimatikan satu per satu dengan SIGTERM dan `stop_grace_period` 20 s sehingga request yang sedang berjalan selesai. Caddy mencoba ulang request yang upstream-nya baru hilang ke replika lain (`lb_try_duration 8s`, `lb_retries 3`), jadi klien tidak melihat kegagalan. Kalau replika baru tidak pernah sehat, skrip menghapusnya dan berhenti — yang lama tetap melayani.
5. `IMAGE_TAG` ditulis kembali ke `.env.prod`, supaya `dc up -d` biasa di kemudian hari tidak diam-diam membuat ulang versi lama.

Bukti: `scripts/ci/rollout-proof.sh` (job CI `scale-proof`) menembakkan request ke `/v1/health` dan `/robots.txt` lewat Caddy setiap 200 ms selama rollout tiga replika api dan web; syarat lolos: **nol** request gagal dan semua replika memakai tag baru. Yang tidak ditangani di sini: upgrade image `mysql`/`caddy` (restart singkat, lakukan di jendela pemeliharaan) dan skema yang tidak aditif.

### 8b. Preflight (Q-13)

`dc run --rm preflight` (di dalam image: `api preflight`; dari sumber: `bun apps/api/src/index.ts preflight`) memeriksa, **hanya membaca**, dan keluar 0/1:

| Pemeriksaan | Gagal bila | Petunjuk yang dicetak |
|---|---|---|
| `env` | variabel wajib kosong/salah bentuk (satu baris per masalah) | isi di `.env.prod` / `/etc/dab/api.env` |
| `secrets` (production) | `DATABASE_URL` atau `BOOTSTRAP_ADMIN_PASSWORD` masih nilai contoh (`change-me`) | ganti, lalu `db-init` |
| `origin`, `signup`, `smtp` (production) | peringatan: origin tanpa https, pendaftaran terbuka, SMTP kosong | — |
| `dialect` | image dibuild untuk dialect lain dari `DB_DIALECT` | build ulang dengan `--build-arg DB_DIALECT` |
| `database` | `select 1` gagal | DATABASE_URL, service sehat, firewall |
| `migrations` | ada migrasi tersemat yang belum diterapkan, atau database kosong | `dc run --rm migrate` |
| `seed` | peringatan: belum ada tenant | `dc run --rm seed` |
| `redis` | `PING` gagal saat ada `*_DRIVER=redis` | REDIS_URL / `--profile redis` |
| `uploads` | `UPLOADS_DIR` tidak bisa ditulis, atau (`STORAGE_DRIVER=s3`) bucket tidak terjangkau | `chown 1000:1000` volume; periksa `S3_*` |
| `modules` | (dari sumber) `modules.json` ≠ registry | `bun modules:sync` |

Unit systemd memanggilnya sebagai `ExecStartPre`, sehingga host yang setengah terkonfigurasi tidak pernah start.

### 8c. Tanpa Docker: systemd (Q-11)

```bash
# di mesin build (atau server, bila ada bun):
DB_DIALECT=mysql sh scripts/build-release.sh        # → dist/api (binary) + dist/web/ (bundel + aset)
# di server:
sudo useradd -r -s /usr/sbin/nologin dab
sudo mkdir -p /opt/dab /etc/dab /var/lib/dab/uploads && sudo cp -r dist/* /opt/dab/ && sudo chown -R dab:dab /opt/dab /var/lib/dab
sudo cp deploy/systemd/api.env.example /etc/dab/api.env && sudo cp deploy/systemd/web.env.example /etc/dab/web.env
sudo chmod 600 /etc/dab/*.env && sudo nano /etc/dab/api.env       # DATABASE_URL, APP_ORIGIN, BOOTSTRAP_*
sudo -u dab -- env $(grep -v '^#' /etc/dab/api.env | xargs) /opt/dab/api migrate   # eksplisit (Q-4)
sudo -u dab -- env $(grep -v '^#' /etc/dab/api.env | xargs) /opt/dab/api seed
sudo cp deploy/systemd/dab-api.service deploy/systemd/dab-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dab-api dab-web
systemctl status dab-api dab-web; journalctl -u dab-api -f
```

`dab-web.service` membutuhkan `bun` di `/usr/local/bin/bun` (https://bun.sh/install) dan berjalan setelah `dab-api`. Database dan Valkey dipasang dari paket OS; reverse proxy dari paket OS (nginx: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) — `/` → :3000, `/v1` `/docs` `/openapi.json` → :3001; atau Caddy). Upgrade di mode ini: `build-release`, salin `dist/` ke `/opt/dab.next`, `api migrate`, tukar simlink/folder, `systemctl restart dab-api dab-web` — ada jeda beberapa detik; rollout tanpa downtime (§8a) adalah jalur Docker. Kalau Anda tidak butuh dua unit dan hanya ingin satu port untuk diproksikan, lihat §8e (`bun start`).

### 8d. Pipeline CD contoh (Q-15)

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) adalah contoh *continuous deployment* yang memakai jalur upgrade yang sama dengan §8a, hanya tanpa build di VPS:

1. **build + push**: kedua target Dockerfile dibangun di runner GitHub dan didorong ke GitHub Container Registry sebagai `ghcr.io/<owner>/<repo>/api:<commit>` dan `…/web:<commit>` (plus `latest`), dengan cache layer di registry.
2. **deploy**: SSH ke VPS, lalu `sh deploy/upgrade.sh --pull <commit>` — pull image, backup, migrate, seed, preflight, rollout api dan web tanpa downtime. `IMAGE_PREFIX` dan `IMAGE_TAG` ditulis kembali ke `.env.prod`, sehingga `dc up -d` berikutnya tetap memakai versi itu.

Dipicu manual dari tab **Actions** (pilih commit/tag) atau otomatis saat tag `v*` didorong; job `deploy` memakai *environment* `production`, jadi Anda bisa mewajibkan persetujuan reviewer di pengaturan repo. Rahasia yang dibutuhkan: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH` (checkout di VPS yang berisi `.env.prod`), dan `GHCR_PULL_TOKEN` bila paket dibiarkan privat (PAT `read:packages`); paket publik tidak butuh login. Sekali saja di VPS: `IMAGE_PREFIX=ghcr.io/<owner>/<repo>` (huruf kecil) di `.env.prod`, dan user SSH anggota grup `docker`.

Mode `--pull` juga berguna tanpa GitHub: dorong image dari mesin build mana pun ke registry apa pun, lalu jalankan perintah yang sama di VPS.


### 8e. Tanpa Docker, satu perintah: `bun start` (Q-11)

Untuk host yang sudah punya nginx/apache dan database sendiri, dan Anda hanya ingin “aplikasinya hidup di sebuah port”. Tidak ada container, tidak ada Caddy:

```bash
# sekali di server: bun (https://bun.sh/install) + database dari paket OS, lalu
git clone <repo> app && cd app && bun install
cp .env.prod.example .env.prod && nano .env.prod     # DATABASE_URL, APP_ORIGIN, BOOTSTRAP_*, UPLOADS_DIR
bun --env-file=.env.prod run db:migrate              # eksplisit (Q-4)
bun --env-file=.env.prod run db:seed                 # idempoten (O-3)
bun run build                                        # registri modul + build SvelteKit
bun --env-file=.env.prod start                       # → http://127.0.0.1:3000
#   → "[start] siap — http://127.0.0.1:3000 (satu port: web + /v1 + /docs)"
```

`bun start` menyalakan **dua proses yang sama seperti compose** (api + web, `NODE_ENV=production` dipaksa) lalu memasang *gateway* satu port di depan keduanya, dengan tabel rute yang sama seperti [`deploy/Caddyfile`](../deploy/Caddyfile): `/v1/*` `/docs` `/docs/*` `/openapi.json` → api, sisanya → web. Origin tetap satu, jadi cookie dan CSRF berperilaku persis seperti di §2. Reverse proxy Anda cukup satu blok:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_http_version 1.1;
    proxy_buffering off;          # streaming AI (FR-H)
    proxy_read_timeout 300s;
}
```

Apache: [`deploy/apache.conf.example`](../deploy/apache.conf.example) sudah berbentuk satu `ProxyPass /` — arahkan ke `http://127.0.0.1:3000/` alih-alih ke Caddy.

**Env** (dibaca dari berkas yang Anda pilih dengan `--env-file`; sisanya sama dengan [`.env.prod.example`](../.env.prod.example)):

| | |
|---|---|
| `HOST` / `PORT` | port publik perintah ini — yang diproksikan (baku `127.0.0.1:3000`) |
| `API_HOST` / `API_PORT` | proses api (baku `127.0.0.1:3001`) |
| `WEB_PORT_INTERNAL` | proses web di belakang gateway (baku `3010`) |

`X-Forwarded-*` dari proxy depan diteruskan apa adanya — gateway ini satu host dengan aplikasi, bukan hop kepercayaan tambahan, jadi `XFF_DEPTH` tetap **1**. Tanpa proxy depan, header itu diisi dari koneksi masuk sendiri.

`bun start --no-proxy` melewatkan gateway: web di `$PORT`, api di `$API_PORT`, dan Anda mengatur dua `location` sendiri seperti [`deploy/nginx.conf.example`](../deploy/nginx.conf.example).

Yang perlu diketahui:

- **Artefak.** Bila ada `dist/` hasil `sh scripts/build-release.sh`, `bun start` memakai itu (binary api terkompilasi + web terbundel); kalau tidak, ia memakai `apps/web/build` + sumber api — hasil `bun run build`. Jadi `bun run build` **wajib** dulu; pesan galat menyebutkannya.
- **Migrasi tetap eksplisit** (Q-4): `bun start` tidak menyentuh skema. Cek kesiapan kapan saja: `bun --env-file=.env.prod apps/api/src/index.ts preflight` (§8b).
- **`/metrics` tidak dirutekan** gateway (M-6) — ambil dari `http://127.0.0.1:3001/metrics`, tidak pernah publik.
- **Kompresi** diminta *identity* ke upstream (aset prakompres `.br`/`.gz` tidak terpakai); kompresi publik urusan nginx/apache (`gzip on`, `mod_deflate`).
- **Tidak ada `--scale api=N` dan tidak ada rollout tanpa downtime**: restart berarti jeda beberapa detik. Kalau itu penting, pakai §8a (Docker) atau §8c (dua unit systemd + Caddy).
- **Form 403 "Cross-site POST form submissions are forbidden" / "Permintaan ditolak oleh proteksi CSRF"**: origin yang dikirim browser tidak ada di `APP_ORIGIN`. Gejalanya khas — tema, bahasa, login dan reset kata sandi (form POST biasa) gagal sementara tombol ber-AJAX jalan. Tambahkan origin publik Anda ke `APP_ORIGIN` (mis. `APP_ORIGIN=https://app.example.com`) lalu jalankan ulang; log web menuliskan satu baris `warn` berisi `seen`, `allowed` dan `derived` sehingga jelas origin mana yang ditolak. Dengan **satu** entri di `APP_ORIGIN`, `bun start` sekalian menyetel `ORIGIN` untuk proses web — tautan absolut (redirect_uri Google, e-mail) ikut benar tanpa mengandalkan header proxy. Proxy depan tetap sebaiknya mengirim `X-Forwarded-Proto` dan `X-Forwarded-Host` (contoh di atas).
- **Proses induk harus dijaga**: `pm2 start bun --name dab -- start`, `screen`, atau satu unit systemd (`WorkingDirectory=` checkout Anda, `ExecStart=/usr/local/bin/bun start`, `EnvironmentFile=/etc/dab/api.env`). `SIGTERM` ke `bun start` menghentikan kedua anak dengan rapi (SIGTERM, tunggu ≤ 25 s), dan bila salah satu anak mati sendiri seluruh perintah keluar — supaya supervisor menyalakannya ulang.

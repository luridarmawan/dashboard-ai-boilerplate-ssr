# Dashboard AI Boilerplate (SSR)

Boilerplate dashboard multi-tenant yang **modular**, ter-SSR, dan siap dipasang di satu VPS: Bun + Elysia (API) dan SvelteKit (web), MySQL/MariaDB/PostgreSQL, RBAC, konfigurasi runtime, tema & layout bertukar, modul AI, landing komersil, dan penjaga CI yang membuktikan modularitas alih-alih menjanjikannya.

| Dokumen | Isi |
|---|---|
| [`docs/PRD.md`](./docs/PRD.md) | Kebutuhan produk, keputusan arsitektur, 16 titik perluasan modul, kriteria terima §8 |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Urutan milestone M0–M7 dengan gate keluar |
| [`docs/MODULES.md`](./docs/MODULES.md) | **Membangun modul** — `bun modgen`, kontrak tiap berkas, repositori terpisah, penjaga CI |
| [`docs/Build-Module-for-Boilerplate.md`](./docs/Build-Module-for-Boilerplate.md) | **Tutorial** langkah demi langkah: modul untuk produk ini, di dalam repo ini |
| [`docs/Build-Module-for-Your-Apps.md`](./docs/Build-Module-for-Your-Apps.md) | **Tutorial** langkah demi langkah: modul di repositori Anda sendiri, termasuk repo privat |
| [`docs/THEMES.md`](./docs/THEMES.md) | Tema, layout, set ikon; tema dari modul; editor tema kustom di UI admin |
| [`docs/WEBHOOKS.md`](./docs/WEBHOOKS.md) | Webhook keluar: event inti tenant sebagai POST bertanda tangan, percobaan ulang, riwayat |
| [`docs/AI.md`](./docs/AI.md) | Modul AI: provider OpenAI-compatible (satu atau banyak profil dengan daftar harga), streaming, tool modul, log, analitik biaya & retensi |
| [`docs/MCP.md`](./docs/MCP.md) | MCP server di `/v1/mcp`, token API bearer, dan MCP client (server MCP eksternal untuk asisten) |
| [`docs/DEPLOY.md`](./docs/DEPLOY.md) | **Deploy ke VPS kosong sampai HTTPS**, backup/restore, operasi harian |
| [`docs/RELEASE-CHECKLIST.md`](./docs/RELEASE-CHECKLIST.md) | 25 kriteria terima: mana yang dibuktikan CI, mana yang manual |

## Mulai dalam 5 menit

Prasyarat: [Bun](https://bun.sh) 1.4+, Docker (untuk database). Tidak ada yang lain yang dipasang di host.

```bash
bun install
cp .env.example .env                 # nilai bawaan sudah cocok dengan compose.yml
docker compose up -d                 # MySQL 8 di port 33306
bun run --cwd packages/db migrate    # migrasi ter-versi — jalur yang sama dengan produksi
bun run db:seed                      # tenant default, grup sistem, superadmin dari BOOTSTRAP_ADMIN_*
bun dev                              # http://127.0.0.1:5173  (API di :3001, OpenAPI di /docs)
```

Masuk dengan `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` dari `.env`. Halaman `/` menyajikan landing modul `Example`; dashboard ada di `/dashboard`.

## Peta repositori

```
apps/api        Elysia — auth, tenancy, RBAC, konfigurasi, outbox email, OpenAPI, Eden client
apps/web        SvelteKit — SSR, layout & tema, FormBuilder/DataTable, halaman core; shim modul di-generate
packages/       db (deskriptor netral → 3 dialect), auth, contracts, settings, ui-theme, i18n, mail, logger, module-kit, runtime
modules/        Example (landing + CRUD), AI (chat, log, job), Dummy (tema/layout/ikon) — semuanya lewat kontrak modul
modules.json    Satu-satunya berkas core yang disentuh saat menambah modul
deploy/         Caddyfile, nginx.conf.example, backup.sh / restore.sh
scripts/        modgen, modules:add, proof gate M1–M6, penjaga CI
```

## Perintah yang sering dipakai

| Perintah | Guna |
|---|---|
| `bun dev` | API + web dengan reload, `modules:sync` otomatis |
| `bun run check` | lint (Biome) + typecheck semua paket, kedua dialect |
| `bun run test:unit` · `bun run test:integration:docker` | unit tanpa `.env`; integrasi dengan MySQL di Docker |
| `bun run proof:m1:docker` | seluruh bukti gate M1–M6 lewat HTTP tanpa browser (`PROOF_ONLY=M4` untuk satu saja) |
| `bun run proof:e2e:docker` | E2E Playwright (landing → login → CRUD → chat) di container |
| `bun modgen <Nama> --fields "name:string!,qty:number"` | modul CRUD lengkap yang langsung jalan |
| `bun create module ../mod-x` | repositori modul standalone dengan harness sendiri |
| `bun modules:add <git-url> --ref <tag>` | pasang modul dari repositori lain |
| `bun modules:remove <Nama>` | uninstall bersih: lepas registrasi, hapus folder/submodule, migrasi turun untuk tabelnya (G-15) |
| `bun run db:generate` | migrasi baru (mysql + pg) setelah mengubah tabel |
| `bun run db:matrix:docker` | migrasi + smoke di MySQL 8, MariaDB 11, PostgreSQL 16 |

## Cara mengubah hal-hal yang paling sering ditanyakan

- **Membuat modul** — mulai dari tutorialnya: [di dalam repo ini](./docs/Build-Module-for-Boilerplate.md) (`bun modgen`) atau [di repositori sendiri](./docs/Build-Module-for-Your-Apps.md) (`bun create module`, dipasang sebagai submodule terkunci). Kontrak lengkap tiap berkas: [`docs/MODULES.md`](./docs/MODULES.md).
- **Menambah tema / layout / set ikon** — dari modul (`themes/<id>/`, `layouts.ts`, `icons.ts`), tanpa menyentuh core: [`docs/THEMES.md`](./docs/THEMES.md) dan `modules/Dummy`. Tema **kustom tanpa deploy**: admin merakitnya di **Tema kustom** (`/themes`) dari token, set ikon, dan layout terdaftar; wajib lolos kontras AA. Tema baku dan allowlist diatur di **Pengaturan → Aplikasi**.
- **Mengganti landing page** — **Pengaturan → Aplikasi → Halaman depan (anonim)** (`app.landing_route`), berlaku seketika tanpa restart; route yang tidak ada ditolak saat disimpan. Kosongkan kolomnya untuk kembali ke `LANDING_ROUTE` di `.env` (fallback bootstrap, baku `/example`). Bila `/` tetap menampilkan halaman depan bawaan, route pilihan itu tidak bisa dirender — modulnya nonaktif untuk tenant itu, atau routenya sudah tidak ada; alasannya tercatat sebagai peringatan di log web, dan `curl -I /` menunjukkan header `x-landing-route` saat forwarding berhasil. Modul mana pun boleh menyumbang halaman publik (`public.ts`).
- **Mengganti judul & footer** — `APP_LANDING_TITLE`, `APP_LANDING_LEAD`, dan `APP_FOOTER_TITLE` di `.env` / `.env.prod` menimpa `landing.title`, `landing.lead`, dan `shell.footer` di semua bahasa; `APP_LANDING_TITLE` sekaligus menjadi judul dokumen OpenAPI di `/docs`. Nama dan logo per tenant tetap di **Pengaturan → Aplikasi**.
- **Mengganti provider AI** — **Pengaturan → AI**: base URL OpenAI-compatible, kunci API (tidak pernah dikirim ke klien), model. Beberapa provider/model sekaligus dengan harga per model: **Penyedia AI** (`/m/ai/providers`), dipilih per percakapan; biaya dan token per hari/model/pengguna di **Analitik AI**. Rincian di [`docs/AI.md`](./docs/AI.md). Provider tiruan untuk pengembangan: `bun run ai:mock`.
- **Menyambungkan Claude Desktop / Claude Code (MCP)** — buat token di **Profil → Token API**, lalu `claude mcp add --transport http dashboard https://<domain>/v1/mcp --header "Authorization: Bearer <token>"`. Tool yang tampil adalah `api/tools.ts` modul, sebatas izin user: [`docs/MCP.md`](./docs/MCP.md).
- **Antrean pekerjaan** — `enqueue()` untuk pekerjaan ad-hoc di luar request (prioritas, tunda, dedupe), percobaan ulang dengan backoff, dead-letter yang bisa diulang dari halaman **Antrean pekerjaan**; aman di multi-instance tanpa Redis. Lihat [`docs/MODULES.md`](docs/MODULES.md).
- **Katalog modul** — `bun modules:search` menelusuri katalog (`modules.catalog.json` atau URL bersama), `bun modules:install <Nama>` memasang dari sana lewat submodule terkunci; halaman Modul menampilkan status dan perintahnya. Lihat [`docs/MODULES.md` §7c](docs/MODULES.md).
- **Bahasa & arah tulisan** — `id` dan `en` bawaan, bahasa lain cukup berkas JSON; bahasa kanan-ke-kiri otomatis mendapat `dir="rtl"` di server, dan **Pratinjau RTL** di halaman Bahasa memaksanya untuk menguji tema/layout. Komponen memakai kelas CSS logis (`ms-`, `pe-`, `text-start`, …), bukan `ml-`/`text-left`.
- **Lampiran & cabang percakapan** — kirim gambar/teks bersama pesan chat (privat, milik pengirim), buat ulang jawaban, atau ubah pesan lama menjadi cabang baru dan berpindah antar versi. Lihat [`docs/AI.md`](docs/AI.md).
- **Chat mengambang** — tombol asisten AI di pojok kanan bawah setiap halaman dasbor (izin `ai.chat.create`); jawabannya streaming dan tahu halaman yang sedang dibuka (breadcrumb, URL, teks yang disorot), tanpa meninggalkan halaman. Lihat [`docs/AI.md`](docs/AI.md).
- **Impersonasi (superadmin)** — di halaman detail pengguna, **Masuk sebagai …** membuka dasbor seperti yang dilihat pengguna itu selama 1 jam: cookie kedua `dab_impersonate` di samping sesi admin sendiri, banner merah di setiap halaman dengan tombol **Berhenti**, tercatat di audit (`user.impersonate_start`/`_stop`). Selama impersonasi kata sandi dan 2FA pengguna tidak bisa diubah.
- **2FA TOTP** — setiap pengguna mengaktifkannya sendiri di **Profil → Autentikasi dua faktor** (QR untuk aplikasi autentikator, 10 kode pemulihan sekali pakai); login lalu meminta kode sebagai langkah kedua. Admin dengan `user.edit` bisa mereset 2FA pengguna yang terkunci.
- **Masuk dengan Google (A-8)** — tombol di halaman masuk begitu admin mengaktifkannya di **Pengaturan → Keamanan** (client id + secret dari Google Cloud Console, atau `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` di `.env` sebagai bootstrap; *authorised redirect URI* = `<origin>/auth/google/callback`). Alur authorization code + PKCE sepenuhnya di server, tanpa JavaScript; akun ditautkan lewat `sub` Google (tabel `oauth_accounts`), email terverifikasi yang sudah terdaftar ditautkan otomatis, akun baru hanya dibuat bila **Buat akun otomatis dari Google** menyala, dan **Domain email yang diizinkan** membatasi siapa yang boleh masuk. 2FA tetap diminta bila pengguna mengaktifkannya
- **Undangan per tenant (A-13)** — di **Pengguna → Undang lewat email** admin mengundang alamat email; tautan `/join/<kode>` berlaku sesuai **Pengaturan → Keamanan → Masa berlaku tautan undangan** (baku 72 jam) dan tetap bisa dipakai walau `SIGNUP_ENABLED=false`. Email yang sudah terdaftar tidak diundang ulang: akunnya ditambahkan ke tenant dan dikirimi informasi untuk masuk. Undangan yang menunggu bisa dicabut
- **Unggah berkas** — `POST /v1/files` dengan validasi ukuran/tipe dari **Pengaturan → Berkas**; modul memakai `storeUpload()` dari `@app/api/files`. Bawaan tersimpan di volume `uploads`; ganti ke bucket S3-compatible cukup dengan `STORAGE_DRIVER=s3` + `S3_*` ([`docs/DEPLOY.md`](./docs/DEPLOY.md) §3). Logo dan favicon tema diunggah dari editor tema; foto profil dari halaman Profil (`PUT /v1/users/profile/avatar`, publik dan berlaku lintas tenant).
- **Notifikasi dalam aplikasi** — bel di header dan halaman `/notifications`; modul mengirim lewat `notify()` dari `@app/api/notifications` (penerima eksplisit atau semua pemegang sebuah izin): [`docs/MODULES.md`](./docs/MODULES.md) §3.
- **Email** — isi `SMTP_*` dan `MAIL_FROM_*` di `.env` untuk bootstrap, atau di **Pengaturan → Email** (nilai yang terisi di Pengaturan menang per kolom). Semua email lewat outbox dengan retry; tanpa SMTP di luar production, email dicetak ke log. Uji kredensial `.env` tanpa database: `bun run mail:test --to anda@contoh.id`.
- **Konfigurasi runtime lain** (bahasa, retensi log, keamanan) — di **Pengaturan**, tersimpan di database per tenant dengan fallback global; `.env` hanya untuk bootstrap.
- **Pemantauan** — `GET /metrics` (Prometheus) di tiap proses api: laju request, latensi, error, pool DB, job, hook, metrik modul; `dc --profile monitoring up -d` menjalankan Prometheus di samping stack ([`docs/DEPLOY.md`](./docs/DEPLOY.md) §7a).
- **Deploy** — [`docs/DEPLOY.md`](./docs/DEPLOY.md): `compose.prod.yml` dengan Caddy (TLS otomatis), `--scale api=N`, backup harian, restore satu perintah. Upgrade **tanpa downtime**: `sh deploy/upgrade.sh`; cek kesiapan kapan saja: `dc run --rm preflight`; tanpa Docker: unit systemd di `deploy/systemd/`.

## Menjalankan dan menguji tanpa Docker

Docker hanya dipakai untuk database di dev dan untuk paket produksi. Semua yang lain adalah `bun` biasa, jadi dengan MySQL 8 / MariaDB 11 / PostgreSQL 16 yang sudah terpasang di mesin (atau di server lain) Anda bisa lewati Docker sepenuhnya.

```bash
# 1. database: buat user + database sekali (contoh MySQL/MariaDB lokal)
mysql -uroot -p -e "CREATE DATABASE app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'app'@'%' IDENTIFIED BY 'app'; GRANT ALL ON app.* TO 'app'@'%';"

# 2. env: arahkan ke database itu (port bawaan 3306, bukan 33306 milik compose)
cp .env.example .env
#   DATABASE_URL=mysql://app:app@127.0.0.1:3306/app      (atau postgres://… dengan DB_DIALECT=postgres)

# 3. siapkan & jalankan
bun install
bun run bootstrap                 # codegen skema untuk dialect di .env + rakit modul
bun run db:migrate                # migrasi ter-versi
bun run db:seed                   # tenant, grup, superadmin dari BOOTSTRAP_ADMIN_*
bun dev                           # http://127.0.0.1:5173 (API :3001)
```

Pengujian, semuanya tanpa container:

| Perintah | Butuh | Yang diuji |
|---|---|---|
| `bun run test:unit` | tidak ada (tanpa `.env` pun jalan) | util, RBAC, tenant guard, resolver tema/route, sync modul, config |
| `bun run test:integration` | `DATABASE_URL` yang sudah dimigrasi | API nyata lewat `app.handle`: auth, tenancy, RBAC, CRUD, konfigurasi, outbox, AI (mock in-process), retensi |
| `BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_PASSWORD='…' sh scripts/ci/m1-proof.sh` | database ter-seed | membangun web, menyalakan mock AI + API + web, lalu bukti gate M1–M6 lewat HTTP tanpa browser. `PROOF_ONLY=M4,M6` untuk sebagian |
| `E2E=1 PROOF_ONLY=M5,E2E sh scripts/ci/m1-proof.sh` | + `cd apps/web && bunx playwright install chromium` | E2E browser: landing → login → CRUD → chat |
| `bun run scheduler:proof` | database ter-migrasi | job berjalan tepat sekali per interval di 3 instance |
| `bun run mail:test [--to alamat]` | `SMTP_*` + `MAIL_FROM_*` di `.env` | koneksi, TLS, autentikasi SMTP, lalu satu email uji ke alamat itu (`--verify-only` tanpa mengirim) |
| `PROOF_MODE=native sh scripts/ci/backup-restore-proof.sh` | `mysqldump`/`mysql` (atau `pg_dump`/`psql`) di PATH | backup → hapus database → restore → aplikasi utuh |
| `bun run ci:bundle-secrets` | tidak ada | tidak ada rahasia di bundle klien |
| `bun run check` · `bun run theme:validate` · `bun run ci:modgen-guard` · `bun run ci:cross-repo` | tidak ada (cross-repo butuh jaringan untuk `bun install` di clone) | lint, typecheck dua dialect, kontrak tema, penjaga modularitas |

Ini persis yang dijalankan job CI (`.github/workflows/ci.yml`) — di runner GitHub database berjalan sebagai service, sisanya `bun` native. Menjalankan **produksi** tanpa Docker (proses `bun apps/api/src/index.ts` — atau binary hasil `bun build --compile apps/api/src/index.ts --outfile api`, lihat `docs/DEPLOY.md` §5 — dan `bun apps/web/build/index.js` di bawah systemd, Apache/Nginx di depan) dimungkinkan dengan env yang sama seperti `compose.prod.yml`, tetapi unit systemd dan `preflight`-nya adalah pekerjaan P1 (Q-11, Q-13) yang belum disediakan.

## Prinsip yang dijaga CI

Menambah atau mencabut modul tidak mengubah berkas core (`ci:modgen-guard`, `ci:cross-repo`); sync modul yang tercatat adalah no-op (`ci:sync-pure`); tanpa modul AI aplikasi tetap ter-build (`proof:m5:gate4`); tidak ada rahasia di bundle klien (`ci:bundle-secrets`); suite yang sama lulus di tiga dialect; backup → hapus database → restore diuji setiap push.

Lisensi: **internal, bukan sumber terbuka** — lihat [`LICENSE`](./LICENSE); `"license": "UNLICENSED"` di setiap `package.json`. Kontribusi: gaya kode diatur Biome (`bun run lint`). Komentar kode berbahasa Inggris, dokumen dan teks antarmuka berbahasa Indonesia.

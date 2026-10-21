# Security Policy

🇬🇧 English (default) · [🇮🇩 Bahasa Indonesia](#kebijakan-keamanan)

## Supported Versions

This project has not reached its first stable release yet (the current tag is
`v0.0.0-rc1`). Until then:

| Branch / release        | Supported |
|-------------------------|-----------|
| `main` (latest commit)  | Yes       |
| Latest tagged release   | Yes       |
| Anything older          | No        |

Security fixes land on `main` and in the next tagged release. Please update to
the latest commit before reporting an issue that may already be fixed.

## Reporting a Vulnerability

**Do not open a public issue.** Report privately through GitHub Security
Advisories:

https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr/security/advisories/new

Please include:

- Steps to reproduce, or a minimal proof of concept (an HTTP request sequence
  is ideal, since every flow is also reachable without JavaScript).
- The commit or tag you tested (`git rev-parse HEAD`), the database dialect
  (MySQL, MariaDB, PostgreSQL, SQLite), and whether the API ran as a single
  instance or scaled behind the proxy.
- Which part is affected: core API (`apps/api`), web app (`apps/web`), a
  shared package (`packages/*`), or a bundled module (`modules/*`).
- The impact you believe it has.

We aim to acknowledge reports within 5 working days. This project is
maintained by volunteers on a best-effort basis, so fix timelines may vary.
We will coordinate public disclosure with you once a fix is available.

## Scope

The following are considered security vulnerabilities:

- Bypassing authentication: forging or stealing the session cookie, the
  bearer API tokens (including the app sign-in token and its refresh window),
  or the two-factor challenge.
- Bypassing CSRF protection on any state-changing endpoint, including the
  structural exemptions for bearer requests and module-declared callback
  routes, or using such a route to ride an existing session.
- Bypassing role permissions or tenant isolation, including through the MCP
  server, AI tool calls, scheduled jobs, or admin impersonation.
- Server-side secrets reaching the browser bundle, or configuration fields of
  type `secret` being returned in clear text.
- A module escaping its namespace (tables, API paths, pages, permissions)
  or altering core behaviour during `modules:sync` beyond what the module
  contract allows.
- Bypassing the login rate limit, the file-upload restrictions, or the
  signature checks on incoming or outgoing webhooks.
- Injection (SQL, command, template, prompt-to-tool) reachable through core
  endpoints or the bundled `AI` and `Example` modules.

The following are **not** considered vulnerabilities in this project:

- Secrets that a deployer puts into their own `.env`, database, or compose
  files, or leaves at the example defaults. See the notes below.
- Deployments that skip the HTTPS reverse proxy, resource limits, or backup
  steps described in `docs/DEPLOY.md`.
- Third-party modules installed by the deployer. Modules are assembled at
  build time and run inside the same process as the core; review them as you
  would any dependency.
- Bugs in third-party dependencies. Report them upstream; we will bump the
  version once a patch is released (the release checklist already requires a
  clean `bun audit` at the high level).
- Issues that require a compromised host, database, or Redis instance.

## Notes for Deployers

- Never commit `.env`, `.env.prod`, or any other `.env.*` file except the
  `*.example` ones. They are already listed in `.gitignore`, as are
  `backups/` and the local upload directory `data/`.
- `.env` holds only what is needed before the database can be read: the
  database DSN, Redis, ports, mode, and bootstrap fallbacks. Everything else
  lives in the database and is edited from the admin UI.
- Change `BOOTSTRAP_ADMIN_PASSWORD` before the first start, and rotate the
  database, AI provider, Google, SMTP, MQTT, and S3 credentials you fill in.
- Only variables prefixed `PUBLIC_` reach the browser. Never put a secret in
  one; CI fails the build if a private value shows up in the client bundle.
- Set `APP_ORIGIN` to the exact origins you serve. Cross-origin requests are
  rejected based on it.
- Disable self-registration (`SIGNUP_ENABLED=false`) if the dashboard is not
  meant to be open to the public.
- Review each module before adding it to `modules.json`; modules run with the
  same permissions as the core. See `docs/MODULES.md`.

---

# Kebijakan Keamanan

[🇬🇧 English](#security-policy) · 🇮🇩 Bahasa Indonesia

## Versi yang Didukung

Proyek ini belum mencapai rilis stabil pertama (tag saat ini `v0.0.0-rc1`).
Sampai saat itu:

| Branch / rilis           | Didukung |
|--------------------------|----------|
| `main` (commit terbaru)  | Ya       |
| Rilis bertag terakhir    | Ya       |
| Yang lebih lama          | Tidak    |

Perbaikan keamanan masuk ke `main` dan ke rilis bertag berikutnya. Harap
perbarui ke commit terbaru sebelum melaporkan masalah yang mungkin sudah
diperbaiki.

## Melaporkan Kerentanan

**Jangan membuka issue publik.** Laporkan secara privat melalui GitHub
Security Advisories:

https://github.com/luridarmawan/dashboard-ai-boilerplate-ssr/security/advisories/new

Sertakan:

- Langkah reproduksi atau proof of concept minimal (urutan request HTTP
  paling ideal, karena setiap alur juga bisa dijalankan tanpa JavaScript).
- Commit atau tag yang diuji (`git rev-parse HEAD`), dialect database (MySQL,
  MariaDB, PostgreSQL, SQLite), dan apakah API berjalan satu instance atau
  di-scale di belakang proxy.
- Bagian yang terdampak: API inti (`apps/api`), aplikasi web (`apps/web`),
  paket bersama (`packages/*`), atau modul bawaan (`modules/*`).
- Dampak yang Anda perkirakan.

Kami menargetkan respons awal dalam 5 hari kerja. Proyek ini dirawat secara
sukarela dengan upaya terbaik, sehingga waktu perbaikan dapat bervariasi.
Pengumuman publik akan kami koordinasikan dengan Anda setelah perbaikan
tersedia.

## Cakupan

Yang dianggap kerentanan keamanan:

- Menembus autentikasi: memalsukan atau mencuri cookie sesi, token API
  bearer (termasuk token masuk aplikasi dan jendela perpanjangannya), atau
  tantangan dua faktor.
- Menembus proteksi CSRF pada endpoint pengubah state mana pun, termasuk
  pengecualian struktural untuk request bearer dan route callback yang
  dideklarasikan modul, atau memakai route semacam itu untuk menumpangi sesi
  yang ada.
- Menembus izin peran atau isolasi tenant, termasuk lewat MCP server,
  pemanggilan tool AI, job terjadwal, atau impersonasi admin.
- Rahasia sisi server sampai ke bundle browser, atau field konfigurasi
  bertipe `secret` dikembalikan dalam bentuk asli.
- Modul yang keluar dari namespace-nya (tabel, path API, halaman, izin) atau
  mengubah perilaku core saat `modules:sync` melebihi yang diizinkan kontrak
  modul.
- Menembus rate limit login, pembatasan unggah berkas, atau pemeriksaan tanda
  tangan webhook masuk maupun keluar.
- Injeksi (SQL, perintah, template, prompt ke tool) yang bisa dicapai lewat
  endpoint inti atau modul bawaan `AI` dan `Example`.

Yang **bukan** kerentanan pada proyek ini:

- Rahasia yang ditaruh deployer di `.env`, database, atau berkas compose
  miliknya sendiri, atau dibiarkan pada nilai contoh. Lihat catatan di bawah.
- Deployment yang melewatkan reverse proxy HTTPS, batas resource, atau
  langkah backup yang dijelaskan di `docs/DEPLOY.md`.
- Modul pihak ketiga yang dipasang deployer. Modul dirakit saat build dan
  berjalan di proses yang sama dengan core; tinjau seperti dependensi lain.
- Bug pada dependensi pihak ketiga. Laporkan ke upstream; kami akan menaikkan
  versi setelah patch dirilis (daftar periksa rilis sudah mewajibkan
  `bun audit` bersih pada tingkat tinggi).
- Masalah yang memerlukan host, database, atau instance Redis yang sudah
  dikuasai penyerang.

## Catatan untuk Deployer

- Jangan pernah commit `.env`, `.env.prod`, atau berkas `.env.*` lain selain
  yang berakhiran `*.example`. Semuanya sudah ada di `.gitignore`, begitu
  juga `backups/` dan direktori unggahan lokal `data/`.
- `.env` hanya memuat hal yang dibutuhkan sebelum database bisa dibaca: DSN
  database, Redis, port, mode, dan fallback bootstrap. Selebihnya tersimpan di
  database dan diubah dari UI admin.
- Ganti `BOOTSTRAP_ADMIN_PASSWORD` sebelum start pertama, dan rotasi
  kredensial database, provider AI, Google, SMTP, MQTT, dan S3 yang Anda isi.
- Hanya variabel berawalan `PUBLIC_` yang sampai ke browser. Jangan pernah
  menaruh rahasia di sana; CI menggagalkan build bila nilai privat muncul di
  bundle klien.
- Isi `APP_ORIGIN` dengan origin persis yang Anda layani. Request lintas
  origin ditolak berdasarkan nilai itu.
- Matikan pendaftaran mandiri (`SIGNUP_ENABLED=false`) bila dashboard tidak
  dimaksudkan terbuka untuk umum.
- Tinjau setiap modul sebelum menambahkannya ke `modules.json`; modul berjalan
  dengan izin yang sama dengan core. Lihat `docs/MODULES.md`.

# BRIEF.md — App Boillerplate

Ringkasan kerja repositori ini. Sumber kebenaran tetap [`docs/PRD.md`](./docs/PRD.md) (v2.0), dengan [`docs/ROADMAP.md`](./docs/ROADMAP.md) untuk urutan pengerjaan dan [`docs/THEMES.md`](./docs/THEMES.md) untuk spesifikasi tema. Kalau brief ini berbeda dari PRD, PRD yang menang.

## 1. Apa yang dibangun

Boilerplate **dashboard admin ber-AI** yang dipakai sebagai template proyek baru — bukan produk SaaS, bukan CMS, bukan page builder. Greenfield, tidak ada kewajiban kompatibilitas ke belakang.

Lima tujuan produk: **API-first · SSR · Modular · Database-agnostic · Self-hosted**.

## 2. Stack & topologi

| | |
|---|---|
| Runtime | Bun |
| API | Elysia + TypeBox → OpenAPI 3.1 otomatis (`apps/api`) |
| Web | SvelteKit SSR + shadcn-svelte + Tailwind (`apps/web`) |
| Klien API | Eden Treaty (typed) |
| ORM | Drizzle |
| DB | MySQL 8 (baku) · MariaDB 11 · PostgreSQL 16 — ketiganya tier-1 di CI |
| Cache/sesi | Database (baku); Redis/Valkey **opsional** |
| Deploy | Docker Compose + Caddy di satu VPS (2 vCPU / 4 GB) |

`apps/api` adalah proses berdiri sendiri, **bukan** route handler SvelteKit. Web adalah konsumen pertama API-nya sendiri. Satu domain, satu origin: `/` → web, `/v1/*` → api, `/docs` → api.

Struktur: `apps/{web,api}` · `packages/{db,contracts,config,module-kit,ui-theme}` · `modules/` · `modules.json` · `scripts/`.

## 3. Aturan yang tidak boleh dilanggar

Ini pantangan desain (PRD §1.3) — pelanggarannya adalah cacat, bukan preferensi gaya.

1. **Tidak ada state bersama di memori proses.** Sesi, cache konfigurasi, rate limit, token CSRF → database atau Redis lewat adapter. Adapter memori murni menolak start di `NODE_ENV=production`. Uji `--scale api=3` dijalankan **tanpa** Redis. Konsekuensi yang mudah terlewat: **job terjadwal wajib mengambil lock lewat database**, supaya `--scale api=3` tidak menjalankannya tiga kali (G-18).
2. **Rahasia tidak pernah ke bundle klien.** Hanya `PUBLIC_*` yang boleh sampai ke browser (`$env/static/private` vs `$env/static/public`). Dicek otomatis di CI.
3. **Satu instance koneksi DB**, diekspor dari `packages/db`. Lint melarang instansiasi di tempat lain.
4. **SSR wajib.** Alur inti (login, CRUD, pemilih tema & bahasa, form kontak) berfungsi tanpa JavaScript lewat form actions.
5. **Kontrak API bukan turunan.** Skema TypeBox ditulis bersama route → validasi + tipe + OpenAPI dari satu definisi. Tidak ada dokumen yang ditulis manual.
6. **CSRF berlaku di semua endpoint yang mengubah state.** Endpoint publik ditandai allowlist eksplisit, bukan dengan mematikan middleware.
7. **Skema netral dialect.** Deskriptor di `packages/db/schema/*.def.ts` → `bun db:codegen` menghasilkan skema per dialect. SQL mentah dilarang di kode domain.
8. **Registrasi modul simetris.** Satu perintah `bun modules:sync` mengurus API + web + DB + menu + izin + tema + i18n sekaligus.

## 4. Modularitas — janji utama produk

**Core tertutup untuk modifikasi, terbuka untuk perluasan.** Developer harus bisa membangun modul lengkap (tabel, API, halaman, menu, izin, konfigurasi, tema, layout, tool AI) **tanpa menyentuh satu baris kode core**, dari repositori yang berbeda. Core tidak boleh tahu nama modul mana pun.

> Kalau sebuah kebutuhan modul memaksa perubahan di core, itu **cacat pada kontrak modul**. Yang diperbaiki adalah kontraknya — jangan ditambal di core.

- Bentuk modul & **16 titik perluasan**: PRD §4.5. Daftar itu tertutup. Tiga di antaranya adalah kontrak fondasi yang dibangun di M0: **event bus** (G-17), **penjadwal core** (G-18), dan **registry widget dashboard** (G-19).
- Modul dirakit **saat build** (`bun modules:sync`), bukan ditemukan saat runtime.
- Sumber modul di `modules.json`: `local` / `submodule` (baku untuk lintas repo, `ref` selalu tag/commit) / `package`.
- `@core/*` harus **paket nyata**, bukan alias tsconfig — kalau tidak, modul eksternal gagal dibangun sendiri.
- Namespace divalidasi saat sync: tabel `<nama>_*`, API `/v1/m/<nama>/*`, halaman `/m/<nama>/*`, izin & i18n & tema `<nama>.*`. Bentrokan ditolak dengan pesan yang menyebut kedua modul.
- Dua modul dogfooding wajib: **`AI`** (chat streaming, berat & internal) dan **`Example`** (CRUD referensi + landing page komersil publik, isi baku `/`). Keduanya memakai kontrak yang sama dengan modul pihak ketiga — tanpa jalur istimewa.
- Penjaga CI (G-6): jalankan `modgen`, lalu `git diff` hanya boleh menyentuh `modules/`, `modules.json`, dan direktori hasil generate.

## 5. Tema = paket presentasi, bukan palet

Satu tema menetapkan **token** (warna, radius, tipografi) + **set ikon** + **layout** + **aset merek**. Minimal 4 tema bawaan, minimal dua di antaranya berbeda layout **dan** set ikon.

- Semua warna lewat token semantik CSS. Tidak ada warna hardcoded — ditegakkan lint.
- Semua ikon lewat nama semantik `<Icon name="save" />`. Impor glyph langsung ditolak lint; set ikon yang tidak menutup seluruh nama terdaftar **menggagalkan build di CI**.
- Layout mengisi **region bernama** (`brand`, `nav`, `header`, `breadcrumb`, `content`, `aside`, `footer`) untuk tiga jenis shell: `dashboard` / `public` / `auth`. Layout **tidak mengambil data sendiri** — semuanya props dari `load` core — dan tidak tahu nama modul mana pun.
- Halaman hanya mengisi region `content` dan menyebut **varian semantik** (`layoutVariant: 'wide' | 'focused' | …`), bukan id layout konkret. Tema yang memetakan varian → layout. Varian tak terpetakan jatuh ke `default` dengan peringatan, bukan galat.
- Resolusi tema & layout terjadi **di server saat SSR** — tanpa kedipan, tanpa pergeseran tata letak.
- Tema **tidak boleh**: mengganti implementasi komponen, menambah/mengubah route, mengubah data atau perilaku, atau mem-bypass RBAC.

## 6. Data & tenancy

- **Isolasi tenant per kolom `client_id`, satu database untuk seluruh tenant.** Tidak ada DB/schema/koneksi per tenant. Indeks tabel ber-tenant **selalu diawali `client_id`**.
- Karena tidak ada batas fisik, **penjaga tenant ada di lapisan data**: filter `client_id` disuntikkan repository, bukan diserahkan ke handler. Query lintas-tenant yang disengaja wajib lewat `unsafeAcrossTenants()` yang mudah di-grep.
- **PK = UUIDv7 (RFC 9562), di-generate aplikasi dari satu fungsi tunggal** di `packages/db`. Dilarang: `DEFAULT (UUID())` di DDL, generator lokal di modul, tipe `UUID` native MariaDB.
- Portabilitas tipe (wajib): timestamp selalu UTC · enum = `varchar` + constraint aplikasi (bukan enum native) · JSON tidak pernah di-query dan tidak diindeks · uang = `decimal(18,4)` · charset/collation ditulis eksplisit, tidak pernah mewarisi dari server.
- Dilarang karena tidak portabel: `RETURNING` di MySQL, partial index, `ON CONFLICT` gaya PG, kolom array, full-text khusus dialect, SEQUENCE & system-versioned table MariaDB.
- Hapus lunak seragam (`status_id` + `deleted_at`); semantik `status_id` didefinisikan sekali sebagai konstanta bersama.
- Tabel core & modul: PRD Lampiran B. Permukaan API baseline: Lampiran A.

## 7. Konfigurasi: `.env` vs database

`.env` **hanya** untuk yang dibutuhkan sebelum database bisa dibaca (koneksi DB/Redis, port, secret sesi, mode, fallback bootstrap). Selebihnya di database, per tenant dengan fallback global, diubah admin tanpa restart.

Contoh yang sering salah tempat: `app.landing_route` (isi `/` untuk anonim, baku `/m/example`) dan `app.home_route` (tujuan setelah login) ada di **database**; `LANDING_ROUTE` di `.env` hanya fallback bootstrap. Nilainya divalidasi terhadap registry route **saat disimpan** — route tidak ada ditolak di UI. Kalau modul pemiliknya dinonaktifkan, resolusi turun ke fallback aman + peringatan, **bukan 404 di `/`**.

## 8. Prioritas & urutan kerja

P0 (MVP) dikunci di PRD §5 — ide baru masuk P1/P2, tidak menggeser MVP. Milestone: **M0** fondasi & kontrak modul → **M1** identitas → **M2** UI/tema/layout → **M3** konfigurasi & kontrak API → **M4** modul `Example` & sisi publik → **M5** modul `AI` → **M6** modul lintas repositori → **M7** pengerasan & operasi. Detail per milestone di `docs/ROADMAP.md`.

Dua risiko tertinggi dibuktikan lebih dulu di M0, sebelum ada fitur dibangun di atasnya: portabilitas skema Drizzle lintas dialect, dan `@core/*` sebagai paket nyata untuk modul lintas repo.

## 9. Perintah baku

```
bun install && docker compose up -d && bun db:migrate && bun db:seed && bun dev
bun modules:sync              # generate registry (otomatis di predev/prebuild)
bun modules:add <git-url>     # pasang modul dari repo lain sebagai submodule
bun modgen                    # generator CRUD modul
bun create module             # starter repo modul standalone
bun db:codegen                # deskriptor -> skema Drizzle per dialect
bun db:migrate                # migrasi ter-versi — satu-satunya jalur produksi (Q-4)
bun db:push                   # schema-push, DEV SAJA; menolak jalan di production
bun check                     # lint + format + type-check
```

## 10. Definisi selesai

Setiap perubahan: lint + type-check + test lulus, tidak ada berkas core yang tersentuh oleh pekerjaan modul, dan tidak ada pantangan §3 di atas yang dilanggar. Kriteria terima MVP lengkap (25 butir) ada di PRD §8 — periksa ke sana sebelum menyatakan sebuah kebutuhan selesai.

Target yang mengikat pilihan desain: TTFB < 200 ms p95 · API p95 < 150 ms · JS awal < 150 KB (dashboard), < 60 KB (landing) · Lighthouse ≥ 90 termasuk SEO · WCAG 2.1 AA pada **setiap** tema bawaan · seluruh stack idle < 1,5 GB RAM di VPS 2 vCPU / 4 GB.

## 11. Yang masih terbuka

Pemilik registry harga model AI · aset merek per tema (token/ikon/layout sudah final) · gaya landing page `Example` (company profile vs e-commerce) · lisensi rilis template.

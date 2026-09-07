# Dashboard AI Boilerplate (SSR)

Boilerplate dashboard multi-tenant yang **modular**, ter-SSR, dan siap dipasang di satu VPS: Bun + Elysia (API) dan SvelteKit (web), MySQL/MariaDB/PostgreSQL, RBAC, konfigurasi runtime, tema & layout bertukar, modul AI, landing komersil, dan penjaga CI yang membuktikan modularitas alih-alih menjanjikannya.

| Dokumen | Isi |
|---|---|
| [`docs/PRD.md`](./docs/PRD.md) | Kebutuhan produk, keputusan arsitektur, 16 titik perluasan modul, kriteria terima §8 |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Urutan milestone M0–M7 dengan gate keluar |
| [`docs/MODULES.md`](./docs/MODULES.md) | **Membangun modul** — `bun modgen`, kontrak tiap berkas, repositori terpisah, penjaga CI |
| [`docs/THEMES.md`](./docs/THEMES.md) | Tema, layout, set ikon; cara menambah tema dari modul |
| [`docs/AI.md`](./docs/AI.md) | Modul AI: provider OpenAI-compatible, streaming, log & retensi |
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
| `bun run db:generate` | migrasi baru (mysql + pg) setelah mengubah tabel |
| `bun run db:matrix:docker` | migrasi + smoke di MySQL 8, MariaDB 11, PostgreSQL 16 |

## Cara mengubah hal-hal yang paling sering ditanyakan

- **Membuat modul** — `bun modgen`, lalu baca [`docs/MODULES.md`](./docs/MODULES.md). Di repositori sendiri: `bun create module`.
- **Menambah tema / layout / set ikon** — dari modul (`themes/<id>/`, `layouts.ts`, `icons.ts`), tanpa menyentuh core: [`docs/THEMES.md`](./docs/THEMES.md) dan `modules/Dummy`. Tema baku dan allowlist diatur admin di **Pengaturan → Aplikasi**.
- **Mengganti landing page** — **Pengaturan → Aplikasi → Route landing** (`app.landing_route`), berlaku seketika tanpa restart; route yang tidak ada ditolak saat disimpan. Modul mana pun boleh menyumbang halaman publik (`public.ts`).
- **Mengganti provider AI** — **Pengaturan → AI**: base URL OpenAI-compatible, kunci API (disimpan terenkripsi, tidak pernah dikirim ke klien), model. Rincian di [`docs/AI.md`](./docs/AI.md). Provider tiruan untuk pengembangan: `bun run ai:mock`.
- **Konfigurasi runtime lain** (SMTP, bahasa, retensi log, keamanan) — di **Pengaturan**, tersimpan di database per tenant dengan fallback global; `.env` hanya untuk bootstrap.
- **Deploy** — [`docs/DEPLOY.md`](./docs/DEPLOY.md): `compose.prod.yml` dengan Caddy (TLS otomatis), `--scale api=N`, backup harian, restore satu perintah.

## Prinsip yang dijaga CI

Menambah atau mencabut modul tidak mengubah berkas core (`ci:modgen-guard`, `ci:cross-repo`); sync modul yang tercatat adalah no-op (`ci:sync-pure`); tanpa modul AI aplikasi tetap ter-build (`proof:m5:gate4`); tidak ada rahasia di bundle klien (`ci:bundle-secrets`); suite yang sama lulus di tiga dialect; backup → hapus database → restore diuji setiap push.

Lisensi dan kontribusi: lihat berkas `LICENSE` bila ada; gaya kode diatur Biome (`bun run lint`). Komentar kode berbahasa Inggris, dokumen dan teks antarmuka berbahasa Indonesia.

# ADR — Catatan Keputusan Arsitektur

Ringkasan keputusan arsitektur yang sedang berlaku, disusun dari [`PRD.md`](./PRD.md) (v2.0) dan dari graph kode (`codebase-memory-mcp`, proyek `D-garapan-app_template-git-dashboard-ai-boilerplate-ssr`). Dokumen ini **bukan** sumber kebenaran: kalau isinya berbeda dengan PRD, **PRD yang menang**, dan dokumen ini yang diperbaiki. Salinan yang sama disimpan sebagai ADR di graph supaya bisa dibaca agent di sesi berikutnya. Ubah keduanya bersamaan.

Tanggal penyusunan: 2026-09-26.

## PURPOSE

Boilerplate **dashboard admin ber-AI** yang dipakai sebagai template proyek baru. Ini bukan SaaS, bukan CMS, bukan page builder. Lima tujuannya: **API-first · SSR · Modular · Database-agnostic · Self-hosted**. Janji utamanya: modul lengkap bisa dibangun tanpa menyentuh core, bahkan dari repositori lain.

## STACK

| Lapisan | Pilihan |
|---|---|
| Runtime | Bun |
| API | Elysia + TypeBox → OpenAPI 3.1 otomatis (`apps/api`) |
| Web | SvelteKit SSR + shadcn-svelte + Tailwind (`apps/web`) |
| Klien API | Eden Treaty (typed) |
| ORM | Drizzle, skema di-generate dari deskriptor netral dialect |
| DB | MySQL 8 (baku) · MariaDB 11 · PostgreSQL 16 — tier-1 di CI; SQLite best-effort |
| State bersama | Database (baku); Redis/Valkey opsional |
| Deploy | Docker Compose + Caddy, satu VPS (2 vCPU / 4 GB) |
| Lisensi | MIT (PRD §11.1, 2026-09-10) |

## ARCHITECTURE

Topologi (PRD §4.1): Browser → `apps/web` (SvelteKit SSR, form actions) → `apps/api` (Elysia, HTTP internal / Eden Treaty) → DB lewat Drizzle, Redis opsional, provider AI (OpenAI-compatible) + server MCP. Satu origin: `/` → web, `/v1/*` → api, `/docs` → api.

Struktur repositori:

- `apps/api` — proses Elysia berdiri sendiri: `app.ts`, `serve.ts`, `cli.ts`, `domains/` (auth, groups, mcp, …), `plugins/`, `webhooks.ts`, `queue.ts`, `retention.ts`, `generated/` (registry hasil sync).
- `apps/web` — SvelteKit. `src/lib/server/session.ts` adalah hub panggilan API (`apiFor`, `checkCsrf`, `unwrap`, `actionFailure` termasuk node dengan fan-in tertinggi di graph); `menu.ts`, `theme.ts`, `sidebar.ts`, `origin.ts`, `locale.ts`.
- `packages/` — `db` (koneksi tunggal, deskriptor, codegen, `id.ts` UUIDv7, `tenant.ts` dengan `unsafeAcrossTenants`), `auth` (sesi, token, RBAC, TOTP, OAuth, rate limit), `contracts`, `config`, `settings` (konfigurasi runtime + cache + registry route/tema), `module-kit` (kontrak, manifest, sync, events, jobs, tools, catalog), `runtime` (event bus, scheduler), `i18n`, `mail` (termasuk pelacakan engagement), `storage`, `logger`, `metrics`, `ui-theme`.
- `modules/` — `AI`, `Example`, `Dummy`; didaftarkan di `modules.json`.
- `scripts/` — `modules:sync`, `modgen`, dan lainnya. `.bun-create/module` — starter repo modul standalone.

Lapisan menurut graph: `db`, `contracts`, `auth`, `config`, `i18n` adalah core (fan-in tinggi, fan-out nol); `api` dan `web` adalah lapisan internal; `AI`, `Example`, `module-kit` hanya punya panggilan keluar (entry). Batas terpadat: `AI → web`, `web → i18n`, `Example → web`, `api → db`.

## PATTERNS

- **API terpisah dari web** (Keputusan A). Web adalah konsumen pertama API-nya sendiri.
- **Tidak ada token di browser** (Keputusan B). Cookie `httpOnly` `SameSite=Lax`; `load` di server memanggil API.
- **Modul dirakit saat build** (Keputusan C, G). `bun modules:sync` membaca `modules.json` dan `module.json`, lalu meng-generate registry API, web, publik, DB, menu, izin, i18n, tool, dan tema. Berkas hasil generate tidak pernah diedit tangan.
- **Kontrak modul tertutup: 16 titik perluasan** (PRD §4.5). Kebutuhan modul yang tidak terlayani berarti kontraknya yang diperbaiki, bukan core yang ditambal. Namespace: tabel `<nama>_*`, API `/v1/m/<nama>/*`, halaman `/m/<nama>/*`, izin/i18n/tema `<nama>.*`.
- **Dogfooding** (Keputusan H). `AI` dan `Example` memakai kontrak yang sama dengan modul pihak ketiga.
- **Modul lintas repo** (Keputusan L). Sumber `local` / `submodule` (baku) / `package`; `@core/*` adalah paket nyata.
- **Kontrak API dari satu definisi.** Skema TypeBox ditulis bersama route → validasi, tipe, dan OpenAPI.
- **Tema = paket presentasi** (Keputusan J, K). Token, set ikon, layout, dan aset merek; halaman menyebut `layoutVariant`, bukan id layout; resolusi di server saat SSR.
- **Konfigurasi di database** (Keputusan I). `.env` hanya untuk bootstrap; `app.landing_route` dan `app.home_route` divalidasi terhadap registry route saat disimpan.

## DATA

- **Isolasi tenant per kolom `client_id`** dalam satu database (Keputusan N). Filter disuntikkan repository; query lintas tenant wajib lewat `unsafeAcrossTenants()`.
- **Skema netral dialect** — deskriptor → `bun db:codegen` → skema per dialect. SQL mentah dilarang di kode domain.
- **PK UUIDv7** dari satu fungsi di `packages/db` (Keputusan O).
- Portabilitas: timestamp UTC, enum sebagai `varchar`, JSON tidak di-query atau diindeks, uang `decimal(18,4)`, charset/collation eksplisit. Hapus lunak lewat `status_id` + `deleted_at`.
- Migrasi ter-versi (`bun db:migrate`) adalah satu-satunya jalur produksi; `db:push` khusus dev.

## DEPLOYMENT

Self-hosted, lokal atau VPS. Caddy baku, Nginx sebagai alternatif (Keputusan D); satu domain, satu origin (Keputusan E); proses stateless (Keputusan F); Redis opsional, database sebagai backing store baku (Keputusan M). Job terjadwal mengambil lock lewat database supaya `--scale api=3` tidak menjalankannya berkali-kali. Detail di [`DEPLOY.md`](./DEPLOY.md).

## CONSTRAINTS

Pantangan desain (PRD §1.3) — pelanggaran adalah cacat:

1. Tidak ada state bersama di memori proses; adapter memori menolak start di production.
2. Rahasia tidak pernah masuk bundle klien; hanya `PUBLIC_*`.
3. Satu instance koneksi DB, diekspor dari `packages/db`.
4. SSR wajib; alur inti jalan tanpa JavaScript.
5. Kontrak API bukan turunan; tidak ada dokumen API manual.
6. CSRF di semua endpoint yang mengubah state; endpoint publik lewat allowlist.
7. Skema netral dialect; SQL mentah dilarang di kode domain.
8. Registrasi modul simetris lewat satu `bun modules:sync`.

Target yang mengikat: TTFB < 200 ms p95 · API p95 < 150 ms · JS awal < 150 KB (dashboard) / < 60 KB (landing) · Lighthouse ≥ 90 · WCAG 2.1 AA di setiap tema · stack idle < 1,5 GB RAM.

## OPEN QUESTIONS

Dari PRD §11.2: pemilik registry harga model AI; aset merek per tema; gaya landing page `Example` (company profile vs e-commerce).

# AGENTS.md

> Panduan singkat untuk agent AI (termasuk opencode) yang bekerja pada repository ini.

**Sumber kebenaran adalah [`docs/PRD.md`](./docs/PRD.md) (v2.0).** [`BRIEF.md`](./BRIEF.md) adalah ringkasannya — mulai dari sana, tapi kalau keduanya berbeda, **PRD yang menang**.

Wajib dibaca sebelum melakukan perubahan apa pun:

1. [`BRIEF.md`](./BRIEF.md) — seluruhnya. Ringkas, memuat pantangan desain yang tidak boleh dilanggar.
2. [`docs/PRD.md`](./docs/PRD.md) — bagian yang menyentuh pekerjaanmu, plus §1.3 (pantangan), §4.5 (kontrak modul), dan §8 (kriteria terima).
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — urutan pengerjaan & gate keluar. Jangan mengerjakan milestone yang gate sebelumnya belum hijau.
4. [`docs/THEMES.md`](./docs/THEMES.md) — bila pekerjaanmu menyentuh tema, ikon, atau layout.
5. [`docs/MODULES.md` · `docs/AI.md`](./docs/MODULES.md) — bila pekerjaanmu membuat atau mengubah modul; ini kontrak yang benar-benar berlaku hari ini, bukan rencana.
6. [`docs/DEPLOY.md`](./docs/DEPLOY.md) · [`docs/RELEASE-CHECKLIST.md`](./docs/RELEASE-CHECKLIST.md) — bila pekerjaanmu menyentuh compose, image, backup, atau kriteria terima §8; daftar periksa memisahkan bukti CI dari langkah manual.
7. [`docs/ADR.md`](./docs/ADR.md) — ringkasan keputusan arsitektur yang berlaku (turunan PRD; salinannya juga ada sebagai ADR di graph `codebase-memory-mcp`). Bila keputusan arsitektur berubah, perbarui berkas ini dan ADR di graph bersamaan.

Bila sebuah perubahan mengubah perilaku yang tertulis di PRD, **PRD ikut diperbarui pada commit yang sama** (ROADMAP §7 butir 7).

## Konvensi bahasa

| Di mana | Bahasa | Cakupan |
|---|---|---|
| **Komentar di kode** | **Inggris** — wajib, tanpa kecuali | Semua komentar dan docblock di `.ts`, `.js`, `.mjs`, `.svelte`, `.css`, `.sql`, `.toml`, `.yml`, `Dockerfile`, `.env.example`, `.gitignore`, dan berkas hasil generate |
| Identifier, nama berkas, nama commit | Inggris | Nama variabel, fungsi, tabel, kolom, kunci konfigurasi |
| Dokumen (`docs/`, `BRIEF.md`, berkas ini) | Indonesia | PRD, ROADMAP, THEMES, panduan |
| Pesan galat runtime & string UI | Lewat i18n (`id`/`en`) begitu katalognya ada (FR-K); sebelum itu, Indonesia | Bukan komentar — jangan diterjemahkan ke Inggris hanya karena berada di kode |

Aturan praktisnya: kalau teks itu dibaca **developer dari dalam kode**, Inggris; kalau dibaca **pemakai atau pembaca dokumen**, ikuti baris di atas. Komentar berbahasa Indonesia di kode adalah cacat review, bukan preferensi gaya.

**Kode kebutuhan PRD (`A-1`, `C-4`, `L-24`, …) hanya untuk dokumen dan pelacakan internal.** Jangan menaruhnya di teks yang dibaca pemakai atau developer luar: `summary`/`description` OpenAPI, katalog i18n, pesan galat, keluaran CLI, dan galat `modules:sync`. Tulis apa maksudnya, bukan nomornya. OpenAPI dan katalog i18n dijaga tes (`apps/api/test/openapi.test.ts`, `packages/i18n/test/catalog-copy.test.ts`). Summary route cukup satu frasa pendek; rinciannya di `description`, dan baris izin terisi otomatis dari guard (lihat `docs/MODULES.md`).

## Tentang Project

Ini adalah boillerplate untuk membuat app/webapp/dashboard

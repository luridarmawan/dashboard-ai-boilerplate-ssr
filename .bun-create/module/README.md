# Hello — modul standalone

Dibuat dengan `bun create module`. Folder ini adalah **repositori modul yang berdiri sendiri**: bisa di-build,
di-lint, dan dites tanpa meng-clone core secara manual (PRD §4.9 poin 2). Strukturnya sama persis dengan
modul lokal di `modules/<Nama>` pada core — hanya lokasinya yang berbeda.

## Mulai

```bash
bun run rename Billing        # sekali: Hello → Billing (namespace billing, tabel billing_*, /m/billing/*)
bun run harness               # clone core ke .core/ (ref di package.json → "core"), tautkan, sync, tsc, lint, migrasi, tes
DATABASE_URL=mysql://app:app@127.0.0.1:3306/app bun run harness   # + tes integrasi terhadap MySQL nyata
bun run harness --web         # + svelte-check halaman modul
```

Untuk siklus dev di browser, arahkan harness ke checkout core yang sudah ada — modul ditautkan ke sana dan
`bun dev` di core menyajikannya di `/m/<ns>/…`:

```bash
CORE_DIR=../dashboard-ai-boilerplate-ssr bun run harness
```

## Rilis & pemasangan di host

```bash
git tag v0.1.0 && git push --tags
# di core mana pun:
bun modules:add <git-url> --ref v0.1.0
```

`ref` wajib tag atau commit (Keputusan L). Host tidak me-lint kode Anda — CI di repo ini yang melakukannya
(`.github/workflows/ci.yml` menjalankan harness dengan MySQL).

## Isi

Semua titik perluasan yang dipakai berjalan: `db/tables.ts`, `permissions.ts`, `menu.ts`, `config.ts`, `i18n/`,
`api/` (route + skema bersama), `web/routes/` (list, baru, ubah), `web/public/` (halaman publik), `widgets.ts`,
`hooks.ts`, `jobs.ts`, `seed.ts`, `test/`. Panduan lengkap: `docs/MODULES.md` di core.

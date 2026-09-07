# Daftar Periksa Rilis — 25 kriteria terima PRD §8

Titik rilis MVP (ROADMAP M7) adalah **seluruh kriteria §8 hijau**. Sebagian dibuktikan otomatis di setiap push; sisanya hanya bisa dijalankan manusia di infrastruktur nyata. Tabel ini adalah kontrak antara keduanya — centang kolom manual sebelum menyatakan rilis.

| # | Kriteria (ringkas) | Bukti otomatis | Manual |
|---|---|---|---|
| 1 | Repo bersih → dashboard berfungsi < 5 menit lewat migrasi ter-versi | job `integration` (install → migrate → seed → proof) | ☐ ukur waktu di mesin baru |
| 2 | Suite sama lulus di MySQL 8, MariaDB 11, PostgreSQL 16 | job `db-matrix` | — |
| 3 | `--scale api=3` tanpa sticky session | job `scale-proof` (`proof:m1:scale`) | — |
| 4 | `/openapi.json` cocok dengan perilaku; klien typed terkompilasi | `proof:m5:gate4` + typecheck Eden | — |
| 5 | Dashboard lengkap & alur CRUD/tema/bahasa tanpa JavaScript | `scripts/m1…m6-gate-proof.ts` (HTTP murni) | — |
| 6 | Tidak ada rahasia di bundle klien | `ci:bundle-secrets` | — |
| 7 | Audit dependensi bersih dari kerentanan tinggi | `bun audit --audit-level=high` di job `check` | — |
| 8 | Lighthouse ≥ 90 ×4 di landing; ≥ 90 Perf & A11y di dashboard | job `lighthouse` (landing) | ☐ dashboard: jalankan Lighthouse dengan sesi login |
| 9 | Chat AI streaming, riwayat, token & latensi tercatat | `scripts/m5-gate-proof.ts`, tes integrasi modul AI | — |
| 10 | Semua endpoint pengubah state terproteksi CSRF; lintas-origin ditolak | tes integrasi `auth.test.ts` (Origin salah → 403) | — |
| 11 | Modul `bun modgen` langsung berfungsi (hook, job, widget) tanpa ubah core | `ci:modgen-guard` + proof M6 | — |
| 12 | Modul AI = modul biasa; nonaktif per tenant; lepas dari `modules.json` tetap build | proof M5 #3, `proof:m5:gate4` | — |
| 13 | Modul dari repo lain lewat `bun create module` + `modules:add` | `ci:cross-repo` | — |
| 14 | Hapus folder modul + sync → aplikasi tetap benar | `ci:modgen-guard` langkah 4 | — |
| 15 | Landing `Example` di `/`: SSR, data DB, form kontak tanpa JS → outbox | `scripts/m4-gate-proof.ts` | — |
| 16 | `app.landing_route` dari UI langsung berlaku; route salah ditolak | `scripts/m3-gate-proof.ts` | — |
| 17 | 4 tema, 2 berbeda layout & ikon; tema baku admin; pilihan user bertahan; tanpa kedipan | `scripts/m2-gate-proof.ts`, `theme:validate` | ☐ cek visual kedipan di browser |
| 18 | Layout kustom dari modul (termasuk repo lain) tanpa ubah halaman/core | proof M2 #5 (`dummy.two-column`), `ci:cross-repo` | — |
| 19 | `_layoutVariant = 'wide'` per halaman; ganti tema mengubah layout konkret | proof M2 #3, `layout-contract.ts` | — |
| 20 | Allowlist tema; tema dicabut → user pindah ke baku tanpa galat | `scripts/m3-gate-proof.ts` | — |
| 21 | Set ikon bertukar; CI gagal bila ada nama ikon tak tertutup | `icon-coverage.ts`, proof M2 | — |
| 22 | Menonaktifkan modul pemilik tema/layout tidak merusak halaman | proof M3 (L-14) | — |
| 23 | VPS bersih → HTTPS < 15 menit mengikuti [`DEPLOY.md`](./DEPLOY.md) tanpa langkah tak tertulis | `docker-build`, `scale-proof` (stack yang sama, tanpa domain publik) | ☐ **wajib**: VPS Ubuntu LTS + Docker, catat waktu |
| 24 | Backup → hapus database → restore → aplikasi utuh | job `backup-restore` (`scripts/ci/backup-restore-proof.sh`) | ☐ ulangi sekali di VPS dengan `run --rm restore` |
| 25 | Stabil di 2 vCPU / 4 GB, RAM idle < 1,5 GB | `scripts/ci/idle-memory.sh` di job `scale-proof` (3 replika api) | ☐ **wajib**: `docker stats --no-stream` di VPS setelah 10 menit idle |

## Cara menjalankan bagian manual

```bash
alias dc='docker compose --env-file .env.prod -f compose.prod.yml'   # bash & zsh
# 23: di VPS baru, ikuti docs/DEPLOY.md §2 sambil menyalakan stopwatch; berhenti bila ada langkah yang tidak tertulis
# 24: di VPS
dc run --rm backup-once
dc stop api web
dc exec mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e 'DROP DATABASE app; CREATE DATABASE app'
dc run --rm -e CONFIRM_RESTORE=yes restore latest
dc up -d --scale api=3 && curl -s https://DOMAIN/v1/ready
# 25: setelah 10 menit idle
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' && free -m
```

Yang belum ditepati MVP dan sengaja ditunda (P1/P2, PRD §8 bagian akhir & ROADMAP §8): MCP server/client (titik perluasan 8), adapter Redis untuk sesi/rate limit, systemd tanpa Docker, deploy tanpa downtime, `preflight`, batas sumber daya per service, UI admin modul lengkap, uninstall modul dengan migrasi turun.

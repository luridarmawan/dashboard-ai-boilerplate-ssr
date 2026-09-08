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
| 8 | Lighthouse ≥ 90 ×4 di landing; ≥ 90 Perf & A11y di dashboard | job `lighthouse` (landing) | ☑ 2026-09-08 di VPS: landing (mobile) 95/100/100/100; dashboard `/users` dengan sesi login Performance 98, Accessibility 100, Best Practices 100, SEO 91 |
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
| 23 | VPS bersih → HTTPS < 15 menit mengikuti [`DEPLOY.md`](./DEPLOY.md) tanpa langkah tak tertulis | `docker-build`, `scale-proof` (stack yang sama, tanpa domain publik) | ☑ 2026-09-08: VPS Ubuntu LTS + Docker, 13 menit (setup 10.44 → build image 6 menit → stack hidup 10.57), `migrate` + `seed` + `/v1/ready` hijau; rollout `deploy/upgrade.sh` tanpa request gagal |
| 24 | Backup → hapus database → restore → aplikasi utuh | job `backup-restore` (`scripts/ci/backup-restore-proof.sh`) | ☐ ulangi sekali di VPS dengan `run --rm restore` |
| 25 | Stabil di 2 vCPU / 4 GB, RAM idle < 1,5 GB | `scripts/ci/idle-memory.sh` di job `scale-proof` (3 replika api) | ☑ 2026-09-08 (sudah migrate + seed, 10 menit idle): caddy 10 MB, web 68 MB, api 87/40/38 MB, backup 4 MB, mysql 467 MB — total container ≈ 713 MB, pagu 2,9 GB tidak tersentuh |

## Cara menjalankan bagian manual

```bash
alias dc='docker compose --env-file .env.prod -f compose.prod.yml'   # bash & zsh
# 23: di VPS baru, ikuti docs/DEPLOY.md §2 sambil menyalakan stopwatch; berhenti bila ada langkah yang tidak tertulis.
#     Jangan lewati langkah 4–5 (`dc run --rm migrate`, `dc run --rm seed`) SEBELUM `dc up -d --wait --scale api=3`:
#     tanpa itu /v1/ready menjawab 503 "Failed query: select id from clients" (tabel belum ada). Ragu? `dc run --rm preflight`
#     menyebut persis apa yang kurang. Pengukuran 2026-09-08: build image 6 menit, VPS kosong → stack hidup 13 menit.
# 24: di VPS (database hasil restore sudah membawa migrasi + seed dari dump; preflight yang memastikannya)
dc run --rm backup-once
dc stop api web
dc exec mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e 'DROP DATABASE <DATABASE_NAME>; CREATE DATABASE <DATABASE_NAME>'   # nama dari .env.prod (baku app)
dc run --rm -e CONFIRM_RESTORE=yes restore latest
dc run --rm preflight        # harus LOLOS: migrations mutakhir, seed ada — bila tidak, dump-nya cacat
dc up -d --force-recreate --scale api=3 web   # WAJIB recreate: pool koneksi lama masih menunjuk database yang di-drop (galat 1046 di setiap kueri)
curl -s https://DOMAIN/v1/ready
# 25: setelah 10 menit idle (ukur dalam kondisi sudah migrate + seed, bukan stack kosong)
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' && free -m
```

Uninstall modul dengan migrasi turun (G-15) — dulu ditunda — kini ada: `bun modules:remove <Nama>` ([`MODULES.md`](./MODULES.md) §5). **Keputusan tetap** (bukan penundaan): transport MCP hanya HTTP / Streamable HTTP — `stdio`/`websocket` tidak akan dibangun (`docs/MCP.md`).

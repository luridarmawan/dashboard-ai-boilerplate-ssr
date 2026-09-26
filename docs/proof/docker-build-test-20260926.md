# Hasil pengujian build Docker (branch `docker`) — 2026-09-26

Branch ini diturunkan dari `development` (`e20baf6`) khusus pengujian build image produksi.

## Build image
- `docker build --target api` → `dab/api:dockertest` — **sukses**, 132 MB
- `docker build --target web` → `dab/web:dockertest` — **sukses**, 143 MB

## Smoke test runtime
- Container API dijalankan di network compose + MySQL (`DB_DIALECT=mysql`) — status **healthy**
- `/v1/health` → `{"success":true,"data":{"status":"ok"}}`
- `/v1/version` → `dashboard-ai-boilerplate v0.0.1`, modul AI termuat, 10 hooks, 7 job scheduler aktif
- `/docs` → 200, `/openapi.json` valid
- Log hanya memuat warning SMTP (memang tidak dikonfigurasi saat uji) — bukan error

## Catatan
- Image API listen di port **3001** (sesuai `deploy/Caddyfile`); saat `docker run` manual, map port host ke 3001, bukan 3000.
